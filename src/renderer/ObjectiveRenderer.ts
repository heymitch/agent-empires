/**
 * ObjectiveRenderer — PixiJS v8 renderer that draws boss buildings on the battlefield.
 * Each objective = a structure sprite in its territory with HP bar and status visuals.
 * Dependency lines between objectives. Defeat animation with particle burst.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ObjectiveData {
  id: string
  campaign_id: string | null
  name: string
  description: string | null
  territory: string
  hp_total: number
  hp_remaining: number
  status: string  // unassaulted, blocked, under_attack, stalled, defeated, archived
  dependencies: string[] | null
  sub_tasks: unknown[]
  priority: number
  defeated_at: string | null
}

interface ObjectiveVisual {
  container: Container
  body: Graphics
  hpBarBg: Graphics
  hpBarFill: Graphics
  label: Text
  statusIndicator: Graphics
  data: ObjectiveData
  pulsePhase: number
  flashPhase: number
  defeatTimer: number   // >0 means playing defeat animation
  shakeOffset: { x: number; y: number }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BUILDING_WIDTH = 80
const BUILDING_HEIGHT = 60
const HP_BAR_WIDTH = 70
const HP_BAR_HEIGHT = 6
const HP_BAR_OFFSET_Y = -45
const LABEL_OFFSET_Y = -55

const STATUS_COLORS: Record<string, number> = {
  unassaulted: 0x6B7280,   // gray
  blocked: 0x4B5563,       // dark gray
  under_attack: 0xEF4444,  // red
  stalled: 0xF59E0B,       // amber
  defeated: 0x10B981,      // green
  archived: 0x374151,      // faded
}

const BUILDING_COLORS: Record<string, number> = {
  unassaulted: 0x4A4035,
  blocked: 0x2A2520,
  under_attack: 0x5A3025,
  stalled: 0x5A4A20,
  defeated: 0x1A3020,
  archived: 0x2A2A2A,
}

const DEPENDENCY_LINE_COLOR_BLOCKED = 0xEF4444
const DEPENDENCY_LINE_COLOR_UNLOCKED = 0x10B981

// Offset so multiple objectives in same territory don't overlap
const TERRITORY_OFFSETS: { x: number; y: number }[] = [
  { x: 0, y: -80 },
  { x: -100, y: -40 },
  { x: 100, y: -40 },
  { x: -60, y: 40 },
  { x: 60, y: 40 },
  { x: 0, y: 80 },
  { x: -120, y: 0 },
  { x: 120, y: 0 },
]

// ── ObjectiveRenderer ──────────────────────────────────────────────────────────

export class ObjectiveRenderer {
  private layer: Container
  private getCenterFn: (territory: string) => { x: number; y: number }

  private objectiveVisuals: Map<string, ObjectiveVisual> = new Map()
  private dependencyGraphics: Graphics
  private particleGraphics: Graphics

  // Particle burst pool for defeat animations
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: number }[] = []

  // Track per-territory index for offset placement
  private territoryCounters: Map<string, number> = new Map()

  onObjectiveDefeated: ((objective: ObjectiveData) => void) | null = null

  constructor(
    layer: Container,
    getCenterFn: (territory: string) => { x: number; y: number }
  ) {
    this.layer = layer
    this.getCenterFn = getCenterFn

    this.dependencyGraphics = new Graphics()
    this.particleGraphics = new Graphics()

    this.layer.addChild(this.dependencyGraphics)
    this.layer.addChild(this.particleGraphics)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  updateObjectives(objectives: ObjectiveData[]): void {
    const incomingIds = new Set(objectives.map(o => o.id))

    // Remove visuals for objectives no longer present
    for (const [id, visual] of this.objectiveVisuals) {
      if (!incomingIds.has(id)) {
        this.layer.removeChild(visual.container)
        visual.container.destroy({ children: true })
        this.objectiveVisuals.delete(id)
      }
    }

    // Reset territory counters for placement
    this.territoryCounters.clear()

    // Create or update visuals
    for (const obj of objectives) {
      const idx = this.getTerritoryIndex(obj.territory)
      let visual = this.objectiveVisuals.get(obj.id)

      if (!visual) {
        visual = this.createVisual(obj, idx)
        this.objectiveVisuals.set(obj.id, visual)
        this.layer.addChild(visual.container)
      } else {
        // Check for defeat transition
        if (visual.data.status !== 'defeated' && obj.status === 'defeated') {
          this.triggerDefeatAnimation(visual)
          this.onObjectiveDefeated?.(obj)
        }
        visual.data = obj
      }

      this.updateVisual(visual, idx)
    }

    // Redraw dependency lines
    this.drawDependencyLines(objectives)
  }

  update(dt: number): void {
    // Animate pulses, flashes, defeat animations
    for (const visual of this.objectiveVisuals.values()) {
      const { data } = visual

      // Pulse animation for under_attack
      if (data.status === 'under_attack') {
        visual.pulsePhase += dt * 3
        const scale = 1 + Math.sin(visual.pulsePhase) * 0.03
        visual.body.scale.set(scale, scale)

        // Subtle red glow pulse
        const alpha = 0.3 + Math.sin(visual.pulsePhase) * 0.15
        visual.statusIndicator.clear()
        visual.statusIndicator.circle(0, 0, BUILDING_WIDTH * 0.6)
          .fill({ color: 0xEF4444, alpha })
      }

      // Flash animation for stalled
      if (data.status === 'stalled') {
        visual.flashPhase += dt * 5
        const flashOn = Math.sin(visual.flashPhase) > 0
        visual.statusIndicator.clear()
        if (flashOn) {
          visual.statusIndicator.circle(0, -30, 6)
            .fill({ color: 0xF59E0B, alpha: 0.9 })
        }
      }

      // Defeat crumble animation
      if (visual.defeatTimer > 0) {
        visual.defeatTimer -= dt
        // Shake
        visual.shakeOffset.x = (Math.random() - 0.5) * 4 * visual.defeatTimer
        visual.shakeOffset.y = (Math.random() - 0.5) * 4 * visual.defeatTimer
        visual.body.position.set(visual.shakeOffset.x, visual.shakeOffset.y)

        // Fade to rubble
        if (visual.defeatTimer <= 0) {
          visual.body.alpha = 0.4
          visual.body.position.set(0, 0)
        }
      }

      // Update HP bar
      this.drawHPBar(visual)
    }

    // Update particles
    this.updateParticles(dt)
  }

  // ── Visual Creation ───────────────────────────────────────────────────────

  private createVisual(obj: ObjectiveData, territoryIdx: number): ObjectiveVisual {
    const container = new Container()
    const body = new Graphics()
    const hpBarBg = new Graphics()
    const hpBarFill = new Graphics()
    const statusIndicator = new Graphics()

    const labelStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 11,
      fill: 0xB4A690,
      align: 'center',
    })
    const label = new Text({ text: obj.name.slice(0, 20), style: labelStyle })
    label.anchor.set(0.5, 1)
    label.position.set(0, LABEL_OFFSET_Y)

    // Status indicator behind body
    container.addChild(statusIndicator)
    container.addChild(body)
    container.addChild(hpBarBg)
    container.addChild(hpBarFill)
    container.addChild(label)

    return {
      container,
      body,
      hpBarBg,
      hpBarFill,
      label,
      statusIndicator,
      data: obj,
      pulsePhase: 0,
      flashPhase: 0,
      defeatTimer: 0,
      shakeOffset: { x: 0, y: 0 },
    }
  }

  private updateVisual(visual: ObjectiveVisual, territoryIdx: number): void {
    const { data, container, body, label } = visual
    const center = this.getCenterFn(data.territory)
    if (!center) return

    const offset = TERRITORY_OFFSETS[territoryIdx % TERRITORY_OFFSETS.length] || { x: 0, y: 0 }
    container.position.set(center.x + offset.x, center.y + offset.y)

    // Draw building body based on status
    const buildingColor = BUILDING_COLORS[data.status] ?? 0x4A4035
    const borderColor = STATUS_COLORS[data.status] ?? 0x6B7280

    body.clear()

    if (data.status === 'defeated') {
      // Rubble — irregular shapes
      body.rect(-BUILDING_WIDTH / 2, -BUILDING_HEIGHT / 4, BUILDING_WIDTH, BUILDING_HEIGHT / 2)
        .fill({ color: 0x2A2520, alpha: 0.5 })
      // Victory flag
      body.moveTo(0, -BUILDING_HEIGHT / 2)
      body.lineTo(0, -BUILDING_HEIGHT)
      body.stroke({ color: 0x10B981, width: 2, alpha: 0.8 })
      body.rect(2, -BUILDING_HEIGHT, 12, 8)
        .fill({ color: 0x10B981, alpha: 0.7 })
    } else {
      // Building structure
      const hw = BUILDING_WIDTH / 2
      const hh = BUILDING_HEIGHT / 2

      // Main body
      body.rect(-hw, -hh, BUILDING_WIDTH, BUILDING_HEIGHT)
        .fill({ color: buildingColor, alpha: 0.85 })

      // Border
      body.rect(-hw, -hh, BUILDING_WIDTH, BUILDING_HEIGHT)
        .stroke({ color: borderColor, width: 2, alpha: 0.7 })

      // Roof triangle
      body.moveTo(-hw - 5, -hh)
      body.lineTo(0, -hh - 15)
      body.lineTo(hw + 5, -hh)
      body.closePath()
      body.fill({ color: buildingColor, alpha: 0.9 })
      body.stroke({ color: borderColor, width: 1.5, alpha: 0.6 })

      // HP-based damage cracks
      const hpPct = data.hp_total > 0 ? data.hp_remaining / data.hp_total : 1
      if (hpPct <= 0.75 && hpPct > 0.5) {
        // Minor damage — small cracks
        body.moveTo(-hw + 10, -hh + 10)
        body.lineTo(-hw + 20, hh - 15)
        body.stroke({ color: 0x1A1510, width: 1, alpha: 0.6 })
      } else if (hpPct <= 0.5 && hpPct > 0.25) {
        // Visible cracks + smoke wisps implied by darker color
        body.moveTo(-hw + 10, -hh + 10)
        body.lineTo(-hw + 25, hh - 10)
        body.stroke({ color: 0x1A1510, width: 1.5, alpha: 0.7 })
        body.moveTo(hw - 15, -hh + 5)
        body.lineTo(hw - 25, hh - 20)
        body.stroke({ color: 0x1A1510, width: 1, alpha: 0.5 })
      } else if (hpPct <= 0.25 && hpPct > 0) {
        // Heavy damage — multiple cracks, body alpha reduced
        body.alpha = 0.7
        body.moveTo(-hw + 5, -hh + 5)
        body.lineTo(0, hh)
        body.stroke({ color: 0x0A0A08, width: 2, alpha: 0.8 })
        body.moveTo(hw - 5, -hh + 5)
        body.lineTo(0, hh - 5)
        body.stroke({ color: 0x0A0A08, width: 1.5, alpha: 0.7 })
      }

      // Blocked overlay: gray out
      if (data.status === 'blocked') {
        body.rect(-hw, -hh, BUILDING_WIDTH, BUILDING_HEIGHT)
          .fill({ color: 0x000000, alpha: 0.4 })
      }
    }

    // Update label
    label.text = data.name.length > 18 ? data.name.slice(0, 17) + '...' : data.name

    // Draw HP bar
    this.drawHPBar(visual)
  }

  private drawHPBar(visual: ObjectiveVisual): void {
    const { data, hpBarBg, hpBarFill } = visual

    if (data.status === 'defeated' || data.status === 'archived') {
      hpBarBg.clear()
      hpBarFill.clear()
      return
    }

    const hpPct = data.hp_total > 0 ? data.hp_remaining / data.hp_total : 1

    // Background
    hpBarBg.clear()
    hpBarBg.rect(-HP_BAR_WIDTH / 2, HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT)
      .fill({ color: 0x1A1510, alpha: 0.8 })
    hpBarBg.rect(-HP_BAR_WIDTH / 2, HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT)
      .stroke({ color: 0x3A3530, width: 1, alpha: 0.6 })

    // Fill — color transitions green -> yellow -> red
    let fillColor: number
    if (hpPct > 0.5) {
      fillColor = 0x10B981 // green
    } else if (hpPct > 0.25) {
      fillColor = 0xF59E0B // yellow
    } else {
      fillColor = 0xEF4444 // red
    }

    hpBarFill.clear()
    const fillWidth = HP_BAR_WIDTH * hpPct
    if (fillWidth > 0) {
      hpBarFill.rect(-HP_BAR_WIDTH / 2, HP_BAR_OFFSET_Y, fillWidth, HP_BAR_HEIGHT)
        .fill({ color: fillColor, alpha: 0.9 })
    }
  }

  // ── Dependency Lines ──────────────────────────────────────────────────────

  private drawDependencyLines(objectives: ObjectiveData[]): void {
    const g = this.dependencyGraphics
    g.clear()

    const objMap = new Map(objectives.map(o => [o.id, o]))

    for (const obj of objectives) {
      if (!obj.dependencies || obj.dependencies.length === 0) continue

      const toCenter = this.getObjectivePosition(obj)
      if (!toCenter) continue

      for (const depId of obj.dependencies) {
        const dep = objMap.get(depId)
        if (!dep) continue

        const fromCenter = this.getObjectivePosition(dep)
        if (!fromCenter) continue

        const isBlocked = dep.status !== 'defeated'
        const color = isBlocked ? DEPENDENCY_LINE_COLOR_BLOCKED : DEPENDENCY_LINE_COLOR_UNLOCKED
        const alpha = isBlocked ? 0.4 : 0.6

        // Dotted line
        const dx = toCenter.x - fromCenter.x
        const dy = toCenter.y - fromCenter.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const segments = Math.max(1, Math.floor(dist / 12))

        for (let i = 0; i < segments; i++) {
          if (i % 2 === 1) continue // skip every other for dotted effect
          const t0 = i / segments
          const t1 = Math.min(1, (i + 0.6) / segments)

          const x0 = fromCenter.x + dx * t0
          const y0 = fromCenter.y + dy * t0
          const x1 = fromCenter.x + dx * t1
          const y1 = fromCenter.y + dy * t1

          g.moveTo(x0, y0)
          g.lineTo(x1, y1)
          g.stroke({ color, width: isBlocked ? 1.5 : 2, alpha })
        }

        // Arrow at destination end
        if (!isBlocked) {
          const angle = Math.atan2(dy, dx)
          const arrowSize = 8
          const ax = toCenter.x - dx / dist * 30
          const ay = toCenter.y - dy / dist * 30

          g.moveTo(ax, ay)
          g.lineTo(ax - arrowSize * Math.cos(angle - 0.4), ay - arrowSize * Math.sin(angle - 0.4))
          g.moveTo(ax, ay)
          g.lineTo(ax - arrowSize * Math.cos(angle + 0.4), ay - arrowSize * Math.sin(angle + 0.4))
          g.stroke({ color: DEPENDENCY_LINE_COLOR_UNLOCKED, width: 2, alpha: 0.7 })
        }
      }
    }
  }

  private getObjectivePosition(obj: ObjectiveData): { x: number; y: number } | null {
    const center = this.getCenterFn(obj.territory)
    if (!center) return null

    // Find index among objectives in same territory
    let idx = 0
    for (const visual of this.objectiveVisuals.values()) {
      if (visual.data.territory === obj.territory && visual.data.id !== obj.id) {
        if (visual.data.id < obj.id) idx++
      }
    }

    const offset = TERRITORY_OFFSETS[idx % TERRITORY_OFFSETS.length] || { x: 0, y: 0 }
    return { x: center.x + offset.x, y: center.y + offset.y }
  }

  // ── Defeat Animation ──────────────────────────────────────────────────────

  private triggerDefeatAnimation(visual: ObjectiveVisual): void {
    visual.defeatTimer = 1.0  // 1 second shake

    // Spawn particles at building position
    const pos = visual.container.position
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 80
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * BUILDING_WIDTH,
        y: pos.y + (Math.random() - 0.5) * BUILDING_HEIGHT,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,  // bias upward
        life: 0.8 + Math.random() * 0.6,
        color: [0xE8682A, 0xFFB86C, 0xB4A690, 0x10B981][Math.floor(Math.random() * 4)],
      })
    }
  }

  private updateParticles(dt: number): void {
    const g = this.particleGraphics
    g.clear()

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 60 * dt  // gravity
      p.life -= dt

      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }

      const alpha = Math.min(1, p.life * 2)
      const size = 2 + p.life * 2
      g.circle(p.x, p.y, size).fill({ color: p.color, alpha })
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getTerritoryIndex(territory: string): number {
    const count = this.territoryCounters.get(territory) ?? 0
    this.territoryCounters.set(territory, count + 1)
    return count
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    for (const visual of this.objectiveVisuals.values()) {
      visual.container.destroy({ children: true })
    }
    this.objectiveVisuals.clear()
    this.dependencyGraphics.destroy()
    this.particleGraphics.destroy()
  }
}
