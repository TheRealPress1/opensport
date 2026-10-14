import { useEffect, useRef } from 'react'

export function useModal(onClose) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement
    const node = ref.current
    if (!node) return
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
    node.querySelector(selector)?.focus()
    const keydown = (event) => {
      if ([...document.querySelectorAll('[aria-modal="true"]')].at(-1) !== node) return
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current?.(); return }
      if (event.key !== 'Tab') return
      const targets = [...node.querySelectorAll(selector)].filter(el => el.getClientRects().length)
      const first = targets[0]
      const last = targets.at(-1)
      if (!first) { event.preventDefault(); return }
      if (!node.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [])
  return ref
}
