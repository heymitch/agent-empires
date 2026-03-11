# Agent Empires — Autonomous Threat Monitoring & Self-Updating Intelligence

## Sub-PRD 04 — The Nervous System

**Parent PRD:** `01-vision.md` (Phase 2: Intelligence, Phase 5: Integration)
**Dependencies:** `02a-intel-pipeline-spec.md` (Scout/Intel HQ), `02b-enemy-system-spec.md` (Enemy Bestiary)
**System:** Always-on monitoring agents, event bus, threat escalation, freshness tracking, self-improving loop
**Last updated:** 2026-03-10

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Monitoring Agent Architecture](#2-monitoring-agent-architecture)
3. [The Event Bus](#3-the-event-bus)
4. [Supabase Schema](#4-supabase-schema)
5. [Automated Threat Escalation](#5-automated-threat-escalation)
6. [Intelligence Freshness Dashboard](#6-intelligence-freshness-dashboard)
7. [The Self-Improving Loop](#7-the-self-improving-loop)
8. [Integration Specifications](#8-integration-specifications)
9. [Implementation Plan](#9-implementation-plan)

---

## 1. Design Philosophy

The battlefield is alive. Not because we animate it — because it READS the real world and reacts. The general who has to alt-tab to Stripe to check revenue, then alt-tab to Kit to check opens, then alt-tab to Slack to check support — that general is blind. Every second spent gathering intel manually is a second not spent commanding.

The autonomous monitoring system is a network of lightweight sensor processes that run continuously alongside the Agent Empires server. They are NOT Claude Code sessions (those are expensive, token-hungry units). They are simple Node.js intervals and webhook receivers that poll APIs, listen for events, and write structured intel to Supabase. The Intel Router (from `02a`) picks up those Supabase inserts via Realtime and pushes them to the browser as battlefield events.

**Core rules:**

1. **Monitors are dumb pipes.** They fetch data, normalize it, insert it to Supabase. They do NOT interpret, strategize, or decide. The battlefield renderer and the user's brain do the interpretation.
2. **Every monitor has a heartbeat.** If a monitor fails silently, the freshness dashboard catches it within one expected interval and the corresponding territory fogs up.
3. **Monitors run in the Agent Empires server process.** Not as separate tmux sessions, not as cron jobs in agent-runner. They live in `server/monitors/` and are managed by a `MonitorOrchestrator` class.
4. **Cost ceiling: $0/month for monitoring.** We use only free-tier APIs, existing Supabase, and existing Slack tokens. The only "cost" is compute on the user's Mac.
5. **Graceful degradation.** If an API is down, the monitor logs the failure and updates its freshness timestamp. The territory fogs up. The system does not crash, retry-loop, or spam alerts.

---

## 2. Monitoring Agent Architecture

### 2.1 MonitorOrchestrator

Lives in `server/monitors/orchestrator.ts`. Manages the lifecycle of all monitors.

```typescript
interface MonitorConfig {
  id: string
  enabled: boolean
  intervalMs: number            // How often to poll (0 = event-driven only)
  territories: string[]         // Which territories this monitor feeds
  healthCheck?: () => Promise<HealthStatus>
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastSuccess: number           // Unix timestamp
  lastError?: string
  details?: Record<string, any>
}

type MonitorEvent = {
  monitorId: string
  timestamp: number
  territory: string
  eventType: string             // 'revenue.payment', 'content.engagement', etc.
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  title: string
  data: Record<string, any>
  // Optional: maps to enemy spawn from 02b bestiary
  spawnEnemy?: {
    enemyType: string           // 'burning_ticket', 'ghoster', etc.
    territory: string
    metadata: Record<string, any>
  }
}

class MonitorOrchestrator {
  private monitors: Map<string, BaseMonitor> = new Map()
  private supabase: SupabaseClient
  private wsServer: WebSocketServer

  constructor(supabase: SupabaseClient, wsServer: WebSocketServer) { ... }

  /** Register and start all monitors based on config */
  async startAll(config: MonitorConfig[]): Promise<void>

  /** Stop all monitors gracefully */
  async stopAll(): Promise<void>

  /** Get health status for all monitors (used by freshness dashboard) */
  getHealthReport(): Map<string, HealthStatus>

  /** Called by monitors when they have new data */
  async emit(event: MonitorEvent): Promise<void> {
    // 1. Insert to ae_monitor_events table
    // 2. If spawnEnemy, insert to ae_intel with enemy metadata
    // 3. Update ae_monitor_health with latest timestamp
    // 4. WebSocket broadcast for immediate UI update (don't wait for Supabase Realtime lag)
  }
}
```

### 2.2 BaseMonitor

```typescript
abstract class BaseMonitor {
  protected orchestrator: MonitorOrchestrator
  protected config: MonitorConfig
  protected intervalHandle?: NodeJS.Timeout
  protected health: HealthStatus

  constructor(orchestrator: MonitorOrchestrator, config: MonitorConfig) { ... }

  async start(): Promise<void> {
    if (this.config.intervalMs > 0) {
      // Run immediately, then on interval
      await this.tick()
      this.intervalHandle = setInterval(() => this.tick(), this.config.intervalMs)
    }
    // Event-driven monitors override start() to set up listeners
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) clearInterval(this.intervalHandle)
  }

  /** Override this — the actual monitoring logic */
  abstract tick(): Promise<void>

  /** Update health status */
  protected updateHealth(status: HealthStatus['status'], details?: Record<string, any>): void {
    this.health = {
      status,
      latencyMs: Date.now() - (this.health?.lastSuccess || Date.now()),
      lastSuccess: status === 'healthy' ? Date.now() : this.health?.lastSuccess || 0,
      lastError: status === 'down' ? details?.error : undefined,
      details
    }
  }
}
```

### 2.3 The Five Monitors

---

#### Monitor 1: HeartbeatMonitor

**File:** `server/monitors/heartbeat.ts`
**Interval:** 5 minutes (300,000ms)
**Territories affected:** All (system-wide)
**Purpose:** Checks that all external services the system depends on are reachable and responding.

```typescript
class HeartbeatMonitor extends BaseMonitor {
  private services = [
    {
      id: 'supabase',
      name: 'Supabase',
      check: async () => {
        const start = Date.now()
        const { data, error } = await this.supabase
          .from('ae_monitor_health')
          .select('id')
          .limit(1)
        return {
          healthy: !error,
          latencyMs: Date.now() - start,
          error: error?.message
        }
      },
      territories: ['*'],
      degradedThresholdMs: 2000,
      downAfterFailures: 3
    },
    {
      id: 'stripe_webhooks',
      name: 'Stripe Webhook Health',
      check: async () => {
        // Check last Stripe event age — if no events in 24h for an active business, something is wrong
        const { data } = await this.supabase
          .from('ae_monitor_events')
          .select('timestamp')
          .eq('monitor_id', 'revenue')
          .order('timestamp', { ascending: false })
          .limit(1)
        const lastEvent = data?.[0]?.timestamp
        const ageMs = lastEvent ? Date.now() - new Date(lastEvent).getTime() : Infinity
        return {
          healthy: ageMs < 86400000, // 24 hours
          latencyMs: 0,
          error: ageMs === Infinity ? 'No Stripe events ever received' : `Last event ${Math.round(ageMs / 3600000)}h ago`
        }
      },
      territories: ['sales'],
      degradedThresholdMs: 43200000, // 12h without event = degraded
      downAfterFailures: 1
    },
    {
      id: 'slack',
      name: 'Slack Connection',
      check: async () => {
        const start = Date.now()
        const response = await fetch('https://slack.com/api/auth.test', {
          headers: { 'Authorization': `Bearer ${process.env.SLACK_FLOWSTACK_BOT_TOKEN}` }
        })
        const data = await response.json()
        return {
          healthy: data.ok === true,
          latencyMs: Date.now() - start,
          error: data.error
        }
      },
      territories: ['support', 'sales'],
      degradedThresholdMs: 3000,
      downAfterFailures: 3
    },
    {
      id: 'kit_api',
      name: 'Kit/ConvertKit API',
      check: async () => {
        const start = Date.now()
        const response = await fetch(
          `https://api.convertkit.com/v3/account?api_secret=${process.env.KIT_API_SECRET}`
        )
        const data = await response.json()
        return {
          healthy: response.ok && data.name !== undefined,
          latencyMs: Date.now() - start,
          error: response.ok ? undefined : `HTTP ${response.status}`
        }
      },
      territories: ['lead-gen'],
      degradedThresholdMs: 5000,
      downAfterFailures: 3
    }
  ]

  async tick(): Promise<void> {
    const results: Record<string, any> = {}
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy'

    for (const service of this.services) {
      try {
        const result = await service.check()
        results[service.id] = result

        if (!result.healthy) {
          overallStatus = 'down'
          await this.orchestrator.emit({
            monitorId: this.config.id,
            timestamp: Date.now(),
            territory: service.territories[0],
            eventType: 'system.service_down',
            severity: 'high',
            title: `${service.name} is unreachable`,
            data: { serviceId: service.id, error: result.error, latencyMs: result.latencyMs }
          })
        } else if (result.latencyMs > service.degradedThresholdMs) {
          if (overallStatus === 'healthy') overallStatus = 'degraded'
          await this.orchestrator.emit({
            monitorId: this.config.id,
            timestamp: Date.now(),
            territory: service.territories[0],
            eventType: 'system.service_degraded',
            severity: 'medium',
            title: `${service.name} is slow (${result.latencyMs}ms)`,
            data: { serviceId: service.id, latencyMs: result.latencyMs }
          })
        }
      } catch (err) {
        results[service.id] = { healthy: false, error: err.message }
        overallStatus = 'down'
      }
    }

    this.updateHealth(overallStatus, results)
  }
}
```

**Battlefield effects of service health:**

| Status | Visual Effect | Territories |
|--------|--------------|-------------|
| `healthy` | Normal rendering | — |
| `degraded` | Terrain texture shifts to muddy/swampy. Units in affected territory move 50% slower (visual only). Subtle amber pulse on territory border. | Per-service mapping |
| `down` | Territory border turns red and throbs. Fog creeps in at 2x speed. "COMMS DOWN" warning banner on territory. Alert sound plays. | Per-service mapping |

---

#### Monitor 2: RevenueMonitor

**File:** `server/monitors/revenue.ts`
**Interval:** Event-driven (Stripe webhooks) + 15-minute poll for MRR calculation
**Territories affected:** Sales, Retention, HQ
**Purpose:** Tracks all money movement. New payments, refunds, subscription changes, MRR.

**Architecture:** This monitor has TWO modes:
1. **Webhook receiver** — Stripe sends events to a Supabase Edge Function, which inserts to `ae_stripe_events`. The monitor subscribes to that table via Supabase Realtime.
2. **MRR poller** — Every 15 minutes, queries Supabase for current MRR calculation.

```typescript
class RevenueMonitor extends BaseMonitor {
  private currentMRR: number = 0
  private realtimeChannel: any

  async start(): Promise<void> {
    // Subscribe to Stripe events via Supabase Realtime
    this.realtimeChannel = this.supabase
      .channel('stripe-events')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ae_stripe_events' },
        (payload) => this.handleStripeEvent(payload.new)
      )
      .subscribe()

    // Also run MRR poll on interval
    await super.start() // starts the 15-min interval for tick()
  }

  /** Called on every new Stripe event (via Realtime) */
  async handleStripeEvent(event: any): Promise<void> {
    const stripeEvent = event.event_data

    switch (event.event_type) {
      case 'checkout.session.completed':
      case 'invoice.payment_succeeded': {
        const amount = stripeEvent.amount_total || stripeEvent.amount_paid
        const currency = stripeEvent.currency || 'usd'
        const customerEmail = stripeEvent.customer_email || stripeEvent.customer_details?.email

        await this.orchestrator.emit({
          monitorId: 'revenue',
          timestamp: Date.now(),
          territory: 'sales',
          eventType: 'revenue.payment_received',
          severity: 'info',
          title: `Payment received: $${(amount / 100).toFixed(2)} from ${customerEmail || 'customer'}`,
          data: {
            amount: amount / 100,
            currency,
            customerEmail,
            stripeEventId: event.stripe_event_id,
            type: event.event_type
          }
        })
        break
      }

      case 'charge.refunded': {
        const amount = stripeEvent.amount_refunded || stripeEvent.amount
        await this.orchestrator.emit({
          monitorId: 'revenue',
          timestamp: Date.now(),
          territory: 'sales',
          eventType: 'revenue.refund',
          severity: 'high',
          title: `Refund issued: $${(amount / 100).toFixed(2)}`,
          data: { amount: amount / 100, stripeEventId: event.stripe_event_id },
          spawnEnemy: {
            enemyType: 'cancellation_reaper',
            territory: 'sales',
            metadata: { amount: amount / 100, reason: stripeEvent.reason }
          }
        })
        break
      }

      case 'customer.subscription.deleted': {
        const mrr = stripeEvent.plan?.amount || 0
        await this.orchestrator.emit({
          monitorId: 'revenue',
          timestamp: Date.now(),
          territory: 'retention',
          eventType: 'revenue.churn',
          severity: 'critical',
          title: `Subscription cancelled: -$${(mrr / 100).toFixed(2)}/mo`,
          data: {
            mrr: mrr / 100,
            customerId: stripeEvent.customer,
            stripeEventId: event.stripe_event_id
          },
          spawnEnemy: {
            enemyType: 'cancellation_reaper',
            territory: 'retention',
            metadata: { mrr: mrr / 100, customerId: stripeEvent.customer }
          }
        })
        break
      }

      case 'customer.subscription.updated': {
        const oldAmount = stripeEvent.previous_attributes?.plan?.amount
        const newAmount = stripeEvent.plan?.amount
        if (oldAmount && newAmount && newAmount < oldAmount) {
          await this.orchestrator.emit({
            monitorId: 'revenue',
            timestamp: Date.now(),
            territory: 'retention',
            eventType: 'revenue.downgrade',
            severity: 'medium',
            title: `Downgrade: $${(oldAmount / 100).toFixed(2)} → $${(newAmount / 100).toFixed(2)}/mo`,
            data: { oldAmount: oldAmount / 100, newAmount: newAmount / 100 },
            spawnEnemy: {
              enemyType: 'downgrader',
              territory: 'retention',
              metadata: { delta: (oldAmount - newAmount) / 100 }
            }
          })
        }
        break
      }

      case 'invoice.payment_failed': {
        await this.orchestrator.emit({
          monitorId: 'revenue',
          timestamp: Date.now(),
          territory: 'sales',
          eventType: 'revenue.payment_failed',
          severity: 'high',
          title: `Payment failed: ${stripeEvent.customer_email || 'customer'}`,
          data: {
            amount: (stripeEvent.amount_due || 0) / 100,
            customerEmail: stripeEvent.customer_email,
            attemptCount: stripeEvent.attempt_count
          },
          spawnEnemy: {
            enemyType: 'burning_ticket',
            territory: 'sales',
            metadata: { type: 'payment_failed' }
          }
        })
        break
      }
    }

    this.updateHealth('healthy')
  }

  /** Periodic MRR calculation */
  async tick(): Promise<void> {
    try {
      const { data, error } = await this.supabase.rpc('calculate_mrr')

      if (error) {
        this.updateHealth('degraded', { error: error.message })
        return
      }

      const newMRR = data?.mrr || 0
      const delta = newMRR - this.currentMRR

      if (this.currentMRR > 0 && Math.abs(delta) > 0) {
        await this.orchestrator.emit({
          monitorId: 'revenue',
          timestamp: Date.now(),
          territory: 'sales',
          eventType: 'revenue.mrr_update',
          severity: 'info',
          title: `MRR: $${newMRR.toFixed(2)} (${delta >= 0 ? '+' : ''}$${delta.toFixed(2)})`,
          data: { mrr: newMRR, previousMrr: this.currentMRR, delta }
        })
      }

      this.currentMRR = newMRR
      this.updateHealth('healthy', { mrr: newMRR })
    } catch (err) {
      this.updateHealth('down', { error: err.message })
    }
  }
}
```

**Battlefield effects:**

| Event | Visual | Sound |
|-------|--------|-------|
| Payment received | Gold coin particles burst from Sales territory. Amount floats upward as text. Resource bar gold counter animates up. | Cash register ching (Tone.js: metallic ping, 2kHz→4kHz sweep, 150ms) |
| Refund | Red coins drain downward from Sales territory. Amount floats down. Cancellation Reaper spawns per 02b bestiary. | Low descending tone (200Hz→80Hz, 500ms) |
| Subscription cancelled | Cancellation Reaper spawns at Retention border. MRR in resource bar ticks down in red. | War drum hit |
| Downgrade | Downgrader spawns in Retention. Small amber flash on territory. | Minor chord stab |
| Payment failed | Burning Ticket spawns in Sales. Small fire particle at customer position. | Alert klaxon (short) |
| MRR update (positive) | Resource bar gold pulses green briefly. | Subtle ascending chime |
| MRR update (negative) | Resource bar gold pulses red briefly. | Subtle descending tone |

---

#### Monitor 3: ContentPerformanceMonitor

**File:** `server/monitors/content-performance.ts`
**Interval:** 60 minutes (3,600,000ms) — respects API rate limits
**Territories affected:** Lead-Gen, Content
**Purpose:** Tracks how published content is performing across LinkedIn and email.

```typescript
class ContentPerformanceMonitor extends BaseMonitor {
  /** LinkedIn analytics via Shield API */
  private async fetchLinkedInMetrics(): Promise<any> {
    // Shield provides a simple REST API for LinkedIn analytics
    // Free tier: 100 requests/day — our 24 hourly polls = 24 requests, well within limit
    const response = await fetch(
      'https://shield-api.com/api/v1/stats/posts?days=7',
      {
        headers: {
          'Authorization': `Bearer ${process.env.SHIELD_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.ok) throw new Error(`Shield API: ${response.status}`)
    return response.json()
  }

  /** Kit/ConvertKit broadcast stats */
  private async fetchEmailMetrics(): Promise<any> {
    // Get recent broadcasts with stats
    const response = await fetch(
      `https://api.convertkit.com/v3/broadcasts?api_secret=${process.env.KIT_API_SECRET}&page=1&per_page=5`
    )

    if (!response.ok) throw new Error(`Kit API: ${response.status}`)
    const data = await response.json()

    // For each broadcast, get stats
    const broadcasts = data.broadcasts || []
    const withStats = []

    for (const broadcast of broadcasts.slice(0, 3)) {
      const statsResponse = await fetch(
        `https://api.convertkit.com/v3/broadcasts/${broadcast.id}/stats?api_secret=${process.env.KIT_API_SECRET}`
      )
      if (statsResponse.ok) {
        const stats = await statsResponse.json()
        withStats.push({ ...broadcast, stats: stats.broadcast })
      }
    }

    return withStats
  }

  async tick(): Promise<void> {
    const errors: string[] = []

    // --- LinkedIn ---
    try {
      const linkedInData = await this.fetchLinkedInMetrics()
      const posts = linkedInData.data || []

      // Aggregate last 7 days
      let totalImpressions = 0
      let totalEngagement = 0
      let totalPosts = posts.length

      for (const post of posts) {
        totalImpressions += post.impressions || 0
        totalEngagement += (post.likes || 0) + (post.comments || 0) + (post.shares || 0)
      }

      const engagementRate = totalImpressions > 0
        ? (totalEngagement / totalImpressions * 100)
        : 0

      await this.orchestrator.emit({
        monitorId: 'content-performance',
        timestamp: Date.now(),
        territory: 'lead-gen',
        eventType: 'content.linkedin_update',
        severity: engagementRate < 1.0 ? 'medium' : 'info',
        title: `LinkedIn 7d: ${totalImpressions.toLocaleString()} impressions, ${engagementRate.toFixed(1)}% engagement`,
        data: {
          platform: 'linkedin',
          impressions: totalImpressions,
          engagement: totalEngagement,
          engagementRate,
          postCount: totalPosts,
          period: '7d'
        }
      })

      // Check for viral posts (>5x average impressions)
      const avgImpressions = totalImpressions / Math.max(totalPosts, 1)
      for (const post of posts) {
        if (post.impressions > avgImpressions * 5 && post.impressions > 1000) {
          await this.orchestrator.emit({
            monitorId: 'content-performance',
            timestamp: Date.now(),
            territory: 'lead-gen',
            eventType: 'content.viral_post',
            severity: 'info',
            title: `Viral post: ${post.impressions.toLocaleString()} impressions — "${(post.text || '').substring(0, 60)}..."`,
            data: { platform: 'linkedin', postId: post.id, impressions: post.impressions }
          })
        }
      }

      // Check for engagement death (rate < 0.5%)
      if (engagementRate < 0.5 && totalPosts >= 3) {
        await this.orchestrator.emit({
          monitorId: 'content-performance',
          timestamp: Date.now(),
          territory: 'lead-gen',
          eventType: 'content.engagement_crisis',
          severity: 'high',
          title: `LinkedIn engagement crisis: ${engagementRate.toFixed(1)}% across ${totalPosts} posts`,
          data: { platform: 'linkedin', engagementRate, postCount: totalPosts },
          spawnEnemy: {
            enemyType: 'content_decay',
            territory: 'lead-gen',
            metadata: { engagementRate, platform: 'linkedin' }
          }
        })
      }
    } catch (err) {
      errors.push(`LinkedIn: ${err.message}`)
    }

    // --- Kit/ConvertKit ---
    try {
      const emailData = await this.fetchEmailMetrics()

      for (const broadcast of emailData) {
        const stats = broadcast.stats
        if (!stats) continue

        const openRate = stats.open_rate || 0
        const clickRate = stats.click_rate || 0

        await this.orchestrator.emit({
          monitorId: 'content-performance',
          timestamp: Date.now(),
          territory: 'lead-gen',
          eventType: 'content.email_update',
          severity: openRate < 0.20 ? 'medium' : 'info',
          title: `Email "${broadcast.subject}": ${(openRate * 100).toFixed(1)}% open, ${(clickRate * 100).toFixed(1)}% click`,
          data: {
            platform: 'kit',
            broadcastId: broadcast.id,
            subject: broadcast.subject,
            openRate,
            clickRate,
            recipients: stats.recipients || 0,
            sentAt: broadcast.sent_at
          }
        })
      }
    } catch (err) {
      errors.push(`Kit: ${err.message}`)
    }

    // Update health
    if (errors.length === 0) {
      this.updateHealth('healthy')
    } else if (errors.length < 2) {
      this.updateHealth('degraded', { errors })
    } else {
      this.updateHealth('down', { errors })
    }
  }
}
```

**Battlefield effects:**

| Metric | Visual | Threshold |
|--------|--------|-----------|
| LinkedIn engagement > 3% | Lead-Gen territory glows warm gold. Pulsing "content shield" effect around border. | Per check |
| LinkedIn engagement 1-3% | Normal territory rendering | — |
| LinkedIn engagement < 1% | Fog creeps into Lead-Gen at 1.5x speed. Territory border dims. | Per check |
| LinkedIn engagement < 0.5% | Content Decay enemy spawns. Territory flickers. | Per check |
| Email open rate > 40% | Lead-Gen gets a brief green flash. | Per broadcast |
| Email open rate < 20% | Amber warning flash on Lead-Gen. | Per broadcast |
| Viral post detected | Bright flare + expanding ring animation from Lead-Gen center. | >5x avg impressions |

---

#### Monitor 4: CompetitorMonitor

**File:** `server/monitors/competitor.ts`
**Interval:** 6 hours (21,600,000ms)
**Territories affected:** Lead-Gen, Sales
**Purpose:** Watches competitor activity for relevant signals. Runs infrequently because competitive intel has low time-sensitivity and we want to stay well within rate limits.

**Important cost constraint:** This monitor does NOT use paid APIs or AI analysis in the monitoring loop. It fetches public data, stores raw signals, and lets the user (or a deployed Scout unit) do the interpretation.

```typescript
interface CompetitorProfile {
  name: string
  domains: string[]           // Websites to check for changes
  socialHandles: {
    linkedin?: string
    twitter?: string
  }
  keywords: string[]          // Alert on these terms in their content
  lastKnownPricing?: Record<string, number>
}

class CompetitorMonitor extends BaseMonitor {
  private competitors: CompetitorProfile[] = []

  async start(): Promise<void> {
    // Load competitor profiles from Supabase
    const { data } = await this.supabase
      .from('ae_competitor_profiles')
      .select('*')
      .eq('active', true)

    this.competitors = data || []
    await super.start()
  }

  async tick(): Promise<void> {
    for (const competitor of this.competitors) {
      try {
        await this.checkCompetitor(competitor)
      } catch (err) {
        // Log but don't fail the whole monitor for one competitor
        console.warn(`Competitor check failed for ${competitor.name}: ${err.message}`)
      }

      // Rate limit: 2 second pause between competitors
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    this.updateHealth('healthy')
  }

  private async checkCompetitor(competitor: CompetitorProfile): Promise<void> {
    // Check each domain for changes using HEAD request + ETag/Last-Modified
    for (const domain of competitor.domains) {
      try {
        const response = await fetch(domain, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
        const lastModified = response.headers.get('last-modified')
        const etag = response.headers.get('etag')

        // Compare with stored values
        const { data: stored } = await this.supabase
          .from('ae_competitor_checks')
          .select('last_modified, etag')
          .eq('competitor_name', competitor.name)
          .eq('url', domain)
          .single()

        const hasChanged = stored && (
          (lastModified && lastModified !== stored.last_modified) ||
          (etag && etag !== stored.etag)
        )

        // Upsert check record
        await this.supabase
          .from('ae_competitor_checks')
          .upsert({
            competitor_name: competitor.name,
            url: domain,
            last_modified: lastModified,
            etag: etag,
            last_checked: new Date().toISOString(),
            changed: hasChanged
          }, { onConflict: 'competitor_name,url' })

        if (hasChanged) {
          await this.orchestrator.emit({
            monitorId: 'competitor',
            timestamp: Date.now(),
            territory: 'lead-gen',
            eventType: 'competitor.website_changed',
            severity: 'low',
            title: `${competitor.name} website updated: ${domain}`,
            data: { competitor: competitor.name, url: domain, lastModified },
            spawnEnemy: {
              enemyType: 'competitor_scout',
              territory: 'lead-gen',
              metadata: { competitor: competitor.name, changeType: 'website' }
            }
          })
        }
      } catch (err) {
        // Site unreachable — not our problem, skip
      }
    }
  }
}
```

**Cost management:**
- HEAD requests only for website monitoring — no page content downloaded
- 6-hour interval = 4 checks/day per competitor
- No paid scraping APIs
- Competitive intel from social media is deferred to Scout deployments (Claude sessions) triggered manually or by campaign objectives
- Competitor profiles stored in Supabase, manageable via the Command Bar

**Battlefield effects:**

| Event | Visual |
|-------|--------|
| Competitor website change | Small purple scout sprite appears at Lead-Gen border, holds position for 2 hours, then fades. Clicking it shows the intel detail. |
| New competitor product detected (manual Scout report) | Purple knight spawns at the relevant territory border per 02b bestiary. |

---

#### Monitor 5: SupportMonitor

**File:** `server/monitors/support.ts`
**Interval:** Event-driven (Slack Socket Mode) + 10-minute aging check
**Territories affected:** Support, Fulfillment
**Purpose:** Tracks incoming support requests and escalates them as they age.

```typescript
class SupportMonitor extends BaseMonitor {
  /** Listen for Slack messages in support channels */
  async start(): Promise<void> {
    // The Slack Socket Mode connection already exists in agent-runner.
    // This monitor reads from the ae_support_tickets table, which is populated
    // by the agent-runner Slack trigger when messages arrive in support channels.
    //
    // We also run a 10-minute tick to check for aging tickets.
    await super.start()
  }

  /** Called when agent-runner inserts a new support ticket */
  async handleNewTicket(ticket: {
    id: string
    source: 'slack' | 'email' | 'form'
    channel?: string
    messageTs?: string
    customerName: string
    subject: string
    body: string
    createdAt: number
  }): Promise<void> {
    await this.orchestrator.emit({
      monitorId: 'support',
      timestamp: Date.now(),
      territory: 'support',
      eventType: 'support.new_ticket',
      severity: 'medium',
      title: `New support request from ${ticket.customerName}: ${ticket.subject}`,
      data: ticket,
      spawnEnemy: {
        enemyType: 'burning_ticket',
        territory: 'support',
        metadata: {
          ticketId: ticket.id,
          source: ticket.source,
          createdAt: ticket.createdAt
        }
      }
    })
  }

  /** Periodic check for aging tickets */
  async tick(): Promise<void> {
    try {
      const { data: openTickets, error } = await this.supabase
        .from('ae_support_tickets')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: true })

      if (error) {
        this.updateHealth('degraded', { error: error.message })
        return
      }

      const now = Date.now()

      for (const ticket of (openTickets || [])) {
        const ageMs = now - new Date(ticket.created_at).getTime()
        const ageHours = ageMs / 3600000
        const currentEscalation = ticket.escalation_level || 0

        // Escalation thresholds (hours)
        // Level 0 → 1: 4 hours (patrol → advance)
        // Level 1 → 2: 12 hours (advance → siege prep)
        // Level 2 → 3: 24 hours (siege → wildfire per 02b)
        let newEscalation = 0
        if (ageHours >= 24) newEscalation = 3
        else if (ageHours >= 12) newEscalation = 2
        else if (ageHours >= 4) newEscalation = 1

        if (newEscalation > currentEscalation) {
          // Update ticket escalation level
          await this.supabase
            .from('ae_support_tickets')
            .update({ escalation_level: newEscalation })
            .eq('id', ticket.id)

          const severityMap = ['medium', 'high', 'high', 'critical'] as const
          const stageNames = ['new', 'aging', 'urgent', 'critical']

          await this.orchestrator.emit({
            monitorId: 'support',
            timestamp: Date.now(),
            territory: 'support',
            eventType: 'support.ticket_escalated',
            severity: severityMap[newEscalation],
            title: `Ticket escalated to ${stageNames[newEscalation]}: "${ticket.subject}" (${ageHours.toFixed(0)}h old)`,
            data: {
              ticketId: ticket.id,
              ageHours,
              escalationLevel: newEscalation,
              customerName: ticket.customer_name,
              subject: ticket.subject
            }
          })
        }
      }

      this.updateHealth('healthy', { openTickets: openTickets?.length || 0 })
    } catch (err) {
      this.updateHealth('down', { error: err.message })
    }
  }
}
```

**Escalation visual mapping (ties into 02b Burning Ticket enemy):**

| Escalation Level | Age | Enemy Behavior | Visual | Sound |
|-----------------|-----|----------------|--------|-------|
| 0 — New | 0-4h | Burning Ticket spawns, small flame, slow movement | Small fire sprite, gentle flicker | Subtle alert ping |
| 1 — Aging | 4-12h | Flame doubles in size, movement speed 2x | Medium fire, smoke particles | Radar blip (repeating) |
| 2 — Urgent | 12-24h | Flame large, aggressive movement toward Sales border | Large fire, sparks flying, screen edge amber tint | War drum + alert tone |
| 3 — Critical | 24h+ | Transforms to Wildfire (02b). AOE damage. | Massive fire, territory-wide red tint, screen shake | Siren |

---

## 3. The Event Bus

### 3.1 Pipeline

```
Monitor.tick() / Monitor.handleEvent()
    |
    v
MonitorOrchestrator.emit(MonitorEvent)
    |
    ├──→ INSERT ae_monitor_events (persistence)
    |
    ├──→ INSERT ae_intel (if severity >= medium, for Intel Panel)
    |
    ├──→ INSERT ae_enemy_spawns (if spawnEnemy defined, for enemy system)
    |
    ├──→ UPDATE ae_monitor_health (freshness tracking)
    |
    └──→ WebSocket broadcast (immediate UI update)
```

### 3.2 WebSocket Event Contract

Every monitor event that reaches the browser is wrapped in this envelope:

```typescript
/** Server → Browser WebSocket message */
interface WSMonitorEvent {
  type: 'monitor_event'
  payload: {
    id: string                  // UUID
    monitorId: string           // 'heartbeat', 'revenue', 'content-performance', etc.
    timestamp: number           // Unix ms
    territory: string           // Target territory ID
    eventType: string           // Dotted event type: 'revenue.payment_received'
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
    title: string               // Human-readable one-liner
    data: Record<string, any>   // Full event payload
    spawnEnemy?: {
      enemyType: string
      territory: string
      metadata: Record<string, any>
    }
  }
}

/** Health status broadcast (every 5 minutes) */
interface WSHealthUpdate {
  type: 'health_update'
  payload: {
    monitors: Record<string, {
      status: 'healthy' | 'degraded' | 'down'
      lastSuccess: number
      latencyMs: number
    }>
    territories: Record<string, {
      fogLevel: number          // Calculated from source freshness
      threatLevel: number       // Calculated from active enemies
      activeEnemies: number
    }>
  }
}

/** Freshness update for a single source */
interface WSFreshnessUpdate {
  type: 'freshness_update'
  payload: {
    sourceId: string
    lastUpdated: number
    freshnessLevel: 'fresh' | 'aging' | 'stale'
    affectedTerritories: string[]
  }
}
```

### 3.3 Browser Event Handling

```typescript
// In the browser client (src/monitors/MonitorEventHandler.ts)
class MonitorEventHandler {
  private battlefield: Battlefield
  private hud: HUD
  private enemySpawner: EnemySpawner
  private soundManager: SoundManager

  handleEvent(msg: WSMonitorEvent): void {
    const { payload } = msg

    // 1. Add to Intel Panel feed
    this.hud.intelPanel.addEntry({
      timestamp: payload.timestamp,
      title: payload.title,
      severity: payload.severity,
      territory: payload.territory,
      data: payload.data
    })

    // 2. Spawn enemy if indicated
    if (payload.spawnEnemy) {
      this.enemySpawner.spawn(
        payload.spawnEnemy.enemyType,
        payload.spawnEnemy.territory,
        payload.spawnEnemy.metadata
      )
    }

    // 3. Territory effects
    this.battlefield.getTerritory(payload.territory)?.flashSeverity(payload.severity)

    // 4. Minimap ping
    this.hud.minimap.ping(payload.territory, payload.severity)

    // 5. Sound
    const soundMap: Record<string, string> = {
      'revenue.payment_received': 'cash_register',
      'revenue.refund': 'descending_tone',
      'revenue.churn': 'war_drum',
      'support.new_ticket': 'alert_ping',
      'support.ticket_escalated': 'radar_blip',
      'content.viral_post': 'victory_stinger',
      'content.engagement_crisis': 'alarm_low',
      'competitor.website_changed': 'radio_crackle',
      'system.service_down': 'siren_short'
    }

    const sound = soundMap[payload.eventType]
    if (sound) this.soundManager.play(sound, { territory: payload.territory })

    // 6. Notification tray for high/critical
    if (payload.severity === 'high' || payload.severity === 'critical') {
      this.hud.notifications.push({
        title: payload.title,
        severity: payload.severity,
        territory: payload.territory,
        timestamp: payload.timestamp,
        action: payload.spawnEnemy
          ? { label: 'Deploy Medic', command: `deploy medic to ${payload.territory}` }
          : { label: 'View Intel', command: `focus ${payload.territory}` }
      })
    }
  }

  handleHealthUpdate(msg: WSHealthUpdate): void {
    const { payload } = msg

    // Update territory fog levels
    for (const [territoryId, state] of Object.entries(payload.territories)) {
      const territory = this.battlefield.getTerritory(territoryId)
      if (territory) {
        territory.setFogLevel(state.fogLevel)
        territory.setThreatLevel(state.threatLevel)
      }
    }

    // Update freshness indicators in HUD
    this.hud.freshnessPanel.update(payload.monitors)
  }
}
```

---

## 4. Supabase Schema

### 4.1 New Tables

```sql
-- =====================================================
-- Monitor Events — the raw stream of all monitoring data
-- =====================================================
CREATE TABLE ae_monitor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id TEXT NOT NULL,        -- 'heartbeat', 'revenue', 'content-performance', 'competitor', 'support'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  territory TEXT NOT NULL,
  event_type TEXT NOT NULL,        -- 'revenue.payment_received', 'support.new_ticket', etc.
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  spawn_enemy JSONB,              -- If this event should spawn an enemy
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for time-range queries (Intel Panel, dashboards)
CREATE INDEX idx_ae_monitor_events_timestamp ON ae_monitor_events (timestamp DESC);
CREATE INDEX idx_ae_monitor_events_territory ON ae_monitor_events (territory, timestamp DESC);
CREATE INDEX idx_ae_monitor_events_severity ON ae_monitor_events (severity, timestamp DESC);
CREATE INDEX idx_ae_monitor_events_type ON ae_monitor_events (event_type, timestamp DESC);

-- Partition hint: after 90 days of running, add monthly partitions.
-- For now, a single table with indexes is fine for the expected volume (~500 events/day).


-- =====================================================
-- Monitor Health — current status of each monitor
-- =====================================================
CREATE TABLE ae_monitor_health (
  monitor_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy',   -- 'healthy', 'degraded', 'down'
  last_success TIMESTAMPTZ,
  last_check TIMESTAMPTZ DEFAULT now(),
  latency_ms INTEGER DEFAULT 0,
  last_error TEXT,
  details JSONB DEFAULT '{}',
  territories TEXT[] NOT NULL DEFAULT '{}',  -- Which territories this monitor feeds
  expected_interval_ms INTEGER NOT NULL,     -- How often this monitor should report
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed with monitor definitions
INSERT INTO ae_monitor_health (monitor_id, territories, expected_interval_ms) VALUES
  ('heartbeat', ARRAY['*'], 300000),
  ('revenue', ARRAY['sales', 'retention'], 900000),
  ('content-performance', ARRAY['lead-gen'], 3600000),
  ('competitor', ARRAY['lead-gen', 'sales'], 21600000),
  ('support', ARRAY['support', 'fulfillment'], 600000);


-- =====================================================
-- Stripe Events — raw Stripe webhook events
-- Populated by the Supabase Edge Function that receives Stripe webhooks
-- =====================================================
CREATE TABLE ae_stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,         -- 'checkout.session.completed', 'customer.subscription.deleted', etc.
  event_data JSONB NOT NULL,        -- Full Stripe event object
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_stripe_events_type ON ae_stripe_events (event_type, created_at DESC);
CREATE INDEX idx_ae_stripe_events_processed ON ae_stripe_events (processed) WHERE NOT processed;

-- Enable Realtime for revenue monitor subscription
ALTER PUBLICATION supabase_realtime ADD TABLE ae_stripe_events;


-- =====================================================
-- Support Tickets — tracked support requests
-- =====================================================
CREATE TABLE ae_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,              -- 'slack', 'email', 'form'
  source_id TEXT,                    -- Slack message ts, email ID, etc.
  channel TEXT,                      -- Slack channel ID
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  subject TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open', 'acknowledged', 'resolved', 'closed'
  escalation_level INTEGER DEFAULT 0,  -- 0=new, 1=aging, 2=urgent, 3=critical
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  assigned_unit TEXT,                -- Session ID of the unit handling it
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_support_tickets_status ON ae_support_tickets (status, created_at);
CREATE INDEX idx_ae_support_tickets_escalation ON ae_support_tickets (escalation_level) WHERE status = 'open';

-- Enable Realtime for support monitor
ALTER PUBLICATION supabase_realtime ADD TABLE ae_support_tickets;


-- =====================================================
-- Competitor Profiles — who we watch
-- =====================================================
CREATE TABLE ae_competitor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  domains TEXT[] DEFAULT '{}',
  social_handles JSONB DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  last_known_pricing JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- Competitor Checks — HEAD request cache
-- =====================================================
CREATE TABLE ae_competitor_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_name TEXT NOT NULL,
  url TEXT NOT NULL,
  last_modified TEXT,
  etag TEXT,
  last_checked TIMESTAMPTZ DEFAULT now(),
  changed BOOLEAN DEFAULT false,
  UNIQUE(competitor_name, url)
);


-- =====================================================
-- Learned Patterns — self-improving loop storage
-- =====================================================
CREATE TABLE ae_learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,        -- 'temporal', 'correlation', 'trend', 'seasonal'
  title TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL,         -- When this pattern applies
  recommended_action JSONB,          -- What to do (auto-deploy, alert, etc.)
  confidence REAL DEFAULT 0.5,       -- 0.0 to 1.0, increases with confirmations
  times_triggered INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,   -- User confirmed the recommendation was right
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- =====================================================
-- MRR Calculation Function
-- Used by RevenueMonitor.tick() every 15 minutes
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_mrr()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- This is a simplified MRR calculation.
  -- In production, you'd query Stripe subscriptions directly.
  -- This queries from our cached stripe events for active subscriptions.
  SELECT json_build_object(
    'mrr', COALESCE(SUM((event_data->'plan'->>'amount')::numeric / 100), 0),
    'active_subscriptions', COUNT(*),
    'calculated_at', now()
  ) INTO result
  FROM ae_stripe_events
  WHERE event_type = 'customer.subscription.updated'
    AND event_data->>'status' = 'active'
    AND created_at = (
      SELECT MAX(created_at)
      FROM ae_stripe_events e2
      WHERE e2.event_data->>'customer' = ae_stripe_events.event_data->>'customer'
        AND e2.event_type LIKE 'customer.subscription.%'
    );

  RETURN result;
END;
$$ LANGUAGE plpgsql;
```

### 4.2 Stripe Webhook Edge Function

```sql
-- Deploy as Supabase Edge Function: supabase/functions/stripe-webhook/index.ts
```

```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  // Events we care about for the battlefield
  const relevantEvents = [
    'checkout.session.completed',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'charge.refunded',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed'
  ]

  if (!relevantEvents.includes(event.type)) {
    return new Response(JSON.stringify({ received: true, relevant: false }), { status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase
    .from('ae_stripe_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object
    })

  if (error) {
    console.error('Failed to insert Stripe event:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ received: true, stored: true }), { status: 200 })
})
```

**Stripe webhook setup:**
1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://dquuimhmbofdhdsbdbly.supabase.co/functions/v1/stripe-webhook`
3. Events to listen for: all 9 events listed in `relevantEvents` above
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` in Supabase Edge Function secrets

---

## 5. Automated Threat Escalation

### 5.1 Escalation State Machine

Every enemy on the battlefield follows a state machine that escalates over time if not addressed. The escalation is driven by the SupportMonitor (for tickets) and by a generic `EscalationEngine` on the server that manages all enemy lifespans.

```typescript
// server/escalation/EscalationEngine.ts

interface EscalationRule {
  enemyType: string
  stages: EscalationStage[]
}

interface EscalationStage {
  level: number
  afterMinutes: number          // Minutes since spawn
  severity: 'low' | 'medium' | 'high' | 'critical'
  visualChange: string          // Description for renderer
  soundAlert: string            // Sound cue ID
  hudWarning: string            // Text for notification tray
  recommendedUnit?: string      // Unit type to recommend deploying
  autoDeployAllowed: boolean    // Can system auto-deploy with user's standing permission?
}

const ESCALATION_RULES: EscalationRule[] = [
  {
    enemyType: 'burning_ticket',
    stages: [
      {
        level: 0,
        afterMinutes: 0,
        severity: 'medium',
        visualChange: 'small_flame',
        soundAlert: 'alert_ping',
        hudWarning: 'New support ticket',
        recommendedUnit: 'medic',
        autoDeployAllowed: false
      },
      {
        level: 1,
        afterMinutes: 240,         // 4 hours
        severity: 'high',
        visualChange: 'medium_flame_smoke',
        soundAlert: 'radar_blip',
        hudWarning: 'Support ticket aging (4h+)',
        recommendedUnit: 'medic',
        autoDeployAllowed: false
      },
      {
        level: 2,
        afterMinutes: 720,         // 12 hours
        severity: 'high',
        visualChange: 'large_flame_sparks_border_advance',
        soundAlert: 'war_drum',
        hudWarning: 'URGENT: Support ticket 12h+ without response',
        recommendedUnit: 'medic',
        autoDeployAllowed: true     // System can auto-deploy medic at this stage
      },
      {
        level: 3,
        afterMinutes: 1440,        // 24 hours
        severity: 'critical',
        visualChange: 'wildfire_transform',
        soundAlert: 'siren',
        hudWarning: 'CRITICAL: Ticket transforming to Wildfire',
        recommendedUnit: 'medic',
        autoDeployAllowed: true
      }
    ]
  },
  {
    enemyType: 'cancellation_reaper',
    stages: [
      {
        level: 0,
        afterMinutes: 0,
        severity: 'high',
        visualChange: 'reaper_spawn',
        soundAlert: 'war_drum',
        hudWarning: 'Customer cancellation detected',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: false
      },
      {
        level: 1,
        afterMinutes: 360,         // 6 hours
        severity: 'high',
        visualChange: 'reaper_advance_glow_intensify',
        soundAlert: 'alarm_low',
        hudWarning: 'Cancellation advancing — outreach window closing',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: false
      },
      {
        level: 2,
        afterMinutes: 1440,        // 24 hours
        severity: 'critical',
        visualChange: 'reaper_at_gates_mrr_drain_visible',
        soundAlert: 'siren',
        hudWarning: 'CRITICAL: Cancellation reaching point of no return',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: true
      }
    ]
  },
  {
    enemyType: 'ghoster',
    stages: [
      {
        level: 0,
        afterMinutes: 0,
        severity: 'low',
        visualChange: 'translucent_figure_drift',
        soundAlert: 'subtle_ping',
        hudWarning: 'Inactive customer detected',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: false
      },
      {
        level: 1,
        afterMinutes: 2880,        // 48 hours of game time (represents 14+ days dormancy already)
        severity: 'medium',
        visualChange: 'ghoster_fading_faster',
        soundAlert: 'radar_blip',
        hudWarning: 'Customer nearing exit — re-engagement recommended',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: false
      },
      {
        level: 2,
        afterMinutes: 4320,        // 72 hours (customer has been gone 21+ days)
        severity: 'high',
        visualChange: 'ghoster_at_border_nearly_invisible',
        soundAlert: 'alarm_low',
        hudWarning: 'Customer about to churn — last chance for outreach',
        recommendedUnit: 'diplomat',
        autoDeployAllowed: true
      }
    ]
  },
  {
    enemyType: 'content_decay',
    stages: [
      {
        level: 0,
        afterMinutes: 0,
        severity: 'medium',
        visualChange: 'sickly_green_aura_territory',
        soundAlert: 'radio_crackle',
        hudWarning: 'Content engagement declining',
        recommendedUnit: 'writer',
        autoDeployAllowed: false
      },
      {
        level: 1,
        afterMinutes: 10080,       // 7 days
        severity: 'high',
        visualChange: 'territory_dimming_fog_creep',
        soundAlert: 'alarm_low',
        hudWarning: 'Content engagement crisis ongoing — 7 days',
        recommendedUnit: 'writer',
        autoDeployAllowed: false
      }
    ]
  },
  {
    enemyType: 'competitor_scout',
    stages: [
      {
        level: 0,
        afterMinutes: 0,
        severity: 'low',
        visualChange: 'purple_scout_border',
        soundAlert: 'radio_crackle',
        hudWarning: 'Competitor activity detected',
        recommendedUnit: 'scout',
        autoDeployAllowed: false
      }
      // Competitor scouts don't escalate — they're informational
    ]
  }
]
```

### 5.2 Escalation Tick

The `EscalationEngine` runs every 60 seconds and checks all active enemies:

```typescript
class EscalationEngine {
  private activeEnemies: Map<string, ActiveEnemy> = new Map()
  private rules: Map<string, EscalationRule>
  private autoDeployEnabled: boolean = false // User must opt in

  constructor(
    private orchestrator: MonitorOrchestrator,
    private wsServer: WebSocketServer
  ) {
    this.rules = new Map(ESCALATION_RULES.map(r => [r.enemyType, r]))
    setInterval(() => this.tick(), 60000) // Every minute
  }

  /** Register a new enemy from a monitor event */
  registerEnemy(id: string, enemyType: string, territory: string, metadata: any): void {
    this.activeEnemies.set(id, {
      id,
      enemyType,
      territory,
      metadata,
      spawnedAt: Date.now(),
      currentLevel: 0
    })
  }

  /** Remove an enemy (threat resolved) */
  resolveEnemy(id: string): void {
    this.activeEnemies.delete(id)
  }

  /** Check all enemies for escalation */
  private tick(): void {
    const now = Date.now()

    for (const [id, enemy] of this.activeEnemies) {
      const rule = this.rules.get(enemy.enemyType)
      if (!rule) continue

      const ageMinutes = (now - enemy.spawnedAt) / 60000

      // Find the highest stage this enemy qualifies for
      let targetLevel = 0
      for (const stage of rule.stages) {
        if (ageMinutes >= stage.afterMinutes) {
          targetLevel = stage.level
        }
      }

      if (targetLevel > enemy.currentLevel) {
        const stage = rule.stages.find(s => s.level === targetLevel)!
        enemy.currentLevel = targetLevel

        // Broadcast escalation
        this.wsServer.broadcast({
          type: 'enemy_escalation',
          payload: {
            enemyId: id,
            enemyType: enemy.enemyType,
            territory: enemy.territory,
            newLevel: targetLevel,
            severity: stage.severity,
            visualChange: stage.visualChange,
            soundAlert: stage.soundAlert,
            hudWarning: stage.hudWarning,
            recommendedUnit: stage.recommendedUnit,
            autoDeployAllowed: stage.autoDeployAllowed && this.autoDeployEnabled
          }
        })

        // Auto-deploy if allowed and enabled
        if (stage.autoDeployAllowed && this.autoDeployEnabled && stage.recommendedUnit) {
          this.wsServer.broadcast({
            type: 'auto_deploy_request',
            payload: {
              unitType: stage.recommendedUnit,
              territory: enemy.territory,
              reason: stage.hudWarning,
              enemyId: id,
              // The browser UI shows a confirmation toast:
              // "Auto-deploying Medic to Support (ticket 12h+ aging). [Cancel 10s]"
              cancellableForMs: 10000
            }
          })
        }
      }
    }
  }
}
```

### 5.3 Auto-Deploy Permission System

Auto-deploy is OFF by default. The user enables it via the Command Bar:

```
> enable auto-deploy for critical threats
> enable auto-deploy medic
> disable auto-deploy
> auto-deploy settings
```

Stored in `ae_user_preferences` (see schema below):

```sql
CREATE TABLE ae_user_preferences (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ae_user_preferences (key, value) VALUES
  ('auto_deploy', '{"enabled": false, "allowedUnitTypes": [], "minSeverity": "critical"}');
```

When auto-deploy fires, the browser shows a **10-second cancellable toast**:
- "Auto-deploying Medic to Support — Ticket #xyz aging 12h+ [Cancel]"
- If the user clicks Cancel within 10 seconds, the deploy is aborted
- If no cancel, the system sends `POST /sessions` to spawn the unit with the appropriate template and initial prompt

---

## 6. Intelligence Freshness Dashboard

### 6.1 HUD Integration

The freshness panel is a collapsible section in the Intel Panel (right sidebar). It shows every data source with a visual indicator:

```
┌─ INTELLIGENCE FRESHNESS ────────────────────┐
│                                              │
│  Stripe      ● 2m ago     [Sales]      [↻]  │
│  Kit         ● 34m ago    [Lead-Gen]   [↻]  │
│  LinkedIn    ◐ 2h ago     [Lead-Gen]   [↻]  │
│  Slack       ● Live       [Support]    [↻]  │
│  Calendar    ○ 6h ago     [HQ]         [↻]  │
│  GitHub      ◐ 1h ago     [Fulfillment][↻]  │
│  Competitors ○ 18h ago    [Lead-Gen]   [↻]  │
│                                              │
│  ● Fresh  ◐ Aging  ○ Stale                  │
└──────────────────────────────────────────────┘
```

### 6.2 Freshness Calculation

```typescript
interface IntelSource {
  id: string
  name: string
  monitorId: string
  territories: string[]
  expectedIntervalMs: number   // How often we expect fresh data
  lastUpdated: number          // Unix timestamp of last successful data
}

type FreshnessLevel = 'fresh' | 'aging' | 'stale'

function calculateFreshness(source: IntelSource): FreshnessLevel {
  const ageMs = Date.now() - source.lastUpdated
  if (ageMs <= source.expectedIntervalMs * 1.5) return 'fresh'
  if (ageMs <= source.expectedIntervalMs * 3.0) return 'aging'
  return 'stale'
}

// Visual mapping
const FRESHNESS_COLORS = {
  fresh: 0x00FF88,   // Green
  aging: 0xFFAA00,   // Amber
  stale: 0xFF3333    // Red
}

// Fog contribution
const FRESHNESS_FOG_WEIGHT = {
  fresh: 0.0,        // No fog contribution
  aging: 0.3,        // 30% fog contribution
  stale: 0.8         // 80% fog contribution
}
```

### 6.3 Freshness → Fog of War

Each territory's fog level is the weighted average of its intel source freshness values:

```typescript
function calculateTerritoryFog(territory: Territory): number {
  const sources = getSourcesForTerritory(territory.id)
  if (sources.length === 0) return 1.0 // No sources = full fog

  let totalWeight = 0
  let fogSum = 0

  for (const source of sources) {
    const freshness = calculateFreshness(source)
    const fogContribution = FRESHNESS_FOG_WEIGHT[freshness]
    const weight = 1.0 // Equal weight per source; could be customized

    fogSum += fogContribution * weight
    totalWeight += weight
  }

  return fogSum / totalWeight
}
```

**Fog regrowth:** Every 5 minutes (aligned with the heartbeat), each territory's fog is recalculated. If no new data has arrived, the fog naturally increases because `ageMs` grows. This creates the "fog regrowth" effect from the vision doc without any special timer — it is an emergent property of time passing without fresh intel.

### 6.4 One-Click Refresh

Each source in the freshness panel has a refresh button `[↻]` that:

1. Immediately triggers the corresponding monitor's `tick()` method
2. Shows a spinning indicator while the tick runs
3. Updates the freshness indicator on completion
4. If the tick fails, shows the error inline

For sources that require a heavier refresh (e.g., a full competitor deep-dive), clicking `[↻]` instead deploys a **Scout** unit to that territory with a reconnaissance prompt:

```typescript
// When user clicks refresh on a source that needs a Scout
async function deployScoutRefresh(sourceId: string, territory: string): Promise<void> {
  const refreshPrompts: Record<string, string> = {
    'linkedin': 'Check LinkedIn analytics for the last 7 days. Report impressions, engagement rate, top posts. Write findings to ~/.agent-empires/data/intel/raw/',
    'competitors': 'Run a competitive analysis sweep. Check all competitor profiles in Supabase ae_competitor_profiles. Report any changes. Write findings to ~/.agent-empires/data/intel/raw/',
    'github': 'Check all GitHub repos for open PRs, recent deploys, and failing CI. Report status. Write findings to ~/.agent-empires/data/intel/raw/'
  }

  // This creates a new tmux session via the existing Vibecraft session management
  await fetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      template: 'scout',
      territory,
      initialPrompt: refreshPrompts[sourceId] || `Refresh intelligence for ${sourceId}`,
      autoTerminate: true  // Kill session when task completes
    })
  })
}
```

---

## 7. The Self-Improving Loop

### 7.1 Pattern Recognition Engine

After 7 days of monitoring data, a nightly analysis job scans `ae_monitor_events` for recurring patterns. This runs as a cron trigger in the existing agent-runner system (NOT as a monitor — it's a batch analysis, not real-time).

```typescript
// server/intelligence/PatternAnalyzer.ts
// Runs nightly at 2am via agent-runner cron trigger

class PatternAnalyzer {
  async analyze(): Promise<LearnedPattern[]> {
    const patterns: LearnedPattern[] = []

    // --- Temporal Patterns ---
    // "Support tickets spike every Monday"
    const temporalPatterns = await this.findTemporalPatterns()
    patterns.push(...temporalPatterns)

    // --- Trend Patterns ---
    // "Content engagement has declined 3 weeks in a row"
    const trendPatterns = await this.findTrendPatterns()
    patterns.push(...trendPatterns)

    // --- Correlation Patterns ---
    // "Refunds spike 48h after failed payments"
    const correlationPatterns = await this.findCorrelationPatterns()
    patterns.push(...correlationPatterns)

    // --- Seasonal Patterns ---
    // Requires 90+ days of data; initially seeded with known business cycles
    const seasonalPatterns = await this.findSeasonalPatterns()
    patterns.push(...seasonalPatterns)

    return patterns
  }

  private async findTemporalPatterns(): Promise<LearnedPattern[]> {
    // Query: group events by day-of-week and hour-of-day
    // Look for statistically significant spikes (>2x average)
    const { data } = await this.supabase.rpc('analyze_temporal_patterns')
    // The RPC function does the heavy SQL lifting
    return (data || []).map(row => ({
      pattern_type: 'temporal',
      title: `${row.event_type} spikes on ${row.day_name}s around ${row.peak_hour}:00`,
      description: `${row.event_type} events are ${row.multiplier.toFixed(1)}x more frequent on ${row.day_name}s at ${row.peak_hour}:00 compared to the weekly average.`,
      conditions: {
        dayOfWeek: row.day_of_week,
        hourOfDay: row.peak_hour,
        eventType: row.event_type,
        multiplier: row.multiplier
      },
      recommended_action: {
        type: 'pre_deploy',
        unitType: UNIT_TYPE_FOR_EVENT[row.event_type] || 'medic',
        territory: TERRITORY_FOR_EVENT[row.event_type] || 'support',
        leadTimeMinutes: 60 // Deploy 1 hour before expected spike
      },
      confidence: Math.min(row.sample_size / 20, 1.0) // Need 20+ observations for full confidence
    }))
  }

  private async findTrendPatterns(): Promise<LearnedPattern[]> {
    // Query: compare last 7 days to previous 7 days for each metric
    // Flag if a metric has declined/increased for 3+ consecutive weeks
    const { data } = await this.supabase.rpc('analyze_trend_patterns')

    return (data || []).map(row => ({
      pattern_type: 'trend',
      title: `${row.metric} ${row.direction} for ${row.consecutive_weeks} weeks`,
      description: `${row.metric} has ${row.direction === 'declining' ? 'decreased' : 'increased'} for ${row.consecutive_weeks} consecutive weeks. Current: ${row.current_value}, Previous: ${row.previous_value}.`,
      conditions: {
        metric: row.metric,
        direction: row.direction,
        consecutiveWeeks: row.consecutive_weeks,
        percentChange: row.percent_change
      },
      recommended_action: {
        type: 'alert',
        severity: row.consecutive_weeks >= 3 ? 'high' : 'medium',
        territory: row.territory,
        message: `${row.metric} trending ${row.direction}. Consider deploying ${row.recommended_unit}.`
      },
      confidence: Math.min(row.consecutive_weeks / 4, 1.0)
    }))
  }

  private async findCorrelationPatterns(): Promise<LearnedPattern[]> {
    // Query: find events that consistently follow other events within a time window
    // e.g., 'revenue.refund' within 48h after 'revenue.payment_failed'
    const { data } = await this.supabase.rpc('analyze_correlation_patterns')

    return (data || []).filter(row => row.correlation > 0.6).map(row => ({
      pattern_type: 'correlation',
      title: `${row.effect_event} follows ${row.cause_event} within ${row.window_hours}h`,
      description: `${(row.correlation * 100).toFixed(0)}% of ${row.cause_event} events are followed by ${row.effect_event} within ${row.window_hours} hours.`,
      conditions: {
        causeEvent: row.cause_event,
        effectEvent: row.effect_event,
        windowHours: row.window_hours,
        correlation: row.correlation
      },
      recommended_action: {
        type: 'pre_deploy',
        unitType: UNIT_TYPE_FOR_EVENT[row.effect_event] || 'medic',
        territory: TERRITORY_FOR_EVENT[row.effect_event] || 'support',
        triggerOnEvent: row.cause_event,
        leadTimeMinutes: row.window_hours * 30 // Deploy at half the window
      },
      confidence: row.correlation
    }))
  }

  private async findSeasonalPatterns(): Promise<LearnedPattern[]> {
    // Initially seeded with known patterns, then confirmed/adjusted with data
    const KNOWN_SEASONAL: LearnedPattern[] = [
      {
        pattern_type: 'seasonal',
        title: 'Q4 churn risk increase',
        description: 'November-December typically sees higher churn as customers reassess subscriptions. Increase retention monitoring.',
        conditions: { months: [11, 12], metric: 'churn_rate' },
        recommended_action: {
          type: 'increase_monitoring',
          monitor: 'revenue',
          multiplier: 2, // Check 2x more frequently
          territory: 'retention'
        },
        confidence: 0.7 // Industry-standard knowledge, not yet confirmed by our data
      },
      {
        pattern_type: 'seasonal',
        title: 'New year enrollment surge',
        description: 'January sees a spike in course enrollments. Pre-deploy content and sales units.',
        conditions: { months: [1], metric: 'enrollment_rate' },
        recommended_action: {
          type: 'pre_deploy',
          unitType: 'diplomat',
          territory: 'sales',
          leadTimeMinutes: 0 // Deploy at start of January
        },
        confidence: 0.6
      }
    ]

    // If we have enough data, adjust confidence based on actual observations
    for (const pattern of KNOWN_SEASONAL) {
      const { data: matching } = await this.supabase
        .from('ae_monitor_events')
        .select('id', { count: 'exact' })
        .in('event_type', this.getEventsForMetric(pattern.conditions.metric))
        // Check if events actually spiked in the specified months
      // Adjust confidence based on data...
    }

    return KNOWN_SEASONAL
  }
}
```

### 7.2 Pattern Storage SQL Functions

```sql
-- Temporal pattern analysis
CREATE OR REPLACE FUNCTION analyze_temporal_patterns()
RETURNS TABLE (
  event_type TEXT,
  day_of_week INTEGER,
  day_name TEXT,
  peak_hour INTEGER,
  avg_count NUMERIC,
  peak_count NUMERIC,
  multiplier NUMERIC,
  sample_size BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH hourly_counts AS (
    SELECT
      me.event_type,
      EXTRACT(DOW FROM me.timestamp) AS dow,
      EXTRACT(HOUR FROM me.timestamp) AS hour,
      COUNT(*) AS cnt
    FROM ae_monitor_events me
    WHERE me.timestamp > now() - INTERVAL '30 days'
      AND me.severity IN ('medium', 'high', 'critical')
    GROUP BY me.event_type, EXTRACT(DOW FROM me.timestamp), EXTRACT(HOUR FROM me.timestamp)
  ),
  averages AS (
    SELECT
      event_type,
      AVG(cnt) AS overall_avg,
      COUNT(*) AS total_buckets
    FROM hourly_counts
    GROUP BY event_type
  )
  SELECT
    hc.event_type,
    hc.dow::INTEGER,
    CASE hc.dow
      WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
      WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
      WHEN 6 THEN 'Saturday'
    END,
    hc.hour::INTEGER,
    a.overall_avg,
    hc.cnt::NUMERIC,
    (hc.cnt / NULLIF(a.overall_avg, 0))::NUMERIC AS multiplier,
    a.total_buckets
  FROM hourly_counts hc
  JOIN averages a ON a.event_type = hc.event_type
  WHERE hc.cnt > a.overall_avg * 2  -- Only return 2x+ spikes
    AND a.total_buckets >= 7          -- Need at least a week of data
  ORDER BY (hc.cnt / NULLIF(a.overall_avg, 0)) DESC;
END;
$$ LANGUAGE plpgsql;


-- Trend pattern analysis
CREATE OR REPLACE FUNCTION analyze_trend_patterns()
RETURNS TABLE (
  metric TEXT,
  territory TEXT,
  direction TEXT,
  consecutive_weeks INTEGER,
  current_value NUMERIC,
  previous_value NUMERIC,
  percent_change NUMERIC,
  recommended_unit TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH weekly_metrics AS (
    SELECT
      event_type AS metric,
      territory,
      DATE_TRUNC('week', timestamp) AS week,
      COUNT(*) AS event_count
    FROM ae_monitor_events
    WHERE timestamp > now() - INTERVAL '28 days'
    GROUP BY event_type, territory, DATE_TRUNC('week', timestamp)
  ),
  week_over_week AS (
    SELECT
      metric,
      territory,
      week,
      event_count,
      LAG(event_count) OVER (PARTITION BY metric, territory ORDER BY week) AS prev_count,
      CASE
        WHEN event_count > LAG(event_count) OVER (PARTITION BY metric, territory ORDER BY week)
          THEN 'increasing'
        ELSE 'declining'
      END AS direction
    FROM weekly_metrics
  )
  SELECT DISTINCT ON (wow.metric, wow.territory)
    wow.metric,
    wow.territory,
    wow.direction,
    -- Count consecutive weeks in same direction (simplified)
    2::INTEGER AS consecutive_weeks,
    wow.event_count,
    wow.prev_count,
    CASE WHEN wow.prev_count > 0
      THEN ((wow.event_count - wow.prev_count)::NUMERIC / wow.prev_count * 100)
      ELSE 0
    END,
    CASE
      WHEN wow.territory = 'support' THEN 'medic'
      WHEN wow.territory = 'lead-gen' THEN 'writer'
      WHEN wow.territory IN ('sales', 'retention') THEN 'diplomat'
      ELSE 'scout'
    END
  FROM week_over_week wow
  WHERE wow.prev_count IS NOT NULL
    AND ABS(wow.event_count - wow.prev_count) > 2  -- Meaningful change
  ORDER BY wow.metric, wow.territory, wow.week DESC;
END;
$$ LANGUAGE plpgsql;


-- Correlation pattern analysis
CREATE OR REPLACE FUNCTION analyze_correlation_patterns()
RETURNS TABLE (
  cause_event TEXT,
  effect_event TEXT,
  window_hours INTEGER,
  correlation NUMERIC,
  sample_size BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH event_pairs AS (
    SELECT
      a.event_type AS cause,
      b.event_type AS effect,
      EXTRACT(EPOCH FROM (b.timestamp - a.timestamp)) / 3600 AS hours_gap
    FROM ae_monitor_events a
    JOIN ae_monitor_events b ON b.timestamp > a.timestamp
      AND b.timestamp < a.timestamp + INTERVAL '72 hours'
      AND a.event_type != b.event_type
      AND a.severity IN ('medium', 'high', 'critical')
      AND b.severity IN ('medium', 'high', 'critical')
    WHERE a.timestamp > now() - INTERVAL '30 days'
  ),
  pair_counts AS (
    SELECT
      cause,
      effect,
      ROUND(AVG(hours_gap))::INTEGER AS avg_window,
      COUNT(*) AS pair_count
    FROM event_pairs
    WHERE hours_gap > 0
    GROUP BY cause, effect
    HAVING COUNT(*) >= 5
  ),
  cause_counts AS (
    SELECT event_type, COUNT(*) AS total
    FROM ae_monitor_events
    WHERE timestamp > now() - INTERVAL '30 days'
      AND severity IN ('medium', 'high', 'critical')
    GROUP BY event_type
  )
  SELECT
    pc.cause,
    pc.effect,
    pc.avg_window,
    (pc.pair_count::NUMERIC / cc.total)::NUMERIC AS correlation,
    pc.pair_count
  FROM pair_counts pc
  JOIN cause_counts cc ON cc.event_type = pc.cause
  WHERE (pc.pair_count::NUMERIC / cc.total) > 0.3  -- At least 30% correlation
  ORDER BY (pc.pair_count::NUMERIC / cc.total) DESC;
END;
$$ LANGUAGE plpgsql;
```

### 7.3 Pattern Application

The nightly analyzer stores patterns in `ae_learned_patterns`. A `PatternApplicator` runs alongside the monitors, checking incoming events against learned patterns:

```typescript
class PatternApplicator {
  private patterns: LearnedPattern[] = []

  async loadPatterns(): Promise<void> {
    const { data } = await this.supabase
      .from('ae_learned_patterns')
      .select('*')
      .eq('active', true)
      .gte('confidence', 0.5)

    this.patterns = data || []
  }

  /** Called when a new monitor event arrives */
  async checkPatterns(event: MonitorEvent): Promise<void> {
    for (const pattern of this.patterns) {
      if (this.matchesCondition(event, pattern)) {
        const action = pattern.recommended_action

        if (action.type === 'pre_deploy') {
          // Broadcast recommendation to HUD
          this.wsServer.broadcast({
            type: 'pattern_recommendation',
            payload: {
              patternId: pattern.id,
              title: pattern.title,
              confidence: pattern.confidence,
              recommendedAction: action,
              triggerEvent: event.eventType,
              message: `Pattern detected: ${pattern.title}. Recommend deploying ${action.unitType} to ${action.territory}.`
            }
          })
        }

        if (action.type === 'alert') {
          this.wsServer.broadcast({
            type: 'pattern_alert',
            payload: {
              patternId: pattern.id,
              title: pattern.title,
              severity: action.severity,
              territory: action.territory,
              message: action.message
            }
          })
        }

        if (action.type === 'increase_monitoring') {
          // Temporarily increase a monitor's frequency
          this.orchestrator.adjustInterval(action.monitor, action.multiplier)
        }

        // Track trigger
        await this.supabase
          .from('ae_learned_patterns')
          .update({
            times_triggered: pattern.times_triggered + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', pattern.id)
      }
    }
  }

  /** User confirms or denies a pattern recommendation */
  async feedback(patternId: string, wasCorrect: boolean): Promise<void> {
    const pattern = this.patterns.find(p => p.id === patternId)
    if (!pattern) return

    const newTimesCorrect = pattern.times_correct + (wasCorrect ? 1 : 0)
    const newTimesTriggered = pattern.times_triggered // Already incremented
    const newConfidence = newTimesCorrect / Math.max(newTimesTriggered, 1)

    await this.supabase
      .from('ae_learned_patterns')
      .update({
        times_correct: newTimesCorrect,
        confidence: newConfidence,
        active: newConfidence >= 0.3, // Deactivate patterns that are wrong >70% of the time
        updated_at: new Date().toISOString()
      })
      .eq('id', patternId)
  }
}
```

### 7.4 Pattern Visualization in HUD

Learned patterns appear in the Campaign tab as **standing orders**:

```
┌─ LEARNED PATTERNS (3 active) ───────────────┐
│                                              │
│  ⚡ Support tickets spike Mondays 9am        │
│     → Pre-deploy Medic at 8am (87% conf)    │
│     [Active] [Disable] [History]             │
│                                              │
│  📉 Email open rates declining 3 weeks       │
│     → Alert: Refresh content strategy        │
│     [Active] [Disable] [History]             │
│                                              │
│  🔗 Refunds follow failed payments (48h)     │
│     → Pre-deploy Diplomat on fail events     │
│     [Active] [Disable] [History]             │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 8. Integration Specifications

### 8.1 Stripe

**Type:** Webhook → Supabase Edge Function → Supabase Realtime → RevenueMonitor
**Cost:** Free (Stripe webhooks are free, edge function on free tier)

**Webhook endpoint:** `https://dquuimhmbofdhdsbdbly.supabase.co/functions/v1/stripe-webhook`

**Events subscribed:**
| Event | Battlefield Effect |
|-------|-------------------|
| `checkout.session.completed` | Gold burst on Sales |
| `invoice.payment_succeeded` | Gold burst on Sales |
| `invoice.payment_failed` | Burning Ticket spawn |
| `charge.refunded` | Cancellation Reaper spawn |
| `customer.subscription.created` | Gold burst + MRR up |
| `customer.subscription.updated` | Check for downgrade → Downgrader spawn |
| `customer.subscription.deleted` | Cancellation Reaper spawn |
| `customer.subscription.paused` | Ghoster spawn |
| `customer.subscription.resumed` | Ghoster kill + gold burst |

**Env vars needed:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Edge function deployed via:** `supabase functions deploy stripe-webhook --project-ref dquuimhmbofdhdsbdbly`

---

### 8.2 Kit / ConvertKit

**Type:** REST API polling (hourly)
**Cost:** Free (Kit API included in all paid plans)
**Base URL:** `https://api.convertkit.com/v3`
**Auth:** API Secret passed as query parameter `api_secret`

**Endpoints used:**

| Endpoint | Method | Purpose | Response Fields |
|----------|--------|---------|-----------------|
| `/account` | GET | Health check | `name`, `primary_email_address` |
| `/broadcasts` | GET | List recent emails | `broadcasts[].id`, `.subject`, `.sent_at` |
| `/broadcasts/:id/stats` | GET | Per-broadcast metrics | `broadcast.recipients`, `.open_rate`, `.click_rate`, `.unsubscribes` |
| `/subscribers` | GET | Total subscriber count | `total_subscribers` |
| `/tags` | GET | Segment counts | `tags[].id`, `.name`, `.created_at` |

**Example response (broadcast stats):**
```json
{
  "broadcast": {
    "id": 12345,
    "stats": {
      "recipients": 2450,
      "open_rate": 0.42,
      "click_rate": 0.08,
      "unsubscribes": 3,
      "total_clicks": 196,
      "show_total_clicks": true,
      "status": "completed",
      "progress": 100.0
    }
  }
}
```

**Transformation to battlefield event:**
```typescript
{
  eventType: 'content.email_update',
  severity: openRate < 0.20 ? 'medium' : 'info',
  title: `Email "${subject}": ${(openRate * 100).toFixed(1)}% open`,
  data: { platform: 'kit', broadcastId, subject, openRate, clickRate, recipients }
}
```

**Env vars needed:**
```
KIT_API_SECRET=your_api_secret
```

---

### 8.3 LinkedIn / Shield

**Type:** REST API polling (hourly)
**Cost:** Shield has a free tier (100 requests/day). Our 24 hourly polls = 24 requests/day.
**Base URL:** `https://shield-api.com/api/v1`
**Auth:** Bearer token

**Endpoints used:**

| Endpoint | Method | Purpose | Response Fields |
|----------|--------|---------|-----------------|
| `/stats/posts?days=7` | GET | Weekly post performance | `data[].impressions`, `.likes`, `.comments`, `.shares`, `.text` |
| `/stats/profile` | GET | Profile-level stats | `followers`, `.connections`, `.profileViews` |

**Example response (post stats):**
```json
{
  "data": [
    {
      "id": "7123456789",
      "text": "The skill stacking approach to AI...",
      "impressions": 12450,
      "likes": 234,
      "comments": 67,
      "shares": 23,
      "date": "2026-03-09"
    }
  ]
}
```

**Transformation:**
```typescript
{
  eventType: 'content.linkedin_update',
  severity: engagementRate < 1.0 ? 'medium' : 'info',
  title: `LinkedIn 7d: ${impressions} impressions, ${rate}% engagement`,
  data: { platform: 'linkedin', impressions, engagement, engagementRate, postCount }
}
```

**Fallback if Shield is unavailable:** Deploy a Scout unit that uses WebFetch to scrape LinkedIn Analytics page (requires cookies, less reliable). The monitor gracefully degrades — it marks itself as 'down' and the Lead-Gen territory fogs up.

**Env vars needed:**
```
SHIELD_API_KEY=your_shield_api_key
```

---

### 8.4 Slack

**Type:** Event-driven via existing Socket Mode connection in agent-runner
**Cost:** Free (Slack free tier, already connected)
**Integration path:** The agent-runner's `SlackSocketTrigger` already receives all Slack events. We add a hook that also writes to `ae_support_tickets` when messages arrive in support channels.

**Events to intercept:**

| Slack Event | Battlefield Effect |
|------------|-------------------|
| `message` in support channel | Insert `ae_support_tickets`, Burning Ticket spawns |
| `message` with customer @mention | Intel Panel entry |
| `reaction_added` (fire/sos/urgent emoji) | Escalate existing ticket |
| `app_mention` with question | Support ticket if unresolved |

**Integration point — add to `agent-runner/src/triggers/slack-socket-trigger.js`:**

```javascript
// In handleSlackEvent, after existing routing:
if (this.isSupportChannel(event.channel)) {
  // Write to ae_support_tickets for the SupportMonitor to pick up
  await this.supabase.from('ae_support_tickets').insert({
    source: 'slack',
    source_id: event.ts,
    channel: event.channel,
    customer_name: await this.resolveUserName(event.user),
    subject: (event.text || '').substring(0, 100),
    body: event.text,
    status: 'open'
  })
}
```

**Env vars (already configured):**
```
SLACK_FLOWSTACK_BOT_TOKEN=xoxb-...
```

---

### 8.5 Google Calendar

**Type:** REST API polling (every 15 minutes)
**Cost:** Free (Google Calendar API free tier: 1M requests/day)
**Integration:** Uses the existing Google Calendar MCP tool, or direct REST API

**Endpoint:** `https://www.googleapis.com/calendar/v3/calendars/primary/events`

**Query parameters:**
```
timeMin: now
timeMax: now + 24 hours
singleEvents: true
orderBy: startTime
maxResults: 20
```

**Events that become map objects:**

| Calendar Event | Map Object | Territory |
|---------------|------------|-----------|
| Meeting with "sales" or client name | Meeting marker (clock icon) on Sales | Sales |
| "Bootcamp" or "Session" event | Mission marker on Fulfillment | Fulfillment |
| "Content" or "Recording" event | Mission marker on Lead-Gen | Lead-Gen |
| Any meeting starting in < 30min | Flashing urgent marker + HUD alert | Relevant territory |

**Transformation:**
```typescript
// Calendar events become temporary map objects (not enemies)
{
  eventType: 'calendar.upcoming_meeting',
  severity: minutesUntil < 30 ? 'high' : 'info',
  title: `Meeting in ${minutesUntil}m: ${event.summary}`,
  data: {
    calendarEventId: event.id,
    summary: event.summary,
    startTime: event.start.dateTime,
    endTime: event.end.dateTime,
    attendees: event.attendees?.map(a => a.email),
    meetingLink: event.hangoutLink || event.location
  }
}
```

**Env vars needed:**
```
GOOGLE_CALENDAR_TOKEN=<path to token JSON from existing setup>
```

---

### 8.6 GitHub

**Type:** Webhook → Agent Empires server webhook endpoint
**Cost:** Free (GitHub webhooks are free)
**Webhook endpoint:** Agent Empires server already has a webhook receiver on port (configured in Vibecraft). We add a `/github-webhook` route.

**Events subscribed (per repo):**

| Event | Battlefield Effect |
|-------|-------------------|
| `push` to main | "Deploy" animation — supply truck moves from HQ to Fulfillment |
| `pull_request.opened` | Intel entry: "PR opened: {title}" |
| `pull_request.merged` | Victory stinger + territory health boost |
| `issues.opened` | If labeled 'bug': Burning Ticket in Fulfillment |
| `check_suite.completed` (failure) | Operational enemy spawns in Fulfillment |
| `release.published` | Campaign objective progress if linked |

**Webhook handler:**
```typescript
// server/webhooks/github.ts
app.post('/github-webhook', async (req, res) => {
  const event = req.headers['x-github-event']
  const payload = req.body

  // Verify signature
  const signature = req.headers['x-hub-signature-256']
  if (!verifyGitHubSignature(payload, signature, process.env.GITHUB_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature')
  }

  switch (event) {
    case 'push':
      if (payload.ref === 'refs/heads/main') {
        await orchestrator.emit({
          monitorId: 'github',
          timestamp: Date.now(),
          territory: 'fulfillment',
          eventType: 'github.deploy',
          severity: 'info',
          title: `Deploy: ${payload.head_commit?.message?.substring(0, 60)}`,
          data: { repo: payload.repository.name, commitSha: payload.after, pusher: payload.pusher.name }
        })
      }
      break

    case 'issues':
      if (payload.action === 'opened' && payload.issue.labels.some(l => l.name === 'bug')) {
        await orchestrator.emit({
          monitorId: 'github',
          timestamp: Date.now(),
          territory: 'fulfillment',
          eventType: 'github.bug_report',
          severity: 'medium',
          title: `Bug: ${payload.issue.title}`,
          data: { repo: payload.repository.name, issueNumber: payload.issue.number, url: payload.issue.html_url },
          spawnEnemy: {
            enemyType: 'burning_ticket',
            territory: 'fulfillment',
            metadata: { source: 'github', issueUrl: payload.issue.html_url }
          }
        })
      }
      break

    case 'check_suite':
      if (payload.action === 'completed' && payload.check_suite.conclusion === 'failure') {
        await orchestrator.emit({
          monitorId: 'github',
          timestamp: Date.now(),
          territory: 'fulfillment',
          eventType: 'github.ci_failure',
          severity: 'high',
          title: `CI failed: ${payload.repository.name}`,
          data: { repo: payload.repository.name, branch: payload.check_suite.head_branch },
          spawnEnemy: {
            enemyType: 'operational_fault',
            territory: 'fulfillment',
            metadata: { type: 'ci_failure', repo: payload.repository.name }
          }
        })
      }
      break
  }

  res.status(200).send('ok')
})
```

**Env vars needed:**
```
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```

**Setup:** In each GitHub repo → Settings → Webhooks → Add webhook with the server URL.

---

### 8.7 Fathom (Meeting Transcripts)

**Type:** REST API polling (every 30 minutes)
**Cost:** Free (Fathom API included with paid plan)
**Base URL:** `https://api.fathom.video/v1`
**Auth:** Bearer token

**Endpoints used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/calls?after={timestamp}` | GET | List recent meetings since last check |
| `/calls/:id` | GET | Get meeting details + transcript |
| `/calls/:id/action-items` | GET | Extract action items |

**Transformation:**
```typescript
// New meeting completed → intel event
{
  eventType: 'meeting.completed',
  severity: 'info',
  title: `Meeting completed: ${call.title} (${durationMin}m)`,
  data: {
    callId: call.id,
    title: call.title,
    duration: call.duration,
    participants: call.participants,
    actionItems: actionItems.map(ai => ai.text),
    recordingUrl: call.recording_url
  }
}

// Action items become tasks on the relevant territory
for (const item of actionItems) {
  // Simple keyword matching to assign territory
  const territory = inferTerritory(item.text)
  {
    eventType: 'meeting.action_item',
    severity: 'medium',
    title: `Action: ${item.text.substring(0, 80)}`,
    data: { callId: call.id, actionItem: item.text, assignee: item.assignee }
  }
}
```

**Env vars needed:**
```
FATHOM_API_KEY=your_fathom_api_key
```

---

## 9. Implementation Plan

### Phase 1: Foundation (Day 1)

1. Create `server/monitors/` directory structure
2. Implement `BaseMonitor` and `MonitorOrchestrator`
3. Implement `HeartbeatMonitor` (checks Supabase connectivity)
4. Run Supabase migrations for all tables in Section 4
5. Wire `MonitorOrchestrator.emit()` → Supabase insert + WebSocket broadcast
6. Browser: basic `MonitorEventHandler` that logs events to console

**Validation:** Health status appears in server logs every 5 minutes. Events appear in `ae_monitor_events` table.

### Phase 2: Revenue Pipeline (Day 2)

1. Deploy `stripe-webhook` edge function to Supabase
2. Configure Stripe webhook in Stripe Dashboard
3. Implement `RevenueMonitor` with Realtime subscription + MRR poll
4. Browser: gold particle animation on payment events
5. Browser: resource bar MRR counter updates

**Validation:** Test with Stripe CLI: `stripe trigger checkout.session.completed`. Gold burst appears on Sales territory.

### Phase 3: Content + Support (Day 3)

1. Implement `ContentPerformanceMonitor`
2. Implement `SupportMonitor` with Slack integration hook
3. Browser: territory glow/dim based on content performance
4. Browser: Burning Ticket spawns from support events

**Validation:** Send a test message in a support Slack channel. Burning Ticket appears on Support territory.

### Phase 4: Freshness + Escalation (Day 4)

1. Implement `EscalationEngine` with all rules from Section 5
2. Build freshness dashboard HUD component
3. Wire fog of war calculation to freshness data
4. Implement one-click refresh buttons
5. Implement auto-deploy permission system

**Validation:** Leave a support ticket unresolved for 4+ hours. Watch it escalate from Level 0 to Level 1. Fog on a territory increases when you disable its monitor.

### Phase 5: Competitors + External (Day 5)

1. Implement `CompetitorMonitor`
2. Add GitHub webhook handler
3. Add Google Calendar polling
4. Add Fathom meeting integration
5. Seed `ae_competitor_profiles` with initial competitors

**Validation:** All sources show in freshness dashboard. Calendar events appear as map markers.

### Phase 6: Self-Improving Loop (Day 6-7)

1. Create SQL analysis functions
2. Implement `PatternAnalyzer` (nightly job)
3. Add cron trigger to agent-runner for nightly pattern analysis
4. Implement `PatternApplicator`
5. Build pattern visualization in HUD
6. Wire user feedback (confirm/deny pattern recommendations)

**Validation:** After 7 days of monitoring data, patterns begin appearing. User can enable/disable patterns.

### Agent-Runner Cron Entry

Add to `agent-runner/config/triggers.config.json`:

```json
{
  "id": "ae-pattern-analysis",
  "type": "cron",
  "enabled": true,
  "schedule": "0 2 * * *",
  "timezone": "America/Chicago",
  "task": {
    "type": "script",
    "script": "/Users/heymitch/agent-empires/scripts/analyze-patterns.js"
  },
  "description": "Nightly pattern analysis for Agent Empires self-improving loop"
}
```

---

## Appendix A: Environment Variables Summary

```bash
# Required for monitoring system
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
KIT_API_SECRET=...
SHIELD_API_KEY=...
FATHOM_API_KEY=...
GITHUB_WEBHOOK_SECRET=...

# Already configured (from agent-runner)
SUPABASE_URL=https://dquuimhmbofdhdsbdbly.supabase.co
SUPABASE_SERVICE_KEY=...
SLACK_FLOWSTACK_BOT_TOKEN=xoxb-...

# Optional (for Google Calendar direct API; alternatively use MCP)
GOOGLE_CALENDAR_TOKEN=/path/to/google-calendar-token.json
```

## Appendix B: Monitor Summary Table

| Monitor | Interval | Type | Territories | Events Generated | Enemies Spawned |
|---------|----------|------|-------------|-----------------|-----------------|
| Heartbeat | 5 min | Poll | All | service_up/down/degraded | None (affects terrain) |
| Revenue | Event + 15 min | Webhook + Poll | Sales, Retention | payment, refund, churn, mrr_update | Cancellation Reaper, Downgrader, Burning Ticket |
| Content Performance | 60 min | Poll | Lead-Gen | linkedin_update, email_update, viral_post, engagement_crisis | Content Decay |
| Competitor | 6 hours | Poll | Lead-Gen, Sales | website_changed | Competitor Scout |
| Support | Event + 10 min | Slack + Poll | Support, Fulfillment | new_ticket, ticket_escalated | Burning Ticket → Wildfire |

## Appendix C: WebSocket Message Types Summary

| Type | Direction | Purpose |
|------|-----------|---------|
| `monitor_event` | Server → Browser | New monitoring data point |
| `health_update` | Server → Browser | All-monitors health snapshot (every 5 min) |
| `freshness_update` | Server → Browser | Single source freshness change |
| `enemy_escalation` | Server → Browser | Enemy level-up notification |
| `auto_deploy_request` | Server → Browser | System recommending/auto-deploying a unit |
| `pattern_recommendation` | Server → Browser | Learned pattern triggered, recommending action |
| `pattern_alert` | Server → Browser | Learned pattern flagging a trend |
| `pattern_feedback` | Browser → Server | User confirms/denies a pattern recommendation |
| `refresh_source` | Browser → Server | User clicked refresh on a freshness indicator |
