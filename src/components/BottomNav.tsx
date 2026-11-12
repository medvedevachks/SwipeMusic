import { NavLink } from 'react-router-dom'
import {
  LibraryIcon,
  SearchIcon,
  SwipesIcon,
  WaveIcon,
} from './icons'

const navItems: {
  to: string
  label: string
  Icon: typeof SwipesIcon
  end?: boolean
}[] = [
  { to: '/', label: 'Свайпы', Icon: SwipesIcon, end: true },
  { to: '/wave', label: 'Моя волна', Icon: WaveIcon, end: true },
  { to: '/search', label: 'Поиск', Icon: SearchIcon },
  { to: '/library', label: 'Библиотека', Icon: LibraryIcon },
]

export default function BottomNav() {
  return (
    <nav
      className="app-nav border-t border-[var(--color-border)] bg-[var(--color-nav)]/95 backdrop-blur-md"
      aria-label="Основная навигация"
      data-testid="primary-bottom-nav"
    >
      <ul className="app-nav-list mx-auto flex h-14 max-w-2xl items-stretch justify-between px-1 sm:h-16 sm:px-2">
        {navItems.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1 min-w-0">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex h-full min-h-11 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] transition-colors sm:text-xs',
                  isActive
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'font-normal text-[var(--color-muted)] hover:text-[var(--color-fg)]',
                ].join(' ')
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
