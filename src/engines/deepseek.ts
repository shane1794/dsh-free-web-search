import type { SearchResult } from './common.js'
import { uniqueSources } from './common.js'

export async function searchDeepSeekOfficial(
  query: string,
  maxResults: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    redirect: 'error',
    headers: {
      'x-api-key': apiKey,
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'deepseek-harness/free-web-search',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
        },
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    }),
    signal: AbortSignal.any([...(signal !== undefined ? [signal] : []), AbortSignal.timeout(20000)]),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error('DeepSeek API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Web Search')
    }
    throw new Error(`DeepSeek API error (HTTP ${response.status}): ${detail.slice(0, 200)}`)
  }

  interface ContentBlock {
    type: string
    citations?: Array<{ url?: string; cited_text?: string }>
    content?: Array<{ type: string; url?: string; title?: string; page_age?: string }>
  }

  const data = (await response.json()) as { content?: ContentBlock[] }
  const blocks = data.content ?? []
  const resultBlocks = blocks.filter((block) => block.type === 'web_search_tool_result')

  const snippets = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const cite of block.citations ?? []) {
      if (cite.url && cite.cited_text && !snippets.has(cite.url)) {
        snippets.set(cite.url, cite.cited_text)
      }
    }
  }

  const sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }> = []
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== 'web_search_result' || !item.url) continue
      if (sources.some((s) => s.url === item.url)) continue
      sources.push({
        url: item.url,
        ...(item.title ? { title: item.title } : {}),
        ...(snippets.get(item.url) ? { snippet: snippets.get(item.url)! } : {}),
        ...(item.page_age ? { publishedAt: item.page_age } : {}),
      })
    }
  }

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}
