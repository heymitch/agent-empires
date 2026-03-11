/**
 * UnitDetail - Detailed info panel when a unit is selected
 *
 * Shows:
 * - Session name, status badge
 * - Current tool (if working)
 * - Territory badge
 * - Context health progress bar
 * - Git info (branch, changes)
 * - Action buttons: VIEW TERMINAL, SEND ORDER, CANCEL
 */

import type { UnitRenderer } from '../renderer/UnitRenderer'
import type { ManagedSession } from '../../shared/types'
import { escapeHtml } from '../ui/FeedManager'

export class UnitDetail {
  private el: HTMLElement | null = null
  private currentUnit: UnitRenderer | null = null
  private currentSession: ManagedSession | null = null
  private onOrder: ((unitId: string) => void) | null = null
  private onCancel: ((unitId: string) => void) | null = null

  constructor() {
    // Create the element but don't show it yet
    this.el = document.createElement('div')
    this.el.id = 'unit-detail'
    this.el.className = 'unit-detail hidden'

    const intelPanel = document.getElementById('intel-panel')
    if (intelPanel) {
      const intelContent = intelPanel.querySelector('.intel-content')
      if (intelContent) {
        intelPanel.insertBefore(this.el, intelContent)
      } else {
        intelPanel.appendChild(this.el)
      }
    }
  }

  show(unit: UnitRenderer, session?: ManagedSession): void {
    this.currentUnit = unit
    this.currentSession = session || null
    if (!this.el) return

    this.el.classList.remove('hidden')
    this.render()
  }

  hide(): void {
    this.currentUnit = null
    this.currentSession = null
    if (this.el) {
      this.el.classList.add('hidden')
    }
  }

  isVisible(): boolean {
    return this.currentUnit !== null
  }

  setOrderHandler(handler: (unitId: string) => void): void {
    this.onOrder = handler
  }

  setCancelHandler(handler: (unitId: string) => void): void {
    this.onCancel = handler
  }

  /** Update detail panel with fresh session data (call on session_update) */
  updateSession(session: ManagedSession): void {
    if (this.currentUnit && this.currentSession?.id === session.id) {
      this.currentSession = session
      this.render()
    }
  }

  private render(): void {
    if (!this.el || !this.currentUnit) return

    const unit = this.currentUnit
    const session = this.currentSession
    const statusClass = `status-${unit.status}`

    // Context health bar
    let healthPercent = 100
    let healthClass = 'health-good'
    if (session?.tokens) {
      healthPercent = Math.max(0, Math.min(100, (1 - session.tokens.current / 200000) * 100))
      if (healthPercent < 20) healthClass = 'health-critical'
      else if (healthPercent < 50) healthClass = 'health-warning'
    }

    // Current tool
    const currentTool = session?.currentTool || ''

    // Git info
    const git = session?.gitStatus
    let gitHtml = ''
    if (git?.isRepo) {
      const totalChanges = git.totalFiles || 0
      gitHtml = `
        <div class="unit-detail-row">
          <span class="unit-detail-label">Branch</span>
          <span class="unit-detail-value unit-detail-branch">${escapeHtml(git.branch)}</span>
        </div>
        ${totalChanges > 0 ? `
        <div class="unit-detail-row">
          <span class="unit-detail-label">Changes</span>
          <span class="unit-detail-value">${totalChanges} file${totalChanges !== 1 ? 's' : ''}</span>
        </div>
        ` : ''}
      `
    }

    // tmux session name
    const tmuxName = session?.tmuxSession || ''

    this.el.innerHTML = `
      <div class="unit-detail-inner">
        <div class="unit-detail-header">
          <span class="unit-detail-name">${escapeHtml(unit.name)}</span>
          <span class="unit-detail-status ${statusClass}">${unit.status.toUpperCase()}</span>
        </div>

        ${currentTool ? `
        <div class="unit-detail-row">
          <span class="unit-detail-label">Using</span>
          <span class="unit-detail-value unit-detail-tool">${escapeHtml(currentTool)}</span>
        </div>
        ` : ''}

        <div class="unit-detail-row">
          <span class="unit-detail-label">Territory</span>
          <span class="unit-detail-value territory-badge-inline">${escapeHtml(unit.territory.toUpperCase())}</span>
        </div>

        <div class="unit-detail-row">
          <span class="unit-detail-label">Context</span>
          <div class="unit-health-bar-wrapper">
            <div class="unit-health-bar ${healthClass}" style="width: ${healthPercent}%"></div>
            <span class="unit-health-text">${Math.round(healthPercent)}%</span>
          </div>
        </div>

        ${gitHtml}

        <div class="unit-detail-actions">
          ${tmuxName ? `<button class="unit-btn unit-btn-terminal" id="unit-btn-terminal" title="tmux: ${escapeHtml(tmuxName)}">&#x1F5B5; TERMINAL</button>` : ''}
          <button class="unit-btn unit-btn-order" id="unit-btn-order">&#x2318; ORDER</button>
          <button class="unit-btn unit-btn-cancel" id="unit-btn-cancel">&#x2715; CANCEL</button>
        </div>
      </div>
    `

    // Wire up buttons
    const orderBtn = document.getElementById('unit-btn-order')
    if (orderBtn) {
      orderBtn.addEventListener('click', () => {
        if (this.onOrder && this.currentUnit) {
          this.onOrder(this.currentUnit.id)
        }
      })
    }

    const cancelBtn = document.getElementById('unit-btn-cancel')
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (this.onCancel && this.currentUnit) {
          this.onCancel(this.currentUnit.id)
        }
      })
    }

    const terminalBtn = document.getElementById('unit-btn-terminal')
    if (terminalBtn && tmuxName) {
      terminalBtn.addEventListener('click', () => {
        // Copy tmux attach command to clipboard
        navigator.clipboard.writeText(`tmux attach -t ${tmuxName}`).catch(() => {})
        terminalBtn.textContent = '\u2713 Copied'
        setTimeout(() => {
          terminalBtn.innerHTML = '&#x1F5B5; TERMINAL'
        }, 1500)
      })
    }
  }
}
