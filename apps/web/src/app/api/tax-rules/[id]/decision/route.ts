import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

type Ctx = { params: Promise<{ id: string }> };

/** Approve or reject. Whoever proposed the rate is refused by the API. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/tax-rules/${id}/decision`, 'POST');
}
