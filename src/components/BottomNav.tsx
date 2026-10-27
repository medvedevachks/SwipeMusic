import { NavLink } from 'react-router-dom'
import {
  HomeIcon,
  LibraryIcon,
  ProfileIcon,
  SearchIcon,
} from './icons'

const navItems: {
  to: string
  label: string
  Icon: typeof HomeIcon
  end?: boolean
}[] = [
  { to: '/', label: 'Главная', Icon: HomeIcon, end: true },
  { to: '/search', label: 'Поиск', Icon: SearchIcon },
  { to: '/library', label: 'Библиотека', Icon: LibraryIcon },
  { to: '/profile', label: 'Профиль', Icon: ProfileIcon },
]

export default function BottomNav() {
  return (
    <nav
      className="app-nav border-t border-[var(--color-border)] bg-[var(--color-nav)]/95 backdrop-blur-md"
      aria-label="Основная навигация"
    >
      <ul className="mx-auto flex h-14 max-w-2xl items-stretch justify-between px-1 sm:h-16 sm:px-2">
        {navItems.map(({ to, label, Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'flex h-full flex-col items-center justify-center gap-0.5 text-[10px] transition-colors sm:text-xs',
                  isActive
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'font-normal text-[var(--color-muted)] hover:text-[var(--color-fg)]',
                ].join(' ')
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
