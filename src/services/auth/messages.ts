export function authFormError(error: unknown): string {
  if (error instanceof Error && error.message === 'Failed to fetch') {
    return 'Не удалось связаться с сервером'
  }
  return 'Не удалось выполнить запрос'
}
