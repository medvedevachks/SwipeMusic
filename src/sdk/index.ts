/**
 * SwipeMusic Provider Plugin SDK
 *
 * Добавление источника:
 *   registerPlugin(myPlugin)
 *
 * См. docs/providers.md
 */

export type {
  ProviderCapabilities,
  ProviderManifest,
  ProviderPlugin,
  ProviderContext,
  ProviderSettings,
  ProviderStorage,
  SearchProvider,
  MetadataProvider,
  ArtworkProvider,
  AuthenticationProvider,
  ProviderStatusCode,
  ProviderStatusSeverity,
  ProviderSetupStep,
  ProviderSetupDescriptor,
  ProviderStatusActionId,
  ProviderStatusAction,
  ProviderStatusDetail,
  ProviderStatusDescriptor,
  Downloader,
} from './types'
export { EMPTY_CAPABILITIES, isProviderConnectedStatus } from './types'

export {
  PluginRegistry,
  pluginRegistry,
  registerPlugin,
  getPlugin,
  getEnabledPlugins,
  enablePlugin,
  disablePlugin,
} from './PluginRegistry'

export { createProviderContext } from './createProviderContext'
export { platformEventBus, EventBus } from './EventBus'
export type { PlatformEventMap, PlatformEventName } from './EventBus'

export { HttpClient } from './http'
export type {
  HttpClientConfig,
  HttpRequestOptions,
  HttpResponse,
} from './http'

export {
  MemoryCacheProvider,
  IndexedDbCacheProvider,
} from './cache'
export type { CacheProvider } from './cache'

export { createProviderLogger } from './logger'
export type { ProviderLogger } from './logger'

export {
  bootstrapProviderPlugins,
  pluginFromAdapter,
} from './bootstrap'
