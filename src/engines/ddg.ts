import type { SearchOptions, SearchResult } from './common.js'
import {
  approximateTimeRange,
  decodeEntities,
  extractDdgUrl,
  fetchHtmlWithRetry,
  stripTags,
  uniqueSources,
} from './common.js'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/'

export async function searchDdgHtml(
  query: string,
  maxResults: number,
  options?: SearchOptions,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query })
  if (options?.region) params.set('kl', options.region)
  if (options?.timeRange && 'days' in options.timeRange) {
    const df = { day: 'd', week: 'w', month: 'm', year: 'y' }[approximateTimeRange(options.timeRange.days)]
    if (df) params.set('df', df)
  }

  const html = await fetchHtmlWithRetry(`${DDG_HTML_URL}?${params}`, signal)
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? []
  const sources = []

  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/)
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/)
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/)
    const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/)
    const url = extractDdgUrl(urlMatch?.[1])
    if (!url) continue
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]!) } : {}),
      ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]!) } : {}),
      ...(dateMatch ? { publishedAt: dateMatch[1]! } : {}),
    })
  }

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}

export async function searchDdgLite(
  query: string,
  maxResults: number,
  options?: SearchOptions,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query })
  if (options?.timeRange && 'days' in options.timeRange) {
    const df = { day: 'd', week: 'w', month: 'm', year: 'y' }[approximateTimeRange(options.timeRange.days)]
    if (df) params.set('df', df)
  }

  const html = await fetchHtmlWithRetry(`${DDG_LITE_URL}?${params}`, signal)
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? []
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? []
  const sources = []

  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i]!
    const hrefMatch = tag.match(/href="([^"]*)"/)
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/)
    if (!hrefMatch) continue
    const url = extractDdgUrl(hrefMatch[1])
    if (!url) continue
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1]
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]!) } : {}),
      ...(snippet ? { snippet: stripTags(snippet) } : {}),
    })
  }

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}
