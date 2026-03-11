/**
 * CombatAnimator - Visual combat-style animations for tool use events
 *
 * Each tool type gets a distinct animation. Combo system tracks rapid
 * consecutive tool calls and increases visual intensity.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { BattlefieldRenderer } from '../renderer/BattlefieldRenderer'

// Tool animation color mapping
const TOOL_COLORS: Record<string, number> = {
  'Read':       0x4488ff,  // Blue
  'Write':      0x00cccc,  // Cyan
  'Edit':       0x33ff77,  // Green
  'Bash':       0xff8800,  // Orange
  'Grep':       0xaa44ff,  // Purple
  'Glob':       0xaa44ff,  // Purple
  'WebFetch':   0xffdd00,  // Yellow
  'WebSearch':  0xffdd00,  // Yellow
  'Task':       0xffffff,  // White
}

// Combo tracking per unit
interface ComboState {
  count: number
  lastTime: number
}

const COMBO_WINDOW = 2000 // ms

// Active effects that need per-frame updates
interface ActiveEffect {
  type: string
  elapsed: number
  duration: number
  x: number
  y: number
  graphic: Graphics
  update: (effect: ActiveEffect, dt: number) => void
  cleanup: (effect: ActiveEffect) => void
}

export class CombatAnimator {
  private battlefield: BattlefieldRenderer
  private combos: Map<string, ComboState> = new Map()
  private activeEffects: ActiveEffect[] = []
  private effectsContainer: Container

  constructor(battlefield: BattlefieldRenderer) {
    this.battlefield = battlefield
    // We'll add effects to the battlefield's effects layer via particleSystem
    // For custom graphics effects, we use the unit layer's parent
    this.effectsContainer = new Container()
    // Access the world container through the unit layer's parent
    const worldContainer = battlefield.app.stage.children[0] as Container
    if (worldContainer) {
      worldContainer.addChild(this.effectsContainer)
    }
  }

  /**
   * Play the combat animation for a pre_tool_use event
   */
  playToolAnimation(sessionId: string, tool: string, x: number, y: number): void {
    const color = TOOL_COLORS[tool] || 0x00ffcc
    const combo = this.getCombo(sessionId)

    // Scale particle count by combo
    const comboMultiplier = Math.min(3, 1 + combo.count * 0.3)

    switch (tool) {
      case 'Read':
        this.shieldPulse(x, y, color, comboMultiplier)
        break
      case 'Write':
        this.rapidBurst(x, y, color, comboMultiplier)
        break
      case 'Edit':
        this.precisionFlash(x, y, color, comboMultiplier)
        break
      case 'Bash':
        this.groundImpact(x, y, color, comboMultiplier)
        break
      case 'Grep':
      case 'Glob':
        this.scanningSweep(x, y, color, comboMultiplier)
        break
      case 'WebFetch':
      case 'WebSearch':
        this.projectile(x, y, color, comboMultiplier)
        break
      case 'Task':
        this.convergence(x, y, color, comboMultiplier)
        break
      default:
        // Generic tool animation
        this.battlefield.particleSystem.burst(x, y, color, Math.round(8 * comboMultiplier))
        break
    }

    // Show combo counter if > 1
    if (combo.count > 1) {
      this.showComboText(x, y, combo.count)
    }
  }

  /**
   * Play success/failure animation for post_tool_use
   */
  playResultAnimation(x: number, y: number, success: boolean): void {
    const color = success ? 0x33ff77 : 0xff3366
    const count = success ? 5 : 8
    this.battlefield.particleSystem.sparkle(x, y, color)
    this.battlefield.particleSystem.burst(x, y, color, count)
  }

  /**
   * Play session completion effect
   */
  playCompletionEffect(x: number, y: number): void {
    this.battlefield.particleSystem.burst(x, y, 0x7b68ee, 15)
    this.battlefield.particleSystem.sparkle(x, y, 0x7b68ee)
  }

  /**
   * Play command received flash
   */
  playCommandFlash(x: number, y: number): void {
    this.battlefield.particleSystem.sparkle(x, y, 0xffd700)
    this.battlefield.particleSystem.burst(x, y, 0xffd700, 8)
  }

  /**
   * Play unit dissolve (session end)
   */
  playDissolve(x: number, y: number): void {
    this.battlefield.particleSystem.burst(x, y, 0xff3366, 20)
  }

  /**
   * Update active effects. Call from animation loop.
   */
  update(dt: number): void {
    const completed: number[] = []

    for (let i = 0; i < this.activeEffects.length; i++) {
      const effect = this.activeEffects[i]
      effect.elapsed += dt
      if (effect.elapsed >= effect.duration) {
        completed.push(i)
        effect.cleanup(effect)
      } else {
        effect.update(effect, dt)
      }
    }

    // Remove completed effects in reverse order
    for (let i = completed.length - 1; i >= 0; i--) {
      this.activeEffects.splice(completed[i], 1)
    }
  }

  // === Individual Animations ===

  /** Read: Blue shield pulse - expanding circle that fades */
  private shieldPulse(x: number, y: number, color: number, mult: number): void {
    const g = new Graphics()
    this.effectsContainer.addChild(g)

    const effect: ActiveEffect = {
      type: 'shield',
      elapsed: 0,
      duration: 0.5,
      x, y,
      graphic: g,
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        const radius = 20 + t * 40
        eff.graphic.clear()
        eff.graphic.circle(eff.x, eff.y, radius)
        eff.graphic.stroke({ width: 2 * mult, color, alpha: 1 - t })
      },
      cleanup: (eff) => {
        this.effectsContainer.removeChild(eff.graphic)
        eff.graphic.destroy()
      },
    }

    this.activeEffects.push(effect)
    this.battlefield.particleSystem.burst(x, y, color, Math.round(6 * mult))
  }

  /** Write: Cyan rapid burst upward */
  private rapidBurst(x: number, y: number, color: number, mult: number): void {
    const count = Math.round(12 * mult)
    for (let i = 0; i < count; i++) {
      const p = this.battlefield.particleSystem as any
      const particle = p.getParticle?.()
      if (!particle) {
        // Fallback to standard burst
        this.battlefield.particleSystem.burst(x, y, color, count)
        return
      }
      particle.graphic.clear()
      particle.graphic.circle(0, 0, 2 + Math.random() * 2)
      particle.graphic.fill({ color })
      particle.graphic.x = x + (Math.random() - 0.5) * 20
      particle.graphic.y = y
      particle.graphic.alpha = 1
      particle.graphic.visible = true
      particle.graphic.scale.set(1)
      particle.vx = (Math.random() - 0.5) * 40
      particle.vy = -100 - Math.random() * 100
      particle.life = 0.3 + Math.random() * 0.3
      particle.maxLife = particle.life
      particle.active = true
    }
  }

  /** Edit: Green precision flash */
  private precisionFlash(x: number, y: number, color: number, mult: number): void {
    const g = new Graphics()
    this.effectsContainer.addChild(g)

    const effect: ActiveEffect = {
      type: 'flash',
      elapsed: 0,
      duration: 0.3,
      x, y,
      graphic: g,
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        eff.graphic.clear()
        // Bright flash that quickly fades
        const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
        eff.graphic.circle(eff.x, eff.y, 15 * mult)
        eff.graphic.fill({ color, alpha: alpha * 0.6 })
      },
      cleanup: (eff) => {
        this.effectsContainer.removeChild(eff.graphic)
        eff.graphic.destroy()
      },
    }

    this.activeEffects.push(effect)
    this.battlefield.particleSystem.sparkle(x, y, color)
  }

  /** Bash: Orange ground impact - circular shockwave */
  private groundImpact(x: number, y: number, color: number, mult: number): void {
    const g = new Graphics()
    this.effectsContainer.addChild(g)

    const effect: ActiveEffect = {
      type: 'impact',
      elapsed: 0,
      duration: 0.6,
      x, y,
      graphic: g,
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        eff.graphic.clear()
        // Expanding shockwave ring
        const radius = 10 + t * 50
        eff.graphic.circle(eff.x, eff.y, radius)
        eff.graphic.stroke({ width: 3 * (1 - t), color, alpha: 1 - t })
        // Inner filled circle that shrinks
        if (t < 0.3) {
          eff.graphic.circle(eff.x, eff.y, 15 * (1 - t / 0.3))
          eff.graphic.fill({ color, alpha: 0.4 * (1 - t / 0.3) })
        }
      },
      cleanup: (eff) => {
        this.effectsContainer.removeChild(eff.graphic)
        eff.graphic.destroy()
      },
    }

    this.activeEffects.push(effect)
    this.battlefield.particleSystem.burst(x, y, color, Math.round(10 * mult))
  }

  /** Grep/Glob: Purple scanning sweep - rotating arc */
  private scanningSweep(x: number, y: number, color: number, mult: number): void {
    const g = new Graphics()
    this.effectsContainer.addChild(g)

    const effect: ActiveEffect = {
      type: 'sweep',
      elapsed: 0,
      duration: 0.6,
      x, y,
      graphic: g,
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        eff.graphic.clear()
        // Rotating arc
        const startAngle = t * Math.PI * 4  // 2 full rotations
        const arcLength = Math.PI * 0.6
        eff.graphic.arc(eff.x, eff.y, 30 * mult, startAngle, startAngle + arcLength)
        eff.graphic.stroke({ width: 2, color, alpha: 1 - t })
      },
      cleanup: (eff) => {
        this.effectsContainer.removeChild(eff.graphic)
        eff.graphic.destroy()
      },
    }

    this.activeEffects.push(effect)
    this.battlefield.particleSystem.sparkle(x, y, color)
  }

  /** WebFetch/WebSearch: Yellow projectile outward and back */
  private projectile(x: number, y: number, color: number, mult: number): void {
    const g = new Graphics()
    this.effectsContainer.addChild(g)

    // Pick a random direction
    const angle = Math.random() * Math.PI * 2
    const distance = 80

    const effect: ActiveEffect = {
      type: 'projectile',
      elapsed: 0,
      duration: 0.8,
      x, y,
      graphic: g,
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        eff.graphic.clear()
        // Out and back motion
        const travel = t < 0.5 ? t * 2 : 2 - t * 2
        const px = eff.x + Math.cos(angle) * distance * travel
        const py = eff.y + Math.sin(angle) * distance * travel
        eff.graphic.circle(px, py, 4 * mult)
        eff.graphic.fill({ color, alpha: 0.8 })
        // Trail line
        eff.graphic.moveTo(eff.x, eff.y)
        eff.graphic.lineTo(px, py)
        eff.graphic.stroke({ width: 1, color, alpha: 0.3 })
      },
      cleanup: (eff) => {
        this.effectsContainer.removeChild(eff.graphic)
        eff.graphic.destroy()
      },
    }

    this.activeEffects.push(effect)
  }

  /** Task: White convergence - particles pull inward */
  private convergence(x: number, y: number, color: number, mult: number): void {
    // Particles converge from outside to center
    const count = Math.round(10 * mult)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const dist = 50 + Math.random() * 30
      const startX = x + Math.cos(angle) * dist
      const startY = y + Math.sin(angle) * dist

      // Use trail to draw particles moving inward
      this.battlefield.particleSystem.trail(startX, startY, x, y, color)
    }

    // Central flash after a beat
    setTimeout(() => {
      this.battlefield.particleSystem.burst(x, y, color, Math.round(8 * mult))
    }, 300)
  }

  /** Show floating combo counter text */
  private showComboText(x: number, y: number, count: number): void {
    const style = new TextStyle({
      fontFamily: 'Orbitron, monospace',
      fontSize: 14 + Math.min(count, 10) * 2,
      fill: 0xffd700,
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 2 },
    })

    const text = new Text({ text: `${count}x COMBO`, style })
    text.anchor.set(0.5, 0.5)
    text.x = x
    text.y = y - 40
    text.alpha = 1
    this.effectsContainer.addChild(text)

    // Float upward and fade
    const startY = text.y
    const duration = 1.0

    const effect: ActiveEffect = {
      type: 'combo_text',
      elapsed: 0,
      duration,
      x, y,
      graphic: new Graphics(), // dummy
      update: (eff, _dt) => {
        const t = eff.elapsed / eff.duration
        text.y = startY - t * 30
        text.alpha = 1 - t
        text.scale.set(1 + t * 0.3)
      },
      cleanup: (_eff) => {
        this.effectsContainer.removeChild(text)
        text.destroy()
      },
    }

    this.activeEffects.push(effect)
  }

  // === Combo Tracking ===

  private getCombo(sessionId: string): ComboState {
    const now = Date.now()
    let combo = this.combos.get(sessionId)

    if (!combo) {
      combo = { count: 1, lastTime: now }
      this.combos.set(sessionId, combo)
      return combo
    }

    if (now - combo.lastTime < COMBO_WINDOW) {
      combo.count++
    } else {
      combo.count = 1
    }
    combo.lastTime = now
    return combo
  }
}
