/**
 * ControlGroupManager - Starcraft-style Ctrl+1-9 control groups
 *
 * Groups persist across page reloads via localStorage.
 * Each group stores an array of unit (session) IDs.
 */

const STORAGE_KEY = 'agent-empires-control-groups'

export class ControlGroupManager {
  private groups: Map<number, string[]> = new Map()

  constructor() {
    this.load()
  }

  saveGroup(groupNumber: number, unitIds: string[]): void {
    this.groups.set(groupNumber, [...unitIds])
    this.persist()
  }

  recallGroup(groupNumber: number): string[] {
    return this.groups.get(groupNumber) ?? []
  }

  clearGroup(groupNumber: number): void {
    this.groups.delete(groupNumber)
    this.persist()
  }

  /** Returns which group number contains this unit, or null if none. */
  getGroupForUnit(unitId: string): number | null {
    for (const [group, ids] of this.groups) {
      if (ids.includes(unitId)) return group
    }
    return null
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persist(): void {
    try {
      const obj: Record<string, string[]> = {}
      for (const [k, v] of this.groups) {
        obj[String(k)] = v
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // Storage unavailable — not a fatal error
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, string[]>
      for (const [k, v] of Object.entries(obj)) {
        const n = parseInt(k, 10)
        if (n >= 1 && n <= 9 && Array.isArray(v)) {
          this.groups.set(n, v)
        }
      }
    } catch {
      // Corrupt storage — start fresh
    }
  }
}
