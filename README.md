# site-kit

Build infrastructure shared by kinpine.com, donnerlakeinn.com and ninameehan.com.
Each site pins a tagged version, so a change reaches a site when that site updates.

```sh
npm i github:jamescmeehan/site-kit#v0.2.0
```

## What's here

| Piece | Use |
| --- | --- |
| `site-kit-unshallow` | `"prebuild"` script. Restores git history on Cloudflare Pages. |
| `gitLastmodSerializer()` | From `@jamescmeehan/site-kit/lastmod`, as the sitemap's `serialize`. |
| `site-kit-validate-schema` | Checks the built JSON-LD graph. Options are at the top of the file. |
| `site-kit-compare-builds` | Compares two `dist/` folders page by page. |
| `siteKit()` | The integration, from the package root: sitemap, comment stripping, inline CSS, `compressHTML`, `_headers` baseline. |
| `SeoHead`, `Gtm`, `GtmNoscript` | Unstyled components under `@jamescmeehan/site-kit/components/`. |
| `./jsonld`, `./faq`, `./llms` | Helpers for schema, FAQ text and llms.txt. |
| `./opt-out` | Drives a `/disable-tracking/` page. |
| `./forms` | Lead form handler for Pages Functions. |
| `./lodging` | Date and holiday logic for the lodging sites. |

## Rules

- **Nothing site-specific.** No brand names, domains, zone IDs, GTM IDs or listing IDs.
  This repo is public, and sites pass those in.
- **No Tailwind classes in this package, including default arguments.** Tailwind skips
  `node_modules`, and adding an `@source` for this package would turn words in its
  comments into shipped CSS. Sites pass classes in, so Tailwind sees them in site code.
- **No `import.meta.url` file paths in code that Astro bundles.** Bundling moves the
  module, and the wrong path usually fails silently. Resolve from `process.cwd()`.

## Releasing

`site-kit-compare-builds` skips `<style>`, so also diff the inline CSS when a site
adopts something new. Moving a file out of `src/` moves its class names out of
Tailwind's view, and nothing else reports that.

Before bumping a site, build it on the old version, then compare:

```sh
site-kit-compare-builds ../before-dist ./dist --ignore-key dateModified
```

A passing build isn't enough. Astro 7 silently dropped most `<source>` tags from one
homepage and put `/undefined/` URLs in another site's JSON-LD, and both builds exited 0.
