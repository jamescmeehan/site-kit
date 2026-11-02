import { parse } from 'parse5';
import { transform } from 'esbuild';

const KEEP_COMMENT = /^(\[if|astro:)/;   // conditional comments, Astro's server-island markers
const JS_TYPE = /^(module|text\/javascript)$/i;

/** Every node in a parsed document, including <template> contents. */
function collect(node, found = { comments: [], scripts: [] }) {
  if (node.nodeName === '#comment') found.comments.push(node);
  if (node.nodeName === 'script') found.scripts.push(node);
  for (const child of node.childNodes ?? []) collect(child, found);
  if (node.content) collect(node.content, found);
  return found;
}

const attr = (node, name) => node.attrs.find((a) => a.name === name)?.value;

function applyEdits(html, edits) {
  // Tree order isn't source order once a misplaced node gets foster-parented.
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const { start, end, text } of edits) {
    out += html.slice(at, start) + text;
    at = end;
  }
  return out + html.slice(at);
}

const parseHtml = (html) => parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });

/**
 * Removes HTML comments, leaving every other byte alone.
 *
 * A real parser, because `<!--` is ordinary text inside a script, an attribute
 * or a textarea, and a regex would cut those open. Offsets instead of
 * re-serialising, because the serialiser would rewrite the markup of every page.
 * scriptingEnabled:false reads <noscript> as elements; the default treats it as
 * raw text, which would hide any comment inside.
 */
export function stripHtmlComments(html) {
  const edits = collect(parseHtml(html)).comments
    .filter((c) => !KEEP_COMMENT.test(c.data))
    .map((c) => ({ start: c.sourceCodeLocation.startOffset, end: c.sourceCodeLocation.endOffset, text: '' }));
  return { html: applyEdits(html, edits), removed: edits.length };
}

/**
 * stripHtmlComments, plus comments in inline scripts, which pass through esbuild
 * because they can't be found safely with a regex. <script src>, JSON-LD and other
 * data blocks stay as they are.
 */
export async function stripComments(html, { inlineScripts = true } = {}) {
  const first = stripHtmlComments(html);
  if (!inlineScripts) return first;

  const edits = [];
  for (const script of collect(parseHtml(first.html)).scripts) {
    const type = attr(script, 'type');
    const loc = script.sourceCodeLocation;
    if (attr(script, 'src') !== undefined || (type && !JS_TYPE.test(type)) || !loc?.endTag) continue;
    const start = loc.startTag.endOffset;
    const end = loc.endTag.startOffset;
    const body = first.html.slice(start, end);
    if (!body.trim()) continue;
    const { code } = await transform(body, { loader: 'js', minifyWhitespace: true, legalComments: 'none', charset: 'utf8' });
    edits.push({ start, end, text: code.trim() });
  }
  return { html: applyEdits(first.html, edits), removed: first.removed };
}
