import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractBingUrl, extractDdgUrl } from '../lib/engines/common.js'

// The wrapper Bing actually served on 2026-08-30, entities and all. Kept
// verbatim: the `&amp;` is the whole point — as returned, this URL answers 204,
// and a model citing it sends the reader nowhere.
const WRAPPED =
  'https://www.bing.com/ck/a?!&amp;&amp;p=4f1ac8ce9beb3ca5a617c746497a261eb2a181348c4d8e409b6eeb9f363e3020JmltdHM9MTc4ODA0ODAwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=1959bc31-effe-6d67-0199-abf4eedf6c90&amp;u=a1aHR0cHM6Ly9kZWVwc2Vlay5jb20vZW4vaW5kZXguaHRtbA&amp;ntb=1'

test('a Bing redirect wrapper unwraps to the page it points at', () => {
  assert.equal(extractBingUrl(WRAPPED), 'https://deepseek.com/en/index.html')
})

test('a direct Bing result href keeps its target and loses its entities', () => {
  assert.equal(
    extractBingUrl('https://example.com/a?x=1&amp;y=2'),
    'https://example.com/a?x=1&y=2',
  )
})

test('a wrapper with no u= parameter degrades to the decoded wrapper', () => {
  const noTarget = 'https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;ntb=1'
  assert.equal(extractBingUrl(noTarget), 'https://www.bing.com/ck/a?!&&p=abc&ntb=1')
})

test('a u= that does not decode to an http(s) URL degrades to the decoded wrapper', () => {
  const junk = 'https://www.bing.com/ck/a?u=a1bm90LWEtdXJs&amp;ntb=1'
  assert.equal(extractBingUrl(junk), 'https://www.bing.com/ck/a?u=a1bm90LWEtdXJs&ntb=1')
})

test('a non-URL href is returned as it is, not dropped', () => {
  assert.equal(extractBingUrl('/search?q=x'), '/search?q=x')
})

test('a missing href is null, so the caller can skip the block', () => {
  assert.equal(extractBingUrl(undefined), null)
  assert.equal(extractBingUrl(''), null)
})

test('DuckDuckGo redirects unwrap through uddg even with entities around them', () => {
  assert.equal(
    extractDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=deadbeef'),
    'https://example.com/a',
  )
})
