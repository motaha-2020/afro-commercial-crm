import { NextRequest } from 'next/server';
import { forward } from '@/lib/bff';

export const POST = (req: NextRequest) => forward(req, '/leads', 'POST');
