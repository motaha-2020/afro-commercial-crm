import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

/** Proposing a rate. It arrives as a draft; Finance decides separately. */
export async function POST(req: NextRequest) {
  return forward(req, '/tax-rules', 'POST');
}
