/**
 * ProductionChainRenderer — Factorio-style production chain visualization.
 *
 * When a territory is clicked, this renderer draws the production chain:
 * nodes (processing stations), connections (pipes with flow particles),
 * throughput numbers, and pulsing bottleneck indicators.
 *
 * PixiJS v8 API only. Follows RoadRenderer pattern for bezier curves + marching dots.
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProductionNode {
  id: string
  territory: string
  name: string
  metric: number        // current throughput
  target: number        // expected throughput
  capacity: number      // max possible throughput
  unit: string          // e.g. "/week", "/day", "avg h"
  inputNodes: string[]  // upstream node IDs
  outputNodes: string[] // downstream node IDs
  position: { x: number; y: number }  // 0-1 range within territory bounds
}

export interface ProductionChainData {
  territory: string
  nodes: ProductionNode[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_MIN_WIDTH = 120
const NODE_MAX_WIDTH = 180
const NODE_HEIGHT = 70
const NODE_CORNER_RADIUS = 8
const NODE_SPREAD_X = 400   // horizontal spacing between nodes
const NODE_SPREAD_Y = 60    // vertical jitter for visual flow
const CHAIN_WIDTH = 500     // half-width of chain layout from center

// Colors from PRD 06
const COLOR_HEALTHY   = 0x33ff77
const COLOR_WARNING   = 0xffaa00
const COLOR_DANGER    = 0xff3366
const COLOR_BG_NODE   = 0x1a1a2e
const COLOR_BORDER    = 0x2a2a3e
const COLOR_TEXT       = 0xe0e0e0
const COLOR_TEXT_DIM   = 0x808090
const COLOR_BOTTLENECK_GLOW = 0xff3366

// Connection pipe
const PIPE_MIN_WIDTH = 1.5
const PIPE_MAX_WIDTH = 6
const BEZIER_OFFSET = 60

// Particle flow along connections
const DOT_RADIUS = 2
const DOT_SPACING = 30
const DOT_SPEED = 60

// Bottleneck pileup
const PILEUP_DOT_COUNT = 8
const PILEUP_SPREAD = 20

// Animation
const FADE_DURATION = 0.3  // seconds
const BOTTLENECK_PULSE_SPEED = 3.0  // radians/sec

// ── Internal state ─────────────────────────────────────────────────────────────

interface NodeVisual {
  data: ProductionNode
  worldX: number
  worldY: number
  width: number
  healthRatio: number
  color: number
  isBottleneck: boolean
}

interface ConnectionVisual {
  fromNode: NodeVisual
  toNode: NodeVisual
  fx: number; fy: number
  tx: number; ty: number
  cx: number; cy: number
  curveLength: number
  width: number
  color: number
  isBottleneckTarget: boolean
}

// ── ProductionChainRenderer ────────────────────────────────────────────────────

export class ProductionChainRenderer {
  private layer: Container
  private getCenterFn: (territory: string) => { x: number; y: number }

  // Graphics objects — static redrawn on data change, dots redrawn per frame
  private nodeGraphics: Graphics
  private nodeLabels: Container
  private connectionGraphics: Graphics
  private dotGraphics: Graphics
  private bottleneckGraphics: Graphics
  private bottleneckLabels: Container
  private dimOverlay: Graphics

  // State
  private activeTerritory: string | null = null
  private nodeVisuals: NodeVisual[] = []
  private connectionVisuals: ConnectionVisual[] = []
  private bottleneckNode: NodeVisual | null = null
  private elapsed = 0

  // Fade animation
  private fadeState: 'idle' | 'fading_in' | 'fading_out' = 'idle'
  private fadeProgress = 0
  private chainContainer: Container
  private onFadeOutComplete: (() => void) | null = null

  // Text cache — avoid recreating every update
  private textCache: Map<string, Text> = new Map()
  private bottleneckTextCache: Map<string, Text> = new Map()

  // Callback for dimming other territories
  private dimCallback: ((dim: boolean, excludeTerritory: string | null) => void) | null = null

  constructor(
    layer: Container,
    getCenterFn: (territory: string) => { x: number; y: number }
  ) {
    this.layer = layer
    this.getCenterFn = getCenterFn

    // Dim overlay sits behind everything
    this.dimOverlay = new Graphics()
    this.dimOverlay.alpha = 0
    this.layer.addChild(this.dimOverlay)

    // Chain container holds all production chain visuals
    this.chainContainer = new Container()
    this.chainContainer.alpha = 0
    this.layer.addChild(this.chainContainer)

    this.connectionGraphics = new Graphics()
    this.dotGraphics = new Graphics()
    this.nodeGraphics = new Graphics()
    this.nodeLabels = new Container()
    this.bottleneckGraphics = new Graphics()
    this.bottleneckLabels = new Container()

    this.chainContainer.addChild(this.connectionGraphics)
    this.chainContainer.addChild(this.dotGraphics)
    this.chainContainer.addChild(this.nodeGraphics)
    this.chainContainer.addChild(this.nodeLabels)
    this.chainContainer.addChild(this.bottleneckGraphics)
    this.chainContainer.addChild(this.bottleneckLabels)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Show production chain for a territory. Fades in over FADE_DURATION. */
  show(territory: string, data: ProductionChainData): void {
    if (this.activeTerritory === territory) return

    this.activeTerritory = territory
    this.buildVisuals(data)
    this.drawStatic()

    // Start fade in
    this.fadeState = 'fading_in'
    this.fadeProgress = 0

    if (this.dimCallback) this.dimCallback(true, territory)
  }

  /** Hide production chain. Fades out over FADE_DURATION. */
  hide(): void {
    if (!this.activeTerritory) return

    this.fadeState = 'fading_out'
    this.fadeProgress = 0
    this.onFadeOutComplete = () => {
      this.activeTerritory = null
      this.nodeVisuals = []
      this.connectionVisuals = []
      this.bottleneckNode = null
      this.clearTexts()
      this.clearBottleneckTexts()
      this.nodeGraphics.clear()
      this.connectionGraphics.clear()
      this.dotGraphics.clear()
      this.bottleneckGraphics.clear()
    }

    if (this.dimCallback) this.dimCallback(false, null)
  }

  /** Update production data without hiding/showing (e.g., from WebSocket). */
  updateData(data: ProductionChainData): void {
    if (this.activeTerritory !== data.territory) return
    this.buildVisuals(data)
    this.drawStatic()
  }

  /** Returns true if production view is visible for any territory. */
  isVisible(): boolean {
    return this.activeTerritory !== null && this.fadeState !== 'fading_out'
  }

  /** Returns the active territory ID or null. */
  getActiveTerritory(): string | null {
    return this.activeTerritory
  }

  /** Per-frame update — animate particles and bottleneck pulse. */
  update(dt: number): void {
    // Handle fade animation
    if (this.fadeState === 'fading_in') {
      this.fadeProgress += dt / FADE_DURATION
      if (this.fadeProgress >= 1) {
        this.fadeProgress = 1
        this.fadeState = 'idle'
      }
      this.chainContainer.alpha = this.fadeProgress
    } else if (this.fadeState === 'fading_out') {
      this.fadeProgress += dt / FADE_DURATION
      if (this.fadeProgress >= 1) {
        this.fadeProgress = 1
        this.fadeState = 'idle'
        this.chainContainer.alpha = 0
        if (this.onFadeOutComplete) {
          this.onFadeOutComplete()
          this.onFadeOutComplete = null
        }
        return
      }
      this.chainContainer.alpha = 1 - this.fadeProgress
    }

    if (!this.activeTerritory || this.chainContainer.alpha === 0) return

    this.elapsed += dt
    this.drawDots()
    this.drawBottleneckPulse()
  }

  /** Set callback for dimming territories when production view is active. */
  setDimCallback(cb: (dim: boolean, excludeTerritory: string | null) => void): void {
    this.dimCallback = cb
  }

  // ── Build visuals from data ───────────────────────────────────────────────

  private buildVisuals(data: ProductionChainData): void {
    const center = this.getCenterFn(data.territory)
    if (!center) return

    const nodes = data.nodes
    const nodeCount = nodes.length

    // Detect bottleneck using the PRD algorithm
    const bottleneckId = this.detectBottleneck(nodes)

    // Build node visuals with layout positions
    this.nodeVisuals = nodes.map((node, index) => {
      // Map node position (0-1 range) to world space around territory center
      // Left-to-right layout with slight vertical offset
      const px = node.position?.x ?? (index / Math.max(1, nodeCount - 1))
      const py = node.position?.y ?? ((index % 2 === 0 ? -0.3 : 0.3) * 0.5 + 0.5)

      const halfWidth = Math.min(CHAIN_WIDTH, nodeCount * NODE_SPREAD_X * 0.5)
      const worldX = center.x + (px - 0.5) * halfWidth * 2
      const worldY = center.y + (py - 0.5) * NODE_SPREAD_Y * 4

      const healthRatio = node.target > 0 ? node.metric / node.target : 1
      const color = healthRatio > 0.8 ? COLOR_HEALTHY
                  : healthRatio > 0.5 ? COLOR_WARNING
                  : COLOR_DANGER

      // Width scales with throughput volume relative to max in chain
      const maxMetric = Math.max(...nodes.map(n => n.metric), 1)
      const widthRatio = 0.6 + 0.4 * (node.metric / maxMetric)
      const width = NODE_MIN_WIDTH + (NODE_MAX_WIDTH - NODE_MIN_WIDTH) * widthRatio

      return {
        data: node,
        worldX,
        worldY,
        width,
        healthRatio,
        color,
        isBottleneck: node.id === bottleneckId,
      }
    })

    // Build connection visuals
    this.connectionVisuals = []
    const nodeMap = new Map(this.nodeVisuals.map(nv => [nv.data.id, nv]))

    for (const nv of this.nodeVisuals) {
      for (const outputId of nv.data.outputNodes) {
        const target = nodeMap.get(outputId)
        if (!target) continue

        const fx = nv.worldX + nv.width / 2
        const fy = nv.worldY
        const tx = target.worldX - target.width / 2
        const ty = target.worldY

        // Bezier control point — slight arc
        const mx = (fx + tx) / 2
        const my = (fy + ty) / 2
        const dx = tx - fx
        const dy = ty - fy
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len < 1) continue

        const px = -dy / len
        const py = dx / len
        const cx = mx + px * BEZIER_OFFSET
        const cy = my + py * BEZIER_OFFSET

        const curveLength = this.approxBezierLength(fx, fy, cx, cy, tx, ty, 20)

        // Width scales with source throughput
        const maxMetric = Math.max(...this.nodeVisuals.map(n => n.data.metric), 1)
        const ratio = nv.data.metric / maxMetric
        const width = PIPE_MIN_WIDTH + (PIPE_MAX_WIDTH - PIPE_MIN_WIDTH) * ratio

        this.connectionVisuals.push({
          fromNode: nv,
          toNode: target,
          fx, fy, tx, ty, cx, cy,
          curveLength,
          width,
          color: nv.color,
          isBottleneckTarget: target.isBottleneck,
        })
      }
    }

    this.bottleneckNode = this.nodeVisuals.find(nv => nv.isBottleneck) ?? null
  }

  // ── Static drawing (called on data change) ─────────────────────────────────

  private drawStatic(): void {
    this.drawConnections()
    this.drawNodes()
    this.drawBottleneckLabels()
  }

  private drawConnections(): void {
    const g = this.connectionGraphics
    g.clear()

    for (const conn of this.connectionVisuals) {
      // Glow pass for thicker pipes
      if (conn.width > 3) {
        g.moveTo(conn.fx, conn.fy)
        g.quadraticCurveTo(conn.cx, conn.cy, conn.tx, conn.ty)
        g.stroke({ color: conn.color, width: conn.width + 4, alpha: 0.1 })
      }

      // Main pipe
      g.moveTo(conn.fx, conn.fy)
      g.quadraticCurveTo(conn.cx, conn.cy, conn.tx, conn.ty)
      g.stroke({ color: conn.color, width: conn.width, alpha: 0.5 })
    }
  }

  private drawNodes(): void {
    const g = this.nodeGraphics
    g.clear()
    this.clearTexts()

    for (const nv of this.nodeVisuals) {
      const hw = nv.width / 2
      const hh = NODE_HEIGHT / 2
      const x = nv.worldX - hw
      const y = nv.worldY - hh

      // Node background
      g.roundRect(x, y, nv.width, NODE_HEIGHT, NODE_CORNER_RADIUS)
        .fill({ color: COLOR_BG_NODE, alpha: 0.9 })

      // Border in health color
      g.roundRect(x, y, nv.width, NODE_HEIGHT, NODE_CORNER_RADIUS)
        .stroke({ color: nv.color, width: 1.5, alpha: 0.7 })

      // Status indicator dot (top-right corner)
      g.circle(x + nv.width - 10, y + 10, 4)
        .fill({ color: nv.color, alpha: 0.9 })

      // ── Text labels (created as PixiJS Text objects) ──

      // Node name
      const nameText = this.getOrCreateText(
        `name-${nv.data.id}`,
        nv.data.name.length > 16 ? nv.data.name.slice(0, 15) + '..' : nv.data.name,
        {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          fill: COLOR_TEXT,
          align: 'center',
        }
      )
      nameText.anchor.set(0.5, 0)
      nameText.position.set(nv.worldX, nv.worldY - hh + 8)

      // Throughput number
      const metricStr = this.formatMetric(nv.data.metric, nv.data.unit)
      const metricText = this.getOrCreateText(
        `metric-${nv.data.id}`,
        metricStr,
        {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 14,
          fontWeight: 'bold',
          fill: nv.color,
          align: 'center',
        }
      )
      metricText.anchor.set(0.5, 0)
      metricText.position.set(nv.worldX, nv.worldY - 4)

      // Target (dimmer, below metric)
      const targetStr = `target: ${this.formatMetric(nv.data.target, nv.data.unit)}`
      const targetText = this.getOrCreateText(
        `target-${nv.data.id}`,
        targetStr,
        {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 9,
          fill: COLOR_TEXT_DIM,
          align: 'center',
        }
      )
      targetText.anchor.set(0.5, 0)
      targetText.position.set(nv.worldX, nv.worldY + 14)
    }
  }

  private drawBottleneckLabels(): void {
    this.clearBottleneckTexts()
    if (!this.bottleneckNode) return

    const bn = this.bottleneckNode

    // "BOTTLENECK" label above node
    const labelText = this.getOrCreateBottleneckText(
      'bn-label',
      'BOTTLENECK',
      {
        fontFamily: '"Orbitron", monospace',
        fontSize: 12,
        fontWeight: 'bold',
        fill: COLOR_DANGER,
        align: 'center',
        letterSpacing: 2,
      }
    )
    labelText.anchor.set(0.5, 1)
    labelText.position.set(bn.worldX, bn.worldY - NODE_HEIGHT / 2 - 30)

    // Gap sub-label
    const gapStr = `${this.formatMetric(bn.data.metric, bn.data.unit)} vs ${this.formatMetric(bn.data.target, bn.data.unit)} target`
    const gapText = this.getOrCreateBottleneckText(
      'bn-gap',
      gapStr,
      {
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        fill: COLOR_DANGER,
        align: 'center',
      }
    )
    gapText.anchor.set(0.5, 1)
    gapText.position.set(bn.worldX, bn.worldY - NODE_HEIGHT / 2 - 16)
  }

  // ── Per-frame drawing ─────────────────────────────────────────────────────

  private drawDots(): void {
    const g = this.dotGraphics
    g.clear()

    for (const conn of this.connectionVisuals) {
      if (conn.curveLength < 10) continue

      const numDots = Math.max(1, Math.floor(conn.curveLength / DOT_SPACING))
      const phaseOffset = (this.elapsed * DOT_SPEED / conn.curveLength) % 1

      for (let i = 0; i < numDots; i++) {
        let t = (i / numDots + phaseOffset) % 1

        // If destination is bottleneck, particles pile up at the end
        if (conn.isBottleneckTarget && t > 0.8) {
          // Cluster dots in the 0.85-0.98 range
          t = 0.85 + (t - 0.8) * 0.65
        }

        const pos = this.evalQuadBezier(
          conn.fx, conn.fy,
          conn.cx, conn.cy,
          conn.tx, conn.ty,
          t
        )

        g.circle(pos.x, pos.y, DOT_RADIUS)
          .fill({ color: conn.color, alpha: 0.8 })
      }

      // Extra pileup dots at bottleneck destination
      if (conn.isBottleneckTarget) {
        for (let i = 0; i < PILEUP_DOT_COUNT; i++) {
          const t = 0.9 + Math.random() * 0.08
          const pos = this.evalQuadBezier(
            conn.fx, conn.fy,
            conn.cx, conn.cy,
            conn.tx, conn.ty,
            t
          )
          // Spread slightly perpendicular
          const jitterX = (Math.random() - 0.5) * PILEUP_SPREAD
          const jitterY = (Math.random() - 0.5) * PILEUP_SPREAD

          g.circle(pos.x + jitterX, pos.y + jitterY, DOT_RADIUS * 0.8)
            .fill({ color: COLOR_DANGER, alpha: 0.4 + Math.random() * 0.3 })
        }
      }
    }
  }

  private drawBottleneckPulse(): void {
    const g = this.bottleneckGraphics
    g.clear()

    if (!this.bottleneckNode) return
    const bn = this.bottleneckNode

    // Pulsing glow ring
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * BOTTLENECK_PULSE_SPEED)
    const baseRadius = Math.max(bn.width, NODE_HEIGHT) * 0.6
    const glowRadius = baseRadius + pulse * baseRadius * 0.5

    // Outer glow
    g.circle(bn.worldX, bn.worldY, glowRadius + 10)
      .fill({ color: COLOR_BOTTLENECK_GLOW, alpha: 0.03 + pulse * 0.03 })

    // Middle glow
    g.circle(bn.worldX, bn.worldY, glowRadius)
      .fill({ color: COLOR_BOTTLENECK_GLOW, alpha: 0.05 + pulse * 0.05 })

    // Inner ring stroke
    g.circle(bn.worldX, bn.worldY, baseRadius + 5)
      .stroke({ color: COLOR_BOTTLENECK_GLOW, width: 2, alpha: 0.3 + pulse * 0.4 })
  }

  // ── Bottleneck detection (from PRD 14) ────────────────────────────────────

  private detectBottleneck(nodes: ProductionNode[]): string | null {
    let worstRatio = Infinity
    let bottleneckId: string | null = null

    for (const node of nodes) {
      if (node.target <= 0) continue
      const ratio = node.metric / node.target

      if (ratio < worstRatio && ratio < 0.8) {
        // Check upstream: if input is also starved, the bottleneck is upstream
        const upstreamHealthy = node.inputNodes.every(id => {
          const upstream = nodes.find(n => n.id === id)
          return upstream ? (upstream.metric / upstream.target) > 0.8 : true
        })

        if (upstreamHealthy) {
          worstRatio = ratio
          bottleneckId = node.id
        }
      }
    }

    return bottleneckId
  }

  // ── Text helpers (avoid recreating Text objects every frame) ──────────────

  private getOrCreateText(key: string, content: string, style: Partial<TextStyle>): Text {
    let text = this.textCache.get(key)
    if (text) {
      text.text = content
      return text
    }
    text = new Text({ text: content, style: new TextStyle(style as any) })
    this.textCache.set(key, text)
    this.nodeLabels.addChild(text)
    return text
  }

  private getOrCreateBottleneckText(key: string, content: string, style: Partial<TextStyle>): Text {
    let text = this.bottleneckTextCache.get(key)
    if (text) {
      text.text = content
      return text
    }
    text = new Text({ text: content, style: new TextStyle(style as any) })
    this.bottleneckTextCache.set(key, text)
    this.bottleneckLabels.addChild(text)
    return text
  }

  private clearTexts(): void {
    for (const text of this.textCache.values()) {
      text.destroy()
    }
    this.textCache.clear()
    this.nodeLabels.removeChildren()
  }

  private clearBottleneckTexts(): void {
    for (const text of this.bottleneckTextCache.values()) {
      text.destroy()
    }
    this.bottleneckTextCache.clear()
    this.bottleneckLabels.removeChildren()
  }

  // ── Metric formatting ────────────────────────────────────────────────────

  private formatMetric(value: number, unit: string): string {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K${unit}`
    }
    // Show decimal for small numbers, integer for bigger
    if (value < 10 && value % 1 !== 0) {
      return `${value.toFixed(1)}${unit}`
    }
    return `${Math.round(value)}${unit}`
  }

  // ── Bezier helpers (same pattern as RoadRenderer) ─────────────────────────

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

  // ── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.clearTexts()
    this.clearBottleneckTexts()
    this.nodeGraphics.destroy()
    this.connectionGraphics.destroy()
    this.dotGraphics.destroy()
    this.bottleneckGraphics.destroy()
    this.nodeLabels.destroy()
    this.bottleneckLabels.destroy()
    this.dimOverlay.destroy()
    this.chainContainer.destroy()
  }
}
