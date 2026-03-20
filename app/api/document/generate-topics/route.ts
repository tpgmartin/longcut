import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { generateDocumentTopics } from '@/lib/document-processing';
import { DocumentSegment, DocumentInfo } from '@/lib/types';

async function handler(request: NextRequest) {
  try {
    const body = await request.json();

    const { segments, fullText, documentInfo, theme, language } = body as {
      segments: DocumentSegment[];
      fullText: string;
      documentInfo?: Partial<DocumentInfo>;
      theme?: string;
      language?: string;
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'Valid document segments are required' },
        { status: 400 }
      );
    }

    if (!fullText || typeof fullText !== 'string') {
      return NextResponse.json(
        { error: 'Full document text is required' },
        { status: 400 }
      );
    }

    const { topics } = await generateDocumentTopics(segments, fullText, {
      documentInfo,
      theme,
      language,
    });

    return NextResponse.json({ topics });
  } catch (error) {
    console.error('Error generating document topics:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024,
  allowedMethods: ['POST'],
});
