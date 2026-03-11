/**
 * ToastManager - Battlefield notification toast system
 *
 * Manages a stack of toast notifications in the top-right corner.
 * Each toast: icon + message + timestamp, auto-dismisses after 4 seconds.
 * Max 5 visible at once — older ones slide up and fade.
 *
 * Toast types:
 *   success (green #82C896)  — objective defeated, combo milestones
 *   warning (amber #FFB86C)  — unit exhausted, threat spawned, stalled objective
 *   danger  (red #CC3333)    — unit collapsed, revenue drop, churn detected
 *   info    (teal #4A9DB8)   — unit deployed, territory change, packet delivered
 */

export type BattleToastType = 'success' | 'warning' | 'danger' | 'info'

const TYPE_COLORS: Record<BattleToastType, string> = {
  success: '#82C896',
  warning: '#FFB86C',
  danger:  '#CC3333',
  info:    '#4A9DB8',
}

const DEFAULT_ICONS: Record<BattleToastType, string> = {
  success: '\u2714',  // checkmark
  warning: '\u26A0',  // warning triangle
  danger:  '\u2620',  // skull
  info:    '\u25C6',  // diamond
}

const MAX_VISIBLE = 5
const DISMISS_MS = 4000
const FADE_OUT_MS = 300

interface ToastEntry {
  el: HTMLElement
  timer: ReturnType<typeof setTimeout>
}

export class ToastManager {
  private container: HTMLElement
  private toasts: ToastEntry[] = []

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'battle-toast-container'
    document.body.appendChild(this.container)
  }

  /**
   * Show a battlefield toast notification.
   */
  show(type: BattleToastType, message: string, icon?: string): void {
    const el = document.createElement('div')
    el.className = `battle-toast battle-toast--${type}`
    el.style.borderLeftColor = TYPE_COLORS[type]

    const displayIcon = icon || DEFAULT_ICONS[type]
    const now = new Date()
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    el.innerHTML = `
      <span class="battle-toast__icon" style="color:${TYPE_COLORS[type]}">${displayIcon}</span>
      <span class="battle-toast__message">${escapeHtml(message)}</span>
      <span class="battle-toast__time">${timeStr}</span>
    `

    this.container.appendChild(el)

    // Force reflow so the slide-in animation triggers
    void el.offsetWidth
    el.classList.add('battle-toast--visible')

    const timer = setTimeout(() => this.dismiss(entry), DISMISS_MS)
    const entry: ToastEntry = { el, timer }
    this.toasts.push(entry)

    // Enforce max visible — remove oldest beyond limit
    while (this.toasts.length > MAX_VISIBLE) {
      const oldest = this.toasts[0]
      clearTimeout(oldest.timer)
      this.dismiss(oldest)
    }
  }

  private dismiss(entry: ToastEntry): void {
    const idx = this.toasts.indexOf(entry)
    if (idx === -1) return

    this.toasts.splice(idx, 1)
    entry.el.classList.add('battle-toast--out')

    setTimeout(() => {
      entry.el.remove()
    }, FADE_OUT_MS)
  }

  /** Convenience: success toast */
  success(message: string, icon?: string): void {
    this.show('success', message, icon)
  }

  /** Convenience: warning toast */
  warning(message: string, icon?: string): void {
    this.show('warning', message, icon)
  }

  /** Convenience: danger toast */
  danger(message: string, icon?: string): void {
    this.show('danger', message, icon)
  }

  /** Convenience: info toast */
  info(message: string, icon?: string): void {
    this.show('info', message, icon)
  }

  destroy(): void {
    for (const t of this.toasts) {
      clearTimeout(t.timer)
    }
    this.toasts = []
    this.container.remove()
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/** Singleton instance */
export const toastManager = new ToastManager()
