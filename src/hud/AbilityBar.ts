/**
 * AbilityBar - SC2-style ability bar for casting agent skills
 *
 * Positioned bottom-center of the screen. Shows when a unit is selected,
 * hides when deselected. Displays 6 ability slots (Q/W/E/R/D/F) with
 * cooldown overlays, tooltips, and a passive skill label.
 *
 * Click or hotkey → fires slash command as a prompt to the unit's session.
 * Skills that need parameters show a small input modal first.
 */

import type { ManagedSession } from '../../shared/types'
import type { Skill, UnitType, Hotkey, PassiveSkill } from '../game/SkillRegistry'
import { getLoadoutForUnit, getSkillByHotkey, inferUnitType, HOTKEY_ORDER } from '../game/SkillRegistry'
import { CooldownManager } from '../game/CooldownManager'
import { soundManager } from '../audio/SoundManager'
import { escapeHtml } from '../ui/FeedManager'

// ============================================================================
// Types
// ============================================================================

export type AbilityCastHandler = (sessionId: string, slashCommand: string) => Promise<void>

// ============================================================================
// AbilityBar
// ============================================================================

export class AbilityBar {
  private el: HTMLElement
  private currentUnitId: string | null = null
  private currentUnitType: UnitType | null = null
  private currentSession: ManagedSession | null = null
  private cooldownManager: CooldownManager
  private onCast: AbilityCastHandler | null = null
  private rafId: number | null = null
  private inputModal: HTMLElement | null = null

