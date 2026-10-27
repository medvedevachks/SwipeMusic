import { ingestPlaybackAnalytics } from './runtime.ts'
import { setPlaybackAnalyticsSink } from './report.ts'

let attached = false

/** Единственная точка: плеер сообщает факты, сеть и БД остаются снаружи. */
export function attachPlaybackAnalytics(): void {
  if (attached) {
    return
  }
  attached = true
  setPlaybackAnalyticsSink(ingestPlaybackAnalytics)
}
