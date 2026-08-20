import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/targets/${id}`, 'DELETE');
}
