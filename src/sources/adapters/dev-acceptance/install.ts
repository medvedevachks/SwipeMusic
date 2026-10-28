/**
 * Ставит контролируемый DEV-каталог в SourceManager.
 * Recommendation Engine / AudioPlayer / UI остаются штатными.
 */
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

  const adapter = createDevAcceptanceAdapter()
  try {
    sourceManager.addSource(
      {
        id: DEV_ACCEPTANCE_SOURCE_ID,
        name: 'DEV Acceptance Catalog',
        type: 'api',
        enabled: true,
        priority: 1,
        settings: { acceptance: true },
      },
      adapter,
    )
  } catch {
    // Уже добавлен (HMR) — включаем.
    sourceManager.enableSource(DEV_ACCEPTANCE_SOURCE_ID)
  }

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
