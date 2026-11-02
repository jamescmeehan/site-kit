// FAQ answers are plain strings that may carry markdown-style links, [text](/path/),
// so a guide can point at another page mid-answer. The page renders them as anchors
// and FAQPage schema gets the plain text, so the two stay word-for-word identical.

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const answerText = (a) => a.replace(LINK, '$1');

export function answerHtml(a, linkClass = '') {
  const cls = linkClass ? ` class="${linkClass}"` : '';
  let out = '';
  let last = 0;
  for (const m of a.matchAll(LINK)) {
    out += escapeHtml(a.slice(last, m.index));
    out += `<a href="${escapeHtml(m[2])}"${cls}>${escapeHtml(m[1])}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(a.slice(last));
}
