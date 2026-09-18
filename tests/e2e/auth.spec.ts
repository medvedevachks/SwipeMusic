import { test, expect } from '@playwright/test'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173'

test.describe('auth pages', () => {
  test('register page renders required fields', async ({ page }) => {
    await page.goto(`${origin}/register`)
    await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible()
    await expect(page.getByText('Имя')).toBeVisible()
    await expect(page.getByText('Фамилия')).toBeVisible()
    await expect(page.getByText('Email')).toBeVisible()
  })

  test('login page links to recovery', async ({ page }) => {
    await page.goto(`${origin}/login`)
    await expect(page.getByRole('link', { name: 'Восстановить пароль' })).toBeVisible()
    await page.goto(`${origin}/forgot-password`)
    await expect(page.getByRole('heading', { name: 'Восстановление доступа' })).toBeVisible()
  })

  test('profile is reachable after reload', async ({ page }) => {
    await page.goto(`${origin}/profile`)
    await expect(page.getByRole('heading', { name: /Профиль|Личный кабинет/ })).toBeVisible()
  })
})
