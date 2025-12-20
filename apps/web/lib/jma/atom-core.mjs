function decodeXml(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractTagText(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  if (!match) return null;
  return decodeXml(match[1].trim());
}

function extractLinkHref(entryXml) {
  const linkTags = [...entryXml.matchAll(/<link\b[^>]*\/?>/gi)].map((m) => m[0]);
  if (linkTags.length === 0) return null;

  const pickHref = (tag) => {
    const m = tag.match(/\bhref=(["'])(.*?)\1/i);
    return m?.[2] ?? null;
  };

  const preferred = linkTags.find(
    (tag) => /\brel=(["'])alternate\1/i.test(tag) || /\btype=(["'])application\/xml\1/i.test(tag)
  );
  return pickHref(preferred ?? linkTags[0]);
}

export function parseAtomFeed(xml) {
  const feedUpdated = extractTagText(xml, 'updated');
  const entries = [];

  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  for (const match of xml.matchAll(entryRe)) {
    const block = match[1];
    const id = extractTagText(block, 'id');
    const title = extractTagText(block, 'title');
    if (!id || !title) continue;

    entries.push({
      id,
      title,
      updated: extractTagText(block, 'updated'),
      published: extractTagText(block, 'published'),
      link: extractLinkHref(block),
    });
  }

  return { updated: feedUpdated, entries };
}

