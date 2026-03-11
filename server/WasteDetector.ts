/**
 * WasteDetector — PRD 13, Section 6: Downstream Consumer Detection
 *
 * Runs on a configurable interval (default 60s) and detects three types of waste:
 *   1. Dead roads — roads with 0 packets/hour that previously had traffic
 *   2. Orphan units — sessions producing output with no downstream consumers
 *   3. High rejection — roads where >50% of packets are rejected (stubbed until
 *      ae_handoffs rejection tracking is built)
 *
 * Dependency-injected: takes getRoads() and getSessions() functions,
 * same pattern as MonitorOrchestrator.
 */

import type { ServerMessage, ManagedSession } from '../shared/types.js'

// Re-use RoadData shape from RoadAggregator (avoid cross-import of class)
export interface RoadData {
  fromTerritory: string
  toTerritory: string
  packetCount: number
  roadLevel: number
  lastPacketAt: string | null
  packetsPerHour: number
  queueDepth: number
}

// ─── Waste Report ────────────────────────────────────────────────────────────

export interface WasteReport {
  /** Road keys (from::to) with 0 packets/hour but historical traffic */
  deadRoads: string[]
  /** Session IDs that produce output but have no outgoing roads with traffic */
  orphanUnits: string[]
  /** Road keys where >50% of packets are rejected (stubbed) */
  highRejection: string[]
  /** ISO timestamp of when this report was generated */
  generatedAt: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

type BroadcastFn = (message: ServerMessage) => void
type RoadProvider = () => RoadData[]
type SessionProvider = () => ManagedSession[]

export interface WasteDetectorConfig {
  getRoads: RoadProvider
  getSessions: SessionProvider
  broadcast: BroadcastFn
  /** Detection interval in ms (default 60000) */
  intervalMs?: number
}

// ─── WasteDetector ───────────────────────────────────────────────────────────

export class WasteDetector {
  private getRoads: RoadProvider
  private getSessions: SessionProvider
  private broadcast: BroadcastFn
  private intervalMs: number

  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastReport: WasteReport = {
    deadRoads: [],
    orphanUnits: [],
    highRejection: [],
    generatedAt: new Date().toISOString(),
  }

  constructor(config: WasteDetectorConfig) {
    this.getRoads = config.getRoads
    this.getSessions = config.getSessions
    this.broadcast = config.broadcast
    this.intervalMs = config.intervalMs ?? 60_000
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) {
      console.log('[WasteDetector] Already running — ignoring start()')
      return
    }
    this.running = true
    console.log(`[WasteDetector] Starting — detection interval ${this.intervalMs}ms`)
    this.detect()
    this.timer = setInterval(() => this.detect(), this.intervalMs)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[WasteDetector] Stopped')
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getWasteReport(): WasteReport {
    return this.lastReport
  }

  // ── Detection cycle ───────────────────────────────────────────────────────

  private detect(): void {
    try {
      const roads = this.getRoads()
      const sessions = this.getSessions()

      const deadRoads = this.findDeadRoads(roads)
      const orphanUnits = this.findOrphanUnits(roads, sessions)
      const highRejection = this.findHighRejection(roads)

      this.lastReport = {
        deadRoads,
        orphanUnits,
        highRejection,
        generatedAt: new Date().toISOString(),
      }

      // Broadcast to all connected clients
      this.broadcast({
        type: 'waste_report',
        payload: this.lastReport,
      } as ServerMessage)

      const total = deadRoads.length + orphanUnits.length + highRejection.length
      if (total > 0) {
        console.log(
          `[WasteDetector] Report: ${deadRoads.length} dead roads, ` +
          `${orphanUnits.length} orphan units, ${highRejection.length} high rejection`
        )
      }
    } catch (err) {
      console.error('[WasteDetector] Detection error (will retry):', err)
    }
  }

  // ── Dead roads ────────────────────────────────────────────────────────────
  // Roads with packetsPerHour === 0 that previously had traffic (packetCount > 0)

  private findDeadRoads(roads: RoadData[]): string[] {
    const dead: string[] = []
    for (const road of roads) {
      if (road.packetCount > 0 && road.packetsPerHour === 0) {
        dead.push(`${road.fromTerritory}::${road.toTerritory}`)
      }
    }
    return dead
  }

  // ── Orphan units (no-consumer sessions) ───────────────────────────────────
  // Sessions that exist but have no outgoing roads with active traffic.
  // A session's territory is derived from its name or cwd; we match against
  // road fromTerritory values.

  private findOrphanUnits(roads: RoadData[], sessions: ManagedSession[]): string[] {
    // Build set of territories that have active outgoing traffic
    const territoriesWithOutgoing = new Set<string>()
    for (const road of roads) {
      if (road.packetsPerHour > 0) {
        territoriesWithOutgoing.add(road.fromTerritory)
      }
    }

    // Build set of territories that appear as source on ANY road (even dead ones)
    const territoriesOnAnyRoad = new Set<string>()
    for (const road of roads) {
      territoriesOnAnyRoad.add(road.fromTerritory)
      territoriesOnAnyRoad.add(road.toTerritory)
    }

    const orphans: string[] = []
    for (const session of sessions) {
      // Only check sessions that are actively working (not idle/offline)
      if (session.status === 'offline' || session.status === 'idle') continue

      // A session is an orphan if it's on a territory that has roads
      // but none of its outgoing roads have active traffic
      const sessionTerritory = this.inferTerritory(session)
      if (!sessionTerritory) continue

      // If this territory has roads but no active outgoing traffic, it's orphaned
      if (territoriesOnAnyRoad.has(sessionTerritory) && !territoriesWithOutgoing.has(sessionTerritory)) {
        orphans.push(session.id)
      }
    }
    return orphans
  }

  // ── High rejection ────────────────────────────────────────────────────────
  // Stub: when ae_handoffs has rejection tracking, this will check
  // roads where >50% of packets have status 'rejected'.
  // For now, returns empty array.

  private findHighRejection(_roads: RoadData[]): string[] {
    // TODO: Implement when ae_handoffs rejection tracking is available.
    // Will query ae_handoffs WHERE status = 'rejected' grouped by road key,
    // compare against total handoffs per road, flag roads with >50% rejection.
    return []
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private inferTerritory(session: ManagedSession): string | null {
    // Match session name to known territory names (case-insensitive)
    const name = session.name.toLowerCase()
    const territories = ['hq', 'lead-gen', 'sales', 'fulfillment', 'support', 'retention', 'content']
    for (const t of territories) {
      if (name.includes(t)) return t
    }
    // Fallback: check cwd for territory hints
    if (session.cwd) {
      const cwd = session.cwd.toLowerCase()
      for (const t of territories) {
        if (cwd.includes(t)) return t
      }
    }
    return null
  }
}
