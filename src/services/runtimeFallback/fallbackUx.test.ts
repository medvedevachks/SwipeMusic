import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityStatus,
  type SourceCopyAvailability,
} from '../../types/playbackAvailability.ts'
import {
  RUNTIME_FALLBACK_POLICY,
  RUNTIME_FALLBACK_STATUS,
  type PlaybackAttemptOutcome,
  type PlaybackAttemptPort,
  type PlaybackAttemptRequest,
  type RuntimeFallbackResult,
} from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import {
  buildFallbackUx,
  buildManualAlternatives,
  decideConfirmation,
  emptyFallbackUx,
  playbackErrorOwner,
  playbackFailureLabel,
  recheckUnknownCopy,
  switchToPlayableCopy,
  visibleFallbackText,
  withRecheckedStatus,
} from './fallbackUxModel.ts'
import { RuntimePlaybackFallbackOrchestrator } from './RuntimePlaybackFallbackOrchestrator.ts'

const CANONICAL_ID = 'can_ux'

function copyOf(sourceId: string, externalId: string): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: CANONICAL_ID,
    sourceId,
    externalId,
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: 180_000,
    artworkUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function statusOf(copy: SourceCopy, status: PlaybackAvailabilityStatus): SourceCopyAvailability {
  return {
    sourceTrackKey: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    canonicalTrackId: copy.canonicalTrackId,
    status,
  }
}

function availabilityOf(copies: readonly SourceCopyAvailability[]): CanonicalPlaybackAvailability {
  const playableCopies = copies.filter((copy) => copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  return {
    canonicalTrackId: CANONICAL_ID,
    copies: [...copies],
    playableCopies,
    hasPlayableCopy: playableCopies.length > 0,
  }
}

function trackFor(copy: SourceCopy): Track {
  return {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
  }
}

const labels: Record<string, string> = {
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
  'vk-music': 'VK Музыка',
}

function labelOf(sourceId: string): string {
  return labels[sourceId] ?? sourceId
}

function portOf(
  script: Array<{ ok: true } | { ok: false }>,
  calls: string[],
): PlaybackAttemptPort {
  let index = 0
  return {
    stopPrevious() {},
    async attempt(request: PlaybackAttemptRequest): Promise<PlaybackAttemptOutcome> {
      calls.push(request.sourceTrackKey)
      const step = script[index] ?? { ok: false }
      index += 1
      if (step.ok) {
        return {
          ok: true,
          resumeAttempted: false,
          resumeSucceeded: false,
          resumeUnsupported: false,
        }
      }
      return {
        ok: false,
        positionSeconds: null,
        resumeAttempted: false,
        resumeSucceeded: false,
        resumeUnsupported: false,
      }
    },
  }
}

async function runFallback(
  copies: SourceCopy[],
  availability: CanonicalPlaybackAvailability,
  policy: 'OFF' | 'ASK' | 'AUTO',
  script: Array<{ ok: true } | { ok: false }>,
  calls: string[],
  registeredSourceIds: string[] = [],
): Promise<{ result: RuntimeFallbackResult; orchestrator: RuntimePlaybackFallbackOrchestrator; port: PlaybackAttemptPort }> {
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const port = portOf(script, calls)
  const result = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies,
      availability,
      preferredSourceTrackKey: copies[0]?.sourceTrackKey ?? null,
      policy,
      findTrack: (key) => {
        const copy = copies.find((item) => item.sourceTrackKey === key)
        return copy ? trackFor(copy) : null
      },
      registeredSources: registeredSourceIds.map((sourceId) => ({
        sourceId,
        enabled: true,
        capabilities: [],
      })),
    },
    port,
  )
  return { result, orchestrator, port }
}

test('AUTO switch notice names both providers and stays non-blocking', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const calls: string[] = []
  const { result } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [{ ok: false }, { ok: true }],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.equal(model.kind, 'notice')
  assert.equal(model.blocking, false)
  assert.equal(model.noticeText, 'Источник переключён: Alpha → Beta')
  assert.equal(model.title, null)
  assert.deepEqual(calls, [copyA.sourceTrackKey, copyB.sourceTrackKey])
})

test('AUTO success suppresses the obsolete first-source error', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const { result } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [{ ok: false }, { ok: true }],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1, {
    [copyA.sourceTrackKey]: 'DOMException: Failed to load',
  })
  assert.equal(model.ownsPlayerError, true)
  assert.equal(model.kind, 'notice')
  assert.equal(model.kind === 'notice' && model.blocking, false)
  assert.equal(visibleFallbackText(model).includes('DOMException'), false)
})

