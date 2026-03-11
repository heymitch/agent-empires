# Agent Empires — Product Requirements Document

## v0.1 — The War Room

**Codename:** Agent Empires
**Forked from:** [Vibecraft](https://github.com/Nearcyan/vibecraft) (MIT License)
**Repo:** `~/agent-empires`

---

## 1. Vision

Agent Empires is a real-time strategy interface for operating a business through AI agents. Each Claude Code session is a military unit on a battlefield. Business domains are territory. Revenue is the score. The user is the commanding general — issuing orders, monitoring fronts, responding to intelligence, and scaling through delegation.

This is not a dashboard. This is not a monitoring tool. This is a **war room** where every dollar of revenue is fought for, every skill is a weapon, and every idle agent is a wasted soldier.

### Why RTS?

The RTS genre solved a fundamental UI problem: **how does one human manage dozens of autonomous units across multiple fronts simultaneously?** That's exactly the problem of scaling a business with AI agents. The genre's 30 years of UX innovation — minimaps, control groups, fog of war, resource management, rally points, tech trees — are directly applicable.

### Why Fork Vibecraft?

Vibecraft already solved the hard engineering:
- tmux session management (spawn, kill, prompt, observe Claude instances)
- Hook system intercepting every Claude tool call as structured JSON
- WebSocket bridge broadcasting real-time events to browser
- Session state tracking (idle/working/offline)
- Multi-session orchestration with REST API
- Sub-agent visualization

We keep all of this. We replace the 3D workshop renderer with a 2D RTS battlefield and add intelligence/command layers.

### Why Not Just a Dashboard?

Dashboards are passive. You look at them. An RTS interface is active — you command through it. The difference:

| Dashboard | War Room |
|-----------|----------|
| Shows data | Shows data AND accepts commands |
| You alt-tab to take action | Actions happen in-place |
| Siloed views | Unified strategic picture |
| No urgency model | Attention system with priorities |
| Static layout | Dynamic — units move, fronts shift |

### The TMUX Foundation

Every "unit" is a tmux **window** running a Claude Code session on the user's subscription (no API costs). The user sees the battlefield in the browser but can `tmux select-window` to drop into any unit's terminal and see exactly what Claude is doing/saying. This is the key insight: **the visualization is a lens over real work, not a simulation.**

```
tmux session: "agent-empires"
  Window 0: [BROWSER]    — God's eye view (the RTS interface)
  Window 1: [COMMANDER]  — Prime agent / CEO agent
  Window 2: [LIEUTENANT] — Content battalion lead
  Window 3: [LIEUTENANT] — Sales operations lead
  Window 4: [SCOUT]      — Analytics & market monitor
  Window 5: [ENGINEER]   — Skill builder / R&D
  Window 6: [OPERATIVE]  — Ad-hoc task runner
  ...
```

---

## 2. Core Metaphor Mapping

### Military → Business

| RTS Concept | Business Reality | Implementation |
|---|---|---|
| **General** (you) | CEO / Operator | Browser HUD + tmux god mode |
| **Units** | Claude Code sessions | tmux windows, each a subscription instance |
| **Unit Types** | Agent roles (writer, researcher, builder) | Session templates with pre-loaded skills |
| **Squads / Control Groups** | Agent teams (content team, sales team) | Grouped windows, batch commands |
| **Buildings / Factories** | Skill creators — produce new unit types | Dedicated Claude sessions running `/skills:create` |
| **Barracks** | Session spawner | `POST /sessions` with template |
| **Tech Tree** | Skill dependency chains | Skills that require other skills to exist first |
| **Resources: Gold** | Revenue ($) | Stripe/payment webhook → Supabase → HUD |
| **Resources: Supply** | Context tokens remaining | Per-session token tracking (already in Vibecraft) |
| **Resources: Mana/Energy** | API credits / subscription hours | Daily budget tracking |
| **Resources: Population Cap** | Max concurrent Claude sessions | Subscription plan limits |
| **Territory** | Business domains | Sales, Fulfillment, Lead-Gen, Support, Home |
| **Fog of War** | Unmonitored data sources | Domains without active scouts/analytics |
| **Intel / Reconnaissance** | Market research, analytics, competitor moves | Supabase dashboards + web scraping agents |
| **Enemy Units** | Churn signals, support tickets, competitor launches | Real events pushed via webhooks |
| **Objectives / Missions** | OKRs, sprint goals, revenue targets | Campaign mode with real metrics |
| **Rally Points** | Output destinations | Notion, Kit, Slack, GitHub — where work gets routed |
| **Minimap** | System-wide overview | All domains + all agents at a glance |
| **Attack Orders** | Task assignments | Prompt injection to specific tmux windows |
| **Patrol** | Recurring monitoring tasks | `/loop` skill running on interval |
| **Siege** | Long-running campaigns | Multi-day content batches, launch sequences |

### Unit Types (Session Templates)

| Unit | Role | Pre-loaded Skills | Icon |
|---|---|---|---|
| **Commander** | Prime orchestrator, delegates to all others | All skills, sub-agent spawning | Crown |
| **Lieutenant** | Domain lead, manages a front | Domain-specific skills | Shield |
| **Scout** | Recon & intelligence gathering | analytics, web research, trend-jacking | Binoculars |
| **Writer** | Content production | content:generate-*, quality:* | Quill |
| **Engineer** | Builds new capabilities | skills:create, mcp-builder | Wrench |
| **Operative** | Executes specific missions | Task-specific, loaded on deploy | Crosshair |
| **Medic** | Fixes broken things, support | support, debugging, QA | Cross |
| **Diplomat** | Sales, outreach, partnerships | sales:*, consulting:* | Handshake |

### Territory Map

The battlefield is divided into **fronts** that correspond to business domains:

```
┌─────────────────────────────────────────────────────┐
│                    THE BATTLEFIELD                     │
│                                                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│   │ LEAD-GEN │  │  SALES   │  │FULFILLMENT│          │
│   │  FRONT   │──│  FRONT   │──│  FRONT    │          │
│   │          │  │          │  │           │          │
│   └────┬─────┘  └────┬─────┘  └─────┬─────┘         │
│        │              │               │               │
│   ┌────┴─────┐  ┌────┴─────┐  ┌─────┴─────┐         │
│   │ CONTENT  │  │ SUPPORT  │  │ RETENTION  │         │
│   │  BASE    │  │  BASE    │  │   BASE     │         │
│   └──────────┘  └──────────┘  └───────────┘          │
│                                                       │
│                  ┌──────────┐                         │
│                  │   HQ     │  (Home / Personal)      │
│                  │  (YOU)   │                         │
│                  └──────────┘                         │
└─────────────────────────────────────────────────────┘
```

Units are positioned in the territory they're currently operating in. When you assign a content writer to work on a LinkedIn post, it moves to the Lead-Gen front. When a sales agent preps a call, it's on the Sales front.

---

## 3. Architecture

### What We Keep from Vibecraft (DO NOT REBUILD)

| Component | Location | Purpose |
|---|---|---|
| Hook system | `hooks/vibecraft-hook.sh` | Captures every Claude tool call as JSON |
| WebSocket server | `server/index.ts` | Bridges hooks → browser in real-time |
| Session management | `server/index.ts` | Spawn/kill/prompt tmux sessions via REST |
| Event types | `shared/types.ts` | Typed event contract (keep + extend) |
| EventBus | `src/events/EventBus.ts` | Decoupled event routing |
| Event handlers | `src/events/handlers/` | Sound, notification, character, subagent |
| Session API | `src/api/SessionAPI.ts` | Client-side session CRUD |
| Sound system | `src/audio/SoundManager.ts` | Synthesized audio (keep + reskin) |
| CLI/setup | `bin/cli.js` | `npx agent-empires setup` |

### What We Replace

| Vibecraft | Agent Empires | Reason |
|---|---|---|
| Three.js 3D workshop | **PixiJS 2D RTS renderer** | 2D is better for strategic overview, easier to develop, better performance with many units |
| Workstations (bookshelf, desk...) | **Territory zones** | Business domains, not tool categories |
| ClaudeMon robot character | **Military unit sprites** | Different unit types with distinct silhouettes |
| Hex workshop layout | **Strategic territory map** | Zones = business domains, not hex platforms |
| Activity feed (40% panel) | **Command HUD with tabs** | Intel, Orders, Resources, Comms |
| Draw mode | **Campaign planner** | Draw attack routes becomes "plan execution sequence" |

### What We Add (New Systems)

| System | Purpose | Data Source |
|---|---|---|
| **Intel Feed** | Real-time business intelligence | Supabase subscriptions, webhooks |
| **Resource Bars** | Token budget, revenue, time, capacity | tmux + Supabase + Stripe |
| **Campaign Mode** | Persistent objectives with progress | Supabase `campaigns` table |
| **Command Bar** | Issue orders to units without switching | tmux send-keys via REST |
| **Minimap** | All-domain overview with alert pings | Session positions + status |
| **Notification Tray** | Priority-ranked alerts from all fronts | Slack, email, analytics webhooks |
| **Fog of War** | Visual indicator of stale/unmonitored areas | Data freshness timestamps |
| **Enemy Spawner** | Incoming threats (tickets, churn, competitors) | Webhooks + scheduled checks |
| **Physics Layer** | Particle effects, projectile animations | PixiJS particles (lightweight) |

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (PixiJS)                        │
│                                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │Battlefield│ │   HUD    │ │ Minimap  │ │ Command  │    │
│  │ Renderer  │ │  Panels  │ │          │ │   Bar    │    │
│  └─────┬─────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘   │
│        └──────────────┴────────────┴────────────┘        │
│                           │                               │
│                    WebSocket Client                       │
└───────────────────────────┬───────────────────────────────┘
                            │
┌───────────────────────────┴───────────────────────────────┐
│                   WebSocket Server (Node.js)                │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Session Mgr  │  │ Intel Router │  │  Campaign Engine  │ │
│  │ (from VC)    │  │   (NEW)      │  │     (NEW)        │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                    │             │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌────────┴─────────┐  │
│  │ tmux Bridge  │  │  Supabase    │  │   Webhook        │  │
│  │ (from VC)    │  │  Realtime    │  │   Receiver       │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼────────────────┼────────────────────┼────────────┘
          │                │                    │
    ┌─────┴─────┐   ┌─────┴─────┐      ┌──────┴──────┐
    │   tmux    │   │ Supabase  │      │  External   │
    │ sessions  │   │    DB     │      │  Webhooks   │
    │ (Claude)  │   │           │      │ (Slack,etc) │
    └───────────┘   └───────────┘      └─────────────┘
```

### Data Flow

**Agent Events (existing, from Vibecraft):**
```
Claude tool call → hook.sh → POST /event → WebSocket → Browser
                                         → events.jsonl (persist)
```

**Intel Events (new):**
```
Supabase change → Realtime subscription → Intel Router → WebSocket → Browser
Slack message   → Webhook receiver      → Intel Router → WebSocket → Browser
Analytics spike → Scheduled check       → Intel Router → WebSocket → Browser
```

**Commands (existing + extended):**
```
Browser command bar → POST /sessions/:id/prompt → tmux send-keys → Claude
Browser deploy unit → POST /sessions (with template) → tmux new-window → Claude boots with skills
Browser batch order → POST /commands/batch → Multiple tmux sends
```

---

## 4. Renderer Specification (PixiJS)

### Why PixiJS over Phaser / Canvas / Three.js

- **PixiJS**: Pure 2D renderer, no game framework overhead. We need rendering + interaction, not physics engines or tilemap systems. PixiJS gives us GPU-accelerated sprites, particle effects, and smooth scrolling at 60fps with hundreds of entities. It's what we'd use if building this from scratch.
- **Not Phaser**: Phaser includes collision detection, physics, tilemap loaders — all dead weight. We're visualizing data, not simulating physics.
- **Not Three.js**: We're replacing it specifically because 3D adds complexity without strategic value. Top-down 2D is the proven RTS viewport.
- **Not Canvas2D**: No GPU acceleration, particle effects would tank performance.

### Viewport

- **Camera**: Top-down orthographic, zoom 0.5x–4x, pan with drag or WASD
- **World size**: Fixed 4000x3000 logical pixels (territories laid out within)
- **Minimap**: 200x150px inset, bottom-left corner, shows full world
- **Grid**: Subtle hex grid overlay (carry from Vibecraft's aesthetic)

### Territory Rendering

Each business domain is a **territory zone** on the map:

```typescript
interface Territory {
  id: string              // 'lead-gen', 'sales', 'fulfillment', etc.
  name: string            // Display name
  bounds: PIXI.Rectangle  // World-space bounds
  color: number           // Territory tint (muted, like a strategy map)
  fogLevel: number        // 0 = fully visible, 1 = fully fogged
  threatLevel: number     // 0 = peaceful, 1 = under siege
  activeUnits: string[]   // Session IDs currently here
  objectives: Objective[] // Campaign goals for this territory
}
```

Territories have:
- **Terrain texture**: Muted topographic style (think Advance Wars or Into the Breach)
- **Borders**: Visible boundary lines between domains
- **Fog overlay**: Semi-transparent layer, opacity driven by data freshness
- **Threat indicators**: Red pulse when territory has unresolved issues
- **Building sprites**: Small icons for key infrastructure (Notion DB, Kit list, Supabase)

### Unit Rendering

Each Claude session is a **unit sprite**:

```typescript
interface UnitSprite {
  sessionId: string
  type: UnitType              // commander, lieutenant, scout, writer, etc.
  territory: string           // Which domain they're operating in
  status: 'idle' | 'working' | 'waiting' | 'offline'
  position: PIXI.Point        // World position within territory
  targetPosition?: PIXI.Point // Moving toward (animate)
  healthBar: number           // Context tokens remaining (0-1)
  currentTask?: string        // What they're doing right now
  selected: boolean           // Player has clicked this unit
}
```

Units have:
- **Distinct silhouettes per type**: Commander (crown), Lieutenant (shield), Scout (binoculars), etc.
- **Status ring**: Green=idle, cyan=working, amber=waiting, red=offline (from Vibecraft)
- **Health bar**: Shows context token usage (when low, unit needs rotation/restart)
- **Task label**: Small floating text showing current activity
- **Selection highlight**: Click to select, info panel shows details
- **Movement animation**: Smooth lerp when reassigned to different territory
- **Working particles**: Small particle burst when tools execute

### Physics Layer (Lightweight)

NOT a physics engine. Just particle effects for juice:

- **Task completion**: Small explosion of particles (color-coded by task type)
- **Revenue event**: Gold coins burst upward from the territory where the sale happened
- **Error/failure**: Red sparks
- **Deployment**: Smoke puff when new unit spawns
- **Connection line**: Animated dotted line from commander to active lieutenants (shows delegation)
- **Projectile**: When a unit "attacks" (publishes content, sends email), a small projectile animates from unit to rally point

### HUD Specification

```
┌──────────────────────────────────────────────────────────────────┐
│ [RESOURCE BAR]  Tokens: ████░░ 67%  |  Revenue: $12,450  |  ... │
├──────────────────────────────────────────────────┬───────────────┤
│                                                  │ [INTEL PANEL] │
│                                                  │               │
│              BATTLEFIELD                         │  3 new leads  │
│              (PixiJS canvas)                     │  1 support tkt│
│                                                  │  LI: +23% imp │
│                                                  │  Email: 42% OR│
│                                                  │               │
│                                                  │ [UNIT DETAIL] │
│                                                  │  (on select)  │
│                                                  │  Writer-01    │
│                                                  │  Status: Work │
│                                                  │  Task: LI post│
│                                                  │  Tokens: 45%  │
│                                                  │  [View Term]  │
│                                                  │  [Send Order] │
├───────────────────────┬──────────────────────────┴───────────────┤
│ [MINIMAP]             │ [COMMAND BAR]                             │
│  ┌────────┐           │ > Deploy writer to lead-gen: weekly batch │
│  │ . . .  │           │                                           │
│  │ . * .  │           │ [NOTIFICATIONS]                           │
│  │ . . .  │           │  ! Sales: Kelly call in 2h               │
│  └────────┘           │  ! Support: 2 tickets aging > 24h        │
└───────────────────────┴───────────────────────────────────────────┘
```

**Resource Bar (top):**
- Context tokens: aggregate across all active sessions
- Revenue: MTD from Stripe/Supabase
- Active units / population cap
- Time: current work block remaining
- Unread alerts count

**Intel Panel (right, tabbed):**
- **Intel tab**: Real-time business signals (analytics, leads, tickets)
- **Unit tab**: Selected unit details + controls (view terminal, send order, reassign)
- **Campaign tab**: Current objectives with progress bars
- **Activity tab**: Event feed (from Vibecraft, reskinned)

**Minimap (bottom-left):**
- Shows all territories
- Colored dots for units
- Red pulsing for territories needing attention
- Click to jump camera

**Command Bar (bottom):**
- Natural language input that routes to the right unit
- Autocomplete for unit names, skill names, territory names
- History with up arrow
- Keyboard shortcut: `/` to focus

**Notification Tray (bottom-right):**
- Priority-ranked alerts
- Click to jump to relevant territory/unit
- Auto-dismiss after acknowledged
- Sounds vary by severity (from Vibecraft's sound system, re-themed)

---

## 5. Intel System

The Intel System is what makes this a war room and not a dashboard. It's the **fog of war** implementation — active intelligence gathering that reveals the state of your business.

### Intel Sources

| Source | Data | Update Frequency | Integration |
|---|---|---|---|
| **Supabase** | Revenue, customers, pipeline | Real-time (Realtime subscriptions) | Direct |
| **Stripe** | Payments, MRR, churn | Webhooks | Via Supabase edge function |
| **LinkedIn (Shield)** | Impressions, engagement, follower growth | Hourly poll | Scheduled agent task |
| **Kit (ConvertKit)** | Subscribers, open rates, sequences | Hourly poll | API via agent |
| **Slack** | Team messages, customer messages | Real-time (Socket Mode) | Existing agent-runner |
| **Email** | Support requests, partnership inquiries | Poll or webhook | Gmail MCP |
| **Fathom** | Meeting transcripts, action items | Post-meeting webhook | Supabase storage |
| **Google Calendar** | Upcoming calls, blocked time | 15-min poll | Google Calendar MCP |
| **GitHub** | PRs, issues, deploys | Webhooks | gh CLI |

### Fog of War

Each territory has a **fog level** (0.0–1.0) driven by data freshness:

```typescript
function calculateFog(territory: Territory): number {
  const sources = getIntelSourcesFor(territory)
  const staleness = sources.map(s => {
    const age = Date.now() - s.lastUpdated
    const maxAge = s.expectedUpdateInterval * 3 // 3x expected = fully fogged
    return Math.min(age / maxAge, 1.0)
  })
  return average(staleness)
}
```

- **0.0 fog**: Fresh data, full visibility. Territory is bright, details visible.
- **0.5 fog**: Semi-stale. Territory dimmed, details faded.
- **1.0 fog**: No recent data. Territory dark, only outline visible. Red alert border.

Deploying a **Scout** unit to a territory clears fog by actively checking all intel sources.

### Threat System

"Enemies" are real business events that require response:

| Threat | Source | Severity | Auto-Response |
|---|---|---|---|
| Support ticket > 24h old | Supabase | HIGH | Spawn Medic unit |
| Subscriber churn spike | Stripe webhook | CRITICAL | Alert + deploy Diplomat |
| Negative content mention | Social monitoring | MEDIUM | Intel panel alert |
| Competitor launch | Web scraping agent | LOW | Intel panel note |
| Missed follow-up | CRM aging | HIGH | Alert + link to contact |
| Low engagement post | Analytics check | LOW | Intel panel note |
| Payment failed | Stripe webhook | CRITICAL | Auto-email + alert |

Threats appear as **enemy unit sprites** on the relevant territory. They persist until resolved (ticket closed, churn addressed, etc.). Unresolved threats increase territory fog and threat level.

---

## 6. Campaign Mode

Campaigns are persistent, multi-day objectives that give structure to the war. They're the "missions" of the RTS.

### Campaign Structure

```typescript
interface Campaign {
  id: string
  name: string                // "Scale to $50K MRR"
  status: 'active' | 'won' | 'lost' | 'paused'
  startDate: string
  targetDate: string
  objectives: Objective[]
  fronts: Front[]
}

interface Objective {
  id: string
  name: string                // "500 new leads"
  metric: string              // Supabase query or computed value
  target: number
  current: number
  territory: string           // Which domain this belongs to
  weight: number              // Importance (for overall campaign score)
}

interface Front {
  territory: string
  assignedUnits: string[]     // Session IDs
  strategy: string            // User-written battle plan
  status: 'advancing' | 'holding' | 'retreating' | 'idle'
}
```

### Score

The campaign score is computed from weighted objective completion:

```
Score = Σ (objective.current / objective.target × objective.weight) / Σ weights
```

Displayed as a prominent number in the resource bar. When it hits 1.0, the campaign is won. Fireworks. New campaign starts.

### Example Campaign

```yaml
campaign: "Q1 2026 — Scale CCB to 100 students"
objectives:
  - name: "New leads"
    metric: "kit_subscribers.count WHERE tag='ccb-waitlist' AND created > campaign_start"
    target: 500
    territory: lead-gen
    weight: 3
  - name: "Sales calls booked"
    metric: "calendar_events.count WHERE title LIKE '%bootcamp%'"
    target: 30
    territory: sales
    weight: 2
  - name: "Students enrolled"
    metric: "stripe_subscriptions.count WHERE product='ccb'"
    target: 100
    territory: sales
    weight: 5
  - name: "Session NPS > 4.5"
    metric: "feedback.avg(score) WHERE product='ccb'"
    target: 4.5
    territory: fulfillment
    weight: 4
  - name: "Content pieces published"
    metric: "content_log.count WHERE status='published'"
    target: 60
    territory: lead-gen
    weight: 2
  - name: "Support response < 4h"
    metric: "tickets.avg(first_response_minutes) < 240"
    target: 240
    territory: support
    weight: 3
```

---

## 7. Command System

The command system translates natural language orders into agent actions.

### Command Bar

The bottom command bar accepts:
- **Direct orders**: "Writer-01, create a LinkedIn post about skill stacking"
- **Deploy orders**: "Deploy scout to sales front" (spawns new Claude session with scout template)
- **Batch orders**: "All content units, execute weekly batch"
- **Intel requests**: "What's the current churn rate?"
- **Campaign updates**: "Mark 'new leads' objective at 350"

### Command Routing

```
User types command
  → Parse intent (unit target, action, parameters)
  → If targeting specific unit:
      → POST /sessions/:id/prompt with the action
  → If deploying new unit:
      → POST /sessions with template + initial prompt
  → If batch order:
      → POST /commands/batch (sequential or parallel)
  → If intel request:
      → Query Supabase directly, display in Intel panel
  → If campaign update:
      → Update Supabase campaign table, refresh HUD
```

### Keyboard Shortcuts

Building on Vibecraft's existing shortcut system:

| Key | Action |
|---|---|
| `/` | Focus command bar |
| `1-9` | Select unit by number |
| `Ctrl+1-9` | Select control group |
| `Ctrl+Shift+1-9` | Assign selected units to control group |
| `Tab` | Cycle through territories |
| `Space` | Jump to last alert |
| `F1-F5` | Switch HUD tabs (Intel, Unit, Campaign, Activity, Settings) |
| `M` | Toggle minimap expand |
| `G` | Toggle grid overlay |
| `Esc` | Deselect / close panel |
| `Enter` | Focus command bar (same as /) |
| `Alt+N` | Deploy new unit (spawn session) |
| `Alt+K` | Kill selected unit (end session) |
| `Ctrl+C` | Cancel current order (send Ctrl+C to unit's tmux) |

---

## 8. Sound Design

Reskin Vibecraft's Tone.js sound system with a military/strategic theme:

### Sound Palette

| Event | Sound | Vibecraft Equivalent |
|---|---|---|
| Unit deployed | Marching boots + horn | spawn |
| Unit completed task | Victory stinger | success |
| Unit failed | Low drum hit | error |
| Unit idle too long | Subtle radar ping | notification |
| New intel received | Radio crackle + beep | notification |
| Threat appeared | War drum (low, ominous) | NEW |
| Threat resolved | Relief chord | NEW |
| Revenue event | Cash register + coin cascade | git_commit |
| Campaign objective met | Trumpet fanfare | NEW |
| Campaign won | Full orchestral victory | NEW |
| Command issued | Crisp acknowledgment tone | prompt |
| Unit moving | Brief march snippet | walking |
| Fog clearing | Atmospheric reveal | NEW |

### Spatial Audio (Keep from Vibecraft)

Sounds are spatialized based on territory position relative to camera. Events in distant territories are quieter. Selected territory gets volume boost.

---

## 9. Data Model (Supabase)

### New Tables

```sql
-- Active campaigns
CREATE TABLE ae_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  start_date TIMESTAMPTZ DEFAULT now(),
  target_date TIMESTAMPTZ,
  config JSONB,  -- objectives, fronts, weights
  score REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign objective snapshots (for tracking over time)
CREATE TABLE ae_objective_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES ae_campaigns(id),
  objective_name TEXT NOT NULL,
  value REAL NOT NULL,
  target REAL NOT NULL,
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

-- Intel events (business signals)
CREATE TABLE ae_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,       -- 'stripe', 'slack', 'analytics', etc.
  territory TEXT NOT NULL,    -- 'lead-gen', 'sales', etc.
  severity TEXT DEFAULT 'low', -- 'low', 'medium', 'high', 'critical'
  title TEXT NOT NULL,
  body JSONB,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Unit deployment history
CREATE TABLE ae_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  territory TEXT NOT NULL,
  task TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  tokens_used INTEGER,
  outcome TEXT  -- 'completed', 'failed', 'cancelled', 'rotated'
);

