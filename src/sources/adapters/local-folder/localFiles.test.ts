import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../../types/playbackAvailability.ts'
import { createTrack } from '../../normalizeTrack.ts'
import { ObjectUrlCache } from './ObjectUrlCache.ts'
import { scanDirectoryForAudio } from './directoryScanner.ts'
import {
  FileSystemMusicAdapter,
  type LocalLibraryStoragePort,
  type LocalMediaIndexPort,
} from './FileSystemMusicAdapter.ts'
import {
  assessLocalCapability,
  type LocalCapability,
} from './localCapability.ts'
import type { LocalLibrarySnapshot } from './types.ts'
import type { Track } from '../../../types/track.ts'

type FakeNode = { name: string; handle: object }
type ScanMode = 'ok' | 'fail' | 'abort'

function fileNode(name: string): FakeNode {
  return {
    name,
    handle: {
      kind: 'file',
      name,
      getFile: async () => new File([Uint8Array.from([1, 2, 3])], name),
    },
  }
}

function directoryNode(name: string, children: FakeNode[]): FakeNode {
  return {
    name,
    handle: {
      kind: 'directory',
      name,
      values: async function* values() {
        for (const child of children) {
          yield child.handle
        }
      },
      entries: async function* entries() {
        for (const child of children) {
          yield [child.name, child.handle]
        }
      },
    },
  }
}

function supportedCapability(): LocalCapability {
  return { supported: true, blocker: null, message: null }
}

function createLibrary(initial: FakeNode[]) {
  const state = {
    mode: 'ok' as ScanMode,
    entries: initial,
    permission: 'granted' as PermissionState,
    queries: 0,
    requests: 0,
  }
  const root = {
    kind: 'directory',
    name: 'Music',
    values: async function* values() {
      openEntries(state)
      for (const entry of state.entries) {
        yield entry.handle
      }
    },
    entries: async function* entries() {
      openEntries(state)
      for (const entry of state.entries) {
        yield [entry.name, entry.handle]
      }
    },
    queryPermission: async () => {
      state.queries += 1
      return state.permission
    },
    requestPermission: async () => {
      state.requests += 1
      return state.permission
    },
  }
  let handle: FileSystemDirectoryHandle | null =
    root as unknown as FileSystemDirectoryHandle
  let snapshot: LocalLibrarySnapshot | null = null
  const indexed: string[][] = []
  const cleared: string[] = []
  const storage: LocalLibraryStoragePort = {
    async saveDirectoryHandle(value) {
      handle = value
    },
    async loadDirectoryHandle() {
      return handle
    },
    async saveLibrarySnapshot(value) {
      snapshot = value
    },
    async loadLibrarySnapshot() {
      return snapshot
    },
    async clear() {
      handle = null
      snapshot = null
    },
  }
  const mediaIndex: LocalMediaIndexPort = {
    async indexTracks(_sourceId, tracks: Track[]) {
      for (const track of tracks) {
        assert.equal(track.previewUrl, null)
        assert.equal(String(track.previewUrl ?? '').startsWith('blob:'), false)
      }
      indexed.push(tracks.map((track) => track.externalId))
    },
    async clearSource(sourceId) {
      cleared.push(sourceId)
    },
  }
  const adapter = new FileSystemMusicAdapter({
    id: 'local-folder',
    capability: supportedCapability,
    storage,
    mediaIndex,
  })
  return {
    adapter,
    state,
    storage,
    indexed,
    cleared,
    snapshot: () => snapshot,
    root: root as unknown as FileSystemDirectoryHandle,
  }
}

function openEntries(state: { mode: ScanMode }): void {
  if (state.mode === 'fail') {
    throw new Error('read failed')
  }
  if (state.mode === 'abort') {
    throw new DOMException('Scanning aborted', 'AbortError')
  }
}

function sampleTree(): FakeNode[] {
  return [
    fileNode('notes.txt'),
    directoryNode('a', [fileNode('song.mp3')]),
    directoryNode('b', [
      fileNode('song.mp3'),
      directoryNode('nested', [fileNode('track.flac')]),
    ]),
  ]
}

