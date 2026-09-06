import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка произвольного веб-сайта / HTML-парсера. */
export function createCustomWebsiteAdapter(options?: {
  id?: string
  label?: string
}): MusicSourceAdapter {
  const id = options?.id ?? 'custom-website'
  const label = options?.label ?? 'Custom website'

  return createUnimplementedSourceAdapter({
    id,
    label,
    kind: 'web',
    capabilities: ['browse', 'search'],
  })
}

/** @deprecated Используйте createCustomWebsiteAdapter. */
export function createWebSourceAdapterStub(options?: {
  id?: string
  label?: string
}): MusicSourceAdapter {
  return createCustomWebsiteAdapter(options)
}
