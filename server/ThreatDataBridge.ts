/**
 * ThreatDataBridge
 * Polls Supabase for business events and maps them to battlefield threats.
 * Uses Node.js built-in fetch (Node 18+) — no SDK required.
 */

export interface ThreatEvent {
  id: string
  type: 'support_ticket' | 'deal_lost' | 'churn_risk' | 'cold_lead'
  severity: 'low' | 'elevated' | 'critical'
  territory: string
  title: string
  description: string
  sourceTable: string
  sourceId: string
  timestamp: number
}

interface ThreatDataBridgeConfig {
  supabaseUrl: string
  supabaseKey: string
  pollInterval?: number
  onThreat: (event: ThreatEvent) => void
  onThreatResolved: (id: string) => void
}

export class ThreatDataBridge {
  private supabaseUrl: string
  private supabaseKey: string
  private pollInterval: number
  private onThreat: (event: ThreatEvent) => void
  private onThreatResolved: (id: string) => void

  // De-duplication: keyed by "sourceTable:sourceId"
  private activeThreats: Map<string, ThreatEvent> = new Map()

  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: ThreatDataBridgeConfig) {
    this.supabaseUrl = config.supabaseUrl
    this.supabaseKey = config.supabaseKey
    this.pollInterval = config.pollInterval ?? 30000
    this.onThreat = config.onThreat
    this.onThreatResolved = config.onThreatResolved
  }

  start(): void {
    if (this.timer !== null) {
      console.log('[ThreatDataBridge] Already running — ignoring start()')
      return
    }
    console.log(`[ThreatDataBridge] Starting — poll interval ${this.pollInterval}ms`)
    // Poll immediately, then on interval
    this.poll()
    this.timer = setInterval(() => this.poll(), this.pollInterval)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[ThreatDataBridge] Stopped')
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      'apikey': this.supabaseKey,
      'Authorization': `Bearer ${this.supabaseKey}`,
      'Content-Type': 'application/json',
    }
  }

  private async fetchTable(table: string, query: string): Promise<Record<string, unknown>[]> {
    const url = `${this.supabaseUrl}/rest/v1/${table}?${query}`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${table}: ${await res.text()}`)
    }
    return res.json() as Promise<Record<string, unknown>[]>
  }

  private seenKey(sourceTable: string, sourceId: string): string {
    return `${sourceTable}:${sourceId}`
  }

  // -------------------------------------------------------------------------
  // Poll cycle
  // -------------------------------------------------------------------------

  private async poll(): Promise<void> {
    try {
      const freshThreats = await this.collectThreats()

      // Build map of what's currently active
      const freshKeys = new Set<string>()
      for (const threat of freshThreats) {
        const key = this.seenKey(threat.sourceTable, threat.sourceId)
        freshKeys.add(key)

        if (!this.activeThreats.has(key)) {
          // New threat — fire callback and track it
          this.activeThreats.set(key, threat)
          this.onThreat(threat)
        }
      }

      // Check for resolved threats (were active, now gone)
      for (const [key, threat] of this.activeThreats) {
        if (!freshKeys.has(key)) {
          this.activeThreats.delete(key)
          this.onThreatResolved(threat.id)
        }
      }
    } catch (err) {
      console.log('[ThreatDataBridge] Poll error (will retry):', err)
    }
  }

  // -------------------------------------------------------------------------
  // Query each table and map rows to ThreatEvents
  // -------------------------------------------------------------------------

  private async collectThreats(): Promise<ThreatEvent[]> {
    const results = await Promise.allSettled([
      this.fetchSupportTickets(),
      this.fetchLostDeals(),
      this.fetchAtRiskCustomers(),
      this.fetchColdLeads(),
    ])

    const threats: ThreatEvent[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        threats.push(...result.value)
      } else {
        console.log('[ThreatDataBridge] Query error (partial data):', result.reason)
      }
    }
    return threats
  }

  private async fetchSupportTickets(): Promise<ThreatEvent[]> {
    const rows = await this.fetchTable(
      'support_tickets',
      'status=eq.open&priority=in.(high,urgent)&select=id,subject,priority,customer_id,customer_message'
    )

    return rows.map((row) => {
      const priority = String(row['priority'] ?? 'high')
      const severity: ThreatEvent['severity'] = priority === 'urgent' ? 'critical' : 'elevated'
      const id = `support_ticket:${row['id']}`
      return {
        id,
        type: 'support_ticket',
        severity,
        territory: 'support',
        title: `Open ${priority} ticket: ${row['subject'] ?? 'No subject'}`,
        description: String(row['customer_message'] ?? '').slice(0, 200) || `Customer ${row['customer_id']} — ${priority} priority`,
        sourceTable: 'support_tickets',
        sourceId: String(row['id']),
        timestamp: Date.now(),
      } satisfies ThreatEvent
    })
  }

  private async fetchLostDeals(): Promise<ThreatEvent[]> {
    const rows = await this.fetchTable(
      'deals',
      'stage=eq.lost&select=id,name,value,closed_at,company_id'
    )

    return rows.map((row) => {
      const id = `deal_lost:${row['id']}`
      const value = row['value'] != null ? `$${Number(row['value']).toLocaleString()}` : 'unknown value'
      return {
        id,
        type: 'deal_lost',
        severity: 'elevated',
        territory: 'sales',
        title: `Lost deal: ${row['name'] ?? 'Unnamed deal'}`,
        description: `Deal ${value} closed lost${row['closed_at'] ? ` on ${String(row['closed_at']).slice(0, 10)}` : ''}`,
        sourceTable: 'deals',
        sourceId: String(row['id']),
        timestamp: Date.now(),
      } satisfies ThreatEvent
    })
  }

  private async fetchAtRiskCustomers(): Promise<ThreatEvent[]> {
    const rows = await this.fetchTable(
      'customers',
      'health_status=eq.at_risk&select=id,health_status,ltv,nps_score'
    )

    return rows.map((row) => {
      const id = `churn_risk:${row['id']}`
      const ltv = row['ltv'] != null ? `LTV $${Number(row['ltv']).toLocaleString()}` : 'LTV unknown'
      const nps = row['nps_score'] != null ? `, NPS ${row['nps_score']}` : ''
      return {
        id,
        type: 'churn_risk',
        severity: 'critical',
        territory: 'retention',
        title: `At-risk customer: ${row['id']}`,
        description: `Customer flagged at_risk — ${ltv}${nps}`,
        sourceTable: 'customers',
        sourceId: String(row['id']),
        timestamp: Date.now(),
      } satisfies ThreatEvent
    })
  }

  private async fetchColdLeads(): Promise<ThreatEvent[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const rows = await this.fetchTable(
      'leads',
      `status=eq.cold&created_at=gte.${encodeURIComponent(sevenDaysAgo)}&select=id,email,status,created_at,source`
    )

    return rows.map((row) => {
      const id = `cold_lead:${row['id']}`
      const createdAt = row['created_at'] ? String(row['created_at']).slice(0, 10) : 'unknown date'
      return {
        id,
        type: 'cold_lead',
        severity: 'low',
        territory: 'lead-gen',
        title: `Cold lead: ${row['email'] ?? row['id']}`,
        description: `Lead went cold — acquired ${createdAt}${row['source'] ? ` via ${row['source']}` : ''}`,
        sourceTable: 'leads',
        sourceId: String(row['id']),
        timestamp: Date.now(),
      } satisfies ThreatEvent
    })
  }
}
