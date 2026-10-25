import { useCallback, useEffect, useState } from 'react'
import { ENGINES, NS, bridgeDescribe, bridgeMutate, bridgeRawSearch } from './bridge.js'
import type { RawSearchResult } from './bridge.js'

/**
 * Free Web Search settings page.
 *
 * Renders into the shell's `settings.section` slot as a full page. Everything is
 * read and written over the plugin's own loopback bridge, so the page works on
 * every kernel line this fork targets — no harness settings service involved.
 */

const CSS = [
  '.dshfs{display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font-size:13px}',
  '.dshfs-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
  '.dshfs-h{font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}',
  '.dshfs-engines{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}',
  '.dshfs-engine{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;min-width:0}',
  '.dshfs-engine:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshfs-engineOn{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2)}',
  '.dshfs-ename{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshfs-badge{flex:none;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
  '.dshfs-badgeFree{color:var(--dsw-alias-state-success-primary);border-color:currentColor}',
  '.dshfs-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
  '.dshfs-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
  '.dshfs-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.dshfs-input{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}',
  '.dshfs-input:focus{outline:1px solid var(--dsw-alias-state-success-primary)}',
  '.dshfs-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.dshfs-btn{padding:7px 14px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit;cursor:pointer}',
  '.dshfs-btn:disabled{opacity:.5;cursor:default}',
  '.dshfs-btnPrimary{background:var(--dsw-alias-state-success-primary);border-color:transparent;color:var(--dsw-alias-bg-layer-1)}',
  '.dshfs-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}',
  '.dshfs-err{color:var(--dsw-alias-state-error-primary);font-size:12px}',
  '.dshfs-sep{height:1px;background:var(--dsw-alias-border-l2);margin:2px 0}',
].join('')

const KEY_FIELDS = [
  { field: 'exaApiKey', label: 'Exa API key', link: 'https://dashboard.exa.ai/api-keys' },
  { field: 'tavilyApiKey', label: 'Tavily API key', link: 'https://app.tavily.com/home' },
  { field: 'keenableApiKey', label: 'Keenable API key', link: 'https://keenable.ai/login' },
  { field: 'perplexityApiKey', label: 'Perplexity API key', link: 'https://www.perplexity.ai/settings/api' },
  { field: 'deepseekApiKey', label: 'DeepSeek API key', link: 'https://platform.deepseek.com/api_keys' },
] as const

type Status = 'loading' | 'ready' | 'unavailable'

