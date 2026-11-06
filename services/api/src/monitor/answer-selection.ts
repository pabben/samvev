import { z } from 'zod';
import { monitorAnswerSchema } from '@samvev/contracts';
import type { SourceDocument } from './source-fetcher.ts';
import { resolveEvidenceSegment, type EvidenceSegment } from './evidence-segments.ts';
import { validationError } from './validation-diagnostics.ts';

const modelAnswerSchema = z.object({
  version: z.literal(1),
  outputLocale: z.enum(['nb', 'en']),
  status: z.enum(['found', 'none']),
  sourceUrl: z.string().nullable(),
  segmentId: z.string().nullable(),
  date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export type SelectedAnswer = { kind: 'answer'; value: z.infer<typeof monitorAnswerSchema> } | { kind: 'none' };

function parseModelOutput(output: string): z.infer<typeof modelAnswerSchema> {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw selectionError('selection_invalid_json'); }
  const parsed = modelAnswerSchema.safeParse(value);
  if (!parsed.success) throw selectionError('selection_schema');
  return parsed.data;
}

function selectionError(reason: 'selection_invalid_json' | 'selection_schema' | 'selection_locale' | 'selection_source' | 'selection_stale' | 'selection_date' | 'selection_irrelevant' | 'selection_incomplete' | 'selection_low_confidence') {
  return validationError('AI_RESPONSE_INVALID', 502, 'evidence_selection', reason);
}

function dateInExcerpt(date: string, excerpt: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-');
  const variants = [date, `${day}.${month}.${year}`, `${day}/${month}/${year}`];
  return variants.some((variant) => excerpt.includes(variant));
}

function hasRelevantTerm(segment: EvidenceSegment, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = segment.text.normalize('NFKC').toLocaleLowerCase();
  return terms.some((raw) => {
    const term = raw.normalize('NFKC').trim().toLocaleLowerCase();
    if (!term) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, 'u').test(text);
  });
}

export function parseSelectedAnswer(
  output: string,
  evidenceDocuments: readonly SourceDocument[],
  options: { locale: 'nb' | 'en'; terms?: string[]; segments: EvidenceSegment[]; catalogOptions: { maxSegments: number; maxCharsPerSegment: number; terms?: string[] }; allowNone?: boolean },
): SelectedAnswer {
  const parsed = parseModelOutput(output);
  if (parsed.outputLocale !== options.locale) throw selectionError('selection_locale');
  if (parsed.confidence < 0.55) throw selectionError('selection_low_confidence');
  const requiredTerms = options.terms ?? [];
  if (parsed.status === 'none') {
    if (parsed.sourceUrl !== null || parsed.segmentId !== null || parsed.date !== null) throw selectionError('selection_source');
    // The repair session preloads one complete source. A multi-source catalogue is
    // enough to select a positive excerpt, but not to certify absence of findings.
    if (options.allowNone === false || evidenceDocuments.length !== 1 || evidenceDocuments[0]!.evidenceComplete !== true) throw selectionError('selection_incomplete');
    return { kind: 'none' };
  }

  if (!parsed.sourceUrl || !parsed.segmentId) throw selectionError('selection_source');
  const segment = options.segments.find((candidate) => candidate.id === parsed.segmentId && candidate.sourceUrl === parsed.sourceUrl);
  if (!segment) throw selectionError('selection_source');
  const current = resolveEvidenceSegment(evidenceDocuments, parsed.sourceUrl, parsed.segmentId, options.catalogOptions);
  if (!current || current.text !== segment.text || current.sourceFingerprint !== segment.sourceFingerprint) throw selectionError('selection_stale');
  const source = evidenceDocuments.find((candidate) => candidate.finalUrl === segment.sourceUrl && candidate.fingerprint === segment.sourceFingerprint);
  if (!source) throw selectionError('selection_stale');
  if (parsed.date !== null && !dateInExcerpt(parsed.date, segment.text)) throw selectionError('selection_date');
  if (!hasRelevantTerm(segment, requiredTerms)) throw selectionError('selection_irrelevant');

  const value = monitorAnswerSchema.parse({
    version: 1,
    answer: segment.text,
    evidence: { quote: segment.text, sourceUrl: source.publicEvidenceUrl ?? source.finalUrl },
    confidence: parsed.confidence,
    uncertainty: null,
  });
  return { kind: 'answer', value };
}
