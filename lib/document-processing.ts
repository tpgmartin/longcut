import {
  DocumentSegment,
  DocumentTopic,
  DocumentInfo,
} from '@/lib/types';
import {
  normalizeWhitespace,
  buildTranscriptIndex,
  findTextInTranscript,
} from '@/lib/quote-matcher';
import { generateAIResponse } from '@/lib/ai-client';
import { documentTopicGenerationSchema } from '@/lib/schemas';
import { repairJson } from '@/lib/json-utils';
import { z } from 'zod';

interface ParsedDocumentTopic {
  title: string;
  quote?: {
    location: string;
    text: string;
  };
}

const DEFAULT_AI_MODEL =
  process.env.AI_DEFAULT_MODEL ?? process.env.AI_MODEL;
const FAST_MODEL_DEFAULT =
  process.env.AI_FAST_MODEL ?? DEFAULT_AI_MODEL;

const CHUNK_CHARS = 5000;
const CHUNK_OVERLAP = 500;
const CHUNK_MAX_CANDIDATES = 2;

interface DocumentChunk {
  id: string;
  charStart: number;
  charEnd: number;
  segments: DocumentSegment[];
  text: string;
}

interface CandidateDocTopic extends ParsedDocumentTopic {
  sourceChunkId: string;
  chunkCharStart: number;
  chunkCharEnd: number;
}

interface GenerateDocumentTopicsOptions {
  documentInfo?: Partial<DocumentInfo>;
  fastModel?: string;
  maxTopics?: number;
  theme?: string;
  language?: string;
}

// ── Chunking ──

function chunkDocumentSegments(segments: DocumentSegment[]): DocumentChunk[] {
  if (segments.length === 0) return [];

  const chunks: DocumentChunk[] = [];
  let chunkStart = 0;
  let currentSegments: DocumentSegment[] = [];
  let currentText = '';

  for (const segment of segments) {
    currentSegments.push(segment);
    if (currentText.length > 0) currentText += '\n\n';
    currentText += segment.text;

    if (currentText.length >= CHUNK_CHARS) {
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        charStart: currentSegments[0].charStart,
        charEnd: segment.charEnd,
        segments: [...currentSegments],
        text: currentText,
      });

      // Overlap: keep trailing segments that fit within CHUNK_OVERLAP chars
      const overlapSegments: DocumentSegment[] = [];
      let overlapLen = 0;
      for (let i = currentSegments.length - 1; i >= 0; i--) {
        overlapLen += currentSegments[i].text.length;
        if (overlapLen > CHUNK_OVERLAP) break;
        overlapSegments.unshift(currentSegments[i]);
      }
      currentSegments = overlapSegments;
      currentText = overlapSegments.map((s) => s.text).join('\n\n');
      chunkStart = overlapSegments[0]?.charStart ?? segment.charEnd;
    }
  }

  // Remaining segments
  if (currentSegments.length > 0 && currentText.trim().length > 0) {
    // Merge with last chunk if too small
    if (currentText.length < CHUNK_CHARS / 3 && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1];
      lastChunk.segments = [...lastChunk.segments, ...currentSegments.filter(
        (s) => !lastChunk.segments.includes(s)
      )];
      lastChunk.text = lastChunk.segments.map((s) => s.text).join('\n\n');
      lastChunk.charEnd = currentSegments[currentSegments.length - 1].charEnd;
    } else {
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        charStart: currentSegments[0].charStart,
        charEnd: currentSegments[currentSegments.length - 1].charEnd,
        segments: currentSegments,
        text: currentText,
      });
    }
  }

  return chunks;
}

// ── Prompts ──

function formatDocInfoForPrompt(info?: Partial<DocumentInfo>): string {
  if (!info) return 'Unknown document';
  const parts: string[] = [];
  if (info.title) parts.push(`Title: ${info.title}`);
  if (info.author) parts.push(`Author: ${info.author}`);
  return parts.length > 0 ? parts.join('\n') : 'Unknown document';
}

function formatChunkLocation(chunk: DocumentChunk): string {
  const firstSeg = chunk.segments[0];
  const lastSeg = chunk.segments[chunk.segments.length - 1];
  if (firstSeg?.pageNumber && lastSeg?.pageNumber) {
    return firstSeg.pageNumber === lastSeg.pageNumber
      ? `Page ${firstSeg.pageNumber}`
      : `Pages ${firstSeg.pageNumber}-${lastSeg.pageNumber}`;
  }
  if (firstSeg?.sectionTitle) {
    return `Section: ${firstSeg.sectionTitle}`;
  }
  return `Chars ${chunk.charStart}-${chunk.charEnd}`;
}

