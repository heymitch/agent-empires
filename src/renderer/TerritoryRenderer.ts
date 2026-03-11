/**
 * TerritoryRenderer - Renders the 6 business territories + HQ as polygon regions
 */

import { Container, Graphics, Text, TextStyle } from 'pixi.js'

export type TerritoryId = 'lead-gen' | 'content' | 'sales' | 'fulfillment' | 'support' | 'retention' | 'hq'

export interface TerritoryDef {
  id: TerritoryId
  label: string
  color: number
  center: { x: number; y: number }
  /** Polygon points relative to center */
  points: number[]
}

const TERRITORY_DEFS: TerritoryDef[] = [
  {
    id: 'lead-gen',
    label: 'LEAD GEN',
    color: 0x2a4a3a,
    center: { x: 2000, y: 300 },
    points: [-600, -200, -400, -250, 0, -250, 400, -250, 600, -200, 550, 200, -550, 200],
  },
  {
    id: 'content',
    label: 'CONTENT',
    color: 0x2a3a4a,
    center: { x: 800, y: 1000 },
    points: [-400, -300, 0, -300, 400, -250, 380, 300, -50, 300, -400, 250],
  },
  {
    id: 'sales',
    label: 'SALES',
    color: 0x4a3a2a,
    center: { x: 2000, y: 1000 },
    points: [-300, -300, 300, -300, 280, 300, -280, 300],
  },
  {
    id: 'fulfillment',
    label: 'FULFILLMENT',
    color: 0x3a2a4a,
    center: { x: 3200, y: 1000 },
    points: [-400, -300, 50, -300, 400, -250, 380, 300, -380, 300],
  },
  {
    id: 'support',
    label: 'SUPPORT',
    color: 0x4a2a2a,
    center: { x: 2000, y: 1600 },
    points: [-400, -200, 400, -200, 380, 200, -380, 200],
  },
  {
    id: 'retention',
    label: 'RETENTION',
    color: 0x2a2a4a,
    center: { x: 2000, y: 2100 },
    points: [-400, -200, 400, -200, 350, 200, -350, 200],
  },
  {
    id: 'hq',
    label: 'HQ',
    color: 0x3a3a3a,
    center: { x: 2000, y: 2600 },
    points: [-300, -200, 300, -200, 280, 200, -280, 200],
  },
]

export class TerritoryRenderer {
  private layer: Container
  private territories: Map<TerritoryId, TerritoryDef> = new Map()

  constructor(layer: Container) {
    this.layer = layer
    for (const def of TERRITORY_DEFS) {
      this.territories.set(def.id, def)
    }
  }

  draw(): void {
    for (const def of TERRITORY_DEFS) {
      this.drawTerritory(def)
    }
  }

  private drawTerritory(def: TerritoryDef): void {
    const g = new Graphics()
    const { center, points, color } = def

    // Build absolute polygon points
    const absPoints: { x: number; y: number }[] = []
    for (let i = 0; i < points.length; i += 2) {
      absPoints.push({ x: center.x + points[i], y: center.y + points[i + 1] })
    }

    // Fill - 15% opacity
    g.poly(absPoints.map(p => [p.x, p.y]).flat())
    g.fill({ color, alpha: 0.15 })

    // Border - 40% opacity, soft glow effect via double stroke
    g.poly(absPoints.map(p => [p.x, p.y]).flat())
    g.stroke({ width: 4, color, alpha: 0.2 })

    g.poly(absPoints.map(p => [p.x, p.y]).flat())
    g.stroke({ width: 2, color, alpha: 0.4 })

    this.layer.addChild(g)

    // Label
    const labelStyle = new TextStyle({
      fontFamily: 'Orbitron, monospace',
      fontSize: 16,
      fill: color,
      letterSpacing: 4,
      align: 'center',
    })
    const label = new Text({ text: def.label, style: labelStyle })
    label.anchor.set(0.5, 0.5)
    label.x = center.x
    label.y = center.y
    label.alpha = 0.6
    this.layer.addChild(label)
  }

  getTerritoryCenter(id: TerritoryId): { x: number; y: number } {
    const def = this.territories.get(id)
    return def ? { ...def.center } : { x: 2000, y: 2600 }
  }

  getTerritoryColor(id: TerritoryId): number {
    const def = this.territories.get(id)
    return def ? def.color : 0x3a3a3a
  }

  getAllTerritories(): TerritoryDef[] {
    return TERRITORY_DEFS
  }
}
