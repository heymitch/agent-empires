import type { TerritoryId } from '../renderer/TerrainRenderer'

export interface TerritoryState {
  lastUnitPresence: number
  unitCount: number
  threatLevel: 'none' | 'low' | 'elevated' | 'critical'
  threatCount: number
  fogState: 'visible' | 'stale' | 'dark'
  activityCount: number
}

type ChangeHandler = (territory: TerritoryId, state: TerritoryState) => void

const TERRITORY_IDS: TerritoryId[] = [
  'lead-gen',
  'content',
  'sales',
  'fulfillment',
  'support',
  'retention',
  'hq',
]

// Fog thresholds in milliseconds (default: visible <2min, stale 2-5min, dark >=5min)
const DEFAULT_VISIBLE_THRESHOLD = 2 * 60 * 1000   // 120s
const DEFAULT_DARK_THRESHOLD = 5 * 60 * 1000       // 300s

// support: 1.5x faster (thresholds: 80s / 200s)
const SUPPORT_VISIBLE_THRESHOLD = 80 * 1000
const SUPPORT_DARK_THRESHOLD = 200 * 1000

// hq: 0.5x slower (thresholds: 240s / 600s)
const HQ_VISIBLE_THRESHOLD = 240 * 1000
const HQ_DARK_THRESHOLD = 600 * 1000

const ACTIVITY_WINDOW = 5 * 60 * 1000 // 5 minutes in ms

const SEVERITY_ORDER: TerritoryState['threatLevel'][] = ['none', 'low', 'elevated', 'critical']

function severityToLevel(severity: string): TerritoryState['threatLevel'] {
  if (severity === 'critical') return 'critical'
  if (severity === 'elevated') return 'elevated'
  if (severity === 'low') return 'low'
  return 'none'
}

function compareSeverity(
  a: TerritoryState['threatLevel'],
  b: TerritoryState['threatLevel'],
): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b)
}

function createDefaultState(): TerritoryState {
  return {
    lastUnitPresence: 0,
    unitCount: 0,
    threatLevel: 'none',
    threatCount: 0,
    fogState: 'dark',
    activityCount: 0,
  }
}

function statesEqual(a: TerritoryState, b: TerritoryState): boolean {
  return (
    a.fogState === b.fogState &&
    a.threatLevel === b.threatLevel &&
    a.unitCount === b.unitCount &&
    a.threatCount === b.threatCount &&
    a.activityCount === b.activityCount &&
    a.lastUnitPresence === b.lastUnitPresence
  )
}

function getFogThresholds(territory: TerritoryId): { visible: number; dark: number } {
  if (territory === 'support') {
    return { visible: SUPPORT_VISIBLE_THRESHOLD, dark: SUPPORT_DARK_THRESHOLD }
  }
  if (territory === 'hq') {
    return { visible: HQ_VISIBLE_THRESHOLD, dark: HQ_DARK_THRESHOLD }
  }
  return { visible: DEFAULT_VISIBLE_THRESHOLD, dark: DEFAULT_DARK_THRESHOLD }
}

function computeFogState(
  state: TerritoryState,
  now: number,
  territory: TerritoryId,
): TerritoryState['fogState'] {
  if (state.unitCount > 0) return 'visible'
  if (state.lastUnitPresence === 0) return 'dark'

  const elapsed = now - state.lastUnitPresence
  const thresholds = getFogThresholds(territory)

  if (elapsed < thresholds.visible) return 'visible'
  if (elapsed < thresholds.dark) return 'stale'
  return 'dark'
}

export class TerritoryStateManager {
  private states: Map<TerritoryId, TerritoryState> = new Map()
  private activityTimestamps: Map<TerritoryId, number[]> = new Map()
  private activeThreatSeverities: Map<TerritoryId, TerritoryState['threatLevel'][]> = new Map()
  private changeHandlers: Set<ChangeHandler> = new Set()

  constructor() {
    for (const id of TERRITORY_IDS) {
      this.states.set(id, createDefaultState())
      this.activityTimestamps.set(id, [])
      this.activeThreatSeverities.set(id, [])
    }
  }

