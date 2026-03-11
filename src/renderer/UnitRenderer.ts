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

export type UnitStatus = 'idle' | 'working' | 'thinking' | 'offline'
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
  offline: 0xB4A690,   // cream-dim (was 0xff3366 — red was too aggressive for offline)
}

const TERRITORY_UNIT_COLORS: Record<TerritoryId, number> = {
  'lead-gen': 0x3A3020,
  'content': 0x2A3025,
  'sales': 0x3A2A1A,
  'fulfillment': 0x302A20,
  'support': 0x352520,
  'retention': 0x252530,
  'hq': 0x302A25,
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

  // Animation state
  private pulsePhase = 0
  private pulseSpeed = 1.5

  constructor(id: string, name: string, territory: TerritoryId = 'hq', unitClass: UnitClass = 'command') {
    this.id = id
    this._name = name
    this.territory = territory
    this._unitClass = unitClass
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
        // Inner highlight
        this.body.circle(0, -4, r * 0.4).fill({ color: 0xffffff, alpha: 0.08 })
        break
      }
      case 'operations': {
        // Circle (original)
        this.body.circle(0, 0, cfg.radius).fill({ color, alpha: 0.9 })
        this.body.circle(0, -4, cfg.radius * 0.5).fill({ color: 0xffffff, alpha: 0.08 })
        break
      }
      case 'recon': {
        // Diamond
        const r = cfg.radius
        this.body.poly([0, -r, r, 0, 0, r, -r, 0]).fill({ color, alpha: 0.9 })
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
    this.pulseSpeed = status === 'working' ? 4.0 : 1.5
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

  /** Adjust label scale so text stays readable regardless of zoom level */
  setZoomScale(zoom: number): void {
    // At zoom 1.0 labels are native size. At zoom 0.3 they'd be tiny.
    // Counter-scale labels so they stay ~constant screen size.
    // Clamp so they don't get absurdly large at extreme zoom-out.
    const labelScale = Math.min(2.5, 1 / Math.max(zoom, 0.2))
    this.nameplate.scale.set(labelScale)
    this.toolText.scale.set(labelScale)
    this.modelLabel.scale.set(labelScale)
    this.healthBar.scale.set(Math.min(1.8, labelScale))
  }

  update(dt: number): void {
    // Pulse animation
    this.pulsePhase += dt * this.pulseSpeed * Math.PI * 2
    if (this.pulsePhase > Math.PI * 2) this.pulsePhase -= Math.PI * 2

    // Redraw status ring with current pulse
    this.drawStatusRing()

    // Subtle hover effect on selection ring
    if (this._selected) {
      this.selectionRing.rotation += dt * 0.5
    }
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
