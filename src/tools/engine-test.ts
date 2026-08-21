import { defineTool } from '@deepseek-ai/dsh-tools'
import { ALL_ENGINES } from '../constants.js'
import type { EngineTestFn } from '../constants.js'

export function createEngineTestTool(runEngineTest: EngineTestFn) {
  return defineTool({
    name: 'free_search_test',
    description:
      'Test every configured web search engine and report which ones work. Use this to verify engine availability, diagnose search failures, or check whether an API key is configured.',
    parameters: {
      engines: {
        type: 'array' as const,
        description: 'Which engines to test (default: all). Options: ' + ALL_ENGINES.join(', ') + '.',
        items: { type: 'string' as const },
      },
      query: {
        type: 'string' as const,
        description: "Optional search query for the test (default: 'DeepSeek Harness').",
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          results: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              properties: {
                engine: { type: 'string' as const },
                status: { type: 'string' as const },
                results: { type: 'number' as const },
                error: { type: 'string' as const },
                sampleTitle: { type: 'string' as const },
                sampleUrl: { type: 'string' as const },
              },
            },
          },
        },
      },
      render(_args: unknown, value: unknown) {
        const v = value as { results: Array<{ engine: string; status: string; results?: number; error?: string; sampleTitle?: string }> }
        const lines = v.results.map((r) => {
          if (r.status === 'ok') {
            return `- ${r.engine}: OK (${r.results} results${r.sampleTitle ? `, e.g. "${r.sampleTitle.slice(0, 40)}"` : ''})`
          }
          return `- ${r.engine}: FAIL - ${r.error}`
        })
        return [{ type: 'text' as const, text: `Search engine test:\n${lines.join('\n')}` }]
      },
    },
    async execute(args: { engines?: string[]; query?: string }) {
      const engines = args.engines && args.engines.length > 0 ? args.engines : [...ALL_ENGINES]
      const results: Array<Record<string, unknown>> = []
      for (const engine of engines) {
        const r = await runEngineTest(engine, args.query)
        if (r.ok) {
          const item: Record<string, unknown> = { engine, status: 'ok', results: r.sources.length }
          if (r.sources[0]?.title) item.sampleTitle = String(r.sources[0].title)
          if (r.sources[0]?.url) item.sampleUrl = String(r.sources[0].url)
          results.push(item)
        } else {
          results.push({ engine, status: 'fail', error: r.error ?? 'unknown error' })
        }
      }
      return { results }
    },
  })
}
