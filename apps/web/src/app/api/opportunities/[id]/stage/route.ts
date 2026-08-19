import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Moving a deal to another stage. The API's refusal body carries the missing
 * fields by name, and `forward` passes that body through untouched — the names
 * are the whole point of the answer.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/opportunities/${id}/stage`, 'POST');
}
