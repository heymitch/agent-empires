# Agent Empires — Supply Chain & Orchestration Layer

## Sub-PRD 13 — The Pentagon Meets the War Room

**Parent PRD:** `01-vision.md`
**Dependencies:** `02c-combat-and-roads-spec.md` (roads system, road rendering), `05-resource-economy.md` (budget/resource tracking), `12-distributed-fleet-architecture.md` (fleet topology, heartbeat protocol, unit persistence tiers)
**System:** Supply chain visualization, Paperclip integration, downstream consumer detection, ticket-as-packet rendering, waste identification
**Last updated:** 2026-03-10

---

> ### STATUS SUMMARY (Audit 2026-03-10)
>
> **Overall: PARTIAL — strong foundation exists, critical visualization gaps remain**
>
> | Component | PRD Spec | Code Reality | Status |
> |-----------|----------|--------------|--------|
> | **Roads between territories** | Factorio-style belts carrying ticket packets between units | `RoadRenderer.ts` draws animated bezier curves between territory centers with 5 road levels (Trail-Superhighway), marching dots at level 3+, glow at level 4+, hover tooltips. Fully functional. | BUILT |
> | **RoadAggregator (data pipeline)** | Aggregate territory transitions from events into road data | `server/RoadAggregator.ts` polls `ae_events`, counts territory transitions per session, computes road levels (thresholds: 5/15/30/60), upserts to `ae_roads`. Working pipeline. | BUILT |
> | **Production chain definitions** | Per-territory Factorio node graphs with metrics, targets, data sources | `shared/productionChains.ts` defines 5 chains (Lead-Gen, Sales, Fulfillment, Support, Retention) with typed nodes, data sources, targets, position layout. Complete. | BUILT |
> | **ProductionChainRenderer** | Factorio-view overlay with nodes, pipes, flow particles, bottleneck detection | `src/renderer/ProductionChainRenderer.ts` — full PixiJS renderer with node boxes, health coloring, bezier pipe connections, flow dot animation, bottleneck pulse glow, pileup particles. Fade in/out. | BUILT |
> | **ProductionDataManager** | Server-side manager feeding real metric data to production chains | `server/ProductionDataManager.ts` exists | BUILT |
> | **`ae_handoffs` table** | Supabase table for mission handoff records (supply chain packets) | `SupabasePersistence.logHandoff()` writes to `ae_handoffs` with from/to session, territory, packet type, summary, priority. Table schema differs slightly from PRD (uses session_id + territory instead of agent name). | PARTIAL |
> | **PacketSprite (ticket-as-visible-packet)** | Individual ticket packets rendered as glowing priority-colored dots traveling roads | **DOES NOT EXIST.** `RoadRenderer` draws generic marching dots along roads (uniform cream/amber/orange by road level), but these are decorative — they don't represent individual handoffs or tickets. No `SupplyPacket` interface, no priority-based color/size/speed, no per-packet hover tooltip. | **NOT BUILT — HIGH PRIORITY** |
> | **Queue visualization (packet stacking)** | Packets pile up at destination when unit is busy, triggering amber warnings | **DOES NOT EXIST.** `ProductionChainRenderer` has a bottleneck pileup effect (random dots at pipe endpoint), but it's purely visual — not driven by actual queue depth from handoff data. | **NOT BUILT — HIGH PRIORITY** |
> | **Supabase Realtime subscription for handoffs** | Subscribe to `ae_handoffs` INSERTs to spawn live packet sprites | **DOES NOT EXIST.** Roads update via polling (`RoadAggregator` on 60s interval), not realtime. No `spawnPacketOnRoad()` function. | **NOT BUILT — HIGH PRIORITY** |
> | **Downstream consumer / waste detection** | Flag units with no consumers, dead roads, high rejection rates | **DOES NOT EXIST.** No `WasteDetector`, no `ae_waste_flags` table, no waste dashboard. | NOT BUILT |
> | **Unit inspection panel (full version)** | Loadout, handoff map, goal chain, memory state, queue, supply line, kill log | Basic unit detail panel exists (PRD 01). None of the PRD 13 extensions (goal chain, queue, supply line, kill log) are implemented. | NOT BUILT |
> | **Throughput metrics per road** | `RoadMetrics` interface with packets/hour, avg transit, queue depth | `RoadData` interface only has `packetCount`, `roadLevel`, `lastPacketAt`. No per-hour rates, no transit times, no queue depth tracking. | NOT BUILT |
> | **Paperclip integration** | Shared Supabase tables for tickets, budgets, goals, audit log | `ae_tickets`, `ae_budgets`, `ae_goals`, `ae_audit_log` tables — **none exist in Supabase**. Only `ae_handoffs` exists (partial schema). | NOT BUILT |
>
> ### HIGH PRIORITY EXECUTION TARGETS
>
> These are the items that would create the most visible upgrade to the war room with the least new infrastructure:
>
> 1. **PacketSprite system** — Replace generic marching dots with data-driven packet sprites. Each `ae_handoffs` INSERT spawns a visible packet with priority color/size. Requires: new `PacketSprite` class in `src/renderer/`, Supabase Realtime subscription in client, modify `RoadRenderer` to accept packet data alongside static road drawing.
>
> 2. **Handoff-driven queue stacking** — When packets arrive at a unit faster than consumption, visually stack them. Requires: query `ae_handoffs WHERE status='pending' AND to_territory=X`, render stacked dots at road endpoint, color-shift road when queue > 7.
>
> 3. **Supabase Realtime for ae_handoffs** — Subscribe client-side to handoff INSERTs/UPDATEs. Spawn packets on INSERT, absorb on UPDATE to 'completed'. This makes the supply chain live instead of poll-based.
>
> 4. **Road throughput metrics** — Extend `RoadAggregator` to compute packets/hour, avg transit time, queue depth. Extend `RoadData` interface. Feed into road tooltip (which already exists in `RoadRenderer`).
>
> **What's solid and shouldn't be touched:**
> - `RoadRenderer.ts` — clean, well-structured, extends naturally for packet sprites
> - `RoadAggregator.ts` — working pipeline, just needs richer metrics
> - `ProductionChainRenderer.ts` — Factorio view works, bottleneck detection works
> - `shared/productionChains.ts` — complete chain definitions for all territories

---

## Table of Contents

