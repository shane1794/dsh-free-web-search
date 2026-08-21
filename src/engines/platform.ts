import type { SearchResult } from './common.js'
import { USER_AGENT } from './common.js'

export const PLATFORMS: Record<string, { name: string }> = {
  github: { name: 'GitHub' },
  reddit: { name: 'Reddit' },
}

export async function searchGithub(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}`,
    {
      headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
      ...(signal !== undefined ? { signal } : {}),
    },
  )

  if (!response.ok) throw new Error(`GitHub API error (HTTP ${response.status})`)

  const data = (await response.json()) as {
    items?: Array<{
      html_url: string
      full_name?: string
      name?: string
      description?: string
      stargazers_count?: number
    }>
  }

  return {
    sources: (data.items ?? []).map((item) => ({
      url: item.html_url,
      title: item.full_name ?? item.name ?? '',
      snippet: `${item.description ?? ''}${item.stargazers_count ? ` ★${item.stargazers_count}` : ''}`.trim(),
    })),
    truncated: false,
  }
}

export async function searchReddit(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const response = await fetch(
    `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&sort=relevance`,
    {
      headers: {
        'user-agent': `${USER_AGENT} (dsh-free-web-search)`,
        accept: 'application/json',
      },
      ...(signal !== undefined ? { signal } : {}),
    },
  )

  if (!response.ok) throw new Error(`Reddit API error (HTTP ${response.status})`)

  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: { url?: string; title?: string; selftext?: string } }> }
  }

  return {
    sources: (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((p): p is NonNullable<typeof p> => p !== undefined && p !== null && !!p.url)
      .map((p) => ({
        url: p.url!,
        title: p.title ?? '',
        ...(p.selftext ? { snippet: String(p.selftext).slice(0, 200) } : {}),
      })),
    truncated: false,
  }
}

export async function searchPlatform(
  platform: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  switch (platform) {
    case 'github':
      return searchGithub(query, maxResults, signal)
    case 'reddit':
      return searchReddit(query, maxResults, signal)
    default:
      throw new Error(`unknown platform: ${platform}`)
  }
}
