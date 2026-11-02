#!/usr/bin/env node
/**
 * Compares two built sites page by page, for checking that a dependency bump or
 * refactor left pages unchanged. A passing build proves very little: Astro 7's
 * upgrade dropped 140 <source> tags from one homepage and put /undefined/ in
 * another site's JSON-LD, and both builds exited 0.
 *
 * Compares the file set, visible text, word gaps at tag edges, the tag sequence,
 * JSON-LD and the sitemap. Hashed files under _astro/ are skipped, and so is
 * markup that differs only in quoting, escaping or minification.
 *
 * Usage: site-kit-compare-builds <before> <after> [--ignore-key dateModified]...
 * Exits 1 if anything differs.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'ignore-key': { type: 'string', multiple: true, default: [] } },
});
const [before, after] = positionals;
if (!before || !after) {
  console.error('usage: site-kit-compare-builds <before> <after> [--ignore-key <key>]...');
  process.exit(2);
}
const ignored = new Set(values['ignore-key']);

const TAG = /<[a-zA-Z/!](?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const files = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.replace(/\/$/, '').length + 1))
    .filter((f) => !f.startsWith('_astro/'))
    .sort();

const body = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => decode(body(html).replace(TAG, ' ')).replace(/\s+/g, ' ').trim();
// No space added at tag edges, so a lost gap between inline elements shows up.
const gaps = (html) => decode(body(html).replace(TAG, '')).replace(/\s+/g, ' ').trim();
const tags = (html) => [...body(html).matchAll(/<\/?[a-zA-Z][\w-]*/g)].map((m) => m[0]);

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !ignored.has(k)).map(([k, v]) => [k, strip(v)])
    );
  }
  return value;
}
const jsonLd = (html) =>
  JSON.stringify(
    [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => strip(JSON.parse(m[1])))
  );

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return [a.slice(Math.max(0, i - 40), i + 60), b.slice(Math.max(0, i - 40), i + 60)];
}
function tagCounts(a, b) {
  const count = (list) => list.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
  const x = count(a);
  const y = count(b);
  return [...new Set([...x.keys(), ...y.keys()])]
    .filter((t) => x.get(t) !== y.get(t))
    .map((t) => `${t} ${x.get(t) ?? 0}->${y.get(t) ?? 0}`)
    .join(', ');
}

const beforeFiles = files(before);
const afterFiles = new Set(files(after));
const lines = [];
for (const f of beforeFiles) if (!afterFiles.has(f)) lines.push(`only in before: ${f}`);
for (const f of afterFiles) if (!beforeFiles.includes(f)) lines.push(`only in after:  ${f}`);

let pages = 0;
for (const f of beforeFiles.filter((p) => p.endsWith('.html') && afterFiles.has(p))) {
  pages += 1;
  const a = readFileSync(join(before, f), 'utf8');
  const b = readFileSync(join(after, f), 'utf8');
  if (a === b) continue;
  if (text(a) !== text(b)) {
    const [was, now] = firstDifference(text(a), text(b));
    lines.push(`text    ${f}\n    was …${was}\n    now …${now}`);
  } else if (gaps(a) !== gaps(b)) {
    const [was, now] = firstDifference(gaps(a), gaps(b));
    lines.push(`gaps    ${f}\n    was …${was}\n    now …${now}`);
  }
  if (tags(a).join() !== tags(b).join()) lines.push(`tags    ${f}: ${tagCounts(tags(a), tags(b)) || 'same counts, new order'}`);
  if (jsonLd(a) !== jsonLd(b)) {
    const [was, now] = firstDifference(jsonLd(a), jsonLd(b));
    lines.push(`jsonld  ${f}\n    was …${was}\n    now …${now}`);
  }
}

for (const f of beforeFiles.filter((p) => /^sitemap.*\.xml$/.test(p) && afterFiles.has(p))) {
  // A sitemap index's own <lastmod> follows the build, so only sitemap-0 is exact.
  const read = (d) => readFileSync(join(d, f), 'utf8').replace(/(<\/loc>)<lastmod>[^<]*<\/lastmod>(<\/sitemap>)/g, '$1$2');
  if (read(before) !== read(after)) lines.push(`sitemap ${f}`);
}

console.log(`${pages} pages compared`);
lines.forEach((l) => console.log(l));
if (lines.length) {
  console.log(`\n✗ ${lines.length} difference(s)`);
  process.exit(1);
}
console.log('✓ No differences');
