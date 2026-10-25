import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import {
  searchDdgHtml,
  searchDdgLite,
  searchBing,
  searchSearxng,
  searchAnysearch,
  searchExa,
  searchExaMCP,
  searchTavily,
  searchKeenable,
  searchPerplexity,
  searchDeepSeekOfficial,
  parseTimeRange,
  approximateTimeRange,
  cleanSnippet,
} from './engines/index.js'
import type { SearchResult, SearchOptions, TimeRange } from './engines/index.js'
import { SearchCache } from './bridge/cache.js'
import { makeBridgeRoutes } from './bridge/routes.js'
import { FREE_SEARCH_DIR, SettingsFile, resolveDshHome } from './bridge/store.js'
import type { FreeSearchSettings } from './bridge/store.js'
import { createAdvancedSearchTool } from './tools/web-search.js'
import { createPlatformSearchTool } from './tools/platform-search.js'
import { createEngineTestTool } from './tools/engine-test.js'
import { createWebFetchTool } from './tools/web-fetch.js'
import { FREE_SEARCH_NS, ALL_ENGINES } from './constants.js'
import type { EngineId, EngineTestFn, EngineTestResult, EngineTestFailure } from './constants.js'

export { parseTimeRange, approximateTimeRange }
export { FREE_SEARCH_NS, ALL_ENGINES, FREE_ENGINES } from './constants.js'
export type { EngineId, EngineTestFn } from './constants.js'

export const name = 'web-search-free'
export const inject = ['web']

interface PluginConfig {
  provider?: string
  cache?: boolean
  cacheTtl?: number
  lang?: string
  region?: string
  bingMarket?: string
  searxngInstances?: string[]
  platforms?: string[]
  rotation?: string
  anysearchApiKey?: string
  exaApiKey?: string
  tavilyApiKey?: string
  keenableApiKey?: string
  perplexityApiKey?: string
  deepseekApiKey?: string
}

export const Config = z.object({
  provider: z.string().default('bing'),
  cache: z.boolean().default(true),
  cacheTtl: z.number().default(5),
  lang: z.string().default('en'),
  region: z.string(),
  bingMarket: z.string().default('en-US'),
  searxngInstances: z.array(z.string()),
  platforms: z.array(z.string()).default(['github', 'reddit']),
  rotation: z.string().default('round-robin'),
  anysearchApiKey: z.string().role('secret'),
  exaApiKey: z.string().role('secret'),
  tavilyApiKey: z.string().role('secret'),
  keenableApiKey: z.string().role('secret'),
  perplexityApiKey: z.string().role('secret'),
  deepseekApiKey: z.string().role('secret'),
})

function toSearchOptions(cfg: PluginConfig, timeRange?: TimeRange): SearchOptions {
  return {
    ...(cfg.region ? { region: cfg.region } : {}),
    ...(cfg.bingMarket ? { bingMarket: cfg.bingMarket } : {}),
    ...(cfg.searxngInstances ? { searxngInstances: cfg.searxngInstances } : {}),
    ...(timeRange ? { timeRange } : {}),
  }
}

