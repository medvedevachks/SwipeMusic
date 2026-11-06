import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  closeFullscreenPlayer,
  isFullscreenPlayerSearch,
  openFullscreenPlayer,
} from '../navigation/fullscreenPlayer'

export function useFullscreenPlayer() {
  const navigate = useNavigate()
  const location = useLocation()
  const isOpen = useMemo(
    () => isFullscreenPlayerSearch(location.search),
    [location.search],
  )

  const open = useCallback(() => {
    openFullscreenPlayer(navigate, location)
  }, [navigate, location])

  const close = useCallback(() => {
    closeFullscreenPlayer(navigate, location)
  }, [navigate, location])

  return { isOpen, open, close }
}
