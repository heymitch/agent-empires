import { Container, Graphics, Text } from 'pixi.js'
import { ISO_TILT } from './constants'
import {
  type ThreatClass,
  type ThreatSeverity,
  type SeverityShape,
  THREAT_CLASS_CONFIGS,
  SEVERITY_SHAPE,
} from '../../shared/threatClasses'
import { EnemyAI, type UnitPosition } from '../game/EnemyAI'

export interface ThreatEvent {
  id: string
  type: string
  severity: 'low' | 'elevated' | 'critical'
  territory: string
  title: string
  description: string
  timestamp: number
  threatClass?: ThreatClass
}

export type TerritoryBoundsGetter = (territory: string) => { x: number; y: number } | null

/** Map the renderer's 3-level severity to the taxonomy's 4-level severity */
function toThreatSeverity(rendererSeverity: ThreatEvent['severity']): ThreatSeverity {
  switch (rendererSeverity) {
    case 'critical': return 'critical'
    case 'elevated': return 'high'
    case 'low': return 'low'
  }
}

interface SeverityConfig {
  color: number
  borderColor: number
  baseRadius: number
  amplitude: number
  baseAlpha: number
  alphaRange: number
  cycleSeconds: number
  shape: SeverityShape
}

function buildSeverityConfig(event: ThreatEvent): SeverityConfig {
  const classConfig = event.threatClass
    ? THREAT_CLASS_CONFIGS[event.threatClass]
    : null

  const severity = event.threatClass
    ? THREAT_CLASS_CONFIGS[event.threatClass].severity
    : toThreatSeverity(event.severity)

  const shape = SEVERITY_SHAPE[severity]

  // Use class colors when available, fall back to legacy palette
  const color = classConfig?.color ?? LEGACY_SEVERITY_COLOR[event.severity]
  const borderColor = classConfig?.borderColor ?? (color & 0xBBBBBB)

  // Size and pulse vary by legacy severity (controls visual urgency)
  const base = LEGACY_PULSE[event.severity]

  return {
    color,
    borderColor,
    baseRadius: base.baseRadius,
    amplitude: base.amplitude,
    baseAlpha: base.baseAlpha,
    alphaRange: base.alphaRange,
    cycleSeconds: base.cycleSeconds,
    shape,
  }
}

// Legacy fallback colors (used when threatClass is not set)
const LEGACY_SEVERITY_COLOR: Record<ThreatEvent['severity'], number> = {
  critical: 0xE8682A,
  elevated: 0xFFB86C,
  low: 0xB4A690,
}

const LEGACY_PULSE: Record<ThreatEvent['severity'], Omit<SeverityConfig, 'color' | 'borderColor' | 'shape'>> = {
  critical: {
    baseRadius: 20,
    amplitude: 5,
    baseAlpha: 0.55,
    alphaRange: 0.25,
    cycleSeconds: 1.5,
  },
  elevated: {
    baseRadius: 14,
    amplitude: 4,
    baseAlpha: 0.4,
    alphaRange: 0.2,
    cycleSeconds: 2.0,
  },
  low: {
    baseRadius: 10,
    amplitude: 2,
    baseAlpha: 0.275,
    alphaRange: 0.125,
    cycleSeconds: 3.0,
  },
}

const TYPE_ICON: Record<string, string> = {
  support: '!',
  deals: '$',
  default: '•',
}

function getTypeIcon(event: ThreatEvent): string {
  // Prefer threat class icon when available
  if (event.threatClass) {
    return THREAT_CLASS_CONFIGS[event.threatClass].icon
  }
  return TYPE_ICON[event.type] ?? TYPE_ICON['default']
}

interface ActiveThreat {
  event: ThreatEvent
  container: Container
  shapeGfx: Graphics
  phase: number
  config: SeverityConfig
  // Pop-in / pop-out animation state
  animState: 'entering' | 'active' | 'exiting'
  animElapsed: number
}

const POP_DURATION_MS = 300

// ============================================================================
// Shape Drawing Helpers
// ============================================================================

