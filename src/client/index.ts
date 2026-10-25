// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Context = any

import { ENGINES, NS, bridgeDescribe, bridgeMutate } from './bridge.js'
import { FreeSearchSettingsPage } from './SettingsPage.js'

/**
 * Browser half of dsh-free-web-search.
 *
 * Contributes two things to the web shell:
 *   1. a settings page (`settings.section` id `free-web-search`) — engine
 *      choice, optional API keys, cache TTL, platform toggles, engine test;
 *   2. the `/free-search-engine` chat command that switches the engine.
 *
 * Data is read over the plugin's own same-origin bridge
 * (`/api/dsh-free-web-search-settings/*`), served by the same host process.
 * The upstream `settings.plugin.item` slot does not exist on this kernel line,
 * which is why this registers a full section instead of a card.
 */

export const inject = ['slots', 'commandUi'] as const

export function apply(ctx: Context) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'free-web-search',
        order: 60,
        label: () => 'Free Web Search',
      },
      FreeSearchSettingsPage,
    ),
  )

  ctx.inject(['commandUi'], (sctx: Context) => {
    const command = sctx.get('commandUi')
    sctx.effect(() => {
      const dispose = command.register({
        name: 'free-search-engine',
        description: 'Ganti engine web search (free-search plugin)',
        available: () => true,
        ui: {
          kind: 'popupSelect',
          options: async () => {
            const result = await bridgeDescribe()
            const view = result.ok ? result.value?.namespaces.find(n => n.ns === NS) : undefined
            const current = ((view?.value as Record<string, unknown> | undefined)?.provider as string) ?? 'bing'
            return ENGINES.map(engine => ({
              id: engine.id,
              label: `${engine.label}${engine.badge === 'FREE' ? ' · Free' : ' · API key'}`,
              detail: engine.id === current ? 'aktif' : undefined,
              active: engine.id === current,
            }))
          },
          onSelect: async (option: { id: string }) => {
            await bridgeMutate({ ns: NS, ops: [{ op: 'set', path: ['provider'], value: option.id }] })
          },
        },
      })
      return dispose
    }, 'free-web-search: /free-search-engine command')
  })
}
