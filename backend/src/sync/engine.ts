import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { assertZaycevPageUrl } from '../sources/zaycevUrl.ts'
import {
  categories,
  collectionItems,
  syncOperations,
  trackDecisions,
  userSettings,
} from '../db/schema.ts'
import type {
  CategoryDto,
  CollectionItemDto,
  CollectionSnapshot,
  SyncOperation,
  TrackDecisionDto,
  UserSettingsDto,
} from './types.ts'

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return {}
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Некорректное поле ${field}`)
  }
  return value
}

export function parseTrackIdentity(trackId: string): { sourceId: string; externalId: string } {
  const index = trackId.indexOf(':')
  if (index <= 0 || index === trackId.length - 1) {
    throw new Error('Некорректный идентификатор трека')
  }
  return {
    sourceId: trackId.slice(0, index),
    externalId: trackId.slice(index + 1),
  }
}

function newer(incoming: string, current: Date | null): boolean {
  if (!current) {
    return true
  }
  return new Date(incoming).getTime() >= current.getTime()
}

export async function applyOperations(
  db: Database,
  userId: string,
  operations: SyncOperation[],
): Promise<{ accepted: string[]; duplicates: string[] }> {
  const accepted: string[] = []
  const duplicates: string[] = []

  for (const operation of operations) {
    const existing = await db
      .select({ id: syncOperations.id })
      .from(syncOperations)
      .where(eq(syncOperations.id, operation.id))
      .limit(1)

    if (existing.length > 0) {
      duplicates.push(operation.id)
      continue
    }

    await db.transaction(async (tx) => {
      await applyOne(tx as unknown as Database, userId, operation)
      await tx.insert(syncOperations).values({
        id: operation.id,
        userId,
        type: operation.type,
        payload: operation.payload as object,
        clientCreatedAt: new Date(operation.clientCreatedAt),
      })
    })
    accepted.push(operation.id)
  }

  return { accepted, duplicates }
}

async function applyOne(db: Database, userId: string, operation: SyncOperation) {
  const payload = asRecord(operation.payload)

  switch (operation.type) {
    case 'upsert_category': {
      const dto = payload as unknown as CategoryDto
      const id = requiredString(dto.id, 'id')
      const [current] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.userId, userId), eq(categories.id, id)))
        .limit(1)
      if (current && !newer(dto.updatedAt, current.updatedAt)) {
        return
      }
      await db
        .insert(categories)
        .values({
          id,
          userId,
          name: requiredString(dto.name, 'name'),
          color: requiredString(dto.color, 'color'),
          icon: requiredString(dto.icon, 'icon'),
          createdAt: new Date(dto.createdAt),
          updatedAt: new Date(dto.updatedAt),
          deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
        })
        .onConflictDoUpdate({
          target: [categories.userId, categories.id],
          set: {
            name: requiredString(dto.name, 'name'),
            color: requiredString(dto.color, 'color'),
            icon: requiredString(dto.icon, 'icon'),
            updatedAt: new Date(dto.updatedAt),
            deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
          },
        })
      return
    }
    case 'delete_category': {
      const id = requiredString(payload.id, 'id')
      const updatedAt = requiredString(payload.updatedAt, 'updatedAt')
      await db
        .update(categories)
        .set({ deletedAt: new Date(updatedAt), updatedAt: new Date(updatedAt) })
        .where(and(eq(categories.userId, userId), eq(categories.id, id)))
      await db
        .update(collectionItems)
        .set({ deletedAt: new Date(updatedAt), updatedAt: new Date(updatedAt) })
        .where(
          and(
            eq(collectionItems.userId, userId),
            eq(collectionItems.kind, 'assignment'),
            eq(collectionItems.categoryId, id),
          ),
        )
      return
    }
    case 'upsert_item': {
      const dto = payload as unknown as CollectionItemDto
      const id = requiredString(dto.id, 'id')
      const trackId = requiredString(dto.trackId, 'trackId')
      const identity = parseTrackIdentity(trackId)
      if (identity.sourceId === 'zaycev' && (dto.pageUrl || dto.kind === 'source_track')) {
        assertZaycevPageUrl(dto.pageUrl ?? '')
      }
      const [current] = await db
        .select()
        .from(collectionItems)
        .where(and(eq(collectionItems.userId, userId), eq(collectionItems.id, id)))
        .limit(1)
      if (current && !newer(dto.updatedAt, current.updatedAt)) {
        return
      }
      await db
        .insert(collectionItems)
        .values({
          id,
          userId,
          kind: dto.kind,
          trackId,
          sourceId: identity.sourceId,
          externalId: identity.externalId,
          categoryId: dto.categoryId ?? null,
          title: dto.title ?? null,
          artist: dto.artist ?? null,
          pageUrl: dto.pageUrl ?? null,
          durationMs: dto.durationMs ?? null,
          availability: dto.availability ?? null,
          playbackMode: dto.playbackMode ?? null,
          position: dto.position ?? null,
          createdAt: new Date(dto.createdAt),
          updatedAt: new Date(dto.updatedAt),
          deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
        })
        .onConflictDoUpdate({
          target: [collectionItems.userId, collectionItems.id],
          set: {
            kind: dto.kind,
            trackId,
            sourceId: identity.sourceId,
            externalId: identity.externalId,
            categoryId: dto.categoryId ?? null,
            title: dto.title ?? null,
            artist: dto.artist ?? null,
            pageUrl: dto.pageUrl ?? null,
            durationMs: dto.durationMs ?? null,
            availability: dto.availability ?? null,
            playbackMode: dto.playbackMode ?? null,
            position: dto.position ?? null,
            updatedAt: new Date(dto.updatedAt),
            deletedAt: dto.deletedAt ? new Date(dto.deletedAt) : null,
          },
        })
      return
    }
    case 'delete_item': {
      const id = requiredString(payload.id, 'id')
      const updatedAt = requiredString(payload.updatedAt, 'updatedAt')
      await db
        .update(collectionItems)
        .set({ deletedAt: new Date(updatedAt), updatedAt: new Date(updatedAt) })
        .where(and(eq(collectionItems.userId, userId), eq(collectionItems.id, id)))
      return
    }
    case 'append_decision': {
      const dto = payload as unknown as TrackDecisionDto
      const trackId = requiredString(dto.trackId, 'trackId')
      const identity = parseTrackIdentity(trackId)
      await db
        .insert(trackDecisions)
        .values({
          id: requiredString(dto.id, 'id'),
          userId,
          trackId,
          sourceId: identity.sourceId,
          externalId: identity.externalId,
          action: dto.action,
          createdAt: new Date(dto.createdAt),
        })
        .onConflictDoNothing()
      return
    }
    case 'upsert_settings': {
      const dto = payload as unknown as UserSettingsDto
      await db
        .insert(userSettings)
        .values({
          userId,
          gestureConfig: dto.gestureConfig,
          viewedTrackIds: dto.viewedTrackIds,
          updatedAt: new Date(dto.updatedAt),
        })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: {
            gestureConfig: dto.gestureConfig,
            viewedTrackIds: dto.viewedTrackIds,
            updatedAt: new Date(dto.updatedAt),
          },
        })
      return
    }
    default:
      throw new Error('Неизвестный тип операции')
  }
}

export async function loadSnapshot(
  db: Database,
  userId: string,
): Promise<CollectionSnapshot> {
  const [categoryRows, itemRows, decisionRows, settingsRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(collectionItems).where(eq(collectionItems.userId, userId)),
    db.select().from(trackDecisions).where(eq(trackDecisions.userId, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
  ])

  return {
    categories: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
    items: itemRows.map((row) => ({
      id: row.id,
      kind: row.kind as CollectionItemDto['kind'],
      trackId: row.trackId,
      sourceId: row.sourceId,
      externalId: row.externalId,
      categoryId: row.categoryId,
      title: row.title,
      artist: row.artist,
      pageUrl: row.pageUrl,
      durationMs: row.durationMs,
      availability: row.availability as CollectionItemDto['availability'],
      playbackMode: row.playbackMode as CollectionItemDto['playbackMode'],
      position: row.position,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
    decisions: decisionRows.map((row) => ({
      id: row.id,
      trackId: row.trackId,
      sourceId: row.sourceId,
      externalId: row.externalId,
      action: row.action as TrackDecisionDto['action'],
      createdAt: row.createdAt.toISOString(),
    })),
    settings: settingsRows[0]
      ? {
          gestureConfig: settingsRows[0].gestureConfig as UserSettingsDto['gestureConfig'],
          viewedTrackIds: settingsRows[0].viewedTrackIds,
          updatedAt: settingsRows[0].updatedAt.toISOString(),
        }
      : null,
  }
}

export function isSnapshotEmpty(snapshot: CollectionSnapshot): boolean {
  const liveCategories = snapshot.categories.filter((item) => !item.deletedAt)
  const liveItems = snapshot.items.filter((item) => !item.deletedAt)
  return liveCategories.length === 0 && liveItems.length === 0 && snapshot.decisions.length === 0
}
