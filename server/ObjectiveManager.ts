/**
 * ObjectiveManager — Manages objective (boss) CRUD via Supabase REST API.
 * Fire-and-forget writes, same pattern as SupabasePersistence.
 * Polls ae_objectives on 30s interval and broadcasts to WebSocket clients.
 */

export interface Objective {
  id: string
  campaign_id: string | null
  name: string
  description: string | null
  territory: string
  hp_total: number
  hp_remaining: number
  status: string
  dependencies: string[] | null
  sub_tasks: SubTask[]
  priority: number
  created_at: string
  defeated_at: string | null
  metadata: Record<string, unknown> | null
}

export interface SubTask {
  name: string
  completed: boolean
  completed_by?: string
  completed_at?: string
}

export interface ObjectiveAssignment {
  id: string
  objective_id: string
  session_id: string
  assigned_at: string
  hp_drained: number
}

export interface Campaign {
  id: string
  name: string
  description: string | null
  status: string
  territory: string | null
  total_hp: number
  defeated_hp: number
  objective_count: number
  defeated_count: number
  metadata: Record<string, unknown> | null
  created_at: string
  completed_at: string | null
}

export interface CreateCampaignInput {
  name: string
  description?: string
  territory?: string
  metadata?: Record<string, unknown>
}

export interface CreateObjectiveInput {
  name: string
  description?: string
  territory: string
  hp_total: number
  campaign_id?: string
  dependencies?: string[]
  sub_tasks?: SubTask[]
  priority?: number
  metadata?: Record<string, unknown>
}

type BroadcastFn = (type: string, payload: unknown) => void

