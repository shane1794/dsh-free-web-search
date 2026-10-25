/**
 * Plugin-owned durable settings for the free web search engines.
 *
 * Storage is a plain JSON file under the harness home, not a harness service:
 * the settings seam changed shape between kernel lines (0.1.x exposes a
 * registrable namespace, 0.2.x projects volatile plugin config and exports
 * neither `settingsNamespace` nor `installSettingsSection`). A file the plugin
 * owns behaves identically on both, and it keeps the engine choice readable and
 * editable without the app running.
 *
 * Writes land through a temp file + rename, so a crash mid-write cannot leave a
 * truncated store.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Same resolution the harness home-paths helper uses: `$DSH_HOME` else `~/.dsh`. */
export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export const FREE_SEARCH_DIR = 'free-search'

/** Fields never echoed back to the browser; `describe` reports them as markers. */
export const SECRET_FIELDS = [
  'anysearchApiKey',
  'exaApiKey',
  'tavilyApiKey',
  'keenableApiKey',
  'perplexityApiKey',
  'deepseekApiKey',
] as const

/** Every field the store accepts; anything else in a mutate op is rejected. */
export const WRITABLE_FIELDS = [
  'provider',
  'lang',
  'cache',
  'cacheTtl',
  'platforms',
  'rotation',
  ...SECRET_FIELDS,
] as const

export type WritableField = (typeof WRITABLE_FIELDS)[number]

export interface FreeSearchSettings {
  provider?: string
  lang?: string
  cache?: boolean
  cacheTtl?: number
  platforms?: string[]
  rotation?: string
  anysearchApiKey?: string
  exaApiKey?: string
  tavilyApiKey?: string
  keenableApiKey?: string
  perplexityApiKey?: string
  deepseekApiKey?: string
}

export interface SettingsView {
  ns: string
  value: FreeSearchSettings
  secrets: Array<{ path: string[]; set: boolean }>
  revision: number
}

export class SettingsConflictError extends Error {
  code = 'settings-conflict'
}

export interface MutateOp {
  op: string
  path: string[]
  value?: unknown
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class SettingsFile {
  readonly file: string
  private readonly base: () => FreeSearchSettings
  private readonly log: (message: string) => void
  private value: FreeSearchSettings = {}
  private revision = 0

  constructor(file: string, base: () => FreeSearchSettings, log: (message: string) => void = () => {}) {
    this.file = file
    this.base = base
    this.log = log
    this.load()
  }

  private load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return // first run: no file yet, base config alone decides
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isPlainObject(parsed)) {
        this.value = this.sanitize(parsed)
        this.revision = typeof parsed.__revision === 'number' ? parsed.__revision : 1
      }
    } catch (error) {
      this.log(`free-search: ignoring unreadable settings file ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Keep only known fields with plausible types; a hand-edited file cannot poison the engine config. */
  private sanitize(source: Record<string, unknown>): FreeSearchSettings {
    const next: FreeSearchSettings = {}
    for (const field of WRITABLE_FIELDS) {
      const raw = source[field]
      if (raw === undefined) continue
      if (field === 'cache') {
        if (typeof raw === 'boolean') next.cache = raw
        continue
      }
      if (field === 'cacheTtl') {
        const n = Number(raw)
        if (Number.isFinite(n)) next.cacheTtl = Math.min(Math.max(n, 0), 5)
        continue
      }
      if (field === 'platforms') {
        if (Array.isArray(raw)) next.platforms = raw.filter((p): p is string => typeof p === 'string')
        continue
      }
      if (field === 'rotation') {
        if (raw === 'off' || raw === 'round-robin') next.rotation = raw
        continue
      }
      if (typeof raw === 'string') (next as Record<string, unknown>)[field] = raw
    }
    return next
  }

  private flush(): void {
    const payload = JSON.stringify({ ...this.value, __revision: this.revision }, null, 2)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      fs.writeFileSync(temp, payload, 'utf8')
      fs.renameSync(temp, this.file)
    } catch (error) {
      this.log(`free-search: could not write ${this.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Values the user chose. Never contains base config. */
  get(): FreeSearchSettings {
    return { ...this.value }
  }

  /** Base config with the user's choices layered on top. */
  effective(): FreeSearchSettings {
    return { ...this.base(), ...this.value }
  }

  view(ns: string): SettingsView {
    const effective = this.effective()
    const redacted: FreeSearchSettings = { ...effective }
    const secrets = SECRET_FIELDS.map((field) => {
      const set = typeof effective[field] === 'string' && (effective[field] as string).length > 0
      delete redacted[field]
      return { path: [field as string], set }
    })
    return { ns, value: redacted, secrets, revision: this.revision }
  }

  /** Apply `{op:'set'|'unset', path:[field], value}` ops atomically. */
  mutate(ops: unknown, expectedRevision?: number): SettingsView {
    if (!Array.isArray(ops) || ops.length === 0) throw new Error('malformed settings request: ops must be a non-empty array')
    if (expectedRevision !== undefined && expectedRevision !== this.revision) {
      throw new SettingsConflictError(`settings changed elsewhere (revision ${this.revision} != ${expectedRevision})`)
    }
    const next: FreeSearchSettings = { ...this.value }
    for (const raw of ops) {
      if (!isPlainObject(raw)) throw new Error('malformed settings request: op must be an object')
      const op = raw.op
      const fieldPath = raw.path
      if (!Array.isArray(fieldPath) || fieldPath.length !== 1 || typeof fieldPath[0] !== 'string') {
        throw new Error('malformed settings request: path must be a single field name')
      }
      const field = fieldPath[0]
      if (!(WRITABLE_FIELDS as readonly string[]).includes(field)) {
        throw new Error(`unknown settings field "${field}"`)
      }
      if (op === 'unset') {
        delete next[field as WritableField]
        continue
      }
      if (op !== 'set') throw new Error(`unsupported settings op "${String(op)}"`)
      const value = raw.value
      if (field === 'cache') {
        if (typeof value !== 'boolean') throw new Error('cache must be a boolean')
        next.cache = value
      } else if (field === 'cacheTtl') {
        const n = Number(value)
        if (!Number.isFinite(n)) throw new Error('cacheTtl must be a number')
        next.cacheTtl = Math.min(Math.max(n, 0), 5)
      } else if (field === 'platforms') {
        if (!Array.isArray(value)) throw new Error('platforms must be an array')
        next.platforms = value.filter((p): p is string => typeof p === 'string')
      } else if (field === 'rotation') {
        if (value !== 'off' && value !== 'round-robin') throw new Error('rotation must be "off" or "round-robin"')
        next.rotation = value
      } else {
        if (typeof value !== 'string') throw new Error(`${field} must be a string`)
        if (value === '') delete next[field as WritableField]
        else (next as Record<string, unknown>)[field] = value
      }
    }
    this.value = next
    this.revision += 1
    this.flush()
    return this.view('free-search')
  }
}
