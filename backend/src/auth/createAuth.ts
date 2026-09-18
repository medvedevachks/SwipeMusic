import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { AppEnv } from '../env.ts'
import type { Database } from '../db/client.ts'
import * as schema from '../db/schema.ts'
import {
  changeEmailEmail,
  resetPasswordEmail,
  verificationEmail,
  type Mailer,
} from '../mail/mailer.ts'

export function createAuth(env: AppEnv, db: Database, mailer: Mailer) {
  return betterAuth({
    appName: 'Swipe Music',
    baseURL: env.APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const content = resetPasswordEmail(env.APP_ORIGIN, url)
        await mailer.send({ to: user.email, ...content })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const content = verificationEmail(env.APP_ORIGIN, url)
        await mailer.send({ to: user.email, ...content })
      },
    },
    user: {
      additionalFields: {
        firstName: { type: 'string', required: true, input: true },
        lastName: { type: 'string', required: true, input: true },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, url }) => {
          const content = changeEmailEmail(env.APP_ORIGIN, url)
          await mailer.send({ to: user.email, ...content })
        },
      },
      deleteUser: {
        enabled: true,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 8,
      storage: 'memory',
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
