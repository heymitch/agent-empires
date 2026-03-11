/**
 * MonitorOrchestrator — PRD 04: Autonomous Monitoring
 *
 * Manages lightweight sensor monitors that poll for business data
 * and broadcast health/status to WebSocket clients.
 *
 * Monitors are dumb pipes: fetch, normalize, broadcast.
 * They do NOT interpret or strategize.
 */

import type { ManagedSession, ServerMessage } from '../../shared/types.js'

// ============================================================================
// Types
// ============================================================================

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastSuccess: number   // Unix timestamp ms
  lastError?: string
  details?: Record<string, unknown>
}

export interface MonitorHealthReport {
  heartbeats: Record<string, SessionHeartbeat>
  revenue: RevenueSnapshot
  support: SupportSnapshot
}

export interface SessionHeartbeat {
  sessionId: string
  name: string
  lastActivity: number   // Unix timestamp ms
  status: 'active' | 'stalled' | 'offline'
}

export interface RevenueSnapshot {
  mrr: number
  transactions: unknown[]
}

export interface SupportSnapshot {
  openTickets: number
  urgentCount: number
}

type BroadcastFn = (message: ServerMessage) => void
type SessionProvider = () => ManagedSession[]

// ============================================================================
// HeartbeatMonitor
// ============================================================================

const STALLED_THRESHOLD_MS = 60_000    // 60s without activity = stalled
const OFFLINE_THRESHOLD_MS = 300_000   // 5min without activity = offline

class HeartbeatMonitor {
  private heartbeats = new Map<string, SessionHeartbeat>()
  private getSessions: SessionProvider

  constructor(getSessions: SessionProvider) {
    this.getSessions = getSessions
  }

  tick(): Record<string, SessionHeartbeat> {
    const now = Date.now()
    const sessions = this.getSessions()

    // Clear old heartbeats for sessions that no longer exist
    const activeIds = new Set(sessions.map(s => s.id))
    for (const id of Array.from(this.heartbeats.keys())) {
      if (!activeIds.has(id)) this.heartbeats.delete(id)
    }

    // Update heartbeats from session data
    for (const session of sessions) {
      const age = now - session.lastActivity
      let status: SessionHeartbeat['status'] = 'active'
      if (age > OFFLINE_THRESHOLD_MS) {
        status = 'offline'
      } else if (age > STALLED_THRESHOLD_MS) {
        status = 'stalled'
      }

      this.heartbeats.set(session.id, {
        sessionId: session.id,
        name: session.name,
        lastActivity: session.lastActivity,
        status,
      })
    }

    return Object.fromEntries(this.heartbeats)
  }
}

// ============================================================================
// StripeMonitor (stub — real integration in PRD 05)
// ============================================================================

export interface Transaction {
  id: string
  stripe_event_id: string | null
  type: string
  amount_cents: number
  currency: string
  customer_id: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

class StripeMonitor {
  private supabaseUrl: string
  private supabaseKey: string
  private intervalMs: number
  private snapshot: RevenueSnapshot = { mrr: 0, transactions: [] }

  constructor(opts?: { supabaseUrl?: string; supabaseKey?: string; intervalMs?: number }) {
    this.supabaseUrl = opts?.supabaseUrl ?? ''
    this.supabaseKey = opts?.supabaseKey ?? ''
    this.intervalMs = opts?.intervalMs ?? 60_000
  }

  private headers(): Record<string, string> {
    return {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
    }
  }

