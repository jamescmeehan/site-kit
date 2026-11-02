import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import { gitLastmodSerializer } from './lastmod.mjs';
import { stripComments } from './strip-comments.mjs';

/** The _headers rules every site wants, ahead of the site's own. */
export function baselineHeaders({ noindexHosts = [] } = {}) {
  return [
    '# site-kit baseline.',
    ...noindexHosts.flatMap((host) => [`https://${host}/*`, '  X-Robots-Tag: noindex']),
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/disable-tracking/*',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '',
  ].join('\n');
}

/**
 * The build setup the sites share, as one integration. It sets trailing slashes
 * and inline CSS, keeps Astro 7's compressHTML from gluing inline words together,
 * and adds the sitemap, comment stripping and the _headers baseline.
 *
 * @param {object} [options]
 * @param {Parameters<typeof gitLastmodSerializer>[0]} [options.lastmod]
 * @param {string[]} [options.sitemapExclude] URL substrings kept out of the sitemap.
 *   /disable-tracking/ is always excluded.
 * @param {string[]} [options.noindexHosts] Hosts that must stay out of search
 *   indexes, such as the project's pages.dev host.
 * @param {boolean} [options.inlineScripts] Also strip comments from inline scripts.
 */
export default function siteKit({
  lastmod,
  sitemapExclude = [],
  noindexHosts = [],
  inlineScripts = true,
} = {}) {
  const exclude = ['/disable-tracking/', ...sitemapExclude];
  return {
    name: 'site-kit',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          trailingSlash: 'always',
          compressHTML: true,
          build: { inlineStylesheets: 'always' },
          integrations: [
            sitemap({
              serialize: gitLastmodSerializer(lastmod),
              filter: (page) => !exclude.some((part) => page.includes(part)),
            }),
          ],
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);

        const pages = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.html'));
        let removed = 0;
        await Promise.all(pages.map(async (file) => {
          const path = join(root, file);
          const before = await readFile(path, 'utf8');
          const result = await stripComments(before, { inlineScripts });
          removed += result.removed;
          if (result.html !== before) await writeFile(path, result.html);
        }));
        logger.info(`Removed ${removed} comments from ${pages.length} pages`);

        const headers = join(root, '_headers');
        const own = await readFile(headers, 'utf8').catch(() => '');
        await writeFile(headers, baselineHeaders({ noindexHosts }) + own);
      },
    },
  };
}
