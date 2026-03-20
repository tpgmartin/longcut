import { NextRequest, NextResponse } from 'next/server';
import { parseDocument } from '@/lib/document-segmenter';
import { withSecurity } from '@/lib/security-middleware';

const MAX_FILE_SIZES: Record<string, number> = {
  pdf: 20 * 1024 * 1024,
  epub: 20 * 1024 * 1024,
  txt: 5 * 1024 * 1024,
  text: 5 * 1024 * 1024,
};

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  epub: ['application/epub+zip'],
  txt: ['text/plain'],
  text: ['text/plain'],
};

async function handler(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    const fileName = file.name;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (!['pdf', 'epub', 'txt', 'text'].includes(ext)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Accepted: PDF, EPUB, TXT' },
        { status: 400 }
      );
    }

    // Validate MIME type
    const allowedMimes = ALLOWED_MIME_TYPES[ext];
    if (allowedMimes && !allowedMimes.includes(file.type) && file.type !== 'application/octet-stream') {
      return NextResponse.json(
        { error: `Invalid MIME type for .${ext} file` },
        { status: 400 }
      );
    }

    // Validate file size
    const maxSize = MAX_FILE_SIZES[ext] || 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File too large. Maximum size for .${ext}: ${maxMB}MB` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { info, segments, fullText } = await parseDocument(buffer, fileName);

    if (segments.length === 0) {
      return NextResponse.json(
        { error: 'Could not extract text from the document' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      documentInfo: info,
      segments,
      fullText,
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    return NextResponse.json(
      { error: 'Failed to process document' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  maxBodySize: 20 * 1024 * 1024,
  allowedMethods: ['POST'],
});
