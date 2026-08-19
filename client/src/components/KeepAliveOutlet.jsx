import { useOutlet, useLocation } from 'react-router-dom'
import { useRef } from 'react'

/**
 * Giữ trang /quantri đã mở — bấm chuyển tab không unmount, không fetch lại.
 */
export default function KeepAliveOutlet({ context }) {
  const location = useLocation()
  const outlet = useOutlet(context)
  const cacheRef = useRef(new Map())
  if (outlet) cacheRef.current.set(location.pathname, outlet)

  return (
    <>
      {[...cacheRef.current.entries()].map(([path, el]) => {
        const active = path === location.pathname
        return (
          <div key={path} hidden={!active} inert={!active ? true : undefined}>
            {el}
          </div>
        )
      })}
    </>
  )
}