function buildDocChunkPrompt(
  chunk: DocumentChunk,
  maxCandidates: number,
  documentInfo?: Partial<DocumentInfo>,
  theme?: string
): string {
  const infoBlock = formatDocInfoForPrompt(documentInfo);
  const locationLabel = formatChunkLocation(chunk);
  const themeInstruction = theme
    ? `  <item>Focus exclusively on material that clearly expresses the theme "${theme}". Skip anything unrelated.</item>\n`
    : '';

  return `<task>
<role>You are an expert content strategist reviewing a portion of a document.</role>
<context>
${infoBlock}
Document section: ${locationLabel}
</context>
<goal>Identify up to ${maxCandidates} compelling highlight ideas that originate entirely within this document section.</goal>
<instructions>
  <item>Only use content from this section. If nothing stands out, return an empty list.</item>
  <item>Each highlight must include a punchy, specific title (max 10 words) and a contiguous quote of 2-5 sentences.</item>
  <item>Write titles as concise statements (avoid question marks unless the quoted passage is a question).</item>
  <item>Quote text must match the document exactly—no paraphrasing, ellipses, or stitching from multiple places.</item>
  <item>Include a location reference (e.g., "Page 5" or "Section: Introduction") for each quote.</item>
  <item>Focus on contrarian insights, vivid stories, or data-backed arguments that could stand alone.</item>
${themeInstruction}</instructions>
<outputFormat>Return strict JSON: [{"title":"string","quote":{"location":"Page N or Section name","text":"exact document text"}}]</outputFormat>
<documentSection><![CDATA[
${chunk.text}
]]></documentSection>
</task>`;
}

function buildDocReducePrompt(
  candidates: CandidateDocTopic[],
  maxTopics: number,
  documentInfo?: Partial<DocumentInfo>,
  minTopics: number = 0
): string {
  const infoBlock = formatDocInfoForPrompt(documentInfo);
  const safeMin = Math.max(0, Math.min(minTopics, maxTopics));
  const selectionGuidance =
    safeMin > 0
      ? `Return between ${safeMin} and ${maxTopics} standout highlights.`
      : `Return up to ${maxTopics} standout highlights that maximize diversity, insight, and narrative punch.`;

  const candidateBlock = candidates
    .map((candidate, idx) => {
      const location = candidate.quote?.location ?? 'Unknown';
      const quoteText = candidate.quote?.text ?? '';
      return `Candidate ${idx + 1}
Location: ${location}
Original title: ${candidate.title}
Quote text: ${quoteText}`;
    })
    .join('\n\n');

  return `<task>
<role>You are a senior editorial strategist assembling the final highlight lineup from a document.</role>
<context>
${infoBlock}
You have ${candidates.length} candidate quotes extracted from the document.
</context>
<goal>Choose the strongest highlights from the document.</goal>
<instructions>
  <item>${selectionGuidance}</item>
  <item>Review the candidates and choose the strongest, most distinct ideas.</item>
  <item>If two candidates overlap, keep the better one.</item>
  <item>You may rewrite titles for clarity, but you must keep the quote text and location as provided.</item>
  <item>Respond with strict JSON: [{"candidateIndex":number,"title":"string"}]. Indices are 1-based.</item>
</instructions>
<candidates><![CDATA[
${candidateBlock}
]]></candidates>
</task>`;
}

// ── Single-pass generation ──

async function runSinglePassDocumentTopics(
  fullText: string,
  segments: DocumentSegment[],
  model?: string,
  documentInfo?: Partial<DocumentInfo>,
  theme?: string
): Promise<ParsedDocumentTopic[]> {
  const formattedText = segments
    .map((s) => {
      const loc = s.pageNumber
        ? `Page ${s.pageNumber}`
        : s.sectionTitle || `Chars ${s.charStart}-${s.charEnd}`;
      return `[${loc}] ${s.text}`;
    })
    .join('\n\n');

  const infoBlock = formatDocInfoForPrompt(documentInfo);
  const themeGuidance = theme
    ? `<themeAlignment>
  <criterion name="ThemeRelevance">Every highlight must directly reinforce the theme "${theme}". Discard compelling ideas if they are off-theme.</criterion>
</themeAlignment>`
    : '';

  const prompt = `<task>
<role>You are an expert content strategist.</role>
<goal>Analyze the provided document and create between one and five distinct highlights that let a busy reader absorb the document's most valuable insights quickly.</goal>
<audience>The audience is forward-thinking and curious. They expect contrarian insights, actionable mental models, and bold ideas rather than generic advice.</audience>
<context>
${infoBlock}
</context>
<instructions>
  <step name="IdentifyThemes">
    <description>Surface no more than five high-value, thought-provoking themes from the document.</description>
    <themeCriteria>
      <criterion name="Insightful">Challenge a common assumption or reframe a known concept.</criterion>
      <criterion name="Specific">Avoid vague or catch-all wording.</criterion>
      <criterion name="LengthLimit">Keep titles to a maximum of 10 words.</criterion>
      <criterion name="Distribution">Ensure topics are distributed throughout the document — beginning, middle, and end.</criterion>
    </themeCriteria>
  </step>
  <step name="SelectPassage">
    <description>For each theme, pick the single most representative passage (2-5 sentences).</description>
    <passageCriteria>
      <criterion name="DirectQuotes">Return verbatim text only—no summaries or paraphrasing.</criterion>
      <criterion name="SelfContained">Ensure the passage stands alone.</criterion>
      <criterion name="HighSignal">Prefer memorable stories, data points, specific examples, or contrarian thinking.</criterion>
    </passageCriteria>
  </step>
</instructions>
${themeGuidance}
<outputFormat>Respond with strict JSON: [{"title":"string","quote":{"location":"Page N or Section name","text":"exact quoted text"}}]</outputFormat>
<document><![CDATA[
${formattedText}
]]></document>
</task>`;

  try {
    const response = await generateAIResponse(prompt, {
      preferredModel: model,
      temperature: 0.7,
      zodSchema: documentTopicGenerationSchema,
    });

    if (!response) return [];

    let parsed: ParsedDocumentTopic[];
    try {
      parsed = JSON.parse(response);
    } catch {
      try {
        parsed = JSON.parse(repairJson(response));
      } catch {
        return [];
      }
    }

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Single-pass document topic generation failed:', error);
    return [];
  }
}

