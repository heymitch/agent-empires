# Agent Empires — SCOUT to INTELLIGENCE AGENCY Pipeline

## Sub-PRD 02a — Reconnaissance & Intelligence System

> ### Status Summary (2026-03-10)
>
> **Assessment:** Server-side intel bridge is shipped. The full scout deployment UI, Intel HQ sub-agent pipeline, and file-watcher flow are unimplemented — this is still a design spec.
>
> - [x] **ThreatDataBridge (server-side intel routing)** — `server/ThreatDataBridge.ts`
> - [x] **IntelPanel (HUD display)** — `src/hud/IntelPanel.ts`
> - [ ] **Scout deployment UI (Deploy Modal)** — not found in `src/ui/`
> - [ ] **tmux-based scout sessions** — tmux infra exists in `server/index.ts` but no scout-specific templates
> - [ ] **Raw intel file format / disk writes** — no `~/.agent-empires/data/intel/` handling found
> - [ ] **File watcher (chokidar) on raw intel** — not implemented
> - [ ] **Intel HQ sub-agent (analysis/correlation)** — not implemented
> - [ ] **Intel products as map objects** — not implemented
> - [ ] **Counter-intelligence system** — not implemented
> - [ ] **Scout fuel / mission types** — not implemented

**Parent:** `prd/01-vision.md` (Phase 2: Intelligence)
**Status:** Design spec
**Last updated:** 2026-03-10

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Scout Deployment Mechanics](#2-scout-deployment-mechanics)
3. [Raw Intel Format](#3-raw-intel-format)
4. [Intelligence HQ (Sub-Agent Architecture)](#4-intelligence-hq-sub-agent-architecture)
5. [Intelligence Products (Map Objects)](#5-intelligence-products-map-objects)
6. [Counter-Intelligence](#6-counter-intelligence)
7. [End-to-End Example](#7-end-to-end-example)
8. [State Machines](#8-state-machines)
9. [Implementation Notes](#9-implementation-notes)

---

## 1. System Overview

The intelligence pipeline is the nervous system of the war room. Without it, the general is blind — making decisions based on memory and gut feel instead of real-time battlefield awareness. With it, threats materialize as enemy sprites before they reach your walls, opportunity nodes glow on the map waiting to be harvested, and the fog rolls back revealing terrain you can plan around.

### Data Flow

```
USER deploys Scout via UI
    |
    v
tmux window spawns Claude Code session
    |  (with scout template: skills, CLAUDE.md, initial prompt)
    |
    v
Scout executes research tasks
    |  (WebSearch, WebFetch, Bash API calls, Supabase queries, Slack reads)
    |
    v
Scout writes RAW INTEL to disk
    |  (~/.agent-empires/data/intel/raw/{mission-id}/{finding-id}.json)
    |
    v
File watcher detects new findings
    |  (chokidar on ~/.agent-empires/data/intel/raw/)
    |
    v
INTELLIGENCE HQ sub-agent wakes
    |  (persistent Claude session, window in tmux)
    |
    v
HQ classifies, deduplicates, correlates
    |
    v
HQ writes PROCESSED INTEL to disk
    |  (~/.agent-empires/data/intel/processed/{intel-id}.json)
    |
    v
Server reads processed intel, broadcasts via WebSocket
    |
    v
Renderer creates map objects: enemies, resources, terrain reveals, intel reports
```

### Why File-Based, Not In-Memory?

Scouts are separate Claude Code sessions. They can't share memory with the server or HQ. Files on disk are the universal IPC mechanism that works with tmux-based sessions. The scout writes JSON, the HQ reads JSON. Both are Claude Code sessions that understand file I/O natively. No custom protocols, no message queues — just the filesystem.

---

## 2. Scout Deployment Mechanics

### 2.1 How the User Deploys a Scout

**Method 1: Territory Context Menu (primary)**

1. User right-clicks a territory on the map (e.g., "Lead-Gen Front")
2. Context menu appears with options: `Deploy Scout`, `Deploy Writer`, `Deploy Operative`...
3. User clicks `Deploy Scout`
4. Mission selection modal appears:

```
┌─────────────────────────────────────────────┐
│  DEPLOY SCOUT — Lead-Gen Front              │
│                                             │
│  Mission Type:                              │
│  ○ Patrol       (sweep all sources, 10min)  │
│  ○ Deep Recon   (thorough analysis, 30min)  │
│  ○ Targeted     (specific question)         │
│                                             │
│  [Targeted prompt if selected:]             │
│  ┌─────────────────────────────────────┐    │
│  │ What content is performing best     │    │
│  │ for solo AI consultants on LI?      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Priority Sources:                          │
│  [x] LinkedIn Analytics                     │
│  [x] Kit Subscriber Data                    │
│  [x] Competitor Content                     │
│  [ ] Slack Channels                         │
│  [ ] Web Search (broad)                     │
│                                             │
│  Estimated fuel: ██████░░░░ 60% context     │
│                                             │
│  [ DEPLOY ]              [ Cancel ]         │
└─────────────────────────────────────────────┘
```

5. User clicks `DEPLOY`
6. Server spawns tmux window with scout template
7. Scout sprite appears on map at HQ, then animates toward target territory
8. Fog begins lifting as findings come in

**Method 2: Command Bar**

```
> deploy scout to lead-gen, patrol
> scout sales: who are the top 3 competitors launching AI consulting courses?
> deep recon fulfillment: student sentiment analysis
```

Command bar parses intent and either opens the modal pre-filled or deploys directly if all parameters are specified.

**Method 3: Keyboard Shortcut**

`Alt+S` opens scout deployment with the currently selected territory pre-filled.

### 2.2 Mission Types

#### PATROL (Standard Sweep)

- **Duration:** 5-15 minutes (depending on source count)
- **Depth:** Surface-level — checks each source once, reports anomalies
- **Context cost:** ~30% of session window
- **Behavior:** Scout visits each intel source for the territory, grabs headline metrics, flags anything outside normal range
- **When to use:** Daily check-in, keeping fog low, routine monitoring
- **Map animation:** Scout sprite moves in a circuit around the territory perimeter, pausing at each "source node" (small icons on the map representing LinkedIn, Kit, Stripe, etc.)

```typescript
interface PatrolMission {
  type: 'patrol'
  territory: string
  sources: IntelSource[]       // Which sources to check
  thresholds: ThresholdConfig  // What counts as anomalous
  maxDuration: number          // Minutes before auto-recall
}
```

**Scout prompt template (injected on deploy):**

```
You are a SCOUT unit deployed on a PATROL mission to the {territory} front.

Your job: Check each intel source, grab the current state, and report anything
unusual. You are NOT writing analysis. You are gathering raw signals.

For each source, write a finding to:
  ~/.agent-empires/data/intel/raw/{mission-id}/

Use the finding schema (see SKILL.md). One JSON file per finding.

Sources to check: {sources}
Normal ranges: {thresholds}

Time budget: {maxDuration} minutes. Work fast. Report what you find, not what
you think about what you find. That's HQ's job.

When done, write a mission-complete marker:
  ~/.agent-empires/data/intel/raw/{mission-id}/_complete.json
```

#### DEEP RECON (Thorough Investigation)

- **Duration:** 20-45 minutes
- **Depth:** Multi-source correlation, trend analysis, historical comparison
- **Context cost:** ~70% of session window
- **Behavior:** Scout pulls data from every available source, cross-references, identifies patterns, produces a detailed situation report
- **When to use:** Weekly strategic review, pre-campaign planning, post-incident analysis
- **Map animation:** Scout sprite moves slowly across the territory interior, leaving a "scan line" trail that reveals detail textures in the terrain

```typescript
interface DeepReconMission {
  type: 'deep_recon'
  territory: string
  sources: IntelSource[]
  lookbackDays: number          // How far back to analyze
  focusAreas?: string[]         // Optional emphasis
  compareBaseline?: string      // Campaign period to compare against
}
```

#### TARGETED INVESTIGATION

- **Duration:** 10-30 minutes (varies by question complexity)
- **Depth:** Narrow but deep — answers a specific question
- **Context cost:** ~40-60% of session window
- **Behavior:** Scout uses all available tools to answer the user's specific question, choosing sources and methods autonomously
- **When to use:** "I heard Competitor X launched something — what is it?" or "Why did our open rate drop last week?"
- **Map animation:** Scout sprite moves directly to a specific point in the territory, "digs in" with a pulsing radar animation, then returns

```typescript
interface TargetedMission {
  type: 'targeted'
  territory: string
  question: string              // The user's specific question
  sources?: IntelSource[]       // Optional — scout picks if not specified
  maxDuration: number
}
```

### 2.3 Scout Skills & Tools

A scout Claude session boots with these capabilities:

```typescript
const SCOUT_TEMPLATE = {
  type: 'scout',
  icon: 'binoculars',
  skills: [
    'web-research',        // WebSearch + WebFetch for competitor/market intel
    'analytics-check',     // Bash scripts calling LinkedIn/Kit/Stripe APIs
    'slack-scanner',       // Read Slack channels for signals
    'supabase-query',      // Direct DB queries for internal metrics
    'sentiment-scan',      // Analyze text tone in reviews/comments/tickets
  ],
  claudeFlags: [],         // No special flags needed
  initialCwd: '~/.agent-empires/data/intel/',
  claudeMd: SCOUT_CLAUDE_MD,  // Injected CLAUDE.md with scout protocols
}
```

**Tools the scout actually uses (Claude Code built-ins + MCP):**

| Tool | Scout Use Case |
|---|---|
| `WebSearch` | Competitor monitoring, market trends, news |
| `WebFetch` | Scrape specific pages (pricing pages, blog posts, social profiles) |
| `Bash` | Run API scripts (`curl` to LinkedIn API, Kit API, Stripe API) |
| `Read` | Read previous intel files for comparison |
| `Write` | Write raw finding JSON files to disk |
| `Grep` | Search through existing intel for deduplication |
| `mcp__claude_ai_Slack__*` | Scan Slack channels for business signals |
| `mcp__claude_ai_Supabase__*` | Query internal databases |

### 2.4 Map-to-Research Correspondence

Every scout action in the real world has a visual representation on the map:

| Real Action | Map Representation |
|---|---|
| Scout session spawns | Unit sprite appears at HQ with deployment smoke |
| Scout begins moving to territory | Sprite animates along path from HQ to territory |
| Scout checks LinkedIn API | Sprite moves to LinkedIn source node (small LI icon on territory), brief "scanning" animation plays |
| Scout checks Kit API | Sprite moves to Kit source node |
| Scout runs WebSearch | Sprite moves to edge of territory (looking outward), radar ping animation |
| Scout writes a finding | Small "ping" dot appears at scout's location, pulses once, color = severity |
| Finding is positive (opportunity) | Green ping |
| Finding is negative (threat) | Red ping |
| Finding is neutral (terrain/info) | Blue ping |
| Scout completes mission | Sprite animates back to HQ, mission report appears in Intel panel |
| Scout runs out of context | Sprite "sputters" (flashing health bar), auto-recalls to HQ |

### 2.5 Scouting Visuals

**Fog Lifting:**

When a scout begins working in a territory, the fog overlay doesn't just snap off. It lifts in waves radiating outward from the scout's position — like sonar returns. Each finding the scout writes triggers a fog-reduction pulse centered on the relevant source node.

```typescript
interface FogRevealEvent {
  territory: string
  epicenter: { x: number, y: number }  // Source node position
  radius: number                        // How much fog to clear
  intensity: number                     // 0-1, how much fog reduction
  source: string                        // Which intel source
  timestamp: number
}
```

The fog has three visual layers:
1. **Dense fog** (opacity 0.8): No data at all. Black/dark overlay. Only territory outline visible.
2. **Light fog** (opacity 0.3): Stale data (>24h). Terrain visible but muted, details faded.
3. **Clear** (opacity 0.0): Fresh data (<1h for real-time sources, <24h for daily sources). Full color, all details visible.

**Ping Returns:**

When a scout finds something, a visual "ping" plays on the map:

```
    ╭─ ─ ─╮          Expanding ring animation
   ╱       ╲         Color-coded by finding type:
  │    ●    │         - Red: threat
   ╲       ╱         - Green: opportunity
    ╰─ ─ ─╯         - Blue: terrain/info
                      - Yellow: requires attention
Ring expands outward from finding location
over 1.5 seconds, then fades.
Inner dot persists as a map marker.
```

**Scout Trail:**

As a scout moves between source nodes during a patrol, it leaves a faint dotted trail (like breadcrumbs) that fades after 30 seconds. This gives the user a sense of coverage — "the scout checked LinkedIn, then Kit, then moved to the border for web search."

### 2.6 Scout Limitations

**Context as Fuel:**

A scout's context window is its "fuel tank." Every tool call burns tokens. The scout's health bar on the map represents remaining context capacity.

```typescript
interface ScoutFuelState {
  totalBudget: number         // Estimated max tokens for session (~200k for Opus)
  consumed: number            // Running count from hook events
  burnRate: number            // Tokens per minute (rolling average)
  estimatedRange: number      // Minutes remaining at current burn rate
  warningThreshold: 0.25      // Flash health bar at 25% remaining
  criticalThreshold: 0.10     // Auto-recall at 10% remaining
}
```

When fuel hits `warningThreshold`:
- Health bar turns amber and flashes
- Notification: "Scout-04 running low on fuel — consider recall"

When fuel hits `criticalThreshold`:
- Scout receives interrupt: "FUEL CRITICAL. Write remaining findings and return to HQ."
- Health bar turns red
- Auto-recall countdown starts (2 minutes)

**Range (Territory Limit):**

A scout can only operate in ONE territory per deployment. Scouting the sales front doesn't reveal anything about the lead-gen front. This forces the user to make strategic choices about where to send limited scouting resources.

Exception: Deep Recon missions can optionally check "adjacent" territories for cross-domain signals (e.g., a lead-gen scout noticing that fulfillment is producing content that creates leads). This costs extra fuel.

**Duration:**

Each mission type has a `maxDuration`. When the timer expires:
1. Scout receives a "WRAP UP" prompt
2. Scout has 2 minutes to write final findings and the `_complete.json` marker
3. If not complete in 2 minutes, session is force-killed and partial findings are processed

**Concurrency:**

Maximum of 3 active scouts at any time (subscription context budget). The UI grays out the Deploy Scout button when 3 are active.

---

## 3. Raw Intel Format

### 3.1 File Structure

```
~/.agent-empires/data/intel/
├── raw/                           # Scout outputs (hot)
│   ├── mission-2026-03-10-001/    # One directory per mission
│   │   ├── _mission.json          # Mission metadata
│   │   ├── finding-001.json       # Individual findings
│   │   ├── finding-002.json
│   │   ├── finding-003.json
│   │   └── _complete.json         # Written when scout finishes
│   └── mission-2026-03-10-002/
│       ├── _mission.json
│       └── ...
├── processed/                     # HQ outputs (warm)
│   ├── intel-a1b2c3.json          # Processed intel objects
│   └── ...
├── archive/                       # Expired/resolved intel (cold)
│   └── ...
└── threat-board.json              # Running intelligence picture
```

### 3.2 Mission Metadata (`_mission.json`)

```json
{
  "missionId": "mission-2026-03-10-001",
  "type": "patrol",
  "territory": "lead-gen",
  "deployedAt": "2026-03-10T09:15:00Z",
  "scoutSessionId": "session-abc123",
  "sources": ["linkedin-analytics", "kit-subscribers", "web-search"],
  "status": "in_progress",
  "question": null,
  "findingCount": 0,
  "fuelConsumed": 0,
  "fuelBudget": 200000
}
```

### 3.3 Finding Schema

Each finding is one JSON file. One signal per file. Never batch multiple signals into one finding.

```typescript
interface RawFinding {
  // === Identity ===
  findingId: string              // "finding-001"
  missionId: string              // Parent mission
  timestamp: string              // ISO 8601

  // === Source ===
  source: IntelSource            // Where this came from
  sourceUrl?: string             // If web-based, the URL
  sourceQuery?: string           // If search-based, the query used

  // === Content ===
  title: string                  // One-line summary (< 100 chars)
  body: string                   // Full finding text (< 2000 chars)
  rawData?: Record<string, any>  // Structured data if available (API response snippets)

  // === Classification (Scout's best guess — HQ will refine) ===
  signalType: 'threat' | 'opportunity' | 'terrain' | 'noise'
  confidence: ConfidenceLevel
  severity: 'critical' | 'high' | 'medium' | 'low'
  territory: string              // Which business domain this affects

  // === Context ===
  relatedFindings?: string[]     // Other finding IDs that relate
  tags: string[]                 // Free-form tags for HQ to use
  expiresAt?: string             // When this intel goes stale (ISO 8601)

  // === Scout's Notes ===
  scoutNotes?: string            // Any context the scout wants HQ to know
}
```

### 3.4 Confidence Levels

Confidence is NOT a percentage. It's a discrete level with clear definitions the scout can apply without overthinking:

```typescript
type ConfidenceLevel = 'confirmed' | 'probable' | 'possible' | 'speculative'
```

| Level | Definition | Scout's Test | Map Visual |
|---|---|---|---|
| `confirmed` | Verified by primary source. Data is authoritative. | "I pulled this from an official API or dashboard." | Solid icon, bright color |
| `probable` | Strong evidence from reliable source. Likely accurate. | "Multiple credible sources agree, or one very reliable source says this." | Solid icon, slightly muted |
| `possible` | Some evidence, but incomplete or from mixed sources. | "I found this in one place, or the data is ambiguous." | Dashed border, muted color |
| `speculative` | Inferred, pattern-matched, or from unreliable source. | "This is my interpretation, or the source is questionable." | Dotted border, very muted, pulsing "?" |

### 3.5 Intel Source Enum

```typescript
type IntelSource =
  // First-party (our own data)
  | 'supabase-metrics'          // Revenue, users, pipeline
  | 'stripe-payments'           // MRR, churn, failed payments
  | 'kit-subscribers'           // Email list, open rates, sequences
  | 'linkedin-analytics'        // Impressions, engagement, followers
  | 'google-analytics'          // Traffic, conversions
  | 'slack-channels'            // Team and customer messages
  | 'gmail-inbox'               // Support requests, partnerships
  | 'google-calendar'           // Upcoming events, availability
  | 'github-activity'           // PRs, deploys, issues

  // Third-party (external data)
  | 'web-search'                // Google/Bing search results
  | 'web-scrape'                // Specific page content
  | 'social-monitoring'         // Mentions, competitor posts
  | 'market-research'           // Industry reports, trends
  | 'competitor-intel'          // Competitor pricing, launches, content
```

### 3.6 Mission Complete Marker (`_complete.json`)

```json
{
  "missionId": "mission-2026-03-10-001",
  "completedAt": "2026-03-10T09:28:00Z",
  "status": "completed",
  "findingCount": 7,
  "fuelConsumed": 45000,
  "summary": "Patrol complete. 7 findings: 2 opportunities (Kit open rate spike, new competitor weakness), 1 threat (LinkedIn engagement declining week-over-week), 4 terrain (baseline metrics recorded).",
  "scoutRecommendation": "Recommend deep recon on LinkedIn engagement decline. Pattern started 2 weeks ago."
}
```

---

## 4. Intelligence HQ (Sub-Agent Architecture)

### 4.1 What is Intel HQ?

Intel HQ is a **persistent Claude Code session** that runs for the entire Agent Empires session. It's not a scout — it never goes into the field. It sits in the HQ territory on the map, processing raw findings into actionable intelligence.

Think of it as the analyst back at base: scouts radio in raw observations, and the analyst converts them into the strategic picture the general needs.

```
tmux session: "agent-empires"
  Window 0: [BROWSER]
  Window 1: [COMMANDER]
  Window 2: [INTEL-HQ]     <-- This one. Always running.
  Window 3: [SCOUT-01]     <-- Comes and goes per mission
  Window 4: [SCOUT-02]
  ...
```

### 4.2 HQ Boot Sequence

When Agent Empires starts:

1. Server spawns the Intel HQ tmux window
2. Claude Code session starts with `INTEL_HQ_CLAUDE.md`:

```markdown
# INTEL HQ — Standing Orders

You are the Intelligence HQ for Agent Empires. You run continuously. Your job:

1. WATCH for new raw findings in ~/.agent-empires/data/intel/raw/
2. PROCESS each finding through the classification pipeline
3. WRITE processed intel to ~/.agent-empires/data/intel/processed/
4. MAINTAIN the threat board at ~/.agent-empires/data/intel/threat-board.json
5. NEVER fabricate threats. If confidence is low, say so. Hallucinated threats
   waste the general's attention, which is the most expensive resource we have.

## Processing Pipeline

For each new finding:
1. READ the finding JSON
2. DEDUPLICATE — check if this is already known (search processed/ and threat-board)
3. CLASSIFY — is this an enemy, resource, or terrain reveal?
4. CORRELATE — does this connect to other recent findings?
5. PRIORITIZE — assign attention_priority (1-10)
6. WRITE processed intel JSON to processed/
7. UPDATE threat-board.json if threat picture changed

## Classification Rules

### ENEMY (threat that requires response)
- Revenue at risk (churn signal, failed payment, pricing undercut)
- Reputation at risk (negative mention, bad review, support failure)
- Competitive displacement (competitor launching in our space)
- Operational failure (system down, delivery delayed, quality drop)
MUST have confidence >= 'probable' to classify as enemy. 'possible' or
'speculative' threats go in as TERRAIN with a threat_flag.

### RESOURCE (opportunity to capture)
- New lead or customer signal
- Content performing above baseline
- Market gap identified
- Partnership opportunity
- Underpriced asset (talent, tool, attention)

### TERRAIN (knowledge that shapes decisions)
- Baseline metrics (not anomalous, just recorded)
- Market conditions (trends, seasonality)
- Competitor positions (not threatening, just informational)
- Internal state (team capacity, backlog size)

## Anti-Hallucination Protocol

BEFORE classifying anything as an enemy (threat), ask:
1. Is this from a primary source or is it inferred?
2. Could this be normal variance?
3. Have I seen corroborating signals?
4. What's the base rate for this type of event?

If you can't answer at least 2 of these affirmatively, downgrade to TERRAIN
with a threat_flag for the general to review manually.
```

3. HQ enters a watch loop (polling `raw/` every 15 seconds for new files)

### 4.3 How HQ Receives Findings

**Primary: File watching via polling loop**

The HQ session runs a continuous loop:

```bash
# HQ's main loop (simplified)
while true; do
  # Find unprocessed mission directories
  for dir in ~/.agent-empires/data/intel/raw/mission-*/; do
    for finding in "$dir"/finding-*.json; do
      if [ ! -f "$finding.processed" ]; then
        # Process this finding
        # (Claude reads, classifies, writes to processed/)
        touch "$finding.processed"  # Mark as handled
      fi
    done
  done
  sleep 15
done
```

In practice, the HQ Claude session manages this loop itself — it's prompted to check for new findings periodically.

**Secondary: Server nudge**

The server's file watcher (chokidar) detects new raw findings and can send a prompt to the HQ tmux window: "New finding arrived: {path}. Process it." This reduces latency from 15s polling to near-instant.

```typescript
// In server/IntelRouter.ts
chokidar.watch(INTEL_RAW_DIR, { depth: 2 }).on('add', (filePath) => {
  if (filePath.endsWith('.json') && !filePath.includes('_complete') && !filePath.includes('_mission')) {
    // Nudge HQ
    const prompt = `Process new finding: ${filePath}`
    tmuxSendKeys('intel-hq', prompt)
  }
})
```

### 4.4 Processing Pipeline

```
Raw Finding arrives
        │
        ▼
┌──────────────┐
│  DEDUPLICATE │  Check: does processed/ already contain this signal?
│              │  Match on: source + territory + title similarity
│              │  If duplicate: merge (update timestamp, boost confidence)
│              │  If new: continue
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   CLASSIFY   │  Apply classification rules from standing orders
│              │  Input: finding content, confidence, severity
│              │  Output: ENEMY | RESOURCE | TERRAIN
│              │
│              │  Anti-hallucination gate:
│              │  - confidence < 'probable' → cannot be ENEMY
│              │  - single source + no corroboration → cannot be ENEMY
│              │  - normal variance range → TERRAIN, not ENEMY
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  CORRELATE   │  Cross-reference with:
│              │  - Other findings from same mission
│              │  - Recent processed intel (last 7 days)
│              │  - Threat board active items
│              │  - Campaign objectives (is this relevant to active goals?)
│              │
│              │  Output: relatedIntelIds[], correlationNotes
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  PRIORITIZE  │  Compute attention_priority (1-10):
│              │
│              │  Base score from severity:
│              │    critical=8, high=6, medium=4, low=2
│              │
│              │  Modifiers:
│              │    +2 if affects active campaign objective
│              │    +1 if corroborated by multiple sources
│              │    +1 if time-sensitive (< 24h to act)
│              │    -1 if confidence < 'probable'
│              │    -2 if similar to recently dismissed intel
│              │
│              │  Clamp to 1-10
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    WRITE     │  Write processed intel JSON to processed/
│              │  Update threat-board.json if classification is ENEMY
│              │  Archive raw finding (move .processed marker)
└──────────────┘
```

### 4.5 Processed Intel Schema (HQ Output)

This is what the renderer consumes. One file per intel object.

```typescript
interface ProcessedIntel {
  // === Identity ===
  intelId: string                 // UUID
  createdAt: string               // ISO 8601
  updatedAt: string               // ISO 8601

  // === Origin ===
  sourceMissionId: string         // Which mission produced this
  sourceFindings: string[]        // Which raw findings contributed
  sources: IntelSource[]          // Aggregated sources

  // === Classification ===
  classification: 'enemy' | 'resource' | 'terrain'
  subtype: string                 // See subtypes below

  // === Content ===
  title: string                   // Display title (< 80 chars)
  briefing: string                // 2-3 sentence summary for the general
  details: string                 // Full analysis (< 1000 chars)
  rawData?: Record<string, any>   // Structured data for HUD widgets

  // === Confidence ===
  confidence: ConfidenceLevel
  confidenceReason: string        // Why HQ assigned this confidence
  corroborationCount: number      // How many independent sources agree

  // === Priority ===
  attentionPriority: number       // 1-10 (10 = drop everything)
  timeSensitive: boolean
  expiresAt?: string              // When this intel goes stale

  // === Location ===
  territory: string               // Which front this affects
  mapPosition?: { x: number, y: number }  // Specific position in territory

  // === Relations ===
  relatedIntelIds: string[]       // Other processed intel this connects to
  campaignObjectiveId?: string    // If relevant to an active objective
  correlationNotes?: string       // How pieces connect

  // === Lifecycle ===
  status: 'active' | 'acknowledged' | 'resolved' | 'expired' | 'dismissed'
  resolvedAt?: string
  resolvedBy?: string             // Session ID of the unit that handled it
  resolutionNotes?: string

  // === Renderer Hints ===
  mapObject: MapObjectSpec        // How to render this on the map
}
```

### 4.6 Map Object Spec (Renderer Contract)

```typescript
interface MapObjectSpec {
  objectType: 'enemy_unit' | 'resource_node' | 'terrain_reveal' | 'intel_marker'

  // For enemy_unit
  enemyType?: EnemyType
  behavior?: EnemyBehavior
  strength?: number              // 1-10, affects sprite size

  // For resource_node
  resourceType?: ResourceType
  value?: number                 // Estimated value ($, leads, etc.)
  harvestable?: boolean          // Can a unit be sent to collect this?

  // For terrain_reveal
  terrainType?: TerrainType
  fogReduction?: number          // 0-1, how much fog this clears

  // For intel_marker
  markerIcon?: string            // emoji or icon key
  markerColor?: string           // hex color

  // Common
  position: { x: number, y: number }
  confidenceVisual: 'solid' | 'dashed' | 'dotted' | 'pulsing'
  tooltipText: string
}
```

### 4.7 Threat Board

The threat board is a running intelligence picture — a single JSON file that HQ maintains as an aggregate view of all active threats. The renderer can read this directly for the minimap threat indicators and territory threat levels.

```typescript
interface ThreatBoard {
  lastUpdated: string
  overallThreatLevel: 'green' | 'yellow' | 'orange' | 'red'

  territories: Record<string, TerritoryIntelState>
  activeThreats: ActiveThreat[]
  activeOpportunities: ActiveOpportunity[]
  recentChanges: ThreatBoardChange[]       // Last 20 changes for the activity feed
}

interface TerritoryIntelState {
  territory: string
  fogLevel: number              // 0-1
  threatLevel: number           // 0-1
  lastScouted: string           // ISO 8601
  activeSources: IntelSource[]  // Sources with fresh data
  staleSources: IntelSource[]   // Sources needing refresh
  activeEnemyCount: number
  activeResourceCount: number
}

interface ActiveThreat {
  intelId: string
  title: string
  territory: string
  severity: string
  confidence: ConfidenceLevel
  detectedAt: string
  ageMinutes: number            // How long since detection
  assignedUnit?: string         // Session ID if someone is handling it
  escalated: boolean            // Has this been escalated to the general?
}

interface ActiveOpportunity {
  intelId: string
  title: string
  territory: string
  estimatedValue: string        // "$500 MRR" or "~50 leads" etc.
  windowClosesAt?: string       // Time-sensitive?
  harvestAssigned?: string      // Session ID if a unit is on it
}

interface ThreatBoardChange {
  timestamp: string
  changeType: 'threat_added' | 'threat_resolved' | 'threat_escalated'
              | 'opportunity_found' | 'opportunity_captured'
              | 'fog_cleared' | 'fog_returned' | 'territory_status_change'
  summary: string               // One-line for the activity feed
  intelId: string
}
```

### 4.8 Anti-Hallucination Measures

The #1 risk with an AI-powered intel system is false alarms. A hallucinated threat wastes the general's most precious resource: attention. These guardrails prevent it:

**1. Confidence Floor for Enemies**

No raw finding with confidence below `probable` can become an enemy on the map. `possible` and `speculative` findings become terrain markers with a threat flag — visible to the user if they look, but not screaming for attention.

**2. Corroboration Requirement for Critical/High**

A finding cannot be classified as `critical` or `high` severity unless:
- It comes from a primary API source (Stripe, Kit, Supabase), OR
- It has corroboration from 2+ independent sources

Single-source high-severity findings are automatically downgraded to `medium`.

**3. Base Rate Check**

Before flagging an anomaly, HQ must check: "Is this within normal variance?" The HQ CLAUDE.md instructs: "If you don't have a baseline for what's normal, you can't call something abnormal. Mark it as TERRAIN and note 'baseline unknown.'"

**4. Decay Over Confidence**

If HQ processes the same type of finding repeatedly without the user acting on it, subsequent findings of that type get a confidence penalty. The system learns that "LinkedIn impressions down 5%" is not worth alerting on if the user has dismissed it 3 times.

**5. Human Override**

The user can right-click any map object and select:
- "Dismiss" — removes from map, tells HQ to deprioritize similar signals
- "Confirm" — boosts confidence to `confirmed`, HQ remembers for future correlation
- "Investigate" — deploys a targeted scout to dig deeper

---

## 5. Intelligence Products (Map Objects)

### 5.1 Enemy Units

Enemies are threat signals rendered as hostile sprites on the map. They appear in the territory they affect and persist until resolved.

#### Enemy Types

```typescript
type EnemyType =
  | 'raider'          // One-off threat (support ticket, failed payment)
  | 'patrol'          // Recurring threat (competitor monitoring, declining metric)
  | 'siege_engine'    // Sustained pressure (churn wave, negative PR cycle)
  | 'assassin'        // Targeted threat (key customer at risk, partnership collapse)
  | 'spy'             // Hidden threat (competitor copying, quiet churn)
```

| Enemy Type | Visual | Business Reality | Examples |
|---|---|---|---|
| **Raider** | Small, fast-moving sprite. Red. | Acute incident requiring response. | Unresolved support ticket, failed payment, broken deploy |
| **Patrol** | Medium, moves in a loop pattern. Orange. | Recurring negative signal. | Weekly engagement decline, competitor publishing in your niche |
| **Siege Engine** | Large, slow-moving, ominous. Dark red. | Sustained existential threat. | MRR churn above 5%, multi-week engagement collapse, legal issue |
| **Assassin** | Small, stealthy (partially transparent). Purple. | High-value target at risk. | Top customer going silent, key partner shopping alternatives |
| **Spy** | Barely visible, flickers. Gray. | Threat you can't quite see yet. | Speculative competitor intel, anomalous but unexplained metrics |

#### Enemy Behaviors

```typescript
type EnemyBehavior =
  | 'stationary'      // Stays put. Waits to be resolved. (support ticket)
  | 'patrol'          // Moves in a loop within territory. (recurring issue)
  | 'advance'         // Slowly moves toward HQ. Urgency increasing. (churn)
  | 'siege'           // Parks at territory border. Blocks activity. (major threat)
  | 'retreat'         // Moving away. Threat diminishing. (issue resolving)
```

**Advance Mechanic:**

Enemies classified with `advance` behavior move slowly toward HQ over time. The closer they get, the louder and more visually prominent they become. This creates urgency without pop-up spam — the user can SEE the threat approaching.

```typescript
interface EnemyAdvance {
  startPosition: { x: number, y: number }    // Territory edge
  targetPosition: { x: number, y: number }   // HQ center
  speed: number                               // Pixels per minute
  currentPosition: { x: number, y: number }  // Updated by renderer
  startedAt: string
  // Position is interpolated: current = lerp(start, target, elapsed * speed)
}
```

An advancing enemy can be intercepted: deploying a unit to "attack" it (resolve the underlying issue) stops its advance.

#### Enemy Lifecycle State Machine

```
                    ┌──────────────┐
                    │   DETECTED   │ ← Finding processed by HQ
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
            ┌───── │    ACTIVE     │ ──── aging ────┐
            │      └──────┬───────┘                 │
            │             │                         │
     unit deployed    user dismisses          no response
            │             │                    (> threshold)
            │             │                         │
     ┌──────▼───────┐ ┌──▼──────────┐    ┌────────▼───────┐
     │  ENGAGED     │ │  DISMISSED  │    │   ESCALATED    │
     │ (unit on it) │ │             │    │  (alert sent)  │
     └──────┬───────┘ └─────────────┘    └────────┬───────┘
            │                                     │
            │ issue resolved                unit deployed
            │                                     │
     ┌──────▼───────┐                    ┌────────▼───────┐
     │   RESOLVED   │                    │    ENGAGED     │
     │  (victory!)  │                    │   (finally)    │
     └──────┬───────┘                    └────────┬───────┘
            │                                     │
            ▼                                     ▼
     ┌──────────────┐                    ┌──────────────┐
     │   ARCHIVED   │                    │   RESOLVED   │
     └──────────────┘                    └──────────────┘
```

**Escalation timer:** Each severity has an auto-escalate threshold:
- Critical: 15 minutes
- High: 2 hours
- Medium: 24 hours
- Low: never auto-escalates

### 5.2 Resource Nodes

Resources are opportunity signals rendered as collectible objects on the map.

#### Resource Types

```typescript
type ResourceType =
  | 'gold_vein'       // Revenue opportunity (new lead, upsell signal)
  | 'supply_cache'    // Efficiency gain (tool, shortcut, process improvement)
  | 'recruitment'     // Talent/partnership opportunity
  | 'intelligence'    // Knowledge that improves decision-making
  | 'ammunition'      // Content asset (viral post, case study, testimonial)
```

| Resource Type | Visual | Business Reality | Examples |
|---|---|---|---|
| **Gold Vein** | Glowing gold node, pulsing. | Revenue-generating opportunity. | Hot lead, upsell signal, pricing gap in market |
| **Supply Cache** | Green crate icon. | Operational efficiency gain. | Better tool discovered, automation opportunity, cost reduction |
| **Recruitment** | Blue person silhouette. | Talent or partnership. | Freelancer available, potential collaborator, JV opportunity |
| **Intelligence** | Scroll icon, blue glow. | Strategic knowledge. | Market insight, customer need identified, trend ahead of curve |
| **Ammunition** | Stacked orange bars. | Content/marketing asset. | Trending topic to write about, testimonial received, case study material |

#### Harvesting Resources

Resources can be "harvested" by deploying a unit to act on them:

1. User clicks resource node on map
2. Intel panel shows details + "Harvest" button
3. User clicks "Harvest" → deploys appropriate unit type:
   - Gold Vein → Diplomat (sales agent)
   - Supply Cache → Engineer (build/optimize)
   - Recruitment → Commander (relationship outreach)
   - Intelligence → added to knowledge base (no unit needed)
   - Ammunition → Writer (content creation)
4. Unit moves to resource node location on map
5. When unit completes task, resource node transitions:
   - Success: gold coins burst animation, resource disappears, score updates
   - Partial: resource shrinks but persists
   - Failed: resource grays out, marked as "attempted"

Resource nodes have a **window** — they expire if not harvested. A trending topic is only trending for 48 hours. A hot lead goes cold in a week. The `expiresAt` field drives a countdown timer on the node's tooltip, and the node's glow dims as it approaches expiration.

### 5.3 Terrain Reveals

Terrain reveals are the most common intelligence product. They're not threats or opportunities — they're the ground truth of your business landscape.

#### Terrain Types

```typescript
type TerrainType =
  | 'plains'          // Normal conditions, baseline metrics within range
  | 'highlands'       // Above-average performance (good ground to defend)
  | 'lowlands'        // Below-average performance (vulnerable ground)
  | 'forest'          // Complex/unclear situation (need more recon)
  | 'mountains'       // Barriers/blockers (tech debt, capacity limits)
  | 'river'           // Flow/pipeline metrics (active sequences, funnels)
  | 'ruins'           // Abandoned initiative (old campaign, dead feature)
  | 'fortress'        // Established strength (loyal customer base, proven skill)
```

When a scout reports terrain, the fog clears and the territory's visual texture updates:

| Terrain | Visual | Meaning |
|---|---|---|
| **Plains** | Flat, neutral beige ground | Things are normal here. No news is good news. |
| **Highlands** | Elevated, green tint | Strong performance. Worth defending. |
| **Lowlands** | Low, slightly red tint | Weak area. Vulnerable to threats. |
| **Forest** | Dense pattern, low visibility | Can't tell what's happening. Need more recon. |
| **Mountains** | Rocky texture, impassable feel | Blocked. Something prevents progress. |
| **River** | Flowing blue line | Active pipeline/funnel. Healthy flow. |
| **Ruins** | Gray, crumbled structures | Abandoned effort. Might have salvageable resources. |
| **Fortress** | Walled structure | Established stronghold. Hard for enemies to penetrate. |

Terrain doesn't demand attention — it informs decisions. The user glances at the map and sees "Lead-Gen is highlands (performing well), Support is lowlands (struggling), Fulfillment is forest (unclear)." That shapes where to deploy next.

### 5.4 Intel Reports

Beyond map objects, the HQ produces structured briefings that appear in the Intel panel.

```typescript
interface IntelReport {
  reportId: string
  generatedAt: string
  reportType: 'mission_debrief' | 'situation_report' | 'threat_assessment' | 'opportunity_brief'
  title: string
  territory: string

  // Structured sections
  summary: string               // 2-3 sentences
  keyFindings: KeyFinding[]     // Bulleted list of important items
  threatPicture?: string        // Current threats (for situation reports)
  opportunities?: string        // Current opportunities
  recommendation: string        // What HQ suggests the general do

  // References
  relatedIntelIds: string[]
  missionId: string
}

interface KeyFinding {
  text: string
  severity: string
  confidence: ConfidenceLevel
  actionable: boolean
}
```

**Mission Debrief** — Generated when a scout returns. Summarizes everything found.

**Situation Report (SITREP)** — Generated on a schedule (every 4 hours while Agent Empires is running). Covers all territories, all active threats, all resources. This is the "big picture" briefing.

**Threat Assessment** — Generated when a new enemy appears or an existing enemy escalates. Focused analysis of a specific threat.

**Opportunity Brief** — Generated when a high-value resource node is detected. "Here's what it is, here's the window, here's what unit to deploy."

### 5.5 Confidence Visualization

All intel products on the map reflect their confidence level visually:

```
CONFIRMED       PROBABLE        POSSIBLE        SPECULATIVE
┌─────────┐    ┌ ─ ─ ─ ─ ┐    ┌ · · · · ┐    ┌ ? ? ? ? ┐
│  ████   │    │  ████   │      ████           ████
│  ████   │    │  ████   │    · ████   ·    ?  ████   ?
│  ████   │    │  ████   │      ████           ████
└─────────┘    └ ─ ─ ─ ─ ┘    └ · · · · ┘    └ ? ? ? ? ?┘

 Solid border    Dashed border   Dotted border   Pulsing "?"
 Full color      Slight mute     Muted 30%       Muted 50%
 Full opacity    90% opacity     70% opacity     50% opacity + pulse
```

Clicking any map object shows its confidence level and the reasoning in the Intel panel. Users learn to trust solid objects and investigate pulsing ones.

---

## 6. Counter-Intelligence

### 6.1 Can Enemies Scout You?

Yes. Certain enemy types represent situations where external actors have visibility into your operations.

**Competitor Monitoring (Spy enemy)**

If a scout discovers that a competitor is publishing content suspiciously similar to yours, or their product roadmap mirrors your announced features, this manifests as a **Spy** enemy on your territory. The spy is semi-transparent and hard to spot — it might only appear when a scout specifically looks for it.

- **Detection:** Scout finds competitor content that closely mirrors yours (topic, framing, timing)
- **Map visual:** Flickering, semi-transparent enemy sprite on the affected territory
- **Impact:** No direct game effect, but flags a strategic concern in the Intel panel
- **Counter:** User can deploy an Operative to "investigate" (deeper competitive analysis), or adjust strategy

**Engagement Decay (Silent Siege)**

If no scout visits a territory for too long, the "enemy" isn't a specific actor — it's entropy. The fog returns, and the system assumes conditions are degrading. This creates a mechanic where NOT scouting is itself a threat.

### 6.2 Intel Staleness & Fog Return

Intel has a half-life. Fresh findings decay into stale findings, and stale findings decay into fog.

```typescript
interface IntelDecay {
  // Source-specific freshness windows
  freshnessWindows: Record<IntelSource, {
    fresh: number       // Minutes before "fresh" → "aging"
    stale: number       // Minutes before "aging" → "stale"
    expired: number     // Minutes before "stale" → "expired" (fog returns)
  }>
}

const DEFAULT_DECAY: Record<IntelSource, { fresh: number, stale: number, expired: number }> = {
  'stripe-payments':      { fresh: 60,   stale: 360,   expired: 1440 },   // Real-time source, stale after 6h
  'kit-subscribers':      { fresh: 240,  stale: 1440,  expired: 4320 },   // Daily metrics, stale after 1 day
  'linkedin-analytics':   { fresh: 360,  stale: 2880,  expired: 10080 },  // Weekly cycle, stale after 2 days
  'slack-channels':       { fresh: 30,   stale: 120,   expired: 480 },    // Chat is ephemeral
  'web-search':           { fresh: 1440, stale: 4320,  expired: 10080 },  // Web intel stales slowly
  'competitor-intel':     { fresh: 1440, stale: 10080, expired: 43200 },  // Competitors move monthly
  'supabase-metrics':     { fresh: 60,   stale: 360,   expired: 1440 },   // Internal DB, keep fresh
  'gmail-inbox':          { fresh: 120,  stale: 480,   expired: 2880 },
  'google-calendar':      { fresh: 60,   stale: 240,   expired: 720 },
  'github-activity':      { fresh: 120,  stale: 720,   expired: 2880 },
  'google-analytics':     { fresh: 360,  stale: 1440,  expired: 4320 },
  'social-monitoring':    { fresh: 240,  stale: 1440,  expired: 4320 },
  'market-research':      { fresh: 2880, stale: 14400, expired: 43200 },
  'web-scrape':           { fresh: 1440, stale: 4320,  expired: 10080 },
}
```

**Visual progression:**

1. **Fresh** (0 → fresh window): Full color, bright terrain, no fog
2. **Aging** (fresh → stale): Colors slightly muted, very thin fog layer starts appearing at edges
3. **Stale** (stale → expired): Noticeably dimmed, fog at 50%, terrain details fade
4. **Expired** (beyond expired window): Heavy fog, terrain nearly invisible, enemy movements could be hidden

When fog returns, map objects don't disappear — they become "ghost" versions of themselves. An enemy that was detected 3 days ago is still shown, but as a translucent afterimage with a "LAST SEEN: 3d ago" label. The user knows it was there, but not if it's still there.

### 6.3 Scout Ambushes (Dead Ends)

Sometimes a scouting mission yields nothing useful. This isn't a system failure — it's a game mechanic. The "ambush" is wasted context tokens (fuel) without meaningful findings.

**Causes:**
- API returns no data (service down, rate limited, empty result set)
- Web search returns noise (no relevant results for query)
- Source data hasn't changed since last scout
- Scout asks the wrong question (targeted mission with poor framing)

**Visual:**
- Scout sprite shows a "!" confusion icon
- Finding written with `signalType: 'noise'` and note explaining the dead end
- Fuel consumed but nothing gained
- Small "poof" animation (wasted resources)

**Mitigation:**
- HQ tracks which sources are yielding vs. dry. Over time it adjusts recommendations: "LinkedIn has been dry for 3 patrols. Consider skipping on next patrol."
- User can set source priority in the deploy modal to avoid known dry sources
- Patrol missions auto-skip sources that returned nothing on the last 2 patrols (user can override)

**Rate Limit Ambush:**

The most insidious form. A scout hits an API rate limit and burns context tokens on retries before realizing it's blocked. The finding JSON for this is:

```json
{
  "findingId": "finding-004",
  "missionId": "mission-2026-03-10-001",
  "timestamp": "2026-03-10T09:22:00Z",
  "source": "linkedin-analytics",
  "title": "API RATE LIMITED — LinkedIn Analytics unavailable",
  "body": "LinkedIn API returned 429. Rate limit resets at 2026-03-10T10:00:00Z. No data retrieved.",
  "signalType": "noise",
  "confidence": "confirmed",
  "severity": "low",
  "territory": "lead-gen",
  "tags": ["rate-limit", "api-failure", "linkedin"],
  "scoutNotes": "Wasted ~5k tokens on retries before giving up. Suggest blacklisting this source until 10:00 UTC."
}
```

HQ reads this and updates the threat board's source availability tracker. Next scout deploying to this territory will see "LinkedIn: unavailable until 10:00" in the deploy modal.

---

## 7. End-to-End Example

### Scenario: Monday Morning Patrol of the Lead-Gen Front

**09:00 — User opens Agent Empires**

The map loads. Lead-Gen territory is at 60% fog (last scouted Friday afternoon). The user sees ghost outlines of Friday's intelligence — a gold vein (hot lead list) and a patrol enemy (competitor content series) — but both are faded and labeled "LAST SEEN: 66h ago."

**09:01 — User deploys scout**

Right-clicks Lead-Gen territory → Deploy Scout → Patrol → selects all sources → DEPLOY.

Server creates tmux window `scout-01`. Claude Code session boots with scout CLAUDE.md. Scout sprite appears at HQ with deployment smoke, then begins animated path to Lead-Gen.

```
Server log: [DEPLOY] scout-01 → lead-gen (patrol) | mission-2026-03-10-001
```

**09:02 — Scout begins patrol**

Scout's first action: check Kit subscriber data (highest priority source for Lead-Gen).

```bash
# Scout runs in its Claude session:
curl -s -H "Authorization: Bearer $KIT_API_KEY" \
  "https://api.convertkit.com/v4/subscribers?filter[added_after]=2026-03-07" | jq .
```

Result: 23 new subscribers since Friday. Normal rate is ~15/weekend. +53% above baseline.

Scout writes finding:

```json
{
  "findingId": "finding-001",
  "missionId": "mission-2026-03-10-001",
  "timestamp": "2026-03-10T09:02:30Z",
  "source": "kit-subscribers",
  "title": "Kit subscribers +53% above weekend baseline (23 vs expected 15)",
  "body": "23 new subscribers added between Friday 17:00 and Monday 09:00. Historical weekend average is 15 (σ=4). This is +2σ above mean. Possible viral content or referral spike. Top tags: 'ccb-waitlist' (14), 'newsletter' (9).",
  "rawData": {
    "newSubscribers": 23,
    "baseline": 15,
    "stdDev": 4,
    "topTags": { "ccb-waitlist": 14, "newsletter": 9 }
  },
  "signalType": "opportunity",
  "confidence": "confirmed",
  "severity": "medium",
  "territory": "lead-gen",
  "tags": ["kit", "subscriber-growth", "ccb-waitlist", "above-baseline"],
  "expiresAt": "2026-03-11T09:00:00Z"
}
```

**Map update:** Green ping radiates from Kit source node on Lead-Gen territory. Fog drops from 60% to 50%.

**09:03 — Server nudges HQ**

File watcher detects `finding-001.json`. Sends prompt to `intel-hq` tmux window.

HQ reads the finding. Processing:
1. **Deduplicate:** No existing intel about Kit subscriber spike. New signal.
2. **Classify:** Positive metric above baseline → RESOURCE (gold_vein).
3. **Correlate:** Check if ccb-waitlist growth connects to any known campaign. Yes — active campaign "Q1 2026 — Scale CCB." This directly affects the "New leads" objective.
4. **Prioritize:** Base score 4 (medium) + 2 (affects active campaign) + 1 (corroborated by primary API) = 7.

HQ writes processed intel:

```json
{
  "intelId": "intel-f7a2b1",
  "createdAt": "2026-03-10T09:03:15Z",
  "classification": "resource",
  "subtype": "gold_vein",
  "title": "Weekend subscriber surge: 23 new (53% above baseline)",
  "briefing": "Kit added 23 new subscribers over the weekend vs the typical 15. 14 of them tagged ccb-waitlist, directly feeding your Q1 enrollment campaign. Something drove unusual weekend signups — worth investigating what content or referral source caused this.",
  "confidence": "confirmed",
  "attentionPriority": 7,
  "territory": "lead-gen",
  "campaignObjectiveId": "obj-new-leads",
  "mapObject": {
    "objectType": "resource_node",
    "resourceType": "gold_vein",
    "value": 23,
    "harvestable": true,
    "position": { "x": 450, "y": 280 },
    "confidenceVisual": "solid",
    "tooltipText": "+23 subscribers (53% above baseline) — 14 tagged ccb-waitlist"
  }
}
```

**Map update:** Gold pulsing node appears in Lead-Gen territory. Campaign progress bar in HUD ticks up slightly.

**09:04-09:08 — Scout continues patrol**

Scout checks LinkedIn Analytics, web search for competitor activity, Google Analytics. Writes findings for each:

- **finding-002:** LinkedIn impressions stable (+2%, within normal range) → terrain (plains)
- **finding-003:** Competitor "AI Workshop Pro" launched a new pricing page at $497/mo → enemy (patrol)
- **finding-004:** Google Analytics shows referral spike from a Reddit thread → resource (ammunition)
- **finding-005:** LinkedIn API rate limited, no follower data available → noise

Each finding triggers a ping on the map. HQ processes in parallel.

**09:09 — Scout completes patrol**

Scout writes `_complete.json` with summary. Session ends.

```json
{
  "missionId": "mission-2026-03-10-001",
  "completedAt": "2026-03-10T09:09:00Z",
  "status": "completed",
  "findingCount": 5,
  "fuelConsumed": 35000,
  "summary": "Patrol complete. 1 strong opportunity (Kit subscriber surge), 1 content asset (Reddit referral thread), 1 competitor movement (AI Workshop Pro new pricing), 1 baseline reading, 1 dry source (LinkedIn rate limited).",
  "scoutRecommendation": "Deploy writer to investigate the Reddit thread — could be repeatable content strategy. The competitor pricing at $497/mo is above our CCB price point, which is good positioning."
}
```

**Map update:** Scout sprite animates back to HQ. Lead-Gen fog is now at 15%. Intel panel shows Mission Debrief with full findings.

**09:10 — What the user sees**

The Lead-Gen territory is now mostly clear. They can see:
- A **gold vein** (subscriber surge) pulsing near the Kit source node
- An **ammunition cache** (Reddit thread opportunity) near the territory border
- An **orange patrol enemy** (competitor pricing page) moving in a loop at the territory edge
- Clear **plains terrain** (LinkedIn baseline normal) across most of the territory
- A small **fog patch** where LinkedIn follower data should be (rate limited, source unavailable)

The Intel panel shows:
```
┌────────────────────────────────────────┐
│ MISSION DEBRIEF — Lead-Gen Patrol      │
│ 09:00-09:09 | 5 findings | ████░ fuel │
│                                        │
│ KEY FINDINGS:                          │
│ ● Kit subscriber surge +53% (☆ HIGH)  │
│ ● Competitor AI Workshop Pro: $497/mo  │
│ ● Reddit referral spike (actionable)   │
│                                        │
│ RECOMMENDATION:                        │
│ Deploy writer to the Reddit thread.    │
│ Competitor pricing validates our       │
│ position — no action needed.           │
│                                        │
│ [Deploy Writer] [Deep Recon] [Dismiss] │
└────────────────────────────────────────┘
```

The user clicks "Deploy Writer" and a content unit is spawned to act on the Reddit opportunity. The game continues.

---

## 8. State Machines

### 8.1 Scout Session Lifecycle

```
                    ┌───────────┐
                    │  QUEUED   │  ← User clicked Deploy, waiting for tmux
                    └─────┬─────┘
                          │ tmux window created
                          ▼
                    ┌───────────┐
                    │ DEPLOYING │  ← Claude Code booting, loading skills
                    └─────┬─────┘
                          │ first tool call detected
                          ▼
                    ┌───────────┐
                    │  ACTIVE   │  ← Scout is executing research tasks
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
        _complete.json  timeout    fuel critical
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │RETURNING │ │RECALLED  │ │ BINGO    │
        │(clean)   │ │(timeout) │ │(no fuel) │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             └──────┬──────┘──────┬──────┘
                    │             │
              session ends    force kill
                    │             │
                    ▼             ▼
              ┌───────────┐ ┌───────────┐
              │ COMPLETE  │ │  KILLED   │
              └───────────┘ └───────────┘
```

### 8.2 Intel Object Lifecycle

```
      ┌──────────┐
      │ DETECTED │  ← HQ writes processed intel
      └────┬─────┘
           │
           ▼ (appears on map)
      ┌──────────┐
      │  ACTIVE  │ ───── user acknowledges ────→ ┌──────────────┐
      └────┬─────┘                                │ ACKNOWLEDGED │
           │                                      └──────┬───────┘
           │                                             │
           ├── unit deployed to handle ──→ ┌──────────┐  │
           │                               │ ENGAGED  │  │
           │                               └────┬─────┘  │
           │                                    │        │
           │                              task complete  │
           │                                    │        │
           │                               ┌────▼─────┐  │
           │                               │ RESOLVED │◄─┘ (user resolves manually)
           │                               └────┬─────┘
           │                                    │
           ├── time passes, expires ──→ ┌───────▼────┐
           │                           │  EXPIRED   │
           │                           └────────────┘
           │
           └── user dismisses ──→ ┌───────────┐
                                  │ DISMISSED │
                                  └───────────┘

      All terminal states → ARCHIVED (moved to archive/ after 7 days)
```

### 8.3 Territory Fog State Machine

```
      ┌─────────┐
      │ FOGGED  │  (1.0) — no data, fully obscured
      └────┬────┘
           │ scout deployed
           ▼
      ┌─────────┐
      │CLEARING │  (0.5-0.9) — scout active, findings coming in
      └────┬────┘
           │ mission complete
           ▼
      ┌─────────┐
      │  CLEAR  │  (0.0-0.2) — fresh data, full visibility
      └────┬────┘
           │ time passes (decay)
           ▼
      ┌─────────┐
      │  AGING  │  (0.2-0.5) — data aging, slight fog
      └────┬────┘
           │ more time passes
           ▼
      ┌─────────┐
      │  STALE  │  (0.5-0.8) — old data, significant fog
      └────┬────┘
           │ sources expire
           ▼
      ┌─────────┐
      │ FOGGED  │  (0.8-1.0) — back to blind
      └─────────┘

      At any state: scout deployed → CLEARING
```

---

## 9. Implementation Notes

### 9.1 File Paths

All intel data lives under `~/.agent-empires/data/intel/`. This is the scout's `cwd` and the HQ's watch target.

```
~/.agent-empires/data/intel/
├── raw/                      # Scout writes here
├── processed/                # HQ writes here
├── archive/                  # Cron job moves old items here
├── threat-board.json         # HQ maintains this
└── source-status.json        # Tracks API availability/rate limits
```

### 9.2 Server Integration

The server (`server/index.ts`) needs these additions:

```typescript
// New: Intel file watchers
import chokidar from 'chokidar'

const INTEL_PROCESSED_DIR = expandPath('~/.agent-empires/data/intel/processed/')
const THREAT_BOARD_PATH = expandPath('~/.agent-empires/data/intel/threat-board.json')

// Watch for processed intel (HQ output)
chokidar.watch(INTEL_PROCESSED_DIR).on('add', (filePath) => {
  const intel = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  broadcastToClients({
    type: 'intel_update',
    payload: intel
  })
})

// Watch threat board changes
chokidar.watch(THREAT_BOARD_PATH).on('change', () => {
  const board = JSON.parse(fs.readFileSync(THREAT_BOARD_PATH, 'utf-8'))
  broadcastToClients({
    type: 'threat_board_update',
    payload: board
  })
})
```

### 9.3 New WebSocket Event Types

Add to `shared/types.ts`:

```typescript
// Intel events (server → client)
export interface IntelUpdateEvent {
  type: 'intel_update'
  payload: ProcessedIntel
}

export interface ThreatBoardUpdateEvent {
  type: 'threat_board_update'
  payload: ThreatBoard
}

export interface ScoutStatusEvent {
  type: 'scout_status'
  payload: {
    sessionId: string
    missionId: string
    status: ScoutStatus
    territory: string
    currentSource?: string
    fuelRemaining: number
    findingCount: number
  }
}

export interface FogUpdateEvent {
  type: 'fog_update'
  payload: {
    territory: string
    fogLevel: number
    reveals: FogRevealEvent[]
  }
}
```

### 9.4 New EventBus Handlers

Create `src/events/handlers/intelHandlers.ts`:

```typescript
export function registerIntelHandlers(): void {
  eventBus.on('intel_update', (event, ctx) => {
    const intel = event.payload as ProcessedIntel
    const { mapObject } = intel

    switch (mapObject.objectType) {
      case 'enemy_unit':
        ctx.battlefield.spawnEnemy(intel)
        ctx.soundManager.play('threat_detected')
        break
      case 'resource_node':
        ctx.battlefield.spawnResource(intel)
        ctx.soundManager.play('resource_found')
        break
      case 'terrain_reveal':
        ctx.battlefield.revealTerrain(intel)
        ctx.soundManager.play('fog_clearing')
        break
    }

    ctx.intelPanel.addIntel(intel)
  })

  eventBus.on('threat_board_update', (event, ctx) => {
    ctx.minimap.updateThreats(event.payload)
    ctx.resourceBar.updateThreatLevel(event.payload.overallThreatLevel)
  })

  eventBus.on('scout_status', (event, ctx) => {
    ctx.battlefield.updateScout(event.payload)
  })
}
```

### 9.5 Scout Template

Add to `ae_unit_templates` Supabase table:

```sql
INSERT INTO ae_unit_templates (type, name, description, initial_prompt, skills, icon, flags) VALUES (
  'scout',
  'Scout',
  'Reconnaissance and intelligence gathering unit. Deploys to territories to check intel sources, monitor competitors, and report findings.',
  -- initial_prompt is the mission-specific prompt (set at deploy time)
  NULL,
  ARRAY['web-research', 'analytics-check', 'slack-scanner', 'supabase-query', 'sentiment-scan'],
  'binoculars',
  '{"maxDuration": 30}'::jsonb
);
```

### 9.6 Sound Additions

New sounds for the intel system (add to `SoundManager.ts`):

| Sound | Trigger | Description |
|---|---|---|
| `scout_deploy` | Scout spawned | Binoculars focus sound (rising sine sweep + click) |
| `scout_return` | Scout mission complete | Brief radio static + "mission complete" tone |
| `threat_detected` | Enemy appears on map | Low war drum (single hit, reverb tail) |
| `threat_escalated` | Enemy escalates | War drum crescendo (3 hits, increasing volume) |
| `threat_resolved` | Enemy removed | Relief chord (major triad, soft) |
| `resource_found` | Resource node appears | Treasure chime (bright, two-note ascending) |
| `resource_harvested` | Resource collected | Cash register + coin cascade (from existing) |
| `fog_clearing` | Territory fog reduces | Atmospheric whoosh (wind-like, 1.5s) |
| `fog_returning` | Territory fog increases | Reverse atmospheric whoosh (subtle, background) |
| `intel_ping` | Any finding received | Sonar ping (single, subtle) |
| `sitrep_ready` | Situation report generated | Radio beep-beep (two quick tones) |

### 9.7 Performance Budget

The intel system adds background file I/O and WebSocket events. Budget:

- **File watchers:** 2 (raw + processed directories). Chokidar is lightweight.
- **WebSocket events:** ~1-3 per minute during active scouting, ~0 when idle.
- **Map objects:** Maximum 50 active intel objects on map at once. Older items archive.
- **Fog rendering:** One semi-transparent overlay per territory (6 total). GPU trivial.
- **Enemy animations:** Maximum 20 animated enemy sprites. Each is a simple PixiJS sprite with tween.
- **HQ session:** Always running but mostly idle (processes a finding in <30s, then sleeps).

### 9.8 Graceful Degradation

If Intel HQ crashes or is unavailable:
1. Raw findings still accumulate on disk (scouts don't depend on HQ)
2. Server detects HQ session offline via health check
3. Notification to user: "Intel HQ offline — raw findings queuing"
4. Server auto-restarts HQ session
5. On restart, HQ processes backlog of unprocessed findings
6. No data lost — filesystem is the buffer

If a scout crashes mid-mission:
1. Partial findings are preserved (one file per finding, written as discovered)
2. No `_complete.json` written
3. Server detects scout session ended without completion
4. Mission marked as `partial` — HQ processes whatever was written
5. Notification: "Scout-01 lost contact during Lead-Gen patrol — partial findings recovered"

---

## Appendix A: Scout CLAUDE.md Template

```markdown
# SCOUT UNIT — Standing Orders

You are a reconnaissance unit for Agent Empires. Your mission details are below.

## Protocol

1. You WRITE findings. You do NOT analyze or recommend. That's HQ's job.
2. One finding per JSON file. Never batch multiple signals.
3. Use the schema exactly. Missing fields will cause HQ processing errors.
4. When your mission is complete, write _complete.json. This is your "return to base" signal.
5. If you hit a rate limit or dead end, write a finding with signalType: "noise" explaining what happened.
6. Work fast. Your context window is your fuel. Don't waste it on commentary.

## Finding Schema

Write to: ~/.agent-empires/data/intel/raw/{missionId}/finding-{NNN}.json

Required fields: findingId, missionId, timestamp, source, title, body, signalType, confidence, severity, territory, tags
Optional fields: rawData, sourceUrl, sourceQuery, relatedFindings, expiresAt, scoutNotes

## Confidence Guide
- confirmed: From official API or dashboard
- probable: Multiple credible sources agree
- possible: Single source or ambiguous data
- speculative: Your interpretation or unreliable source

## Signal Types
- threat: Something bad happening or about to happen
- opportunity: Something good to capture
- terrain: Baseline information, not anomalous
- noise: Dead end, no data, rate limited, irrelevant
```

## Appendix B: Intel HQ CLAUDE.md Template

See Section 4.2 for the full HQ standing orders.

## Appendix C: Deploy Modal Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  DEPLOY SCOUT                                    [X]        │
│                                                             │
│  Target: ┌──────────────────────────────────┐               │
│          │ Lead-Gen Front              ▼    │               │
│          └──────────────────────────────────┘               │
│                                                             │
│  Mission: ┌─────────────────────────────────────────┐       │
│           │ ◉ Patrol    (~10min, ~30% fuel)         │       │
│           │ ○ Deep Recon (~30min, ~70% fuel)        │       │
│           │ ○ Targeted  (variable)                  │       │
│           └─────────────────────────────────────────┘       │
│                                                             │
│  Intel Sources:              Availability:                  │
│  [x] Kit Subscribers         ● available                   │
│  [x] LinkedIn Analytics      ● available                   │
│  [x] Web Search              ● available                   │
│  [ ] Slack Channels           ● available                  │
│  [ ] Google Analytics        ◐ rate limited until 10:00    │
│  [ ] Competitor Web Scrape   ● available                   │
│                                                             │
│  Estimated Fuel: ██████████░░░░░ 65%                       │
│  Est. Duration:  8-12 minutes                               │
│  Active Scouts:  1/3                                        │
│                                                             │
│            [ DEPLOY SCOUT ]        [ Cancel ]               │
└─────────────────────────────────────────────────────────────┘
```
