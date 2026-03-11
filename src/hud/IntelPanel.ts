/**
 * IntelPanel - Right-side intelligence panel
 *
 * Tabs: ACTIVITY | THREATS | SIGNALS
 * Activity tab shows live event stream.
 * Threats/Signals show categorized events.
 * Sessions list shows managed units.
 */

import type { ManagedSession } from '../../shared/types'
import { escapeHtml } from '../ui/FeedManager'

export interface IntelEvent {
  timestamp: number
  sessionName: string
  toolName?: string
  description: string
  type: 'tool' | 'completion' | 'error' | 'prompt'
}

export class IntelPanel {
  private el: HTMLElement
  private activeTab: string = 'activity'
  private threatsList!: HTMLElement
  private signalsList!: HTMLElement
  private activityFeed!: HTMLElement
  private activityWrapper!: HTMLElement
  private scrollBtn!: HTMLElement

  // Event storage
  private activityEvents: IntelEvent[] = []
  private readonly MAX_EVENTS = 200

  // Callbacks
  private onSessionSelect: ((sessionId: string) => void) | null = null
  private onSessionCreate: (() => void) | null = null

  constructor() {
    this.el = document.getElementById('intel-panel')!
    this.render()
    this.setupTabs()
    this.setupScrollBehavior()
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="intel-header">
        <h2 class="intel-title">INTEL</h2>
        <button id="settings-btn" class="intel-settings-btn" title="Settings">&#x2699;</button>
      </div>

      <div class="intel-tabs">
        <button class="intel-tab active" data-tab="activity">ACTIVITY</button>
        <button class="intel-tab" data-tab="threats">THREATS</button>
        <button class="intel-tab" data-tab="signals">SIGNALS</button>
      </div>

      <!-- Sessions panel -->
      <div id="sessions-panel">
        <div id="sessions-list">
          <div class="session-item all-sessions active" data-session="all">
            <div class="session-hotkey">0</div>
            <div class="session-info">
              <div class="session-name">All Units</div>
              <div class="session-detail" id="all-sessions-count">No active units</div>
            </div>
          </div>
          <div id="managed-sessions"></div>
        </div>
      </div>

      <div class="intel-content">
        <div class="intel-tab-content active" id="tab-activity">
          <div id="activity-feed-wrapper">
            <div id="activity-feed">
              <div id="feed-empty">
                <div id="feed-empty-icon">&#x2694;</div>
                <h3>Awaiting orders</h3>
                <p>Deploy agents to see activity here</p>
              </div>
            </div>
            <button id="feed-scroll-bottom">&#x2193; Jump to latest</button>
          </div>
        </div>

        <div class="intel-tab-content" id="tab-threats">
          <div class="intel-list" id="threats-list">
            <div class="intel-empty">No active threats</div>
          </div>
        </div>

        <div class="intel-tab-content" id="tab-signals">
          <div class="intel-list" id="signals-list">
            <div class="intel-empty">No signals</div>
          </div>
        </div>
      </div>
    `

    this.threatsList = document.getElementById('threats-list')!
    this.signalsList = document.getElementById('signals-list')!
    this.activityFeed = document.getElementById('activity-feed')!
    this.activityWrapper = document.getElementById('activity-feed-wrapper')!
    this.scrollBtn = document.getElementById('feed-scroll-bottom')!
  }

  private setupTabs(): void {
    const tabs = this.el.querySelectorAll('.intel-tab')
    const contents = this.el.querySelectorAll('.intel-tab-content')

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = (tab as HTMLElement).dataset.tab!
        this.activeTab = tabId

        tabs.forEach(t => t.classList.remove('active'))
        contents.forEach(c => c.classList.remove('active'))

        tab.classList.add('active')
        document.getElementById(`tab-${tabId}`)?.classList.add('active')
      })
    })
  }

  private setupScrollBehavior(): void {
    // Scroll button click
    this.scrollBtn?.addEventListener('click', () => {
      this.activityFeed.scrollTop = this.activityFeed.scrollHeight
      this.scrollBtn.classList.remove('visible')
    })

    // Show/hide scroll button
    this.activityWrapper?.addEventListener('scroll', () => {
      const wrapper = this.activityWrapper
      const isNearBottom = wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight < 80
      this.scrollBtn?.classList.toggle('visible', !isNearBottom)
    })
  }

  private isNearBottom(): boolean {
    const wrapper = this.activityWrapper
    if (!wrapper) return true
    return wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight < 80
  }

  private removeEmptyState(): void {
    const empty = document.getElementById('feed-empty')
    if (empty) empty.remove()
  }

  /** Format timestamp to HH:MM:SS */
  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString()
  }

  // === Activity Tab ===

  addActivity(event: IntelEvent): void {
    this.removeEmptyState()

    // Enforce max events
    if (this.activityEvents.length >= this.MAX_EVENTS) {
      this.activityEvents.shift()
      const first = this.activityFeed.querySelector('.activity-item')
      if (first) first.remove()
    }

    this.activityEvents.push(event)

    const borderClass = {
      tool: 'activity-border-cyan',
      completion: 'activity-border-gold',
      error: 'activity-border-red',
      prompt: 'activity-border-purple',
    }[event.type] || 'activity-border-cyan'

    const item = document.createElement('div')
    item.className = `activity-item ${borderClass}`
    item.innerHTML = `
      <div class="activity-time">${this.formatTime(event.timestamp)}</div>
      <div class="activity-body">
        <span class="activity-session">${escapeHtml(event.sessionName)}</span>
        ${event.toolName ? `<span class="activity-tool">[${escapeHtml(event.toolName)}]</span>` : ''}
        <span class="activity-desc">${escapeHtml(event.description)}</span>
      </div>
    `

    const shouldScroll = this.isNearBottom()
    this.activityFeed.appendChild(item)

    if (shouldScroll) {
      requestAnimationFrame(() => {
        this.activityWrapper.scrollTop = this.activityWrapper.scrollHeight
      })
    }
  }

  // === Threats Tab ===

  addThreat(text: string, severity: 'low' | 'medium' | 'high' = 'medium', territory?: string): void {
    const empty = this.threatsList.querySelector('.intel-empty')
    if (empty) empty.remove()

    const severityIcons = { low: '\u26A0', medium: '\u26D4', high: '\uD83D\uDD34' }
    const icon = severityIcons[severity] || severityIcons.medium

    const item = document.createElement('div')
    item.className = `intel-item threat-${severity}`
    item.innerHTML = `
      <span class="intel-item-dot threat-dot-${severity}"></span>
      <span class="threat-icon">${icon}</span>
      <span class="intel-item-text">${escapeHtml(text)}</span>
      ${territory ? `<span class="territory-badge">${escapeHtml(territory)}</span>` : ''}
      <span class="intel-item-time">${this.formatTime(Date.now())}</span>
    `
    this.threatsList.prepend(item)
  }

  // === Signals Tab ===

  addSignal(text: string, type: 'success' | 'info' = 'info'): void {
    const empty = this.signalsList.querySelector('.intel-empty')
    if (empty) empty.remove()

    const borderClass = type === 'success' ? 'signal-success' : 'signal-info'
    const icon = type === 'success' ? '\u2705' : '\uD83D\uDCE1'

    const item = document.createElement('div')
    item.className = `intel-item ${borderClass}`
    item.innerHTML = `
      <span class="intel-item-dot signal-dot"></span>
      <span class="signal-icon">${icon}</span>
      <span class="intel-item-text">${escapeHtml(text)}</span>
      <span class="intel-item-time">${this.formatTime(Date.now())}</span>
    `
    this.signalsList.prepend(item)
  }

  // === Session select callback ===

  setSessionSelectHandler(handler: (sessionId: string) => void): void {
    this.onSessionSelect = handler
  }

  setSessionCreateHandler(handler: () => void): void {
    this.onSessionCreate = handler
  }
}
