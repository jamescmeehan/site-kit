#!/usr/bin/env node
// Cloudflare Pages clones at a single commit (`git fetch <sha>`), so the build
// container has no history. lastmod.mjs needs per-file commit dates to stamp
// <lastmod> in the sitemap, and correctly refuses to guess from a shallow clone
// — which left the sitemap with no dates at all.
//
// Run it as npm's `prebuild` hook, so it happens automatically before `astro
// build`. On a complete clone (any local build) git exits non-zero immediately
// without touching the network, and this no-ops.
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

try {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'true') {
    process.exit(0);
  }
} catch {
  // No git at all (e.g. a source tarball). Nothing to deepen; the sitemap will
  // omit <lastmod> on its own.
  process.exit(0);
}

try {
  git(['fetch', '--unshallow']);
  const commits = git(['rev-list', '--count', 'HEAD']);
  console.log(`[unshallow] Fetched full history (${commits} commits) for sitemap <lastmod>.`);
} catch (err) {
  console.warn(
    `[unshallow] Could not deepen the clone (${err.message.trim().split('\n').pop()}). ` +
      'The sitemap will omit <lastmod>.'
  );
}
