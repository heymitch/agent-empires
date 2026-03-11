/**
 * UnitRenderer - Renders a single agent unit on the battlefield
 *
 * Visual composition:
 * - Body circle filled with territory color
 * - Status ring (animated pulse based on state)
 * - Nameplate text above
 * - Health bar below
 * - Selection ring when selected
 */

import { Container, Graphics, Text, TextStyle, Circle } from 'pixi.js'
import type { TerritoryId } from './TerrainRenderer'
import type { ZoomVisibility } from './ZoomController'

export type UnitStatus = 'idle' | 'working' | 'thinking' | 'combat' | 'exhausted' | 'offline'
export type UnitClass = 'command' | 'operations' | 'recon'

const CLASS_CONFIG: Record<UnitClass, { radius: number; accent: number; ringWidth: number; healthBarWidth: number }> = {
  command:    { radius: 44, accent: 0xFFB86C, ringWidth: 4, healthBarWidth: 64 },    // amber
  operations: { radius: 36, accent: 0xE8682A, ringWidth: 3, healthBarWidth: 52 },   // warm orange
  recon:      { radius: 26, accent: 0x82C896, ringWidth: 2.5, healthBarWidth: 40 }, // phosphor
}

const STATUS_COLORS: Record<UnitStatus, number> = {
  idle: 0x82C896,      // phosphor green (was 0x33ff77)
  working: 0xE8682A,   // warm orange (was 0x00ffcc)
  thinking: 0x4A9DB8,  // teal (was 0x7b68ee)
  combat: 0xCC3333,    // military red — actively fighting an objective
  exhausted: 0x8B7355, // faded tan — working too long without rest
  offline: 0xB4A690,   // cream-dim (was 0xff3366 — red was too aggressive for offline)
}

const TERRITORY_UNIT_COLORS: Record<TerritoryId, number> = {
  'lead-gen': 0x5A4A30,
  'content': 0x3A5035,
  'sales': 0x5A4A2A,
  'fulfillment': 0x504A3A,
  'support': 0x554540,
  'retention': 0x454560,
  'hq': 0x504A45,
}

export class UnitRenderer {
  container: Container
  id: string
  territory: TerritoryId
  worldX = 0
  worldY = 0
  parentSessionId?: string

  private body: Graphics
  private statusRing: Graphics
  private selectionRing: Graphics
  private nameplate: Text
  private healthBar: Graphics
  private toolText: Text

  private _status: UnitStatus = 'idle'
  private _health = 1.0
  private _selected = false
  private _name: string
  private _currentTool: string = ''
  private _unitClass: UnitClass = 'command'
  private modelLabel: Text
  private createdAt: number

  // Combo display
  private comboText: Text | null = null
  private comboElapsed = 0
  private comboDuration = 1.5
  private comboStartY = 0

  // Animation state
  private pulsePhase = 0
  private pulseSpeed = 1.5
  private _retiring = false
  private _retireElapsed = 0
  private _retireDuration = 0.5 // 500ms shrink-to-zero
  private _collapsing = false
  private _collapseElapsed = 0
  private _collapseDuration = 1.5 // 1500ms context exhaustion animation

