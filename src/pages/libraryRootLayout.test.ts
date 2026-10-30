import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const libraryPath = fileURLToPath(new URL('./Library.tsx', import.meta.url))
const browsePath = fileURLToPath(new URL('./LibraryBrowse.tsx', import.meta.url))
const appPath = fileURLToPath(new URL('../App.tsx', import.meta.url))
const folderPath = fileURLToPath(new URL('./LibraryFolder.tsx', import.meta.url))

test('library root has compact folders only — no provider track lists in DOM tree of page', () => {
  const source = readFileSync(libraryPath, 'utf8')
  assert.match(source, /LibrarySystemFolders/)
  assert.match(source, /CatalogList/)
  assert.match(source, /\/library\/browse/)
  assert.match(source, /\/sources/)
  assert.doesNotMatch(source, /LibraryContentTable/)
  assert.doesNotMatch(source, /LibraryTree/)
  assert.doesNotMatch(source, /Доступные треки/)
  assert.doesNotMatch(source, /useLibraryUiStore/)
  assert.doesNotMatch(source, /selectAllTracks/)
  assert.doesNotMatch(source, /BulkActionBar/)
})

test('provider browse page keeps track management after move from root', () => {
  const source = readFileSync(browsePath, 'utf8')
  assert.match(source, /LibraryContentTable/)
  assert.match(source, /LibraryTree/)
  assert.match(source, /BulkActionBar/)
  assert.match(source, /TrackActionSheet/)
  assert.match(source, /useLibraryUiStore/)
  assert.match(source, /Открыть в свайпах/)
  assert.match(source, /to="\/library"/)
})

test('app routes library browse separately from root', () => {
  const source = readFileSync(appPath, 'utf8')
  assert.match(source, /path="library\/browse"/)
  assert.match(source, /LibraryBrowse/)
  assert.match(source, /path="library"/)
})

test('swipes folder still surfaces create/assign failure and partial unassign retry', () => {
  const source = readFileSync(folderPath, 'utf8')
  assert.match(source, /createCategoryConfirmed/)
  assert.match(source, /result\.status === 'failed'/)
  assert.match(source, /result\.status === 'partial'/)
  assert.match(
    source,
    /не удалось убрать из «Свайпов»\. Нажмите «В каталог» ещё раз/,
  )
  assert.match(source, /SAVE_FAILED_MESSAGE/)
})

test('swipes Play starts Home sorting; mobile touch targets stay large', () => {
  const source = readFileSync(folderPath, 'utf8')
  assert.match(source, /startSwipeInboxSorting/)
  assert.match(source, /navigate\('\/', \{ state: \{ focusHomeTab: 'sorting' \} \}/)
  assert.match(source, /min-h-11/)
  assert.match(source, /h-11 w-11/)
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /\.home-mode-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
})
