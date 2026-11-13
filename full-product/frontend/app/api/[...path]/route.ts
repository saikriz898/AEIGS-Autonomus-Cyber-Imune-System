import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:8000';
  const url = new URL('/api/' + path.map(encodeURIComponent).join('/'), base);
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const key of [
    'content-type',
    'cookie',
    'origin',
    'x-csrf-token',
    'x-setup-token',
    'idempotency-key',
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  let body: Uint8Array | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const multipart = request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('multipart/form-data');
    const maximum = multipart ? 50 * 1024 * 1024 + 65536 : 1024 * 1024;
    if (Number(request.headers.get('content-length') || 0) > maximum)
      return Response.json(
        { detail: 'Request exceeds the allowed size limit (50 MiB uploads; 1 MiB JSON).' },
        { status: 413 },
      );
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          return Response.json(
            { detail: 'Request exceeds the allowed size limit (50 MiB uploads; 1 MiB JSON).' },
            { status: 413 },
          );
        }
        chunks.push(chunk.value);
      }
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
    const outgoing = new Headers();
    for (const key of ['content-type', 'content-disposition', 'set-cookie', 'retry-after']) {
      const value = response.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    outgoing.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json(
      { detail: 'The AEGIS API is unavailable. Check the API and PostgreSQL service status.' },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