  constructor(cooldownManager: CooldownManager) {
    this.cooldownManager = cooldownManager

    // Create root element
    this.el = document.createElement('div')
    this.el.id = 'ability-bar'
    this.el.className = 'ability-bar hidden'

    // Create input modal (parameter entry)
    this.inputModal = document.createElement('div')
    this.inputModal.id = 'ability-input-modal'
    this.inputModal.className = 'ability-input-modal hidden'

    // Append to main area so it overlays the canvas
    const mainArea = document.getElementById('main-area')
    if (mainArea) {
      mainArea.appendChild(this.el)
      mainArea.appendChild(this.inputModal)
    }

    // Prevent clicks from propagating to battlefield
    this.el.addEventListener('mousedown', e => e.stopPropagation())
    this.el.addEventListener('pointerdown', e => e.stopPropagation())
    this.inputModal.addEventListener('mousedown', e => e.stopPropagation())
    this.inputModal.addEventListener('pointerdown', e => e.stopPropagation())

    // Start cooldown refresh loop
    this.startCooldownRefresh()
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  setCastHandler(handler: AbilityCastHandler): void {
    this.onCast = handler
  }

  /**
   * Show the ability bar for a selected unit.
   */
  show(unitId: string, session: ManagedSession): void {
    this.currentUnitId = unitId
    this.currentSession = session
    this.currentUnitType = inferUnitType(session.name || '')

    this.render()
    this.el.classList.remove('hidden')
  }

  /**
   * Hide the ability bar (unit deselected).
   */
  hide(): void {
    this.el.classList.add('hidden')
    this.hideInputModal()
    this.currentUnitId = null
    this.currentSession = null
    this.currentUnitType = null
  }

  /**
   * Update when session data changes.
   */
  updateSession(session: ManagedSession): void {
    if (this.currentUnitId === session.id) {
      this.currentSession = session
      // Re-render to update health-based graying
      this.updateCooldownOverlays()
    }
  }

  /**
   * Handle a hotkey press. Returns true if the key was consumed.
   */
  handleHotkey(key: string): boolean {
    if (!this.currentUnitId || !this.currentUnitType) return false

    const hotkey = key.toUpperCase() as Hotkey
    if (!HOTKEY_ORDER.includes(hotkey)) return false

    const skill = getSkillByHotkey(this.currentUnitType, hotkey)
    if (!skill) return false

    this.castSkill(skill)
    return true
  }

  isVisible(): boolean {
    return !this.el.classList.contains('hidden')
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
    }
    this.el.remove()
    this.inputModal?.remove()
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  private render(): void {
    if (!this.currentUnitType || !this.currentSession) return

    const loadout = getLoadoutForUnit(this.currentUnitType)
    const name = this.currentSession.name || this.currentSession.id.slice(0, 8)

    this.el.innerHTML = `
      <div class="ab-header">
        <span class="ab-unit-name">${escapeHtml(name)}</span>
        <span class="ab-unit-type">${escapeHtml(loadout.label.toUpperCase())}</span>
      </div>
      <div class="ab-grid">
        ${loadout.skills.map(skill => this.renderSlot(skill)).join('')}
      </div>
      <div class="ab-passive">
        <span class="ab-passive-icon">${loadout.passive.icon}</span>
        <span class="ab-passive-text">${escapeHtml(loadout.passive.name)}</span>
      </div>
    `

    // Wire click events on skill slots
    this.el.querySelectorAll('.ab-slot').forEach(slot => {
      const skillId = (slot as HTMLElement).dataset.skillId
      if (!skillId) return

      slot.addEventListener('click', (e) => {
        e.stopPropagation()
        const skill = loadout.skills.find(s => s.id === skillId)
        if (skill) this.castSkill(skill)
      })
    })

    // Initial cooldown state
    this.updateCooldownOverlays()
  }

  private renderSlot(skill: Skill): string {
    const isUltimate = skill.category === 'ultimate'
    const unitId = this.currentUnitId || ''
    const onCooldown = this.cooldownManager.isOnCooldown(unitId, skill.id)
    const remaining = this.cooldownManager.formatRemaining(unitId, skill.id)
    const fraction = this.cooldownManager.getCooldownFraction(unitId, skill.id)
    const lowHealth = this.isLowHealth()

    const classes = [
      'ab-slot',
      isUltimate ? 'ab-slot-ultimate' : '',
      onCooldown ? 'ab-slot-cooldown' : '',
      lowHealth && isUltimate ? 'ab-slot-disabled' : '',
    ].filter(Boolean).join(' ')

    return `
      <div class="${classes}" data-skill-id="${skill.id}" title="${escapeHtml(skill.description)}">
        <div class="ab-slot-inner">
          <div class="ab-slot-icon">${skill.icon}</div>
          <div class="ab-slot-name">${escapeHtml(skill.name)}</div>
          <div class="ab-slot-hotkey">${skill.hotkey}</div>
          ${onCooldown ? `
            <div class="ab-cooldown-overlay" style="--cd-fraction: ${fraction}">
              <span class="ab-cooldown-text">${remaining}</span>
            </div>
          ` : ''}
        </div>
        <div class="ab-tooltip">${escapeHtml(skill.description)}<br><kbd>${skill.hotkey}</kbd> ${skill.slashCommand}</div>
      </div>
    `
  }

  // ==========================================================================
  // Cooldown UI Updates
  // ==========================================================================

  private startCooldownRefresh(): void {
    const tick = () => {
      if (this.isVisible()) {
        this.updateCooldownOverlays()
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private updateCooldownOverlays(): void {
    if (!this.currentUnitId || !this.currentUnitType) return

    const unitId = this.currentUnitId
    const lowHealth = this.isLowHealth()

    this.el.querySelectorAll('.ab-slot').forEach(slotEl => {
      const el = slotEl as HTMLElement
      const skillId = el.dataset.skillId
      if (!skillId) return

      const onCooldown = this.cooldownManager.isOnCooldown(unitId, skillId)
      const fraction = this.cooldownManager.getCooldownFraction(unitId, skillId)
      const remaining = this.cooldownManager.formatRemaining(unitId, skillId)
      const isUltimate = el.classList.contains('ab-slot-ultimate')

      // Toggle cooldown class
      el.classList.toggle('ab-slot-cooldown', onCooldown)
      el.classList.toggle('ab-slot-disabled', lowHealth && isUltimate)

      // Update or create cooldown overlay
      let overlay = el.querySelector('.ab-cooldown-overlay') as HTMLElement | null
      if (onCooldown) {
        if (!overlay) {
          overlay = document.createElement('div')
          overlay.className = 'ab-cooldown-overlay'
          overlay.innerHTML = '<span class="ab-cooldown-text"></span>'
          el.querySelector('.ab-slot-inner')?.appendChild(overlay)
        }
        overlay.style.setProperty('--cd-fraction', String(fraction))
        const textEl = overlay.querySelector('.ab-cooldown-text')
        if (textEl) textEl.textContent = remaining
      } else if (overlay) {
        overlay.remove()
      }
    })
  }

  // ==========================================================================
  // Casting
  // ==========================================================================

  private castSkill(skill: Skill): void {
    if (!this.currentUnitId || !this.currentSession) return

    // Check cooldown
    if (this.cooldownManager.isOnCooldown(this.currentUnitId, skill.id)) {
      soundManager.play('error')
      return
    }

    // Check low health for ultimates
    if (skill.category === 'ultimate' && this.isLowHealth()) {
      soundManager.play('error')
      return
    }

    // If skill needs input, show modal
    if (skill.needsInput) {
      this.showInputModal(skill)
      return
    }

    // Fire directly
    this.executeCast(skill, skill.slashCommand)
  }

  private executeCast(skill: Skill, command: string): void {
    if (!this.currentUnitId || !this.onCast) return

    const unitId = this.currentUnitId

    // Start cooldown
    this.cooldownManager.startCooldown(unitId, skill.id, skill.cooldownMs)

    // Play sound
    soundManager.play('command_sent')

    // Visual feedback: flash the slot
    const slotEl = this.el.querySelector(`[data-skill-id="${skill.id}"]`) as HTMLElement
    if (slotEl) {
      slotEl.classList.add('ab-slot-casting')
      setTimeout(() => slotEl.classList.remove('ab-slot-casting'), 300)
    }

    // Fire the cast
    this.onCast(unitId, command).catch(() => {
      // On failure, reset cooldown
      this.cooldownManager.resetCooldown(unitId, skill.id)
    })
  }

  // ==========================================================================
  // Input Modal
  // ==========================================================================

  private showInputModal(skill: Skill): void {
    if (!this.inputModal) return

    this.inputModal.innerHTML = `
      <div class="ab-input-content">
        <div class="ab-input-header">
          <span class="ab-input-icon">${skill.icon}</span>
          <span class="ab-input-title">${escapeHtml(skill.name)}</span>
        </div>
        <input
          type="text"
          class="ab-input-field"
          placeholder="${escapeHtml(skill.inputPlaceholder || 'Enter parameter...')}"
          autofocus
        />
        <div class="ab-input-actions">
          <button class="ab-input-cancel">ESC</button>
          <button class="ab-input-cast">CAST</button>
        </div>
      </div>
    `

    this.inputModal.classList.remove('hidden')

    const input = this.inputModal.querySelector('.ab-input-field') as HTMLInputElement
    const castBtn = this.inputModal.querySelector('.ab-input-cast') as HTMLButtonElement
    const cancelBtn = this.inputModal.querySelector('.ab-input-cancel') as HTMLButtonElement

    // Focus input
    requestAnimationFrame(() => input?.focus())

    // Cast on Enter or button click
    const doCast = () => {
      const value = input?.value.trim()
      if (!value) return
      this.hideInputModal()
      const command = `${skill.slashCommand} ${value}`
      this.executeCast(skill, command)
    }

    castBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      doCast()
    })

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        doCast()
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.hideInputModal()
      }
    })

    cancelBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.hideInputModal()
    })
  }

  private hideInputModal(): void {
    if (this.inputModal) {
      this.inputModal.classList.add('hidden')
      this.inputModal.innerHTML = ''
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Check if the unit has < 10% context health remaining.
   */
  private isLowHealth(): boolean {
    const session = this.currentSession
    if (!session?.tokens) return false
    const healthPct = (1 - session.tokens.current / 200_000) * 100
    return healthPct < 10
  }
}
