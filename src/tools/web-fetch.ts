import { defineTool } from '@deepseek-ai/dsh-tools'
import { webFetch } from '../engines/web-fetch.js'

export function createWebFetchTool() {
  return defineTool({
    name: 'web_fetch',
    description:
      'Fetch and read the content of a single web page. Returns the page text with HTML tags stripped. Use this to read articles, documentation, or any URL the user provides.',
    parameters: {
      url: {
        type: 'string' as const,
        description: 'The URL to fetch.',
      },
      maxLength: {
        type: 'number' as const,
        description: 'Maximum content length in characters (default 50000).',
      },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          url: { type: 'string' as const },
          title: { type: 'string' as const },
          content: { type: 'string' as const },
          truncated: { type: 'boolean' as const },
        },
      },
      render(_args: unknown, value: unknown) {
        const v = value as { url: string; title: string; content: string; truncated: boolean }
        const header = v.title ? `# ${v.title}\n${v.url}` : v.url
        const suffix = v.truncated ? '\n\n[content truncated]' : ''
        return [{ type: 'text' as const, text: `${header}\n\n${v.content}${suffix}` }]
      },
    },
    async execute(args: { url?: string; maxLength?: number }) {
      if (!args.url?.trim()) throw new Error('url is required')
      let url = args.url.trim()
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`
      return webFetch(url, args.maxLength ?? 50_000)
    },
  })
}
