import type { SearchOptions, SearchResult } from './common.js'
import { fetchHtmlWithRetry, stripTags, uniqueSources } from './common.js'

const BING_URL = 'https://www.bing.com/search'

export async function searchBing(
  query: string,
  maxResults: number,
  options?: SearchOptions,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, mkt: options?.bingMarket ?? 'en-US' })
  const html = await fetchHtmlWithRetry(`${BING_URL}?${params}`, signal)
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? []
  const sources = []

  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/)
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/)
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    if (!hrefMatch) continue
    sources.push({
      url: hrefMatch[1]!,
      ...(titleMatch ? { title: stripTags(titleMatch[1]!) } : {}),
      ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]!) } : {}),
    })
  }

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}
