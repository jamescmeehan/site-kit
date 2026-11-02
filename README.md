# site-kit

Build infrastructure shared by kinpine.com, donnerlakeinn.com and ninameehan.com.
Each site pins a tagged version, so a change reaches a site when that site updates.

```sh
npm i github:jamescmeehan/site-kit#v0.1.0
```

## What's here

| Piece | Use |
| --- | --- |
| `site-kit-unshallow` | `"prebuild"` script. Restores git history on Cloudflare Pages. |
| `gitLastmodSerializer()` | From `@jamescmeehan/site-kit/lastmod`, as the sitemap's `serialize`. |
| `site-kit-validate-schema` | Checks the built JSON-LD graph. Options are at the top of the file. |
| `site-kit-compare-builds` | Compares two `dist/` folders page by page. |

## Rules

- **Nothing site-specific.** No brand names, domains, zone IDs, GTM IDs or listing IDs.
  This repo is public, and sites pass those in.
- **No Tailwind classes in components.** Tailwind skips `node_modules`, and adding an
  `@source` for this package would turn words in its comments into shipped CSS.
  Sites pass classes in through props.
- **No `import.meta.url` file paths in code that Astro bundles.** Bundling moves the
  module, and the wrong path usually fails silently. Resolve from `process.cwd()`.

## Releasing

Before bumping a site, build it on the old version, then compare:

```sh
site-kit-compare-builds ../before-dist ./dist --ignore-key dateModified
```

A passing build isn't enough. Astro 7 silently dropped most `<source>` tags from one
homepage and put `/undefined/` URLs in another site's JSON-LD, and both builds exited 0.
