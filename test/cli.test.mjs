import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = (name) => join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', name);
const run = (name, ...args) => spawnSync('node', [bin(name), ...args], { encoding: 'utf8' });

function site(pages) {
  const dir = mkdtempSync(join(tmpdir(), 'site-kit-'));
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), html);
  }
  return dir;
}
const ld = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@graph': graph })}</script>`;
const hub = { '@id': 'https://x.test/#site', '@type': 'WebSite', name: 'X' };

test('validate: passes a resolved graph', () => {
  assert.equal(run('validate-schema.mjs', site({ 'index.html': ld([hub]) })).status, 0);
});

test('validate: fails a dangling reference', () => {
  const dir = site({ 'index.html': ld([{ '@id': 'https://x.test/a', '@type': 'Thing', about: { '@id': 'https://x.test/#gone' } }]) });
  assert.equal(run('validate-schema.mjs', dir).status, 1);
});

test('validate: --site treats root fragments as external anchors', () => {
  const dir = site({ 'index.html': ld([{ '@id': 'https://x.test/a', '@type': 'Thing', about: { '@id': 'https://x.test/#gone' } }]) });
  assert.equal(run('validate-schema.mjs', dir, '--site', 'https://x.test').status, 0);
});

test('validate: a nested @id does not count as a definition', () => {
  const dir = site({
    'index.html': ld([{ '@id': 'https://x.test/a', '@type': 'Thing', part: { '@id': 'https://x.test/b', name: 'B' }, ref: { '@id': 'https://x.test/b' } }]),
  });
  assert.equal(run('validate-schema.mjs', dir).status, 1);
});

test('validate: --per-page needs references resolved on the same page', () => {
  const dir = site({
    'index.html': ld([hub]),
    'a/index.html': ld([{ '@id': 'https://x.test/a', '@type': 'Thing', isPartOf: { '@id': hub['@id'] } }]),
  });
  assert.equal(run('validate-schema.mjs', dir).status, 0);
  assert.equal(run('validate-schema.mjs', dir, '--per-page').status, 1);
});

test('validate: --require-schema excuses noindex and listed pages only', () => {
  const noindex = '<meta name="robots" content="noindex, nofollow">';
  const dir = site({ 'index.html': ld([hub]), 'a/index.html': noindex, '404.html': '<p>gone</p>' });
  assert.equal(run('validate-schema.mjs', dir).status, 0);
  assert.equal(run('validate-schema.mjs', dir, '--require-schema').status, 1);
  assert.equal(run('validate-schema.mjs', dir, '--require-schema', '--allow-no-schema', '404.html').status, 0);
});

test('validate: fails /undefined/ even when the graph is self-consistent', () => {
  const id = 'https://x.test/library/framework/undefined/#framework';
  const dir = site({ 'index.html': ld([{ '@id': id, '@type': 'Thing', name: 'T' }, { '@id': 'https://x.test/p', '@type': 'WebPage', mainEntity: { '@id': id } }]) });
  const result = run('validate-schema.mjs', dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /leaked undefined/);
});

test('compare: ignores escaping inside attributes', () => {
  const a = site({ 'index.html': '<div class="[&>a]:mb-4"><p>Hello</p></div>' });
  const b = site({ 'index.html': '<div class="[&amp;&gt;a]:mb-4"><p>Hello</p></div>' });
  assert.equal(run('compare-builds.mjs', a, b).status, 0);
});

test('compare: catches lost <source> tags', () => {
  const a = site({ 'index.html': '<picture><source srcset="a.avif"><img src="a.jpg"></picture>' });
  const b = site({ 'index.html': '<picture><img src="a.jpg"></picture>' });
  const result = run('compare-builds.mjs', a, b);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /<source 1->0/);
});

test('compare: catches words glued together at a tag edge', () => {
  const a = site({ 'index.html': '<p><span>hello</span> <em>world</em></p>' });
  const b = site({ 'index.html': '<p><span>hello</span><em>world</em></p>' });
  assert.equal(run('compare-builds.mjs', a, b).status, 1);
});

test('compare: --ignore-key skips a build timestamp', () => {
  const page = (date) => ld([{ '@id': 'https://x.test/a', dateModified: date }]);
  const a = site({ 'index.html': page('2026-01-01') });
  const b = site({ 'index.html': page('2026-01-02') });
  assert.equal(run('compare-builds.mjs', a, b).status, 1);
  assert.equal(run('compare-builds.mjs', a, b, '--ignore-key', 'dateModified').status, 0);
});

test('compare: reports a page missing from either build', () => {
  const a = site({ 'index.html': '<p>x</p>', 'a/index.html': '<p>y</p>' });
  const b = site({ 'index.html': '<p>x</p>' });
  assert.equal(run('compare-builds.mjs', a, b).status, 1);
});

test('unshallow: no-ops outside a shallow clone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-kit-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(spawnSync('node', [bin('unshallow.mjs')], { cwd: dir }).status, 0);
});