test('ASK confirmation does not start the next copy before confirm', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const calls: string[] = []
  const { result, orchestrator, port } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.ASK,
    [{ ok: false }, { ok: true }],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, orchestrator.getGeneration())
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED)
  assert.equal(model.kind, 'confirmation')
  assert.equal(model.body, 'Не удалось воспроизвести из Alpha. Доступна копия в Beta.')
  assert.deepEqual(calls, [copyA.sourceTrackKey])
  const decision = decideConfirmation({
    expectedGeneration: model.generation,
    currentGeneration: orchestrator.getGeneration(),
    action: 'confirm',
  })
  assert.equal(decision, 'attempt')
  const confirmed = await orchestrator.confirmPending(port)
  assert.equal(confirmed?.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.deepEqual(calls, [copyA.sourceTrackKey, copyB.sourceTrackKey])
})

test('ASK cancel does not start the candidate', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const calls: string[] = []
  const { result, orchestrator, port } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.ASK,
    [{ ok: false }, { ok: true }],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, orchestrator.getGeneration())
  const decision = decideConfirmation({
    expectedGeneration: model.generation,
    currentGeneration: orchestrator.getGeneration(),
    action: 'cancel',
  })
  assert.equal(decision, 'dismiss')
  orchestrator.cancel('manual-play')
  assert.equal(await orchestrator.confirmPending(port), null)
  assert.deepEqual(calls, [copyA.sourceTrackKey])
})

test('stale ASK confirmation cannot start the old composition', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const calls: string[] = []
  const { result, orchestrator, port } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.ASK,
    [{ ok: false }, { ok: true }],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, orchestrator.getGeneration())
  orchestrator.cancel('manual-play')
  const decision = decideConfirmation({
    expectedGeneration: model.generation,
    currentGeneration: orchestrator.getGeneration(),
    action: 'confirm',
  })
  assert.equal(decision, 'ignore')
  assert.equal(await orchestrator.confirmPending(port), null)
  assert.deepEqual(calls, [copyA.sourceTrackKey])
})

