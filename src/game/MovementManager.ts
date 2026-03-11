/**
 * MovementManager - Handles smooth unit movement between territories
 *
 * When a unit needs to move to a new territory, this manager:
 * 1. Calculates a target position within the destination territory
 * 2. Lerps the unit sprite from current to target over ~2 seconds
 * 3. Sets status to 'marching' during movement
 * 4. Leaves a particle trail
 * 5. Restores previous status on arrival
 */

import type { TerritoryId } from '../renderer/TerritoryRenderer'
import type { BattlefieldRenderer } from '../renderer/BattlefieldRenderer'
import type { GameState, GameUnitStatus } from './GameState'

interface ActiveMovement {
  sessionId: string
  startX: number
  startY: number
  targetX: number
  targetY: number
  elapsed: number
  duration: number
  previousStatus: GameUnitStatus
  trailTimer: number
}

const MOVEMENT_DURATION = 2.0 // seconds
const TRAIL_INTERVAL = 0.08 // seconds between trail particles

export class MovementManager {
  private movements: Map<string, ActiveMovement> = new Map()
  private gameState: GameState
  private battlefield: BattlefieldRenderer

  constructor(gameState: GameState, battlefield: BattlefieldRenderer) {
    this.gameState = gameState
    this.battlefield = battlefield
  }

  /**
   * Start moving a unit to a new territory.
   * Calculates target position from territory center + random offset.
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

    // Store previous status to restore on arrival
    const previousStatus = unit.status === 'marching' ? 'idle' : unit.status

    // Create movement record
    const movement: ActiveMovement = {
      sessionId,
      startX: unit.position.x,
      startY: unit.position.y,
      targetX,
      targetY,
      elapsed: 0,
      duration: MOVEMENT_DURATION,
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
      movement.elapsed += dt
      const t = Math.min(1, movement.elapsed / movement.duration)

      // Ease-in-out cubic
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2

      // Interpolate position
      const x = movement.startX + (movement.targetX - movement.startX) * eased
      const y = movement.startY + (movement.targetY - movement.startY) * eased

      // Update positions
      this.gameState.updateUnitPosition(sessionId, x, y)
      const rendererUnit = this.battlefield.getUnit(sessionId)
      if (rendererUnit) {
        rendererUnit.setPosition(x, y)
      }

      // Trail particles
      movement.trailTimer += dt
      if (movement.trailTimer >= TRAIL_INTERVAL) {
        movement.trailTimer = 0
        this.battlefield.particleSystem.sparkle(x, y, 0x00ffcc)
      }

      anyUpdated = true

      if (t >= 1) {
        completed.push(sessionId)
      }
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
      this.battlefield.particleSystem.burst(movement.targetX, movement.targetY, 0x00ffcc, 6)
    }

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
}
