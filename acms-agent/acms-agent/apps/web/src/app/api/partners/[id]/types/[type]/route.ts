import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
) {
  const { id, type } = await params;
  return forward(req, `/partners/${id}/types/${encodeURIComponent(type)}`, 'DELETE');
}
