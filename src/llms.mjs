/**
 * Builds an llms.txt body. `sections` are { title, items } of { title, url, text }
 * or { title, lines } for free text. Empty sections are left out.
 */
export function llmsTxt({ title, summary, intro = [], sections = [] }) {
  const lines = [`# ${title}`, '', `> ${summary}`, ''];
  if (intro.length) lines.push(...intro, '');
  for (const section of sections) {
    const body = section.lines
      ?? (section.items ?? []).map((it) => `- [${it.title}](${it.url})${it.text ? `: ${it.text}` : ''}`);
    if (!body.length) continue;
    lines.push(`## ${section.title}`, '', ...body, '');
  }
  return lines.join('\n');
}

export const llmsResponse = (body) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
