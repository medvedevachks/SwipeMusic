/** Маршруты каталога исполнителя / альбома (существующие страницы SRC-03). */

export function artistCatalogPath(
  sourceId: string,
  artistExternalId: string,
): string {
  return `/search/artists/${encodeURIComponent(sourceId)}/${encodeURIComponent(artistExternalId)}`
}

export function albumCatalogPath(
  sourceId: string,
  albumExternalId: string,
): string {
  return `/search/albums/${encodeURIComponent(sourceId)}/${encodeURIComponent(albumExternalId)}`
}