function drawShape(g: Graphics, shape: SeverityShape, radius: number, color: number, alpha: number, borderColor: number): void {
  g.clear()

  switch (shape) {
    case 'circle':
      g.circle(0, 0, radius)
        .fill({ color, alpha })
      g.circle(0, 0, radius)
        .stroke({ color: borderColor, alpha: alpha * 0.8, width: 1.5 })
      break

    case 'triangle': {
      const h = radius * 1.3
      const halfBase = radius * 1.1
      g.moveTo(0, -h)
        .lineTo(halfBase, h * 0.6)
        .lineTo(-halfBase, h * 0.6)
        .closePath()
        .fill({ color, alpha })
      g.moveTo(0, -h)
        .lineTo(halfBase, h * 0.6)
        .lineTo(-halfBase, h * 0.6)
        .closePath()
        .stroke({ color: borderColor, alpha: alpha * 0.8, width: 1.5 })
      break
    }

    case 'diamond': {
      const dx = radius * 1.1
      const dy = radius * 1.4
      g.moveTo(0, -dy)
        .lineTo(dx, 0)
        .lineTo(0, dy)
        .lineTo(-dx, 0)
        .closePath()
        .fill({ color, alpha })
      g.moveTo(0, -dy)
        .lineTo(dx, 0)
        .lineTo(0, dy)
        .lineTo(-dx, 0)
        .closePath()
        .stroke({ color: borderColor, alpha: alpha * 0.8, width: 2 })
      break
    }

    case 'star': {
      // 6-point star for critical threats
      const outerR = radius * 1.4
      const innerR = radius * 0.65
      const points = 6
      g.moveTo(0, -outerR)
      for (let i = 0; i < points; i++) {
        const outerAngle = (Math.PI * 2 * i) / points - Math.PI / 2
        const innerAngle = outerAngle + Math.PI / points
        g.lineTo(Math.cos(outerAngle) * outerR, Math.sin(outerAngle) * outerR)
        g.lineTo(Math.cos(innerAngle) * innerR, Math.sin(innerAngle) * innerR)
      }
      g.closePath()
        .fill({ color, alpha })
      // Re-trace for stroke
      g.moveTo(0, -outerR)
      for (let i = 0; i < points; i++) {
        const outerAngle = (Math.PI * 2 * i) / points - Math.PI / 2
        const innerAngle = outerAngle + Math.PI / points
        g.lineTo(Math.cos(outerAngle) * outerR, Math.sin(outerAngle) * outerR)
        g.lineTo(Math.cos(innerAngle) * innerR, Math.sin(innerAngle) * innerR)
      }
      g.closePath()
        .stroke({ color: borderColor, alpha: alpha * 0.9, width: 2 })
      break
    }
  }

  // Outer glow ring (all shapes get a circle glow)
  g.circle(0, 0, radius + 4)
    .stroke({ color, alpha: alpha * 0.3, width: 1.5 })
}

// ============================================================================
// ThreatRenderer
// ============================================================================

export class ThreatRenderer {
  private layer: Container
  private getTerritoryCenter: TerritoryBoundsGetter
  private threats: Map<string, ActiveThreat> = new Map()
  readonly enemyAI = new EnemyAI()

  constructor(layer: Container, getTerritoryCenter: TerritoryBoundsGetter) {
    this.layer = layer
    this.getTerritoryCenter = getTerritoryCenter
  }

