/**
 * GameState - Central state manager for all units, territories, and status
 *
 * Single source of truth for the game layer. Renderers read from here.
 */

import type { TerritoryId } from '../renderer/TerritoryRenderer'
import type { ManagedSession } from '../../shared/types'

export type GameUnitStatus = 'idle' | 'marching' | 'working' | 'thinking' | 'combat' | 'exhausted' | 'offline'

export interface UnitState {
  sessionId: string
  name: string
  territory: TerritoryId
  status: GameUnitStatus
  position: { x: number; y: number }
  targetPosition?: { x: number; y: number }
  healthPercent: number
  currentTool?: string
  selected: boolean
  lastActivity: number
}

export class GameState {
  private units: Map<string, UnitState> = new Map()
  private listeners: Set<() => void> = new Set()

  addUnit(session: ManagedSession): UnitState {
    const name = session.name || session.cwd?.split('/').pop() || session.id.slice(0, 8)
    const state: UnitState = {
      sessionId: session.id,
      name,
      territory: 'hq',
      status: 'idle',
      position: { x: 0, y: 0 },
      healthPercent: 100,
      selected: false,
      lastActivity: Date.now(),
    }
    this.units.set(session.id, state)
    this.notify()
    return state
  }

  removeUnit(sessionId: string): void {
    this.units.delete(sessionId)
    this.notify()
  }

  updateUnitTerritory(sessionId: string, territory: TerritoryId): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    if (unit.territory === territory) return
    unit.territory = territory
    this.notify()
  }

  updateUnitStatus(sessionId: string, status: GameUnitStatus, tool?: string): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    unit.status = status
    unit.currentTool = tool
    unit.lastActivity = Date.now()
    this.notify()
  }

  updateUnitHealth(sessionId: string, healthPercent: number): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    unit.healthPercent = Math.max(0, Math.min(100, healthPercent))
  }

  updateUnitPosition(sessionId: string, x: number, y: number): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    unit.position.x = x
    unit.position.y = y
  }

  setTargetPosition(sessionId: string, x: number, y: number): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    unit.targetPosition = { x, y }
  }

  clearTargetPosition(sessionId: string): void {
    const unit = this.units.get(sessionId)
    if (!unit) return
    unit.targetPosition = undefined
  }

  getUnit(sessionId: string): UnitState | undefined {
    return this.units.get(sessionId)
  }

  getAllUnits(): IterableIterator<UnitState> {
    return this.units.values()
  }

  getUnitCount(): number {
    return this.units.size
  }

  selectUnit(sessionId: string): void {
    // Deselect all first
    for (const unit of this.units.values()) {
      unit.selected = false
    }
    const unit = this.units.get(sessionId)
    if (unit) {
      unit.selected = true
    }
    this.notify()
  }

  deselectAll(): void {
    for (const unit of this.units.values()) {
      unit.selected = false
    }
    this.notify()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (e) {
        console.error('[GameState] Listener error:', e)
      }
    }
  }
}