function pathsOf(tracks: Track[]): string[] {
  return tracks.map((track) => track.externalId).sort()
}

test('local capability reports a reason without asking for permission', () => {
  assert.deepEqual(
    assessLocalCapability({
      isSecureContext: false,
      hasDirectoryPicker: true,
      hasIndexedDb: true,
      hasObjectUrl: true,
    }),
    {
      supported: false,
      blocker: 'insecure-context',
      message: 'Нужен secure context / HTTPS.',
    },
  )
  assert.equal(
    assessLocalCapability({
      isSecureContext: true,
      hasDirectoryPicker: false,
      hasIndexedDb: true,
      hasObjectUrl: true,
    }).message,
    'Directory picker недоступен.',
  )
  assert.equal(
    assessLocalCapability({
      isSecureContext: true,
      hasDirectoryPicker: true,
      hasIndexedDb: false,
      hasObjectUrl: true,
    }).message,
    'IndexedDB недоступен.',
  )
  assert.equal(
    assessLocalCapability({
      isSecureContext: true,
      hasDirectoryPicker: true,
      hasIndexedDb: true,
      hasObjectUrl: false,
    }).blocker,
    'object-url-missing',
  )
  assert.equal(
    assessLocalCapability({
      isSecureContext: true,
      hasDirectoryPicker: true,
      hasIndexedDb: true,
      hasObjectUrl: true,
    }).supported,
    true,
  )
})

test('recursive scan keeps relative paths and ignores unsupported files', async () => {
  const root = directoryNode('Music', sampleTree())
    .handle as FileSystemDirectoryHandle
  const result = await scanDirectoryForAudio(root)
  assert.deepEqual(
    result.files.map((file) => file.relativePath).sort(),
    ['a/song.mp3', 'b/nested/track.flac', 'b/song.mp3'],
  )
  assert.equal(result.subdirectoryCount, 3)
  assert.equal(result.files.some((file) => file.fileName === 'notes.txt'), false)

  const empty = await scanDirectoryForAudio(
    directoryNode('Empty', []).handle as FileSystemDirectoryHandle,
  )
  assert.deepEqual(empty.files, [])
  assert.equal(empty.subdirectoryCount, 0)
})

