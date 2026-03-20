import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { generateAIResponse } from '@/lib/ai-client';
import { DocumentSegment, DocumentInfo } from '@/lib/types';

function formatDocumentForContext(segments: DocumentSegment[]): string {
  return segments
    .map((s) => {
      const loc = s.pageNumber
        ? `Page ${s.pageNumber}`
        : s.sectionTitle || `Chars ${s.charStart}-${s.charEnd}`;
      return `[${loc}] ${s.text}`;
    })
    .join('\n\n');
}

async function handler(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      message,
      segments,
      documentInfo,
      chatHistory,
    } = body as {
      message: string;
      segments: DocumentSegment[];
      documentInfo?: Partial<DocumentInfo>;
      chatHistory?: { role: string; content: string }[];
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'Document segments are required' },
        { status: 400 }
      );
    }

    const documentContext = formatDocumentForContext(segments);
    const docTitle = documentInfo?.title || 'the document';
    const docAuthor = documentInfo?.author ? ` by ${documentInfo.author}` : '';

    const historyBlock = chatHistory
      ?.slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n') || '';

    const prompt = `<task>
<role>You are a knowledgeable assistant helping a reader understand "${docTitle}"${docAuthor}.</role>
<context>
The reader is asking about the following document. Answer based ONLY on the document content provided.
</context>
<instructions>
  <item>Answer the user's question based solely on the document content below.</item>
  <item>If the answer is not in the document, say so clearly.</item>
  <item>Include location references (e.g., "Page 5" or section names) when citing specific passages.</item>
  <item>Be concise and direct.</item>
  <item>When quoting the document, use exact text.</item>
</instructions>
${historyBlock ? `<conversationHistory>\n${historyBlock}\n</conversationHistory>` : ''}
<document><![CDATA[
${documentContext}
]]></document>
<userQuestion>${message}</userQuestion>
<outputFormat>Respond with a JSON object: {"answer":"your answer text","locations":["Page 5","Section: Introduction"]}</outputFormat>
</task>`;

    const response = await generateAIResponse(prompt, {
      temperature: 0.5,
    });

    if (!response) {
      throw new Error('No response from AI model');
    }

    let parsed: { answer: string; locations?: string[] };
    try {
      parsed = JSON.parse(response);
    } catch {
      // If JSON parse fails, treat the whole response as the answer
      parsed = { answer: response };
    }

    return NextResponse.json({
      answer: parsed.answer,
      locations: parsed.locations || [],
    });
  } catch (error) {
    console.error('Error in document chat:', error);
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024,
  allowedMethods: ['POST'],
});
