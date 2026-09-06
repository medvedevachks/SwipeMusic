import type { ProviderCapabilities, ProviderManifest } from '../../src/sdk'

const capabilities: ProviderCapabilities = {
  search: true,
  library: true,
  streaming: true,
  download: false,
  artwork: false,
  authentication: false,
  lyrics: false,
}

export const MY_PROVIDER_MANIFEST: ProviderManifest = {
  id: 'my-provider',
  name: 'My Provider',
  version: '0.1.0',
  author: 'Your Name',
  icon: 'music',
  description: 'Пример источника для SwipeMusic Provider SDK',
  defaultEnabled: false,
  defaultPriority: 80,
  capabilities,
}
