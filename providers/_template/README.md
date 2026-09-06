# Шаблон ProviderPlugin

1. Скопируйте `_template` → `MyProvider`
2. Отредактируйте `manifest.ts`, `MusicSourceAdapter.ts`, `LibraryProvider.ts`
3. Зарегистрируйте одной строкой:

```ts
import { registerPlugin } from '../../src/sdk'
import { myProviderPlugin } from './index'

registerPlugin(myProviderPlugin)
```

См. [docs/providers.md](../../docs/providers.md).