export function FreeSearchSettingsPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [file, setFile] = useState<string>('')
  const [provider, setProvider] = useState('bing')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [platforms, setPlatforms] = useState<string[]>(['github', 'reddit'])
  const [cacheTtl, setCacheTtl] = useState(5)
  const [cacheOn, setCacheOn] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const [testResult, setTestResult] = useState<RawSearchResult | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await bridgeDescribe()
      const view = result.ok ? result.value?.namespaces.find(n => n.ns === NS) : undefined
      if (!view) {
        setStatus('unavailable')
        return
      }
      const v = (view.value ?? {}) as Record<string, unknown>
      setProvider(typeof v.provider === 'string' ? v.provider : 'bing')
      setPlatforms(Array.isArray(v.platforms) ? v.platforms as string[] : ['github', 'reddit'])
      setCacheTtl(typeof v.cacheTtl === 'number' ? v.cacheTtl : 5)
      setCacheOn(v.cache !== false)
      const flags: Record<string, boolean> = {}
      for (const secret of view.secrets ?? []) {
        const name = secret.path.join('.')
        if (secret.set) flags[name] = true
      }
      setConfigured(flags)
      setKeys({})
      setFile(result.value?.file ?? '')
      setStatus('ready')
      setDirty(false)
    } catch {
      setStatus('unavailable')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const ops: Array<{ op: string; path: string[]; value: unknown }> = [
        { op: 'set', path: ['provider'], value: provider },
        { op: 'set', path: ['platforms'], value: platforms },
        { op: 'set', path: ['cacheTtl'], value: cacheTtl },
        { op: 'set', path: ['cache'], value: cacheOn },
      ]
      for (const { field } of KEY_FIELDS) {
        const value = (keys[field] ?? '').trim()
        if (value) ops.push({ op: 'set', path: [field], value })
      }
      const result = await bridgeMutate({ ns: NS, ops })
      if (result.ok) {
        setMessage({ kind: 'ok', text: 'Tersimpan. Engine langsung dipakai request berikutnya.' })
        await load()
      } else {
        setMessage({ kind: 'err', text: result.message ?? 'Gagal menyimpan.' })
      }
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Gagal menyimpan.' })
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async (field: string) => {
    setBusy(true)
    try {
      const result = await bridgeMutate({ ns: NS, ops: [{ op: 'unset', path: [field] }] })
      if (!result.ok) setMessage({ kind: 'err', text: result.message ?? 'Gagal menghapus key.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setTestResult(null)
    setMessage(null)
    try {
      const result = await bridgeRawSearch({ query: q, engine: provider })
      if (result.ok && result.value) {
        setTestResult(result.value)
      } else {
        setMessage({ kind: 'err', text: result.message ?? 'Test gagal.' })
      }
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Test gagal.' })
    } finally {
      setBusy(false)
    }
  }

  const togglePlatform = (id: string) => {
    setPlatforms(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]))
    setDirty(true)
  }

  if (status === 'loading') return <div className="dshfs"><style>{CSS}</style><div className="dshfs-note">Memuat…</div></div>
  if (status === 'unavailable') {
    return (
      <div className="dshfs">
        <style>{CSS}</style>
        <div className="dshfs-err">Bridge plugin tidak menjawab. Restart DeepSeek Harness, lalu buka halaman ini lagi.</div>
      </div>
    )
  }

  return (
    <div className="dshfs">
      <style>{CSS}</style>

      <div>
        <div className="dshfs-h">Mesin pencari</div>
        <div className="dshfs-engines">
          {ENGINES.map(engine => (
            <div
              key={engine.id}
              className={`dshfs-engine${engine.id === provider ? ' dshfs-engineOn' : ''}`}
              onClick={() => { setProvider(engine.id); setDirty(true); setTestResult(null) }}
              role="radio"
              aria-checked={engine.id === provider}
            >
              <span className="dshfs-ename">{engine.label}</span>
              <span className={`dshfs-badge${engine.badge === 'FREE' ? ' dshfs-badgeFree' : ''}`}>{engine.badge}</span>
            </div>
          ))}
        </div>
        <div className="dshfs-note" style={{ marginTop: 8 }}>
          Kalau engine terpilih gagal atau kosong, plugin otomatis coba engine berikutnya.
        </div>
      </div>

      <div className="dshfs-sep" />

      <div>
        <div className="dshfs-h">API key (opsional)</div>
        <div className="dshfs-grid">
          {KEY_FIELDS.map(({ field, label }) => (
            <label key={field} className="dshfs-field">
              <span className="dshfs-label">
                {label}{configured[field] ? ' — tersimpan' : ''}
              </span>
              <span className="dshfs-row">
                <input
                  className="dshfs-input"
                  type="password"
                  autoComplete="off"
                  placeholder={configured[field] ? '••••••••' : 'kosong'}
                  value={keys[field] ?? ''}
                  onChange={event => {
                    setKeys(prev => ({ ...prev, [field]: event.target.value }))
                    setDirty(true)
                  }}
                />
                {configured[field] ? (
                  <button className="dshfs-btn" type="button" disabled={busy} onClick={() => void clearKey(field)}>Hapus</button>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="dshfs-sep" />

      <div>
        <div className="dshfs-h">Perilaku</div>
        <div className="dshfs-grid">
          <div className="dshfs-field">
            <span className="dshfs-label">Cache TTL (menit, 0–5)</span>
            <input
              className="dshfs-input"
              type="number"
              min={0}
              max={5}
              value={cacheTtl}
              onChange={event => { setCacheTtl(Number(event.target.value)); setDirty(true) }}
            />
          </div>
          <div className="dshfs-field">
            <span className="dshfs-label">Cache</span>
            <label className="dshfs-row" style={{ paddingTop: 6 }}>
              <input
                type="checkbox"
                checked={cacheOn}
                onChange={event => { setCacheOn(event.target.checked); setDirty(true) }}
              />
              <span className="dshfs-note">Simpan hasil sebentar untuk mengurangi rate limit</span>
            </label>
          </div>
        </div>
        <div className="dshfs-row" style={{ marginTop: 10 }}>
          {['github', 'reddit'].map(id => (
            <label key={id} className="dshfs-row" style={{ gap: 6 }}>
              <input type="checkbox" checked={platforms.includes(id)} onChange={() => togglePlatform(id)} />
              <span className="dshfs-label">platform_search: {id}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="dshfs-row">
        <button className="dshfs-btn dshfs-btnPrimary" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button className="dshfs-btn" type="button" disabled={busy || !dirty} onClick={() => void load()}>Batal</button>
        {message ? <span className={message.kind === 'ok' ? 'dshfs-ok' : 'dshfs-err'}>{message.text}</span> : null}
      </div>

      <div className="dshfs-sep" />

      <div>
        <div className="dshfs-h">Tes engine</div>
        <div className="dshfs-row">
          <input
            className="dshfs-input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="query uji, mis. deepseek harness"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void test() }}
          />
          <button className="dshfs-btn" type="button" disabled={busy || query.trim() === ''} onClick={() => void test()}>
            Jalankan
          </button>
        </div>
        {testResult ? (
          <div className="dshfs-note" style={{ marginTop: 8 }}>
            <div className="dshfs-ok">
              {testResult.provider} · {testResult.sources?.length ?? 0} hasil
            </div>
            {(testResult.sources ?? []).slice(0, 3).map((source, index) => (
              <div key={index} style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {index + 1}. {source.title ?? source.url ?? '(tanpa judul)'}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {file ? <div className="dshfs-note">Config: {file}</div> : null}
    </div>
  )
}
