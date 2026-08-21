import { USER_AGENT, ACCEPT_LANG } from './common.js'

export interface FetchedPage {
  url: string
  title: string
  content: string
  truncated: boolean
}

export async function webFetch(
  url: string,
  maxLength: number = 50_000,
  signal?: AbortSignal,
): Promise<FetchedPage> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': ACCEPT_LANG,
        accept: 'text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()

  let title = ''
  let content: string

  if (contentType.includes('text/html') || contentType.includes('xhtml')) {
    title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
    content = htmlToText(raw)
  } else {
    content = raw
  }

  const truncated = content.length > maxLength
  if (truncated) content = content.slice(0, maxLength)

  return { url, title, content, truncated }
}

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
