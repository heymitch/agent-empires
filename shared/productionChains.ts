/**
 * Production Chain Definitions — Factorio Mode
 *
 * Each territory has a production chain: a directed graph of metric nodes
 * showing inputs, processing, outputs, throughput rates, and bottlenecks.
 * Clicking a territory zooms into this view.
 */

// Re-export TerritoryId for convenience (canonical def in TerritoryDetector)
export type TerritoryId = 'lead-gen' | 'content' | 'sales' | 'fulfillment' | 'support' | 'retention' | 'hq'

// ── Node & Chain Types ───────────────────────────────────────────────────────

export interface ProductionNode {
  id: string
  name: string
  territory: TerritoryId
  /** Human-readable metric label: "Content Published", "Subscribers", etc. */
  metric: string
  /** Target throughput per period (weekly for flow metrics, absolute for gauges) */
  target: number
  /** Where the real data comes from */
  dataSource: 'kit-subscribers' | 'supabase:content_log' | 'shield' | 'stripe' | 'calendar' | 'manual' | 'supabase:feedback' | 'supabase:support' | 'slack' | 'samcart'
  /** Optional query hint for Supabase or API */
  query?: string
  /** Upstream node IDs (inputs to this node) */
  inputNodes: string[]
  /** Downstream node IDs (outputs from this node) */
  outputNodes: string[]
  /** Relative position within territory view (0-1 range, left-to-right flow) */
  position: { x: number; y: number }
}

export interface ProductionChain {
  territory: TerritoryId
  nodes: ProductionNode[]
  description: string
}

// ── Runtime metric state (used by ProductionDataManager) ─────────────────────

export interface ProductionNodeState {
  nodeId: string
  territory: TerritoryId
  name: string
  metric: string
  current: number
  target: number
  /** Throughput rate per week */
  throughputPerWeek: number
  /** 0-1 ratio: current/target. Below 0.8 = warning, below 0.6 = bottleneck */
  healthRatio: number
  /** 'healthy' | 'warning' | 'bottleneck' */
  status: 'healthy' | 'warning' | 'bottleneck'
  position: { x: number; y: number }
  inputNodes: string[]
  outputNodes: string[]
  dataSource: string
}

export interface BottleneckInfo {
  nodeId: string
  territory: TerritoryId
  nodeName: string
  metric: string
  current: number
  target: number
  healthRatio: number
  /** Human-readable suggestion */
  suggestion: string
}

export interface ProductionChainState {
  territory: TerritoryId
  description: string
  nodes: ProductionNodeState[]
  bottleneck: BottleneckInfo | null
}

// ── Chain Definitions ────────────────────────────────────────────────────────

