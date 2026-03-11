/**
 * RoadRenderer
 * PixiJS v8 renderer that draws animated roads between territory centers.
 * Magnetic Residue palette — roads glow brighter with more traffic.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RoadData {
  fromTerritory: string
  toTerritory: string
  packetCount: number
  roadLevel: number
  lastPacketAt: string | null
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const LINE_WIDTHS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 5,
  5: 8,
}

const ROAD_COLORS: Record<number, number> = {
  1: 0x2A2118,
  2: 0x2A2118,
  3: 0xB4A690,
  4: 0xFFB86C,
  5: 0xE8682A,
}

const ROAD_ALPHA: Record<number, number> = {
  1: 0.3,
  2: 0.4,
  3: 0.55,
  4: 0.7,
  5: 0.8,
}

// Bezier control point offset perpendicular to midpoint
const BEZIER_OFFSET = 150

// Marching ant config (road_level >= 3)
const DOT_RADIUS = 2.5
const DOT_SPACING = 40 // pixels along the curve between dots
const DOT_SPEED = 80   // pixels per second

// Hit area width for hover detection (fat invisible strip around curve)
const HIT_WIDTH = 30

// Road level labels
const LEVEL_LABELS: Record<number, string> = {
  1: 'Trail',
  2: 'Path',
  3: 'Road',
  4: 'Highway',
  5: 'Superhighway',
}

// Friendly territory names
const TERRITORY_NAMES: Record<string, string> = {
  'hq': 'HQ',
  'lead-gen': 'Lead Gen',
  'sales': 'Sales',
  'fulfillment': 'Fulfillment',
  'support': 'Support',
  'retention': 'Retention',
  'content': 'Content',
}

// ─── Internal road state ────────────────────────────────────────────────────────

interface RoadState {
  from: string
  to: string
  level: number
  packetCount: number
  fx: number // from center x
  fy: number
  tx: number // to center x
  ty: number
  cx: number // bezier control x
  cy: number
  curveLength: number
}

// ─── RoadRenderer ───────────────────────────────────────────────────────────────

export class RoadRenderer {
  private layer: Container
  private getCenterFn: (territory: string) => { x: number; y: number }

  private roadGraphics: Graphics
  private dotGraphics: Graphics
  private queueGraphics: Graphics
  private hitContainer: Container

  private roads: RoadState[] = []
  private elapsed = 0
  private queueCounts: Map<string, number> = new Map()

  private tooltip: HTMLDivElement | null = null
  private hoveredRoad: RoadState | null = null

  constructor(
    layer: Container,
    getCenterFn: (territory: string) => { x: number; y: number }
  ) {
    this.layer = layer
    this.getCenterFn = getCenterFn

    this.roadGraphics = new Graphics()
    this.dotGraphics = new Graphics()
    this.queueGraphics = new Graphics()
    this.hitContainer = new Container()

    this.layer.addChild(this.roadGraphics)
    this.layer.addChild(this.dotGraphics)
    this.layer.addChild(this.queueGraphics)
    this.layer.addChild(this.hitContainer)

    this.createTooltip()
  }

  private createTooltip(): void {
    const el = document.createElement('div')
    el.style.cssText = `
      position: fixed;
      pointer-events: none;
      background: rgba(10, 8, 6, 0.92);
      border: 1px solid rgba(180, 166, 144, 0.4);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: "JetBrains Mono", "Courier New", monospace;
      font-size: 12px;
      color: #B4A690;
      white-space: nowrap;
      z-index: 9999;
      display: none;
      backdrop-filter: blur(4px);
    `
    document.body.appendChild(el)
    this.tooltip = el
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setQueueCount(territory: string, count: number): void {
    if (count <= 0) {
      this.queueCounts.delete(territory)
    } else {
      this.queueCounts.set(territory, count)
    }
  }

  updateRoads(roads: RoadData[]): void {
    this.roads = []

    for (const r of roads) {
      if (r.roadLevel <= 0) continue

      const fromCenter = this.getCenterFn(r.fromTerritory)
      const toCenter = this.getCenterFn(r.toTerritory)

      if (!fromCenter || !toCenter) continue

      // Compute bezier control point: offset perpendicular to the left of from→to
      const mx = (fromCenter.x + toCenter.x) / 2
      const my = (fromCenter.y + toCenter.y) / 2

      const dx = toCenter.x - fromCenter.x
      const dy = toCenter.y - fromCenter.y
      const len = Math.sqrt(dx * dx + dy * dy)

      if (len < 1) continue

      // Perpendicular unit vector (left of direction)
      const px = -dy / len
      const py = dx / len

      const cx = mx + px * BEZIER_OFFSET
      const cy = my + py * BEZIER_OFFSET

      // Approximate curve length via sampling
      const curveLength = this.approxBezierLength(
        fromCenter.x, fromCenter.y,
        cx, cy,
        toCenter.x, toCenter.y,
        30
      )

      this.roads.push({
        from: r.fromTerritory,
        to: r.toTerritory,
        level: r.roadLevel,
        packetCount: r.packetCount,
        fx: fromCenter.x,
        fy: fromCenter.y,
        tx: toCenter.x,
        ty: toCenter.y,
        cx,
        cy,
        curveLength,
      })
    }

    // Redraw static road lines
    this.drawRoads()
    this.rebuildHitAreas()
  }

  update(dt: number): void {
    this.elapsed += dt
    this.drawDots()
    this.drawQueueIndicators()
  }

  // ── Hit areas & tooltip ─────────────────────────────────────────────────────

  private rebuildHitAreas(): void {
    // Remove old hit areas
    this.hitContainer.removeChildren()

    for (const road of this.roads) {
      const hit = new Graphics()
      hit.eventMode = 'static'
      hit.cursor = 'pointer'

      // Draw a fat invisible strip along the bezier curve
      const segments = 20
      const points: { x: number; y: number }[] = []
      for (let i = 0; i <= segments; i++) {
        points.push(this.evalQuadBezier(
          road.fx, road.fy, road.cx, road.cy, road.tx, road.ty, i / segments
        ))
      }

      // Build thick polygon around the curve path
      const leftSide: { x: number; y: number }[] = []
      const rightSide: { x: number; y: number }[] = []

      for (let i = 0; i < points.length; i++) {
        let nx: number, ny: number
        if (i === 0) {
          nx = points[1].x - points[0].x
          ny = points[1].y - points[0].y
        } else if (i === points.length - 1) {
          nx = points[i].x - points[i - 1].x
          ny = points[i].y - points[i - 1].y
        } else {
          nx = points[i + 1].x - points[i - 1].x
          ny = points[i + 1].y - points[i - 1].y
        }
        const nLen = Math.sqrt(nx * nx + ny * ny) || 1
        const px = -ny / nLen
        const py = nx / nLen
        leftSide.push({ x: points[i].x + px * HIT_WIDTH, y: points[i].y + py * HIT_WIDTH })
        rightSide.push({ x: points[i].x - px * HIT_WIDTH, y: points[i].y - py * HIT_WIDTH })
      }

      // Draw polygon: left side forward, right side backward
      hit.moveTo(leftSide[0].x, leftSide[0].y)
      for (let i = 1; i < leftSide.length; i++) {
        hit.lineTo(leftSide[i].x, leftSide[i].y)
      }
      for (let i = rightSide.length - 1; i >= 0; i--) {
        hit.lineTo(rightSide[i].x, rightSide[i].y)
      }
      hit.closePath()
      hit.fill({ color: 0x000000, alpha: 0.001 }) // Nearly invisible but interactive

      const roadRef = road
      hit.on('pointerover', () => { this.hoveredRoad = roadRef })
      hit.on('pointerout', () => {
        this.hoveredRoad = null
        if (this.tooltip) this.tooltip.style.display = 'none'
      })
      hit.on('globalpointermove', (e: any) => {
        if (this.hoveredRoad !== roadRef) return
        this.showTooltip(roadRef, e.global?.x ?? e.clientX, e.global?.y ?? e.clientY)
      })

      this.hitContainer.addChild(hit)
    }
  }

  private showTooltip(road: RoadState, screenX: number, screenY: number): void {
    if (!this.tooltip) return

    const fromName = TERRITORY_NAMES[road.from] || road.from
    const toName = TERRITORY_NAMES[road.to] || road.to
    const levelName = LEVEL_LABELS[road.level] || `Level ${road.level}`
    const levelColor = road.level >= 4 ? '#FFB86C' : road.level >= 3 ? '#B4A690' : '#6B6152'

    this.tooltip.innerHTML = `
      <div style="color:${levelColor};font-weight:bold;margin-bottom:3px">${levelName}</div>
      <div>${fromName} → ${toName}</div>
      <div style="color:#6B6152;margin-top:3px">${road.packetCount} packets</div>
    `
    this.tooltip.style.display = 'block'
    this.tooltip.style.left = `${screenX + 16}px`
    this.tooltip.style.top = `${screenY - 10}px`
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  private drawRoads(): void {
    const g = this.roadGraphics
    g.clear()

    for (const road of this.roads) {
      const width = LINE_WIDTHS[road.level] ?? 1
      const destQueue = this.queueCounts.get(road.to) ?? 0
      const color = destQueue > 10 ? 0xCC3333 : (ROAD_COLORS[road.level] ?? 0x2A2118)
      const alpha = ROAD_ALPHA[road.level] ?? 0.3

      // Level 5 outer glow pass
      if (road.level === 5) {
        g.moveTo(road.fx, road.fy)
        g.quadraticCurveTo(road.cx, road.cy, road.tx, road.ty)
        g.stroke({ color: 0xE8682A, width: width + 6, alpha: alpha * 0.25 })
      }

      // Level 4+ secondary glow
      if (road.level >= 4) {
        g.moveTo(road.fx, road.fy)
        g.quadraticCurveTo(road.cx, road.cy, road.tx, road.ty)
        g.stroke({ color, width: width + 3, alpha: alpha * 0.3 })
      }

      // Main road line
      g.moveTo(road.fx, road.fy)
      g.quadraticCurveTo(road.cx, road.cy, road.tx, road.ty)
      g.stroke({ color, width, alpha })
    }
  }

  private drawDots(): void {
    const g = this.dotGraphics
    g.clear()

    for (const road of this.roads) {
      // Only animate dots for level 3+
      if (road.level < 3) continue

      const color = ROAD_COLORS[road.level] ?? 0xB4A690
      const alpha = ROAD_ALPHA[road.level] ?? 0.55

      // How many dots fit on this road
      const numDots = Math.max(1, Math.floor(road.curveLength / DOT_SPACING))

      // Phase offset: how far dots have traveled (normalized 0-1)
      const phaseOffset = (this.elapsed * DOT_SPEED / road.curveLength) % 1

      for (let i = 0; i < numDots; i++) {
        let t = (i / numDots + phaseOffset) % 1

        const pos = this.evalQuadBezier(
          road.fx, road.fy,
          road.cx, road.cy,
          road.tx, road.ty,
          t
        )

        const dotSize = road.level >= 4 ? DOT_RADIUS * 1.3 : DOT_RADIUS

        g.circle(pos.x, pos.y, dotSize).fill({ color, alpha: alpha * 0.9 })

        // Bright core for level 5
        if (road.level === 5) {
          g.circle(pos.x, pos.y, dotSize * 0.5).fill({ color: 0xFFFFFF, alpha: 0.6 })
        }
      }
    }
  }

  // ── Queue indicators ───────────────────────────────────────────────────────

  private drawQueueIndicators(): void {
    const g = this.queueGraphics
    g.clear()

    // Track which destinations we've already drawn (avoid duplicate stacks)
    const drawn = new Set<string>()

    for (const road of this.roads) {
      const count = this.queueCounts.get(road.to) ?? 0
      if (count <= 0 || drawn.has(road.to)) continue
      drawn.add(road.to)

      // Stack dots above the destination endpoint
      const dotCount = Math.min(count, 5)
      const baseColor = ROAD_COLORS[road.level] ?? 0xB4A690
      // Brighten the road color for queue dots
      const r = Math.min(255, ((baseColor >> 16) & 0xFF) + 60)
      const gC = Math.min(255, ((baseColor >> 8) & 0xFF) + 60)
      const b = Math.min(255, (baseColor & 0xFF) + 60)
      const brightColor = (r << 16) | (gC << 8) | b

      const QUEUE_DOT_RADIUS = 4
      const QUEUE_DOT_SPACING = 11

      for (let i = 0; i < dotCount; i++) {
        const x = road.tx
        const y = road.ty - (i + 1) * QUEUE_DOT_SPACING
        g.circle(x, y, QUEUE_DOT_RADIUS).fill({ color: brightColor, alpha: 0.85 })
      }

      // If queue > 5, show count label
      if (count > 5) {
        const labelY = road.ty - (dotCount + 1) * QUEUE_DOT_SPACING
        // Draw a small background pill
        const labelText = `${count}`
        // Use Graphics text via a sibling Text node (we'll draw a marker and rely on the count label)
        g.circle(road.tx, labelY, 8).fill({ color: 0x0A0806, alpha: 0.8 })
        g.circle(road.tx, labelY, 8).stroke({ color: brightColor, width: 1, alpha: 0.6 })

        // Check if we already have a text label for this territory
        const existingLabel = this.layer.children.find(
          (c) => c.label === `queue-label-${road.to}`
        )
        if (existingLabel) {
          (existingLabel as Text).text = labelText;
          (existingLabel as Text).position.set(road.tx, labelY)
        } else {
          const text = new Text({
            text: labelText,
            style: new TextStyle({
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 10,
              fill: brightColor,
              align: 'center',
            }),
          })
          text.anchor.set(0.5, 0.5)
          text.position.set(road.tx, labelY)
          text.label = `queue-label-${road.to}`
          this.layer.addChild(text)
        }
      } else {
        // Remove label if count dropped to <= 5
        const existingLabel = this.layer.children.find(
          (c) => c.label === `queue-label-${road.to}`
        )
        if (existingLabel) {
          this.layer.removeChild(existingLabel)
          existingLabel.destroy()
        }
      }
    }
  }

  // ── Bezier helpers ──────────────────────────────────────────────────────────

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

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  destroy(): void {
    this.roadGraphics.destroy()
    this.dotGraphics.destroy()
    this.queueGraphics.destroy()
    // Remove queue labels
    for (const child of [...this.layer.children]) {
      if (typeof child.label === 'string' && child.label.startsWith('queue-label-')) {
        this.layer.removeChild(child)
        child.destroy()
      }
    }
    this.hitContainer.destroy({ children: true })
    if (this.tooltip) {
      this.tooltip.remove()
      this.tooltip = null
    }
  }
}
