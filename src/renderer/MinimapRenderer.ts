/**
 * MinimapRenderer - Small overview map in bottom-left
 *
 * Shows territories as filled polygons with borders, units as status-colored
 * dots sized by class, threat markers as red triangles, and the camera
 * viewport as a white rectangle.
 */

import { Application, Container, Graphics } from 'pixi.js'
import type { BattlefieldRenderer } from './BattlefieldRenderer'
import type { UnitRenderer, UnitStatus, UnitClass } from './UnitRenderer'
import type { TerrainRenderer } from './TerrainRenderer'
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants'

const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
const SCALE_X = MINIMAP_WIDTH / WORLD_WIDTH
const SCALE_Y = MINIMAP_HEIGHT / WORLD_HEIGHT

// Status colors for unit dots on the minimap
const MINIMAP_STATUS_COLORS: Record<UnitStatus, string> = {
  idle:      '#82C896',
  working:   '#E8682A',
  combat:    '#CC3333',
  thinking:  '#4A9DB8',
  exhausted: '#8B7355',
  offline:   '#666666',
}

// Unit dot radius by class
const MINIMAP_DOT_SIZE: Record<UnitClass, number> = {
  recon:      3,
  operations: 4,
  command:    5,
}

export class MinimapRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private battlefield: BattlefieldRenderer
  private units: Map<string, UnitRenderer>
  private onJump: (x: number, y: number) => void
  private getThreatPositions: (() => Array<{ x: number; y: number }>) | null = null

  // Viewport rect
  private vpX = 0
  private vpY = 0
  private vpW = 0
  private vpH = 0

  constructor(
    battlefield: BattlefieldRenderer,
    units: Map<string, UnitRenderer>,
    onJump: (x: number, y: number) => void
  ) {
    this.battlefield = battlefield
    this.units = units
    this.onJump = onJump

    // Create a simple canvas for the minimap (separate from PixiJS)
    this.canvas = document.createElement('canvas')
    this.canvas.width = MINIMAP_WIDTH
    this.canvas.height = MINIMAP_HEIGHT
    this.canvas.className = 'minimap-canvas'
    this.ctx = this.canvas.getContext('2d')!

    const minimapContainer = document.getElementById('minimap-container')
    if (minimapContainer) {
      minimapContainer.appendChild(this.canvas)
    }

    // Click to jump
    this.canvas.addEventListener('click', (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const worldX = mx / SCALE_X
      const worldY = my / SCALE_Y
      this.onJump(worldX, worldY)
    })
  }

  /** Wire up threat position getter (called from main.ts after ThreatRenderer is created) */
  setThreatPositionGetter(getter: () => Array<{ x: number; y: number }>): void {
    this.getThreatPositions = getter
  }

  updateViewport(camX: number, camY: number, viewW: number, viewH: number): void {
    this.vpX = (camX - viewW / 2) * SCALE_X
    this.vpY = (camY - viewH / 2) * SCALE_Y
    this.vpW = viewW * SCALE_X
    this.vpH = viewH * SCALE_Y
  }

  update(): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)

    // Background (matches magnetic residue deep tone)
    ctx.fillStyle = '#16120E'
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)

    // Territory fills and borders from TerrainRenderer polygon data
    const terrainRenderer = this.battlefield.terrainRenderer
    if (terrainRenderer) {
      const territories = terrainRenderer.getAllTerritories()
      for (const def of territories) {
        const poly = def.polygon
        if (poly.length < 4) continue

        // Build scaled path
        ctx.beginPath()
        ctx.moveTo(poly[0] * SCALE_X, poly[1] * SCALE_Y)
        for (let i = 2; i < poly.length; i += 2) {
          ctx.lineTo(poly[i] * SCALE_X, poly[i + 1] * SCALE_Y)
        }
        ctx.closePath()

        // Filled polygon at low alpha
        ctx.fillStyle = this.hexToRgba(def.baseColor, 0.2)
        ctx.fill()

        // Thin border at slightly higher alpha
        ctx.strokeStyle = this.hexToRgba(def.baseColor, 0.4)
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // Units as status-colored dots sized by class
    for (const unit of this.units.values()) {
      const sx = unit.worldX * SCALE_X
      const sy = unit.worldY * SCALE_Y
      const color = MINIMAP_STATUS_COLORS[unit.status] || '#666666'
      const radius = MINIMAP_DOT_SIZE[unit.unitClass] || 4

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(sx, sy, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    // Threat dots as tiny red triangles
    if (this.getThreatPositions) {
      const threats = this.getThreatPositions()
      ctx.fillStyle = '#CC3333'
      for (const t of threats) {
        const sx = t.x * SCALE_X
        const sy = t.y * SCALE_Y
        const s = 3 // triangle half-size
        ctx.beginPath()
        ctx.moveTo(sx, sy - s)
        ctx.lineTo(sx + s, sy + s)
        ctx.lineTo(sx - s, sy + s)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Viewport rectangle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(this.vpX, this.vpY, this.vpW, this.vpH)
  }

  private hexToRgba(hex: number, alpha: number): string {
    const r = (hex >> 16) & 0xff
    const g = (hex >> 8) & 0xff
    const b = hex & 0xff
    return `rgba(${r},${g},${b},${alpha})`
  }

  destroy(): void {
    this.canvas.remove()
  }
}
