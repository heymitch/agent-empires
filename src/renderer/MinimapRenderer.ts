/**
 * MinimapRenderer - Small overview map in bottom-left
 *
 * Shows territories as colored blobs, units as bright dots,
 * and the camera viewport as a white rectangle.
 */

import { Application, Container, Graphics } from 'pixi.js'
import type { BattlefieldRenderer } from './BattlefieldRenderer'
import type { UnitRenderer } from './UnitRenderer'
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants'

const MINIMAP_WIDTH = 200
const MINIMAP_HEIGHT = 150
const SCALE_X = MINIMAP_WIDTH / WORLD_WIDTH
const SCALE_Y = MINIMAP_HEIGHT / WORLD_HEIGHT

const TERRITORY_MINIMAP: { x: number; y: number; w: number; h: number; color: number }[] = [
  { x: 1400, y: 50, w: 1200, h: 500, color: 0x2a4a3a },   // lead-gen
  { x: 400, y: 700, w: 800, h: 600, color: 0x2a3a4a },     // content
  { x: 1700, y: 700, w: 600, h: 600, color: 0x4a3a2a },    // sales
  { x: 2800, y: 700, w: 800, h: 600, color: 0x3a2a4a },    // fulfillment
  { x: 1600, y: 1400, w: 800, h: 400, color: 0x4a2a2a },   // support
  { x: 1600, y: 1900, w: 800, h: 400, color: 0x2a2a4a },   // retention
  { x: 1700, y: 2400, w: 600, h: 400, color: 0x3a3a3a },   // hq
]

export class MinimapRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private battlefield: BattlefieldRenderer
  private units: Map<string, UnitRenderer>
  private onJump: (x: number, y: number) => void

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

    // Territories
    for (const t of TERRITORY_MINIMAP) {
      ctx.fillStyle = this.hexToRgba(t.color, 0.3)
      ctx.fillRect(t.x * SCALE_X, t.y * SCALE_Y, t.w * SCALE_X, t.h * SCALE_Y)
    }

    // Units as bright dots
    for (const unit of this.units.values()) {
      const sx = unit.worldX * SCALE_X
      const sy = unit.worldY * SCALE_Y
      ctx.fillStyle = unit.status === 'offline' ? '#ff3366' : '#00ffcc'
      ctx.beginPath()
      ctx.arc(sx, sy, 3, 0, Math.PI * 2)
      ctx.fill()
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
