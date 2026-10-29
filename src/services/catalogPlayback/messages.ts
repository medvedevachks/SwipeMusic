export const CATALOG_PLAYBACK_MESSAGE = {
  EMPTY_CATALOG: 'В каталоге нет композиций для воспроизведения.',
  NO_PLAYABLE:
    'Сейчас нет доступных композиций для воспроизведения. Записи в каталоге сохранены.',
  TRACK_UNAVAILABLE:
    'Эту композицию сейчас нельзя воспроизвести. Запись остаётся в каталоге.',
  SOURCE_DISABLED:
    'Источник этой композиции отключён. Включите его в настройках или выберите другой трек.',
  SNAPSHOT_MISSING:
    'Не удалось получить трек источника. Проверьте подключение и попробуйте снова.',
  BUSY: 'Уже запускаем воспроизведение…',
  FAILED: 'Не удалось начать воспроизведение. Текущий плеер не изменён.',
  NEEDS_USER_PLAY:
    'Трек готов, но браузер поставил воспроизведение на паузу. Нажмите Play в нижнем плеере.',
} as const

export type CatalogPlaybackMessage =
  (typeof CATALOG_PLAYBACK_MESSAGE)[keyof typeof CATALOG_PLAYBACK_MESSAGE]
