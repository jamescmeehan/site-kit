// schema.org node builders with no site in them. Each site keeps its own entity
// graph and passes ids in.

export const graph = (nodes) => ({ '@context': 'https://schema.org', '@graph': nodes });

export const breadcrumbList = (pageUrl, items) => ({
  '@type': 'BreadcrumbList',
  '@id': `${pageUrl}#breadcrumb`,
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    ...(it.url ? { item: it.url } : {}),
  })),
});

/**
 * A WebPage node. `image` is a URL, or ImageObject fields (url, contentUrl,
 * caption, width, height). `dateModified` is for pages bound to live data;
 * `datePublished` is set once and never bumped.
 */
export function webPage(opts) {
  const page = {
    '@type': opts.type ?? 'WebPage',
    '@id': opts.url,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    isPartOf: { '@id': opts.websiteId },
    inLanguage: opts.language ?? 'en-US',
  };
  if (opts.aboutId) page.about = { '@id': opts.aboutId };
  if (opts.mainEntityId) page.mainEntity = { '@id': opts.mainEntityId };
  if (opts.hasPartId) page.hasPart = { '@id': opts.hasPartId };
  if (opts.hasBreadcrumb) page.breadcrumb = { '@id': `${opts.url}#breadcrumb` };
  if (opts.datePublished) page.datePublished = opts.datePublished;
  if (opts.dateModified) page.dateModified = opts.dateModified;
  if (opts.mentions?.length) page.mentions = opts.mentions.map((id) => ({ '@id': id }));
  if (typeof opts.image === 'string') {
    page.primaryImageOfPage = { '@type': 'ImageObject', url: opts.image };
  } else if (opts.image) {
    page.primaryImageOfPage = { '@type': 'ImageObject', ...opts.image };
    if (typeof opts.image.url === 'string') page.image = opts.image.url;
  }
  return page;
}

/** An ItemList whose members reference entity or page @ids. */
export const itemList = (pageUrl, memberIds) => ({
  '@type': 'ItemList',
  '@id': `${pageUrl}#list`,
  numberOfItems: memberIds.length,
  itemListElement: memberIds.map((id, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: { '@id': id },
  })),
});

/**
 * A FAQPage nested under a content page at its #faq fragment. Render the visible
 * block from the same strings: Google only grants the result when the answer
 * appears on the page verbatim.
 */
export const faqPage = (pageUrl, questions) => ({
  '@type': 'FAQPage',
  '@id': `${pageUrl}#faq`,
  url: pageUrl,
  isPartOf: { '@id': pageUrl },
  mainEntity: questions.map((qa) => ({
    '@type': 'Question',
    name: qa.q,
    acceptedAnswer: { '@type': 'Answer', text: qa.a },
  })),
});
