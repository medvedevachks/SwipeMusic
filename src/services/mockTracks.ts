import type { TrackSeed } from '../types/track'

export type MockTrackSection = {
  id: string
  title: string
  tracks: TrackSeed[]
}

/**
 * Публичные демо-MP3 (SoundHelix).
 * Циклически назначаются трекам как previewUrl.
 */
export const DEMO_PREVIEW_URLS = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
] as const

function withPreview(tracks: Omit<TrackSeed, 'previewUrl'>[]): TrackSeed[] {
  return tracks.map((track, index) => ({
    ...track,
    previewUrl: DEMO_PREVIEW_URLS[index % DEMO_PREVIEW_URLS.length],
  }))
}

const recommended = withPreview([
  {
    id: 'r1',
    title: 'Midnight Drive',
    artist: 'Nova Lane',
    coverColor: '#0f766e',
  },
  {
    id: 'r2',
    title: 'Soft Static',
    artist: 'Echo Park',
    coverColor: '#b45309',
  },
  {
    id: 'r3',
    title: 'Glass Horizon',
    artist: 'Kite & Coil',
    coverColor: '#1e3a5f',
  },
  {
    id: 'r4',
    title: 'Warm Signal',
    artist: 'Lumen Dust',
    coverColor: '#9f1239',
  },
  {
    id: 'r5',
    title: 'Afterglow',
    artist: 'Field Theory',
    coverColor: '#365314',
  },
])

const popular = withPreview([
  {
    id: 'p1',
    title: 'City Lights',
    artist: 'Arcade Rain',
    coverColor: '#155e75',
  },
  {
    id: 'p2',
    title: 'Low Tide',
    artist: 'Maris',
    coverColor: '#7c2d12',
  },
  {
    id: 'p3',
    title: 'Paper Planes',
    artist: 'Northline',
    coverColor: '#44403c',
  },
  {
    id: 'p4',
    title: 'Velvet Hour',
    artist: 'Sable',
    coverColor: '#831843',
  },
  {
    id: 'p5',
    title: 'Fast Forward',
    artist: 'Pulse Room',
    coverColor: '#134e4a',
  },
])

const recentlyAdded = withPreview([
  {
    id: 'a1',
    title: 'First Light',
    artist: 'Dawn Circuit',
    coverColor: '#854d0e',
  },
  {
    id: 'a2',
    title: 'Blue Room',
    artist: 'Haze',
    coverColor: '#1e40af',
  },
  {
    id: 'a3',
    title: 'Copper Sky',
    artist: 'Atlas Peak',
    coverColor: '#9a3412',
  },
  {
    id: 'a4',
    title: 'Quiet Riot',
    artist: 'Mono Club',
    coverColor: '#3f3f46',
  },
  {
    id: 'a5',
    title: 'Orbit',
    artist: 'Satellite Kids',
    coverColor: '#0e7490',
  },
])

export const homeSections: MockTrackSection[] = [
  { id: 'recommended', title: 'Рекомендуемое', tracks: recommended },
  { id: 'popular', title: 'Популярное', tracks: popular },
  { id: 'recent', title: 'Недавно добавленное', tracks: recentlyAdded },
]
