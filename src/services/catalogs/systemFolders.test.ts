import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Catalog } from '../../types/category.ts'
import {
  createSysSwipesCatalog,
  itemHasUserCatalogMembership,
  itemInSwipeInbox,
  listUserOrganizationCatalogs,
  SYS_SWIPES_ID,
  SYS_SWIPES_NAME,
} from './systemFolders.ts'

test('sys_swipes has stable id and is filtered from organization catalogs', () => {
  const inbox = createSysSwipesCatalog('2024-01-01T00:00:00.000Z')
  assert.equal(inbox.id, SYS_SWIPES_ID)
  assert.equal(inbox.name, SYS_SWIPES_NAME)
  assert.equal(inbox.system, true)
  const car: Catalog = {
    id: 'cat_car',
    name: 'В машину',
    icon: 'car',
    color: '#2563eb',
    description: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    sortOrder: 0,
    favorite: false,
    system: false,
  }
  assert.deepEqual(
    listUserOrganizationCatalogs([inbox, car]).map((row) => row.id),
    ['cat_car'],
  )
})

test('inbox membership helpers', () => {
  const onlyInbox = { catalogIds: [SYS_SWIPES_ID] } as CanonicalLibraryItem
  const organized = {
    catalogIds: [SYS_SWIPES_ID, 'cat_car'],
  } as CanonicalLibraryItem
  const userOnly = { catalogIds: ['cat_car'] } as CanonicalLibraryItem
  assert.equal(itemInSwipeInbox(onlyInbox), true)
  assert.equal(itemHasUserCatalogMembership(onlyInbox), false)
  assert.equal(itemHasUserCatalogMembership(organized), true)
  assert.equal(itemInSwipeInbox(userOnly), false)
})
