import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

type Ctx = { params: Promise<{ id: string }> };

/** Sending is its own endpoint: it is an act, not an edit to a draft. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/proposal-versions/${id}/submit`, 'POST');
}
