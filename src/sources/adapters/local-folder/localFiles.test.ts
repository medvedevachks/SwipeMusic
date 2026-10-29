import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../../types/playbackAvailability.ts'
import { createTrack } from '../../normalizeTrack.ts'
import { ObjectUrlCache } from './ObjectUrlCache.ts'
import { scanDirectoryForAudio } from './directoryScanner.ts'
import { importAudioFromFileList } from './fileListImport.ts'
import {
  FileSystemMusicAdapter,
  type LocalLibraryStoragePort,
  type LocalMediaIndexPort,
} from './FileSystemMusicAdapter.ts'
import {
  assessLocalCapability,
  assessLocalFileListCapability,
  type LocalCapability,
} from './localCapability.ts'
import type { LocalLibrarySnapshot } from './types.ts'
import type { Track } from '../../../types/track.ts'

function audioFile(name: string, relativePath?: string): File {
  const file = new File([Uint8Array.from([1, 2, 3, 4])], name, {
    type: 'audio/mpeg',
  })
  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      enumerable: true,
      value: relativePath,
    })
  }
  return file
}

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

test('file list import keeps relative paths, skips duplicates and unsupported files', () => {
  assert.equal(
    assessLocalFileListCapability({ hasDocument: true, hasObjectUrl: true }).supported,
    true,
  )
  assert.equal(
    assessLocalFileListCapability({ hasDocument: false, hasObjectUrl: true }).supported,
    false,
  )
  const imported = importAudioFromFileList([
    audioFile('notes.txt', 'Music/notes.txt'),
    audioFile('song.mp3', 'Music/a/song.mp3'),
    audioFile('song.mp3', 'Music/a/song.mp3'),
    audioFile('track.flac', 'Music/b/nested/track.flac'),
    audioFile('alone.mp3'),
  ])
  assert.deepEqual(
    imported.files.map((file) => file.relativePath).sort(),
    ['Music/a/song.mp3', 'Music/b/nested/track.flac', 'alone.mp3'],
  )
  assert.equal(imported.files.every((file) => Boolean(file.file) && !file.handle), true)
  assert.equal(imported.folderName, 'Music')
  assert.equal(imported.subdirectoryCount >= 2, true)
})

test('session file list plays without a directory handle and needs reselect after restart', async () => {
  let handle: FileSystemDirectoryHandle | null = null
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
      indexed.push(tracks.map((track) => track.externalId))
    },
    async clearSource(sourceId) {
      cleared.push(sourceId)
    },
  }
  const adapter = new FileSystemMusicAdapter({
    id: 'local-folder',
    capability: () => ({
      supported: false,
      blocker: 'directory-picker-missing',
      message: 'Directory picker недоступен.',
    }),
    storage,
    mediaIndex,
  })

  await adapter.connectFromFileList([
    audioFile('song.mp3', 'Car/a/song.mp3'),
    audioFile('deep.flac', 'Car/a/nested/deep.flac'),
  ])
  assert.equal(adapter.accessState, 'granted')
  assert.equal(adapter.getStats().libraryMode, 'session-files')
  assert.equal(adapter.getStats().reselectRequired, false)
  assert.equal(handle, null)
  assert.equal(snapshot?.libraryMode, 'session-files')
  assert.equal(JSON.stringify(snapshot).includes('blob:'), false)
  assert.equal(adapter.isAvailable(), true)
  const page = await adapter.fetchTracks()
  assert.deepEqual(pathsOf(page.tracks), ['Car/a/nested/deep.flac', 'Car/a/song.mp3'])
  const playable = await adapter.checkTrackAvailability(page.tracks[0]!)
  assert.equal(playable.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)

  const created: string[] = []
  const originalCreate = URL.createObjectURL
  URL.createObjectURL = (() => {
    const url = `blob:session-${created.length}`
    created.push(url)
    return url
  }) as typeof URL.createObjectURL
  try {
    const stream = await adapter.getStream(page.tracks[0]!)
    assert.equal(stream.startsWith('blob:'), true)
    assert.equal(created.length, 1)
  } finally {
    URL.createObjectURL = originalCreate
  }

  await assert.rejects(adapter.rescan(), /повторно выбрать/)

  const restored = new FileSystemMusicAdapter({
    id: 'local-folder',
    capability: supportedCapability,
    storage,
    mediaIndex,
  })
  await restored.initialize()
  assert.equal(restored.getStats().reselectRequired, true)
  assert.equal(restored.getStats().libraryMode, 'session-files')
  assert.equal(restored.accessState, 'prompt')
  assert.equal(restored.isAvailable(), false)
  assert.equal((await restored.fetchTracks()).tracks.length, 0)
  assert.equal(cleared.includes('local-folder'), true)
  const stale = createTrack({
    sourceId: 'local-folder',
    externalId: 'Car/a/song.mp3',
    title: 'song',
    artist: 'Unknown Artist',
  })
  const unavailable = await restored.checkTrackAvailability(stale)
  assert.equal(unavailable.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)
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
