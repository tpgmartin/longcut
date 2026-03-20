import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { generateAIResponse } from '@/lib/ai-client';
import { suggestedQuestionsSchema } from '@/lib/schemas';
import { DocumentSegment, DocumentInfo } from '@/lib/types';

async function handler(request: NextRequest) {
  try {
    const { segments, documentInfo } = await request.json() as {
      segments: DocumentSegment[];
      documentInfo?: Partial<DocumentInfo>;
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'Document segments are required' },
        { status: 400 }
      );
    }

    // Use a subset of segments to keep the prompt manageable
    const sampleSegments = segments.length > 20
      ? [
          ...segments.slice(0, 7),
          ...segments.slice(Math.floor(segments.length / 2) - 3, Math.floor(segments.length / 2) + 4),
          ...segments.slice(-6),
        ]
      : segments;

    const documentText = sampleSegments.map((s) => s.text).join('\n\n');
    const docTitle = documentInfo?.title || 'Untitled document';

    const prompt = `<task>
<role>You are a curious reader who has just finished reading "${docTitle}".</role>
<goal>Generate 4 thought-provoking questions that would help someone understand the document's key ideas more deeply.</goal>
<instructions>
  <item>Questions should be specific to the content, not generic.</item>
  <item>Mix different types: "why" questions, "how" questions, comparison questions, and implication questions.</item>
  <item>Each question should be answerable from the document content.</item>
  <item>Keep questions concise (under 15 words each).</item>
</instructions>
<outputFormat>Return strict JSON: ["question1","question2","question3","question4"]</outputFormat>
<documentExcerpt><![CDATA[
${documentText}
]]></documentExcerpt>
</task>`;

    const response = await generateAIResponse(prompt, {
      temperature: 0.7,
      zodSchema: suggestedQuestionsSchema,
    });

    if (!response) {
      return NextResponse.json({ questions: [] });
    }

    let questions: string[];
    try {
      questions = JSON.parse(response);
    } catch {
      questions = [];
    }

    return NextResponse.json({ questions: Array.isArray(questions) ? questions.slice(0, 4) : [] });
  } catch (error) {
    console.error('Error generating suggested questions:', error);
    return NextResponse.json({ questions: [] });
  }
}

export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024,
  allowedMethods: ['POST'],
});
