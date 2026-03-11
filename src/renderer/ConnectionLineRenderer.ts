/**
 * ConnectionLineRenderer - Animated dashed lines between parent and child units
 *
 * Draws "marching ants" lines from parent units to their spawned sub-agents.
 * Line color matches the parent's division accent. Animates while child is
 * working, static when idle, fades out when child goes offline.
 */

import { Container, Graphics } from 'pixi.js'
import type { UnitRenderer, UnitClass } from './UnitRenderer'

const CLASS_ACCENT: Record<UnitClass, number> = {
  command: 0xFFB86C,     // gold/amber (Opus)
  operations: 0xE8682A,  // orange (Sonnet)
  recon: 0x82C896,       // phosphor green (Haiku)
}

const DASH_LENGTH = 8
const GAP_LENGTH = 4
const SEGMENT = DASH_LENGTH + GAP_LENGTH
const LINE_WIDTH = 1.5

export class ConnectionLineRenderer {
  private layer: Container
  private graphics: Graphics
  private dashOffset = 0

  constructor(layer: Container) {
    this.layer = layer
    this.graphics = new Graphics()
    this.layer.addChild(this.graphics)
  }

  update(units: Map<string, UnitRenderer>, dt: number = 1 / 60): void {
    this.graphics.clear()

    // Advance the marching ants offset
    this.dashOffset += dt * 40 // pixels per second
    if (this.dashOffset > SEGMENT) {
      this.dashOffset -= SEGMENT
    }

    // Build a lookup of unitId -> UnitRenderer for parent resolution
    for (const [_childId, child] of units) {
      if (!child.parentSessionId) continue

      const parent = units.get(child.parentSessionId)
      if (!parent) continue

      // Determine alpha based on child status
      let alpha: number
      switch (child.status) {
        case 'working':
        case 'thinking':
          alpha = 0.3
          break
        case 'idle':
          alpha = 0.2
          break
        case 'offline':
          alpha = 0 // fully invisible
          break
        default:
          alpha = 0.15
      }

      if (alpha <= 0) continue

      // Use parent's class accent color
      const color = CLASS_ACCENT[parent.unitClass] ?? 0xF0E4D0

      // Determine if dashes should animate (march) or be static
      const animate = child.status === 'working' || child.status === 'thinking'

      // Draw dashed line manually (PixiJS v8 doesn't support dash in stroke)
      this.drawDashedLine(
        parent.worldX, parent.worldY,
        child.worldX, child.worldY,
        color, alpha, animate
      )
    }
  }

  private drawDashedLine(
    x1: number, y1: number,
    x2: number, y2: number,
    color: number, alpha: number,
    animate: boolean
  ): void {
    const dx = x2 - x1
    const dy = y2 - y1
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) return

    const ux = dx / dist
    const uy = dy / dist

    // Start offset for marching effect
    const offset = animate ? this.dashOffset : 0
    let pos = -offset // start before 0 so we don't clip the first dash

    while (pos < dist) {
      const dashStart = Math.max(0, pos)
      const dashEnd = Math.min(dist, pos + DASH_LENGTH)

      if (dashEnd > dashStart) {
        const sx = x1 + ux * dashStart
        const sy = y1 + uy * dashStart
        const ex = x1 + ux * dashEnd
        const ey = y1 + uy * dashEnd

        this.graphics.moveTo(sx, sy)
        this.graphics.lineTo(ex, ey)
        this.graphics.stroke({ width: LINE_WIDTH, color, alpha })
      }

      pos += SEGMENT
    }
  }

  destroy(): void {
    this.graphics.destroy()
  }
}
