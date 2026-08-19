import { useOutlet, useLocation } from 'react-router-dom'
import { useRef } from 'react'

const MAX_CACHE = 8

/**
 * Giữ trang /quantri đã mở — bấm chuyển tab không unmount, không fetch lại.
 */
export default function KeepAliveOutlet({ context }) {
  const location = useLocation()
  const outlet = useOutlet(context)
  const cacheRef = useRef(new Map())
  if (outlet) {
    const path = location.pathname
    // Đưa tab vừa mở lên cuối hàng — tránh evict nhầm trang đang dùng lâu.
    if (cacheRef.current.has(path)) cacheRef.current.delete(path)
    cacheRef.current.set(path, outlet)
    while (cacheRef.current.size > MAX_CACHE) {
      const oldest = cacheRef.current.keys().next().value
      if (!oldest || oldest === path) break
      cacheRef.current.delete(oldest)
    }
  }

  return (
    <>
      {[...cacheRef.current.entries()].map(([path, el]) => {
        const active = path === location.pathname
        return (
          <div
            key={path}
            hidden={!active}
            aria-hidden={!active}
            inert={!active ? true : undefined}
          >
            {el}
          </div>
        )
      })}
    </>
  )
}