export function apply(ctx: Context, config?: PluginConfig) {
  // Context services not covered by @deepseek-ai/cordis types
  const ctxAny = ctx as any // eslint-disable-line @typescript-eslint/no-explicit-any
  const logger = ctxAny.logger as { warn(msg: string): void }

  // Plugin-owned settings file: survives the harness settings-service reshuffle
  // and keeps the engine choice editable while the app is closed.
  const store = new SettingsFile(
    path.join(resolveDshHome(), FREE_SEARCH_DIR, 'settings.json'),
    () => (config ?? {}) as FreeSearchSettings,
    message => logger.warn(message),
  )
  /** Entry config with the settings file layered on top; read per request. */
  const current = (): PluginConfig => ({ ...(config ?? {}), ...store.get() })
  const credentials = ctxAny.get?.('credentials') as
    { resolve(name: string): Promise<{ value?: string }> } | null

  let refreshPrompt: (() => void) | null = null

  const searchCache = new SearchCache<SearchResult>()

  const resolveApiKey = async (envName: string, settingsKey?: keyof PluginConfig): Promise<string> => {
    const cfg = current()
    if (settingsKey) {
      const v = cfg[settingsKey]
      if (typeof v === 'string' && v) return v
    }
    if (credentials) {
      try {
        const resolved = await credentials.resolve(envName)
        if (resolved?.value) return resolved.value
      } catch (e) {
        logger.warn(`free-search: credential resolution failed for ${envName}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return process.env[envName] ?? ''
  }

  const PAID_ENGINES: EngineId[] = ['exa', 'tavily', 'keenable', 'perplexity', 'deepseek-official']
  const SCRAPE_ENGINES: EngineId[] = ['bing', 'anysearch', 'ddg', 'ddg-lite', 'searxng']
  const TIME_ENGINES: EngineId[] = ['tavily', 'exa', 'keenable', 'searxng', 'ddg', 'ddg-lite']
  /** Engines that cannot run at all without a key; rotation skips them while unset. */
  const KEY_ONLY_ENGINES: EngineId[] = ['perplexity', 'deepseek-official']
  const ENGINE_KEY_ENV: Partial<Record<EngineId, [string, keyof PluginConfig]>> = {
    anysearch: ['ANYSEARCH_API_KEY', 'anysearchApiKey'],
    exa: ['EXA_API_KEY', 'exaApiKey'],
    tavily: ['TAVILY_API_KEY', 'tavilyApiKey'],
    keenable: ['KEENABLE_API_KEY', 'keenableApiKey'],
    perplexity: ['PERPLEXITY_API_KEY', 'perplexityApiKey'],
    'deepseek-official': ['DEEPSEEK_API_KEY', 'deepseekApiKey'],
  }

  /**
   * Rotation pointer and per-engine health, both process-local.
   *
   * Round-robin spreads requests over the pool so no single engine carries the
   * whole rate limit. The health map is what stops rotation from spreading a
   * *broken* engine evenly, which would be worse than plain fallback: two
   * consecutive failures bench an engine for a minute, doubling to ten, and one
   * success clears the record.
   */
  let rotationCursor = 0
  const engineHealth = new Map<EngineId, { failures: number; until: number }>()
  const BENCH_AFTER_FAILURES = 2
  const BENCH_BASE_MS = 60_000
  const BENCH_MAX_MS = 10 * 60_000

  const isBenched = (engine: EngineId, now: number): boolean => (engineHealth.get(engine)?.until ?? 0) > now

  const noteFailure = (engine: EngineId): void => {
    const health = engineHealth.get(engine) ?? { failures: 0, until: 0 }
    health.failures += 1
    if (health.failures >= BENCH_AFTER_FAILURES) {
      const ms = Math.min(BENCH_BASE_MS * 2 ** (health.failures - BENCH_AFTER_FAILURES), BENCH_MAX_MS)
      health.until = Date.now() + ms
      logger.warn(`free-search: benching ${engine} for ${Math.round(ms / 1000)}s after ${health.failures} consecutive failures`)
    }
    engineHealth.set(engine, health)
  }

  const noteSuccess = (engine: EngineId): void => { engineHealth.delete(engine) }

  /**
   * Engines this request may use. A key-only engine joins once it has a key in
   * settings or the environment; one that only the credentials service holds is
   * still attempted by runEngine, so leaving it in costs at most one turn.
   */
  const enginePool = (cfg: PluginConfig, timeRange: TimeRange | undefined): EngineId[] => {
    const usable = [...PAID_ENGINES, ...SCRAPE_ENGINES].filter(engine => {
      if (!KEY_ONLY_ENGINES.includes(engine)) return true
      const entry = ENGINE_KEY_ENV[engine]
      return entry === undefined || Boolean(cfg[entry[1]] ?? process.env[entry[0]])
    })
    return timeRange ? usable.filter(engine => TIME_ENGINES.includes(engine)) : usable
  }

  const provider = {
    id: 'ddg',
    available() { return true },

    async search(request: Record<string, unknown>, signal?: AbortSignal): Promise<SearchResult & { _cache?: string }> {
      if (!request || typeof request.query !== 'string' || !request.query.trim()) {
        throw new Error('query is required')
      }
      const cfg = current()
      const query = request.query
      const explicitEngine = typeof request.engine === 'string' && (ALL_ENGINES as readonly string[]).includes(request.engine)
        ? request.engine as EngineId
        : undefined
      const preferred: EngineId = explicitEngine
        ?? ((ALL_ENGINES as readonly string[]).includes(cfg.provider ?? '') ? cfg.provider as EngineId : 'bing')

      const timeRange = parseTimeRange(request.timeRange)
      const timeRangeLabel = typeof request.timeRange === 'string'
        ? request.timeRange
        : timeRange ? ('days' in timeRange ? String(timeRange.days) : timeRange.after) : ''

      const rotationOn = (cfg.rotation ?? 'round-robin') !== 'off'
      const pool = enginePool(cfg, timeRange)
      // An explicit engine from the caller outranks the rotation.
      const rotating = rotationOn && explicitEngine === undefined && pool.length > 1

      /** Where this request starts: the rotated pick, or the caller's engine. */
      let start: EngineId = preferred
      if (rotating) {
        start = pool[rotationCursor % pool.length]
        rotationCursor = (rotationCursor + 1) % 100_000
      }

      const cacheTtlMs = Math.min(Math.max(cfg.cacheTtl ?? 5, 0), 5) * 60 * 1000
      const cacheEnabled = cfg.cache !== false && cacheTtlMs > 0
      const maxResults = Math.max((request.maxResults as number | undefined) ?? 5, 1)
      // A rotating request must not key the cache on the engine it happened to
      // draw, or every turn of the cycle would miss.
      const cacheKey = cacheEnabled
        ? searchCache.buildKey(query, maxResults, timeRangeLabel, rotating ? 'rotating-pool' : start)
        : null

      if (cacheKey) {
        const hit = searchCache.get(cacheKey)
        if (hit) {
          if (signal?.aborted) throw new Error('search aborted')
          return { ...hit, sources: hit.sources.slice(), _cache: 'hit' }
        }
      }

      /** Rotate a list so `start` leads; engines ahead of it become fallbacks. */
      const rotateTo = (list: EngineId[]): EngineId[] => {
        const index = list.indexOf(start)
        return index <= 0 ? list : [...list.slice(index), ...list.slice(0, index)]
      }
      const head = rotateTo(pool)
      const tail = [...PAID_ENGINES, ...SCRAPE_ENGINES].filter(engine => !head.includes(engine))
      const now = Date.now()
      const ordered = [...head, ...tail]
      // Benched engines keep their place at the very end rather than dropping out:
      // when everything is benched the search still has to run.
      const chain: EngineId[] = [
        ...ordered.filter(engine => !isBenched(engine, now)),
        ...ordered.filter(engine => isBenched(engine, now)),
      ]
      const first = chain[0] ?? preferred

      let lastError: Error | null = null
      let firstFailure: string | null = null
      const BUDGET_MS = 30_000
      const deadline = Date.now() + BUDGET_MS
      const opts = toSearchOptions(cfg, timeRange)

      for (const engine of chain) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(`search timed out after ${BUDGET_MS / 1000}s`)
        const effSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(remaining)])

        try {
          let result = await runEngine(engine, query, maxResults, opts, timeRange, effSignal)

          if (result && result.sources.length > 0) {
            result.sources = result.sources.map(s =>
              s.snippet ? { ...s, snippet: cleanSnippet(s.snippet)! } : s,
            )
            noteSuccess(engine)
            if (engine !== first) {
              result.content = `Note: ${first} ${firstFailure ?? 'returned nothing'}, using ${engine}.`
            } else if (start !== first) {
              const why = timeRange && !TIME_ENGINES.includes(start)
                ? `does not support time filtering (timeRange=${timeRangeLabel})`
                : 'is benched after repeated failures'
              result.content = `Note: ${start} ${why}, using ${engine}.`
            }
            if (timeRange && !TIME_ENGINES.includes(engine)) {
              const warn = `Warning: ${engine} does not support time filtering — results are unfiltered.`
              result.content = result.content ? `${result.content} ${warn}` : warn
            }
            const cached: SearchResult = { ...result, provider: engine }
            if (cacheKey) {
              const ttl = engine !== first ? Math.max(cacheTtlMs / 5, 1000) : cacheTtlMs
              searchCache.set(cacheKey, cached, ttl)
            }
            return { ...cached, _cache: 'miss' }
          }

          lastError = new Error(`engine "${engine}" returned 0 results`)
          if (engine === first) firstFailure = 'returned 0 results'
          logger.warn(`free-search: ${engine} returned 0 results, trying next engine`)
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          noteFailure(engine)
          if (engine === first) firstFailure = lastError.message
          logger.warn(`free-search: engine "${engine}" failed (${lastError.message}), trying next engine`)
        }
      }
      throw lastError ?? new Error('all search engines failed')
    },
  }

  async function runEngine(
    engine: EngineId, query: string, maxResults: number,
    opts: SearchOptions, timeRange: TimeRange | undefined, signal: AbortSignal,
  ): Promise<SearchResult | null> {
    switch (engine) {
      case 'ddg': return searchDdgHtml(query, maxResults, opts, signal)
      case 'ddg-lite': return searchDdgLite(query, maxResults, opts, signal)
      case 'bing': return searchBing(query, maxResults, opts, signal)
      case 'searxng': return searchSearxng(query, maxResults, opts, signal)
      case 'anysearch': {
        const key = await resolveApiKey('ANYSEARCH_API_KEY', 'anysearchApiKey')
        return searchAnysearch(query, maxResults, signal, key)
      }
      case 'exa': {
        const key = await resolveApiKey('EXA_API_KEY', 'exaApiKey')
        return key
          ? searchExa(query, maxResults, key, timeRange, signal)
          : searchExaMCP(query, maxResults, signal)
      }
      case 'tavily': {
        const key = await resolveApiKey('TAVILY_API_KEY', 'tavilyApiKey')
        return searchTavily(query, maxResults, key, timeRange, signal)
      }
      case 'keenable': {
        const key = await resolveApiKey('KEENABLE_API_KEY', 'keenableApiKey')
        return searchKeenable(query, maxResults, key, timeRange, signal)
      }
      case 'perplexity': {
        const key = await resolveApiKey('PERPLEXITY_API_KEY', 'perplexityApiKey')
        if (!key) { skipEngine(engine, 'PERPLEXITY_API_KEY is not configured'); return null }
        return searchPerplexity(query, maxResults, key, signal)
      }
      case 'deepseek-official': {
        const key = await resolveApiKey('DEEPSEEK_API_KEY', 'deepseekApiKey')
        if (!key) { skipEngine(engine, 'DEEPSEEK_API_KEY is not configured'); return null }
        return searchDeepSeekOfficial(query, maxResults, key, signal)
      }
      default: return null
    }
  }

  function skipEngine(engine: string, reason: string) {
    logger.warn(`free-search: engine "${engine}" skipped (${reason}), trying next engine`)
  }

  const runEngineTest: EngineTestFn = async (engine, query) => {
    const cfg = current()
    const q = query || 'DeepSeek Harness'
    const opts = toSearchOptions(cfg)

    const attempt = async (): Promise<EngineTestResult | EngineTestFailure> => {
      switch (engine) {
        case 'ddg': return { ok: true, ...(await searchDdgHtml(q, 2, opts)), truncated: false }
        case 'ddg-lite': return { ok: true, ...(await searchDdgLite(q, 2, opts)), truncated: false }
        case 'bing': return { ok: true, ...(await searchBing(q, 2, opts)), truncated: false }
        case 'searxng': return { ok: true, ...(await searchSearxng(q, 2, opts)), truncated: false }
        case 'anysearch': {
          const key = await resolveApiKey('ANYSEARCH_API_KEY', 'anysearchApiKey')
          return { ok: true, ...(await searchAnysearch(q, 2, undefined, key)), truncated: false }
        }
        case 'exa': {
          const key = await resolveApiKey('EXA_API_KEY', 'exaApiKey')
          return { ok: true, ...(key ? await searchExa(q, 2, key) : await searchExaMCP(q, 2)), truncated: false }
        }
        case 'tavily': {
          const key = await resolveApiKey('TAVILY_API_KEY', 'tavilyApiKey')
          return { ok: true, ...(await searchTavily(q, 2, key)), truncated: false }
        }
        case 'keenable': {
          const key = await resolveApiKey('KEENABLE_API_KEY', 'keenableApiKey')
          return { ok: true, ...(await searchKeenable(q, 2, key)), truncated: false }
        }
        case 'perplexity': {
          const key = await resolveApiKey('PERPLEXITY_API_KEY', 'perplexityApiKey')
          if (!key) return { ok: false, error: 'PERPLEXITY_API_KEY not configured' }
          return { ok: true, ...(await searchPerplexity(q, 2, key)), truncated: false }
        }
        case 'deepseek-official': {
          const key = await resolveApiKey('DEEPSEEK_API_KEY', 'deepseekApiKey')
          if (!key) return { ok: false, error: 'DEEPSEEK_API_KEY not configured' }
          return { ok: true, ...(await searchDeepSeekOfficial(q, 2, key)), truncated: false }
        }
        default: return { ok: false, error: `unknown engine: ${engine}` }
      }
    }

    try {
      const result = await attempt()
      if (!result.ok) return result
      if (result.sources.length === 0) {
        await new Promise(r => setTimeout(r, 1500))
        return attempt()
      }
      return {
        ok: true as const,
        sources: result.sources.map(s =>
          s.snippet ? { ...s, snippet: cleanSnippet(s.snippet)! } : s,
        ),
        truncated: result.truncated,
      }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // Settings bridge for the plugin's own page and the /free-search-engine
  // command. Backed by the plugin's JSON file, not the harness settings service
  // (0.2.x dropped settingsNamespace/installSettingsSection).
  ctx.inject(['webServer'], (sctx: Context) => {
    sctx.effect(() => {
      const disposers = makeBridgeRoutes(
        store,
        request => provider.search(request),
        (engine, query) => runEngineTest(engine, query),
      ).map(route => (sctx as any).webServer.register(route))
      return () => { for (const d of disposers) d() }
    }, 'free-search: settings bridge')
  })

  ctxAny.web.registerSearchProvider(provider)

  ctx.inject(['tools'], (sctx: Context) => {
    sctx.effect(() => {
      const d = (sctx as any).tools.register(createEngineTestTool(runEngineTest))
      return () => d()
    }, 'free-search: test engines tool')
  })

  ctx.inject(['tools'], (sctx: Context) => {
    sctx.effect(() => {
      const d = (sctx as any).tools.register(
        createPlatformSearchTool(() => current().platforms ?? ['github', 'reddit']),
      )
      return () => d()
    }, 'free-search: platform search tool')
  })

  ctx.inject(['tools'], (sctx: Context) => {
    sctx.effect(() => {
      const d = (sctx as any).tools.register(createAdvancedSearchTool(provider))
      return () => d()
    }, 'free-search: advanced search tool')
  })

  ctx.inject(['tools'], (sctx: Context) => {
    sctx.effect(() => {
      const d = (sctx as any).tools.register(createWebFetchTool())
      return () => d()
    }, 'free-search: web fetch tool')
  })

  ctx.inject(['systemPrompt'], (sctx: Context) => {
    let disposeSection: (() => void) | null = null
    const sp = (sctx as any).systemPrompt as {
      section(opts: { name: string; order: number; text: string }): () => void
    }

    refreshPrompt = () => {
      if (disposeSection) { disposeSection(); disposeSection = null }
      disposeSection = sp.section({
        name: 'free-search:engines',
        order: 500,
        text: [
          '## Available web search engines (free-web-search plugin)',
          '',
          'You have the web_search tool. Its backend engine is chosen in Settings > Plugins > Free Web Search.',
          `Current engine: ${current().provider ?? 'bing'}`,
          '',
          'Available engines:',
          '- ddg (DuckDuckGo HTML) - FREE, no key',
          '- ddg-lite (DuckDuckGo Lite) - FREE, no key',
          '- bing (Bing) - FREE, no key (most stable)',
          '- searxng (meta-search) - FREE, no key',
          '- anysearch (AI search) - FREE, no key (ANYSEARCH_API_KEY optional for higher limits)',
          '- exa - FREE keyless (MCP) or EXA_API_KEY',
          '- tavily - FREE keyless or TAVILY_API_KEY',
          '- keenable - FREE keyless (MCP) or KEENABLE_API_KEY',
          '- perplexity - requires PERPLEXITY_API_KEY',
          '- deepseek-official - requires DEEPSEEK_API_KEY',
          '',
          'If the engine in use fails, web_search automatically tries the others.',
          `Rotation: ${current().rotation === 'off' ? 'off (same engine every request)' : 'round-robin across the usable engines'}.`,
          '',
          'Use free_search_test to test engine availability.',
          'Use advanced_search with timeRange for time-filtered results.',
          'Use platform_search for GitHub/Reddit searches.',
          'Use web_fetch to read the full content of a single web page (articles, docs, any URL).',
        ].join('\n'),
      })
    }

    sctx.effect(() => {
      refreshPrompt!()
      return () => { if (disposeSection) disposeSection(); disposeSection = null }
    }, 'free-search: engine list prompt section')
  })
}