test('saved handle restores granted access without requesting permission', async () => {
  const library = createLibrary(sampleTree())
  await library.adapter.initialize()
  assert.equal(library.state.requests, 0)
  assert.equal(library.state.queries > 0, true)
  assert.equal(library.adapter.accessState, 'granted')
  const page = await library.adapter.fetchTracks()
  assert.deepEqual(pathsOf(page.tracks), [
    'a/song.mp3',
    'b/nested/track.flac',
    'b/song.mp3',
  ])
  assert.deepEqual([...(library.indexed.at(-1) ?? [])].sort(), pathsOf(page.tracks))
  const playable = await library.adapter.checkTrackAvailability(page.tracks[0]!)
  assert.equal(playable.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('prompt and denied handles stay non-playable until a user gesture', async () => {
  const prompt = createLibrary([fileNode('song.mp3')])
  prompt.state.permission = 'prompt'
  await prompt.adapter.initialize()
  assert.equal(prompt.state.requests, 0)
  assert.equal(prompt.adapter.accessState, 'prompt')
  assert.equal(prompt.adapter.getStats().folderName, 'Music')
  assert.equal(prompt.indexed.length, 0)
  const track = createTrack({
    sourceId: 'local-folder',
    externalId: 'song.mp3',
    title: 'song',
    artist: 'Unknown Artist',
  })
  const probe = await prompt.adapter.checkTrackAvailability(track)
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)

  const denied = createLibrary([fileNode('song.mp3')])
  denied.state.permission = 'denied'
  await denied.adapter.initialize()
  assert.equal(denied.state.requests, 0)
  assert.equal(denied.adapter.accessState, 'denied')

  const missing = createLibrary([])
  await missing.storage.clear()
  await missing.adapter.initialize()
  assert.equal(missing.adapter.accessState, 'idle')
  assert.equal(missing.adapter.getStats().folderName, null)
})

test('unsupported local capability is not playable', async () => {
  const adapter = new FileSystemMusicAdapter({
    id: 'local-folder',
    capability: () => ({
      supported: false,
      blocker: 'directory-picker-missing',
      message: 'Directory picker недоступен.',
    }),
  })
  assert.equal(adapter.accessState, 'unsupported')
  const track = createTrack({
    sourceId: 'local-folder',
    externalId: 'song.mp3',
    title: 'song',
    artist: 'Unknown Artist',
  })
  const probe = await adapter.checkTrackAvailability(track)
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED)
  await assert.rejects(adapter.connectFolder(), /Directory picker недоступен/)
})

test('successful rescan replaces both adapter and index', async () => {
  const library = createLibrary([fileNode('old.mp3')])
  await library.adapter.initialize()
  library.state.entries = [fileNode('new.wav')]
  await library.adapter.rescan()
  const page = await library.adapter.fetchTracks()
  assert.deepEqual(pathsOf(page.tracks), ['new.wav'])
  assert.deepEqual(library.indexed.at(-1), ['new.wav'])
  assert.deepEqual(library.snapshot()?.relativePaths, ['new.wav'])
  assert.equal(JSON.stringify(library.snapshot()).includes('blob:'), false)
})

test('failed and aborted rescan keep the previous library', async () => {
  const failed = createLibrary([fileNode('keep.mp3')])
  await failed.adapter.initialize()
  const before = pathsOf((await failed.adapter.fetchTracks()).tracks)
  const indexedBefore = failed.indexed.length
  failed.state.mode = 'fail'
  await assert.rejects(failed.adapter.rescan(), /read failed/)
  assert.deepEqual(pathsOf((await failed.adapter.fetchTracks()).tracks), before)
  assert.equal(failed.indexed.length, indexedBefore)
  assert.deepEqual(failed.snapshot()?.relativePaths, ['keep.mp3'])
  assert.equal(failed.adapter.getScanProgress().phase, 'error')

  const aborted = createLibrary([fileNode('keep.ogg')])
  await aborted.adapter.initialize()
  aborted.state.mode = 'abort'
  await assert.rejects(
    aborted.adapter.rescan(),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.deepEqual(pathsOf((await aborted.adapter.fetchTracks()).tracks), ['keep.ogg'])
  assert.deepEqual(aborted.indexed.at(-1), ['keep.ogg'])
  assert.equal(aborted.adapter.getScanProgress().phase, 'idle')
})

test('object URL is cached, replaced and revoked without being stored on the track', async () => {
  const created: string[] = []
  const revoked: string[] = []
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = (() => {
    const url = `blob:local-test-${created.length}`
    created.push(url)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url)
  }) as typeof URL.revokeObjectURL

  try {
    const cache = new ObjectUrlCache()
    assert.equal(cache.set('a', 'blob:first'), 'blob:first')
    assert.equal(cache.set('a', 'blob:second'), 'blob:second')
    assert.deepEqual(revoked, ['blob:first'])
    cache.clear()
    assert.deepEqual(revoked, ['blob:first', 'blob:second'])

    const library = createLibrary([fileNode('song.mp3')])
    await library.adapter.initialize()
    const track = (await library.adapter.fetchTracks()).tracks[0]!
    const first = await library.adapter.getStream(track)
    const second = await library.adapter.getStream(track)
    assert.equal(first, second)
    assert.equal(created.length, 1)
    assert.equal(track.previewUrl, null)

    library.state.entries = [fileNode('other.mp3')]
    await library.adapter.rescan()
    assert.equal(revoked.includes(first), true)
    const replacement = (await library.adapter.fetchTracks()).tracks[0]!
    assert.equal(replacement.previewUrl, null)
    const next = await library.adapter.getStream(replacement)
    assert.notEqual(next, first)

    await library.adapter.disconnect()
    assert.equal(revoked.includes(next), true)
    assert.equal((await library.adapter.fetchTracks()).tracks.length, 0)
    assert.equal(library.cleared.includes('local-folder'), true)
    assert.equal(library.snapshot(), null)
    assert.equal(library.adapter.accessState, 'idle')
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})
