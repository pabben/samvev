import { createHash } from 'node:crypto';
import type { SourceDocument } from './source-fetcher.ts';

export interface EvidenceSegment {
  id: string;
  sourceUrl: string;
  sourceFingerprint: string;
  text: string;
}

export interface EvidenceSegmentOptions {
  maxSegments?: number;
  maxCharsPerSegment?: number;
  terms?: string[];
}

const DEFAULT_MAX_SEGMENTS = 64;
const DEFAULT_MAX_CHARS = 280;

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

interface Excerpt { text: string; candidateIndex: number; lineStart: number; lineEnd: number; }

function excerpts(source: SourceDocument, maxChars: number): Excerpt[] {
  const candidates = [source.title ?? '', ...(source.headings ?? []), source.text, ...(source.links ?? []).map((link) => link.label)];
  const result: Excerpt[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex]!;
    if (!candidate.trim()) continue;
    // Prefer whole lines and then split long lines at whitespace boundaries. Returned text
    // remains an exact excerpt of the source field; whitespace is never synthesized.
    const lines = candidate.split('\n');
    // Interleave single lines and 2–3 line windows by their starting position, retaining
    // the original separators and internal spacing in every multiline excerpt.
    for (let start = 0; start < lines.length; start++) {
      for (const count of [1, 2, 3]) {
        if (start + count > lines.length) continue;
        const excerpt = lines.slice(start, start + count).join('\n').trim();
        if (!excerpt) continue;
        if (excerpt.length <= maxChars) {
          result.push({ text: excerpt, candidateIndex, lineStart: start, lineEnd: start + count });
          continue;
        }
        if (count !== 1) continue;
        // Oversized lines are retained only as complete sentence excerpts. Any sentence
        // longer than the bound is omitted rather than cut in a way that alters meaning.
        const sentences = excerpt.match(/[^.!?]+(?:[.!?]+(?:["')\]]*)|$)/g) ?? [];
        for (const sentence of sentences) {
          const completeSentence = sentence.trim();
          if (completeSentence && completeSentence.length <= maxChars) result.push({ text: completeSentence, candidateIndex, lineStart: start, lineEnd: start + 1 });
        }
      }
    }
  }
  return result;
}

function segmentId(source: SourceDocument, text: string, ordinal: number): string {
  const digest = createHash('sha256')
    .update('samvev-evidence-segment-v1\0')
    .update(source.finalUrl).update('\0')
    .update(source.fingerprint).update('\0')
    .update(source.contentType).update('\0')
    .update(String(ordinal)).update('\0')
    .update(text)
    .digest('base64url');
  return `ev1_${digest}`;
}

export function buildEvidenceSegments(
  documents: readonly SourceDocument[],
  options: EvidenceSegmentOptions = {},
): EvidenceSegment[] {
  const maxSegments = boundedInteger(options.maxSegments, DEFAULT_MAX_SEGMENTS, 512);
  const maxChars = boundedInteger(options.maxCharsPerSegment, DEFAULT_MAX_CHARS, 1000);
  const normalizedTerms = [...new Set((options.terms ?? []).filter((term) => typeof term === 'string').map((term) => term.normalize('NFKC').trim().toLocaleLowerCase()).filter(Boolean))];
  const ranked = documents.map((source) => excerpts(source, maxChars)
    .map((excerpt, ordinal) => ({ ...excerpt, ordinal, relevant: normalizedTerms.some((term) => excerpt.text.normalize('NFKC').toLocaleLowerCase().includes(term)) }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || (b.relevant ? (b.lineEnd - b.lineStart) - (a.lineEnd - a.lineStart) : 0) || a.ordinal - b.ordinal));
  // Round-robin source allocation prevents a large first document from consuming the
  // entire cap. Within each source, relevance wins; final output returns to source order.
  const chosen = ranked.map(() => [] as Array<{ text: string; ordinal: number; candidateIndex: number; lineStart: number; lineEnd: number }>);
  let total = 0;
  for (let rank = 0; total < maxSegments; rank++) {
    let selectedAtRank = false;
    for (let sourceIndex = 0; sourceIndex < ranked.length && total < maxSegments; sourceIndex++) {
      const candidate = ranked[sourceIndex]![rank];
      if (!candidate) continue;
      selectedAtRank = true;
      const overlaps = chosen[sourceIndex]!.some((prior) => {
        if (prior.candidateIndex !== candidate.candidateIndex || prior.lineStart >= candidate.lineEnd || candidate.lineStart >= prior.lineEnd) return false;
        const priorWindow = prior.lineEnd - prior.lineStart > 1;
        return normalizedTerms.length > 0 && priorWindow;
      });
      if (overlaps) continue;
      chosen[sourceIndex]!.push(candidate);
      total++;
    }
    if (!selectedAtRank) break;
  }
  const segments: EvidenceSegment[] = [];
  documents.forEach((source, sourceIndex) => {
    for (const { text, ordinal } of chosen[sourceIndex]!.sort((a, b) => a.ordinal - b.ordinal)) {
      segments.push({ id: segmentId(source, text, ordinal), sourceUrl: source.finalUrl, sourceFingerprint: source.fingerprint, text });
    }
  });
  return segments;
}

export function resolveEvidenceSegment(
  documents: readonly SourceDocument[],
  sourceUrl: string,
  id: string,
  options: EvidenceSegmentOptions = {},
): EvidenceSegment | null {
  const match = buildEvidenceSegments(documents, options).find((segment) => segment.sourceUrl === sourceUrl && segment.id === id);
  return match ?? null;
}
