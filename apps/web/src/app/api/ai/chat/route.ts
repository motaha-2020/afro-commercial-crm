import { NextRequest, NextResponse } from 'next/server';
import { forward } from '@/lib/bff';

/**
 * The assistant answers from data the caller may see, so the turn must carry
 * the caller's own token — which lives in an httpOnly cookie and never reaches
 * browser code. `forward` fixes the target path here rather than taking it
 * from the request.
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return forward(req, '/ai/chat', 'POST');
}
