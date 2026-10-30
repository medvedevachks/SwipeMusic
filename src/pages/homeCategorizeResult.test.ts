import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('Home categorizes only after CatalogChoiceResult and uses confirmed create', () => {
  const path = fileURLToPath(new URL('./Home.tsx', import.meta.url))
  const source = readFileSync(path, 'utf8')
  assert.match(source, /createCategoryConfirmed/)
  assert.match(source, /result\.status === 'failed'/)
  assert.match(source, /result\.status === 'partial'/)
  assert.match(source, /SAVE_FAILED_MESSAGE/)
  assert.doesNotMatch(
    source,
    /setCategoryResolveKey\(\(value\) => value \+ 1\)\s*\n\s*void commitCatalogChoice/,
  )
  assert.match(source, /commitCatalogChoice\(track, categoryId, category\)\.then/)
})
