/**
 * SupabasePersistence — Writes session and event data to Supabase ae_* tables.
 * Uses raw fetch (same pattern as ThreatDataBridge). No SDK required.
 *
 * Fire-and-forget: writes are async but never block the event loop.
 * Failures log warnings but don't crash the server.
 */

import type { ManagedSession } from '../shared/types.js'

interface PersistenceConfig {
  supabaseUrl: string
  supabaseKey: string
}

type UnitClass = 'command' | 'operations' | 'recon'

export class SupabasePersistence {
  private url: string
  private key: string
  private knownSessions: Set<string> = new Set()

  constructor(config: PersistenceConfig) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey
  }

  private headers(): Record<string, string> {
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    }
  }

  private async post(table: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        console.log(`[Persistence] POST ${table} failed (${res.status}): ${text}`)
        return false
      }
      return true
    } catch (err) {
      console.log(`[Persistence] POST ${table} error:`, err)
      return false
    }
  }

  private async patch(table: string, match: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?${match}`, {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        console.log(`[Persistence] PATCH ${table} failed (${res.status}): ${text}`)
        return false
      }
      return true
    } catch (err) {
      console.log(`[Persistence] PATCH ${table} error:`, err)
      return false
    }
  }

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  /** Called when a new session is created or auto-registered */
  async upsertSession(session: ManagedSession): Promise<void> {
    const unitClass = (session as any).unitClass || 'operations'
    const territory = (session as any).territory || 'hq'
    const parentSessionId = (session as any).parentSessionId || null

    const row: Record<string, unknown> = {
      session_id: session.id,
      name: session.name,
      unit_class: unitClass,
      territory,
      status: this.mapStatus(session.status),
      parent_session_id: parentSessionId,
      cwd: session.cwd || null,
      model: this.classToModel(unitClass),
      last_active_at: new Date().toISOString(),
      metadata: {
        source: (session as any).source || 'manual',
        tmux: (session as any).tmuxSession || null,
      },
    }

    if (this.knownSessions.has(session.id)) {
      // Update existing
      await this.patch('ae_sessions', `session_id=eq.${session.id}`, {
        name: row.name,
        status: row.status,
        territory: row.territory,
        cwd: row.cwd,
        last_active_at: row.last_active_at,
      })
    } else {
      // Insert new
      await this.post('ae_sessions', row)
      this.knownSessions.add(session.id)
    }
  }

  /** Called when session status changes */
  async updateSessionStatus(sessionId: string, status: string, territory?: string): Promise<void> {
    const updates: Record<string, unknown> = {
      status: this.mapStatus(status),
      last_active_at: new Date().toISOString(),
    }
    if (territory) {
      updates.territory = territory
    }
    await this.patch('ae_sessions', `session_id=eq.${sessionId}`, updates)
  }

  /** Called when a session goes offline / is terminated */
  async terminateSession(sessionId: string): Promise<void> {
    await this.patch('ae_sessions', `session_id=eq.${sessionId}`, {
      status: 'terminated',
      terminated_at: new Date().toISOString(),
    })
  }

  /** Increment session stats (fire-and-forget) */
  async incrementSessionStats(sessionId: string, field: 'tokens_used' | 'tools_invoked' | 'tasks_completed', amount: number = 1): Promise<void> {
    // Use RPC or raw SQL via PostgREST — but simpler to just read-modify-write
    // For high-frequency (tokens), we batch this on the caller side
    try {
      const res = await fetch(`${this.url}/rest/v1/rpc/increment_ae_session_stat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ p_session_id: sessionId, p_field: field, p_amount: amount }),
      })
      if (!res.ok) {
        // RPC might not exist yet — fall back silently
      }
    } catch {
      // Non-critical
    }
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /** Log an event to ae_events */
  async logEvent(event: {
    sessionId: string
    eventType: string
    territory?: string
    toolName?: string
    summary?: string
    payload?: Record<string, unknown>
    durationMs?: number
  }): Promise<void> {
    await this.post('ae_events', {
      session_id: event.sessionId,
      event_type: event.eventType,
      territory: event.territory || null,
      tool_name: event.toolName || null,
      summary: event.summary || null,
      payload: event.payload || {},
      duration_ms: event.durationMs || null,
    })
  }

  // ===========================================================================
  // Handoffs
  // ===========================================================================

  /** Record a handoff between agents */
  async logHandoff(handoff: {
    fromSessionId?: string
    toSessionId?: string
    fromTerritory: string
    toTerritory: string
    packetType: string
    summary?: string
    payload?: Record<string, unknown>
    priority?: number
  }): Promise<void> {
    await this.post('ae_handoffs', {
      from_session_id: handoff.fromSessionId || null,
      to_session_id: handoff.toSessionId || null,
      from_territory: handoff.fromTerritory,
      to_territory: handoff.toTerritory,
      packet_type: handoff.packetType,
      summary: handoff.summary || null,
      payload: handoff.payload || {},
      priority: handoff.priority || 5,
    })
  }

  // ===========================================================================
  // Startup: Load known sessions so we don't re-insert
  // ===========================================================================

  async loadKnownSessions(): Promise<void> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_sessions?status=neq.terminated&select=session_id`,
        { headers: this.headers() }
      )
      if (res.ok) {
        const rows = await res.json() as { session_id: string }[]
        for (const row of rows) {
          this.knownSessions.add(row.session_id)
        }
        console.log(`[Persistence] Loaded ${this.knownSessions.size} known sessions from Supabase`)
      }
    } catch (err) {
      console.log('[Persistence] Failed to load known sessions:', err)
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private mapStatus(status: string): string {
    const map: Record<string, string> = {
      'working': 'working',
      'waiting': 'idle',
      'idle': 'idle',
      'thinking': 'thinking',
      'offline': 'offline',
    }
    return map[status] || status
  }

  private classToModel(unitClass: UnitClass): string {
    const map: Record<UnitClass, string> = {
      command: 'opus',
      operations: 'sonnet',
      recon: 'haiku',
    }
    return map[unitClass] || 'sonnet'
  }
}
