import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roleCode: string }> },
) {
  const { id, roleCode } = await params;
  return forward(req, `/contacts/${id}/roles/${encodeURIComponent(roleCode)}`, 'DELETE');
}
