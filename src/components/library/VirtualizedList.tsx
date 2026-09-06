import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type VirtualizedListProps<T> = {
  items: T[]
  estimateSize?: number
  heightClassName?: string
  getKey: (item: T, index: number) => string
  renderRow: (item: T, index: number) => ReactNode
}

/**
 * Простая window-виртуализация без внешних зависимостей.
 * Готова к спискам 100k+ (рендер только видимого окна).
 */
export function VirtualizedList<T>({
  items,
  estimateSize = 76,
  heightClassName = 'h-[min(70vh,640px)]',
  getKey,
  renderRow,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const update = () => setViewportHeight(node.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { start, end, offsetY, totalHeight } = useMemo(() => {
    const overscan = 8
    const startIndex = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan)
    const visibleCount = Math.ceil(viewportHeight / estimateSize) + overscan * 2
    const endIndex = Math.min(items.length, startIndex + visibleCount)
    return {
      start: startIndex,
      end: endIndex,
      offsetY: startIndex * estimateSize,
      totalHeight: items.length * estimateSize,
    }
  }, [estimateSize, items.length, scrollTop, viewportHeight])

  const slice = items.slice(start, end)

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] ${heightClassName}`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, offset) => {
            const index = start + offset
            return (
              <div
                key={getKey(item, index)}
                style={{ height: estimateSize }}
                className="border-b border-[var(--color-border)] last:border-b-0"
              >
                {renderRow(item, index)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
