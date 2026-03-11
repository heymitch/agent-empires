/**
 * PaperclipManager — Manages tickets, budgets, goals, and audit log
 * for the unit inspection panel (PRD 13 supply chain integration).
 *
 * Same raw fetch + Supabase REST pattern as ObjectiveManager.
 * No polling/broadcasting — other systems query as needed.
 */

export interface Ticket {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  source_territory: string | null
  current_territory: string | null
  assigned_session_id: string | null
  created_by: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CreateTicketInput {
  title: string
  description?: string
  priority?: string
  source_territory?: string
  current_territory?: string
  assigned_session_id?: string
  created_by?: string
  metadata?: Record<string, unknown>
}

export interface UpdateTicketInput {
  title?: string
  description?: string
  status?: string
  priority?: string
  current_territory?: string
  assigned_session_id?: string
  metadata?: Record<string, unknown>
}

export interface Budget {
  id: string
  territory: string
  budget_type: string
  allocated: number
  consumed: number
  period: string
  period_start: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface Goal {
  id: string
  territory: string
  name: string
  target_value: number
  current_value: number
  unit: string
  status: string
  deadline: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AuditEntry {
  id: string
  event_type: string
  actor: string | null
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export class PaperclipManager {
  private url: string
  private key: string

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey
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

  // ── Ticket CRUD ─────────────────────────────────────────────────────────

  async createTicket(input: CreateTicketInput): Promise<Ticket | null> {
    try {
      const body: Record<string, unknown> = {
        title: input.title,
        status: 'open',
        priority: input.priority ?? 'normal',
      }
      if (input.description) body.description = input.description
      if (input.source_territory) body.source_territory = input.source_territory
      if (input.current_territory) body.current_territory = input.current_territory
      if (input.assigned_session_id) body.assigned_session_id = input.assigned_session_id
      if (input.created_by) body.created_by = input.created_by
      if (input.metadata) body.metadata = input.metadata

      const res = await fetch(`${this.url}/rest/v1/ae_tickets`, {
        method: 'POST',
        headers: this.headers('return=representation'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[PaperclipManager] CREATE ticket failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Ticket[]
      return rows[0] || null
    } catch (err) {
      console.log('[PaperclipManager] CREATE ticket error:', err)
      return null
    }
  }

  async updateTicket(ticketId: string, updates: UpdateTicketInput): Promise<Ticket | null> {
    try {
      const body: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() }

      // Auto-set completed_at when status transitions to completed
      if (updates.status === 'completed') {
        body.completed_at = new Date().toISOString()
      }

      const res = await fetch(`${this.url}/rest/v1/ae_tickets?id=eq.${ticketId}`, {
        method: 'PATCH',
        headers: this.headers('return=representation'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[PaperclipManager] UPDATE ticket failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Ticket[]
      return rows[0] || null
    } catch (err) {
      console.log('[PaperclipManager] UPDATE ticket error:', err)
      return null
    }
  }

  async getTicket(ticketId: string): Promise<Ticket | null> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_tickets?id=eq.${ticketId}&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return null
      const rows = await res.json() as Ticket[]
      return rows[0] || null
    } catch {
      return null
    }
  }

  async getTicketsByTerritory(territory: string): Promise<Ticket[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_tickets?current_territory=eq.${territory}&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) {
        console.log(`[PaperclipManager] GET tickets by territory failed (${res.status})`)
        return []
      }
      return await res.json() as Ticket[]
    } catch (err) {
      console.log('[PaperclipManager] GET tickets by territory error:', err)
      return []
    }
  }

  async getTicketsBySession(sessionId: string): Promise<Ticket[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_tickets?assigned_session_id=eq.${sessionId}&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) {
        console.log(`[PaperclipManager] GET tickets by session failed (${res.status})`)
        return []
      }
      return await res.json() as Ticket[]
    } catch (err) {
      console.log('[PaperclipManager] GET tickets by session error:', err)
      return []
    }
  }

  async getTicketsByStatus(status: string): Promise<Ticket[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_tickets?status=eq.${status}&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Ticket[]
    } catch {
      return []
    }
  }

  // ── Budgets (read-only) ─────────────────────────────────────────────────

  async getBudgetsByTerritory(territory: string): Promise<Budget[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_budgets?territory=eq.${territory}&order=period_start.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Budget[]
    } catch {
      return []
    }
  }

  async getAllBudgets(): Promise<Budget[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_budgets?order=territory.asc,period_start.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Budget[]
    } catch {
      return []
    }
  }

  // ── Goals (read-only) ──────────────────────────────────────────────────

  async getGoalsByTerritory(territory: string): Promise<Goal[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_goals?territory=eq.${territory}&status=eq.active&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Goal[]
    } catch {
      return []
    }
  }

  async getAllGoals(): Promise<Goal[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_goals?order=territory.asc,created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Goal[]
    } catch {
      return []
    }
  }

  // ── Audit Log (append-only) ────────────────────────────────────────────

  async logEvent(
    eventType: string,
    actor: string,
    targetType?: string,
    targetId?: string,
    details?: Record<string, unknown>
  ): Promise<AuditEntry | null> {
    try {
      const body: Record<string, unknown> = {
        event_type: eventType,
        actor,
      }
      if (targetType) body.target_type = targetType
      if (targetId) body.target_id = targetId
      if (details) body.details = details

      const res = await fetch(`${this.url}/rest/v1/ae_audit_log`, {
        method: 'POST',
        headers: this.headers('return=representation'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[PaperclipManager] LOG event failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as AuditEntry[]
      return rows[0] || null
    } catch (err) {
      console.log('[PaperclipManager] LOG event error:', err)
      return null
    }
  }

  async getAuditLog(limit: number = 50): Promise<AuditEntry[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_audit_log?order=created_at.desc&limit=${limit}&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as AuditEntry[]
    } catch {
      return []
    }
  }

  async getAuditLogByTarget(targetType: string, targetId: string): Promise<AuditEntry[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_audit_log?target_type=eq.${targetType}&target_id=eq.${targetId}&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as AuditEntry[]
    } catch {
      return []
    }
  }
}