// ── Chunked generation ──

async function extractChunkCandidates(
  chunk: DocumentChunk,
  maxCandidates: number,
  model?: string,
  documentInfo?: Partial<DocumentInfo>,
  theme?: string
): Promise<CandidateDocTopic[]> {
  const prompt = buildDocChunkPrompt(chunk, maxCandidates, documentInfo, theme);

  try {
    const response = await generateAIResponse(prompt, {
      preferredModel: model,
      temperature: 0.6,
      zodSchema: documentTopicGenerationSchema,
    });

    if (!response) return [];

    let parsed: ParsedDocumentTopic[];
    try {
      parsed = JSON.parse(response);
    } catch {
      try {
        parsed = JSON.parse(repairJson(response));
      } catch {
        return [];
      }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((t) => t.title && t.quote?.text)
      .map((t) => ({
        ...t,
        sourceChunkId: chunk.id,
        chunkCharStart: chunk.charStart,
        chunkCharEnd: chunk.charEnd,
      }));
  } catch (error) {
    console.error(`Error extracting candidates from ${chunk.id}:`, error);
    return [];
  }
}

function dedupeDocCandidates(candidates: CandidateDocTopic[]): CandidateDocTopic[] {
  const seen = new Set<string>();
  const result: CandidateDocTopic[] = [];

  for (const candidate of candidates) {
    if (!candidate.quote?.text) continue;
    const key = `${candidate.quote.location}|${normalizeWhitespace(candidate.quote.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

async function reduceDocCandidates(
  candidates: CandidateDocTopic[],
  options: {
    minTopics: number;
    maxTopics: number;
    model?: string;
    documentInfo?: Partial<DocumentInfo>;
  }
): Promise<ParsedDocumentTopic[]> {
  if (!candidates || candidates.length === 0) return [];

  const constrainedMax = Math.min(options.maxTopics, candidates.length);
  if (constrainedMax <= 0) return [];

  const constrainedMin = Math.min(options.minTopics, constrainedMax);
  const prompt = buildDocReducePrompt(
    candidates,
    constrainedMax,
    options.documentInfo,
    constrainedMin
  );

  const selectionSchema = z
    .array(z.object({ candidateIndex: z.number().int().min(1), title: z.string().min(1).max(120) }))
    .max(constrainedMax);

  try {
    const response = await generateAIResponse(prompt, {
      preferredModel: options.model,
      temperature: 0.4,
      zodSchema: selectionSchema,
    });

    if (!response) return [];

    let selections: Array<{ candidateIndex: number; title: string }> = [];
    try {
      selections = JSON.parse(response);
    } catch {
      return candidates.slice(0, constrainedMin).map((c) => ({ title: c.title, quote: c.quote }));
    }

    const usedIndices = new Set<number>();
    const result: ParsedDocumentTopic[] = [];

    for (const sel of selections) {
      const idx = sel.candidateIndex - 1;
      if (idx < 0 || idx >= candidates.length || usedIndices.has(idx)) continue;
      const c = candidates[idx];
      if (!c.quote?.text) continue;
      result.push({ title: sel.title?.trim() || c.title, quote: c.quote });
      usedIndices.add(idx);
      if (result.length >= constrainedMax) break;
    }

    if (result.length === 0 && constrainedMin > 0) {
      return candidates.slice(0, constrainedMin).map((c) => ({ title: c.title, quote: c.quote }));
    }

    return result;
  } catch (error) {
    console.error('Error reducing document candidates:', error);
    return candidates.slice(0, constrainedMin).map((c) => ({ title: c.title, quote: c.quote }));
  }
}

// ── Quote matching for documents ──

function findDocumentQuotes(
  segments: DocumentSegment[],
  parsedTopics: ParsedDocumentTopic[]
): DocumentTopic[] {
  // Convert DocumentSegments to TranscriptSegment-like objects for quote-matcher compatibility
  const transcriptLike = segments.map((s) => ({
    text: s.text,
    start: s.charStart,
    duration: s.charEnd - s.charStart,
  }));

  const index = buildTranscriptIndex(transcriptLike);
  const topics: DocumentTopic[] = [];

  for (let i = 0; i < parsedTopics.length; i++) {
    const parsed = parsedTopics[i];
    if (!parsed.quote?.text) continue;

    const quoteText = parsed.quote.text.trim();
    const match = findTextInTranscript(transcriptLike, quoteText, index, {
      strategy: 'all',
      minSimilarity: 0.8,
      maxSegmentWindow: 20,
    });

    if (match) {
      const startSeg = transcriptLike[match.startSegmentIdx];
      const endSeg = transcriptLike[match.endSegmentIdx];
      topics.push({
        id: `doc-topic-${i + 1}`,
        title: parsed.title,
        segments: [
          {
            charStart: startSeg.start,
            charEnd: endSeg.start + endSeg.duration,
            text: quoteText,
            segmentIdx: match.startSegmentIdx,
            endSegmentIdx: match.endSegmentIdx,
            startCharOffset: match.startCharOffset,
            endCharOffset: match.endCharOffset,
            confidence: match.similarity,
          },
        ],
        quote: parsed.quote,
      });
    } else {
      // Fallback: use the full text but without precise segment mapping
      topics.push({
        id: `doc-topic-${i + 1}`,
        title: parsed.title,
        segments: [],
        quote: parsed.quote,
      });
    }
  }

  return topics;
}

// ── Main entry point ──

export async function generateDocumentTopics(
  segments: DocumentSegment[],
  fullText: string,
  options: GenerateDocumentTopicsOptions = {}
): Promise<{ topics: DocumentTopic[] }> {
  const {
    documentInfo,
    fastModel = FAST_MODEL_DEFAULT,
    maxTopics = 5,
    theme,
  } = options;

  const totalChars = fullText.length;
  let parsedTopics: ParsedDocumentTopic[] = [];

  // Use single-pass for short documents, chunked for long ones
  if (totalChars < 15000) {
    parsedTopics = await runSinglePassDocumentTopics(
      fullText,
      segments,
      fastModel,
      documentInfo,
      theme
    );
  } else {
    // Chunked approach
    const chunks = chunkDocumentSegments(segments);

    const chunkResults = await Promise.allSettled(
      chunks.map((chunk) =>
        extractChunkCandidates(chunk, CHUNK_MAX_CANDIDATES, fastModel, documentInfo, theme)
      )
    );

    let candidates: CandidateDocTopic[] = [];
    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        candidates.push(...result.value);
      }
    }

    candidates = dedupeDocCandidates(candidates);

    if (candidates.length <= maxTopics) {
      parsedTopics = candidates.map((c) => ({ title: c.title, quote: c.quote }));
    } else {
      // Split candidates into first 3/5 and last 2/5
      const splitIdx = Math.ceil((candidates.length * 3) / 5);
      const firstHalf = candidates.slice(0, splitIdx);
      const secondHalf = candidates.slice(splitIdx);

      const [first, second] = await Promise.allSettled([
        reduceDocCandidates(firstHalf, {
          minTopics: 2,
          maxTopics: 3,
          model: fastModel,
          documentInfo,
        }),
        reduceDocCandidates(secondHalf, {
          minTopics: 1,
          maxTopics: 2,
          model: fastModel,
          documentInfo,
        }),
      ]);

      if (first.status === 'fulfilled') parsedTopics.push(...first.value);
      if (second.status === 'fulfilled') parsedTopics.push(...second.value);
    }
  }

  if (parsedTopics.length === 0 && !theme) {
    // Fallback: create basic section-based topics
    const sectionCount = Math.min(5, segments.length);
    const step = Math.max(1, Math.floor(segments.length / sectionCount));
    for (let i = 0; i < sectionCount; i++) {
      const seg = segments[Math.min(i * step, segments.length - 1)];
      parsedTopics.push({
        title: seg.sectionTitle || `Section ${i + 1}`,
        quote: {
          location: seg.pageNumber ? `Page ${seg.pageNumber}` : `Section ${i + 1}`,
          text: seg.text.substring(0, 200),
        },
      });
    }
  }

  const topics = findDocumentQuotes(segments, parsedTopics);
  return { topics };
}
