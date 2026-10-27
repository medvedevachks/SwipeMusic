import type { RadioSelection } from './recommend.ts'

/** Только Vite DEV. В обычном интерфейсе переключателя нет. */
export const DEV_RADIO_SELECTION_KEY = 'swipe-music.dev.radio-selection'

let selection: RadioSelection = 'library'

function readDevOverride(): RadioSelection | null {
  try {
    if (import.meta.env?.DEV !== true) {
      return null
    }
    const stored = sessionStorage.getItem(DEV_RADIO_SELECTION_KEY)
    return stored === 'taste' || stored === 'library' ? stored : null
  } catch {
    return null
  }
}

/** По умолчанию остаётся прежний подбор по явным лайкам. */
export function getRadioSelection(): RadioSelection {
  return readDevOverride() ?? selection
}

export function setRadioSelection(next: RadioSelection): void {
  selection = next
}
