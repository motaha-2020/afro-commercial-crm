import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(req, `/leads/${id}/status`, 'PATCH');
}