1. [The Core Relationship](#1-the-core-relationship)
2. [What Paperclip Brings to the Table](#2-what-paperclip-brings-to-the-table)
3. [What Paperclip Gets Wrong (For Us)](#3-what-paperclip-gets-wrong-for-us)
4. [The Hybrid Model: RTS + Factorio](#4-the-hybrid-model-rts--factorio)
5. [Roads as Factorio Belts](#5-roads-as-factorio-belts)
6. [The Downstream Consumer Rule](#6-the-downstream-consumer-rule)
7. [Unit Inspection Panel](#7-unit-inspection-panel)
8. [Integration Architecture](#8-integration-architecture)
9. [Supabase Schema](#9-supabase-schema)
10. [TypeScript Interfaces](#10-typescript-interfaces)
11. [PixiJS Rendering](#11-pixijs-rendering)
12. [Implementation Plan](#12-implementation-plan)

---

## 1. The Core Relationship

**Paperclip is the Pentagon. Agent Empires is the War Room.**

Paperclip ([github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip)) is where you define the org chart, set budgets, assign tickets, and audit performance. It's management infrastructure. It answers one question: *"Is this company running efficiently?"*

Agent Empires is where you see the fight in real time, identify bottlenecks, deploy forces, and respond to threats. It's command infrastructure. It answers a different question: *"Where do I need to be right now?"*

You don't pick one. The Pentagon needs the battlefield, and the battlefield needs the Pentagon.

This isn't an integration in the SaaS sense — two products with a webhook between them. It's a shared nervous system. Both read and write to the same Supabase database. Paperclip manages the org. Agent Empires visualizes the war. The database is the shared reality.

```
┌─────────────────────────────────────────┐
│         AGENT EMPIRES (War Room)         │
│  PixiJS battlefield, RTS interface,      │
│  spatial visualization, command input     │
│                                          │
│  Reads from ──┐    ┌── Writes to         │
│               │    │                     │
└───────────────┼────┼─────────────────────┘
                │    │
         ┌──────┼────┼──────┐
         │   Supabase DB    │
         │  (shared state)  │
         └──────┼────┼──────┘
                │    │
┌───────────────┼────┼─────────────────────┐
│               │    │                     │
│  Reads from ──┘    └── Writes to         │
│                                          │
│       PAPERCLIP (The Pentagon)            │
│  Org charts, budgets, tickets,           │
│  governance, audit trails                │
│                                          │
└─────────────────────────────────────────┘
```

The user interacts with Agent Empires during operations — deploying units, watching supply chains, responding to threats. They interact with Paperclip for structural decisions — hiring a new Officer, adjusting a budget ceiling, reviewing audit logs. The two never compete because they serve different cognitive modes: tactical (Agent Empires) vs. administrative (Paperclip).

---

## 2. What Paperclip Brings to the Table

Paperclip solved hard problems we don't want to re-solve. These are the seven capabilities we absorb:

### 2.1 Ticket-Based Task Persistence

Agents get tickets with goal ancestry, context, and conversation threading that survives reboots. Completed work persists as resolved tickets in Supabase. This is the missing persistence layer — Claw instances are ephemeral, but tickets are permanent. When a Claw instance dies and a new one picks up the same ticket, continuity is preserved.

In war terms: orders survive the death of the messenger. A Lieutenant goes down, a replacement inherits the mission briefing, not a blank slate.

The Roads system (Section 5) carries tickets as visible packets moving between units. Every ticket is a physical object on the battlefield — you can see it being created, traveling, being consumed.

### 2.2 Budget Enforcement

Monthly cost caps per agent with automatic throttling. In war terms: each unit has a supply line. If an Officer burns through its token budget, it stops. No heroic last stands that bankrupt the treasury.

PRD 05 already defines the resource bar and economy panel. Paperclip's budget enforcement gives us the backend teeth — not just displaying costs, but *capping* them. The resource bar shows operational cost per territory because Paperclip tracks spend per agent, and agents are assigned to territories.

```
Territory: Lead-Gen
├── Writer-01:    $12.40 / $50.00 budget
├── Scout-03:     $3.20 / $20.00 budget
└── Total:        $15.60 / $70.00 territory budget
    Progress: ████████░░░░ 22%
```

When a unit hits its budget ceiling, the supply line on the map dims. The unit's status ring shifts to amber. It doesn't crash — it enters a holding pattern, processing only what's already in its queue.

### 2.3 Heartbeat Protocol

Agents wake on schedule, check for work, act, sleep. This is the Officer tier from PRD 12. Paperclip provides the cron-like scheduling infrastructure — not reinventing `node-cron`, but ticket-aware scheduling. An Officer wakes up, checks its ticket queue (not just "is there work" but "which tickets are assigned to me, sorted by priority and deadline"), executes, writes results back to the ticket, and goes dormant.

The war room shows heartbeat cadence as a subtle pulse animation on dormant Officers. You can see which units are sleeping vs. dead. Sleeping = rhythmic dim pulse. Dead = no pulse, gray status ring.

### 2.4 Goal Ancestry

Every task traces to the company mission. This is the zoom-in/zoom-out of information space, not just geographic space (which PRD 11 already handles for the map).

When you click a unit on the battlefield:

```
Task: "Write LinkedIn post about skill stacking"
  └── Project: "Weekly Content Batch"
       └── Campaign: "Scale CCB to 100 Students"
            └── War Objective: "$50K MRR by Q2"
```

Paperclip maintains this hierarchy. Agent Empires renders it. The unit inspection panel (Section 7) displays the chain. The campaign view (PRD 01, Section 6) aggregates it. The command bar can filter by any level: "Show all units working on the CCB campaign."

### 2.5 Atomic Task Checkout

Prevents duplicate work. No two Claw instances working the same ticket. In RTS terms: no two units attacking the same target independently. When Writer-01 checks out ticket #347, that ticket is locked. If Writer-02 tries to claim it, the system rejects it and assigns the next available ticket.

On the battlefield, this manifests as visible claim indicators. A packet (ticket) traveling on a road has a destination unit. It doesn't fork. It doesn't duplicate. One packet, one destination, one consumer. If you see two units producing the same output type, one of them is a waste candidate (Section 6).

### 2.6 Audit Trail with Tool-Call Tracing

Every decision explained, every tool call logged. The "kill log" in military terms. Paperclip stores the full execution trace — which tools were called, what arguments, what results, how long. Agent Empires already captures tool calls via the hook system. Paperclip adds the *context* — why was this tool called, which ticket triggered it, what was the expected outcome.

The kill log is accessible from the unit inspection panel. It's not terminal scrollback — it's structured metadata. Each entry has:
- Timestamp
- Tool name + arguments (collapsed by default)
- Ticket reference
- Outcome (success/failure/partial)
- Token cost of this action

### 2.7 Persistent Agent State Across Heartbeats

Agents resume the same context — they don't restart from scratch. Paperclip achieves this through ticket threading: the ticket carries the conversation history, accumulated context, and decision log. When a Claw instance wakes for its next heartbeat, it loads the ticket and picks up where it left off.

This is different from PRD 12's "session persistence" (which deals with tmux window survival). This is *cognitive* persistence — the agent's understanding of the task survives, even if the underlying Claw instance is completely new.

---

## 3. What Paperclip Gets Wrong (For Us)

Paperclip is a good product solving a real problem. It's also built for a different user than we are. Four critical gaps:

### 3.1 "Task Manager" Framing

Paperclip looks like Jira for agents. Tickets in columns. Status labels. Approval workflows. It's competent and professional and it strips out every ounce of urgency, spatial reasoning, pattern recognition, and dopamine.

A ticket moving from "In Progress" to "Done" in a Kanban board tells you the same thing as a supply packet arriving at its destination on the battlefield. But one is a database state change you might notice on your third scan of the board. The other is a glowing dot completing its journey along a phosphor-green road, accompanied by a completion sound cue, with the receiving unit's health bar ticking up.

Same data. Different nervous system response.

### 3.2 No Spatial Model

Paperclip has org charts (hierarchy) but no territory (geography). It can tell you Agent-7 is assigned to the "Content" department and has 3 open tickets. It can't tell you that Content is adjacent to Sales, that the two share a supply road, and that Content's output queue is backing up because Sales hasn't consumed its last 4 proposals.

Spatial relationships reveal bottlenecks that hierarchical views hide. When you see two territories connected by a road with packets stacking up at the destination, you don't need a report to know something's wrong. The map *is* the report.

### 3.3 No Threat Visualization

Paperclip tracks tasks going in but doesn't surface external threats coming at you. There's no equivalent of PRD 02b's enemy system — no churn signals spawning as hostile units, no support tickets materializing as threats on the perimeter, no competitor launches appearing as incoming forces.

Paperclip answers "are we doing our work?" Agent Empires answers "are we doing our work AND is anyone attacking while we do it?"

### 3.4 No Emotional Loop

This is the fundamental gap. Paperclip is rational but not motivating. There's no anxiety when threats spawn, no satisfaction when territory turns green, no dopamine hit when a supply chain reaches full throughput. It's an accounting system that happens to manage agents.

Agent Empires exists because humans don't operate at peak on accounting systems. They operate at peak on war rooms, trading floors, and real-time strategy games. The data is the same. The cognitive wrapper determines whether you check it once a day or live inside it.

---

## 4. The Hybrid Model: RTS + Factorio

Agent Empires has always been an RTS. This PRD adds the second genre influence: Factorio. The combination creates something neither genre achieves alone.

### The Map is the Battlefield (RTS)

Territories, units, threats, fog of war. You command, not manage. Orders, not tickets. Deploy, not assign. The emotional vocabulary is military because military vocabulary encodes urgency. "Deploy a writer to the lead-gen front" hits different than "assign content-agent to the marketing department."

### The Roads are the Supply Chain (Factorio)

Data flowing between agents as visible packets on the map. Backed-up queues visible. Throughput metrics. This is where Factorio's genius comes in — the satisfaction of watching a well-oiled production line, and the immediate visual diagnosis when something jams.

In Factorio, you see the belt backing up before you see the resource count drop. In Agent Empires, you see packets stacking up at a unit's input queue before you see the campaign metric stall. The visualization is predictive, not reactive.

### The Economy is the War Chest (RTS)

Revenue = gold. Token spend = supply cost. Budget per agent = supply line per unit. Overspend on one front, another starves. PRD 05 covers this in detail. Paperclip's budget enforcement (Section 2.2) provides the backend.

### Governance is the Chain of Command (Military)

Not Jira approval workflows — battlefield escalation. Officers approve Operative-level decisions. Strategic decisions escalate to the General (user). From PRD 12:

```
General (User) — full authority, async attention
  └── Officers (Persistent) — autonomous within budget, escalate edge cases
       └── Operatives (Ephemeral) — execute single missions, report back
```

Paperclip calls this "governance tiers." We call it chain of command. Same mechanism, different framing. The framing matters because it encodes the urgency model: an approval workflow can wait until Monday. A battlefield escalation demands response.

### The Unifying Framing

> Every agent is a soldier. Every task is a mission. Every handoff is a supply line. Every bottleneck is an enemy position. Every wasted output is a casualty. Every completed objective is territory captured.

This isn't metaphor for metaphor's sake. It's a cognitive framework that makes invisible dynamics visible. "Agent-7 has low throughput" is data. "The northern supply line is starving because the Writer unit isn't producing" is a story you can act on.

---

## 5. Roads as Factorio Belts

The Roads system from PRD 02c specifies how roads form between units based on repeated workflow execution. This section extends roads into a full supply chain visualization.

### 5.1 Packet Rendering

Every handoff between agents is a visible packet moving along a road path:

```typescript
interface SupplyPacket {
  id: string
  type: 'ticket' | 'proposal' | 'deliverable' | 'report' | 'escalation'
  origin_unit: string
  destination_unit: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  ticket_id?: string           // Paperclip ticket reference
  title: string                // Short label for hover tooltip
  created_at: number
  eta_ms?: number              // Estimated time to consumption
}
```

Packets render as small glowing dots — cream (#F0E4D0) by default, shifting warmer based on priority:

| Priority | Color | Size | Speed |
|---|---|---|---|
| Low | `#F0E4D0` (cream) | 3px | 1x |
| Medium | `#C9A84C` (aged gold) | 4px | 1.2x |
| High | `#E87040` (ember) | 5px | 1.5x |
| Critical | `#FF4444` (crimson) | 6px, pulsing | 2x |

Packets move along the phosphor green (#82C896) road paths established in PRD 02c. Speed is visual only — it communicates priority, not actual processing time. A critical packet zips along the road. A low-priority one drifts.

### 5.2 Queue Visualization

When a unit has pending packets it hasn't consumed yet, they stack up at the destination end of the road:

```
                          ●●●●● ← 5 packets queued
Unit A ════════════════► Unit B
        packets in transit →●  ●
```

Queue stacking rules:
- Packets arriving at a unit that's busy (status: `working`) stack in a small cluster at the road endpoint
- Stack grows outward from the unit, along the road direction
- More than 3 stacked packets → the cluster starts glowing brighter (attention signal)
- More than 7 stacked packets → amber pulse on the road itself (bottleneck warning)
- More than 12 stacked packets → the road color shifts from green to amber (critical bottleneck)

This is the Factorio belt backup mechanic. You don't need a dashboard to see the bottleneck — you see packets physically stacking up, and the road changing color. The diagnosis is spatial and immediate.

### 5.3 Throughput Metrics Per Road

Every road tracks throughput:

```typescript
interface RoadMetrics {
  road_id: string
  from_unit: string
  to_unit: string
  packets_per_hour: number          // Rolling 1h average
  avg_time_in_transit_ms: number    // Creation to consumption
  avg_time_in_queue_ms: number      // Arrival to consumption
  current_queue_depth: number       // Packets waiting now
  peak_queue_depth_24h: number      // Worst backup in last day
  last_packet_at: number            // Timestamp of most recent packet
}
```

Throughput determines road visual intensity:
- **High throughput** (>10 packets/hour): Road fully opaque, bright green, slight animated shimmer
- **Medium throughput** (2-10/hour): Road at 70% opacity, steady green
- **Low throughput** (<2/hour): Road at 40% opacity, faded green
- **Dead road** (no traffic for 24h): Road dims to border color (#2A2118), then fades to 10% opacity over the next 24h
- **No traffic for 72h**: Road disappears from the map entirely

Dead roads are the supply chain equivalent of a closed highway. They're a signal — either the producing unit is idle, the consuming unit doesn't need the output, or the relationship has dissolved. All three are actionable intelligence.

### 5.4 Road Tooltip (Hover)

Hovering over a road shows a compact HUD:

```
Writer-01 → Sales-Lead-03
━━━━━━━━━━━━━━━━━━━━━━━━
  Throughput:    4.2 packets/hr
  Queue depth:   2 pending
  Avg transit:   3m 20s
  Last packet:   12 min ago
  Type:          proposals
```

### 5.5 Database-Driven Handoffs

Packets aren't just visual. They correspond to real handoff records in Supabase (schema in Section 9):

```typescript
interface MissionHandoff {
  id: string
  from_agent: string
  to_agent: string
  title: string
  objective: string
  priority: number
  risk_level: 'low' | 'medium' | 'high'
  context_snapshot: Record<string, unknown>
  status: 'pending' | 'accepted' | 'completed' | 'rejected'
  created_at: number
}
```

When a Claw instance completes a subtask and hands output to another agent, it writes a handoff record. The Agent Empires renderer picks this up via Supabase Realtime subscription and spawns a visual packet on the corresponding road. When the consuming agent accepts the handoff, the packet disappears with a small absorption animation (similar to the Read animation from PRD 02c — info particles streaming into the unit).

---

## 6. The Downstream Consumer Rule

The single most important design principle in this PRD. Borrowed from the Voxyz/OpenClaw reorg, validated by every org redesign that followed:

> **"If I delete this agent today, which other agent's work would be affected?"**

If the answer is "nothing changes" — that agent is a fake job. Delete it.

This is the organizational equivalent of dead code elimination. And just like dead code, fake jobs are invisible in list views. You have to trace the dependency graph to find them. That's what the road system does — it makes the dependency graph physical.

### 6.1 Visual Indicators

Every unit on the battlefield has visible handoff connections — who receives its output. The road system (PRD 02c) already renders these connections. This section adds the waste detection layer on top.

**Healthy unit:** Has at least one outgoing road with active traffic. Packets leave it and arrive somewhere. Status ring: normal green.

**Waste candidate:** Produces output that nobody consumes. Characteristics:
- All outgoing roads are dead (no traffic for 24h+)
- OR has no outgoing roads at all (isolated producer)
- OR outgoing packets get rejected (status: `rejected` on handoff records)

Visual treatment for waste candidates:
- Status ring shifts from green to sickly yellow (#C9B458, desaturated gold)
- A small caution icon (⚠) appears above the unit sprite
- The unit's territory contribution dims — it's not helping this front
- Tooltip reads: "No downstream consumers. Output is unconsumed."

**Dead supply line:** A road with no traffic. Same as Section 5.3's dead road — dims to border color, then fades. But in the context of the downstream consumer rule, a dead road is an indictment: the relationship that justified this unit's existence has dissolved.

### 6.2 The Waste Dashboard

Accessible from the Economy Panel (PRD 05, Section 3), a dedicated "Supply Chain Health" tab:

```
SUPPLY CHAIN HEALTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Active Roads:        14
Dead Roads:           3  ⚠
Avg Throughput:      6.1 packets/hr
Bottlenecks:          1  (Sales intake)

WASTE CANDIDATES
─────────────────────────────────────
⚠ Writer-04     No consumers for 48h      $8.20 spent
⚠ Scout-02      Output rejected 3x        $4.10 spent
⚠ Operative-09  All roads dead             $2.40 spent
                                    Total: $14.70 wasted

BOTTLENECKS
─────────────────────────────────────
🔴 Sales-Lead-03   Queue: 8 packets        Oldest: 4h ago
🟡 Fulfillment-01  Queue: 4 packets        Oldest: 1h ago
```

### 6.3 Automated Waste Detection

The system doesn't just display waste — it actively detects and surfaces it:

```typescript
interface WasteDetector {
  // Runs every 15 minutes
  checkInterval: number

  // A unit is a waste candidate if:
  isWasteCandidate(unit: Unit): boolean {
    const outgoingRoads = getRoadsFrom(unit.id)

    // No outgoing roads at all
    if (outgoingRoads.length === 0) return true

    // All outgoing roads dead (no traffic 24h)
    const allDead = outgoingRoads.every(r =>
      Date.now() - r.metrics.last_packet_at > 24 * 60 * 60 * 1000
    )
    if (allDead) return true

    // High rejection rate (>50% of handoffs rejected)
    const recentHandoffs = getHandoffsFrom(unit.id, { since: '24h' })
    const rejectionRate = recentHandoffs.filter(h =>
      h.status === 'rejected'
    ).length / recentHandoffs.length
    if (rejectionRate > 0.5) return true

    return false
  }
}
```

When a unit is flagged as a waste candidate, the system generates an intel event (PRD 01, Section 5) with severity `MEDIUM`. The notification reads like a field report:

> **SUPPLY CHAIN ALERT — Writer-04 operating without consumers**
> Unit has produced 6 deliverables in the last 48h. None were consumed by downstream units. Recommend: reassign, retask, or decommission. Current cost: $8.20/cycle.

---

## 7. Unit Inspection Panel

PRD 01 defines the unit detail panel (right sidebar, Unit tab). This section specifies the full inspection view that integrates Paperclip's structured metadata with Agent Empires' spatial context.

When you click a unit on the battlefield, the detail panel shows structured metadata — not terminal scrollback.

### 7.1 Panel Layout

```
┌─────────────────────────────────┐
│ ⚔ WRITER-01                     │
│ "The Quill" — Content Producer   │
│ Territory: Lead-Gen Front        │
│ Status: ● Working                │
├─────────────────────────────────┤
│ LOADOUT                         │
│ ├── content:generate-linkedin    │
│ ├── content:generate-twitter     │
│ ├── quality:audit-ai-detection   │
│ └── quality:fix-ai-patterns      │
├─────────────────────────────────┤
│ HANDOFF MAP                     │
│  ← Scout-03 (research briefs)   │
│  → Sales-Lead-03 (proposals)    │
│  → Social-Queue (scheduled)     │
├─────────────────────────────────┤
│ GOAL CHAIN                      │
│ Task: Write LI post #347        │
│  └── Project: Weekly Batch       │
│       └── Campaign: Scale CCB    │
│            └── Objective: $50K   │
├─────────────────────────────────┤
│ MEMORY STATE                    │
│ Context: ████████░░ 78%          │
│ Key decisions: 4 this session    │
│ Accumulated context: 134K tokens │
├─────────────────────────────────┤
│ QUEUE                           │
│ ├── #348 Twitter thread (med)    │
│ ├── #351 Newsletter draft (high) │
│ └── #355 Case study (low)        │
├─────────────────────────────────┤
│ SUPPLY LINE                     │
│ Budget: $12.40 / $50.00          │
│ ████████████░░░░░░░░░ 25%        │
│ Cost this cycle: $3.20           │
│ Projected depletion: 3.2 days    │
├─────────────────────────────────┤
│ KILL LOG (last 5)               │
│ 10:42 ✓ LI post published       │
│ 10:38 ✓ AI detection pass (A)   │
│ 10:31 ✓ Draft v2 written         │
│ 10:25 ✓ Research brief consumed  │
│ 10:20 ✓ Ticket #347 checked out  │
├─────────────────────────────────┤
│ [View Terminal] [Send Order]     │
│ [Reassign] [Decommission]        │
└─────────────────────────────────┘
```

### 7.2 Section Details

**Identity** — Role name, callsign (user-assignable nickname), current territory. The SOUL.md equivalent from Paperclip — who am I, who do I serve, what are my boundaries.

**Loadout** — Which skills are equipped. This comes from the session template (PRD 01, Section 2) plus any skills loaded dynamically during the session. Shows the unit's capabilities at a glance — a Writer with `quality:check-gptzero` equipped is a different animal than one without.

**Handoff Map** — Incoming and outgoing connections. This is the downstream consumer rule made personal. If a unit has zero outgoing connections, you see it immediately. If it has incoming connections but nothing outgoing, it's a dead end in the supply chain.

**Goal Chain** — Task → Project → Campaign → War Objective. From Paperclip's goal ancestry (Section 2.4). Clicking any level in the chain filters the battlefield to show all units working on that same goal. "Show me everyone working on the CCB campaign" is one click.

**Memory State** — Context window usage (from hook events), key decisions logged this session, accumulated context size. This is the "cognitive health" of the unit. A unit at 95% context is about to lose coherence — it needs rotation.

**Queue** — Pending tickets assigned to this unit, sorted by priority. From Paperclip's ticket system. Each entry shows ticket number, title, and priority color. Clicking a ticket shows the full ticket detail as a modal.

**Supply Line** — Token budget used vs. remaining, cost this cycle, projected depletion. From PRD 05's economy system plus Paperclip's budget enforcement. The depletion projection uses the rolling average burn rate to estimate when the unit will hit its budget cap.

**Kill Log** — Completed actions with timestamps. Not a raw event log — curated to show meaningful completions. "Draft written" not "Bash: echo hello." Structured from Paperclip's audit trail, filtered through Agent Empires' relevance heuristic (show tool completions that correspond to ticket progress, not intermediate steps).

### 7.3 Panel Actions

| Button | Action | Confirmation |
|---|---|---|
| **View Terminal** | Opens tmux window for this session in a new browser tab (or focuses existing) | None |
| **Send Order** | Opens command bar pre-filled with unit target: `Writer-01, ` | None |
| **Reassign** | Shows territory picker, moves unit to new front | "Move Writer-01 to Sales front?" |
| **Decommission** | Gracefully ends the session after current task completes | "Decommission Writer-01? Current task will complete first." |

---

## 8. Integration Architecture

### 8.1 Data Flow

Agent Empires and Paperclip are not connected by an API. They're connected by a database. Both systems read and write to the same Supabase tables. This is the key architectural decision — no sync layer, no webhook bridge, no eventual consistency headaches. Single source of truth.

```
Agent Empires (browser)                    Paperclip (server)
       │                                          │
       │  Supabase Realtime                       │  Supabase Client
       │  (subscriptions)                         │  (reads/writes)
       │                                          │
       ▼                                          ▼
┌──────────────────────────────────────────────────────┐
│                    SUPABASE                           │
│                                                      │
│  ae_handoffs ─── supply chain packets                │
│  ae_tickets ──── task persistence (Paperclip writes) │
│  ae_budgets ──── per-unit spend caps                 │
│  ae_audit_log ── tool-call traces                    │
│  ae_agents ───── unit registry + state               │
│  ae_goals ────── ancestry chain                      │
│                                                      │
│  (+ existing tables from PRDs 01, 05)                │
└──────────────────────────────────────────────────────┘
       │                                          │
       │  Hook events                             │  Heartbeat writes
       │  (WebSocket → server → Supabase)         │  (cron → agent → Supabase)
       │                                          │
       ▼                                          ▼
   Claw Instances                          Claw Instances
   (interactive, tmux)                     (scheduled, heartbeat)
```

### 8.2 Who Writes What

| Table | Agent Empires Writes | Paperclip Writes |
|---|---|---|
| `ae_handoffs` | Status updates (accepted, completed) | Creates handoffs, assigns destinations |
| `ae_tickets` | Read-only (displays in queue/panel) | Full CRUD — create, assign, resolve |
| `ae_budgets` | Read-only (displays in resource bar) | Set/adjust budget caps |
| `ae_audit_log` | Writes tool-call events (via hooks) | Writes governance decisions |
| `ae_agents` | Writes position, status, territory | Writes role, budget, goal assignment |
| `ae_goals` | Read-only (displays in goal chain) | Full CRUD — define objectives, campaigns |

### 8.3 Conflict Resolution

Since both systems write to the same tables, conflict rules:

1. **Position/territory**: Agent Empires wins. The general moves units on the map — that's a spatial command, and the map is the authority.
2. **Budget/role/governance**: Paperclip wins. Structural decisions are administrative, and the Pentagon is the authority.
3. **Status**: Last writer wins (both systems can mark a ticket as completed).
4. **Handoffs**: Paperclip creates, Agent Empires consumes. No conflict — different lifecycle stages.

---

## 9. Supabase Schema

New tables introduced by this PRD. These extend the existing schema from PRDs 01 (ae_campaigns, ae_intel, ae_deployments) and 05 (ae_transactions, ae_token_ledger).

```sql
-- Mission handoffs (supply chain packets)
CREATE TABLE ae_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT,
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  context_snapshot JSONB DEFAULT '{}',
  ticket_id UUID REFERENCES ae_tickets(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Road metrics (supply chain throughput, materialized from ae_handoffs)
CREATE TABLE ae_road_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  packets_per_hour REAL DEFAULT 0,
  avg_transit_ms INTEGER DEFAULT 0,
  avg_queue_ms INTEGER DEFAULT 0,
  current_queue_depth INTEGER DEFAULT 0,
  peak_queue_depth_24h INTEGER DEFAULT 0,
  last_packet_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(from_agent, to_agent)
);

-- Tickets (Paperclip task persistence layer)
CREATE TABLE ae_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  assigned_agent TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected', 'blocked')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  goal_id UUID REFERENCES ae_goals(id),
  conversation_thread JSONB DEFAULT '[]',
  context JSONB DEFAULT '{}',
  token_cost INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Goal ancestry (War Objective → Campaign → Project → Task)
CREATE TABLE ae_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('objective', 'campaign', 'project', 'task')),
  parent_id UUID REFERENCES ae_goals(id),
  status TEXT DEFAULT 'active',
  target_metric TEXT,
  target_value REAL,
  current_value REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Per-agent budget caps
CREATE TABLE ae_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  monthly_cap_usd REAL NOT NULL DEFAULT 50.00,
  current_spend_usd REAL DEFAULT 0,
  cycle_start TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  throttled BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log (tool-call traces + governance decisions)
CREATE TABLE ae_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'tool_call', 'governance', 'escalation', 'budget_alert'
  tool_name TEXT,
  tool_args JSONB,
  tool_result_summary TEXT,
  ticket_id UUID REFERENCES ae_tickets(id),
  token_cost INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Waste detection results (populated by scheduled detector)
CREATE TABLE ae_waste_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  reason TEXT NOT NULL, -- 'no_consumers', 'all_roads_dead', 'high_rejection_rate'
  detail TEXT,
  spend_since_flagged_usd REAL DEFAULT 0,
  flagged_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT -- 'reassigned', 'retasked', 'decommissioned', 'false_positive'
);

-- Index for common queries
CREATE INDEX idx_handoffs_status ON ae_handoffs(status) WHERE status = 'pending';
CREATE INDEX idx_handoffs_to_agent ON ae_handoffs(to_agent);
CREATE INDEX idx_tickets_assigned ON ae_tickets(assigned_agent) WHERE status IN ('open', 'in_progress');
CREATE INDEX idx_goals_parent ON ae_goals(parent_id);
CREATE INDEX idx_audit_agent ON ae_audit_log(agent_id, created_at DESC);
CREATE INDEX idx_waste_active ON ae_waste_flags(agent_id) WHERE resolved_at IS NULL;
```

### Realtime Subscriptions

```typescript
// Supply chain packets — animate on road
supabase
  .channel('handoffs')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'ae_handoffs'
  }, (payload) => {
    spawnPacketOnRoad(payload.new)
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'ae_handoffs',
    filter: 'status=eq.completed'
  }, (payload) => {
    consumePacketAtDestination(payload.new)
  })
  .subscribe()

// Budget alerts — throttle units that hit caps
supabase
  .channel('budgets')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'ae_budgets',
    filter: 'throttled=eq.true'
  }, (payload) => {
    throttleUnitOnMap(payload.new.agent_id)
  })
  .subscribe()

// Waste flags — mark units with caution indicators
supabase
  .channel('waste')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'ae_waste_flags'
  }, (payload) => {
    markUnitAsWaste(payload.new.agent_id, payload.new.reason)
  })
  .subscribe()
```

---

## 10. TypeScript Interfaces

Core types introduced by this PRD. These extend the existing type system in `shared/types.ts`.

```typescript
// === Supply Chain ===

interface SupplyPacket {
  id: string
  handoff_id: string              // References ae_handoffs.id
  type: PacketType
  origin_unit: string
  destination_unit: string
  priority: Priority
  title: string
  status: 'in_transit' | 'queued' | 'consumed' | 'rejected'
  created_at: number
}

type PacketType = 'ticket' | 'proposal' | 'deliverable' | 'report' | 'escalation'
type Priority = 'low' | 'medium' | 'high' | 'critical'

interface RoadState {
  id: string
  from_unit: string
  to_unit: string
  metrics: RoadMetrics
  visual: {
    opacity: number             // 0.1 (dead) to 1.0 (high throughput)
    color: number               // Green → amber → border based on queue depth
    shimmer: boolean            // True for high-throughput roads
  }
  packets_in_transit: SupplyPacket[]
  queue_at_destination: SupplyPacket[]
}

interface RoadMetrics {
  packets_per_hour: number
  avg_transit_ms: number
  avg_queue_ms: number
  current_queue_depth: number
  peak_queue_depth_24h: number
  last_packet_at: number
}

// === Waste Detection ===

interface WasteFlag {
  agent_id: string
  reason: 'no_consumers' | 'all_roads_dead' | 'high_rejection_rate'
  detail: string
  spend_since_flagged: number
  flagged_at: number
}

// === Unit Inspection ===

interface UnitInspection {
  identity: {
    role: string
    callsign: string
    territory: string
    status: UnitStatus
    soul: string               // SOUL.md content summary
  }
  loadout: string[]            // Equipped skill names
  handoff_map: {
    incoming: HandoffConnection[]
    outgoing: HandoffConnection[]
  }
  goal_chain: GoalChainNode[]
  memory: {
    context_usage: number      // 0.0 - 1.0
    key_decisions: number
    accumulated_tokens: number
  }
  queue: QueuedTicket[]
  supply_line: {
    budget_used: number
    budget_cap: number
    cost_this_cycle: number
    projected_depletion_days: number
  }
  kill_log: KillLogEntry[]
}

interface HandoffConnection {
  unit_id: string
  unit_name: string
  road_id: string
  packet_type: PacketType
  throughput: number           // packets/hr
}

interface GoalChainNode {
  level: 'objective' | 'campaign' | 'project' | 'task'
  name: string
  goal_id: string
  progress?: number            // 0.0 - 1.0
}

interface QueuedTicket {
  ticket_id: string
  title: string
  priority: Priority
  age_ms: number
}

interface KillLogEntry {
  timestamp: number
  action: string               // Human-readable completion
  ticket_id?: string
  token_cost: number
  outcome: 'success' | 'failure' | 'partial'
}

// === Budget ===

interface UnitBudget {
  agent_id: string
  monthly_cap: number
  current_spend: number
  throttled: boolean
  burn_rate_per_hour: number
  projected_depletion: Date | null
}
```

---

## 11. PixiJS Rendering

### 11.1 Packet Sprites

Packets are simple circles with a glow filter. No complex sprites — the road system already provides visual complexity. Packets should read as "data in motion."

```typescript
class PacketSprite extends PIXI.Container {
  private dot: PIXI.Graphics
  private glow: PIXI.Graphics

  constructor(packet: SupplyPacket) {
    super()

    const config = PACKET_PRIORITY_CONFIG[packet.priority]

    // Core dot
    this.dot = new PIXI.Graphics()
    this.dot.beginFill(config.color)
    this.dot.drawCircle(0, 0, config.radius)
    this.dot.endFill()

    // Glow (larger, transparent version behind the dot)
    this.glow = new PIXI.Graphics()
    this.glow.beginFill(config.color, 0.3)
    this.glow.drawCircle(0, 0, config.radius * 2.5)
    this.glow.endFill()

    this.addChild(this.glow)
    this.addChild(this.dot)

    // Critical packets pulse
    if (packet.priority === 'critical') {
      this.startPulse()
    }
  }

  private startPulse(): void {
    // Scale oscillation: 1.0 → 1.4 → 1.0 over 800ms
    const ticker = PIXI.Ticker.shared
    let elapsed = 0
    ticker.add((delta) => {
      elapsed += delta * (1000 / 60)
      const t = (Math.sin(elapsed / 800 * Math.PI * 2) + 1) / 2
      this.scale.set(1.0 + t * 0.4)
    })
  }
}

const PACKET_PRIORITY_CONFIG = {
  low:      { color: 0xF0E4D0, radius: 3 },
  medium:   { color: 0xC9A84C, radius: 4 },
  high:     { color: 0xE87040, radius: 5 },
  critical: { color: 0xFF4444, radius: 6 },
} as const
```

### 11.2 Packet Movement Along Roads

Packets follow road paths using parametric interpolation. Roads are stored as arrays of waypoints (from PRD 02c). Packets lerp between waypoints at their priority-determined speed.

```typescript
class PacketMover {
  movePacket(
    packet: PacketSprite,
    road: RoadState,
    speed: number,
    onArrive: () => void
  ): void {
    const waypoints = road.waypoints  // From PRD 02c road geometry
    let waypointIndex = 0
    let t = 0

    PIXI.Ticker.shared.add((delta) => {
      if (waypointIndex >= waypoints.length - 1) {
        onArrive()
        return
      }

      const from = waypoints[waypointIndex]
      const to = waypoints[waypointIndex + 1]
      const segmentLength = distance(from, to)

      t += (delta * speed) / segmentLength
      if (t >= 1) {
        t = 0
        waypointIndex++
      } else {
        packet.x = lerp(from.x, to.x, t)
        packet.y = lerp(from.y, to.y, t)
      }
    })
  }
}
```

### 11.3 Queue Stack Rendering

When packets arrive at a destination unit that's busy, they stack along the incoming road direction:

```typescript
class QueueRenderer {
  renderQueue(
    unit: UnitSprite,
    road: RoadState,
    queuedPackets: PacketSprite[]
  ): void {
    // Calculate stack direction (opposite of road arrival direction)
    const lastWaypoint = road.waypoints[road.waypoints.length - 2]
    const unitPos = road.waypoints[road.waypoints.length - 1]
    const dir = normalize({
      x: lastWaypoint.x - unitPos.x,
      y: lastWaypoint.y - unitPos.y,
    })

    // Stack packets along this direction, 8px apart
    queuedPackets.forEach((packet, i) => {
      packet.x = unitPos.x + dir.x * (20 + i * 8)
      packet.y = unitPos.y + dir.y * (20 + i * 8)
    })

    // Brightness increases with queue depth
    const brightness = Math.min(1.0, 0.5 + queuedPackets.length * 0.07)
    queuedPackets.forEach(p => p.alpha = brightness)
  }
}
```

### 11.4 Waste Indicator

Units flagged as waste candidates get a caution overlay:

```typescript
class WasteIndicator extends PIXI.Container {
  private icon: PIXI.Text
  private statusTint: PIXI.Graphics

  constructor(unit: UnitSprite) {
    super()

    // Sickly yellow ring replacing normal status ring
    this.statusTint = new PIXI.Graphics()
    this.statusTint.lineStyle(2, 0xC9B458, 0.8)
    this.statusTint.drawCircle(0, 0, unit.radius + 4)
    this.addChild(this.statusTint)

    // Caution icon above unit
    this.icon = new PIXI.Text('⚠', {
      fontSize: 14,
      fill: 0xC9B458,
    })
    this.icon.anchor.set(0.5)
    this.icon.y = -(unit.radius + 16)
    this.addChild(this.icon)

    // Slow pulse on the icon
    let elapsed = 0
    PIXI.Ticker.shared.add((delta) => {
      elapsed += delta * (1000 / 60)
      this.icon.alpha = 0.6 + Math.sin(elapsed / 1200 * Math.PI * 2) * 0.4
    })
  }
}
```

### 11.5 Aesthetic Constants

All colors follow the Magnetic Residue palette established in PRD 06:

```typescript
const SUPPLY_CHAIN_PALETTE = {
  // Packet colors (by priority)
  packet_low: 0xF0E4D0,         // Cream
  packet_medium: 0xC9A84C,      // Aged gold
  packet_high: 0xE87040,        // Ember
  packet_critical: 0xFF4444,    // Crimson

  // Road colors
  road_active: 0x82C896,        // Phosphor green
  road_bottleneck: 0xC9A84C,    // Amber (queue > 7)
  road_dead: 0x2A2118,          // Border color (fading)

  // Waste indicators
  waste_ring: 0xC9B458,         // Sickly yellow (desaturated gold)
  waste_icon: 0xC9B458,         // Matches ring

  // Budget
  budget_healthy: 0x4A7C59,     // Forest green
  budget_warning: 0xC9A84C,     // Amber (>70% spent)
  budget_throttled: 0x8B2500,   // Crimson (at cap)
} as const
```

---

## 12. Implementation Plan

### Phase A: Roads Visualization (2-3 days)

**Scope:** Render data flow paths between units with animated packets. This is Phase 2C from the existing build plan, extended with the supply chain spec.

- [ ] Implement `PacketSprite` with priority-based color/size/speed
- [ ] Implement `PacketMover` for road-following interpolation
- [ ] Spawn test packets on existing roads (from PRD 02c) on mock timer
- [ ] Queue stack rendering when destination unit is busy
- [ ] Road opacity driven by throughput (rolling average calculation)
- [ ] Dead road detection and fade-out animation
- [ ] Road tooltip on hover (throughput, queue depth, last packet)

**Depends on:** PRD 02c roads being renderable (road geometry, waypoints).

### Phase B: Ticket Integration (2-3 days)

**Scope:** Paperclip tickets visible as road packets. Real handoffs replace mock data.

- [ ] Create `ae_handoffs` and `ae_tickets` tables in Supabase
- [ ] Supabase Realtime subscription for new handoffs → packet spawn
- [ ] Supabase Realtime subscription for handoff completion → packet consumption animation
- [ ] Ticket display in unit inspection panel queue section
- [ ] Atomic checkout — prevent duplicate ticket assignment
- [ ] Conversation threading on tickets (context that survives Claw instance restart)

**Depends on:** Phase A (packets render), Paperclip ticket schema alignment.

### Phase C: Budget & Supply Visualization (1-2 days)

**Scope:** Resource bar shows per-territory costs. Budget enforcement throttles units.

- [ ] Create `ae_budgets` table
- [ ] Per-unit supply line display in inspection panel
- [ ] Territory-level budget aggregation in resource bar
- [ ] Budget throttle detection → unit status ring change (amber) + road dim
- [ ] Projected depletion calculation (burn rate extrapolation)

**Depends on:** PRD 05 resource bar (rendering), Phase B (tickets track token cost).

### Phase D: Goal Ancestry in Unit Inspection (1-2 days)

**Scope:** Full goal chain display. Click-to-filter by goal level.

- [ ] Create `ae_goals` table with self-referencing parent_id
- [ ] Goal chain rendering in inspection panel
- [ ] Click goal level → filter battlefield to show all units on that goal
- [ ] Goal progress bars (current_value / target_value)

**Depends on:** Phase B (tickets reference goals).

### Phase E: Downstream Consumer Detection (2-3 days)

**Scope:** Identify and flag waste. The organizational dead code eliminator.

- [ ] Create `ae_waste_flags` table
- [ ] Implement `WasteDetector` (runs on 15-min interval via pg_cron or server-side timer)
- [ ] `WasteIndicator` PixiJS overlay on flagged units
- [ ] Supply Chain Health tab in Economy Panel
- [ ] Intel event generation for new waste flags
- [ ] Resolution tracking (reassigned, retasked, decommissioned, false positive)

**Depends on:** Phase A (road traffic data), Phase B (handoff rejection tracking).

### Total Estimate: 8-13 days

Sequential. Each phase validates the previous. Phase A is the foundation — if packets don't render well on roads, nothing else matters. Phase E is the payoff — the downstream consumer rule is what makes this system genuinely useful, not just pretty.

---

## Dependencies

| PRD | What This PRD Needs From It |
|---|---|
| `01-vision.md` | Territory layout, unit sprites, HUD scaffold, event system |
| `02c-combat-and-roads-spec.md` | Road geometry, waypoints, road formation mechanic |
| `05-resource-economy.md` | Resource bar, economy panel, token tracking |
| `12-distributed-fleet-architecture.md` | Unit persistence tiers, heartbeat protocol, Officer/Operative distinction |

| External | What This PRD Needs From It |
|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip) | Ticket schema alignment, budget enforcement logic, goal ancestry model |
| Supabase | Realtime subscriptions, pg_cron for waste detection |

---

## Open Questions

1. **Paperclip schema alignment** — Does Paperclip's ticket schema map cleanly to `ae_tickets`, or do we need a translation layer? If their schema diverges significantly, we may need a sync function rather than shared tables.

2. **Budget source of truth** — Should budget caps live in Supabase (our schema) or in Paperclip's own storage? If Paperclip has its own DB, we need to decide who owns the budget number.

3. **Waste detection thresholds** — 24h with no traffic before flagging as dead seems aggressive for Officer-tier units that wake on daily heartbeats. May need per-tier thresholds: Operatives at 24h, Officers at 72h.

4. **Packet volume at scale** — With 20+ Claw instances producing tickets, road rendering could hit hundreds of packets simultaneously. Need to test PixiJS performance ceiling and potentially implement packet batching (cluster of 10 packets renders as one larger glow).

5. **Paperclip governance model** — Paperclip has approval workflows. Do we render approval gates as visible chokepoints on roads (packets stop until approved), or do we keep governance invisible and only show the result? Visible chokepoints are more honest but add visual noise.

6. **Goal ancestry depth** — Four levels (Objective → Campaign → Project → Task) may not be enough for complex operations, or may be too many for simple ones. Should the chain be fixed-depth or arbitrary?