export class ObjectiveManager {
  private url: string
  private key: string
  private broadcastFn: BroadcastFn | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private lastObjectives: Objective[] = []

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn
  }

  startPolling(): void {
    // Initial fetch
    this.fetchAndBroadcast()
    // Poll every 30 seconds
    this.pollInterval = setInterval(() => this.fetchAndBroadcast(), 30_000)
    console.log('[ObjectiveManager] Polling started (30s interval)')
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
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

  // ── CRUD Operations ──────────────────────────────────────────────────────

  async createObjective(input: CreateObjectiveInput): Promise<Objective | null> {
    try {
      const body: Record<string, unknown> = {
        name: input.name,
        territory: input.territory,
        hp_total: input.hp_total,
        hp_remaining: input.hp_total,
        status: 'unassaulted',
        priority: input.priority ?? 0,
      }
      if (input.description) body.description = input.description
      if (input.campaign_id) body.campaign_id = input.campaign_id
      if (input.dependencies) body.dependencies = input.dependencies
      if (input.sub_tasks) body.sub_tasks = JSON.stringify(input.sub_tasks)
      if (input.metadata) body.metadata = input.metadata

      const res = await fetch(`${this.url}/rest/v1/ae_objectives`, {
        method: 'POST',
        headers: this.headers('return=representation'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[ObjectiveManager] CREATE failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Objective[]
      const obj = rows[0]

      // Broadcast update
      this.fetchAndBroadcast()
      return obj
    } catch (err) {
      console.log('[ObjectiveManager] CREATE error:', err)
      return null
    }
  }

  async updateHP(objectiveId: string, hpDelta: number): Promise<Objective | null> {
    try {
      // Read current state
      const current = await this.getObjective(objectiveId)
      if (!current) return null

      const newHp = Math.max(0, current.hp_remaining + hpDelta)
      const updates: Record<string, unknown> = {
        hp_remaining: newHp,
      }

      // Auto-transition status
      if (newHp === 0 && current.status !== 'defeated') {
        updates.status = 'defeated'
        updates.defeated_at = new Date().toISOString()
      } else if (newHp > 0 && newHp < current.hp_total && current.status === 'unassaulted') {
        updates.status = 'under_attack'
      }

      const res = await fetch(`${this.url}/rest/v1/ae_objectives?id=eq.${objectiveId}`, {
        method: 'PATCH',
        headers: this.headers('return=representation'),
        body: JSON.stringify(updates),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[ObjectiveManager] UPDATE HP failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Objective[]
      const updated = rows[0] || null

      // Recalculate campaign progress if objective belongs to a campaign
      if (updated && current.campaign_id) {
        await this.recalculateCampaignProgress(current.campaign_id)
      }

      this.fetchAndBroadcast()
      return updated
    } catch (err) {
      console.log('[ObjectiveManager] UPDATE HP error:', err)
      return null
    }
  }

  async updateStatus(objectiveId: string, status: string): Promise<Objective | null> {
    try {
      // Read current state to check campaign membership
      const current = await this.getObjective(objectiveId)

      const updates: Record<string, unknown> = { status }
      if (status === 'defeated') {
        updates.defeated_at = new Date().toISOString()
      }

      const res = await fetch(`${this.url}/rest/v1/ae_objectives?id=eq.${objectiveId}`, {
        method: 'PATCH',
        headers: this.headers('return=representation'),
        body: JSON.stringify(updates),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[ObjectiveManager] UPDATE STATUS failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Objective[]
      const updated = rows[0] || null

      // Recalculate campaign progress if objective belongs to a campaign
      if (updated && current?.campaign_id) {
        await this.recalculateCampaignProgress(current.campaign_id)
      }

      this.fetchAndBroadcast()
      return updated
    } catch (err) {
      console.log('[ObjectiveManager] UPDATE STATUS error:', err)
      return null
    }
  }

  async defeatObjective(objectiveId: string): Promise<Objective | null> {
    return this.updateStatus(objectiveId, 'defeated')
  }

  async assignAgent(objectiveId: string, sessionId: string): Promise<ObjectiveAssignment | null> {
    try {
      // Create assignment
      const res = await fetch(`${this.url}/rest/v1/ae_objective_assignments`, {
        method: 'POST',
        headers: this.headers('return=representation'),
        body: JSON.stringify({
          objective_id: objectiveId,
          session_id: sessionId,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[ObjectiveManager] ASSIGN failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as ObjectiveAssignment[]

      // Auto-transition to under_attack if unassaulted
      const objective = await this.getObjective(objectiveId)
      if (objective && objective.status === 'unassaulted') {
        await this.updateStatus(objectiveId, 'under_attack')
      }

      this.fetchAndBroadcast()
      return rows[0] || null
    } catch (err) {
      console.log('[ObjectiveManager] ASSIGN error:', err)
      return null
    }
  }

  async getObjective(objectiveId: string): Promise<Objective | null> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_objectives?id=eq.${objectiveId}&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return null
      const rows = await res.json() as Objective[]
      return rows[0] || null
    } catch {
      return null
    }
  }

  async getObjectives(): Promise<Objective[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_objectives?status=neq.archived&order=priority.desc,created_at.asc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) {
        console.log(`[ObjectiveManager] GET objectives failed (${res.status})`)
        return []
      }
      return await res.json() as Objective[]
    } catch (err) {
      console.log('[ObjectiveManager] GET objectives error:', err)
      return []
    }
  }

  async getCampaignObjectives(campaignId: string): Promise<Objective[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_objectives?campaign_id=eq.${campaignId}&order=priority.desc,created_at.asc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as Objective[]
    } catch {
      return []
    }
  }

  async getAssignments(objectiveId: string): Promise<ObjectiveAssignment[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_objective_assignments?objective_id=eq.${objectiveId}&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return []
      return await res.json() as ObjectiveAssignment[]
    } catch {
      return []
    }
  }

  // ── Campaign CRUD ───────────────────────────────────────────────────────

  async createCampaign(input: CreateCampaignInput): Promise<Campaign | null> {
    try {
      const body: Record<string, unknown> = {
        name: input.name,
        status: 'active',
      }
      if (input.description) body.description = input.description
      if (input.territory) body.territory = input.territory
      if (input.metadata) body.metadata = input.metadata

      const res = await fetch(`${this.url}/rest/v1/ae_campaigns`, {
        method: 'POST',
        headers: this.headers('return=representation'),
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[CampaignManager] CREATE failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Campaign[]
      return rows[0] || null
    } catch (err) {
      console.log('[CampaignManager] CREATE error:', err)
      return null
    }
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_campaigns?id=eq.${campaignId}&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) return null
      const rows = await res.json() as Campaign[]
      return rows[0] || null
    } catch {
      return null
    }
  }

  async getCampaigns(): Promise<Campaign[]> {
    try {
      const res = await fetch(
        `${this.url}/rest/v1/ae_campaigns?status=neq.archived&order=created_at.desc&select=*`,
        { headers: this.headers() }
      )
      if (!res.ok) {
        console.log(`[CampaignManager] GET campaigns failed (${res.status})`)
        return []
      }
      return await res.json() as Campaign[]
    } catch (err) {
      console.log('[CampaignManager] GET campaigns error:', err)
      return []
    }
  }

  async addObjectiveToCampaign(campaignId: string, objectiveId: string): Promise<Objective | null> {
    try {
      // Update objective's campaign_id
      const res = await fetch(`${this.url}/rest/v1/ae_objectives?id=eq.${objectiveId}`, {
        method: 'PATCH',
        headers: this.headers('return=representation'),
        body: JSON.stringify({ campaign_id: campaignId }),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[CampaignManager] ADD OBJECTIVE failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Objective[]
      const obj = rows[0] || null

      // Recalculate campaign progress
      await this.recalculateCampaignProgress(campaignId)
      this.fetchAndBroadcast()

      return obj
    } catch (err) {
      console.log('[CampaignManager] ADD OBJECTIVE error:', err)
      return null
    }
  }

  async recalculateCampaignProgress(campaignId: string): Promise<Campaign | null> {
    try {
      // Fetch all objectives for this campaign
      const objectives = await this.getCampaignObjectives(campaignId)

      const totalHp = objectives.reduce((sum, o) => sum + o.hp_total, 0)
      const defeatedHp = objectives.reduce((sum, o) => sum + (o.hp_total - o.hp_remaining), 0)
      const objectiveCount = objectives.length
      const defeatedCount = objectives.filter(o => o.status === 'defeated').length

      const updates: Record<string, unknown> = {
        total_hp: totalHp,
        defeated_hp: defeatedHp,
        objective_count: objectiveCount,
        defeated_count: defeatedCount,
      }

      // Auto-complete campaign when all objectives defeated
      if (objectiveCount > 0 && defeatedCount === objectiveCount) {
        updates.status = 'completed'
        updates.completed_at = new Date().toISOString()
      }

      const res = await fetch(`${this.url}/rest/v1/ae_campaigns?id=eq.${campaignId}`, {
        method: 'PATCH',
        headers: this.headers('return=representation'),
        body: JSON.stringify(updates),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`[CampaignManager] RECALC failed (${res.status}): ${text}`)
        return null
      }

      const rows = await res.json() as Campaign[]
      const campaign = rows[0] || null

      // Broadcast campaign update
      if (campaign && this.broadcastFn) {
        this.broadcastFn('campaign_update', campaign)
      }

      return campaign
    } catch (err) {
      console.log('[CampaignManager] RECALC error:', err)
      return null
    }
  }

  // ── Cached accessor for last poll ────────────────────────────────────────

  getLastObjectives(): Objective[] {
    return this.lastObjectives
  }

  // ── Stalled Detection ───────────────────────────────────────────────────

  private lastHpSnapshot: Map<string, number> = new Map()
  private lastHpChangeTime: Map<string, number> = new Map()
  private STALL_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

  private async detectStalled(objectives: Objective[]): Promise<void> {
    const now = Date.now()

    for (const obj of objectives) {
      if (obj.status !== 'under_attack') continue

      const prevHp = this.lastHpSnapshot.get(obj.id)
      if (prevHp !== undefined && prevHp !== obj.hp_remaining) {
        // HP changed — reset timer
        this.lastHpChangeTime.set(obj.id, now)
      } else if (!this.lastHpChangeTime.has(obj.id)) {
        // First time seeing this objective — start timer
        this.lastHpChangeTime.set(obj.id, now)
      }

      this.lastHpSnapshot.set(obj.id, obj.hp_remaining)

      // Check for stall
      const lastChange = this.lastHpChangeTime.get(obj.id) || now
      if (now - lastChange > this.STALL_THRESHOLD_MS) {
        console.log(`[ObjectiveManager] Stalled: "${obj.name}" — no HP change for 30+ min`)
        await this.updateStatus(obj.id, 'stalled')
        this.lastHpChangeTime.delete(obj.id)
      }
    }
  }

  // ── Poll + Broadcast ─────────────────────────────────────────────────────

  async fetchAndBroadcast(): Promise<void> {
    const objectives = await this.getObjectives()
    await this.detectStalled(objectives)
    this.lastObjectives = objectives
    if (this.broadcastFn) {
      this.broadcastFn('objectives', objectives)
    }
  }
}
