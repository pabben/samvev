import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceSegments } from './evidence-segments.ts';
import { parseSelectedAnswer } from './answer-selection.ts';
import type { SourceDocument } from './source-fetcher.ts';
import { aiTaskSchema } from '@samvev/contracts';
import { monitorAnswerSelectionResponseSchema } from './response-schemas.ts';

function doc(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    finalUrl: 'https://example.test/school', contentType: 'text/html',
    text: 'School trip leaves on 2030-09-20 at 09:00.', fingerprint: 'school-v1', evidenceComplete: true,
    ...overrides,
  };
}
function model(fields: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, outputLocale: 'nb', status: 'found', sourceUrl: 'https://example.test/school', segmentId: 'pending', date: '2030-09-20', confidence: 0.8, ...fields });
}
function validOutput(source = doc(), overrides: Record<string, unknown> = {}) {
  const segment = buildEvidenceSegments([source], { terms: ['school trip'] }).find((candidate) => candidate.text.includes('2030-09-20'))!;
  return model({ sourceUrl: source.finalUrl, segmentId: segment.id, ...overrides });
}
function parse(output: string, sources: SourceDocument[], terms: string[] = []) {
  const catalogOptions = { maxSegments: 24, maxCharsPerSegment: 400, terms };
  return parseSelectedAnswer(output, sources, { locale: 'nb', terms, segments: buildEvidenceSegments(sources, catalogOptions), catalogOptions });
}

test('the provider response contract fits the existing bounded AI task', () => {
  assert.doesNotThrow(() => aiTaskSchema.parse({ operation: 'extract', purpose: 'monitor_source_analysis', input: 'Select one source segment.', modelTier: 'strong', maxOutputTokens: 2048, responseSchema: monitorAnswerSelectionResponseSchema, sources: [] }));
});

test('returns server-owned answer and quote from a verified matching segment', () => {
  const source = doc({ publicEvidenceUrl: 'https://example.test/school' });
  const result = parse(validOutput(source), [source], ['school trip']);
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') {
    assert.equal(result.value.answer, source.text);
    assert.equal(result.value.evidence.quote, source.text);
    assert.equal(result.value.evidence.sourceUrl, source.publicEvidenceUrl);
  }
});

test('uses the same bounded excerpt for PDF text with line breaks and Norwegian date', () => {
  const source = doc({ contentType: 'application/pdf', text: 'Ukeplan\nTuren er 20.09.2030 kl. 09:00.', fingerprint: 'pdf-snapshot' });
  const segments = buildEvidenceSegments([source], { terms: ['turen'] });
  const selected = segments.find((segment) => segment.text.includes('20.09.2030'))!;
  const output = model({ sourceUrl: source.finalUrl, segmentId: selected.id, date: '2030-09-20' });
  const result = parse(output, [source], ['turen']);
  assert.equal(result.kind, 'answer');
  if (result.kind === 'answer') {
    assert.equal(result.value.evidence.quote, selected.text);
    assert.equal(result.value.evidence.quote, 'Ukeplan\nTuren er 20.09.2030 kl. 09:00.');
  }
});

test('date is optional, but a supplied date must exactly occur in supported source format', () => {
  const source = doc({ text: 'School trip leaves on 20.09.2030 at 09:00.' });
  const segment = buildEvidenceSegments([source], { terms: ['school trip'] })[0]!;
  assert.equal(parse(model({ sourceUrl: source.finalUrl, segmentId: segment.id, date: null }), [source], ['school trip']).kind, 'answer');
  assert.equal(parse(model({ sourceUrl: source.finalUrl, segmentId: segment.id, date: '2030-09-20' }), [source], ['school trip']).kind, 'answer');
  assert.throws(() => parse(model({ sourceUrl: source.finalUrl, segmentId: segment.id, date: '2030-09-21' }), [source], ['school trip']), (error: any) => error?.details?.validationReason === 'selection_date');
});

test('rejects invented, stale, and wrong-source segment IDs', () => {
  const source = doc();
  assert.throws(() => parse(model({ segmentId: 'invented' }), [source]));
  const real = buildEvidenceSegments([source])[0]!;
  assert.throws(() => parse(model({ sourceUrl: 'https://example.test/other', segmentId: real.id }), [source]));
  assert.throws(() => parse(validOutput(source), [doc({ text: 'Different on 2030-09-20.', fingerprint: 'school-v2' })], ['school trip']));
});

test('rejects dates absent from the selected excerpt and irrelevant selected excerpts', () => {
  const source = doc({ text: 'School trip leaves tomorrow.\nBring snacks.\nWear boots.\nAnother event is 2030-09-20.' });
  const id = buildEvidenceSegments([source], { terms: ['school trip'] })[0]!.id;
  assert.throws(() => parse(model({ segmentId: id }), [source], ['school trip']), (error: any) => error?.details?.validationReason === 'selection_date');
  const other = doc({ text: 'Assembly is on 2030-09-20.' });
  const otherId = buildEvidenceSegments([other], { terms: ['assembly'] })[0]!.id;
  assert.throws(() => parse(model({ sourceUrl: other.finalUrl, segmentId: otherId }), [other], ['school trip']), (error: any) => error?.details?.validationReason === 'selection_irrelevant');
});

test('strict model schema rejects extra answer or claim fields', () => {
  assert.equal(parse(validOutput(), [doc()]).kind, 'answer');
  assert.throws(() => parse(model({ sourceUrl: 'https://example.test/other', segmentId: 'invented' }), [doc()]), (error: any) => error?.details?.validationReason === 'selection_source');
  assert.throws(() => parse(validOutput(doc(), { answer: 'model invented text' }), [doc()]), (error: any) => error?.details?.validationReason === 'selection_schema');
  assert.throws(() => parse(validOutput(doc(), { quote: 'model invented quote' }), [doc()]), (error: any) => error?.details?.validationReason === 'selection_schema');
});

test('none is accepted only when all supplied evidence is complete', () => {
  const output = model({ status: 'none', sourceUrl: null, segmentId: null, date: null });
  assert.deepEqual(parse(output, [doc()]), { kind: 'none' });
  assert.throws(() => parse(output, [doc({ evidenceComplete: false })]));
  assert.throws(() => parse(output, []));
  assert.throws(() => parse(output, [doc(), doc({ finalUrl: 'https://example.test/second' })]));
});

test('a complete source can report no special finding even when generic topic words occur', () => {
  const source = doc();
  const output = model({ status: 'none', sourceUrl: null, segmentId: null, date: null });
  assert.deepEqual(parse(output, [source], ['school trip']), { kind: 'none' });
});

test('low confidence fails closed for both findings and none', () => {
  const source = doc();
  assert.throws(() => parse(validOutput(source, { confidence: 0.54 }), [source], ['school trip']), (error: any) => error?.details?.validationReason === 'selection_low_confidence');
  const none = model({ status: 'none', sourceUrl: null, segmentId: null, date: null, confidence: 0.54 });
  assert.throws(() => parse(none, [doc({ text: 'A complete source without a finding.', evidenceComplete: true })]), (error: any) => error?.details?.validationReason === 'selection_low_confidence');
});
