# Local fork — dsh-free-web-search 0.1.0-fork.2

Built for **DeepSeek Harness desktop, kernel 0.2.1-rc.3** (Electron build, Oct 2026).

## Why this fork exists

Upstream 0.1.0 (commit 354b95a, 2026-08-30) is written against dsh-settings 0.1.x:

1. it imports `installSettingsSection` and `settingsNamespace`, which the kernel's
   `@deepseek-ai/dsh-settings` 0.2.1-rc.3 no longer exports (0.2.x exports only
   `SettingsConflictError`, `SettingsForms`, `redactSecrets`) — the bundle composed into
   the profile tree and then **failed to import**, so no engine, no tools, no page:

   ```
   SyntaxError: The requested module '@deepseek-ai/dsh-settings'
   does not provide an export named 'installSettingsSection'
   ```

2. its browser half registers the `settings.plugin.item` slot, which does not exist on
   this kernel line (the shell exposes `settings.section`), and declares
   `dsh.client.inject: ["@deepseek-ai/dsh-client-runtime"]`, a package this build does
   not ship.

## What was changed

| File | Change |
|---|---|
| `src/bridge/store.ts` | **new** — plugin-owned settings file (`$DSH_HOME/free-search/settings.json`), atomic temp+rename writes, allowlisted fields, secret redaction, revision counter |
| `src/bridge/routes.ts` | rewritten — same three loopback POST routes (`describe`, `mutate`, `raw-search`) but backed by that file instead of the harness settings service |
| `src/index.ts` | store created at apply time; `current()` layers the file over the entry config and is read per request; bridge registered on `webServer` |
| `src/constants.ts` | `FREE_SEARCH_NS` is the plain string `'free-search'` |
| `src/client/bridge.ts` | **new** — shared `BRIDGE_PREFIX`, `NS`, `ENGINES`, typed fetch helpers |
| `src/client/SettingsPage.tsx` | **new** — full settings page (engine picker, optional API keys, cache TTL, platform toggles, engine test) |
| `src/client/index.ts` | registers `settings.section` id `free-web-search` + the `/free-search-engine` command |
| `src/client/FreeSearchCard.tsx` | deleted (upstream card targeted a slot this kernel lacks) |
| `package.json` | `version` → `0.1.0-fork.2`; `dsh.client` = `{platform:"web", immediately:true, inject:[]}`; `files` = `lib/index.js`, `lib/client.js`, `cordis.patch.yml` |

Everything else is upstream: 10 engines, fallback chain, LRU cache, `advanced_search`,
`platform_search`, `web_fetch`, `free_search_test`, and the `web` search provider
registered under id `ddg`.

## Runtime layout

- Engine choice + API keys: **Settings → Free Web Search** (own page) or the
  `/free-search-engine` chat command; persisted to `$DSH_HOME/free-search/settings.json`
  (`{"provider":"ddg","cacheTtl":5,...}`), created on first save.
- Entry config (`provider`, `bingMarket`, `cache`, `cacheTtl`, `platforms`,
  `searxngInstances`) still comes from the `web-search-free` cordis entry; the settings
  file wins over it field by field.

```yaml
- id: web-search-free
  name: dsh-free-web-search
  config:
    provider: bing          # ddg | ddg-lite | bing | searxng | anysearch | exa | tavily | keenable | perplexity | deepseek-official
    bingMarket: en-US
    cache: true
    cacheTtl: 5
    platforms: [github, reddit]
```

- The page is a `settings.section`, not the upstream card — the shell lists the module in
  its bootstrap: `{"id":"dsh-free-web-search","url":"plugins/??dsh-free-web-search/client.js…"}`.
- To make the harness' own `web_search` tool use these engines, the profile's
  `cordis.patch.yml` must set `web.searchProvider: ddg` (the profile layer is applied
  after bundle layers, so it overrides the bundle's own patch).

## Rebuild + reinstall

```bash
cd ~/.hermes/cache/scratch/dsh-fws/dsh-free-web-search
npm install                                # dev deps
npm run build                              # tsc typecheck + tsdown client
npx tsdown -c tsdown.prepare.config.ts     # bundle lib/index.js
find lib -mindepth 1 ! -name index.js ! -name client.js ! -name client.js.map -exec rm -rf {} +

# app must be fully quit before the profile changes
powershell -NoProfile -Command "Stop-Process -Name 'DeepSeek Harness' -Force"

MSYS_NO_PATHCONV=1 npm pack --ignore-scripts \
  --pack-destination "C:/Users/dhane/.dsh/profiles/desktop/vendor"

PNPM="C:/Users/dhane/AppData/Local/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
node "$PNPM" install --dir "C:/Users/dhane/.dsh/profiles/desktop"
```

Keep exactly one `dsh-free-web-search-*.tgz` in `vendor/` — a second `file:` target makes
the pnpm swap ambiguous. `profiles/desktop/package.json` must point at the new filename and
list `dsh-free-web-search` in `dsh.profile.bundles`.

No `compatibility.json` exemption is needed: the plugin declares only `engines.node` plus
`@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-tools` peers (`>=0.1.0-rc.6`), which
0.2.1-rc.3 satisfies under `semver.satisfies(v, range, { includePrerelease: true })` — the
check `dsh-app-boot` actually runs.

## Verifying without the GUI

Boot any web profile that mounts the bundle (a scratch profile with
`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-free-web-search`), then use the
`?token=` URL the launcher prints:

```bash
curl -sL -c ck -b ck "http://127.0.0.1:3080/?token=<token>" -o /dev/null
curl -s -b ck -H 'content-type: application/json' -X POST -d '{}' \
  http://127.0.0.1:3080/api/dsh-free-web-search-settings/describe
curl -s -b ck -H 'content-type: application/json' -X POST \
  -d '{"query":"deepseek harness"}' \
  http://127.0.0.1:3080/api/dsh-free-web-search-settings/raw-search
```

The `raw-search` call runs a real engine request through the plugin's own code path.

## Rollback

Remove the `dsh-free-web-search` dependency + `bundles` entry from
`profiles/desktop/package.json`, then `pnpm install` in that directory. Delete
`$DSH_HOME/free-search/` to drop the plugin's stored settings.

## Prefer upstream when it catches up

If upstream publishes a build that targets kernel 0.2.x, install that instead of this
fork.
