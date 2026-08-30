export interface Env {
  BUCKET: R2Bucket;
  UPLOAD_SECRET: string;
}

const R2_PUBLIC_URL = 'https://img.thepacklameute.fr';
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    if (request.method !== 'POST') {
      return cors(new Response('Method not allowed', { status: 405 }));
    }

    // Auth
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${env.UPLOAD_SECRET}`) {
      return cors(new Response('Unauthorized', { status: 401 }));
    }

    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return cors(new Response('Expected multipart/form-data', { status: 400 }));
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return cors(new Response('Invalid form data', { status: 400 }));
    }

    const file = formData.get('file');
    const key = formData.get('key');

    if (!file || !(file instanceof File)) {
      return cors(new Response('Missing file field', { status: 400 }));
    }
    if (!key || typeof key !== 'string') {
      return cors(new Response('Missing key field', { status: 400 }));
    }

    if (file.size > MAX_SIZE) {
      return cors(new Response('File too large (max 10 MB)', { status: 413 }));
    }

    const buffer = await file.arrayBuffer();
    const mimeType = file.type || 'image/jpeg';

    await env.BUCKET.put(key, buffer, {
      httpMetadata: { contentType: mimeType },
    });

    const url = `${R2_PUBLIC_URL}/${key}`;
    return cors(new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new Response(response.body, { status: response.status, headers });
}
