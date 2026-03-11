/**
 * ProductionDataManager — Manages production chain metrics for Factorio Mode.
 *
 * Holds current metric values for each production node, generates plausible
 * mock data that slowly varies (sin waves + noise), detects bottlenecks,
 * and broadcasts state to WebSocket clients every 30 seconds.
 *
 * Same pattern as ObjectiveManager: constructor takes supabaseUrl + supabaseKey,
 * polls on interval, broadcasts via callback.
 */

import {
  PRODUCTION_CHAINS,
  getChainDef,
  getNodeDef,
  type TerritoryId,
  type ProductionNode,
  type ProductionNodeState,
  type ProductionChainState,
  type BottleneckInfo,
} from '../shared/productionChains.js'

type BroadcastFn = (type: string, payload: unknown) => void

// ── Mock Data Seed Values ────────────────────────────────────────────────────
// Each node gets a base value close to its target, with some deliberately
// underperforming to create visible bottlenecks.

interface MockSeed {
  base: number          // baseline value (fraction of target, e.g. 0.85 = 85% of target)
  amplitude: number     // sin wave amplitude as fraction of base (e.g. 0.1 = +/-10%)
  frequency: number     // sin wave period in minutes
  noiseScale: number    // random noise as fraction of base
  invertHealth?: boolean // for metrics where lower = better (response time, churn)
}

const MOCK_SEEDS: Record<string, MockSeed> = {
  // Lead-Gen: bottleneck at subscribers conversion
  'lg-content':      { base: 0.92,  amplitude: 0.08, frequency: 12,  noiseScale: 0.05 },
  'lg-impressions':  { base: 0.88,  amplitude: 0.10, frequency: 8,   noiseScale: 0.06 },
  'lg-visitors':     { base: 0.85,  amplitude: 0.07, frequency: 10,  noiseScale: 0.04 },
  'lg-subscribers':  { base: 0.62,  amplitude: 0.06, frequency: 15,  noiseScale: 0.03 },  // BOTTLENECK
  'lg-waitlist':     { base: 0.78,  amplitude: 0.09, frequency: 11,  noiseScale: 0.05 },

  // Sales: bottleneck at proposals
  'sl-leads':        { base: 0.95,  amplitude: 0.05, frequency: 9,   noiseScale: 0.04 },
  'sl-calls':        { base: 0.83,  amplitude: 0.08, frequency: 14,  noiseScale: 0.05 },
  'sl-proposals':    { base: 0.55,  amplitude: 0.07, frequency: 18,  noiseScale: 0.04 },  // BOTTLENECK
  'sl-negotiation':  { base: 0.70,  amplitude: 0.10, frequency: 20,  noiseScale: 0.06 },
  'sl-closed':       { base: 0.65,  amplitude: 0.08, frequency: 22,  noiseScale: 0.05 },

  // Fulfillment: healthy overall, slight dip at completion
  'fl-students':     { base: 0.90,  amplitude: 0.05, frequency: 30,  noiseScale: 0.03 },
  'fl-onboarded':    { base: 0.95,  amplitude: 0.03, frequency: 25,  noiseScale: 0.02 },
  'fl-attendance':   { base: 0.92,  amplitude: 0.04, frequency: 20,  noiseScale: 0.03 },
  'fl-completion':   { base: 0.75,  amplitude: 0.06, frequency: 35,  noiseScale: 0.04 },  // slight warning
  'fl-nps':          { base: 0.93,  amplitude: 0.03, frequency: 40,  noiseScale: 0.02 },

  // Support: bottleneck at resolution time (lower = better, so high ratio = bad)
  'sp-tickets':      { base: 0.87,  amplitude: 0.10, frequency: 7,   noiseScale: 0.06 },
  'sp-response':     { base: 1.10,  amplitude: 0.15, frequency: 6,   noiseScale: 0.08, invertHealth: true }, // slightly over target (bad)
  'sp-resolution':   { base: 1.45,  amplitude: 0.12, frequency: 9,   noiseScale: 0.07, invertHealth: true }, // BOTTLENECK (way over target hours)
  'sp-satisfaction': { base: 0.89,  amplitude: 0.04, frequency: 15,  noiseScale: 0.03 },

  // Retention: churn risk is the bottleneck
  'rt-active':       { base: 0.85,  amplitude: 0.03, frequency: 45,  noiseScale: 0.02 },
  'rt-renewal':      { base: 0.80,  amplitude: 0.06, frequency: 30,  noiseScale: 0.04 },
  'rt-upsell':       { base: 0.70,  amplitude: 0.08, frequency: 25,  noiseScale: 0.05 },
  'rt-churn':        { base: 2.50,  amplitude: 0.30, frequency: 20,  noiseScale: 0.10, invertHealth: true }, // BOTTLENECK (want 0, have ~2.5)
}

export class ProductionDataManager {
  private url: string
  private key: string
  private broadcastFn: BroadcastFn | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private startTime: number = Date.now()

  /** Current metric values keyed by node ID */
  private currentValues: Map<string, number> = new Map()