  unitEnteredTerritory(unitId: string, territory: TerritoryId): void {
    const state = this.states.get(territory)
    if (!state) return

    const prev = { ...state }
    state.unitCount = Math.max(0, state.unitCount) + 1
    state.lastUnitPresence = Date.now()
    state.fogState = computeFogState(state, Date.now(), territory)

    if (!statesEqual(prev, state)) {
      this.emit(territory, state)
    }
  }

  unitLeftTerritory(unitId: string, territory: TerritoryId): void {
    const state = this.states.get(territory)
    if (!state) return

    const prev = { ...state }
    state.unitCount = Math.max(0, state.unitCount - 1)

    // lastUnitPresence stays as the most recent timestamp; fog timer starts from here
    // If no units remain, fog will start regressing on next tick
    state.fogState = computeFogState(state, Date.now(), territory)

    if (!statesEqual(prev, state)) {
      this.emit(territory, state)
    }
  }

  addThreat(territory: TerritoryId, severity: string): void {
    const state = this.states.get(territory)
    const severities = this.activeThreatSeverities.get(territory)
    if (!state || !severities) return

    const prev = { ...state }
    const level = severityToLevel(severity)
    severities.push(level)
    state.threatCount = severities.length
    state.threatLevel = this.computeHighestSeverity(severities)

    if (!statesEqual(prev, state)) {
      this.emit(territory, state)
    }
  }

  removeThreat(territory: TerritoryId): void {
    const state = this.states.get(territory)
    const severities = this.activeThreatSeverities.get(territory)
    if (!state || !severities) return

    const prev = { ...state }
    if (severities.length > 0) {
      severities.pop()
    }
    state.threatCount = severities.length
    state.threatLevel = this.computeHighestSeverity(severities)

    if (!statesEqual(prev, state)) {
      this.emit(territory, state)
    }
  }

  recordActivity(territory: TerritoryId): void {
    const timestamps = this.activityTimestamps.get(territory)
    const state = this.states.get(territory)
    if (!timestamps || !state) return

    const now = Date.now()
    timestamps.push(now)

    const prev = { ...state }
    const cutoff = now - ACTIVITY_WINDOW
    const filtered = timestamps.filter(t => t >= cutoff)
    this.activityTimestamps.set(territory, filtered)
    state.activityCount = filtered.length

    if (!statesEqual(prev, state)) {
      this.emit(territory, state)
    }
  }

  tick(): void {
    const now = Date.now()
    const cutoff = now - ACTIVITY_WINDOW

    for (const id of TERRITORY_IDS) {
      const state = this.states.get(id)
      const timestamps = this.activityTimestamps.get(id)
      if (!state || !timestamps) continue

      const prev = { ...state }

      // Recompute fog state
      state.fogState = computeFogState(state, now, id)

      // Decay activity count using rolling window
      const filtered = timestamps.filter(t => t >= cutoff)
      this.activityTimestamps.set(id, filtered)
      state.activityCount = filtered.length

      if (!statesEqual(prev, state)) {
        this.emit(id, state)
      }
    }
  }

  getState(territory: TerritoryId): TerritoryState {
    const state = this.states.get(territory)
    if (!state) {
      return createDefaultState()
    }
    return { ...state }
  }

  getAllStates(): Map<TerritoryId, TerritoryState> {
    const result = new Map<TerritoryId, TerritoryState>()
    for (const [id, state] of this.states) {
      result.set(id, { ...state })
    }
    return result
  }

  onChange(handler: ChangeHandler): () => void {
    this.changeHandlers.add(handler)
    return () => {
      this.changeHandlers.delete(handler)
    }
  }

  private emit(territory: TerritoryId, state: TerritoryState): void {
    const snapshot = { ...state }
    for (const handler of this.changeHandlers) {
      handler(territory, snapshot)
    }
  }

  private computeHighestSeverity(
    severities: TerritoryState['threatLevel'][],
  ): TerritoryState['threatLevel'] {
    if (severities.length === 0) return 'none'
    return severities.reduce((highest, current) =>
      compareSeverity(current, highest) > 0 ? current : highest,
    )
  }
}
