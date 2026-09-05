import type { Category } from '../types/category'
import { createId } from '../utils/id'

/** Стартовый набор — системные пресеты, не зашитые в бизнес-логику свайпов. */
export function createDefaultCategories(): Category[] {
  const now = new Date().toISOString()

  const presets: Array<Pick<Category, 'name' | 'color' | 'icon'>> = [
    { name: 'Любимое', color: '#e11d48', icon: 'heart' },
    { name: 'В машину', color: '#2563eb', icon: 'car' },
    { name: 'Тренировка', color: '#ea580c', icon: 'muscle' },
    { name: 'Перед сном', color: '#7c3aed', icon: 'moon' },
    { name: 'Вечеринка', color: '#db2777', icon: 'party' },
    { name: 'Учёба', color: '#0f766e', icon: 'book' },
  ]

  return presets.map((preset, index) => ({
    id: createId('cat'),
    name: preset.name,
    color: preset.color,
    icon: preset.icon,
    description: '',
    createdAt: now,
    updatedAt: now,
    sortOrder: index,
    favorite: false,
    system: true,
  }))
}
