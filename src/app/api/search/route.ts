import { NextRequest } from 'next/server';
import { searchWeb } from '@/lib/search';

export async function POST(request: NextRequest) {
  try {
    const key = request.headers.get('x-tavily-key');
    const { query, mode } = await request.json();
    if (!query || typeof query !== 'string') {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    if (trimmedQuery.length > 500) {
      return Response.json({ error: 'Query is too long' }, { status: 400 });
    }

    const results = await searchWeb(trimmedQuery, key, mode === 'research' ? 'research' : 'search');
    return Response.json(results);
  } catch (error) {
    console.error('Search API error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    const status = message.includes('TAVILY_API_KEY') ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
