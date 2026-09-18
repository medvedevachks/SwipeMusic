import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Auth } from './auth/createAuth.ts'
import { assertRateLimit } from './auth/rateLimit.ts'
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  normalizeEmail,
  profileUpdateSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth/validation.ts'
import type { Database } from './db/client.ts'
import { profiles, user } from './db/schema.ts'
import { applyOperations, isSnapshotEmpty, loadSnapshot } from './sync/engine.ts'
import type { SyncOperation } from './sync/types.ts'

type Variables = {
  userId: string
  email: string
  emailVerified: boolean
  firstName: string
  lastName: string
  createdAt: string
}

export function createApp(options: {
  auth: Auth
  db: Database
  appOrigin: string
}) {
  const { auth, db, appOrigin } = options
  const app = new Hono<{ Variables: Variables }>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  app.post('/api/register', async (c) => {
    const parsed = registerSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
    }

    const email = normalizeEmail(parsed.data.email)
    const allowed = await assertRateLimit(db, 'register', email, 5, 10 * 60 * 1000)
    if (!allowed) {
      return c.json({ error: 'Слишком много попыток. Попробуйте позже.' }, 429)
    }

    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: parsed.data.password,
        name: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    })

    if (result.ok) {
      const created = await db.select().from(user).where(eq(user.email, email)).limit(1)
      const row = created[0]
      if (row) {
        await db
          .insert(profiles)
          .values({
            userId: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
          })
          .onConflictDoNothing()
      }
    }

    return result
  })

  app.post('/api/login', async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'Неверный email или пароль' }, 400)
    }
    const email = normalizeEmail(parsed.data.email)
    const allowed = await assertRateLimit(db, 'login', email, 8, 10 * 60 * 1000)
    if (!allowed) {
      return c.json({ error: 'Слишком много попыток. Попробуйте позже.' }, 429)
    }

    const response = await auth.api.signInEmail({
      body: { email, password: parsed.data.password },
      headers: c.req.raw.headers,
      asResponse: true,
    })

    if (!response.ok) {
      return c.json({ error: 'Неверный email или пароль' }, 401)
    }
    return response
  })

  app.post('/api/logout', async (c) => {
    return auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    })
  })

  app.post('/api/forgot-password', async (c) => {
    const parsed = forgotPasswordSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ ok: true })
    }
    const email = normalizeEmail(parsed.data.email)
    const allowed = await assertRateLimit(db, 'forgot', email, 3, 10 * 60 * 1000)
    if (!allowed) {
      return c.json({ ok: true })
    }
    try {
      await auth.api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${appOrigin}/reset-password`,
        },
        headers: c.req.raw.headers,
      })
    } catch {
      // Не раскрываем существование email.
    }
    return c.json({ ok: true })
  })

  app.post('/api/reset-password', async (c) => {
    const parsed = resetPasswordSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
    }
    try {
      await auth.api.resetPassword({
        body: {
          token: parsed.data.token,
          newPassword: parsed.data.password,
        },
      })
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Ссылка недействительна или уже использована' }, 400)
    }
  })

  app.post('/api/resend-verification', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ error: 'Нужна авторизация' }, 401)
    }
    const allowed = await assertRateLimit(
      db,
      'resend-verification',
      session.user.email,
      3,
      10 * 60 * 1000,
    )
    if (!allowed) {
      return c.json({ error: 'Письмо уже отправлено. Подождите перед повторной отправкой.' }, 429)
    }
    await auth.api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: `${appOrigin}/profile` },
      headers: c.req.raw.headers,
    })
    return c.json({ ok: true })
  })

  app.use('/api/me/*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ error: 'Нужна авторизация' }, 401)
    }
    const extra = session.user as typeof session.user & {
      firstName?: string
      lastName?: string
    }
    c.set('userId', session.user.id)
    c.set('email', session.user.email)
    c.set('emailVerified', Boolean(session.user.emailVerified))
    c.set('firstName', extra.firstName ?? '')
    c.set('lastName', extra.lastName ?? '')
    c.set('createdAt', new Date(session.user.createdAt).toISOString())
    await next()
  })

  app.get('/api/me', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ user: null })
    }
    const extra = session.user as typeof session.user & {
      firstName?: string
      lastName?: string
    }
    const snapshot = await loadSnapshot(db, session.user.id)
    return c.json({
      user: {
        id: session.user.id,
        firstName: extra.firstName ?? '',
        lastName: extra.lastName ?? '',
        email: session.user.email,
        emailVerified: Boolean(session.user.emailVerified),
        createdAt: new Date(session.user.createdAt).toISOString(),
        collectionEmpty: isSnapshotEmpty(snapshot),
      },
    })
  })

  app.get('/api/me/profile', async (c) => {
    const snapshot = await loadSnapshot(db, c.get('userId'))
    return c.json({
      firstName: c.get('firstName'),
      lastName: c.get('lastName'),
      email: c.get('email'),
      emailVerified: c.get('emailVerified'),
      createdAt: c.get('createdAt'),
      collectionEmpty: isSnapshotEmpty(snapshot),
    })
  })

  app.patch('/api/me/profile', async (c) => {
    const parsed = profileUpdateSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
    }
    const userId = c.get('userId')
    await db
      .update(user)
      .set({
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        name: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
    await db
      .insert(profiles)
      .values({
        userId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: c.get('email'),
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          updatedAt: new Date(),
        },
      })
    return c.json({ ok: true })
  })

  app.post('/api/me/email', async (c) => {
    const parsed = changeEmailSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
    }
    try {
      await auth.api.changeEmail({
        body: { newEmail: normalizeEmail(parsed.data.newEmail) },
        headers: c.req.raw.headers,
      })
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Не удалось изменить email' }, 400)
    }
  })

  app.post('/api/me/password', async (c) => {
    const parsed = changePasswordSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Ошибка валидации' }, 400)
    }
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: parsed.data.currentPassword,
          newPassword: parsed.data.password,
          revokeOtherSessions: true,
        },
        headers: c.req.raw.headers,
      })
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Текущий пароль неверен' }, 400)
    }
  })

  app.post('/api/me/delete', async (c) => {
    const parsed = deleteAccountSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'Подтвердите паролем удаление аккаунта' }, 400)
    }
    try {
      await auth.api.deleteUser({
        body: { password: parsed.data.password },
        headers: c.req.raw.headers,
      })
      return c.json({ ok: true })
    } catch {
      return c.json({ error: 'Не удалось удалить аккаунт' }, 400)
    }
  })

  app.get('/api/me/sync/snapshot', async (c) => {
    const snapshot = await loadSnapshot(db, c.get('userId'))
    return c.json(snapshot)
  })

  app.post('/api/me/sync/operations', async (c) => {
    const body = (await c.req.json()) as { operations?: SyncOperation[] }
    const operations = Array.isArray(body.operations) ? body.operations : []
    if (operations.length > 200) {
      return c.json({ error: 'Слишком много операций за один запрос' }, 400)
    }
    try {
      const result = await applyOperations(db, c.get('userId'), operations)
      return c.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка синхронизации'
      return c.json({ error: message }, 400)
    }
  })

  return app
}
