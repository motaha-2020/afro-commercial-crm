import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/accounts/${id}/relationships`, 'POST');
}