test('subscription UX is shown only for a known source copy', async () => {
  const subscription = copyOf('alpha', 'sub')
  const calls: string[] = []
  const { result } = await runFallback(
    [subscription],
    availabilityOf([statusOf(subscription, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.NO_PLAYABLE_COPY)
  assert.equal(calls.length, 0)
  assert.match(visibleFallbackText(model), /Нужна подписка/)
  assert.match(visibleFallbackText(model), /Композиция найдена в Alpha/)
  assert.equal(model.rows.some((row) => row.actions.some((action) => action.type === 'play')), false)
})

test('a registered provider without a source copy is not suggested', async () => {
  const subscription = copyOf('alpha', 'sub')
  const { result } = await runFallback(
    [subscription],
    availabilityOf([statusOf(subscription, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    [],
    ['spotify', 'vk-music', 'zaycev'],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  const text = visibleFallbackText(model)
  assert.equal(model.rows.some((row) => row.sourceId === 'spotify'), false)
  assert.equal(text.includes('spotify'), false)
  assert.equal(text.includes('vk-music'), false)
  assert.equal(text.includes('zaycev'), false)
  assert.equal(result.registeredSourcesWithoutCopy.length, 3)
})

test('NOT_CONNECTED offers the existing sources page and nothing else', async () => {
  const disconnected = copyOf('beta', 'off')
  const { result } = await runFallback(
    [disconnected],
    availabilityOf([statusOf(disconnected, PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  const row = model.rows[0]
  assert.equal(row?.statusText, 'Источник не подключён')
  assert.match(row?.detail ?? '', /источник не подключён/)
  assert.deepEqual(row?.actions, [{ type: 'sources' }])
})

test('AUTH_REQUIRED offers a sources action without a new auth flow', async () => {
  const auth = copyOf('gamma', 'auth')
  const { result } = await runFallback(
    [auth],
    availabilityOf([statusOf(auth, PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.match(visibleFallbackText(model), /Нужно повторно подключить Gamma/)
  assert.deepEqual(model.rows[0]?.actions, [{ type: 'sources' }])
  assert.equal(model.rows[0]?.actions.some((action) => action.type === 'play'), false)
})

test('UNKNOWN retry invalidates and rechecks without starting playback', async () => {
  const unknown = copyOf('alpha', 'unknown')
  const { result } = await runFallback(
    [unknown],
    availabilityOf([statusOf(unknown, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.match(model.rows[0]?.detail ?? '', /Не удалось проверить доступность Alpha/)
  assert.equal(model.rows[0]?.detail.includes('недоступ'), false)
  const playback: string[] = []
  let invalidated = ''
  const availability = await recheckUnknownCopy({
    sourceId: unknown.sourceId,
    invalidate: (sourceId) => {
      invalidated = sourceId
    },
    resolve: async () =>
      availabilityOf([statusOf(unknown, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)]),
    attemptPlayback: (key) => playback.push(key),
  })
  assert.equal(invalidated, unknown.sourceId)
  assert.deepEqual(playback, [])
  const refreshed = withRecheckedStatus(
    model,
    unknown.sourceTrackKey,
    availability.copies[0]!.status,
    labelOf,
  )
  assert.equal(refreshed.rows[0]?.statusText, 'Доступно')
  assert.equal(refreshed.rows[0]?.actions[0]?.type, 'play')
  assert.deepEqual(playback, [])
})

test('UNSUPPORTED has no connect, subscribe, or play action', async () => {
  const stub = copyOf('vk-music', 'stub')
  const { result } = await runFallback(
    [stub],
    availabilityOf([statusOf(stub, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED)]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  const row = model.rows[0]
  assert.equal(row?.providerLabel, 'VK Музыка')
  assert.match(row?.detail ?? '', /пока не поддерживается/)
  assert.deepEqual(row?.actions, [])
  assert.equal(visibleFallbackText(model).includes('Подключить'), false)
  assert.equal(visibleFallbackText(model).includes('подписк'), false)
})

test('all playable copies failed produces one terminal UX', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const subscription = copyOf('gamma', 'sub')
  const calls: string[] = []
  const { result } = await runFallback(
    [copyA, copyB, subscription],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(subscription, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED),
    ]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [{ ok: false }, { ok: false }],
    calls,
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED)
  assert.equal(model.kind, 'terminal')
  assert.match(model.title ?? '', /Не удалось воспроизвести композицию из доступных источников/)
  assert.deepEqual(calls, [copyA.sourceTrackKey, copyB.sourceTrackKey])
  assert.deepEqual(
    model.rows.map((row) => row.sourceId),
    ['alpha', 'beta', 'gamma'],
  )
  assert.equal(model.rows[2]?.actions[0]?.type, 'sources')
  assert.equal(model.primaryActions.filter((action) => action.type === 'retry-playback').length, 1)
})

test('attempted providers are rendered as normalized playback failures', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const { result } = await runFallback(
    [copyA, copyB],
    availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    RUNTIME_FALLBACK_POLICY.AUTO,
    [{ ok: false }, { ok: false }],
    [],
  )
  const model = buildFallbackUx(result, labelOf, 1)
  assert.deepEqual(
    model.rows.map((row) => `${row.providerLabel}:${row.statusText}`),
    ['Alpha:Ошибка воспроизведения', 'Beta:Ошибка воспроизведения'],
  )
})

test('raw provider errors are not exposed', () => {
  const raw = 'DOMException: The element has no supported sources HTTP 403 <html>secret</html>'
  assert.equal(playbackFailureLabel(raw), 'Ошибка воспроизведения')
  assert.equal(playbackFailureLabel(raw).includes('DOMException'), false)
  assert.equal(playbackFailureLabel(raw).includes('403'), false)
  assert.equal(playbackFailureLabel(raw).includes('secret'), false)
})

test('manual playable switch cancels the old session and keeps the queue index', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const order: string[] = []
  let queueIndex = 4
  const played = await switchToPlayableCopy({
    sourceTrackKey: copyB.sourceTrackKey,
    cancel: () => {
      order.push('cancel')
    },
    findTrack: (key) => (key === copyB.sourceTrackKey ? trackFor(copyB) : null),
    play: async (track, options) => {
      order.push(`play:${track.id}:${String(options.preserveQueue)}`)
    },
  })
  assert.equal(played, true)
  assert.deepEqual(order, [`cancel`, `play:${copyB.sourceTrackKey}:true`])
  assert.equal(queueIndex, 4)
  const manual = buildManualAlternatives({
    canonicalTrackId: CANONICAL_ID,
    copies: [copyA, copyB],
    availability: availabilityOf([
      statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
    labelOf,
  })
  assert.equal(manual.rows[1]?.actions[0]?.type, 'play')
  assert.equal(manual.ownsPlayerError, false)
})

test('legacy playback failure stays with the player error UX', () => {
  assert.equal(playbackErrorOwner(false), 'player')
  assert.equal(playbackErrorOwner(true), 'fallback')
  const idle = emptyFallbackUx()
  assert.equal(idle.kind, 'idle')
  assert.equal(idle.ownsPlayerError, false)
  assert.equal(idle.blocking, false)
})

test('logout clears pending fallback UX', () => {
  const session = readFileSync(new URL('../libraryPersistence/session.ts', import.meta.url), 'utf8')
  assert.match(session, /clearPlaybackFallbackUx\(\)/)
  const cleared = emptyFallbackUx()
  assert.equal(cleared.kind, 'idle')
  assert.equal(cleared.rows.length, 0)
  assert.equal(cleared.noticeText, null)
})
