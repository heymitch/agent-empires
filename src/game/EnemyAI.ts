/**
 * EnemyAI — Behavior state machines for enemy threats
 *
 * Three behavior states:
 *   DRIFT   — slow random movement, changes heading every 3-5s (default)
 *   SIEGE   — moves toward nearest unit, triggered within 300px proximity
 *   PATROL  — circuits territory borders, for critical-severity threats
 *
 * Reference: prd/02b-enemy-system-spec.md § Behavior State Machines
 */

import type { ThreatClass } from '../../shared/threatClasses'

// ============================================================================
// Types
// ============================================================================

export type BehaviorState = 'DRIFT' | 'SIEGE' | 'PATROL'

export interface EnemyState {
  id: string
  x: number
  y: number
  threatClass?: ThreatClass
  behaviorState: BehaviorState
  velocity: { x: number; y: number }
  targetUnitId?: string

  // Internal state
  /** Time remaining before next heading change (DRIFT) */
  headingTimer: number
  /** Current angle in radians (DRIFT / PATROL) */
  heading: number
  /** Patrol angle around territory center (PATROL) */
  patrolAngle: number
  /** Spawn position — used as orbit center for PATROL */
  spawnX: number
  spawnY: number
}

export interface UnitPosition {
  id: string
  x: number
  y: number
}

// ============================================================================
// Constants
// ============================================================================

/** Movement speeds in pixels per second */
const SPEED: Record<BehaviorState, number> = {
  DRIFT: 20,
  SIEGE: 40,
  PATROL: 30,
}

/** Distance threshold (px) for DRIFT → SIEGE transition */
const SIEGE_ENGAGE_RANGE = 300

/** Distance threshold (px) for SIEGE → DRIFT (no units nearby) */
const SIEGE_DISENGAGE_RANGE = 400

/** Min/max seconds between heading changes in DRIFT */
const DRIFT_HEADING_MIN = 3
const DRIFT_HEADING_MAX = 5

/** Radius of the PATROL orbit (px) */
const PATROL_RADIUS = 120

/** Angular speed for PATROL (radians/s) — full circle in ~25s */
const PATROL_ANGULAR_SPEED = (2 * Math.PI) / 25

// ============================================================================
// EnemyAI
// ============================================================================

export class EnemyAI {
  private enemies: Map<string, EnemyState> = new Map()

  /** Create an enemy from a threat event and place it at the given position */
  addEnemy(threat: { id: string; severity: string; threatClass?: ThreatClass }, x: number, y: number): void {
    if (this.enemies.has(threat.id)) return

    const isCritical = threat.severity === 'critical'

    const initialState: BehaviorState = isCritical ? 'PATROL' : 'DRIFT'
    const heading = Math.random() * Math.PI * 2

    this.enemies.set(threat.id, {
      id: threat.id,
      x,
      y,
      threatClass: threat.threatClass,
      behaviorState: initialState,
      velocity: { x: 0, y: 0 },
      headingTimer: randomBetween(DRIFT_HEADING_MIN, DRIFT_HEADING_MAX),
      heading,
      patrolAngle: 0,
      spawnX: x,
      spawnY: y,
    })
  }

  removeEnemy(id: string): void {
    this.enemies.delete(id)
  }

  getEnemy(id: string): EnemyState | undefined {
    return this.enemies.get(id)
  }

  getAllEnemies(): IterableIterator<EnemyState> {
    return this.enemies.values()
  }

  /**
   * Advance all enemies by dt seconds.
   * unitPositions: current positions of player units (for SIEGE targeting).
   */
  update(dt: number, unitPositions: UnitPosition[]): void {
    for (const enemy of this.enemies.values()) {
      // --- State transitions ---
      this.evaluateTransitions(enemy, unitPositions)

      // --- Movement per state ---
      switch (enemy.behaviorState) {
        case 'DRIFT':
          this.updateDrift(enemy, dt)
          break
        case 'SIEGE':
          this.updateSiege(enemy, dt, unitPositions)
          break
        case 'PATROL':
          this.updatePatrol(enemy, dt)
          break
      }
    }
  }

  // --------------------------------------------------------------------------
  // State transitions
  // --------------------------------------------------------------------------

