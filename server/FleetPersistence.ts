/**
 * FleetPersistence — Saves/restores battlefield state to Supabase.
 *
 * Uses a singleton row in ae_fleet_state to snapshot sessions, roads,
 * objectives, and threats every 60s. On server boot, loads the last
 * snapshot and broadcasts it as fleet_restore so clients see the
 * battlefield immediately.
 *
 * Same raw fetch + Supabase REST pattern as ObjectiveManager.
 */

export interface FleetSnapshot {
  sessions: unknown[]
  roads: unknown[]
  objectives: unknown[]
  threats: unknown[]
  updated_at?: string
}

type GetStateFn = () => FleetSnapshot
type BroadcastFn = (type: string, payload: unknown) => void

export class FleetPersistence {
  private url: string
  private key: string
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private getState: GetStateFn | null = null
  private broadcastFn: BroadcastFn | null = null

  constructor(config: { supabaseUrl: string; supabaseKey: string; intervalMs?: number }) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey
    this.intervalMs = config.intervalMs ?? 60_000
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn
  }

  // ── Headers ──────────────────────────────────────────────────────────────

  private headers(prefer?: string): Record<string, string> {
    const h: Record<string, string> = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
    }
    if (prefer) h['Prefer'] = prefer
    return h
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async saveState(snapshot: FleetSnapshot): Promise<boolean> {
    try {
      const body = {
        id: 'singleton',
        sessions: snapshot.sessions,
        roads: snapshot.roads,
        objectives: snapshot.objectives,
        threats: snapshot.threats,
        updated_at: new Date().toISOString(),
      }

      // Upsert — insert or update on conflict
      const res = await fetch(`${this.url}/rest/v1/ae_fleet_state`, {
        method: 'POST',
        headers: this.headers('resolution=merge-duplicates'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        console.log(`[FleetPersistence] SAVE failed (${res.status}): ${await res.text()}`)
        return false
      }

      console.log(`[FleetPersistence] State saved (${snapshot.sessions.length} sessions, ${snapshot.roads.length} roads, ${snapshot.objectives.length} objectives, ${snapshot.threats.length} threats)`)
      return true
    } catch (err) {
      console.log('[FleetPersistence] SAVE error:', err)
      return false
    }
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  async loadState(): Promise<FleetSnapshot | null> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_fleet_state?id=eq.singleton&select=*`,
        { headers: this.headers() }
      )

      if (!res.ok) {
        console.log(`[FleetPersistence] LOAD failed (${res.status})`)
        return null
      }

      const rows = await res.json() as FleetSnapshot[]
      if (!rows.length) {
        console.log('[FleetPersistence] No saved state found')
        return null
      }

      const row = rows[0]
      console.log(`[FleetPersistence] State loaded (${(row.sessions as unknown[]).length} sessions, ${(row.roads as unknown[]).length} roads, ${(row.objectives as unknown[]).length} objectives, ${(row.threats as unknown[]).length} threats)`)
      return row
    } catch (err) {
      console.log('[FleetPersistence] LOAD error:', err)
      return null
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(getState: GetStateFn): void {
    if (this.timer) {
      console.log('[FleetPersistence] Already running — ignoring start()')
      return
    }

    this.getState = getState

    // Save on interval
    this.timer = setInterval(() => {
      if (this.getState) {
        this.saveState(this.getState())
      }
    }, this.intervalMs)

    console.log(`[FleetPersistence] Auto-save started (${this.intervalMs / 1000}s interval)`)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.getState = null
      console.log('[FleetPersistence] Auto-save stopped')
    }
  }

  // ── Boot restore ─────────────────────────────────────────────────────────

  async restoreAndBroadcast(): Promise<FleetSnapshot | null> {
    const state = await this.loadState()
    if (state && this.broadcastFn) {
      this.broadcastFn('fleet_restore', state)
      console.log('[FleetPersistence] Broadcast fleet_restore to clients')
    }
    return state
  }
}
