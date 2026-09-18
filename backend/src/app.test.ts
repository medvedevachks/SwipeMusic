import { describe, expect, it } from 'vitest'
import {
  loginSchema,
  normalizeEmail,
  registerSchema,
  resetPasswordSchema,
} from './auth/validation.ts'
import { isSnapshotEmpty } from './sync/engine.ts'
import type { CollectionSnapshot } from './sync/types.ts'

describe('validation', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com')
  })

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      firstName: 'Иван',
      lastName: 'Петров',
      email: 'ivan@example.com',
      password: 'password1',
      passwordConfirm: 'password2',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse({
      firstName: 'Иван',
      lastName: 'Петров',
      email: 'ivan@example.com',
      password: 'password1',
      passwordConfirm: 'password1',
    })
    expect(result.success).toBe(true)
  })

  it('hides login field details', () => {
    const result = loginSchema.safeParse({ email: 'bad', password: '' })
    expect(result.success).toBe(false)
  })

  it('requires reset token and matching passwords', () => {
    const result = resetPasswordSchema.safeParse({
      token: '',
      password: 'password1',
      passwordConfirm: 'password1',
    })
    expect(result.success).toBe(false)
  })
})

describe('snapshot emptiness', () => {
  it('treats deleted-only collections as empty', () => {
    const snapshot: CollectionSnapshot = {
      categories: [
        {
          id: 'c1',
          name: 'x',
          color: '#000',
          icon: 'heart',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
      ],
      items: [],
      decisions: [],
      settings: null,
    }
    expect(isSnapshotEmpty(snapshot)).toBe(true)
  })

  it('does not treat live categories as empty', () => {
    const snapshot: CollectionSnapshot = {
      categories: [
        {
          id: 'c1',
          name: 'x',
          color: '#000',
          icon: 'heart',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      items: [],
      decisions: [],
      settings: null,
    }
    expect(isSnapshotEmpty(snapshot)).toBe(false)
  })
})