  constructor(id: string, name: string, territory: TerritoryId = 'hq', unitClass: UnitClass = 'command') {
    this.id = id
    this._name = name
    this.territory = territory
    this._unitClass = unitClass
    this.createdAt = Date.now()
    this.container = new Container()
    this.container.eventMode = 'static'
    this.container.cursor = 'pointer'
    const _initCfg = CLASS_CONFIG[this._unitClass]
    this.container.hitArea = new Circle(0, 0, _initCfg.radius + 20)

    // Selection ring (behind everything)
    this.selectionRing = new Graphics()
    this.selectionRing.visible = false
    this.container.addChild(this.selectionRing)

    // Status ring
    this.statusRing = new Graphics()
    this.container.addChild(this.statusRing)

    // Body
    this.body = new Graphics()
    this.drawBody()
    this.container.addChild(this.body)

    // Nameplate
    const nameStyle = new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 18,
      fill: 0xF0E4D0,
      align: 'center',
    })
    this.nameplate = new Text({ text: name, style: nameStyle })
    this.nameplate.anchor.set(0.5, 1)
    this.nameplate.y = -(_initCfg.radius + 14)
    this.container.addChild(this.nameplate)

    // Tool text (below nameplate)
    const toolStyle = new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      fill: 0xB4A690,
      align: 'center',
    })
    this.toolText = new Text({ text: '', style: toolStyle })
    this.toolText.anchor.set(0.5, 1)
    this.toolText.y = -(_initCfg.radius + 34)
    this.container.addChild(this.toolText)

    // Health bar
    this.healthBar = new Graphics()
    this.healthBar.y = _initCfg.radius + 10
    this.container.addChild(this.healthBar)

    // Model label (below health bar)
    const labelStyle = new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      fill: _initCfg.accent,
      align: 'center',
    })
    const _labelMap: Record<UnitClass, string> = { command: 'OPUS', operations: 'SONNET', recon: 'HAIKU' }
    this.modelLabel = new Text({ text: _labelMap[this._unitClass], style: labelStyle })
    this.modelLabel.anchor.set(0.5, 0)
    this.modelLabel.alpha = 0.6
    this.modelLabel.y = this.healthBar.y + 12
    this.container.addChild(this.modelLabel)

    // Initial draws
    this.drawStatusRing()
    this.drawHealthBar()
    this.drawSelectionRing()
  }

  private drawBody(): void {
    this.body.clear()
    const color = TERRITORY_UNIT_COLORS[this.territory] || 0x5a5a5a
    const cfg = CLASS_CONFIG[this._unitClass]

    switch (this._unitClass) {
      case 'command': {
        // Hexagon
        const r = cfg.radius
        const pts: number[] = []
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6
          pts.push(Math.cos(angle) * r, Math.sin(angle) * r)
        }
        this.body.poly(pts).fill({ color, alpha: 0.9 })
        this.body.poly(pts).stroke({ color: cfg.accent, width: 2, alpha: 0.5 })
        // Inner highlight
        this.body.circle(0, -4, r * 0.4).fill({ color: 0xffffff, alpha: 0.08 })
        break
      }
      case 'operations': {
        // Circle
        this.body.circle(0, 0, cfg.radius).fill({ color, alpha: 0.9 })
        this.body.circle(0, 0, cfg.radius).stroke({ color: cfg.accent, width: 2, alpha: 0.5 })
        this.body.circle(0, -4, cfg.radius * 0.5).fill({ color: 0xffffff, alpha: 0.08 })
        break
      }
      case 'recon': {
        // Diamond
        const r = cfg.radius
        this.body.poly([0, -r, r, 0, 0, r, -r, 0]).fill({ color, alpha: 0.9 })
        this.body.poly([0, -r, r, 0, 0, r, -r, 0]).stroke({ color: cfg.accent, width: 2, alpha: 0.5 })
        this.body.circle(0, -2, r * 0.35).fill({ color: 0xffffff, alpha: 0.08 })
        break
      }
    }
  }

  private drawStatusRing(): void {
    this.statusRing.clear()
    const statusColor = STATUS_COLORS[this._status]
    const cfg = CLASS_CONFIG[this._unitClass]
    const alpha = 0.6 + Math.sin(this.pulsePhase) * 0.3
    this.statusRing.circle(0, 0, cfg.radius + 6).stroke({ width: cfg.ringWidth, color: statusColor, alpha })

    // Class accent — subtle outer ring
    this.statusRing.circle(0, 0, cfg.radius + 12).stroke({ width: 1.5, color: cfg.accent, alpha: 0.25 })
  }

  private drawSelectionRing(): void {
    this.selectionRing.clear()
    if (!this._selected) return
    const cfg = CLASS_CONFIG[this._unitClass]
    const radius = cfg.radius + 16
    const segments = 12
    for (let i = 0; i < segments; i += 2) {
      const startAngle = (i / segments) * Math.PI * 2
      const endAngle = ((i + 1) / segments) * Math.PI * 2
      this.selectionRing.arc(0, 0, radius, startAngle, endAngle)
      this.selectionRing.stroke({ width: 2, color: cfg.accent, alpha: 0.8 })
    }
  }

  private drawHealthBar(): void {
    this.healthBar.clear()
    const width = CLASS_CONFIG[this._unitClass].healthBarWidth
    const height = 5

    // Background
    this.healthBar.rect(-width / 2, 0, width, height)
    this.healthBar.fill({ color: 0x16120E, alpha: 0.8 })

    // Fill
    const fillWidth = width * this._health
    let color = 0x82C896    // phosphor green (was 0x33ff77)
    if (this._health < 0.5) color = 0xFFB86C   // amber (was 0xffaa00)
    if (this._health < 0.25) color = 0xE8682A   // orange-red (was 0xff3366)

    if (fillWidth > 0) {
      this.healthBar.rect(-width / 2, 0, fillWidth, height)
      this.healthBar.fill({ color, alpha: 0.9 })
    }
  }

  // === Public API ===

  setPosition(x: number, y: number): void {
    this.worldX = x
    this.worldY = y
    this.container.x = x
    this.container.y = y
  }

  setStatus(status: UnitStatus): void {
    this._status = status
    // Pulse speed per status: combat is rapid, exhausted is slow/tired, offline is static
    const pulseSpeedMap: Record<UnitStatus, number> = {
      idle: 1.5,
      working: 4.0,
      thinking: 2.5,
      combat: 6.0,
      exhausted: 0.8,
      offline: 0,
    }
    this.pulseSpeed = pulseSpeedMap[status]
  }

  setHealth(value: number): void {
    this._health = Math.max(0, Math.min(1, value))
    this.drawHealthBar()
  }

  setSelected(selected: boolean): void {
    this._selected = selected
    this.selectionRing.visible = selected
    this.drawSelectionRing()
  }

  setName(text: string): void {
    this._name = text
    this.nameplate.text = text
  }

  setCurrentTool(tool: string): void {
    this._currentTool = tool
    this.toolText.text = tool ? `[${tool}]` : ''
  }

  /**
   * Show a floating combo label above the unit that fades up and out over 1.5s.
   * e.g. "COMBO x3", "STREAK x6", "RAMPAGE x10!"
   */
  showCombo(label: string, color: number): void {
    // Remove previous combo text if still animating
    if (this.comboText) {
      this.container.removeChild(this.comboText)
      this.comboText.destroy()
      this.comboText = null
    }

    const cfg = CLASS_CONFIG[this._unitClass]
    const style = new TextStyle({
      fontFamily: 'Orbitron, JetBrains Mono, monospace',
      fontSize: 16,
      fill: color,
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
      dropShadow: {
        color: color,
        blur: 6,
        alpha: 0.4,
        distance: 0,
      },
    })

    this.comboText = new Text({ text: label, style })
    this.comboText.anchor.set(0.5, 1)
    this.comboStartY = -(cfg.radius + 50)
    this.comboText.y = this.comboStartY
    this.comboText.alpha = 1
    this.comboText.scale.set(1.2) // Pop in slightly larger
    this.comboElapsed = 0
    this.comboDuration = 1.5
    this.container.addChild(this.comboText)
  }

  get status(): UnitStatus {
    return this._status
  }

  get name(): string {
    return this._name
  }

  get unitClass(): UnitClass {
    return this._unitClass
  }

  setUnitClass(cls: UnitClass): void {
    this._unitClass = cls
    const cfg = CLASS_CONFIG[cls]
    this.container.hitArea = new Circle(0, 0, cfg.radius + 4)

    // Reposition dependent elements
    this.nameplate.y = -(cfg.radius + 10)
    this.toolText.y = -(cfg.radius + 22)
    this.healthBar.y = cfg.radius + 6
    this.modelLabel.y = this.healthBar.y + 8

    // Update model label text and color
    const labelMap: Record<UnitClass, string> = { command: 'OPUS', operations: 'SONNET', recon: 'HAIKU' }
    this.modelLabel.text = labelMap[cls]
    ;(this.modelLabel.style as TextStyle).fill = cfg.accent

    this.drawBody()
    this.drawStatusRing()
    this.drawHealthBar()
    this.drawSelectionRing()
  }

  /** Adjust label scale and toggle chrome visibility based on zoom tier */
  setZoomScale(zoom: number, visibility?: ZoomVisibility): void {
    // Counter-scale labels so they stay ~constant screen size.
    // Clamp so they don't get absurdly large at extreme zoom-out.
    const labelScale = Math.min(2.5, 1 / Math.max(zoom, 0.2))
    this.nameplate.scale.set(labelScale)
    this.toolText.scale.set(labelScale)
    this.modelLabel.scale.set(labelScale)
    this.healthBar.scale.set(Math.min(1.8, labelScale))

    // Apply semantic zoom visibility when provided
    if (visibility) {
      this.healthBar.visible = visibility.showHealthBars
      this.toolText.visible = visibility.showToolText
      this.modelLabel.visible = visibility.showModelLabels

      // At strategic zoom: hide all chrome, show only body + nameplate
      if (!visibility.showUnitDetails) {
        this.nameplate.visible = true
        this.statusRing.visible = false
        this.selectionRing.visible = false
        this.healthBar.visible = false
        this.toolText.visible = false
        this.modelLabel.visible = false
      } else {
        this.nameplate.visible = true
        this.statusRing.visible = true
        this.selectionRing.visible = this._selected
      }
    }
  }

  update(dt: number): void {
    // Shrink-to-zero retirement animation
    if (this._retiring) {
      this._retireElapsed += dt
      const t = Math.min(1, this._retireElapsed / this._retireDuration)
      // Ease-in: accelerates into the shrink
      const scale = 1 - t * t
      this.container.scale.set(scale)
      this.container.alpha = scale
      return // skip all other animations during retirement
    }

    // Context exhaustion collapse animation (3-phase, 1.5s)
    if (this._collapsing) {
      this._collapseElapsed += dt
      const elapsed = this._collapseElapsed
      const cfg = CLASS_CONFIG[this._unitClass]

      if (elapsed < 0.5) {
        // Phase 1 (0-0.5s): Rapid flicker
        const flickerCycle = Math.floor(elapsed / 0.05) % 2
        this.container.alpha = flickerCycle === 0 ? 0.3 : 1.0
      } else if (elapsed < 1.0) {
        // Phase 2 (0.5-1.0s): Turn red-orange, ring expands outward
        this.container.alpha = 1.0
        const phase2T = (elapsed - 0.5) / 0.5
        // Tint body red-orange by redrawing status ring with collapse color
        this.statusRing.clear()
        const expandRadius = cfg.radius + 6 + phase2T * 20
        this.statusRing.circle(0, 0, expandRadius).stroke({
          width: cfg.ringWidth + phase2T * 3,
          color: 0xE8682A,
          alpha: 1.0 - phase2T * 0.3,
        })
        // Red-orange overlay on body
        this.body.alpha = 1.0 - phase2T * 0.2
        this.body.tint = this._lerpColor(0xFFFFFF, 0xE8682A, phase2T)
      } else {
        // Phase 3 (1.0-1.5s): Shrink inward and fade to zero (burst-style)
        const phase3T = Math.min(1, (elapsed - 1.0) / 0.5)
        const eased = phase3T * phase3T // ease-in
        const scale = 1 - eased
        this.container.scale.set(scale)
        this.container.alpha = scale * 0.8
      }
      return // skip all other animations during collapse
    }

    // Combo text float-up animation
    if (this.comboText) {
      this.comboElapsed += dt
      const t = Math.min(1, this.comboElapsed / this.comboDuration)
      // Float upward 40px over the duration
      this.comboText.y = this.comboStartY - t * 40
      // Ease-out fade: holds for first 40%, then fades
      this.comboText.alpha = t < 0.4 ? 1 : 1 - ((t - 0.4) / 0.6)
      // Scale: pops in at 1.2, settles to 1.0 quickly, then shrinks slightly
      const scaleT = t < 0.1 ? 1.2 - (t / 0.1) * 0.2 : 1.0 - (t - 0.1) * 0.1
      this.comboText.scale.set(Math.max(0.8, scaleT))

      if (t >= 1) {
        this.container.removeChild(this.comboText)
        this.comboText.destroy()
        this.comboText = null
      }
    }

    // Pulse animation
    this.pulsePhase += dt * this.pulseSpeed * Math.PI * 2
    if (this.pulsePhase > Math.PI * 2) this.pulsePhase -= Math.PI * 2

    // Redraw status ring with current pulse
    this.drawStatusRing()

    // Subtle hover effect on selection ring
    if (this._selected) {
      this.selectionRing.rotation += dt * 0.5
    }

    // Lifetime fade: sub-agents fade 1.0 → 0.7 over 120 seconds
    if (this._status === 'offline') {
      this.container.alpha = 0.3
    } else if (this.parentSessionId) {
      const ageSec = (Date.now() - this.createdAt) / 1000
      this.container.alpha = Math.max(0.7, 1.0 - (ageSec / 120) * 0.3)
    } else {
      this.container.alpha = 1.0
    }
  }

  /** Start shrink-to-zero retirement animation. Returns true when complete. */
  retire(): void {
    this._retiring = true
    this._retireElapsed = 0
  }

  get isRetiring(): boolean {
    return this._retiring
  }

  get retireComplete(): boolean {
    return this._retiring && this._retireElapsed >= this._retireDuration
  }

  /** Start context exhaustion collapse animation (3-phase, 1.5s). */
  collapse(): void {
    this._collapsing = true
    this._collapseElapsed = 0
  }

  get isCollapsing(): boolean {
    return this._collapsing
  }

  get collapseComplete(): boolean {
    return this._collapsing && this._collapseElapsed >= this._collapseDuration
  }

  /** Linearly interpolate between two hex colors. */
  private _lerpColor(from: number, to: number, t: number): number {
    const r1 = (from >> 16) & 0xFF, g1 = (from >> 8) & 0xFF, b1 = from & 0xFF
    const r2 = (to >> 16) & 0xFF, g2 = (to >> 8) & 0xFF, b2 = to & 0xFF
    const r = Math.round(r1 + (r2 - r1) * t)
    const g = Math.round(g1 + (g2 - g1) * t)
    const b = Math.round(b1 + (b2 - b1) * t)
    return (r << 16) | (g << 8) | b
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
