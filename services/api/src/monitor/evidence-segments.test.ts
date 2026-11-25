import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceSegments, resolveEvidenceSegment } from './evidence-segments.ts';
import type { SourceDocument } from './source-fetcher.ts';

function document(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    finalUrl: 'https://example.test/plan',
    contentType: 'text/html',
    text: '  First line.\n\nSecond\tline.  ',
    fingerprint: 'version-1',
    ...overrides,
  };
}

test('catalog trims excerpt edges but preserves source whitespace inside multiline excerpts', () => {
  const source = document({ text: '  First line.\nSecond\tline.  ' });
  const segments = buildEvidenceSegments([source]);
  assert.ok(segments.some(({ text }) => text === 'First line.'));
  assert.ok(segments.some(({ text }) => text === 'Second\tline.'));
  assert.ok(segments.some(({ text }) => text === 'First line.\nSecond\tline.'));
  const combined = segments.find(({ text }) => text === 'First line.\nSecond\tline.')!;
  const resolved = resolveEvidenceSegment([source], source.finalUrl, combined.id);
  assert.deepEqual(resolved, combined);
});

test('IDs are stable for exact source version and stale when content version changes', () => {
  const original = document();
  const id = buildEvidenceSegments([original])[0]!.id;
  assert.equal(buildEvidenceSegments([original])[0]!.id, id);
  assert.equal(resolveEvidenceSegment([document({ text: 'Changed source text.', fingerprint: 'version-2' })], original.finalUrl, id), null);
});

test('resolver rejects an ID paired with a different source URL', () => {
  const first = document();
  const second = document({ finalUrl: 'https://example.test/other' });
  const id = buildEvidenceSegments([first])[0]!.id;
  assert.equal(resolveEvidenceSegment([first, second], second.finalUrl, id), null);
});

test('catalog includes visible title, headings and link labels with bounded sentence excerpts', () => {
  const source = document({
    title: 'Visible title',
    headings: ['Heading one'],
    links: [{ url: 'https://example.test/file', label: 'Visible link label' }],
    text: `A complete sentence. ${'x'.repeat(1001)}.`,
  });
  const segments = buildEvidenceSegments([source], { maxCharsPerSegment: 1000 });
  assert.deepEqual(segments.map(({ text }) => text), ['Visible title', 'Heading one', 'A complete sentence.', 'Visible link label']);
  assert.ok(segments.every((segment) => segment.text.length <= 1000));
});

test('catalog honors total segment bound', () => {
  const source = document({ text: 'One.\nTwo.\nThree.' });
  assert.equal(buildEvidenceSegments([source], { maxSegments: 2 }).length, 2);
});

test('term selection can include relevant evidence late in a long source and retain document order', () => {
  const source = document({ text: `Opening unrelated line.\n${Array.from({ length: 40 }, (_, index) => `Unrelated line ${index}.`).join('\n')}\nSchool trip leaves at 09:00.` });
  const segments = buildEvidenceSegments([source], { maxSegments: 2, terms: ['school trip'] });
  assert.equal(segments[0]!.text, 'Opening unrelated line.');
  assert.match(segments[1]!.text, /School trip leaves at 09:00\.$/);
  assert.deepEqual(resolveEvidenceSegment([source], source.finalUrl, segments[1]!.id, { maxSegments: 2, terms: ['school trip'] }), segments[1]);
});

test('adjacent HTML and PDF lines produce exact bounded excerpts with heading, date, and action', () => {
  for (const contentType of ['text/html', 'application/pdf'] as const) {
    const source = document({ contentType, text: 'School trip\n20.09.2030\nBring boots and packed lunch.' });
    const segments = buildEvidenceSegments([source], { maxCharsPerSegment: 400, terms: ['school trip'] });
    const combined = segments.find((segment) => segment.text === 'School trip\n20.09.2030\nBring boots and packed lunch.');
    assert.ok(combined);
    assert.equal(resolveEvidenceSegment([source], source.finalUrl, combined.id, { maxCharsPerSegment: 400, terms: ['school trip'] })?.text, combined.text);
    assert.equal(resolveEvidenceSegment([document({ contentType, text: source.text, fingerprint: 'new-version' })], source.finalUrl, combined.id, { maxCharsPerSegment: 400, terms: ['school trip'] }), null);
    assert.equal(resolveEvidenceSegment([source], 'https://example.test/other', combined.id, { maxCharsPerSegment: 400, terms: ['school trip'] }), null);
  }
});

test('segment budget gives later opened sources a bounded share', () => {
  const first = document({ text: Array.from({ length: 80 }, (_, index) => `First source line ${index}.`).join('\n') });
  const second = document({ finalUrl: 'https://example.test/second', text: 'Important event on 2030-09-20.' });
  const segments = buildEvidenceSegments([first, second], { maxSegments: 24, maxCharsPerSegment: 400, terms: ['important event'] });
  assert.equal(segments.length, 24);
  assert.ok(segments.some((segment) => segment.sourceUrl === second.finalUrl && segment.text === second.text));
});