-- Session templates (unit types)
CREATE TABLE ae_unit_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL UNIQUE,  -- 'commander', 'lieutenant', 'scout', etc.
  name TEXT NOT NULL,
  description TEXT,
  initial_prompt TEXT,        -- What to send to Claude on spawn
  skills TEXT[],              -- Skills to pre-reference
  icon TEXT,                  -- Sprite identifier
  flags JSONB                 -- tmux/Claude flags
);
```

### Realtime Subscriptions

The server subscribes to these Supabase tables for live updates:

```typescript
// In server/IntelRouter.ts
supabase
  .channel('intel')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ae_intel' }, (payload) => {
    broadcastToClients({ type: 'intel', payload: payload.new })
  })
  .subscribe()
```

---

## 10. Build Plan

### Phase 0: Foundation (Days 1-2) — THIS WINDOW

What the current prime agent session handles:

- [x] Fork Vibecraft → agent-empires
- [ ] Rename package, update CLAUDE.md, strip README
- [ ] Replace Three.js with PixiJS (swap renderer, keep everything else)
- [ ] Basic territory map with 6 zones (lead-gen, sales, fulfillment, support, retention, HQ)
- [ ] Unit sprites that position in territories based on session data
- [ ] Basic HUD scaffold (resource bar, intel panel, minimap, command bar)
- [ ] Wire existing session management to new renderer
- [ ] Keep all tmux/hook/WebSocket plumbing untouched

### Phase 1: Command & Control (Days 3-5)

- [ ] Command bar with natural language routing
- [ ] Unit selection + detail panel
- [ ] Control groups (Ctrl+1-9 to assign, 1-9 to recall)
- [ ] Session templates (unit types with pre-loaded skills)
- [ ] Deploy flow: click territory → spawn unit with template
- [ ] Military-themed sound palette
- [ ] Unit movement animations between territories

**Sub-PRDs that spin off:**
- `prd/cmd-bar-spec.md` — Command parsing, intent routing, autocomplete
- `prd/unit-templates-spec.md` — Each unit type's skills, prompts, behaviors

### Phase 2: Intelligence (Days 6-8)

- [ ] Intel Router (server-side, receives signals from multiple sources)
- [ ] Supabase realtime subscriptions for business data
- [ ] Fog of war rendering (per-territory, driven by data freshness)
- [ ] Threat sprites (enemy units for support tickets, churn, etc.)
- [ ] Intel panel UI with sortable/filterable feed
- [ ] Notification system with priority ranking

**Sub-PRDs that spin off:**
- `prd/intel-sources-spec.md` — Each data source integration (Stripe, Shield, Kit, etc.)
- `prd/fog-of-war-spec.md` — Fog calculation, reveal mechanics, visual rendering

### Phase 3: Campaign Mode (Days 9-12)

- [ ] Campaign data model in Supabase
- [ ] Campaign creation UI (define objectives, assign territories)
- [ ] Objective tracking with real metric queries
- [ ] Score computation and display
- [ ] Campaign timeline view (progress over days/weeks)
- [ ] Victory/defeat conditions and celebrations

**Sub-PRDs that spin off:**
- `prd/campaign-engine-spec.md` — Objective types, metric queries, scoring algorithm
- `prd/celebrations-spec.md` — Victory animations, milestone effects

### Phase 4: Physics & Polish (Days 13-15)

- [ ] Particle effects (task completion, revenue, errors)
- [ ] Projectile animations (unit → rally point)
- [ ] Connection lines (commander → lieutenants)
- [ ] Territory ambient animations (activity shimmer)
- [ ] Performance optimization (culling, pooling)
- [ ] Mobile/tablet responsive layout

**Sub-PRDs that spin off:**
- `prd/particle-system-spec.md` — Effect types, triggers, performance budget
- `prd/animation-spec.md` — All movement/transition animations

### Phase 5: Integration (Days 16-20)

- [ ] Wire to speakeasy-agent's existing Supabase instance
- [ ] Connect agent-runner scheduled tasks as autonomous patrol units
- [ ] Slack integration (incoming signals → intel feed)
- [ ] Google Calendar integration (upcoming events → HUD)
- [ ] Revenue dashboard with Stripe data
- [ ] Export campaign reports

**Sub-PRDs that spin off:**
- `prd/integrations/stripe-spec.md`
- `prd/integrations/slack-spec.md`
- `prd/integrations/calendar-spec.md`
- `prd/integrations/analytics-spec.md`

---

## 11. Non-Goals (v0.1)

- **VR/AR support** — Cool but not now
- **Multiplayer** — This is a single-player command experience
- **Mobile-first** — Desktop browser is the primary target
- **Full physics engine** — We want juice, not simulation
- **Voice commands** — Vibecraft has voice input; we'll keep it but not prioritize
- **AI opponents** — The "enemies" are real business events, not simulated AI

---

## 12. Success Metrics

| Metric | Target | How We Measure |
|---|---|---|
| Daily usage | >2h/day | Session duration tracking |
| Agents deployed/day | >5 | ae_deployments count |
| Time to first command | <30 seconds | From page load to first prompt sent |
| Revenue attribution | Track $ influenced | Campaign objective correlation |
| Context efficiency | >80% token utilization | Token tracking per session |
| Threat response time | <1h for HIGH severity | ae_intel timestamps |
| Campaign completion rate | >70% objectives met | ae_objective_snapshots |

---

## 13. Open Questions

1. **Session limits**: How many concurrent Claude sessions can one subscription support? Need to test. This determines "population cap."
2. **Token visibility**: Can we get real-time token counts from Claude Code programmatically, or only from the hook events?
3. **Stripe integration**: Direct webhook to Supabase edge function, or through agent-runner?
4. **Sound licensing**: Vibecraft uses Tone.js synthesis (no files). We should keep this approach for the military sounds.
5. **Cross-project units**: Can one Agent Empires instance manage Claude sessions across multiple repos/directories? (Vibecraft supports this via `cwd` per session — should work.)

---

## Appendix: Vibecraft Components Retained

For reference, these Vibecraft components are kept as-is or with minimal modification:

| File | Modification |
|---|---|
| `hooks/vibecraft-hook.sh` | Rename paths to `~/.agent-empires/` |
| `server/index.ts` | Keep session/event management, add Intel Router |
| `server/ProjectsManager.ts` | Keep as-is |
| `server/GitStatusManager.ts` | Keep as-is |
| `shared/types.ts` | Extend with new types (Territory, Campaign, Intel, UnitTemplate) |
| `shared/defaults.ts` | Update paths and ports |
| `src/api/SessionAPI.ts` | Keep, add campaign/intel API methods |
| `src/events/EventBus.ts` | Keep as-is |
| `src/events/handlers/` | Keep sound/notification handlers, add intel/campaign handlers |
| `src/audio/SoundManager.ts` | Keep architecture, add new sound definitions |
| `src/audio/SpatialAudioContext.ts` | Keep as-is |
| `bin/cli.js` | Rename to agent-empires |
| `docs/` | Rewrite for Agent Empires |
