export type ThemeChoice = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'swipe-music.theme'

export type ThemeTokens = {
  bg: string
  fg: string
  muted: string
  border: string
  surface: string
  accent: string
  accentFg: string
}

export const THEME_TOKENS: Record<ThemeChoice, ThemeTokens> = {
  light: {
    bg: '#f3f5f7',
    fg: '#14212b',
    muted: '#5b6b76',
    border: '#d7dee3',
    surface: '#ffffff',
    accent: '#0f766e',
    accentFg: '#ffffff',
  },
  dark: {
    bg: '#10161b',
    fg: '#e6eef2',
    muted: '#93a3ad',
    border: '#2a3640',
    surface: '#1b242c',
    accent: '#1f8f84',
    accentFg: '#f4fffd',
  },
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark'
}

export function systemTheme(): ThemeChoice {
  if (typeof matchMedia !== 'function') {
    return 'light'
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readStoredTheme(): ThemeChoice | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(stored) ? stored : null
  } catch {
    return null
  }
}

export function resolveTheme(): ThemeChoice {
  return readStoredTheme() ?? systemTheme()
}

export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const color = document.querySelector('meta[name="theme-color"]')
  if (color) {
    color.setAttribute('content', THEME_TOKENS[theme].bg)
  }
}

export function storeTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Приватный режим не должен ломать переключение на текущей вкладке.
  }
}

export function commitTheme(theme: ThemeChoice): void {
  applyTheme(theme)
  storeTheme(theme)
}

export function applyStoredTheme(): ThemeChoice {
  const theme = resolveTheme()
  applyTheme(theme)
  return theme
}
