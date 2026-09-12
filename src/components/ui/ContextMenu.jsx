import { useEffect } from 'react'
import { useUI } from '../../context/UIContext.jsx'

// Global bağlam menüsü — UIContext üzerinden openMenu(x, y, items, trigger) ile açılır
export default function ContextMenu() {
  const { menu, closeMenu } = useUI()

  useEffect(() => {
    if (!menu) return undefined
    const onPointer = (event) => {
      const target = event.target
      const insideMenu = target.closest?.('.context-menu')
      const insideTrigger = menu.trigger && (target === menu.trigger || menu.trigger.contains?.(target))
      if (!insideMenu && !insideTrigger) closeMenu()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeMenu)
    }
  }, [menu, closeMenu])

  if (!menu) return null

  const estimatedHeight = menu.items.length * 40 + 20
  const triggerRect = menu.trigger?.getBoundingClientRect?.()
  const belowTrigger = triggerRect ? triggerRect.bottom + 8 : menu.y
  const top = triggerRect && belowTrigger + estimatedHeight <= window.innerHeight - 8
    ? belowTrigger
    : triggerRect
      ? Math.max(8, triggerRect.top - estimatedHeight - 8)
      : Math.min(menu.y, window.innerHeight - 60 - estimatedHeight)
  const style = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top,
  }

  return (
    <div className="context-menu" style={style} role="menu">
      {menu.items.map((item, index) =>
        item?.separator ? (
          <div key={`sep-${index}`} style={{ height: 1, background: 'var(--hairline)', margin: '6px 8px' }} />
        ) : (
          <button
            key={`${item.label || 'item'}-${index}`}
            type="button"
            role="menuitem"
            className={`context-menu__item ${item.danger ? 'context-menu__item--danger' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              closeMenu()
              item.onClick?.()
            }}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
