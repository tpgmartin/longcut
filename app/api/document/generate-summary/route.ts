import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { RATE_LIMITS } from '@/lib/rate-limiter';
import { generateAIResponse } from '@/lib/ai-client';
import { documentTakeawaysSchema } from '@/lib/schemas';
import { buildDocumentTakeawaysPrompt } from '@/lib/prompts/document-takeaways';
import { safeJsonParse } from '@/lib/json-utils';
import { DocumentSegment, DocumentInfo } from '@/lib/types';

type StructuredDocTakeaway = {
  label: string;
  insight: string;
  locations: string[];
};

const TAKEAWAYS_HEADING = '## Key takeaways';

function normalizeDocTakeawaysPayload(payload: unknown): StructuredDocTakeaway[] {
  const candidateArray = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>)?.takeaways)
      ? (payload as Record<string, unknown>).takeaways as unknown[]
      : [];

  const normalized: StructuredDocTakeaway[] = [];

  for (const item of candidateArray) {
    let parsedItem = item;
    if (typeof item === 'string') {
      try { parsedItem = JSON.parse(item); } catch { continue; }
    }

    if (!parsedItem || typeof parsedItem !== 'object') continue;

    const record = parsedItem as Record<string, unknown>;
    const rawLabel = typeof record.label === 'string'
      ? record.label
      : typeof record.title === 'string'
        ? record.title
        : '';

    const rawInsight = typeof record.insight === 'string'
      ? record.insight
      : typeof record.summary === 'string'
        ? record.summary
        : '';

    const locations: string[] = [];
    if (Array.isArray(record.locations)) {
      for (const loc of record.locations) {
        if (typeof loc === 'string' && loc.trim()) locations.push(loc.trim());
      }
    }
    // Fallback: try timestamps field for compatibility
    if (locations.length === 0 && Array.isArray(record.timestamps)) {
      for (const ts of record.timestamps) {
        if (typeof ts === 'string' && ts.trim()) locations.push(ts.trim());
      }
    }

    const label = rawLabel.trim();
    const insight = rawInsight.trim();

    if (!label || !insight || locations.length === 0) continue;

    normalized.push({ label, insight, locations: locations.slice(0, 2) });
    if (normalized.length === 6) break;
  }

  return normalized;
}

function buildDocTakeawaysMarkdown(takeaways: StructuredDocTakeaway[]): string {
  const lines = [TAKEAWAYS_HEADING];

  for (const item of takeaways) {
    const label = item.label.trim().replace(/\s+/g, ' ');
    const insight = item.insight.trim();
    const locationSuffix = item.locations.length > 0
      ? ` (${item.locations.join(', ')})`
      : '';
    lines.push(`- **${label}**: ${insight}${locationSuffix}`);
  }

  return lines.join('\n');
}

async function handler(request: NextRequest) {
  try {
    const { segments, documentInfo } = await request.json() as {
      segments: DocumentSegment[];
      documentInfo?: Partial<DocumentInfo>;
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'Valid document segments are required' },
        { status: 400 }
      );
    }

    const prompt = buildDocumentTakeawaysPrompt({
      segments,
      documentInfo,
    });

    const response = await generateAIResponse(prompt, {
      temperature: 0.6,
      zodSchema: documentTakeawaysSchema,
    });

    if (!response) {
      throw new Error('No response from AI model');
    }

    let takeaways: StructuredDocTakeaway[];

    try {
      const parsed = safeJsonParse(response);
      const normalized = normalizeDocTakeawaysPayload(parsed);

      const validation = documentTakeawaysSchema.safeParse(normalized);
      if (!validation.success) {
        throw new Error('Normalized takeaways did not match expected schema');
      }

      takeaways = validation.data as StructuredDocTakeaway[];
    } catch {
      // Fallback: try to extract at least some takeaways
      try {
        const rawParsed = JSON.parse(response);
        const normalized = normalizeDocTakeawaysPayload(rawParsed);
        if (normalized.length >= 4) {
          takeaways = normalized;
        } else {
          throw new Error('Insufficient takeaways');
        }
      } catch {
        throw new Error('Invalid response format from AI model');
      }
    }

    if (!takeaways.length) {
      throw new Error('AI model returned no takeaways');
    }

    const markdown = buildDocTakeawaysMarkdown(takeaways);

    return NextResponse.json({ summaryContent: markdown });
  } catch (error) {
    console.error('Error generating document summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  rateLimit: RATE_LIMITS.AUTH_GENERATION,
  maxBodySize: 10 * 1024 * 1024,
  allowedMethods: ['POST'],
});
