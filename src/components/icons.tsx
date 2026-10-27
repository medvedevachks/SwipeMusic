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

export function PlayIcon(props: IconProps) {
  return (
    <svg {...iconProps({ fill: 'currentColor', stroke: 'none', ...props })}>
      <path d="M8.6 6.4c-.5-.3-1.1.1-1.1.7v10.2c0 .6.6 1 1.1.7l8.4-5.1c.5-.3.5-1.1 0-1.4L8.6 6.4Z" />
    </svg>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...iconProps({ fill: 'currentColor', stroke: 'none', ...props })}>
      <rect x="6.5" y="5.5" width="3.4" height="13" rx="1.2" />
      <rect x="14.1" y="5.5" width="3.4" height="13" rx="1.2" />
    </svg>
  )
}

export function PreviousIcon(props: IconProps) {
  return (
    <svg {...iconProps({ fill: 'currentColor', stroke: 'none', ...props })}>
      <rect x="5" y="6" width="2.2" height="12" rx="0.6" />
      <path d="M18.5 6.8 10.2 12l8.3 5.2V6.8Z" />
    </svg>
  )
}

export function NextIcon(props: IconProps) {
  return (
    <svg {...iconProps({ fill: 'currentColor', stroke: 'none', ...props })}>
      <path d="M5.5 6.8 13.8 12 5.5 17.2V6.8Z" />
      <rect x="16.8" y="6" width="2.2" height="12" rx="0.6" />
    </svg>
  )
}

export function ShuffleIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 7h3.2l3.2 5 3.2-5H17" />
      <path d="m15 5 2.2 2L15 9" />
      <path d="M4 17h3.2l3.2-5 3.2 5H17" />
      <path d="m15 15 2.2 2L15 19" />
    </svg>
  )
}

export function RepeatIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M17 5.5h-7.2A4.8 4.8 0 0 0 5 10.3V13" />
      <path d="M7 18.5h7.2A4.8 4.8 0 0 0 19 13.7V11" />
      <path d="m15 3.5 2.2 2L15 7.5" />
      <path d="m9 20.5-2.2-2L9 16.5" />
    </svg>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="6" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function VolumeIcon(props: IconProps & { level: 'mute' | 'low' | 'mid' | 'high' }) {
  const { level, ...rest } = props
  return (
    <svg {...iconProps(rest)}>
      <path d="M4.5 10h2.8L11 6.8v10.4L7.3 14H4.5v-4Z" fill="currentColor" stroke="none" />
      {level === 'mute' ? <path d="m15 9 5 6M20 9l-5 6" /> : null}
      {level === 'low' || level === 'mid' || level === 'high' ? (
        <path d="M14.5 10.2a2.6 2.6 0 0 1 0 3.6" />
      ) : null}
      {level === 'mid' || level === 'high' ? <path d="M16.6 8.4a5 5 0 0 1 0 7.2" /> : null}
      {level === 'high' ? <path d="M18.6 6.6a7.4 7.4 0 0 1 0 10.8" /> : null}
    </svg>
  )
}
