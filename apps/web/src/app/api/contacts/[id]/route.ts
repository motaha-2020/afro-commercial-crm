import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/contacts/${id}`, 'PATCH');
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return forward(req, `/contacts/${id}`, 'DELETE');
}
