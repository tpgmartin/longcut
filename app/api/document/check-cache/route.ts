import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security-middleware';
import { createClient } from '@/lib/supabase/server';

async function handler(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentId } = body as { documentId: string };

    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('document_analyses')
      .select('id, document_id, title, topics, summary, suggested_questions')
      .eq('document_id', documentId)
      .single();

    if (error || !data) {
      return NextResponse.json({ cached: false });
    }

    return NextResponse.json({
      cached: true,
      analysis: data,
    });
  } catch (error) {
    console.error('Error checking document cache:', error);
    return NextResponse.json({ cached: false });
  }
}

export const POST = withSecurity(handler, {
  maxBodySize: 1024,
  allowedMethods: ['POST'],
});
