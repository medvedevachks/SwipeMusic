export type LocalFilePickerKind = 'directory' | 'audio-files'

export type LocalFilePickerResult =
  | { status: 'selected'; files: FileList }
  | { status: 'cancelled' }
  | { status: 'unavailable'; message: string }

function canUseFileInput(): boolean {
  return typeof document !== 'undefined' && typeof HTMLInputElement !== 'undefined'
}

/**
 * Системный picker из жеста пользователя.
 * Не вызывается из обработчика ошибки другого picker.
 */
export function openLocalFilePicker(kind: LocalFilePickerKind): Promise<LocalFilePickerResult> {
  if (!canUseFileInput()) {
    return Promise.resolve({
      status: 'unavailable',
      message: 'Выбор файлов в этой среде недоступен.',
    })
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    let settled = false

    const finish = (result: LocalFilePickerResult) => {
      if (settled) {
        return
      }
      settled = true
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      input.remove()
      resolve(result)
    }

    const onChange = () => {
      const files = input.files
      if (!files || files.length === 0) {
        finish({ status: 'cancelled' })
        return
      }
      finish({ status: 'selected', files })
    }

    const onCancel = () => {
      finish({ status: 'cancelled' })
    }

    if (kind === 'directory') {
      input.setAttribute('webkitdirectory', '')
      input.webkitdirectory = true
      input.multiple = true
    } else {
      input.multiple = true
      input.accept = 'audio/*,.mp3,.flac,.wav,.m4a,.ogg,.aac'
    }

    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    document.body.appendChild(input)

    try {
      if (typeof input.showPicker === 'function') {
        void input.showPicker()
      } else {
        input.click()
      }
    } catch (error) {
      finish({
        status: 'unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось открыть системный выбор файлов.',
      })
    }
  })
}

export function readFileListCapability(): {
  supported: boolean
  message: string | null
} {
  const hasDocument = typeof document !== 'undefined'
  const hasObjectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
  if (!hasDocument) {
    return { supported: false, message: 'Выбор файлов в этой среде недоступен.' }
  }
  if (!hasObjectUrl) {
    return { supported: false, message: 'Локальный адрес файла недоступен.' }
  }
  return { supported: true, message: null }
}
