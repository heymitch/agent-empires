/**
 * BattlefieldRenderer - Main PixiJS renderer for Agent Empires
 *
 * Creates the battlefield canvas, manages camera (pan/zoom),
 * and organizes rendering layers.
 */

import { Application, Container, Graphics } from 'pixi.js'
import { TerrainRenderer, type TerritoryId } from './TerrainRenderer'
import { UnitRenderer, type UnitStatus } from './UnitRenderer'
import { getZoomVisibility } from './ZoomController'
import { FogOfWar } from './FogOfWar'
import { MinimapRenderer } from './MinimapRenderer'
import { ParticleSystem } from './ParticleSystem'
import { WORLD_WIDTH, WORLD_HEIGHT, ISO_TILT } from './constants'

export { WORLD_WIDTH, WORLD_HEIGHT }

export class BattlefieldRenderer {
  app: Application
  private container: HTMLElement

  // Camera state
  private worldContainer!: Container
  private cameraX = WORLD_WIDTH / 2
  private cameraY = WORLD_HEIGHT / 2
  private zoom = 0.5
  private minZoom = 0.15
  private maxZoom = 2.0

  // Pan state
  private isPanning = false
  private panStartX = 0
  private panStartY = 0
  private panStartCamX = 0
  private panStartCamY = 0

  // Layers
  private backgroundLayer!: Container
  private territoryLayer!: Container
  private fogLayer!: Container
  private unitLayer!: Container
  private effectsLayer!: Container

  // Sub-renderers
  terrainRenderer!: TerrainRenderer
  fogOfWar!: FogOfWar
  minimapRenderer!: MinimapRenderer
  particleSystem!: ParticleSystem

  // Road layer — supply chain visualization between territories
  roadLayer!: Container

  // Connection line layer — draws parent-child lines (between territory and unit layers)
  connectionLayer!: Container

  // Threat layer — exposed so main.ts can add ThreatRenderer to it
  threatLayer!: Container

  // Production chain layer — Factorio-style overlay between units and effects
  productionLayer!: Container

  // Unit tracking
  private units: Map<string, UnitRenderer> = new Map()

  // Unit click callback
  onUnitClick: ((unitId: string, screenX: number, screenY: number) => void) | null = null
  private unitClickedThisFrame = false

  // Activity glow throttle
  private activityUpdateTimer = 0
  private activityUpdateInterval = 0.5 // seconds

  constructor(container: HTMLElement) {
    this.app = new Application()
    this.container = container
  }

  async init(): Promise<void> {
    await this.app.init({
      background: 0x16120E,
      resizeTo: this.container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    this.container.appendChild(this.app.canvas)

    // World container holds everything that moves with the camera
    this.worldContainer = new Container()
    this.app.stage.addChild(this.worldContainer)

    // Create layers in draw order
    this.backgroundLayer = new Container()
    this.territoryLayer = new Container()
    this.roadLayer = new Container()
    this.connectionLayer = new Container()
    this.fogLayer = new Container()
    this.unitLayer = new Container()
    this.effectsLayer = new Container()
    this.threatLayer = new Container()
    this.productionLayer = new Container()

    this.worldContainer.addChild(this.backgroundLayer)
    this.worldContainer.addChild(this.territoryLayer)
    this.worldContainer.addChild(this.roadLayer)
    this.worldContainer.addChild(this.connectionLayer)
    this.worldContainer.addChild(this.fogLayer)
    this.worldContainer.addChild(this.unitLayer)
    this.worldContainer.addChild(this.productionLayer)
    this.worldContainer.addChild(this.effectsLayer)
    this.worldContainer.addChild(this.threatLayer)

    // Draw background grid
    this.drawBackground()

    // Initialize sub-renderers
    this.terrainRenderer = new TerrainRenderer(this.app, this.territoryLayer)

    this.fogOfWar = new FogOfWar(this.app)
    this.fogOfWar.init(this.fogLayer, WORLD_WIDTH, WORLD_HEIGHT)

    this.particleSystem = new ParticleSystem(this.effectsLayer)

    // Minimap
    this.minimapRenderer = new MinimapRenderer(
      this,
      this.units,
      (x, y) => this.jumpToPosition(x, y)
    )

    // Input handlers
    this.setupInputHandlers()

    // Render loop
    this.app.ticker.add(() => this.update())

    // Center camera
    this.updateCamera()
  }

  private drawBackground(): void {
    const bg = new Graphics()

    // Subtle grid lines
    bg.setStrokeStyle({ width: 1, color: 0x2A2520, alpha: 0.3 })
    const gridSize = 100
    for (let x = 0; x <= WORLD_WIDTH; x += gridSize) {
      bg.moveTo(x, 0)
      bg.lineTo(x, WORLD_HEIGHT)
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += gridSize) {
      bg.moveTo(0, y)
      bg.lineTo(WORLD_WIDTH, y)
    }
    bg.stroke()

    this.backgroundLayer.addChild(bg)
  }

  private setupInputHandlers(): void {
    const canvas = this.app.canvas as HTMLCanvasElement

    // Pan with middle mouse or right mouse drag
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1 || e.button === 2) {
        e.preventDefault()
        this.isPanning = true
        this.panStartX = e.clientX
        this.panStartY = e.clientY
        this.panStartCamX = this.cameraX
        this.panStartCamY = this.cameraY
      }
    })

