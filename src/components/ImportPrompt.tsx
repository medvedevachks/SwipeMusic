import BottomSheet from './BottomSheet'
import { importLocalCollection, skipImport } from '../services/sync/collectionSync'
import { useSessionStore } from '../store/sessionStore'

export default function ImportPrompt() {
  const open = useSessionStore((state) => state.importPrompt)

  return (
    <BottomSheet
      open={open}
      title="Перенести коллекцию?"
      onClose={() => {
        void skipImport()
      }}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm text-[var(--color-muted)]">
          На этом устройстве есть локальная коллекция. Можно объединить её с облаком.
          Пустая локальная копия не затрёт данные на сервере.
        </p>
        <button
          type="button"
          className="h-11 w-full rounded-xl bg-[var(--color-accent)] text-sm font-medium text-white"
          onClick={() => {
            void importLocalCollection()
          }}
        >
          Перенести и объединить
        </button>
        <button
          type="button"
          className="h-11 w-full rounded-xl border border-[var(--color-border)] text-sm"
          onClick={() => {
            void skipImport()
          }}
        >
          Только облачная копия
        </button>
      </div>
    </BottomSheet>
  )
}
