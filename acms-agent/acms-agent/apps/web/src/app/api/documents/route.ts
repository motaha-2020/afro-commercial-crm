import { NextRequest } from 'next/server';
import { forwardMultipart } from '@/lib/bff';

export async function POST(req: NextRequest) {
  return forwardMultipart(req, '/documents');
}