    // Also pan with left mouse on background (skip if unit was clicked)
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) {
        // PixiJS pointerdown fires before DOM mousedown, so check the flag
        if (this.unitClickedThisFrame) {
          this.unitClickedThisFrame = false
          return
        }
        this.isPanning = true
        this.panStartX = e.clientX
        this.panStartY = e.clientY
        this.panStartCamX = this.cameraX
        this.panStartCamY = this.cameraY
      }
    })

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isPanning) {
        const dx = (e.clientX - this.panStartX) / this.zoom
        const dy = (e.clientY - this.panStartY) / (this.zoom * ISO_TILT)
        this.cameraX = this.panStartCamX - dx
        this.cameraY = this.panStartCamY - dy
        this.updateCamera()
      }
    })

    window.addEventListener('mouseup', () => {
      this.isPanning = false
    })

    // Zoom with scroll wheel
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault()
      const zoomSpeed = 0.001
      const delta = -e.deltaY * zoomSpeed
      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * (1 + delta * 3)))
      this.zoom = newZoom
      this.updateCamera()
    }, { passive: false })

    // Prevent context menu
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private updateCamera(): void {
    const screenW = this.app.screen.width
    const screenH = this.app.screen.height

    // 3/4 isometric: full X scale, foreshortened Y
    const zoomX = this.zoom
    const zoomY = this.zoom * ISO_TILT
    this.worldContainer.scale.set(zoomX, zoomY)
    this.worldContainer.x = screenW / 2 - this.cameraX * zoomX
    this.worldContainer.y = screenH / 2 - this.cameraY * zoomY

    // Update minimap viewport
    if (this.minimapRenderer) {
      this.minimapRenderer.updateViewport(
        this.cameraX, this.cameraY,
        screenW / zoomX, screenH / zoomY
      )
    }
  }

  jumpToPosition(worldX: number, worldY: number): void {
    this.cameraX = worldX
    this.cameraY = worldY
    this.updateCamera()
  }

  private update(): void {
    // Update particle system
    this.particleSystem.update(this.app.ticker.deltaMS / 1000)

    // Update unit animations + zoom-adaptive labels with semantic visibility
    const visibility = getZoomVisibility(this.zoom)
    for (const unit of this.units.values()) {
      unit.update(this.app.ticker.deltaMS / 1000)
      unit.setZoomScale(this.zoom, visibility)
    }

    // Fog of war — tuned to 45% dark (atmospheric, not blinding), 500px visibility radius
    const unitPositions = Array.from(this.units.values())
      .filter(u => u.status !== 'offline')
      .map(u => ({ x: u.worldX, y: u.worldY }))
    this.fogOfWar.update(unitPositions, new Map())

    // Update territory activity glow (throttled to every 500ms)
    const dtSec = this.app.ticker.deltaMS / 1000
    this.activityUpdateTimer += dtSec
    if (this.activityUpdateTimer >= this.activityUpdateInterval) {
      this.activityUpdateTimer = 0
      this.computeTerritoryActivity()
    }

    // Update terrain (animated flow lines, pulsing borders)
    this.terrainRenderer.draw(this.app.ticker.deltaMS / 1000)

    // Update minimap
    this.minimapRenderer.update()
  }

  /** Count working/combat units per territory and set activity glow levels. */
  private computeTerritoryActivity(): void {
    const counts = new Map<TerritoryId, number>()

    for (const unit of this.units.values()) {
      if (unit.status === 'working' || unit.status === 'combat') {
        counts.set(unit.territory, (counts.get(unit.territory) ?? 0) + 1)
      }
    }

    const territories = this.terrainRenderer.getAllTerritories()
    for (const def of territories) {
      const id = def.id as TerritoryId
      const count = counts.get(id) ?? 0
      let level = 0
      if (count >= 6) level = 3
      else if (count >= 3) level = 2
      else if (count >= 1) level = 1
      this.terrainRenderer.setTerritoryActivity(id, level)
    }
  }

  // === Unit Management ===

  addUnit(id: string, name: string, territory: TerritoryId = 'hq'): UnitRenderer {
    const pos = this.terrainRenderer.getTerritoryCenter(territory)
    const unit = new UnitRenderer(id, name, territory)
    // Spread units in a circle around territory center so they don't stack
    const offset = this.getUnitSpreadOffset(territory)
    unit.setPosition(pos.x + offset.x, pos.y + offset.y)
    this.unitLayer.addChild(unit.container)
    this.units.set(id, unit)

    // Click detection on unit
    unit.container.on('pointerdown', (e) => {
      e.stopPropagation()
      this.unitClickedThisFrame = true
      if (this.onUnitClick) {
        const screenPos = this.getUnitScreenPosition(id)
        if (screenPos) {
          this.onUnitClick(id, screenPos.x, screenPos.y)
        }
      }
    })

    return unit
  }

  removeUnit(id: string): void {
    const unit = this.units.get(id)
    if (unit) {
      this.unitLayer.removeChild(unit.container)
      unit.destroy()
      this.units.delete(id)
    }
  }

  getUnit(id: string): UnitRenderer | undefined {
    return this.units.get(id)
  }

  /** Expose the effects layer for path line rendering */
  getEffectsLayer(): Container {
    return this.effectsLayer
  }

  getAllUnits(): Map<string, UnitRenderer> {
    return this.units
  }

  moveUnit(id: string, territory: TerritoryId): void {
    const unit = this.units.get(id)
    if (unit) {
      const pos = this.terrainRenderer.getTerritoryCenter(territory)
      const offset = this.getUnitSpreadOffset(territory)
      unit.setPosition(pos.x + offset.x, pos.y + offset.y)
      unit.territory = territory
    }
  }

  /** Spread units in a circle around territory center — 200px radius, evenly spaced */
  private getUnitSpreadOffset(territory: TerritoryId): { x: number; y: number } {
    // Count how many units are already in this territory
    let count = 0
    for (const u of this.units.values()) {
      if (u.territory === territory) count++
    }
    if (count === 0) return { x: 0, y: 0 }
    // Place on a circle, spacing by golden angle for nice distribution
    const radius = 400 + Math.floor(count / 6) * 200 // expand ring every 6 units
    const angle = count * 2.399963 // golden angle in radians
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    }
  }

  getUnitScreenPosition(unitId: string): { x: number; y: number } | null {
    const unit = this.units.get(unitId)
    if (!unit) return null
    return {
      x: unit.worldX * this.zoom + this.worldContainer.x,
      y: unit.worldY * (this.zoom * ISO_TILT) + this.worldContainer.y,
    }
  }

  getWorldPosition(screenX: number, screenY: number): { x: number; y: number } {
    const x = (screenX - this.worldContainer.x) / this.zoom
    const y = (screenY - this.worldContainer.y) / (this.zoom * ISO_TILT)
    return { x, y }
  }

  getCameraInfo() {
    return {
      x: this.cameraX,
      y: this.cameraY,
      zoom: this.zoom,
      screenW: this.app.screen.width,
      screenH: this.app.screen.height,
    }
  }

  destroy(): void {
    this.minimapRenderer.destroy()
    this.app.destroy(true)
  }
}
