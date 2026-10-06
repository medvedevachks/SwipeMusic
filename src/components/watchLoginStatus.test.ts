import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProviderStatusDescriptor } from '../sdk/types.ts'
import {
  isProviderActionLocked,
  watchLoginStatus,
} from './watchLoginStatus.ts'

type Phase = 'idle' | 'code' | 'connected' | 'down'

const CODE = 'ABCD1234'
const VERIFY_URL = 'https://oauth.yandex.ru/device'

function descriptorFor(phase: Phase): ProviderStatusDescriptor {
  if (phase === 'code') {
    return {
      status: 'syncing',
      title: 'Яндекс Музыка',
      description: `Подтвердите вход: код ${CODE}`,
      severity: 'info',
      actions: [{ id: 'logout', label: 'Cancel', variant: 'danger' }],
      details: [
        { label: 'Code', value: CODE },
        { label: 'URL', value: VERIFY_URL },
      ],
    }
  }
  if (phase === 'connected') {
    return {
      status: 'connected_free',
      title: 'Яндекс Музыка',
      description: 'Connected',
      severity: 'success',
      actions: [{ id: 'logout', label: 'Disconnect', variant: 'danger' }],
    }
  }
  return {
    status: 'disconnected',
    title: 'Яндекс Музыка',
    description: 'Not connected',
    severity: 'neutral',
    actions: [{ id: 'login', label: 'Connect', variant: 'primary' }],
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error('timed out waiting for status publish')
    }
    await delay(5)
  }
}

test('login pending publishes syncing descriptor with device code', async () => {
  let phase: Phase = 'idle'
  let settled = false
  const published: ProviderStatusDescriptor[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const watching = watchLoginStatus({
    login: () => {
      phase = 'code'
      return gate.then(() => {
        phase = 'connected'
        settled = true
      })
    },
    readStatus: async () => descriptorFor(phase),
    publish: (descriptor) => {
      published.push(descriptor)
    },
    intervalMs: 10,
  })

  await waitFor(() =>
    published.some((item) =>
      item.details?.some((detail) => detail.label === 'Code' && detail.value === CODE),
    ),
  )

  const pending = published.find((item) => item.status === 'syncing')
  assert.ok(pending)
  assert.equal(settled, false)
  assert.match(pending.description, new RegExp(CODE))
  assert.equal(
    pending.details?.find((detail) => detail.label === 'URL')?.value,
    VERIFY_URL,
  )
  assert.equal(
    isProviderActionLocked('login', true, 'logout'),
    false,
  )
  assert.equal(isProviderActionLocked('login', true, 'login'), true)

  release()
  await watching
  assert.equal(settled, true)
  const connected = descriptorFor(phase)
  assert.equal(connected.status, 'connected_free')
  assert.equal(connected.description, 'Connected')
})

test('oauth failure ends disconnected instead of syncing', async () => {
  let phase: Phase = 'code'
  const published: ProviderStatusDescriptor[] = []

  await assert.rejects(
    () =>
      watchLoginStatus({
        login: async () => {
          await delay(40)
          phase = 'down'
          throw new Error('Yandex OAuth token: HTTP 400')
        },
        readStatus: async () => descriptorFor(phase),
        publish: (descriptor) => {
          published.push(descriptor)
        },
        intervalMs: 10,
      }),
    /HTTP 400/,
  )

  assert.ok(published.some((item) => item.status === 'syncing' && item.description.includes(CODE)))
  const last = published.at(-1)
  assert.ok(last)
  assert.equal(last.status, 'disconnected')
  assert.equal(last.description, 'Not connected')
})

test('cancelled login clears pending status without a stuck error', async () => {
  let phase: Phase = 'code'
  let cancelled = false
  const published: ProviderStatusDescriptor[] = []

  await watchLoginStatus({
    login: async () => {
      await delay(40)
      cancelled = true
      phase = 'down'
      throw new Error('Yandex OAuth aborted')
    },
    readStatus: async () => descriptorFor(phase),
    publish: (descriptor) => {
      published.push(descriptor)
    },
    isCancelled: () => cancelled,
    intervalMs: 10,
  })

  assert.ok(published.some((item) => item.details?.some((detail) => detail.value === CODE)))
  const last = published.at(-1)
  assert.ok(last)
  assert.equal(last.status, 'disconnected')
  assert.equal(last.severity, 'neutral')
})
