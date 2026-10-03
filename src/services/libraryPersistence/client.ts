import type { Category, TrackAssignment } from '../../types/category'
import type { GestureConfig } from '../../types/gesture'
import type { HistoryEntry } from '../../types/history'
import type { LibraryStateDto } from './mapLibraryState.ts'

export class LibraryHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super('LIBRARY_HTTP')
    this.name = 'LibraryHttpError'
    this.status = status
  }
}

async function request(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (response.status === 204) {
    return null
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new LibraryHttpError(response.status)
  }
  return payload
}

export const libraryClient = {
  loadState(): Promise<LibraryStateDto> {
    return request('/api/me/library-state') as Promise<LibraryStateDto>
  },

  createCategory(category: Category): Promise<void> {
    return request('/api/me/categories', {
      method: 'POST',
      body: {
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        description: category.description,
        sortOrder: category.sortOrder,
        favorite: category.favorite,
        system: category.system,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      },
    }).then(() => undefined)
  },

  updateCategory(category: Category): Promise<void> {
    return request(`/api/me/categories/${encodeURIComponent(category.id)}`, {
      method: 'PATCH',
      body: {
        name: category.name,
        icon: category.icon,
        color: category.color,
        description: category.description,
        sortOrder: category.sortOrder,
        favorite: category.favorite,
        updatedAt: category.updatedAt,
      },
    }).then(() => undefined)
  },

  deleteCategory(id: string): Promise<void> {
    return request(`/api/me/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then(() => undefined)
  },

  upsertTrack(trackId: string, body: Record<string, unknown>): Promise<void> {
    return request(`/api/me/collection/tracks/${encodeURIComponent(trackId)}`, {
      method: 'PUT',
      body,
    }).then(() => undefined)
  },

  deleteTrack(trackId: string): Promise<void> {
    return request(`/api/me/collection/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    }).then(() => undefined)
  },

  assign(trackId: string, assignment: TrackAssignment): Promise<void> {
    return request(
      `/api/me/collection/tracks/${encodeURIComponent(trackId)}/categories/${encodeURIComponent(assignment.categoryId)}`,
      { method: 'PUT', body: { id: assignment.id } },
    ).then(() => undefined)
  },

  unassign(trackId: string, categoryId: string): Promise<void> {
    return request(
      `/api/me/collection/tracks/${encodeURIComponent(trackId)}/categories/${encodeURIComponent(categoryId)}`,
      { method: 'DELETE' },
    ).then(() => undefined)
  },

  appendHistory(entry: HistoryEntry): Promise<void> {
    return request('/api/me/history', {
      method: 'POST',
      body: {
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt,
        sourceId: entry.sourceId,
        track: entry.track,
        ...(entry.category ? { category: entry.category } : {}),
      },
    }).then(() => undefined)
  },

  updateGesture(gestureConfig: GestureConfig): Promise<void> {
    return request('/api/me/settings', {
      method: 'PATCH',
      body: { gestureConfig },
    }).then(() => undefined)
  },
}
