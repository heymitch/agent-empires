import { Container, Graphics, Text } from 'pixi.js'
import { ISO_TILT } from './constants'

export interface ThreatEvent {
  id: string
  type: string
  severity: 'low' | 'elevated' | 'critical'
  territory: string
  title: string
  description: string
  timestamp: number
}

export type TerritoryBoundsGetter = (territory: string) => { x: number; y: number } | null

interface SeverityConfig {
  color: number
  baseRadius: number
  amplitude: number
  baseAlpha: number
  alphaRange: number
  cycleSeconds: number
}

const SEVERITY_CONFIG: Record<ThreatEvent['severity'], SeverityConfig> = {
  critical: {
    color: 0xE8682A,     // warm orange
    baseRadius: 20,
    amplitude: 5,
    baseAlpha: 0.55,
    alphaRange: 0.25,
    cycleSeconds: 1.5,
  },
  elevated: {
    color: 0xFFB86C,     // amber
    baseRadius: 14,
    amplitude: 4,
    baseAlpha: 0.4,
    alphaRange: 0.2,
    cycleSeconds: 2.0,
  },
  low: {
    color: 0xB4A690,     // cream-dim
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

function getTypeIcon(type: string): string {
  return TYPE_ICON[type] ?? TYPE_ICON['default']
}

interface ActiveThreat {
  event: ThreatEvent
  container: Container
  circle: Graphics
  phase: number
  config: SeverityConfig
  // Pop-in / pop-out animation state
  animState: 'entering' | 'active' | 'exiting'
  animElapsed: number
}

const POP_DURATION_MS = 300

export class ThreatRenderer {
  private layer: Container
  private getTerritoryCenter: TerritoryBoundsGetter
  private threats: Map<string, ActiveThreat> = new Map()

  constructor(layer: Container, getTerritoryCenter: TerritoryBoundsGetter) {
    this.layer = layer
    this.getTerritoryCenter = getTerritoryCenter
  }

  addThreat(event: ThreatEvent): void {
    if (this.threats.has(event.id)) return

    const center = this.getTerritoryCenter(event.territory)
    if (!center) return

    const config = SEVERITY_CONFIG[event.severity]

    // Offset by index so multiple threats on same territory don't stack
    const index = this.getThreatCount(event.territory)
    const offsetX = (seededRandom(event.id, 0) - 0.5) * 300 + index * 40
    const offsetY = (seededRandom(event.id, 1) - 0.5) * 200 + index * 20

    const container = new Container()
    container.x = center.x + offsetX
    container.y = center.y + offsetY
    container.scale.set(0, 0) // Start at 0 for pop-in

    // Pulsing circle (redrawn each frame)
    const circle = new Graphics()
    container.addChild(circle)

    // Icon symbol
    const icon = new Text({
      text: getTypeIcon(event.type),
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

    this.layer.addChild(container)

    this.threats.set(event.id, {
      event,
      container,
      circle,
      phase: 0,
      config,
      animState: 'entering',
      animElapsed: 0,
    })
  }

  removeThreat(id: string): void {
    const threat = this.threats.get(id)
    if (!threat) return
    if (threat.animState === 'exiting') return

    threat.animState = 'exiting'
    threat.animElapsed = 0
  }

  update(dt: number): void {
    const dtSeconds = dt / 1000

    for (const [id, threat] of this.threats) {
      const { config } = threat

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

      // Redraw circle
      threat.circle.clear()
      threat.circle
        .circle(0, 0, radius)
        .fill({ color: config.color, alpha })

      // Outer glow ring (subtle)
      threat.circle
        .circle(0, 0, radius + 4)
        .stroke({ color: config.color, alpha: alpha * 0.3, width: 1.5 })
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
