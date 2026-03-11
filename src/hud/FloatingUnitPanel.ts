/**
 * FloatingUnitPanel - Click-to-interact command card anchored to units
 *
 * Replaces the always-visible Intel Panel sidebar with a contextual panel
 * that appears when clicking a unit on the battlefield.
 *
 * Compact mode: name, status, current tool, last 3 activity lines, action buttons
 * Expanded mode: full activity feed + chat input to send prompts
 */

import type { UnitRenderer } from '../renderer/UnitRenderer'
import type { ManagedSession } from '../../shared/types'
import { escapeHtml } from '../ui/FeedManager'

export interface ActivityItem {
  timestamp: number
  sessionName: string
  toolName?: string
  description: string
  type: 'tool' | 'completion' | 'error' | 'info'
}

export class FloatingUnitPanel {
  private el: HTMLElement
  private isExpanded = false
  private currentUnitId: string | null = null
  private currentSession: ManagedSession | null = null
  private activityBuffer: ActivityItem[] = []
  private maxActivity = 30

  // Callbacks
  private onSendPrompt: ((sessionId: string, prompt: string) => void) | null = null
  private onCancelSession: ((sessionId: string) => void) | null = null

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'floating-panel hidden'
    this.el.innerHTML = this.buildHTML()

    const mainArea = document.getElementById('main-area')
    if (mainArea) {
      mainArea.appendChild(this.el)
    }

