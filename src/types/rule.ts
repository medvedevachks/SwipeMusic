/**
 * Модель правила автоматической категоризации.
 * Логика выполнения пока не реализована — только структура.
 *
 * Пример:
 *   artist equals "Queen" → предложить категорию "Rock"
 *   genre equals "Jazz" → предложить категорию "Работа"
 */
export type RuleConditionField =
  | 'artist'
  | 'genre'
  | 'album'
  | 'title'
  | 'year'
  | 'tag'

export type RuleOperator = 'equals' | 'contains' | 'startsWith' | 'in'

export type RuleCondition = {
  field: RuleConditionField
  operator: RuleOperator
  value: string | number | readonly string[]
}

export type Rule = {
  id: string
  name: string
  enabled: boolean
  /** Все условия должны выполниться (AND). OR — на следующем этапе. */
  conditions: RuleCondition[]
  suggestedCategoryId: string
  /** Чем меньше число, тем выше приоритет. */
  priority: number
  createdAt: string
  updatedAt: string
}
