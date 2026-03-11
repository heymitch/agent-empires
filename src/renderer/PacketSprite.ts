/**
 * PacketSprite
 * Animated packets that travel along road bezier curves between territories.
 * Visual representations of data/work flowing through the empire.
 */

import { Container, Graphics } from 'pixi.js'
import type { RoadData } from './RoadRenderer'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PacketConfig {
  id: string
  fromTerritory: string
  toTerritory: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  label?: string  // e.g. "ticket", "deploy", "handoff"
  createdAt: number
}

interface RoadCurve {
  from: string
  to: string
  fx: number
  fy: number
  tx: number
  ty: number
  cx: number
  cy: number
  curveLength: number
}

// ─── Priority Visual Config ─────────────────────────────────────────────────────

interface PriorityStyle {
  radius: number
  color: number
  alpha: number
  speed: number        // pixels per second
  hasGlow: boolean
  hasPulse: boolean
  glowRadius?: number
  glowAlpha?: number
}

const PRIORITY_STYLES: Record<string, PriorityStyle> = {
  low: {
    radius: 3,
    color: 0xB4A690,
    alpha: 0.5,
    speed: 60,
    hasGlow: false,
    hasPulse: false,
  },
  normal: {
    radius: 4,
    color: 0xFFB86C,
    alpha: 0.7,
    speed: 80,
    hasGlow: false,
    hasPulse: false,
  },
  high: {
    radius: 5,
    color: 0xE8682A,
    alpha: 0.85,
    speed: 120,
    hasGlow: true,
    hasPulse: false,
    glowRadius: 9,
    glowAlpha: 0.2,
  },
  critical: {
    radius: 6,
    color: 0xFF3366,
    alpha: 1.0,
    speed: 160,
    hasGlow: true,
    hasPulse: true,
    glowRadius: 12,
    glowAlpha: 0.35,
  },
}

// Flash duration when packet arrives (seconds)
const ARRIVAL_FLASH_DURATION = 0.3

// Bezier control point offset (must match RoadRenderer)
const BEZIER_OFFSET = 150

// ─── Active Packet State ────────────────────────────────────────────────────────

interface ActivePacket {
  config: PacketConfig
  road: RoadCurve
  t: number             // 0→1 progress along curve
  speed: number         // t-units per second
  style: PriorityStyle
  arrived: boolean
  flashTimer: number    // countdown after arrival
}

// ─── PacketManager ──────────────────────────────────────────────────────────────

export class PacketManager {
  private layer: Container
  private getCenterFn: (territory: string) => { x: number; y: number }
  private graphics: Graphics
  private packets: ActivePacket[] = []
  private roads: RoadCurve[] = []
  private elapsed = 0

  constructor(
    layer: Container,
    getCenterFn: (territory: string) => { x: number; y: number }
  ) {
    this.layer = layer
    this.getCenterFn = getCenterFn
    this.graphics = new Graphics()
    this.layer.addChild(this.graphics)
  }

  // ── Road Data ───────────────────────────────────────────────────────────────

