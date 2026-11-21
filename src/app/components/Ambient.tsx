import { useEffect, useState } from 'react'

/**
 * The ambient backdrop: a few soft gradients and a faint field of light points,
 * painted by CSS only. No canvas, no animation loop and no React re-renders —
 * the elements never change after mount. Animation pauses while the tab is
 * hidden, and reduced-motion users get the same backdrop, still.
 */
export function Ambient() {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  return <div className="ambient" data-paused={paused} aria-hidden />
}
