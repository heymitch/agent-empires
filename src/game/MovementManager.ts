/**
 * MovementManager - Handles smooth unit movement along A* hex paths
 *
 * When a unit needs to move to a new territory, this manager:
 * 1. Computes an A* path through the hex grid (HexPathfinder)
 * 2. Walks the unit sprite along waypoints with smooth interpolation
 * 3. Sets status to 'marching' during movement
 * 4. Leaves a particle trail
 * 5. Restores previous status on arrival
 * 6. Draws a faint dotted path line showing remaining route
 */

import { Graphics } from 'pixi.js'
import type { TerritoryId } from '../renderer/TerritoryRenderer'
import type { BattlefieldRenderer } from '../renderer/BattlefieldRenderer'
import type { GameState, GameUnitStatus } from './GameState'
import { HexPathfinder } from './HexPathfinder'

interface ActiveMovement {
  sessionId: string
  /** Starting world position (exact, before first waypoint) */
  startX: number
  startY: number
  /** Full path of world-space waypoints */
  waypoints: { x: number; y: number }[]
  /** Index of the waypoint we're currently heading toward */
  currentWaypointIndex: number
  /** Progress [0..1] between current and next waypoint */
  segmentProgress: number
  previousStatus: GameUnitStatus
  trailTimer: number
}

const TRAIL_INTERVAL = 0.08   // seconds between trail particles
const MAX_STEP_DURATION = 0.8 // cap for long segments
const MIN_STEP_DURATION = 0.2 // floor for short segments
const PIXELS_PER_SECOND = 200 // base movement speed

export class MovementManager {
  private movements: Map<string, ActiveMovement> = new Map()
  private gameState: GameState
  private battlefield: BattlefieldRenderer
  private pathfinder: HexPathfinder
  private pathGraphics: Graphics

  constructor(gameState: GameState, battlefield: BattlefieldRenderer) {
    this.gameState = gameState
    this.battlefield = battlefield
    this.pathfinder = new HexPathfinder()

    // Initialize pathfinder with territory polygons
    const territories = battlefield.terrainRenderer.getAllTerritories()
    this.pathfinder.setTerritories(territories)

    // Create a persistent Graphics object for path lines on the effects layer
    this.pathGraphics = new Graphics()
    battlefield.getEffectsLayer().addChild(this.pathGraphics)
  }

  /**
   * Start moving a unit to a new territory.
   * Computes A* path and begins waypoint animation.
   */
  moveToTerritory(sessionId: string, territory: TerritoryId): void {
    const unit = this.gameState.getUnit(sessionId)
    if (!unit) return

    // If already moving, cancel current movement
    this.movements.delete(sessionId)

    // Get target position from territory center with jitter
    const center = this.battlefield.terrainRenderer.getTerritoryCenter(territory)
    const jitterX = (Math.random() - 0.5) * 120
    const jitterY = (Math.random() - 0.5) * 120
    const targetX = center.x + jitterX
    const targetY = center.y + jitterY

    // Compute A* path
    const waypoints = this.pathfinder.findPath(
      unit.position.x, unit.position.y,
      targetX, targetY
    )

    if (waypoints.length === 0) return

    // Store previous status to restore on arrival
    const previousStatus = unit.status === 'marching' ? 'idle' : unit.status

    const movement: ActiveMovement = {
      sessionId,
      startX: unit.position.x,
      startY: unit.position.y,
      waypoints,
      currentWaypointIndex: 0,
      segmentProgress: 0,
      previousStatus,
      trailTimer: 0,
    }

    this.movements.set(sessionId, movement)

    // Update game state
    this.gameState.updateUnitTerritory(sessionId, territory)
    this.gameState.updateUnitStatus(sessionId, 'marching', unit.currentTool)
    this.gameState.setTargetPosition(sessionId, targetX, targetY)

    // Update renderer unit territory
    const rendererUnit = this.battlefield.getUnit(sessionId)
    if (rendererUnit) {
      rendererUnit.territory = territory
    }
  }

