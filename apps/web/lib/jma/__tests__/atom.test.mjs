import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAtomFeed } from '../atom-core.mjs';

test('parseAtomFeed extracts entries', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <updated>2025-01-01T00:00:00Z</updated>
    <entry>
      <id>tag:jma.go.jp,2025:1</id>
      <title>Test &amp; One</title>
      <updated>2025-01-01T00:01:00Z</updated>
      <link rel="alternate" type="application/xml" href="https://example.test/1.xml" />
    </entry>
    <entry>
      <id>tag:jma.go.jp,2025:2</id>
      <title>Two</title>
      <published>2025-01-01T00:02:00Z</published>
      <link href="https://example.test/2.xml" />
    </entry>
  </feed>`;

  const parsed = parseAtomFeed(xml);
  assert.equal(parsed.updated, '2025-01-01T00:00:00Z');
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries[0], {
    id: 'tag:jma.go.jp,2025:1',
    title: 'Test & One',
    updated: '2025-01-01T00:01:00Z',
    published: null,
    link: 'https://example.test/1.xml',
  });
  assert.equal(parsed.entries[1].link, 'https://example.test/2.xml');
});

