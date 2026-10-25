import type { SearchResult } from './common.js'

const ANYSEARCH_URL = 'https://api.anysearch.com/v1/search'

export async function searchAnysearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<SearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(ANYSEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Key optional: without it the request is anonymous and rate-limited per IP.
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal: controller.signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`AnySearch request failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    const hint =
      response.status === 401 ? ' — invalid anysearchApiKey'
        : response.status === 402 ? ' — quota exhausted'
          : response.status === 403 ? ' — key expired or disabled'
            : response.status === 429 ? ' — rate limited (add anysearchApiKey for a higher allowance)'
              : ''
    throw new Error(`AnySearch API error (HTTP ${response.status})${hint}`)
  }

  const data = (await response.json()) as {
    code: number
    message?: string
    data?: { results?: Array<{ url?: string; title?: string; snippet?: string }> }
  }
  if (data.code !== 0) throw new Error(`AnySearch API error: ${data.message ?? data.code}`)

  const results = data.data?.results ?? []
  return {
    sources: results
      .filter((r) => r.url)
      .map((r) => ({
        url: r.url!,
        ...(r.title ? { title: String(r.title) } : {}),
        ...(r.snippet ? { snippet: String(r.snippet).slice(0, 300) } : {}),
      })),
    truncated: false,
  }
}
