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

class StripeMonitor {
  private endpoint: string
  private intervalMs: number
  private snapshot: RevenueSnapshot = { mrr: 0, transactions: [] }

  constructor(opts?: { endpoint?: string; intervalMs?: number }) {
    this.endpoint = opts?.endpoint ?? ''
    this.intervalMs = opts?.intervalMs ?? 60_000
  }

  async fetchRevenue(): Promise<RevenueSnapshot> {
    // Stub: returns mock data
    // PRD 05 will replace this with actual Stripe API polling
    return { mrr: 0, transactions: [] }
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
    stripeEndpoint?: string
  }) {
    this.broadcast = opts.broadcast
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000  // 30s default
    this.heartbeatMonitor = new HeartbeatMonitor(opts.getSessions)
    this.stripeMonitor = new StripeMonitor({ endpoint: opts.stripeEndpoint })
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
