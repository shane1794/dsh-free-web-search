import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchPlatform } from '../engines/index.js'

const PLATFORMS: Record<string, { name: string }> = {
  github: { name: 'GitHub' },
  reddit: { name: 'Reddit' },
}

export function createPlatformSearchTool(getEnabledPlatforms: () => string[]) {
  return defineTool({
    name: 'platform_search',
    description:
      'Search a specific platform (GitHub / Reddit) for a query. Returns source URLs with titles and snippets.',
    parameters: {
      platform: {
        type: 'string' as const,
        description: 'Platform to search: github, reddit',
      },
      query: {
        type: 'string' as const,
        description: 'The search query.',
      },
      maxResults: {
        type: 'number' as const,
        description: 'Optional result count (default 5, max 10).',
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          platform: { type: 'string' as const },
          sources: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              properties: {
                url: { type: 'string' as const },
                title: { type: 'string' as const },
                snippet: { type: 'string' as const },
              },
            },
          },
        },
      },
      render(_args: unknown, value: unknown) {
        const v = value as { platform: string; sources: Array<{ url: string; title?: string; snippet?: string }> }
        const lines = v.sources.map((s) =>
          `- [${s.title ?? s.url}](${s.url})${s.snippet ? ` - ${s.snippet.slice(0, 120)}` : ''}`,
        )
        return [{ type: 'text' as const, text: `Platform search (${v.platform}):\n${lines.join('\n') || 'No results found.'}` }]
      },
    },
    async execute(args: { platform?: string; query?: string; maxResults?: number }) {
      const platform = args.platform as string
      if (!PLATFORMS[platform]) {
        throw new Error(`unknown platform "${platform}" - use one of: ${Object.keys(PLATFORMS).join(', ')}`)
      }
      const enabled = getEnabledPlatforms()
      if (!enabled.includes(platform)) {
        throw new Error(`platform "${platform}" is disabled in settings`)
      }
      if (!args.query?.trim()) throw new Error('query is required')
      const limit = Math.min(args.maxResults ?? 5, 10)
      const result = await searchPlatform(platform, args.query, limit)
      const sources = (result.sources ?? []).map((s) => {
        const source: Record<string, string> = {}
        if (s.url) source.url = s.url
        if (s.title) source.title = String(s.title)
        if (s.snippet) source.snippet = String(s.snippet)
        return source
      })
      return { platform, sources }
    },
  })
}