  /** Update road geometry when roads change. Recomputes bezier curves. */
  updateRoads(roads: RoadData[]): void {
    this.roads = []

    for (const r of roads) {
      if (r.roadLevel <= 0) continue

      const fromCenter = this.getCenterFn(r.fromTerritory)
      const toCenter = this.getCenterFn(r.toTerritory)
      if (!fromCenter || !toCenter) continue

      const mx = (fromCenter.x + toCenter.x) / 2
      const my = (fromCenter.y + toCenter.y) / 2
      const dx = toCenter.x - fromCenter.x
      const dy = toCenter.y - fromCenter.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 1) continue

      const px = -dy / len
      const py = dx / len
      const cx = mx + px * BEZIER_OFFSET
      const cy = my + py * BEZIER_OFFSET

      const curveLength = this.approxBezierLength(
        fromCenter.x, fromCenter.y, cx, cy, toCenter.x, toCenter.y, 30
      )

      this.roads.push({
        from: r.fromTerritory,
        to: r.toTerritory,
        fx: fromCenter.x,
        fy: fromCenter.y,
        tx: toCenter.x,
        ty: toCenter.y,
        cx,
        cy,
        curveLength,
      })
    }
  }

  // ── Spawn & Query ─────────────────────────────────────────────────────────

  /** Spawn a new packet on the matching road. */
  spawnPacket(config: PacketConfig): void {
    const road = this.findRoad(config.fromTerritory, config.toTerritory)
    if (!road) {
      console.warn(`[PacketManager] No road found: ${config.fromTerritory} → ${config.toTerritory}`)
      return
    }

    const style = PRIORITY_STYLES[config.priority] ?? PRIORITY_STYLES.normal
    const speed = style.speed / road.curveLength  // convert px/s to t-units/s

    this.packets.push({
      config,
      road,
      t: 0,
      speed,
      style,
      arrived: false,
      flashTimer: 0,
    })
  }

  /** Count packets heading toward a territory. */
  getQueueDepth(territory: string): number {
    return this.packets.filter(p => p.config.toTerritory === territory && !p.arrived).length
  }

  // ── Update Loop ───────────────────────────────────────────────────────────

  update(dt: number): void {
    this.elapsed += dt

    // Advance packets
    for (const pkt of this.packets) {
      if (!pkt.arrived) {
        pkt.t += pkt.speed * dt
        if (pkt.t >= 1) {
          pkt.t = 1
          pkt.arrived = true
          pkt.flashTimer = ARRIVAL_FLASH_DURATION
        }
      } else {
        pkt.flashTimer -= dt
      }
    }

    // Remove expired packets
    this.packets = this.packets.filter(p => !p.arrived || p.flashTimer > 0)

    // Redraw
    this.draw()
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private draw(): void {
    const g = this.graphics
    g.clear()

    for (const pkt of this.packets) {
      const pos = this.evalQuadBezier(
        pkt.road.fx, pkt.road.fy,
        pkt.road.cx, pkt.road.cy,
        pkt.road.tx, pkt.road.ty,
        pkt.t
      )

      const { style, arrived, flashTimer } = pkt

      if (arrived) {
        // Arrival flash: expanding ring that fades out
        const flashProgress = 1 - (flashTimer / ARRIVAL_FLASH_DURATION)
        const flashRadius = style.radius + flashProgress * 20
        const flashAlpha = (1 - flashProgress) * 0.6
        g.circle(pos.x, pos.y, flashRadius).fill({ color: style.color, alpha: flashAlpha })
        // Bright core flash
        const coreAlpha = (1 - flashProgress) * 0.9
        g.circle(pos.x, pos.y, style.radius * (1 - flashProgress * 0.5))
          .fill({ color: 0xFFFFFF, alpha: coreAlpha })
      } else {
        // Outer glow ring (high/critical)
        if (style.hasGlow && style.glowRadius) {
          let glowAlpha = style.glowAlpha ?? 0.2
          // Pulsing glow for critical
          if (style.hasPulse) {
            const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 6)
            glowAlpha *= (0.6 + 0.4 * pulse)
          }
          g.circle(pos.x, pos.y, style.glowRadius).fill({ color: style.color, alpha: glowAlpha })
        }

        // Main body
        g.circle(pos.x, pos.y, style.radius).fill({ color: style.color, alpha: style.alpha })

        // Bright core for high/critical
        if (style.hasGlow) {
          const coreAlpha = style.hasPulse
            ? 0.5 + 0.3 * Math.sin(this.elapsed * 8)
            : 0.5
          g.circle(pos.x, pos.y, style.radius * 0.4)
            .fill({ color: 0xFFFFFF, alpha: coreAlpha })
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Find a road matching from→to (or to→from, reversing the curve). */
  private findRoad(from: string, to: string): RoadCurve | null {
    // Exact match
    const exact = this.roads.find(r => r.from === from && r.to === to)
    if (exact) return exact

    // Reverse match — flip the curve endpoints
    const reverse = this.roads.find(r => r.from === to && r.to === from)
    if (reverse) {
      return {
        from,
        to,
        fx: reverse.tx,
        fy: reverse.ty,
        tx: reverse.fx,
        ty: reverse.fy,
        cx: reverse.cx,
        cy: reverse.cy,
        curveLength: reverse.curveLength,
      }
    }

    return null
  }

  private evalQuadBezier(
    x0: number, y0: number,
    cx: number, cy: number,
    x1: number, y1: number,
    t: number
  ): { x: number; y: number } {
    const mt = 1 - t
    return {
      x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
      y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
    }
  }

  private approxBezierLength(
    x0: number, y0: number,
    cx: number, cy: number,
    x1: number, y1: number,
    segments: number
  ): number {
    let length = 0
    let prevX = x0
    let prevY = y0
    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      const pt = this.evalQuadBezier(x0, y0, cx, cy, x1, y1, t)
      const dx = pt.x - prevX
      const dy = pt.y - prevY
      length += Math.sqrt(dx * dx + dy * dy)
      prevX = pt.x
      prevY = pt.y
    }
    return length
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.graphics.destroy()
    this.packets = []
  }
}