  /** Return positions of all active (non-exiting) threats for proximity detection */
  getThreatPositions(): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = []
    for (const threat of this.threats.values()) {
      if (threat.animState !== 'exiting') {
        positions.push({ x: threat.container.x, y: threat.container.y })
      }
    }
    return positions
  }

  addThreat(event: ThreatEvent): void {
    if (this.threats.has(event.id)) return

    const center = this.getTerritoryCenter(event.territory)
    if (!center) return

    const config = buildSeverityConfig(event)

    // Offset by index so multiple threats on same territory don't stack
    const index = this.getThreatCount(event.territory)
    const offsetX = (seededRandom(event.id, 0) - 0.5) * 300 + index * 40
    const offsetY = (seededRandom(event.id, 1) - 0.5) * 200 + index * 20

    const container = new Container()
    container.x = center.x + offsetX
    container.y = center.y + offsetY
    container.scale.set(0, 0) // Start at 0 for pop-in

    // Shape graphic (redrawn each frame for pulse)
    const shapeGfx = new Graphics()
    container.addChild(shapeGfx)

    // Icon symbol
    const icon = new Text({
      text: getTypeIcon(event),
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fill: 0xF0E4D0,
        align: 'center',
      },
    })
    icon.anchor.set(0.5)
    icon.x = 0
    icon.y = 0
    container.addChild(icon)

    // Title label above
    const titleText = event.title.length > 20 ? event.title.slice(0, 20) : event.title
    const label = new Text({
      text: titleText,
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fill: 0xB4A690,
        align: 'center',
      },
    })
    label.anchor.set(0.5, 1)
    label.x = 0
    label.y = -(config.baseRadius + config.amplitude + 4)
    container.addChild(label)

    // Threat class label below the shape
    if (event.threatClass) {
      const classConfig = THREAT_CLASS_CONFIGS[event.threatClass]
      const classLabel = new Text({
        text: classConfig.name.toUpperCase(),
        style: {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 7,
          fill: classConfig.color,
          align: 'center',
          letterSpacing: 1,
        },
      })
      classLabel.anchor.set(0.5, 0)
      classLabel.x = 0
      classLabel.y = config.baseRadius + config.amplitude + 4
      container.addChild(classLabel)
    }

    this.layer.addChild(container)

    this.threats.set(event.id, {
      event,
      container,
      shapeGfx,
      phase: 0,
      config,
      animState: 'entering',
      animElapsed: 0,
    })

    // Register with EnemyAI for behavior state machine
    this.enemyAI.addEnemy(event, container.x, container.y)
  }

  removeThreat(id: string): void {
    const threat = this.threats.get(id)
    if (!threat) return
    if (threat.animState === 'exiting') return

    threat.animState = 'exiting'
    threat.animElapsed = 0
    this.enemyAI.removeEnemy(id)
  }

  update(dt: number, unitPositions?: UnitPosition[]): void {
    const dtSeconds = dt / 1000

    // Tick enemy AI state machines (dt in seconds)
    this.enemyAI.update(dtSeconds, unitPositions ?? [])

    for (const [id, threat] of this.threats) {
      const { config } = threat

      // Apply EnemyAI position to the visual container
      const enemyState = this.enemyAI.getEnemy(id)
      if (enemyState) {
        threat.container.x = enemyState.x
        threat.container.y = enemyState.y
      }

      // Handle pop-in / pop-out (counter-scale Y for isometric tilt)
      const isoY = 1 / ISO_TILT
      if (threat.animState === 'entering') {
        threat.animElapsed += dt
        const progress = Math.min(threat.animElapsed / POP_DURATION_MS, 1)
        const s = easeOut(progress)
        threat.container.scale.set(s, s * isoY)
        if (progress >= 1) {
          threat.container.scale.set(1, isoY)
          threat.animState = 'active'
        }
      } else if (threat.animState === 'exiting') {
        threat.animElapsed += dt
        const progress = Math.min(threat.animElapsed / POP_DURATION_MS, 1)
        const s = 1 - easeOut(progress)
        threat.container.scale.set(s, s * isoY)
        if (progress >= 1) {
          this.layer.removeChild(threat.container)
          threat.container.destroy({ children: true })
          this.threats.delete(id)
          continue
        }
      }

      // Advance phase
      const speed = 1 / config.cycleSeconds
      threat.phase += dtSeconds * speed * Math.PI * 2

      // Compute current radius and alpha
      const sinVal = Math.sin(threat.phase)
      const radius = config.baseRadius + config.amplitude * sinVal
      const alpha = config.baseAlpha + config.alphaRange * sinVal

      // Redraw shape with class-aware colors and severity-driven geometry
      drawShape(threat.shapeGfx, config.shape, radius, config.color, alpha, config.borderColor)
    }
  }

  getThreatCount(territory: string): number {
    let count = 0
    for (const threat of this.threats.values()) {
      if (
        threat.event.territory === territory &&
        threat.animState !== 'exiting'
      ) {
        count++
      }
    }
    return count
  }

  destroy(): void {
    for (const threat of this.threats.values()) {
      this.layer.removeChild(threat.container)
      threat.container.destroy({ children: true })
    }
    this.threats.clear()
  }
}

// Deterministic pseudo-random from a string seed + index
function seededRandom(seed: string, index: number): number {
  let hash = index * 2654435761
  for (let i = 0; i < seed.length; i++) {
    hash = (hash ^ seed.charCodeAt(i)) * 2246822519
    hash = hash >>> 0
  }
  return (hash >>> 0) / 0xffffffff
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
