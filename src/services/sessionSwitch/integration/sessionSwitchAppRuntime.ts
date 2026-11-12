/**
 * Singleton app-runtime session-switch (PLAYBACK-DEV-06).
 * Создаётся только при feature flag ON + подтверждённом userId.
 */
import type { PlaybackSessionStore } from '../../playbackSession/PlaybackSessionStore.ts'
import type { PlaybackSessionPersistence } from '../../playbackSession/persistence.ts'
import type { SessionSwitchCoordinator } from '../SessionSwitchCoordinator.ts'
import type { SessionSwitchRuntime } from './createSessionSwitchRuntime.ts'

export type SessionSwitchAppRuntime = SessionSwitchRuntime & {
  store: PlaybackSessionStore
  persistence: PlaybackSessionPersistence
  userId: string
  deviceId: string
  /** Поколение bootstrap — для идемпотентности. */
  bootstrapGeneration: number
}

let appRuntime: SessionSwitchAppRuntime | null = null
let bootstrapGeneration = 0

export function getSessionSwitchAppRuntime(): SessionSwitchAppRuntime | null {
  return appRuntime
}

export function getSessionSwitchCoordinator(): SessionSwitchCoordinator | null {
  return appRuntime?.coordinator ?? null
}

export function setSessionSwitchAppRuntime(
  runtime: SessionSwitchAppRuntime | null,
): void {
  appRuntime = runtime
}

export function bumpSessionSwitchBootstrapGeneration(): number {
  bootstrapGeneration += 1
  return bootstrapGeneration
}

export function getSessionSwitchBootstrapGeneration(): number {
  return bootstrapGeneration
}

/** Тесты. */
export function resetSessionSwitchAppRuntimeForTests(): void {
  appRuntime = null
  bootstrapGeneration = 0
}
