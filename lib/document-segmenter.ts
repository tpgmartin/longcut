import { DocumentSegment, DocumentInfo, DocumentFileType } from '@/lib/types';

const TARGET_SEGMENT_CHARS = 800;
const MIN_SEGMENT_CHARS = 200;
const MAX_SEGMENT_CHARS = 1500;

interface ParsedDocument {
  text: string;
  title: string;
  author: string;
  pageCount?: number;
  chapterCount?: number;
  sections: { title: string; charStart: number; charEnd: number; pageNumber?: number }[];
}

// ── PDF parsing ──

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // Use legacy build for server-side (no worker needed)
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  let fullText = '';
  const sections: ParsedDocument['sections'] = [];
  let currentPage = 1;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .trim();

    if (pageText) {
      const charStart = fullText.length;
      if (fullText.length > 0) fullText += '\n\n';
      fullText += pageText;
      sections.push({
        title: `Page ${i}`,
        charStart,
        charEnd: fullText.length,
        pageNumber: i,
      });
    }
    currentPage = i;
  }

  // Try to extract title from metadata or first line
  const metadata = await doc.getMetadata().catch(() => null);
  const title =
    (metadata?.info as Record<string, string> | undefined)?.Title ||
    extractTitleFromText(fullText);
  const author =
    (metadata?.info as Record<string, string> | undefined)?.Author || '';

  return {
    text: fullText,
    title,
    author,
    pageCount: currentPage,
    sections,
  };
}

// ── EPUB parsing ──

async function parseEpub(buffer: Buffer): Promise<ParsedDocument> {
  const EPub = (await import('epub2')).default;

  const epub = await EPub.createAsync(buffer as unknown as string);

  let fullText = '';
  const sections: ParsedDocument['sections'] = [];
  let chapterCount = 0;

  const flow = epub.flow || [];

  for (const chapter of flow) {
    try {
      const chapterText = await new Promise<string>((resolve, reject) => {
        epub.getChapter(chapter.id, (err: Error | null, text: string) => {
          if (err) reject(err);
          else resolve(text || '');
        });
      });

      // Strip HTML tags
      const cleanText = chapterText
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanText.length > 0) {
        const charStart = fullText.length;
        if (fullText.length > 0) fullText += '\n\n';
        fullText += cleanText;
        chapterCount++;
        sections.push({
          title: chapter.title || `Chapter ${chapterCount}`,
          charStart,
          charEnd: fullText.length,
        });
      }
    } catch {
      // Skip chapters that fail to parse
    }
  }

  const title = epub.metadata?.title || extractTitleFromText(fullText);
  const author = epub.metadata?.creator || '';

  return {
    text: fullText,
    title,
    author,
    chapterCount,
    sections,
  };
}

// ── TXT parsing ──

function parseTxt(buffer: Buffer): ParsedDocument {
  const text = buffer.toString('utf-8');
  const sections: ParsedDocument['sections'] = [];

  // Try to detect sections from headings (lines in ALL CAPS or short lines followed by blank lines)
  const lines = text.split('\n');
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isHeading =
      line.length > 0 &&
      line.length < 80 &&
      (line === line.toUpperCase() ||
        (i + 1 < lines.length && lines[i + 1].trim() === ''));

    if (isHeading && line.length > 2) {
      sections.push({
        title: line,
        charStart: charOffset,
        charEnd: charOffset + lines[i].length,
      });
    }
    charOffset += lines[i].length + 1; // +1 for newline
  }

  const title = extractTitleFromText(text);
  return { text, title, author: '', sections };
}

// ── Segmentation ──

function extractTitleFromText(text: string): string {
  const firstLine = text.split(/\n/)[0]?.trim() || '';
  if (firstLine.length > 0 && firstLine.length < 200) {
    return firstLine;
  }
  return 'Untitled Document';
}

function findSectionForPosition(
  sections: ParsedDocument['sections'],
  charPos: number
): { title?: string; pageNumber?: number } {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (charPos >= sections[i].charStart) {
      return {
        title: sections[i].title,
        pageNumber: sections[i].pageNumber,
      };
    }
  }
  return {};
}

export function segmentDocument(
  text: string,
  sections: ParsedDocument['sections'] = []
): DocumentSegment[] {
  if (!text || text.trim().length === 0) return [];

  const segments: DocumentSegment[] = [];
  // Split into paragraphs
  const paragraphs = text.split(/\n\s*\n/);

  let charOffset = 0;
  let currentBuffer = '';
  let bufferStart = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    // Find the actual position in the original text
    const paraStart = text.indexOf(para, charOffset);
    if (paraStart === -1) {
      charOffset += para.length + 2;
      continue;
    }

    if (currentBuffer.length === 0) {
      bufferStart = paraStart;
    }

    if (currentBuffer.length > 0) currentBuffer += '\n\n';
    currentBuffer += para;

    const nextParaWouldExceed =
      i + 1 < paragraphs.length &&
      currentBuffer.length + paragraphs[i + 1].length > MAX_SEGMENT_CHARS;

    const isLastPara = i === paragraphs.length - 1;
    const isLongEnough = currentBuffer.length >= TARGET_SEGMENT_CHARS;

    if (isLastPara || isLongEnough || nextParaWouldExceed) {
      const trimmed = currentBuffer.trim();
      if (trimmed.length >= MIN_SEGMENT_CHARS || isLastPara) {
        const sectionInfo = findSectionForPosition(sections, bufferStart);
        segments.push({
          text: trimmed,
          charStart: bufferStart,
          charEnd: bufferStart + trimmed.length,
          sectionTitle: sectionInfo.title,
          pageNumber: sectionInfo.pageNumber,
        });
      } else if (trimmed.length > 0 && segments.length > 0) {
        // Merge short trailing text into previous segment
        const prev = segments[segments.length - 1];
        prev.text += '\n\n' + trimmed;
        prev.charEnd = bufferStart + trimmed.length;
      } else if (trimmed.length > 0) {
        const sectionInfo = findSectionForPosition(sections, bufferStart);
        segments.push({
          text: trimmed,
          charStart: bufferStart,
          charEnd: bufferStart + trimmed.length,
          sectionTitle: sectionInfo.title,
          pageNumber: sectionInfo.pageNumber,
        });
      }
      currentBuffer = '';
    }

    charOffset = paraStart + para.length;
  }

  return segments;
}

// ── Main entry point ──

export async function parseDocument(
  buffer: Buffer,
  fileName: string
): Promise<{ info: DocumentInfo; segments: DocumentSegment[]; fullText: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  let fileType: DocumentFileType;

  switch (ext) {
    case 'pdf':
      fileType = 'pdf';
      break;
    case 'epub':
      fileType = 'epub';
      break;
    case 'txt':
    case 'text':
      fileType = 'txt';
      break;
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }

  let parsed: ParsedDocument;

  switch (fileType) {
    case 'pdf':
      parsed = await parsePdf(buffer);
      break;
    case 'epub':
      parsed = await parseEpub(buffer);
      break;
    case 'txt':
      parsed = parseTxt(buffer);
      break;
  }

  const segments = segmentDocument(parsed.text, parsed.sections);
  const wordCount = parsed.text.split(/\s+/).filter(Boolean).length;
  const documentId = crypto.randomUUID();

  const info: DocumentInfo = {
    documentId,
    title: parsed.title,
    author: parsed.author,
    fileType,
    fileName,
    fileSize: buffer.length,
    wordCount,
    pageCount: parsed.pageCount,
    chapterCount: parsed.chapterCount,
  };

  return { info, segments, fullText: parsed.text };
}