    this.setupEventListeners()
  }

  private buildHTML(): string {
    return `
      <div class="fp-header">
        <span class="fp-name"></span>
        <span class="fp-status"></span>
        <div class="fp-header-actions">
          <button class="fp-expand-btn" title="Expand">&#x25BC;</button>
          <button class="fp-close-btn" title="Close">&times;</button>
        </div>
      </div>
      <div class="fp-tool-row"></div>
      <div class="fp-health-row">
        <span class="fp-health-label">CTX</span>
        <div class="fp-health-track">
          <div class="fp-health-fill"></div>
        </div>
        <span class="fp-health-text"></span>
      </div>
      <div class="fp-territory-row"></div>
      <div class="fp-activity-feed"></div>
      <div class="fp-actions">
        <button class="fp-btn fp-btn-order">ORDER</button>
        <button class="fp-btn fp-btn-cancel">CANCEL</button>
      </div>
      <div class="fp-expanded-content hidden">
        <div class="fp-full-feed"></div>
        <div class="fp-prompt-row">
          <textarea class="fp-prompt-input" placeholder="Send order..." rows="2"></textarea>
          <button class="fp-prompt-send">SEND</button>
        </div>
      </div>
    `
  }

  private setupEventListeners(): void {
    // Close button
    this.el.querySelector('.fp-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.hide()
    })

    // Expand/collapse toggle
    this.el.querySelector('.fp-expand-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleExpand()
    })

    // Order button -> expand and focus prompt
    this.el.querySelector('.fp-btn-order')?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!this.isExpanded) this.toggleExpand()
      const input = this.el.querySelector('.fp-prompt-input') as HTMLTextAreaElement
      input?.focus()
    })

    // Cancel button
    this.el.querySelector('.fp-btn-cancel')?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.currentUnitId && this.onCancelSession) {
        this.onCancelSession(this.currentUnitId)
      }
    })

    // Send prompt
    this.el.querySelector('.fp-prompt-send')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.submitPrompt()
    })

    // Enter to send (shift+enter for newline)
    this.el.querySelector('.fp-prompt-input')?.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault()
        ke.stopPropagation()
        this.submitPrompt()
      }
    })

    // Prevent clicks inside panel from propagating to battlefield (prevents pan)
    this.el.addEventListener('mousedown', (e) => e.stopPropagation())
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation())
  }

  private submitPrompt(): void {
    const input = this.el.querySelector('.fp-prompt-input') as HTMLTextAreaElement
    const text = input?.value.trim()
    if (text && this.currentUnitId && this.onSendPrompt) {
      this.onSendPrompt(this.currentUnitId, text)
      input.value = ''
    }
  }

  // === Public API ===

  setSendPromptHandler(handler: (sessionId: string, prompt: string) => void): void {
    this.onSendPrompt = handler
  }

  setCancelHandler(handler: (sessionId: string) => void): void {
    this.onCancelSession = handler
  }

  show(unitId: string, unit: UnitRenderer, session: ManagedSession | undefined, screenX: number, screenY: number): void {
    this.currentUnitId = unitId
    this.currentSession = session || null
    this.activityBuffer = []

    this.el.classList.remove('hidden')
    this.updateContent(unit, session)
    this.updatePosition(screenX, screenY)
  }

  hide(): void {
    this.el.classList.add('hidden')
    this.currentUnitId = null
    this.currentSession = null
    this.isExpanded = false
    this.el.classList.remove('expanded')
    this.el.querySelector('.fp-expanded-content')?.classList.add('hidden')
    const btn = this.el.querySelector('.fp-expand-btn')
    if (btn) btn.innerHTML = '&#x25BC;'
  }

  toggle(unitId: string, unit: UnitRenderer, session: ManagedSession | undefined, screenX: number, screenY: number): void {
    if (this.isVisible() && this.currentUnitId === unitId) {
      this.hide()
    } else {
      this.show(unitId, unit, session, screenX, screenY)
    }
  }

  isVisible(): boolean {
    return this.currentUnitId !== null && !this.el.classList.contains('hidden')
  }

  getUnitId(): string | null {
    return this.currentUnitId
  }

  updatePosition(screenX: number, screenY: number): void {
    if (!this.isVisible()) return

    const mainArea = document.getElementById('main-area')
    if (!mainArea) return

    const bounds = mainArea.getBoundingClientRect()
    const panelRect = this.el.getBoundingClientRect()
    const panelW = panelRect.width || 260
    const panelH = panelRect.height || 200

    // Offset to the right of the unit
    let x = screenX + 40
    let y = screenY - panelH / 2

    // Flip left if too close to right edge
    if (x + panelW > bounds.width - 10) {
      x = screenX - panelW - 40
    }

    // Clamp vertical
    if (y < 10) y = 10
    if (y + panelH > bounds.height - 10) {
      y = bounds.height - panelH - 10
    }

    // Clamp horizontal
    if (x < 10) x = 10

    this.el.style.transform = `translate(${x}px, ${y}px)`
  }

  updateContent(unit: UnitRenderer, session?: ManagedSession): void {
    const s = session || this.currentSession

    // Name
    const nameEl = this.el.querySelector('.fp-name')
    if (nameEl) nameEl.textContent = unit.name

    // Status
    const statusEl = this.el.querySelector('.fp-status') as HTMLElement
    if (statusEl) {
      statusEl.textContent = unit.status.toUpperCase()
      statusEl.className = `fp-status status-${unit.status}`
    }

    // Current tool
    const toolRow = this.el.querySelector('.fp-tool-row') as HTMLElement
    if (toolRow) {
      if (s?.currentTool) {
        toolRow.textContent = `[${s.currentTool}]`
        toolRow.classList.remove('hidden')
      } else {
        toolRow.classList.add('hidden')
      }
    }

    // Territory
    const territoryRow = this.el.querySelector('.fp-territory-row') as HTMLElement
    if (territoryRow) {
      territoryRow.textContent = unit.territory.toUpperCase()
    }

    // Health bar
    let healthPct = 100
    if (s?.tokens) {
      healthPct = Math.max(0, Math.min(100, (1 - s.tokens.current / 200000) * 100))
    }
    const fill = this.el.querySelector('.fp-health-fill') as HTMLElement
    const healthText = this.el.querySelector('.fp-health-text')
    if (fill) {
      fill.style.width = `${healthPct}%`
      fill.className = 'fp-health-fill' + (healthPct < 20 ? ' critical' : healthPct < 50 ? ' warning' : '')
    }
    if (healthText) healthText.textContent = `${Math.round(healthPct)}%`

    // Render activity feed (compact: last 3)
    this.renderActivityFeed()
  }

  updateSession(session: ManagedSession): void {
    if (this.currentUnitId === session.id) {
      this.currentSession = session
    }
  }

  addActivity(item: ActivityItem): void {
    this.activityBuffer.push(item)
    if (this.activityBuffer.length > this.maxActivity) {
      this.activityBuffer.shift()
    }
    this.renderActivityFeed()
  }

  private renderActivityFeed(): void {
    // Compact feed: last 3 items
    const feedEl = this.el.querySelector('.fp-activity-feed')
    if (feedEl) {
      const items = this.activityBuffer.slice(-3)
      feedEl.innerHTML = items.map(item => {
        const borderClass = item.type === 'error' ? 'border-red' : item.type === 'completion' ? 'border-green' : 'border-cyan'
        const toolTag = item.toolName ? `<span class="fp-tool-tag">${escapeHtml(item.toolName)}</span>` : ''
        return `<div class="fp-activity-item ${borderClass}">${toolTag}${escapeHtml(item.description)}</div>`
      }).join('')
    }

    // Expanded feed: all items
    if (this.isExpanded) {
      const fullFeedEl = this.el.querySelector('.fp-full-feed')
      if (fullFeedEl) {
        fullFeedEl.innerHTML = this.activityBuffer.map(item => {
          const borderClass = item.type === 'error' ? 'border-red' : item.type === 'completion' ? 'border-green' : 'border-cyan'
          const toolTag = item.toolName ? `<span class="fp-tool-tag">${escapeHtml(item.toolName)}</span>` : ''
          const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          return `<div class="fp-activity-item ${borderClass}"><span class="fp-time">${time}</span>${toolTag}${escapeHtml(item.description)}</div>`
        }).join('')

        // Auto-scroll to bottom
        fullFeedEl.scrollTop = fullFeedEl.scrollHeight
      }
    }
  }

  private toggleExpand(): void {
    this.isExpanded = !this.isExpanded
    const expanded = this.el.querySelector('.fp-expanded-content')
    const btn = this.el.querySelector('.fp-expand-btn')

    if (this.isExpanded) {
      this.el.classList.add('expanded')
      expanded?.classList.remove('hidden')
      if (btn) btn.innerHTML = '&#x25B2;'
      this.renderActivityFeed()
    } else {
      this.el.classList.remove('expanded')
      expanded?.classList.add('hidden')
      if (btn) btn.innerHTML = '&#x25BC;'
    }
  }
}
