import type { CategoryIconId } from '../types/category'

export const categoryIconOptions: {
  id: CategoryIconId
  glyph: string
  label: string
}[] = [
  { id: 'heart', glyph: '♥', label: 'Сердце' },
  { id: 'car', glyph: '▤', label: 'Машина' },
  { id: 'muscle', glyph: '✱', label: 'Сила' },
  { id: 'moon', glyph: '☽', label: 'Луна' },
  { id: 'party', glyph: '✦', label: 'Вечер' },
  { id: 'book', glyph: '▦', label: 'Учёба' },
  { id: 'music', glyph: '♪', label: 'Музыка' },
  { id: 'star', glyph: '★', label: 'Звезда' },
]

export const categoryColorOptions = [
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#57534e',
]

export function getCategoryGlyph(icon: CategoryIconId): string {
  return categoryIconOptions.find((item) => item.id === icon)?.glyph ?? '♪'
}
