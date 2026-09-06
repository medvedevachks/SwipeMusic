import { sourceManager } from '../sources'

/** Человекочитаемое имя источника для UI карточки. */
export function getSourceDisplayName(sourceId: string): string {
  try {
    return sourceManager.getSource(sourceId).name
  } catch {
    return sourceId
  }
}
