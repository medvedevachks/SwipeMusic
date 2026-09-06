# Media Index Engine

Единая база музыкальной библиотеки SwipeMusic.

```
Provider.sync() / fetchTracks
        ↓
   MediaIndex.upsert / replaceSource
        ↓
 Library · Search · Swipe · Queue · Collections
```

UI и подсистемы **не** обращаются к Provider за библиотекой.

## API

```ts
import { getMediaIndex, syncAdapterToMediaIndex } from '../services/mediaIndex'

const index = getMediaIndex()
await index.whenReady()

index.upsert(track)
index.remove(trackId)
index.get(trackId)
index.list()
index.search(query, sourceIds?)
index.byArtist(name)
index.byAlbum(name)
index.byFolder(path)
index.bySource(sourceId)
index.stats()
await index.transaction(async (idx) => { … })
```

## Sync

```ts
await syncAdapterToMediaIndex(adapter)
// или после локального скана:
await indexTracksForSource(sourceId, tracks, mediaFiles)
```

Local Files вызывают `indexTracksForSource` в конце `runScan`.

## Поиск

- `capabilities.library === true` → `mediaIndex.search()`
- иначе → `adapter.search()` (remote live API)

## Хранилище

- Memory (сессия)
- IndexedDB (`swipe-music-media-index`) — без `previewUrl` / blob

## Не хранит

ObjectURL · HTMLAudioElement · React · UI · Swipe state

## Дедуп

ISRC → MusicBrainz ID → hash → title+artist+duration  
Несколько `copies` на один логический трек.
