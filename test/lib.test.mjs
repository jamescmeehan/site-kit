import assert from 'node:assert/strict';
import { test } from 'node:test';
import { faqPage, graph, itemList, webPage } from '../src/jsonld.mjs';
import { answerHtml, answerText } from '../src/faq.mjs';
import { llmsTxt } from '../src/llms.mjs';
import { addDays, fmtSpan, holidayIn, monthsSpanning } from '../src/lodging.mjs';
import { stripComments } from '../src/strip-comments.mjs';
import { baselineHeaders } from '../src/integration.mjs';
import { leadHandler } from '../src/forms.mjs';

test('strip: removes HTML comments, keeps text that only looks like one', async () => {
  const html = '<p>a</p><!-- note --><textarea><!-- keep --></textarea><!--[if IE]>x<![endif]-->';
  const { html: out, removed } = await stripComments(html);
  assert.equal(removed, 1);
  assert.equal(out, '<p>a</p><textarea><!-- keep --></textarea><!--[if IE]>x<![endif]-->');
});

test('strip: reaches comments inside noscript and template', async () => {
  const { html } = await stripComments('<noscript><!-- a --><img></noscript><template><!-- b --><p>x</p></template>');
  assert.equal(html, '<noscript><img></noscript><template><p>x</p></template>');
});

test('strip: cleans inline scripts but leaves JSON-LD and src scripts', async () => {
  const ld = '<script type="application/ld+json">{"a": "// not a comment"}</script>';
  const { html } = await stripComments(`<script>// note\nvar a = "<!-- x -->";</script>${ld}<script src="/a.js"></script>`);
  assert.ok(!html.includes('// note'));
  assert.ok(html.includes('<!-- x -->'));
  assert.ok(html.includes(ld));
  assert.ok(html.includes('<script src="/a.js"></script>'));
});

test('strip: can leave inline scripts alone', async () => {
  const html = '<script>// note\nvar a;</script>';
  assert.equal((await stripComments(html, { inlineScripts: false })).html, html);
});

test('headers: baseline names each noindex host', () => {
  const text = baselineHeaders({ noindexHosts: ['x.pages.dev'] });
  assert.match(text, /https:\/\/x\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.match(text, /\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
});

test('jsonld: webPage references the site and sets image forms', () => {
  const page = webPage({ url: 'https://x.test/a/', name: 'A', description: 'd', websiteId: 'https://x.test/#site', image: 'https://x.test/i.jpg' });
  assert.deepEqual(page.isPartOf, { '@id': 'https://x.test/#site' });
  assert.equal(page.primaryImageOfPage.url, 'https://x.test/i.jpg');
  assert.equal(page.image, undefined);
});

test('jsonld: list and faq nodes', () => {
  assert.equal(itemList('https://x.test/', ['a', 'b']).numberOfItems, 2);
  assert.equal(faqPage('https://x.test/', [{ q: 'Q', a: 'A' }]).mainEntity[0].acceptedAnswer.text, 'A');
  assert.equal(graph([1])['@context'], 'https://schema.org');
});

test('faq: text and html stay word for word the same', () => {
  const a = 'See [the map](/map/) & more.';
  assert.equal(answerText(a), 'See the map & more.');
  assert.equal(answerHtml(a), 'See <a href="/map/">the map</a> &amp; more.');
  assert.equal(answerHtml(a, 'u'), 'See <a href="/map/" class="u">the map</a> &amp; more.');
});

test('llms: empty sections drop out', () => {
  const out = llmsTxt({ title: 'T', summary: 'S', sections: [{ title: 'Empty', items: [] }, { title: 'Pages', items: [{ title: 'A', url: 'https://x.test/a/', text: 'about' }] }] });
  assert.ok(!out.includes('Empty'));
  assert.ok(out.includes('- [A](https://x.test/a/): about'));
});

test('lodging: date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(fmtSpan('2026-11-27', '2026-12-01'), 'Nov 27 – Dec 1');
  assert.deepEqual(monthsSpanning('2026-11-27', '2027-01-02'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(holidayIn('2026-07-03', '2026-07-05'), 'Fourth of July');
  assert.equal(holidayIn('2026-03-10', '2026-03-12'), null);
});

const options = { fields: [['name', 'Name'], ['email', 'Email']], required: ['name', 'email'], to: ['a@x.test'], from: 'b@x.test', subject: (d) => `Lead\n${d.name}`, origins: ['https://x.test'] };
const post = (body, origin = 'https://x.test') => new Request('https://x.test/api/contact', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const handler = (sent, fail = false) => leadHandler({ ...options, sender: () => async (m) => { if (fail) throw new Error('no'); sent.push(m); } });

test('forms: delivers with Reply-To and a one-line subject', async () => {
  const sent = [];
  const res = await handler(sent)({ request: post({ name: 'Al', email: 'al@x.test' }), env: {} });
  assert.equal(res.status, 200);
  assert.equal(sent[0].replyTo, 'al@x.test');
  assert.equal(sent[0].subject, 'Lead Al');
  assert.match(sent[0].text, /Name: Al\nEmail: al@x.test/);
});

test('forms: refuses a foreign origin', async () => {
  const res = await handler([])({ request: post({ name: 'Al', email: 'al@x.test' }, 'https://evil.test'), env: {} });
  assert.equal(res.status, 403);
});

test('forms: a filled honeypot looks like success and sends nothing', async () => {
  const sent = [];
  const res = await handler(sent)({ request: post({ name: 'Al', email: 'al@x.test', website: 'x' }), env: {} });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test('forms: an instant post looks like success and sends nothing', async () => {
  const sent = [];
  await handler(sent)({ request: post({ name: 'Al', email: 'al@x.test', started_at: Date.now() }), env: {} });
  assert.equal(sent.length, 0);
});

test('forms: reports missing and invalid fields', async () => {
  assert.equal((await handler([])({ request: post({ name: 'Al' }), env: {} })).status, 422);
  assert.equal((await handler([])({ request: post({ name: 'Al', email: 'nope' }), env: {} })).status, 422);
});

test('forms: a failed send tells the visitor, not a false success', async () => {
  const res = await handler([], true)({ request: post({ name: 'Al', email: 'al@x.test' }), env: {} });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { ok: false, error: 'delivery' });
});