  /** Seeded random for deterministic-ish noise per node */
  private noiseOffsets: Map<string, number> = new Map()

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.url = config.supabaseUrl
    this.key = config.supabaseKey

    // Initialize noise offsets (unique phase per node so they don't all move together)
    for (const chain of PRODUCTION_CHAINS) {
      for (const node of chain.nodes) {
        this.noiseOffsets.set(node.id, Math.random() * Math.PI * 2)
      }
    }

    // Initialize current values with mock data
    this.updateMockData()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn
  }

  startPolling(): void {
    // Initial broadcast
    this.broadcastAll()
    // Poll every 30 seconds: update mock data, check real sources, broadcast
    this.pollInterval = setInterval(() => {
      this.updateMockData()
      this.pollRealSources()
      this.broadcastAll()
    }, 30_000)
    console.log('[ProductionDataManager] Polling started (30s interval)')
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /** Get full production chain state for a territory */
  getChainForTerritory(territory: TerritoryId): ProductionChainState | null {
    const chainDef = getChainDef(territory)
    if (!chainDef) return null

    const nodes = chainDef.nodes.map(n => this.buildNodeState(n))
    const bottleneck = this.detectBottleneckForChain(chainDef.nodes, nodes)

    // Mark the bottleneck node
    if (bottleneck) {
      const bn = nodes.find(n => n.nodeId === bottleneck.nodeId)
      if (bn) bn.status = 'bottleneck'
    }

    return {
      territory,
      description: chainDef.description,
      nodes,
      bottleneck,
    }
  }

  /** Manually update a node's metric value */
  updateNodeMetric(nodeId: string, value: number): boolean {
    const nodeDef = getNodeDef(nodeId)
    if (!nodeDef) return false
    this.currentValues.set(nodeId, value)
    // Broadcast updated state for this territory
    this.broadcastTerritory(nodeDef.territory)
    return true
  }

  /** Get all current bottlenecks across all territories */
  getBottlenecks(): BottleneckInfo[] {
    const bottlenecks: BottleneckInfo[] = []
    for (const chain of PRODUCTION_CHAINS) {
      const nodes = chain.nodes.map(n => this.buildNodeState(n))
      const bn = this.detectBottleneckForChain(chain.nodes, nodes)
      if (bn) bottlenecks.push(bn)
    }
    return bottlenecks
  }

  // ── Mock Data Generation ───────────────────────────────────────────────────

  private updateMockData(): void {
    const elapsed = (Date.now() - this.startTime) / 1000 / 60  // minutes since start

    for (const chain of PRODUCTION_CHAINS) {
      for (const node of chain.nodes) {
        // Skip nodes that have been manually updated recently
        // (we could track this but for now mock always runs)
        const seed = MOCK_SEEDS[node.id]
        if (!seed) {
          // Fallback: 85% of target
          this.currentValues.set(node.id, node.target * 0.85)
          continue
        }

        const phase = this.noiseOffsets.get(node.id) || 0

        // Sin wave for smooth oscillation
        const sinVal = Math.sin((elapsed / seed.frequency) * Math.PI * 2 + phase)
        const sinComponent = seed.amplitude * sinVal

        // Smooth noise: use a slower secondary sin wave with irrational frequency ratio
        const noise2 = Math.sin(elapsed * 0.37 + phase * 2.71) * seed.noiseScale * 0.5
        const noise3 = Math.sin(elapsed * 0.13 + phase * 1.41) * seed.noiseScale * 0.5

        const multiplier = seed.base + sinComponent + noise2 + noise3

        // Clamp to reasonable range (never negative, never more than 2x target)
        const rawValue = node.target * Math.max(0.05, Math.min(2.0, multiplier))

        // Round appropriately: integers for counts, 1 decimal for scores/percentages
        const value = node.target >= 10
          ? Math.round(rawValue)
          : Math.round(rawValue * 10) / 10

        this.currentValues.set(node.id, value)
      }
    }
  }

  // ── Real Data Sources (stub — add real polling here) ───────────────────────

  private async pollRealSources(): Promise<void> {
    // Kit subscribers: call edge function if available
    // TODO: Wire to real kit-subscribers edge function
    // const kitCount = await this.fetchKitSubscribers()
    // if (kitCount !== null) this.currentValues.set('lg-subscribers', kitCount)

    // Supabase queries: content_log, support tickets, feedback
    // TODO: Wire to real Supabase queries
    // These are fire-and-forget — failures don't block the poll cycle
  }

  private headers(): Record<string, string> {
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
    }
  }

  // ── State Building ─────────────────────────────────────────────────────────

  private buildNodeState(nodeDef: ProductionNode): ProductionNodeState {
    const current = this.currentValues.get(nodeDef.id) ?? 0
    const seed = MOCK_SEEDS[nodeDef.id]

    // Health ratio calculation
    let healthRatio: number
    if (seed?.invertHealth) {
      // For "lower is better" metrics (response time, churn):
      // target=2h, current=3h → ratio = target/current = 0.67 (bad)
      // target=2h, current=1.5h → ratio = target/current = 1.33 (good, capped at 1)
      healthRatio = current > 0 ? Math.min(1, nodeDef.target / current) : 1
      // Special case: churn target is 0, so any value > 0 is bad
      if (nodeDef.target === 0) {
        healthRatio = current === 0 ? 1 : Math.max(0, 1 - current * 0.3)
      }
    } else {
      healthRatio = nodeDef.target > 0 ? Math.min(1, current / nodeDef.target) : 1
    }

    // Status based on health ratio
    let status: 'healthy' | 'warning' | 'bottleneck' = 'healthy'
    if (healthRatio < 0.6) status = 'bottleneck'
    else if (healthRatio < 0.8) status = 'warning'

    // Throughput per week = current value (most metrics are already per-week)
    const throughputPerWeek = current

    return {
      nodeId: nodeDef.id,
      territory: nodeDef.territory,
      name: nodeDef.name,
      metric: nodeDef.metric,
      current,
      target: nodeDef.target,
      throughputPerWeek,
      healthRatio: Math.round(healthRatio * 100) / 100,
      status,
      position: nodeDef.position,
      inputNodes: nodeDef.inputNodes,
      outputNodes: nodeDef.outputNodes,
      dataSource: nodeDef.dataSource,
    }
  }

  // ── Bottleneck Detection (from PRD) ────────────────────────────────────────

  private detectBottleneckForChain(
    nodeDefs: ProductionNode[],
    nodeStates: ProductionNodeState[]
  ): BottleneckInfo | null {
    // A bottleneck is the node with the worst health ratio (<0.8)
    // whose upstream inputs are healthy (>0.8). This means the problem
    // is at THIS node, not cascading from upstream.
    let worstRatio = Infinity
    let bottleneckState: ProductionNodeState | null = null

    for (const state of nodeStates) {
      if (state.healthRatio < worstRatio && state.healthRatio < 0.8) {
        // Check upstream: if ALL inputs are healthy, this is the real bottleneck
        const upstreamHealthy = state.inputNodes.every(inputId => {
          const upstream = nodeStates.find(n => n.nodeId === inputId)
          return upstream ? upstream.healthRatio > 0.8 : true
        })

        if (upstreamHealthy) {
          worstRatio = state.healthRatio
          bottleneckState = state
        }
      }
    }

    if (!bottleneckState) return null

    return {
      nodeId: bottleneckState.nodeId,
      territory: bottleneckState.territory,
      nodeName: bottleneckState.name,
      metric: bottleneckState.metric,
      current: bottleneckState.current,
      target: bottleneckState.target,
      healthRatio: bottleneckState.healthRatio,
      suggestion: this.generateSuggestion(bottleneckState),
    }
  }

  private generateSuggestion(node: ProductionNodeState): string {
    const suggestions: Record<string, string> = {
      'lg-content': 'Deploy Writer agents to increase content output',
      'lg-impressions': 'Review content distribution — are posts reaching the right audience?',
      'lg-visitors': 'Check landing page performance and SEO',
      'lg-subscribers': 'Optimize opt-in forms and lead magnets — conversion is below target',
      'lg-waitlist': 'Review waitlist funnel — are subscribers being nurtured to sign up?',
      'sl-leads': 'Increase top-of-funnel activity — more content, more ads',
      'sl-calls': 'Follow up on leads faster — booking rate is low',
      'sl-proposals': 'Deploy Diplomat agent to draft proposals — pipeline is stalling here',
      'sl-negotiation': 'Review pricing and objection handling — deals are getting stuck',
      'sl-closed': 'Improve close rate — consider urgency tactics or better qualification',
      'fl-students': 'Enrollment is below target — check sales handoff',
      'fl-onboarded': 'Improve onboarding flow — students are dropping before starting',
      'fl-attendance': 'Session attendance dropping — check content quality and scheduling',
      'fl-completion': 'Completion rate below target — investigate dropout at Session 4',
      'fl-nps': 'Student satisfaction is low — review feedback for patterns',
      'sp-tickets': 'Ticket volume is different than expected',
      'sp-response': 'First response time is too slow — deploy Support agent',
      'sp-resolution': 'Resolution time exceeding target — 3+ tickets aging >48h',
      'sp-satisfaction': 'Support satisfaction is dropping — review recent resolutions',
      'rt-active': 'Active client count below target',
      'rt-renewal': 'Renewals pipeline needs attention',
      'rt-upsell': 'Identify more upsell opportunities from active clients',
      'rt-churn': 'Churn risk detected — 2+ clients with no contact in 14+ days',
    }
    return suggestions[node.nodeId] || `${node.name} is underperforming (${Math.round(node.healthRatio * 100)}% of target)`
  }

  // ── Broadcasting ───────────────────────────────────────────────────────────

  private broadcastAll(): void {
    if (!this.broadcastFn) return

    for (const chain of PRODUCTION_CHAINS) {
      const state = this.getChainForTerritory(chain.territory)
      if (state) {
        this.broadcastFn('production', state)
      }
    }
  }

  private broadcastTerritory(territory: TerritoryId): void {
    if (!this.broadcastFn) return
    const state = this.getChainForTerritory(territory)
    if (state) {
      this.broadcastFn('production', state)
    }
  }
}
