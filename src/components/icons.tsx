import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function iconProps(props: IconProps) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function LibraryIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 5h3v14H4zM10 5h3v14h-3zM16 6.5 20 5v14l-4 1.5z" />
    </svg>
  )
}

export function PlayerIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9.5v5l5-2.5-5-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ProfileIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </svg>
  )
}
