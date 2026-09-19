import { test, expect } from '@playwright/test'

const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173'

test.describe('sources', () => {
  test('lists zaycev as a music source', async ({ page }) => {
    await page.goto(`${origin}/search`)
    await expect(page.getByRole('heading', { name: 'Поиск' })).toBeVisible()
    await expect(page.getByText('Zaycev.net')).toBeVisible()
  })

  test('zaycev details stay available after reload', async ({ page }) => {
    await page.goto(`${origin}/search/zaycev`)
    await expect(page.getByRole('heading', { name: 'Zaycev.net' })).toBeVisible()
    await expect(page.getByText('Открыть в сервисе')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Zaycev.net' })).toBeVisible()
    await expect(page.getByText('Добавить ссылку')).toBeVisible()
  })

  test('lists yandex music as a source', async ({ page }) => {
    await page.goto(`${origin}/search`)
    await expect(page.getByText('Яндекс Музыка')).toBeVisible()
  })
})
