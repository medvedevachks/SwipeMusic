import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('CatalogDetail wires busy/error remove without optimistic fire-and-forget', () => {
  const source = readFileSync(new URL('./CatalogDetail.tsx', import.meta.url), 'utf8')
  assert.match(source, /removeCanonicalFromCatalog/)
  assert.match(source, /removeBusyRef/)
  assert.match(source, /removeBusyId/)
  assert.match(source, /removeError/)
  assert.match(source, /Не удалось убрать из каталога/)
  assert.match(source, /disabled=\{removeBusy\}/)
  assert.match(
    source,
    /void removeCanonicalFromCatalog\(id, catalog\.id\)\.then\(\(ok\) =>/,
  )
  assert.equal(
    source.includes('void removeCanonicalFromCatalog(\n                      item.canonicalTrack.id'),
    false,
  )
})
