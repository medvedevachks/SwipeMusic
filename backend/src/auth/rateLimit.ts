import { and, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { authRateEvents } from '../db/schema.ts'

export async function assertRateLimit(
  db: Database,
  kind: string,
  subject: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs)
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authRateEvents)
    .where(
      and(
        eq(authRateEvents.kind, kind),
        eq(authRateEvents.subject, subject),
        gt(authRateEvents.createdAt, since),
      ),
    )

  const count = rows[0]?.count ?? 0
  if (count >= limit) {
    return false
  }

  await db.insert(authRateEvents).values({
    id: crypto.randomUUID(),
    kind,
    subject,
  })
  return true
}
