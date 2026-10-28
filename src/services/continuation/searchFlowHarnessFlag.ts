/** Лёгкий флаг без импорта плеера/очереди — безопасен для homeStage и store. */
export function isSearchFlowHarnessEnabled(): boolean {
  try {
    return import.meta.env.VITE_SEARCH_FLOW_HARNESS === 'true'
  } catch {
    return false
  }
}
