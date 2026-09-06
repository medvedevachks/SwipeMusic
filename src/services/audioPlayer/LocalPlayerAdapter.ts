import { HtmlAudioPlayerAdapter } from './HtmlAudioPlayerAdapter'
import type { PlayerAdapter } from './PlayerAdapter'

/**
 * Локальный / HTTP / blob playback (Local Files, Demo, preview URL).
 * Имя по архитектуре PlayerManager — обёртка над HtmlAudioPlayerAdapter.
 */
export class LocalPlayerAdapter
  extends HtmlAudioPlayerAdapter
  implements PlayerAdapter
{
  readonly sourceId = 'local'

  canHandleUrl(url: string): boolean {
    return !url.startsWith('spotify:')
  }
}
