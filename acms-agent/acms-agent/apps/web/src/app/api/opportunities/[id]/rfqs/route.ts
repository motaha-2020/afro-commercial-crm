import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/opportunities/${id}/rfqs`, 'POST');
}
