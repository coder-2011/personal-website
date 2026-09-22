const MAX_BODY_BYTES = 2048;
const MAX_TEXT_BYTES = 160;
const encoder = new TextEncoder();

// This is a public, credential-free computation API, including for opaque iframe origins.
function respond(data, status = 200, extra = {}) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });
}

// Count actual streamed bytes: Content-Length may be missing or untrustworthy.
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let expired = false, size = 0;
  const chunks = [];
  const timeout = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 3000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (expired) throw { status: 408, message: 'Request body timed out.' };
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw { status: 413, message: 'Request body exceeds 2048 bytes.' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

// Return only display data; the model and tokenization algorithm stay on the server.
export function createTraceHandler(trace) {
  return async function handleRequest(request) {
    if (request.method === 'OPTIONS') {
      return respond(null, 204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
    }
    if (request.method !== 'POST') return respond({ error: 'Use POST.' }, 405, { Allow: 'POST, OPTIONS' });
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''))
      return respond({ error: 'Use application/json.' }, 415);
    if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity')
      return respond({ error: 'Compressed request bodies are not supported.' }, 415);
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
      return respond({ error: 'Request body exceeds 2048 bytes.' }, 413);

    let input;
    try { input = JSON.parse(await readBody(request)); }
    catch (error) {
      const status = error?.status === 408 || error?.status === 413 ? error.status : 400;
      return respond({ error: status === 400 ? 'Invalid JSON body.' : error.message }, status);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).length !== 1 || typeof input.text !== 'string' || !input.text.isWellFormed())
      return respond({ error: 'Provide one field: text, containing valid Unicode.' }, 400);
    const byteLength = encoder.encode(input.text).length;
    if (byteLength < 1 || byteLength > MAX_TEXT_BYTES)
      return respond({ error: 'Use between 1 and 160 UTF-8 bytes.' }, 400);

    try { return respond(await trace(input.text)); }
    catch (error) {
      if (error instanceof RangeError) return respond({error:error.message}, 422);
      return respond({error:'Could not encode this text.'}, 500);
    }
  };
}
