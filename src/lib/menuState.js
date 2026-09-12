export function shouldToggleMenu(currentTrigger, nextTrigger) {
  return Boolean(currentTrigger && nextTrigger && currentTrigger === nextTrigger)
}
