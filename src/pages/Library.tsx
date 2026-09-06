import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BulkActionBar } from '../components/library/BulkActionBar'
import { LibraryBreadcrumb } from '../components/library/LibraryBreadcrumb'
import { LibraryContentTable } from '../components/library/LibraryContentTable'
import { LibraryTree } from '../components/library/LibraryTree'
import { TrackActionSheet } from '../components/library/TrackActionSheet'
import { useCollectionEngineStore } from '../store/collectionEngineStore'
import { useCollectionStore } from '../store/collectionStore'
import { useLibraryUiStore } from '../store/libraryUiStore'
import { usePlayerStore } from '../store/playerStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import type { Track } from '../types/track'

function shuffleTracks(tracks: Track[]): Track[] {
  const copy = [...tracks]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export default function Library() {
  const navigate = useNavigate()
  const lastClickedTrackId = useRef<string | null>(null)

  const providerId = useLibraryUiStore((state) => state.providerId)
  const providers = useLibraryUiStore((state) => state.providers)
  const rootNodes = useLibraryUiStore((state) => state.rootNodes)
  const treeChildren = useLibraryUiStore((state) => state.treeChildren)
  const expandedIds = useLibraryUiStore((state) => state.expandedIds)
  const selectedNodeId = useLibraryUiStore((state) => state.selectedNodeId)
  const breadcrumb = useLibraryUiStore((state) => state.breadcrumb)
  const tracks = useLibraryUiStore((state) => state.tracks)
  const searchQuery = useLibraryUiStore((state) => state.searchQuery)
  const searchResults = useLibraryUiStore((state) => state.searchResults)
  const isLoading = useLibraryUiStore((state) => state.isLoading)
  const error = useLibraryUiStore((state) => state.error)
  const selectedTrackIds = useLibraryUiStore((state) => state.selectedTrackIds)
  const actionTrackId = useLibraryUiStore((state) => state.actionTrackId)

  const bootstrap = useLibraryUiStore((state) => state.bootstrap)
  const setProviderId = useLibraryUiStore((state) => state.setProviderId)
  const toggleExpand = useLibraryUiStore((state) => state.toggleExpand)
  const selectNode = useLibraryUiStore((state) => state.selectNode)
  const setSearchQuery = useLibraryUiStore((state) => state.setSearchQuery)
  const runSearch = useLibraryUiStore((state) => state.runSearch)
  const refresh = useLibraryUiStore((state) => state.refresh)
  const toggleTrackSelected = useLibraryUiStore(
    (state) => state.toggleTrackSelected,
  )
  const selectAllTracks = useLibraryUiStore((state) => state.selectAllTracks)
  const clearTrackSelection = useLibraryUiStore(
    (state) => state.clearTrackSelection,
  )
  const setActionTrackId = useLibraryUiStore((state) => state.setActionTrackId)

  const categories = useCollectionStore((state) => state.categories)
  const setLiked = useCollectionEngineStore((state) => state.setLiked)
  const toggleFavorite = useCollectionEngineStore((state) => state.toggleFavorite)
  const assignCategory = useCollectionEngineStore((state) => state.assignCategory)
  const playTrack = usePlayerStore((state) => state.playTrack)
  const setQueue = usePlayerStore((state) => state.setQueue)
  const queue = usePlayerStore((state) => state.queue)
  const queueIndex = usePlayerStore((state) => state.queueIndex)
  const applyLibraryDeck = useSwipeDeckSessionStore(
    (state) => state.applyLibraryDeck,
  )

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea') {
          return
        }
        event.preventDefault()
        selectAllTracks()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectAllTracks])

  const rows = searchResults.length > 0 ? searchResults : tracks

  const providerLabelById = useMemo(() => {
    const map = new Map(providers.map((provider) => [provider.id, provider.label]))
    return (sourceId: string) => map.get(sourceId) ?? sourceId
  }, [providers])

  const actionRow =
    rows.find((row) => row.track.id === actionTrackId) ?? null

  const openInSwipes = (trackIds?: string[]) => {
    const ids = trackIds ?? rows.map((row) => row.track.id)
    const idSet = new Set(ids)
    const selected = rows
      .filter((row) => idSet.has(row.track.id))
      .map((row) => row.track)
    if (selected.length === 0) {
      return
    }
    applyLibraryDeck(selected, { query: 'Библиотека' })
    navigate('/')
  }

  const handleToggleWithRange = (trackId: string, shiftKey: boolean) => {
    if (!shiftKey || !lastClickedTrackId.current) {
      toggleTrackSelected(trackId)
      lastClickedTrackId.current = trackId
      return
    }

    const start = rows.findIndex(
      (row) => row.track.id === lastClickedTrackId.current,
    )
    const end = rows.findIndex((row) => row.track.id === trackId)
    if (start < 0 || end < 0) {
      toggleTrackSelected(trackId)
      lastClickedTrackId.current = trackId
      return
    }

    const [from, to] = start < end ? [start, end] : [end, start]
    const rangeIds = rows.slice(from, to + 1).map((row) => row.track.id)
    const next = new Set(selectedTrackIds)
    for (const id of rangeIds) {
      next.add(id)
    }
    useLibraryUiStore.setState({ selectedTrackIds: [...next] })
    lastClickedTrackId.current = trackId
  }

  const playNext = (track: Track) => {
    const insertAt = Math.max(0, queueIndex + 1)
    const nextQueue = [
      ...queue.slice(0, insertAt),
      track,
      ...queue.slice(insertAt).filter((item) => item.id !== track.id),
    ]
    setQueue(nextQueue, queueIndex >= 0 ? queueIndex : 0)
  }

  return (
    <section className="space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            Библиотека
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            Универсальная медиатека через LibraryProvider
          </p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
          onClick={() => {
            void refresh()
          }}
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {providers.map((provider) => {
          const active = provider.id === providerId
          return (
            <button
              key={provider.id}
              type="button"
              className={[
                'rounded-xl px-3 py-2 text-sm',
                active
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-fg)]',
              ].join(' ')}
              onClick={() => {
                void setProviderId(provider.id)
              }}
            >
              {provider.label}
            </button>
          )
        })}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Поиск по активным провайдерам…"
          className="min-w-[14rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
        >
          Найти
        </button>
      </form>

      <LibraryBreadcrumb
        items={breadcrumb}
        onNavigate={(nodeId) => {
          void selectNode(nodeId)
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <LibraryTree
          roots={rootNodes}
          childrenMap={treeChildren}
          expandedIds={expandedIds}
          selectedNodeId={selectedNodeId}
          onToggle={(nodeId) => {
            void toggleExpand(nodeId)
          }}
          onSelect={(nodeId) => {
            void selectNode(nodeId)
          }}
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--color-muted)]">
              {isLoading ? 'Загрузка…' : `${rows.length} треков`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs"
                onClick={() => selectAllTracks()}
              >
                Ctrl+A · Выбрать все
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-xs text-white disabled:opacity-40"
                disabled={rows.length === 0}
                onClick={() => openInSwipes()}
              >
                Открыть в свайпах
              </button>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : (
            <LibraryContentTable
              rows={rows}
              selectedIds={selectedTrackIds}
              onToggle={(trackId, shiftKey) => {
                handleToggleWithRange(trackId, shiftKey)
              }}
              onPlay={(trackId) => {
                const row = rows.find((item) => item.track.id === trackId)
                if (row) {
                  void playTrack(row.track)
                }
              }}
              onOpenActions={setActionTrackId}
              providerLabelBySourceId={providerLabelById}
            />
          )}

          <BulkActionBar
            count={selectedTrackIds.length}
            onClear={clearTrackSelection}
            onLike={() => {
              for (const id of selectedTrackIds) {
                const row = rows.find((item) => item.track.id === id)
                setLiked(id, true, row?.track)
              }
              clearTrackSelection()
            }}
            onUnlike={() => {
              for (const id of selectedTrackIds) {
                setLiked(id, false)
              }
              clearTrackSelection()
            }}
            onOpenInSwipes={() => {
              openInSwipes(selectedTrackIds)
              clearTrackSelection()
            }}
            onCreateQueue={() => {
              const queueTracks = rows
                .filter((row) => selectedTrackIds.includes(row.track.id))
                .map((row) => row.track)
              setQueue(queueTracks, 0)
              if (queueTracks[0]) {
                void playTrack(queueTracks[0])
              }
              clearTrackSelection()
            }}
            onExport={() => {
              const payload = rows
                .filter((row) => selectedTrackIds.includes(row.track.id))
                .map((row) => ({
                  title: row.track.title,
                  artist: row.track.artist,
                  source: row.track.sourceId,
                }))
              void navigator.clipboard.writeText(
                JSON.stringify(payload, null, 2),
              )
              clearTrackSelection()
            }}
          />
        </div>
      </div>

      <TrackActionSheet
        open={actionTrackId !== null}
        entry={
          actionRow
            ? { track: actionRow.track, meta: actionRow.meta }
            : null
        }
        categories={categories}
        onClose={() => setActionTrackId(null)}
        onPlay={() => {
          if (actionRow) {
            void playTrack(actionRow.track)
          }
        }}
        onPlayNext={() => {
          if (actionRow) {
            playNext(actionRow.track)
          }
        }}
        onShuffle={() => {
          const shuffled = shuffleTracks(rows.map((row) => row.track))
          setQueue(shuffled, 0)
          if (shuffled[0]) {
            void playTrack(shuffled[0])
          }
        }}
        onOpenInSwipes={() => {
          if (actionRow) {
            openInSwipes([actionRow.track.id])
          }
        }}
        onToggleLike={() => {
          if (actionRow) {
            setLiked(actionRow.track.id, !actionRow.meta.liked, actionRow.track)
          }
        }}
        onToggleFavorite={() => {
          if (actionRow) {
            toggleFavorite(actionRow.track.id, actionRow.track)
          }
        }}
        onAssignCategory={(categoryId) => {
          if (actionRow) {
            assignCategory(actionRow.track.id, categoryId, actionRow.track)
          }
        }}
        onReveal={() => {
          if (actionRow) {
            window.alert(
              `Источник: ${providerLabelById(actionRow.track.sourceId)}\nid: ${actionRow.track.id}`,
            )
          }
        }}
        onRefresh={() => {
          void refresh()
        }}
        onShowInfo={() => {
          if (!actionRow) {
            return
          }
          window.alert(
            [
              actionRow.track.title,
              actionRow.track.artist,
              actionRow.track.album ?? '—',
              providerLabelById(actionRow.track.sourceId),
            ].join('\n'),
          )
        }}
        onCopyInfo={() => {
          if (!actionRow) {
            return
          }
          void navigator.clipboard.writeText(
            `${actionRow.track.artist} — ${actionRow.track.title}`,
          )
        }}
      />
    </section>
  )
}
