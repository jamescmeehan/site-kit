// Lead forms on Cloudflare Pages Functions. A static site has nowhere to post a
// form, so this takes the submission, screens it and emails it. A lead the mailer
// refuses is reported to the visitor rather than dropped: they can still call.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD = 5000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return request.json();
  const form = await request.formData();
  const out = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).filter((v) => typeof v === 'string');
    out[key] = values.join(', ');
  }
  return out;
}

/** Sends through Resend. `apiKey` comes from the Function's env. */
export const resendSender = (apiKey) => async ({ from, to, subject, text, replyTo }) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, reply_to: replyTo }),
  });
  if (!res.ok) throw new Error(`mailer answered ${res.status}`);
};

/** Sends through an HTTP relay holding the mailbox, for mail hosts Functions can't reach. */
export const relaySender = ({ url, token }) => async ({ to, subject, text, replyTo }) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, text, replyTo }),
  });
  if (!res.ok) throw new Error(`relay answered ${res.status}`);
};

async function passesTurnstile(secret, token, ip) {
  const body = new URLSearchParams({ secret, response: token || '' });
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  return (await res.json()).success === true;
}

/**
 * Builds a Pages Function `onRequestPost` for a lead form.
 *
 * Screening is quiet where it can be: a bot that fills the honeypot or posts in
 * under `minSeconds` is told it succeeded, so it doesn't learn to adapt.
 *
 * @param {object} options
 * @param {[string, string][]} options.fields [name, label] pairs, in email order.
 * @param {string[]} options.required Field names that must be present.
 * @param {string[]} options.to Recipients.
 * @param {string} options.from A sender the mailer is authorised for.
 * @param {(data: Record<string,string>) => string} options.subject
 * @param {string[]} options.origins Origins allowed to post.
 * @param {string} [options.emailField] The field that becomes Reply-To.
 * @param {string} [options.honeypot] Field name humans never see.
 * @param {number} [options.minSeconds] Fastest believable submission, from `started_at`.
 * @param {(env: object) => Function} [options.sender] Picks the mailer from env.
 * @param {(data: Record<string,string>) => Record<string,string>} [options.normalize]
 *   Reshapes the posted fields first, for forms with their own naming.
 */
export function leadHandler({
  fields,
  required,
  to,
  from,
  subject,
  origins,
  emailField = 'email',
  honeypot = 'website',
  minSeconds = 3,
  sender = (env) => resendSender(env.RESEND_API_KEY),
  normalize = (data) => data,
}) {
  return async function onRequestPost({ request, env }) {
    if (!origins.includes(request.headers.get('origin'))) return json({ ok: false, error: 'origin' }, 403);

    let data;
    try {
      data = normalize(await readBody(request));
    } catch {
      return json({ ok: false, error: 'body' }, 400);
    }

    const started = Number(data.started_at);
    if (data[honeypot] || (started && Date.now() - started < minSeconds * 1000)) return json({ ok: true });

    if (env.TURNSTILE_SECRET_KEY) {
      const ip = request.headers.get('cf-connecting-ip');
      const ok = await passesTurnstile(env.TURNSTILE_SECRET_KEY, data['cf-turnstile-response'], ip).catch(() => false);
      if (!ok) return json({ ok: false, error: 'challenge' }, 400);
    }

    const missing = required.filter((name) => !String(data[name] ?? '').trim());
    if (missing.length) return json({ ok: false, error: 'missing', fields: missing }, 422);
    if (!EMAIL.test(String(data[emailField]))) return json({ ok: false, error: 'email', fields: [emailField] }, 422);

    const text = fields
      .filter(([name]) => String(data[name] ?? '').trim())
      .map(([name, label]) => `${label}: ${String(data[name]).slice(0, MAX_FIELD)}`)
      .join('\n');

    try {
      await sender(env)({ from, to, subject: oneLine(subject(data)), text, replyTo: oneLine(data[emailField]) });
    } catch (err) {
      console.error('lead not delivered', err.message);
      return json({ ok: false, error: 'delivery' }, 502);
    }
    return json({ ok: true });
  };
}
