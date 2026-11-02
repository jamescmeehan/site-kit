#!/usr/bin/env node
/**
 * Schema graph validator. Run AFTER `astro build`, against the output dir. Exits
 * non-zero on any failure so it can gate CI.
 *
 * Always checked:
 *  - JSON-LD that doesn't parse.
 *  - Site-wide resolvability: every referenced @id must be defined somewhere in
 *    the build. A definition is a TOP-LEVEL @graph member with an @id and more
 *    than just that @id. An @id-bearing object nested inside another node's
 *    property isn't separately addressable, so referencing it from elsewhere is
 *    the "defined in the wrong place" bug. Bare {@id} objects are references.
 *  - Leaked template values: a string that is "undefined" or "null", or a URL
 *    with an /undefined/ or /null/ segment. These point at each other
 *    consistently, so the @id checks can't see them, and the build still passes.
 *
 * Opt-in:
 *  --site <origin>    @ids at <origin>/#... are external anchors, expected to
 *                     resolve outside this build: reported, never dangling.
 *  --per-page         Every @id a page references must resolve WITHIN that page,
 *                     because search engines evaluate each page in isolation.
 *  --require-schema   Every page must emit JSON-LD. noindex pages are excused.
 *  --allow-no-schema <a,b>  Further exemptions, relative to distDir. The bar is
 *                     "schema would be wrong here", not "we haven't got to it".
 *
 * Usage: site-kit-validate-schema [distDir] [options]   (distDir: ./dist)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string' },
    'per-page': { type: 'boolean', default: false },
    'require-schema': { type: 'boolean', default: false },
    'allow-no-schema': { type: 'string', default: '' },
  },
});

const distDir = positionals[0] ?? './dist';
const anchorPrefix = values.site ? `${values.site.replace(/\/$/, '')}/#` : null;
const isAnchor = (id) => anchorPrefix !== null && id.startsWith(anchorPrefix);
const allowNoSchema = new Set(values['allow-no-schema'].split(',').filter(Boolean));
const distRelative = (p) => relative(distDir, p).split(sep).join('/');

function walkHtml(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkHtml(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function extractGraphs(html) {
  const out = [];
  const re = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      out.push(...(parsed['@graph'] ?? [parsed]));
    } catch (e) {
      out.push({ __parseError: String(e) });
    }
  }
  return out;
}

function collectTopLevel(nodes, defined) {
  for (const n of nodes) {
    if (n && typeof n === 'object' && !Array.isArray(n) && n['@id'] && Object.keys(n).length > 1) {
      defined.add(n['@id']);
    }
  }
}

function collectRefs(nodes, refs) {
  const walk = (o) => {
    if (Array.isArray(o)) {
      o.forEach(walk);
    } else if (o && typeof o === 'object') {
      const keys = Object.keys(o);
      if (keys.length === 1 && keys[0] === '@id') refs.add(o['@id']);
      else Object.values(o).forEach(walk);
    }
  };
  nodes.forEach(walk);
}

function collectLeaks(nodes, leaks) {
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    else if (typeof o === 'string' && /^(undefined|null)$|\/(undefined|null)(\/|#|$)/.test(o)) leaks.add(o);
  };
  nodes.forEach(walk);
}

const pages = walkHtml(distDir);
const siteDefined = new Set();
const siteRefs = new Set();
const parseErrors = [];
const leaks = [];
const noSchema = [];
const pageDangling = [];
const excused = new Set();
let noindexExcused = 0;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const nodes = extractGraphs(html);

  if (nodes.length === 0) {
    if (allowNoSchema.has(distRelative(page))) excused.add(distRelative(page));
    else if (/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html)) noindexExcused += 1;
    else noSchema.push(page);
    continue;
  }

  for (const n of nodes) if (n.__parseError) parseErrors.push([page, n.__parseError]);
  collectTopLevel(nodes, siteDefined);
  collectRefs(nodes, siteRefs);

  const pageLeaks = new Set();
  collectLeaks(nodes, pageLeaks);
  if (pageLeaks.size) leaks.push([page, [...pageLeaks].sort()]);

  const defined = new Set();
  const refs = new Set();
  collectTopLevel(nodes, defined);
  collectRefs(nodes, refs);
  const dangling = [...refs].filter((r) => !defined.has(r) && !isAnchor(r)).sort();
  if (dangling.length) pageDangling.push([page, dangling]);
}

const siteDangling = [...siteRefs].filter((r) => !siteDefined.has(r) && !isAnchor(r)).sort();
const anchors = [...siteRefs].filter(isAnchor);

console.log(`pages scanned:        ${pages.length}`);
console.log(`@id nodes defined:    ${siteDefined.size}`);
console.log(`@id refs used:        ${siteRefs.size}`);
if (anchorPrefix) console.log(`external anchors:     ${anchors.length} (expected to resolve at ${anchorPrefix})`);
if (noindexExcused) console.log(`noindex, no schema:   ${noindexExcused}`);
if (excused.size) console.log(`schema-exempt:        ${excused.size} (${[...excused].join(', ')})`);

// An exemption for a page that turned up WITH schema is stale. A page missing
// from the scan may only mean we were pointed at a subtree, so that's not flagged.
const scanned = new Set(pages.map(distRelative));
const stale = [...allowNoSchema].filter((rel) => scanned.has(rel) && !excused.has(rel));
if (stale.length) console.log(`\n! stale --allow-no-schema entr(ies), safe to drop: ${stale.join(', ')}`);

let failed = false;
const report = (items, title, line) => {
  if (!items.length) return;
  console.error(`\n✗ ${items.length} ${title}:`);
  items.forEach(line);
  failed = true;
};
const withDetails = ([p, details]) => {
  console.error(`    ${p}`);
  details.forEach((d) => console.error(`        ↳ ${d}`));
};

if (values['require-schema']) report(noSchema, 'page(s) emit NO JSON-LD', (p) => console.error(`    ${p}`));
report(parseErrors, 'JSON-LD parse error(s)', ([p, e]) => console.error(`    ${p}: ${e}`));
report(leaks, 'page(s) with a leaked undefined/null value', withDetails);
report(siteDangling, 'site-wide dangling @id reference(s)', (d) => console.error(`    ${d}`));
if (values['per-page']) report(pageDangling, 'page(s) with refs not resolvable within the page', withDetails);

if (failed) {
  console.error('\nSchema validation FAILED.');
  process.exit(1);
}
console.log('\n✓ Schema validation passed.');
