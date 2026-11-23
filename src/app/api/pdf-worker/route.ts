import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-static';

let cachedWorkerVersion = '';

function getPdfjsVersion(): string {
  if (cachedWorkerVersion) return cachedWorkerVersion;
  try {
    const pkgPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      cachedWorkerVersion = pkg.version || '4.10.38';
      return cachedWorkerVersion;
    }
  } catch {}
  return '4.10.38';
}

export async function GET(request: NextRequest) {
  try {
    const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
    if (!fs.existsSync(workerPath)) {
      return new Response('PDF.js worker file not found', { status: 404 });
    }

    const version = getPdfjsVersion();
    const etag = `"${version}"`;

    const ifNoneMatch = request?.headers?.get ? request.headers.get('if-none-match') : null;
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304 });
    }

    const content = fs.readFileSync(workerPath);
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': etag,
        'X-Worker-Version': version,
      },
    });
  } catch (error) {
    return new Response('Failed to read PDF.js worker', { status: 500 });
  }
}