  private evaluateTransitions(enemy: EnemyState, unitPositions: UnitPosition[]): void {
    const nearest = this.findNearestUnit(enemy, unitPositions)

    switch (enemy.behaviorState) {
      case 'DRIFT': {
        // DRIFT → SIEGE when a unit is within engage range
        if (nearest && nearest.dist < SIEGE_ENGAGE_RANGE) {
          enemy.behaviorState = 'SIEGE'
          enemy.targetUnitId = nearest.id
        }
        break
      }
      case 'SIEGE': {
        // SIEGE → DRIFT when no units are within disengage range
        if (!nearest || nearest.dist > SIEGE_DISENGAGE_RANGE) {
          enemy.behaviorState = 'DRIFT'
          enemy.targetUnitId = undefined
          enemy.headingTimer = randomBetween(DRIFT_HEADING_MIN, DRIFT_HEADING_MAX)
          enemy.heading = Math.random() * Math.PI * 2
        } else {
          // Re-target nearest (it may have changed)
          enemy.targetUnitId = nearest.id
        }
        break
      }
      case 'PATROL': {
        // PATROL stays in PATROL — critical threats don't downgrade
        // But they will target the nearest unit for facing direction
        if (nearest && nearest.dist < SIEGE_ENGAGE_RANGE) {
          enemy.targetUnitId = nearest.id
        } else {
          enemy.targetUnitId = undefined
        }
        break
      }
    }
  }

  // --------------------------------------------------------------------------
  // Per-state movement
  // --------------------------------------------------------------------------

  private updateDrift(enemy: EnemyState, dt: number): void {
    // Count down heading timer
    enemy.headingTimer -= dt
    if (enemy.headingTimer <= 0) {
      enemy.heading = Math.random() * Math.PI * 2
      enemy.headingTimer = randomBetween(DRIFT_HEADING_MIN, DRIFT_HEADING_MAX)
    }

    const speed = SPEED.DRIFT
    enemy.velocity.x = Math.cos(enemy.heading) * speed
    enemy.velocity.y = Math.sin(enemy.heading) * speed

    enemy.x += enemy.velocity.x * dt
    enemy.y += enemy.velocity.y * dt
  }

  private updateSiege(enemy: EnemyState, dt: number, unitPositions: UnitPosition[]): void {
    const target = unitPositions.find((u) => u.id === enemy.targetUnitId)
    if (!target) {
      // Target gone — fall back to drift
      enemy.behaviorState = 'DRIFT'
      enemy.targetUnitId = undefined
      enemy.headingTimer = randomBetween(DRIFT_HEADING_MIN, DRIFT_HEADING_MAX)
      return
    }

    const dx = target.x - enemy.x
    const dy = target.y - enemy.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 1) return // Close enough, don't jitter

    const speed = SPEED.SIEGE
    const nx = dx / dist
    const ny = dy / dist

    enemy.velocity.x = nx * speed
    enemy.velocity.y = ny * speed

    enemy.x += enemy.velocity.x * dt
    enemy.y += enemy.velocity.y * dt
    enemy.heading = Math.atan2(ny, nx)
  }

  private updatePatrol(enemy: EnemyState, dt: number): void {
    // Orbit around spawn point
    enemy.patrolAngle += PATROL_ANGULAR_SPEED * dt

    const targetX = enemy.spawnX + Math.cos(enemy.patrolAngle) * PATROL_RADIUS
    const targetY = enemy.spawnY + Math.sin(enemy.patrolAngle) * PATROL_RADIUS

    const dx = targetX - enemy.x
    const dy = targetY - enemy.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    const speed = SPEED.PATROL
    if (dist < 1) {
      enemy.velocity.x = 0
      enemy.velocity.y = 0
      return
    }

    const nx = dx / dist
    const ny = dy / dist

    // Clamp to not overshoot
    const step = Math.min(speed * dt, dist)
    enemy.velocity.x = nx * speed
    enemy.velocity.y = ny * speed

    enemy.x += nx * step
    enemy.y += ny * step
    enemy.heading = Math.atan2(ny, nx)
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private findNearestUnit(
    enemy: EnemyState,
    unitPositions: UnitPosition[],
  ): { id: string; dist: number } | null {
    let best: { id: string; dist: number } | null = null

    for (const unit of unitPositions) {
      const dx = unit.x - enemy.x
      const dy = unit.y - enemy.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (!best || dist < best.dist) {
        best = { id: unit.id, dist }
      }
    }

    return best
  }
}

// ============================================================================
// Utility
// ============================================================================

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
