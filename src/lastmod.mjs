import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Prefix that can't appear in a path, so `git log` date lines are unambiguous.
const RECORD = '\x01';

/**
 * Repo-relative path -> ISO date of the most recent commit touching it.
 *
 * Returns null when git history can't be trusted (no repo, or a shallow clone
 * where every file would report the clone commit). Callers omit <lastmod>
 * entirely in that case: no date is better than a wrong one, since Google
 * discounts the field across the whole site once it looks unreliable.
 */
function gitDateMap() {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (shallow === 'true') {
      console.warn(
        '[sitemap] Shallow clone detected — omitting <lastmod>. site-kit-unshallow ' +
          'runs as npm prebuild to prevent this; check its output above.'
      );
      return null;
    }

    // TZ=UTC so every date comes back at the same offset: commits carry their
    // author's timezone, and mixed offsets would break the lexical date
    // comparisons below (and read inconsistently in the sitemap).
    const log = execFileSync(
      'git',
      ['log', `--pretty=format:${RECORD}%cd`, '--date=iso-strict', '--name-only'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TZ: 'UTC' },
      }
    );

    const dates = new Map();
    let commitDate = null;
    for (const line of log.split('\n')) {
      if (line.startsWith(RECORD)) {
        commitDate = line.slice(1);
      } else if (line && commitDate && !dates.has(line)) {
        // git log is newest-first, so the first sighting is the latest change.
        dates.set(line, commitDate);
      }
    }
    return dates;
  } catch (err) {
    console.warn(`[sitemap] git unavailable (${err.message}) — omitting <lastmod>.`);
    return null;
  }
}

/**
 * Source files that decide a URL's content, most specific first.
 *
 * Deliberately narrow: a page's own file only. Layout and component edits don't
 * count as the page changing, which is the semantics <lastmod> is supposed to
 * carry. Both page shapes are tried, and the first one with history wins.
 */
function sourcesFor(pathname, { collections, collectionPrefix }) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return ['src/pages/index.astro'];
  if (
    segs.length === 3 &&
    segs[0] === collectionPrefix &&
    collections.has(segs[1])
  ) {
    return [`src/content/${segs[1]}/${segs[2]}.md`, `src/content/${segs[1]}/${segs[2]}.mdx`];
  }
  const joined = segs.join('/');
  return [`src/pages/${joined}.astro`, `src/pages/${joined}/index.astro`];
}

function readPage(sourcePath) {
  if (!sourcePath.endsWith('.astro')) return null;
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch {
    return null;
  }
}

/** Content-bearing src/data modules a page imports directly. */
function dataDepsOf(sourcePath, dataModules) {
  const src = readPage(sourcePath);
  if (!src) return [];
  return [...src.matchAll(/from\s+['"](?:[./]*)data\/([\w.-]+)['"]/g)]
    .map((m) => m[1])
    .filter((name) => dataModules.has(name))
    .map((name) => `src/data/${name}.ts`);
}

/**
 * Collections an index page enumerates, from its own getCollection() calls.
 *
 * An index's content changes when entries are added or their titles change,
 * while its .astro file sits still, so its own commit date under-reports on
 * exactly the page whose recrawl surfaces new entries. Only the page file is
 * scanned, not components it imports.
 */
function collectionsRead(sourcePath, collections) {
  const src = readPage(sourcePath);
  if (!src) return [];
  return [...src.matchAll(/getCollection\(\s*['"]([\w-]+)['"]/g)]
    .map((m) => m[1])
    .filter((name) => collections.has(name));
}

/**
 * Builds a @astrojs/sitemap `serialize` hook that stamps each URL with the
 * commit date of the content behind it. Returns undefined when git dates aren't
 * available, which leaves <lastmod> off rather than guessing.
 *
 * A single repo-wide date would restamp every URL on every deploy, which is the
 * pattern Google learns to ignore. Dates come per page, or not at all.
 *
 * @param {object} [options]
 * @param {string[]} [options.collections] Content collections rendered at
 *   /<collectionPrefix>/<collection>/<id>/ from src/content/<collection>/<id>.md.
 * @param {string} [options.collectionPrefix] First URL segment of those routes.
 * @param {string[]} [options.dataModules] src/data modules that hold page
 *   CONTENT. Leave out builders imported everywhere (a JSON-LD helper, say):
 *   counting one restamps the whole sitemap on any edit to it.
 */
export function gitLastmodSerializer({
  collections = [],
  collectionPrefix = 'library',
  dataModules = [],
} = {}) {
  const dates = gitDateMap();
  if (!dates) return undefined;

  const collectionSet = new Set(collections);
  const dataSet = new Set(dataModules);

  // Latest change anywhere in each collection, for the index pages that list them.
  const collectionLatest = new Map();
  for (const [path, date] of dates) {
    const match = path.match(/^src\/content\/([\w-]+)\//);
    if (!match) continue;
    const current = collectionLatest.get(match[1]);
    if (!current || date > current) collectionLatest.set(match[1], date);
  }

  return (item) => {
    const { pathname } = new URL(item.url);
    const source = sourcesFor(pathname, { collections: collectionSet, collectionPrefix })
      .find((candidate) => dates.has(candidate));
    if (!source) {
      console.warn(`[sitemap] No source file for ${pathname} — omitting <lastmod>.`);
      return item;
    }

    // All dates are UTC (see TZ above), so "later" is a plain string compare.
    let lastmod = dates.get(source);
    for (const dep of dataDepsOf(source, dataSet)) {
      const depDate = dates.get(dep);
      if (depDate && depDate > lastmod) lastmod = depDate;
    }
    for (const collection of collectionsRead(source, collectionSet)) {
      const latest = collectionLatest.get(collection);
      if (latest && latest > lastmod) lastmod = latest;
    }

    item.lastmod = lastmod;
    return item;
  };
}
