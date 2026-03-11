/**
 * CommandBar - Bottom command input for sending orders to agents
 *
 * Features:
 * - Monospace input with cyan caret
 * - Session selector dropdown with live status
 * - Send button with "Sent" indicator
 * - Notification ticker rotating through recent events
 * - Keyboard shortcuts: /, Enter, Esc
 */

import type { ManagedSession } from '../../shared/types'

export type CommandSubmitHandler = (prompt: string, sessionId: string | null) => void

export class CommandBar {
  private el: HTMLElement
  private input!: HTMLTextAreaElement
  private submitBtn!: HTMLButtonElement
  private cancelBtn!: HTMLButtonElement
  private sessionSelect!: HTMLSelectElement
  private tickerEl!: HTMLElement
  private targetEl!: HTMLElement
  private statusEl!: HTMLElement
  private onSubmit: CommandSubmitHandler | null = null

  // Ticker state
  private tickerMessages: string[] = ['System ready. Awaiting orders.']
  private tickerIndex = 0
  private tickerInterval: number | null = null
  private readonly MAX_TICKER = 3

  // Sessions list for autocomplete
  private currentSessions: ManagedSession[] = []

  constructor() {
    this.el = document.getElementById('command-bar')!
    this.render()
    this.setupEvents()
    this.startTickerRotation()
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="command-bar-inner">
        <div class="command-ticker" id="command-ticker">System ready. Awaiting orders.</div>
        <div class="command-input-row">
          <select id="command-session-select" class="command-session-select">
            <option value="">All Units</option>
          </select>
          <div class="command-input-wrapper">
            <textarea id="prompt-input" class="command-input" placeholder="Enter command..." autocomplete="off" rows="1"></textarea>
          </div>
          <button type="button" id="prompt-submit" class="command-btn command-btn-send">&#x2191; SEND</button>
          <button type="button" id="prompt-cancel" class="command-btn command-btn-cancel" style="display:none">&#x25A0; STOP</button>
        </div>
        <div class="command-status-row">
          <span id="prompt-target" class="command-target"></span>
          <span id="prompt-status" class="command-status"></span>
        </div>
      </div>
    `

    this.input = document.getElementById('prompt-input') as HTMLTextAreaElement
    this.submitBtn = document.getElementById('prompt-submit') as HTMLButtonElement
    this.cancelBtn = document.getElementById('prompt-cancel') as HTMLButtonElement
    this.sessionSelect = document.getElementById('command-session-select') as HTMLSelectElement
    this.tickerEl = document.getElementById('command-ticker')!
    this.targetEl = document.getElementById('prompt-target')!
    this.statusEl = document.getElementById('prompt-status')!
  }

  private setupEvents(): void {
    // Submit on button click
    this.submitBtn.addEventListener('click', () => this.submit())

    // Submit on Enter (Shift+Enter for newline)
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit()
      }
      if (e.key === 'Escape') {
        this.input.blur()
      }
    })

    // Auto-resize textarea
    this.input.addEventListener('input', () => {
      this.input.style.height = 'auto'
      this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px'

      // Basic autocomplete: if input starts with session name, highlight in dropdown
      this.checkAutocomplete()
    })

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return
      }

      if (e.key === '/' || e.key === 'Enter') {
        e.preventDefault()
        this.focus()
      }
    })
  }

  private checkAutocomplete(): void {
    const text = this.input.value.toLowerCase().trim()
    if (!text) return

    for (const session of this.currentSessions) {
      const name = (session.name || '').toLowerCase()
      if (name && text.startsWith(name)) {
        this.sessionSelect.value = session.id
        return
      }
    }
  }

  private submit(): void {
    const prompt = this.input.value.trim()
    if (!prompt) return

    const sessionId = this.sessionSelect.value || null
    if (this.onSubmit) {
      this.onSubmit(prompt, sessionId)
    }

    this.input.value = ''
    this.input.style.height = 'auto'

    // Show "Sent" indicator briefly
    this.showSentIndicator()
  }

  private showSentIndicator(): void {
    this.statusEl.textContent = 'Sent \u2713'
    this.statusEl.classList.add('command-status-sent')
    setTimeout(() => {
      this.statusEl.textContent = ''
      this.statusEl.classList.remove('command-status-sent')
    }, 2000)
  }

  // === Ticker ===

  private startTickerRotation(): void {
    this.tickerInterval = window.setInterval(() => {
      if (this.tickerMessages.length > 1) {
        this.tickerIndex = (this.tickerIndex + 1) % this.tickerMessages.length
        this.tickerEl.classList.add('ticker-fade')
        setTimeout(() => {
          this.tickerEl.textContent = this.tickerMessages[this.tickerIndex]
          this.tickerEl.classList.remove('ticker-fade')
        }, 200)
      }
    }, 4000)
  }

  pushTicker(text: string): void {
    this.tickerMessages.unshift(text)
    if (this.tickerMessages.length > this.MAX_TICKER) {
      this.tickerMessages.pop()
    }
    this.tickerIndex = 0
    this.tickerEl.textContent = text
    this.tickerEl.classList.add('ticker-new')
    setTimeout(() => this.tickerEl.classList.remove('ticker-new'), 300)
  }

  // === Public API ===

  setSubmitHandler(handler: CommandSubmitHandler): void {
    this.onSubmit = handler
  }

  updateSessions(sessions: ManagedSession[]): void {
    this.currentSessions = sessions
    const currentValue = this.sessionSelect.value
    this.sessionSelect.innerHTML = '<option value="">All Units</option>'

    // Sort: working first, then idle, then offline
    const sorted = [...sessions].sort((a, b) => {
      const order: Record<string, number> = { working: 0, waiting: 1, idle: 2, offline: 3 }
      return (order[a.status] ?? 2) - (order[b.status] ?? 2)
    })

    for (const s of sorted) {
      const opt = document.createElement('option')
      opt.value = s.id
      const name = s.name || s.cwd?.split('/').pop() || s.id.slice(0, 8)
      const statusDot = s.status === 'working' ? '\u25CF ' : s.status === 'idle' ? '\u25CB ' : '\u25CC '
      opt.textContent = `${statusDot}${name}`
      this.sessionSelect.appendChild(opt)
    }

    // Restore selection
    if (currentValue) {
      this.sessionSelect.value = currentValue
    }
  }

  setTicker(text: string): void {
    this.pushTicker(text)
  }

  focus(): void {
    this.input.focus()
  }

  selectSession(sessionId: string): void {
    this.sessionSelect.value = sessionId
  }

  getInput(): HTMLTextAreaElement {
    return this.input
  }

  getSubmitButton(): HTMLButtonElement {
    return this.submitBtn
  }

  getCancelButton(): HTMLButtonElement {
    return this.cancelBtn
  }

  getTargetElement(): HTMLElement {
    return this.targetEl
  }

  getStatusElement(): HTMLElement {
    return this.statusEl
  }

  destroy(): void {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval)
    }
  }
}
