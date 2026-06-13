import { fetchModels } from '@/lib/openrouter';

let cachedModels: Awaited<ReturnType<typeof fetchModels>> | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  try {
    const key = request.headers.get('x-openrouter-key');
    const now = Date.now();
    // Use cache if available and NO custom key is provided (or if it matches, but simplifying here)
    if (cachedModels && now - cachedAt < CACHE_TTL && !key) {
      return Response.json({ models: cachedModels });
    }

    const models = await fetchModels(key);
    
    // Only cache if it's the default key (no custom key)
    if (!key) {
      cachedModels = models;
      cachedAt = now;
    }

    return Response.json({ models });
  } catch (error) {
    console.error('Models API error:', error);
    return Response.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
