import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBingResults } from '../lib/engines/bing.js'

const SERP = readFileSync(fileURLToPath(new URL('./fixtures/bing-serp.html', import.meta.url)), 'utf8')

test('every source parsed off a real SERP is a page URL, not a bing.com redirect', () => {
  const sources = parseBingResults(SERP, 10)
  assert.ok(sources.length >= 2, `expected the fixture to yield results, got ${sources.length}`)
  for (const source of sources) {
    assert.doesNotMatch(source.url, /bing\.com/, `still a Bing wrapper: ${source.url}`)
    assert.doesNotMatch(source.url, /&amp;/, `entities survived into the URL: ${source.url}`)
    assert.match(source.url, /^https?:\/\//)
  }
})

test('the first result keeps its title and snippet in readable text', () => {
  const [first] = parseBingResults(SERP, 1)
  assert.equal(first?.url, 'https://deepseek.com/en/index.html')
  assert.equal(first?.title, 'DeepSeek | Into the Unknown')
  assert.match(first?.snippet ?? '', /AI research company/)
})

test('maxResults bounds the list', () => {
  assert.equal(parseBingResults(SERP, 1).length, 1)
})
