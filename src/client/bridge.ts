/** Shared wire helpers for the plugin's browser half. */

export const BRIDGE_PREFIX = '/api/dsh-free-web-search-settings'
export const NS = 'free-search'

export type EngineBadge = 'FREE' | 'API KEY'

export interface EngineEntry {
  id: string
  label: string
  badge: EngineBadge
  link: string
}

export const ENGINES: EngineEntry[] = [
  { id: 'ddg', label: 'DuckDuckGo · HTML', badge: 'FREE', link: 'https://duckduckgo.com' },
  { id: 'ddg-lite', label: 'DuckDuckGo · Lite', badge: 'FREE', link: 'https://duckduckgo.com' },
  { id: 'bing', label: 'Bing', badge: 'FREE', link: 'https://www.bing.com' },
  { id: 'anysearch', label: 'AnySearch · AI', badge: 'FREE', link: 'https://anysearch.com' },
  { id: 'searxng', label: 'SearXNG', badge: 'FREE', link: 'https://github.com/searxng/searxng' },
  { id: 'exa', label: 'Exa', badge: 'FREE', link: 'https://dashboard.exa.ai/api-keys' },
  { id: 'tavily', label: 'Tavily', badge: 'FREE', link: 'https://app.tavily.com/home' },
  { id: 'keenable', label: 'Keenable', badge: 'FREE', link: 'https://keenable.ai/login' },
  { id: 'perplexity', label: 'Perplexity', badge: 'API KEY', link: 'https://www.perplexity.ai/settings/api' },
  { id: 'deepseek-official', label: 'DeepSeek Official', badge: 'API KEY', link: 'https://platform.deepseek.com/api_keys' },
]

export interface BridgeResponse<T = unknown> {
  ok: boolean
  value?: T
  message?: string
}

export interface SettingsView {
  ns: string
  value?: Record<string, unknown>
  secrets?: Array<{ path: string[]; set: boolean }>
}

export interface DescribeResult {
  namespaces: SettingsView[]
  writable: boolean
  file?: string
}

export interface RawSearchResult {
  provider?: string
  sources?: Array<{ url?: string; title?: string; snippet?: string }>
  content?: string
  cache?: string
}

async function post<T>(path: string, payload: unknown): Promise<BridgeResponse<T>> {
  const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.json() as Promise<BridgeResponse<T>>
}

export const bridgeDescribe = (): Promise<BridgeResponse<DescribeResult>> => post('describe', {})

export const bridgeMutate = (payload: unknown): Promise<BridgeResponse<SettingsView>> => post('mutate', payload)

export const bridgeRawSearch = (payload: unknown): Promise<BridgeResponse<RawSearchResult>> => post('raw-search', payload)
