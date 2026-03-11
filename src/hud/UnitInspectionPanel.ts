/**
 * UnitInspectionPanel - Right-side slide-out panel showing detailed unit info
 *
 * Appears when a unit is clicked. Shows name, model label, status, territory,
 * health bar, uptime, current tool, recent tool history, and combo count.
 * Dismiss with X button, Escape, or clicking on background (no unit).
 */

import type { UnitRenderer, UnitClass, UnitStatus, SustainedToolType } from '../renderer/UnitRenderer'
import type { ManagedSession } from '../../shared/types'
import { escapeHtml } from '../ui/FeedManager'

/** A single tool use record for the recent-tools list */
export interface ToolUseRecord {
  toolName: string
  timestamp: number
  description?: string
}

const CLASS_LABELS: Record<UnitClass, string> = {
  command: 'OPUS',
  operations: 'SONNET',
  recon: 'HAIKU',
}

const CLASS_ACCENTS: Record<UnitClass, string> = {
  command: '#FFB86C',
  operations: '#E8682A',
  recon: '#82C896',
}

const STATUS_COLORS: Record<UnitStatus, string> = {
  idle: '#82C896',
  working: '#E8682A',
  thinking: '#4A9DB8',
  combat: '#CC3333',
  exhausted: '#8B7355',
  offline: '#B4A690',
}

const STATUS_LABELS: Record<UnitStatus, string> = {
  idle: 'IDLE',
  working: 'WORKING',
  thinking: 'THINKING',
  combat: 'COMBAT',
  exhausted: 'EXHAUSTED',
  offline: 'OFFLINE',
}

