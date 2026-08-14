import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export async function POST(req: NextRequest) {
  return forward(req, '/approval-policies', 'POST');
}
