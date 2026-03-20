import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { createClient } from '@/lib/supabase/server';

async function getHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('document_analyses')
      .select('*')
      .eq('document_id', documentId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Document analysis not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching document analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document analysis' },
      { status: 500 }
    );
  }
}

async function postHandler(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      documentId,
      title,
      author,
      fileType,
      fileName,
      fileSize,
      pageCount,
      wordCount,
      segments,
      topics,
      summary,
      suggestedQuestions,
      fullText,
    } = body;

    if (!documentId || !title || !segments) {
      return NextResponse.json(
        { error: 'documentId, title, and segments are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user (optional - anonymous analyses allowed)
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('document_analyses')
      .upsert(
        {
          document_id: documentId,
          user_id: user?.id || null,
          title,
          author: author || null,
          file_type: fileType,
          file_name: fileName,
          file_size: fileSize,
          page_count: pageCount || null,
          word_count: wordCount,
          segments,
          topics: topics || null,
          summary: summary || null,
          suggested_questions: suggestedQuestions || null,
          full_text: fullText || null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'document_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving document analysis:', error);
      return NextResponse.json(
        { error: 'Failed to save document analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error saving document analysis:', error);
    return NextResponse.json(
      { error: 'Failed to save document analysis' },
      { status: 500 }
    );
  }
}

export const GET = withSecurity(getHandler, {
  allowedMethods: ['GET'],
});

export const POST = withSecurity(postHandler, {
  maxBodySize: 20 * 1024 * 1024,
  allowedMethods: ['POST'],
});
