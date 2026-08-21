import type { SearchResult } from './common.js'
import { uniqueSources } from './common.js'

export async function searchPerplexity(
  query: string,
  maxResults: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens: 1024,
      messages: [{ role: 'user', content: query }],
    }),
    signal: AbortSignal.any([...(signal !== undefined ? [signal] : []), AbortSignal.timeout(20000)]),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error('Perplexity API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Web Search')
    }
    throw new Error(`Perplexity API error (HTTP ${response.status}): ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }

  const answer = data.choices?.[0]?.message?.content ?? ''
  const citations = data.citations ?? []
  const sources = citations.map((url) => ({
    url,
    ...(answer ? { snippet: answer.slice(0, 200) } : {}),
  }))

  return {
    content: answer,
    sources: uniqueSources(sources, maxResults),
    truncated: false,
  }
}
