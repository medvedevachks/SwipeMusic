import type { Category } from '../types/category'
import { createId } from '../utils/id'

/** Стартовый набор — примеры, не зашитые в бизнес-логику. */
export function createDefaultCategories(): Category[] {
  const now = new Date().toISOString()

  return [
    {
      id: createId('cat'),
      name: 'Любимое',
      color: '#e11d48',
      icon: 'heart',
      createdAt: now,
    },
    {
      id: createId('cat'),
      name: 'В машину',
      color: '#2563eb',
      icon: 'car',
      createdAt: now,
    },
    {
      id: createId('cat'),
      name: 'Тренировка',
      color: '#ea580c',
      icon: 'muscle',
      createdAt: now,
    },
    {
      id: createId('cat'),
      name: 'Перед сном',
      color: '#7c3aed',
      icon: 'moon',
      createdAt: now,
    },
    {
      id: createId('cat'),
      name: 'Вечеринка',
      color: '#db2777',
      icon: 'party',
      createdAt: now,
    },
    {
      id: createId('cat'),
      name: 'Учёба',
      color: '#0f766e',
      icon: 'book',
      createdAt: now,
    },
  ]
}
