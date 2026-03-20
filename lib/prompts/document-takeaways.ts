import { DocumentSegment, DocumentInfo } from '@/lib/types';

export function formatDocumentSegments(segments: DocumentSegment[]): string {
  return segments
    .map((segment) => {
      const location = segment.pageNumber
        ? `Page ${segment.pageNumber}`
        : segment.sectionTitle || `Chars ${segment.charStart}-${segment.charEnd}`;
      return `[${location}] ${segment.text}`;
    })
    .join('\n\n');
}

export function formatDocumentInfoBlock(
  documentInfo: Partial<DocumentInfo> = {}
): string {
  const lines: string[] = [
    `Title: ${documentInfo.title ?? 'Untitled document'}`,
  ];

  if (documentInfo.author) {
    lines.push(`Author: ${documentInfo.author}`);
  }

  if (documentInfo.wordCount) {
    lines.push(`Length: ~${documentInfo.wordCount.toLocaleString()} words`);
  }

  if (documentInfo.pageCount) {
    lines.push(`Pages: ${documentInfo.pageCount}`);
  }

  return lines.join('\n');
}

interface BuildDocumentTakeawaysPromptParams {
  segments: DocumentSegment[];
  documentInfo?: Partial<DocumentInfo>;
}

export function buildDocumentTakeawaysPrompt({
  segments,
  documentInfo,
}: BuildDocumentTakeawaysPromptParams): string {
  const documentText = formatDocumentSegments(segments);
  const infoBlock = formatDocumentInfoBlock(documentInfo);

  return `<task>
<role>You are an expert editorial analyst distilling a document's most potent insights for time-pressed readers.</role>
<context>
${infoBlock}
</context>
<goal>Produce 4-6 high-signal takeaways that help a reader retain the document's core ideas.</goal>
<instructions>
  <item>Only use information stated explicitly in the document. Never speculate.</item>
  <item>Make each label specific, punchy, and no longer than 10 words.</item>
  <item>Write each insight as 1-2 sentences that preserve the author's framing.</item>
  <item>Attach 1-2 location references (e.g., "Page 5" or "Section: Introduction") that point to the supporting passages.</item>
  <item>Favor contrarian viewpoints, concrete examples, data, or memorable stories over generic advice.</item>
  <item>Avoid overlapping takeaways. Each one should stand alone.</item>
</instructions>
<qualityControl>
  <item>Verify every claim is grounded in document text you can cite verbatim.</item>
  <item>Ensure locations map to the passages that justify the insight.</item>
  <item>If the document lacks enough high-quality insights, still return at least four by choosing the strongest available.</item>
</qualityControl>
<outputFormat>Return strict JSON with 4-6 objects: [{"label":"string","insight":"string","locations":["Page 5"]}]. Do not include markdown or commentary.</outputFormat>
<document><![CDATA[
${documentText}
]]></document>
</task>`;
}
