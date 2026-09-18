import { z } from 'zod'

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Укажите имя').max(80),
    lastName: z.string().trim().min(1, 'Укажите фамилию').max(80),
    email: z.string().trim().email('Некорректный email').max(254),
    password: z.string().min(8, 'Пароль не короче 8 символов').max(128),
    passwordConfirm: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  })

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
})

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).max(128),
    passwordConfirm: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  })

export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
})

export const changeEmailSchema = z.object({
  newEmail: z.string().trim().email().max(254),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: z.string().min(8).max(128),
    passwordConfirm: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  })

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
})

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