function formatUptime(startTime: number): string {
  const elapsed = Date.now() - startTime
  const totalMin = Math.floor(elapsed / 60000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatToolTime(timestamp: number): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export class UnitInspectionPanel {
  private container: HTMLElement
  private visible = false
  private currentUnitId: string | null = null

  // Cached DOM elements
  private nameEl!: HTMLElement
  private modelLabelEl!: HTMLElement
  private statusBadgeEl!: HTMLElement
  private territoryEl!: HTMLElement
  private healthFillEl!: HTMLElement
  private healthTextEl!: HTMLElement
  private uptimeEl!: HTMLElement
  private currentToolEl!: HTMLElement
  private recentToolsEl!: HTMLElement
  private comboEl!: HTMLElement

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'unit-inspection-panel'
    document.body.appendChild(this.container)
    this.render()
    this.setupListeners()
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="uip-header">
        <div class="uip-header-left">
          <span class="uip-name"></span>
          <span class="uip-model-label"></span>
        </div>
        <button class="uip-close-btn">&times;</button>
      </div>

      <div class="uip-status-row">
        <span class="uip-status-badge"></span>
      </div>

      <div class="uip-divider"></div>

      <div class="uip-field">
        <div class="uip-field-label">TERRITORY</div>
        <div class="uip-field-value uip-territory"></div>
      </div>

      <div class="uip-field">
        <div class="uip-field-label">CONTEXT HEALTH</div>
        <div class="uip-health-row">
          <div class="uip-health-track">
            <div class="uip-health-fill"></div>
          </div>
          <span class="uip-health-text"></span>
        </div>
      </div>

      <div class="uip-field">
        <div class="uip-field-label">UPTIME</div>
        <div class="uip-field-value uip-uptime">--</div>
      </div>

      <div class="uip-divider"></div>

      <div class="uip-field">
        <div class="uip-field-label">CURRENT TOOL</div>
        <div class="uip-field-value uip-current-tool">
          <span class="uip-tool-none">none</span>
        </div>
      </div>

      <div class="uip-field">
        <div class="uip-field-label">COMBO</div>
        <div class="uip-field-value uip-combo">--</div>
      </div>

      <div class="uip-divider"></div>

      <div class="uip-field">
        <div class="uip-field-label">RECENT TOOLS</div>
        <div class="uip-recent-tools">
          <div class="uip-empty">No tool activity</div>
        </div>
      </div>
    `

    this.nameEl = this.container.querySelector('.uip-name')!
    this.modelLabelEl = this.container.querySelector('.uip-model-label')!
    this.statusBadgeEl = this.container.querySelector('.uip-status-badge')!
    this.territoryEl = this.container.querySelector('.uip-territory')!
    this.healthFillEl = this.container.querySelector('.uip-health-fill')!
    this.healthTextEl = this.container.querySelector('.uip-health-text')!
    this.uptimeEl = this.container.querySelector('.uip-uptime')!
    this.currentToolEl = this.container.querySelector('.uip-current-tool')!
    this.recentToolsEl = this.container.querySelector('.uip-recent-tools')!
    this.comboEl = this.container.querySelector('.uip-combo')!
  }

  private setupListeners(): void {
    // Close button
    this.container.querySelector('.uip-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.hide()
    })

    // Prevent panel clicks from propagating
    this.container.addEventListener('mousedown', (e) => e.stopPropagation())
    this.container.addEventListener('pointerdown', (e) => e.stopPropagation())
  }

  // === Public API ===

  show(unitId: string, unit: UnitRenderer, session: ManagedSession | undefined, recentTools: ToolUseRecord[], comboCount: number): void {
    this.currentUnitId = unitId
    this.visible = true
    this.container.classList.add('visible')
    this.updateContent(unit, session, recentTools, comboCount)
  }

  hide(): void {
    this.visible = false
    this.currentUnitId = null
    this.container.classList.remove('visible')
  }

  isShowing(): boolean {
    return this.visible
  }

  getUnitId(): string | null {
    return this.currentUnitId
  }

  update(unit: UnitRenderer, session: ManagedSession | undefined, recentTools: ToolUseRecord[], comboCount: number): void {
    if (!this.visible) return
    this.updateContent(unit, session, recentTools, comboCount)
  }

  private updateContent(unit: UnitRenderer, session: ManagedSession | undefined, recentTools: ToolUseRecord[], comboCount: number): void {
    const unitClass = unit.unitClass
    const accentColor = CLASS_ACCENTS[unitClass]

    // Header: name + model label
    this.nameEl.textContent = unit.name
    this.modelLabelEl.textContent = CLASS_LABELS[unitClass]
    this.modelLabelEl.style.color = accentColor

    // Status badge
    const status = unit.status
    const statusColor = STATUS_COLORS[status]
    this.statusBadgeEl.textContent = STATUS_LABELS[status]
    this.statusBadgeEl.style.setProperty('--status-color', statusColor)

    // Territory
    this.territoryEl.textContent = unit.territory.toUpperCase().replace('-', ' ')

    // Health bar
    let healthPct = 100
    if (session?.tokens) {
      healthPct = Math.max(0, Math.min(100, (1 - session.tokens.current / 200000) * 100))
    }
    this.healthFillEl.style.width = `${healthPct}%`
    this.healthFillEl.className = 'uip-health-fill' +
      (healthPct < 20 ? ' critical' : healthPct < 50 ? ' warning' : '')
    this.healthTextEl.textContent = `${Math.round(healthPct)}%`

    // Uptime
    const startTime = session?.createdAt || Date.now()
    this.uptimeEl.textContent = formatUptime(startTime)

    // Current tool
    if (session?.currentTool) {
      this.currentToolEl.innerHTML = `<span class="uip-tool-active">[${escapeHtml(session.currentTool)}]</span>`
    } else {
      this.currentToolEl.innerHTML = `<span class="uip-tool-none">none</span>`
    }

    // Combo count
    if (comboCount > 1) {
      this.comboEl.innerHTML = `<span class="uip-combo-active">x${comboCount}</span>`
    } else {
      this.comboEl.textContent = '--'
    }

    // Recent tools (last 5)
    if (recentTools.length === 0) {
      this.recentToolsEl.innerHTML = '<div class="uip-empty">No tool activity</div>'
    } else {
      this.recentToolsEl.innerHTML = recentTools
        .slice(-5)
        .reverse()
        .map(t => {
          const time = formatToolTime(t.timestamp)
          const desc = t.description ? ` ${escapeHtml(t.description)}` : ''
          return `<div class="uip-tool-item">
            <span class="uip-tool-time">${time}</span>
            <span class="uip-tool-name">${escapeHtml(t.toolName)}</span>${desc}
          </div>`
        })
        .join('')
    }
  }

  destroy(): void {
    this.container.remove()
  }
}
