import { AdapterLibraryProvider } from '../../src/library/providers/AdapterLibraryProvider'
import type { LibraryProvider } from '../../src/types/libraryProvider'
import type { ProviderContext } from '../../src/sdk'
import { createMyProviderAdapter } from './MusicSourceAdapter'

export function createMyLibraryProvider(
  ctx: ProviderContext,
): LibraryProvider {
  const adapter = createMyProviderAdapter(ctx)
  return new AdapterLibraryProvider(adapter)
}