export const PRODUCTION_CHAINS: ProductionChain[] = [
  // ── Lead-Gen ─────────────────────────────────────────────────────────────
  {
    territory: 'lead-gen',
    description: 'Content funnel: publish content, generate impressions, convert visitors to subscribers and waitlist signups.',
    nodes: [
      {
        id: 'lg-content',
        name: 'Content Published',
        territory: 'lead-gen',
        metric: 'Posts / week',
        target: 12,
        dataSource: 'supabase:content_log',
        query: "count WHERE status='published' AND created_at > now() - interval '7 days'",
        inputNodes: [],
        outputNodes: ['lg-impressions'],
        position: { x: 0.1, y: 0.5 },
      },
      {
        id: 'lg-impressions',
        name: 'Impressions',
        territory: 'lead-gen',
        metric: 'Views / week',
        target: 5000,
        dataSource: 'shield',
        inputNodes: ['lg-content'],
        outputNodes: ['lg-visitors'],
        position: { x: 0.3, y: 0.5 },
      },
      {
        id: 'lg-visitors',
        name: 'Visitors',
        territory: 'lead-gen',
        metric: 'Site visits / week',
        target: 1200,
        dataSource: 'manual',
        inputNodes: ['lg-impressions'],
        outputNodes: ['lg-subscribers'],
        position: { x: 0.5, y: 0.5 },
      },
      {
        id: 'lg-subscribers',
        name: 'Subscribers',
        territory: 'lead-gen',
        metric: 'New subs / week',
        target: 80,
        dataSource: 'kit-subscribers',
        query: 'kit-subscribers edge function',
        inputNodes: ['lg-visitors'],
        outputNodes: ['lg-waitlist'],
        position: { x: 0.7, y: 0.5 },
      },
      {
        id: 'lg-waitlist',
        name: 'Waitlist',
        territory: 'lead-gen',
        metric: 'Signups / week',
        target: 50,
        dataSource: 'kit-subscribers',
        inputNodes: ['lg-subscribers'],
        outputNodes: [],
        position: { x: 0.9, y: 0.5 },
      },
    ],
  },

  // ── Sales ────────────────────────────────────────────────────────────────
  {
    territory: 'sales',
    description: 'Sales pipeline: leads flow through calls, proposals, negotiation, to closed won.',
    nodes: [
      {
        id: 'sl-leads',
        name: 'Leads In',
        territory: 'sales',
        metric: 'Leads / week',
        target: 40,
        dataSource: 'kit-subscribers',
        inputNodes: [],
        outputNodes: ['sl-calls'],
        position: { x: 0.1, y: 0.5 },
      },
      {
        id: 'sl-calls',
        name: 'Call Booked',
        territory: 'sales',
        metric: 'Calls / week',
        target: 12,
        dataSource: 'calendar',
        query: "calendar events with 'call' keyword",
        inputNodes: ['sl-leads'],
        outputNodes: ['sl-proposals'],
        position: { x: 0.3, y: 0.5 },
      },
      {
        id: 'sl-proposals',
        name: 'Proposal Sent',
        territory: 'sales',
        metric: 'Proposals / week',
        target: 8,
        dataSource: 'manual',
        inputNodes: ['sl-calls'],
        outputNodes: ['sl-negotiation'],
        position: { x: 0.5, y: 0.5 },
      },
      {
        id: 'sl-negotiation',
        name: 'Negotiation',
        territory: 'sales',
        metric: 'Active deals',
        target: 5,
        dataSource: 'manual',
        inputNodes: ['sl-proposals'],
        outputNodes: ['sl-closed'],
        position: { x: 0.7, y: 0.5 },
      },
      {
        id: 'sl-closed',
        name: 'Closed Won',
        territory: 'sales',
        metric: 'Deals / week',
        target: 3,
        dataSource: 'stripe',
        inputNodes: ['sl-negotiation'],
        outputNodes: [],
        position: { x: 0.9, y: 0.5 },
      },
    ],
  },

  // ── Fulfillment ──────────────────────────────────────────────────────────
  {
    territory: 'fulfillment',
    description: 'Student lifecycle: onboard new students, track attendance, measure completion and satisfaction.',
    nodes: [
      {
        id: 'fl-students',
        name: 'New Students',
        territory: 'fulfillment',
        metric: 'Students / cohort',
        target: 10,
        dataSource: 'stripe',
        inputNodes: [],
        outputNodes: ['fl-onboarded'],
        position: { x: 0.1, y: 0.5 },
      },
      {
        id: 'fl-onboarded',
        name: 'Onboarded',
        territory: 'fulfillment',
        metric: 'Onboarded / cohort',
        target: 10,
        dataSource: 'manual',
        inputNodes: ['fl-students'],
        outputNodes: ['fl-attendance'],
        position: { x: 0.3, y: 0.5 },
      },
      {
        id: 'fl-attendance',
        name: 'Session Attendance',
        territory: 'fulfillment',
        metric: 'Avg attendance %',
        target: 90,
        dataSource: 'manual',
        inputNodes: ['fl-onboarded'],
        outputNodes: ['fl-completion'],
        position: { x: 0.5, y: 0.5 },
      },
      {
        id: 'fl-completion',
        name: 'Completion',
        territory: 'fulfillment',
        metric: 'Completion %',
        target: 80,
        dataSource: 'manual',
        inputNodes: ['fl-attendance'],
        outputNodes: ['fl-nps'],
        position: { x: 0.7, y: 0.5 },
      },
      {
        id: 'fl-nps',
        name: 'NPS Score',
        territory: 'fulfillment',
        metric: 'Score (0-5)',
        target: 4.5,
        dataSource: 'supabase:feedback',
        query: 'avg(score) from feedback',
        inputNodes: ['fl-completion'],
        outputNodes: [],
        position: { x: 0.9, y: 0.5 },
      },
    ],
  },

  // ── Support ──────────────────────────────────────────────────────────────
  {
    territory: 'support',
    description: 'Support pipeline: tickets come in, get first response, resolve, measure satisfaction.',
    nodes: [
      {
        id: 'sp-tickets',
        name: 'Tickets In',
        territory: 'support',
        metric: 'Tickets / week',
        target: 15,
        dataSource: 'supabase:support',
        query: "count WHERE created_at > now() - interval '7 days'",
        inputNodes: [],
        outputNodes: ['sp-response'],
        position: { x: 0.15, y: 0.5 },
      },
      {
        id: 'sp-response',
        name: 'First Response',
        territory: 'support',
        metric: 'Avg hours',
        target: 2,
        dataSource: 'supabase:support',
        query: "avg(first_response_hours)",
        inputNodes: ['sp-tickets'],
        outputNodes: ['sp-resolution'],
        position: { x: 0.4, y: 0.5 },
      },
      {
        id: 'sp-resolution',
        name: 'Resolution',
        territory: 'support',
        metric: 'Avg hours',
        target: 18,
        dataSource: 'supabase:support',
        query: "avg(resolution_hours)",
        inputNodes: ['sp-response'],
        outputNodes: ['sp-satisfaction'],
        position: { x: 0.65, y: 0.5 },
      },
      {
        id: 'sp-satisfaction',
        name: 'Satisfaction',
        territory: 'support',
        metric: 'Score (0-5)',
        target: 4.5,
        dataSource: 'supabase:feedback',
        query: "avg(score) WHERE type='support'",
        inputNodes: ['sp-resolution'],
        outputNodes: [],
        position: { x: 0.9, y: 0.5 },
      },
    ],
  },

  // ── Retention ────────────────────────────────────────────────────────────
  {
    territory: 'retention',
    description: 'Client health: track active clients, renewals, upsell opportunities, and churn risk.',
    nodes: [
      {
        id: 'rt-active',
        name: 'Active Clients',
        territory: 'retention',
        metric: 'Total active',
        target: 40,
        dataSource: 'manual',
        inputNodes: [],
        outputNodes: ['rt-renewal'],
        position: { x: 0.1, y: 0.5 },
      },
      {
        id: 'rt-renewal',
        name: 'Renewal Pipeline',
        territory: 'retention',
        metric: 'Due next 30d',
        target: 15,
        dataSource: 'manual',
        inputNodes: ['rt-active'],
        outputNodes: ['rt-upsell'],
        position: { x: 0.4, y: 0.4 },
      },
      {
        id: 'rt-upsell',
        name: 'Upsell Candidates',
        territory: 'retention',
        metric: 'Identified',
        target: 8,
        dataSource: 'manual',
        inputNodes: ['rt-renewal'],
        outputNodes: [],
        position: { x: 0.7, y: 0.3 },
      },
      {
        id: 'rt-churn',
        name: 'Churn Risk',
        territory: 'retention',
        metric: 'Flagged clients',
        target: 0,
        dataSource: 'manual',
        inputNodes: ['rt-active'],
        outputNodes: [],
        position: { x: 0.7, y: 0.7 },
      },
    ],
  },
]

/** Lookup helper: get chain definition for a territory */
export function getChainDef(territory: TerritoryId): ProductionChain | undefined {
  return PRODUCTION_CHAINS.find(c => c.territory === territory)
}

/** Get all node IDs across all chains */
export function getAllNodeIds(): string[] {
  return PRODUCTION_CHAINS.flatMap(c => c.nodes.map(n => n.id))
}

/** Lookup a node definition by ID */
export function getNodeDef(nodeId: string): ProductionNode | undefined {
  for (const chain of PRODUCTION_CHAINS) {
    const node = chain.nodes.find(n => n.id === nodeId)
    if (node) return node
  }
  return undefined
}
