/**
 * Ставит контролируемый DEV-каталог в SourceManager + LibraryProvider.
 * Recommendation Engine / AudioPlayer / UI остаются штатными.
 */
import {
  bootstrapProviderPlugins,
  pluginFromAdapter,
  registerPlugin,
} from '../../../sdk/index.ts'
import { sourceManager } from '../../SourceManager.ts'
import { musicSourceRegistry } from '../../registry.ts'
import { createDevAcceptanceAdapter } from './devAcceptanceAdapter.ts'
import { DEV_ACCEPTANCE_SOURCE_ID } from './catalog.ts'

let installed = false

export function installDevAcceptanceSource(): void {
  if (installed) {
    return
  }
  installed = true

  bootstrapProviderPlugins()
  const adapter = createDevAcceptanceAdapter()
  // Plugin-first: SourceManager + LibraryProvider (Albums tree → ALBUM session).
  registerPlugin(
    pluginFromAdapter(adapter, {
      name: 'DEV Acceptance Catalog',
      defaultEnabled: true,
      defaultPriority: 1,
    }),
  )

  // Демо mock не участвует в Recommendation Engine; оставляем выключенным если можно.
  try {
    sourceManager.disableSource('mock')
  } catch {
    // последний enabled нельзя выключить — ok
  }
  sourceManager.enableSource(DEV_ACCEPTANCE_SOURCE_ID)
  musicSourceRegistry.setActive(DEV_ACCEPTANCE_SOURCE_ID)

  if (import.meta.env.DEV) {
    console.info('[dev-acceptance] source installed and enabled:', DEV_ACCEPTANCE_SOURCE_ID)
  }
}

export { DEV_ACCEPTANCE_SOURCE_ID }