  /**
   * Update all active movements. Call from animation loop.
   * Returns true if any movement was updated (for re-render hints).
   */
  update(dt: number): boolean {
    if (this.movements.size === 0) return false

    let anyUpdated = false
    const completed: string[] = []

    for (const [sessionId, movement] of this.movements) {
      const { waypoints } = movement
      const idx = movement.currentWaypointIndex

      if (idx >= waypoints.length) {
        completed.push(sessionId)
        anyUpdated = true
        continue
      }

      // Segment endpoints
      const from = idx === 0
        ? { x: movement.startX, y: movement.startY }
        : waypoints[idx - 1]
      const to = waypoints[idx]

      // Step duration proportional to segment distance
      const segDist = Math.hypot(to.x - from.x, to.y - from.y)
      const stepDuration = Math.max(MIN_STEP_DURATION,
        Math.min(MAX_STEP_DURATION, segDist / PIXELS_PER_SECOND))

      movement.segmentProgress += dt / stepDuration

      if (movement.segmentProgress >= 1) {
        // Snap to current waypoint and advance
        this._updateUnitPosition(sessionId, to.x, to.y)
        movement.segmentProgress = 0
        movement.currentWaypointIndex++

        if (movement.currentWaypointIndex >= waypoints.length) {
          completed.push(sessionId)
          anyUpdated = true
          continue
        }
      }

      // Smooth interpolation within the current segment
      const t = Math.min(1, movement.segmentProgress)
      // Ease-in-out quadratic for smooth stepping
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

      const x = from.x + (to.x - from.x) * eased
      const y = from.y + (to.y - from.y) * eased

      this._updateUnitPosition(sessionId, x, y)

      // Trail particles
      movement.trailTimer += dt
      if (movement.trailTimer >= TRAIL_INTERVAL) {
        movement.trailTimer = 0
        this.battlefield.particleSystem.sparkle(x, y, 0x00ffcc)
      }

      anyUpdated = true
    }

    // Clean up completed movements
    for (const sessionId of completed) {
      const movement = this.movements.get(sessionId)!
      this.movements.delete(sessionId)

      // Restore previous status
      const unit = this.gameState.getUnit(sessionId)
      if (unit) {
        this.gameState.updateUnitStatus(sessionId, movement.previousStatus, unit.currentTool)
        this.gameState.clearTargetPosition(sessionId)
      }

      // Small arrival burst
      const finalWp = movement.waypoints[movement.waypoints.length - 1]
      this.battlefield.particleSystem.burst(finalWp.x, finalWp.y, 0x00ffcc, 6)
    }

    // Draw path lines for active movements
    this._drawPaths()

    return anyUpdated
  }

  /**
   * Check if a unit is currently moving
   */
  isMoving(sessionId: string): boolean {
    return this.movements.has(sessionId)
  }

  /**
   * Cancel movement for a unit (snap to current interpolated position)
   */
  cancelMovement(sessionId: string): void {
    this.movements.delete(sessionId)
    this.gameState.clearTargetPosition(sessionId)
  }

  /**
   * Get the remaining path for a unit (for external rendering if needed)
   */
  getRemainingPath(sessionId: string): { x: number; y: number }[] | null {
    const movement = this.movements.get(sessionId)
    if (!movement) return null
    return movement.waypoints.slice(movement.currentWaypointIndex)
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _updateUnitPosition(sessionId: string, x: number, y: number): void {
    this.gameState.updateUnitPosition(sessionId, x, y)
    const rendererUnit = this.battlefield.getUnit(sessionId)
    if (rendererUnit) {
      rendererUnit.setPosition(x, y)
    }
  }

  /**
   * Draw faint dotted lines showing remaining paths for moving units.
   * Uses a persistent Graphics object on the effects layer, cleared + redrawn each frame.
   */
  private _drawPaths(): void {
    this.pathGraphics.clear()

    if (this.movements.size === 0) return

    for (const [_sessionId, movement] of this.movements) {
      const { waypoints, currentWaypointIndex } = movement
      if (currentWaypointIndex >= waypoints.length - 1) continue

      // Draw dotted line segments along remaining path
      const DOT_LENGTH = 8
      const GAP_LENGTH = 12
      const CYCLE = DOT_LENGTH + GAP_LENGTH

      for (let i = currentWaypointIndex; i < waypoints.length - 1; i++) {
        const a = waypoints[i]
        const b = waypoints[i + 1]
        const segDist = Math.hypot(b.x - a.x, b.y - a.y)
        if (segDist < 1) continue

        const dx = (b.x - a.x) / segDist
        const dy = (b.y - a.y) / segDist

        let d = 0
        while (d < segDist) {
          const dotEnd = Math.min(d + DOT_LENGTH, segDist)
          const x1 = a.x + dx * d
          const y1 = a.y + dy * d
          const x2 = a.x + dx * dotEnd
          const y2 = a.y + dy * dotEnd

          this.pathGraphics.moveTo(x1, y1)
          this.pathGraphics.lineTo(x2, y2)

          d += CYCLE
        }
      }

      this.pathGraphics.stroke({ color: 0x4A9DB8, width: 1.5, alpha: 0.35 })
    }
  }
}
