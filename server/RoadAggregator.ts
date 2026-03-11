/**
 * RoadAggregator
 * Polls ae_events and aggregates territory-transition patterns into ae_roads.
 * Uses Node.js built-in fetch (Node 18+) — no SDK required.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RoadData {
  fromTerritory: string
  toTerritory: string
  packetCount: number
  roadLevel: number
  lastPacketAt: string | null
}

export interface RoadAggregatorConfig {
  supabaseUrl: string
  supabaseKey: string
  pollInterval?: number // default 60000
  onRoadsUpdated: (roads: RoadData[]) => void
}

interface AeEvent {
  id: string
  session_id: string
  territory: string
  event_type: string
  created_at: string
}

// ─── Road level thresholds ──────────────────────────────────────────────────────

function computeRoadLevel(packetCount: number): number {
  if (packetCount <= 0) return 0
  if (packetCount <= 5) return 1
  if (packetCount <= 15) return 2
  if (packetCount <= 30) return 3
  if (packetCount <= 60) return 4
  return 5
}

// ─── RoadAggregator ─────────────────────────────────────────────────────────────

export class RoadAggregator {
  private supabaseUrl: string
  private supabaseKey: string
  private pollInterval: number
  private onRoadsUpdated: (roads: RoadData[]) => void

  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: RoadAggregatorConfig) {
    this.supabaseUrl = config.supabaseUrl
    this.supabaseKey = config.supabaseKey
    this.pollInterval = config.pollInterval ?? 60000
    this.onRoadsUpdated = config.onRoadsUpdated
  }

  start(): void {
    if (this.timer !== null) {
      console.log('[RoadAggregator] Already running — ignoring start()')
      return
    }
    console.log(`[RoadAggregator] Starting — poll interval ${this.pollInterval}ms`)
    this.poll()
    this.timer = setInterval(() => this.poll(), this.pollInterval)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[RoadAggregator] Stopped')
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    }
  }

  private headersWithReturn(): Record<string, string> {
    return {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    }
  }

  private async fetchTable<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
    const url = `${this.supabaseUrl}/rest/v1/${table}?${query}`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${table}: ${await res.text()}`)
    }
    return res.json() as Promise<T[]>
  }

  private async upsertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return
    const url = `${this.supabaseUrl}/rest/v1/${table}`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headersWithReturn(),
      body: JSON.stringify(rows),
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} upserting ${table}: ${await res.text()}`)
    }
  }

  // ── Start of current day (UTC) ──────────────────────────────────────────────

  private dayStart(): string {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    return start.toISOString()
  }

  // ── Poll cycle ──────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const roads = await this.aggregateRoads()
      await this.persistRoads(roads)
      this.onRoadsUpdated(roads)
    } catch (err) {
      console.log('[RoadAggregator] Poll error (will retry):', err)
    }
  }

  // ── Aggregation logic ───────────────────────────────────────────────────────

  private async aggregateRoads(): Promise<RoadData[]> {
    const periodStart = this.dayStart()

    // Fetch all events from today, ordered by session and time
    const events = await this.fetchTable<AeEvent>(
      'ae_events',
      `created_at=gte.${encodeURIComponent(periodStart)}&order=session_id.asc,created_at.asc&select=id,session_id,territory,event_type,created_at`
    )

    // Group events by session
    const sessionEvents = new Map<string, AeEvent[]>()
    for (const ev of events) {
      if (!ev.territory) continue
      const list = sessionEvents.get(ev.session_id) ?? []
      list.push(ev)
      sessionEvents.set(ev.session_id, list)
    }

    // Count territory-transition packets per (from, to) pair
    const pairCounts = new Map<string, { count: number; lastAt: string | null }>()

    for (const [, evts] of sessionEvents) {
      // Find territory transitions within this session
      let prevTerritory: string | null = null
      for (const ev of evts) {
        if (prevTerritory !== null && ev.territory !== prevTerritory) {
          // Territory transition detected
          const key = `${prevTerritory}::${ev.territory}`
          const existing = pairCounts.get(key) ?? { count: 0, lastAt: null }
          existing.count += 1
          existing.lastAt = ev.created_at
          pairCounts.set(key, existing)
        }
        prevTerritory = ev.territory
      }

      // Also count tool_call events per territory pair:
      // If a session has events in multiple territories, each tool_call adds traffic
      const territoriesInSession = new Set<string>()
      for (const ev of evts) {
        territoriesInSession.add(ev.territory)
      }

      if (territoriesInSession.size > 1) {
        const toolCalls = evts.filter(e => e.event_type === 'tool_call')
        const territoryList = Array.from(territoriesInSession).sort()

        // For each pair of territories active in this session,
        // add tool_call count as additional road traffic
        for (let i = 0; i < territoryList.length; i++) {
          for (let j = i + 1; j < territoryList.length; j++) {
            const key = `${territoryList[i]}::${territoryList[j]}`
            const existing = pairCounts.get(key) ?? { count: 0, lastAt: null }
            existing.count += toolCalls.length
            if (toolCalls.length > 0) {
              const lastToolCall = toolCalls[toolCalls.length - 1].created_at
              if (!existing.lastAt || lastToolCall > existing.lastAt) {
                existing.lastAt = lastToolCall
              }
            }
            pairCounts.set(key, existing)
          }
        }
      }
    }

    // Convert to RoadData array
    const roads: RoadData[] = []
    for (const [key, data] of pairCounts) {
      const [from, to] = key.split('::')
      roads.push({
        fromTerritory: from,
        toTerritory: to,
        packetCount: data.count,
        roadLevel: computeRoadLevel(data.count),
        lastPacketAt: data.lastAt,
      })
    }

    return roads
  }

  // ── Persist to ae_roads ─────────────────────────────────────────────────────

  private async persistRoads(roads: RoadData[]): Promise<void> {
    if (roads.length === 0) return

    const periodStart = this.dayStart()

    const rows = roads.map(r => ({
      from_territory: r.fromTerritory,
      to_territory: r.toTerritory,
      packet_count: r.packetCount,
      road_level: r.roadLevel,
      last_packet_at: r.lastPacketAt,
      period: 'daily',
      period_start: periodStart,
    }))

    await this.upsertRows('ae_roads', rows)
  }
}
