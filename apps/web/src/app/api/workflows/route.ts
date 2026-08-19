import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

/** Creating a cycle — how a second country gets its own approvals. */
export async function POST(req: NextRequest) {
  return forward(req, '/workflows', 'POST');
}
