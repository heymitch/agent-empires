/**
 * KeyboardManager - Global RTS keyboard shortcuts
 *
 * Handles all hotkeys EXCEPT `/` and `Enter` (CommandBar owns those).
 * Skips shortcuts when focus is inside an input/textarea/select.
 *
 * Shortcut table:
 *   1-9             Select unit by index
 *   Ctrl+1-9        Recall control group
 *   Ctrl+Shift+1-9  Save selection to control group
 *   Tab             Cycle territories
 *   Space           Jump to last alert location
 *   Esc             Deselect / close floating panel
 *   M               Toggle minimap expand
 *   Alt+N           Deploy new unit
 *   Alt+K           Kill selected unit
 */

export interface KeyboardManagerCallbacks {
  onSelectUnit: (index: number) => void
  onRecallGroup: (group: number) => void
  onSaveGroup: (group: number) => void
  onCycleTerritory: () => void
  onJumpToAlert: () => void
  onDeselect: () => void
  onToggleMinimap?: () => void
  onDeployUnit: () => void
  onKillUnit: () => void
}

export class KeyboardManager {
  private callbacks: KeyboardManagerCallbacks
  private handler: (e: KeyboardEvent) => void

  constructor(callbacks: KeyboardManagerCallbacks) {
    this.callbacks = callbacks
    this.handler = this.onKeyDown.bind(this)
    document.addEventListener('keydown', this.handler)
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handler)
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private isInputFocused(e: KeyboardEvent): boolean {
    const tag = (e.target as HTMLElement)?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Always allow Esc to blur inputs, but nothing else
    if (this.isInputFocused(e)) {
      if (e.key === 'Escape') {
        ;(e.target as HTMLElement).blur()
        this.callbacks.onDeselect()
      }
      return
    }

    const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key, 10) : null

    // Ctrl+Shift+1-9 → save group (must check before Ctrl+1-9)
    if (digit !== null && e.ctrlKey && e.shiftKey) {
      e.preventDefault()
      this.callbacks.onSaveGroup(digit)
      return
    }

    // Ctrl+1-9 → recall group
    if (digit !== null && e.ctrlKey && !e.shiftKey) {
      e.preventDefault()
      this.callbacks.onRecallGroup(digit)
      return
    }

    // 1-9 → select unit by index (0-based: key "1" = index 0)
    // Note: main.ts already had this in setupKeyboard(); KeyboardManager takes
    // it over so the logic is consolidated here. main.ts setupKeyboard() will
    // be replaced entirely.
    if (digit !== null && !e.ctrlKey && !e.altKey && !e.metaKey) {
      this.callbacks.onSelectUnit(digit - 1)
      return
    }

    switch (e.key) {
      case 'Tab':
        e.preventDefault()
        this.callbacks.onCycleTerritory()
        break

      case ' ':
        e.preventDefault()
        this.callbacks.onJumpToAlert()
        break

      case 'Escape':
        this.callbacks.onDeselect()
        break

      case 'm':
      case 'M':
        this.callbacks.onToggleMinimap?.()
        document.dispatchEvent(new CustomEvent('minimap:toggle'))
        break

      case 'n':
      case 'N':
        if (e.altKey) {
          e.preventDefault()
          this.callbacks.onDeployUnit()
          document.dispatchEvent(new CustomEvent('unit:deploy'))
        }
        break

      case 'k':
      case 'K':
        if (e.altKey) {
          e.preventDefault()
          this.callbacks.onKillUnit()
          document.dispatchEvent(new CustomEvent('unit:kill'))
        }
        break
    }
  }
}
