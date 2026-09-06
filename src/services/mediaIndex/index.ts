export type {
  MediaFile,
  TrackMetadata,
  TrackCopy,
  TrackRecord,
  MediaIndexQuery,
  MediaIndexStats,
  MediaScanProgress,
} from './types'

export type { MediaIndexStorage } from './storage/MediaIndexStorage'
export { MemoryMediaIndexStorage } from './storage/MemoryMediaIndexStorage'
export { IndexedDbMediaIndexStorage } from './storage/IndexedDbMediaIndexStorage'

export { MediaIndex, getMediaIndex } from './MediaIndex'
export { MetadataExtractor, metadataExtractor } from './MetadataExtractor'
export { DefaultMediaScanner, type MediaScanner } from './MediaScanner'
export { ArtworkCache, artworkCache } from './ArtworkCache'
export {
  syncAdapterToMediaIndex,
  indexTracksForSource,
  indexMediaFiles,
} from './sync'
