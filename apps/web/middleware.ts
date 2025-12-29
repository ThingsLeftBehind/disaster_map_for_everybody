import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const allowedOrigins = new Set(['http://localhost:8081', 'http://localhost:3000']);

function buildCorsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = buildCorsHeaders(origin);
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (key.toLowerCase() === 'vary') {
      response.headers.append('Vary', value);
      continue;
    }
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