  async fetchRevenue(): Promise<RevenueSnapshot> {
    if (!this.supabaseUrl || !this.supabaseKey) {
      return { mrr: 0, transactions: [] }
    }

    // Query last 30 days of charge.succeeded and invoice.paid for revenue sum
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const revenueTypes = 'type.in.("charge.succeeded","invoice.paid")'
    const dateFilter = `created_at.gte.${thirtyDaysAgo}`

    const revenueUrl = `${this.supabaseUrl}/rest/v1/ae_transactions?select=amount_cents,type,created_at&${revenueTypes}&${dateFilter}`
    const recentUrl = `${this.supabaseUrl}/rest/v1/ae_transactions?select=*&order=created_at.desc&limit=10`

    const [revenueRes, recentRes] = await Promise.all([
      fetch(revenueUrl, { headers: this.headers() }),
      fetch(recentUrl, { headers: this.headers() }),
    ])

    let mrr = 0
    if (revenueRes.ok) {
      const rows = await revenueRes.json() as { amount_cents: number; type: string; created_at: string }[]
      const totalCents = rows.reduce((sum, r) => sum + r.amount_cents, 0)
      // MRR estimate: total revenue in last 30 days (approximation from actual charges)
      mrr = totalCents / 100
    } else {
      console.error(`[StripeMonitor] Revenue query failed (${revenueRes.status}): ${await revenueRes.text()}`)
    }

    let transactions: Transaction[] = []
    if (recentRes.ok) {
      transactions = await recentRes.json() as Transaction[]
    } else {
      console.error(`[StripeMonitor] Recent transactions query failed (${recentRes.status}): ${await recentRes.text()}`)
    }

    return { mrr, transactions }
  }

  async tick(): Promise<RevenueSnapshot> {
    try {
      this.snapshot = await this.fetchRevenue()
    } catch (err) {
      // Graceful degradation — keep last snapshot, don't crash
      console.error('[StripeMonitor] fetchRevenue failed:', err)
    }
    return this.snapshot
  }

  getSnapshot(): RevenueSnapshot {
    return this.snapshot
  }
}

// ============================================================================
// SlackMonitor (stub — real integration in PRD 05)
// ============================================================================

class SlackMonitor {
  private snapshot: SupportSnapshot = { openTickets: 0, urgentCount: 0 }

  async fetchSupport(): Promise<SupportSnapshot> {
    // Stub: returns mock data
    // PRD 05 will replace this with Slack API polling for support ticket volume
    return { openTickets: 0, urgentCount: 0 }
  }

  async tick(): Promise<SupportSnapshot> {
    try {
      this.snapshot = await this.fetchSupport()
    } catch (err) {
      console.error('[SlackMonitor] fetchSupport failed:', err)
    }
    return this.snapshot
  }

  getSnapshot(): SupportSnapshot {
    return this.snapshot
  }
}

// ============================================================================
// MonitorOrchestrator
// ============================================================================

export class MonitorOrchestrator {
  private heartbeatMonitor: HeartbeatMonitor
  private stripeMonitor: StripeMonitor
  private slackMonitor: SlackMonitor
  private broadcast: BroadcastFn
  private intervalHandle?: ReturnType<typeof setInterval>
  private running = false

  /** Poll interval for the orchestrator cycle (ms) */
  private pollIntervalMs: number

  constructor(opts: {
    getSessions: SessionProvider
    broadcast: BroadcastFn
    pollIntervalMs?: number
    supabaseUrl?: string
    supabaseKey?: string
  }) {
    this.broadcast = opts.broadcast
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000  // 30s default
    this.heartbeatMonitor = new HeartbeatMonitor(opts.getSessions)
    this.stripeMonitor = new StripeMonitor({
      supabaseUrl: opts.supabaseUrl,
      supabaseKey: opts.supabaseKey,
    })
    this.slackMonitor = new SlackMonitor()
  }

  start(): void {
    if (this.running) return
    this.running = true

    // Run immediately, then on interval
    this.cycle()
    this.intervalHandle = setInterval(() => this.cycle(), this.pollIntervalMs)
    console.log(`[MonitorOrchestrator] Started (polling every ${this.pollIntervalMs / 1000}s)`)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
    console.log('[MonitorOrchestrator] Stopped')
  }

  getHealthReport(): MonitorHealthReport {
    return {
      heartbeats: this.heartbeatMonitor.tick(),
      revenue: this.stripeMonitor.getSnapshot(),
      support: this.slackMonitor.getSnapshot(),
    }
  }

  private async cycle(): Promise<void> {
    // Run all monitors
    const heartbeats = this.heartbeatMonitor.tick()
    const [revenue, support] = await Promise.all([
      this.stripeMonitor.tick(),
      this.slackMonitor.tick(),
    ])

    // Broadcast aggregate to all WebSocket clients
    this.broadcast({
      type: 'monitor',
      payload: { heartbeats, revenue, support },
    } as ServerMessage)
  }
}
