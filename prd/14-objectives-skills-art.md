# Agent Empires — PRD 14: Objectives, Skills, and Art Direction

> Goals are bosses. Tasks are HP. Skills are abilities. Art is Advance Wars 3D.

---

## 1. Objective System — Goals as Bosses

### Core Concept

Business objectives are not items on a checklist. They are **bosses on the battlefield** — visible structures in their territory that you assault with Claw squads. Each boss has HP equal to the number of sub-tasks required to complete it. Deploying agents drains HP. Boss dies when HP hits 0.

This turns "finish the bootcamp launch" from a Notion checkbox into a **visible siege** — you see your agents clustered around the objective, health bar draining, progress happening in real-time.

### Hierarchy

```
CAMPAIGN: "Launch SSS Bootcamp #4"          (the war)
├── OBJECTIVE: "Copy Generation"            (the boss)
│   ├── HP: 15/15                           (15 sub-tasks)
│   ├── Territory: fulfillment
│   ├── Status: UNASSAULTED
│   ├── Dependencies: none
│   └── Assigned: [Writer-01, Writer-02, Writer-03]
│
├── OBJECTIVE: "Kit Email Wiring"           (the boss)
│   ├── HP: 7/7
│   ├── Territory: lead-gen
│   ├── Status: BLOCKED
│   └── Dependencies: ["Copy Generation"]   (phase gate)
│
├── OBJECTIVE: "Landing Pages Live"
│   ├── HP: 5/5
│   ├── Territory: lead-gen
│   └── Dependencies: ["Copy Generation"]
│
├── OBJECTIVE: "Checkout Flow"
│   ├── HP: 4/4
│   ├── Territory: sales
│   └── Dependencies: ["Landing Pages Live"]
│
└── OBJECTIVE: "Quality Gate"
    ├── HP: 3/3
    ├── Territory: hq (cross-cutting)
    └── Dependencies: ["Copy Generation"]
```

### Boss Lifecycle

```
UNASSAULTED → UNDER_ATTACK → DEFEATED → ARCHIVED
                  ↓
              BLOCKED (dependency not met)
              STALLED (no agents assigned, timer running)
```

- **UNASSAULTED**: Boss visible on map, no agents assigned. Idle threat.
- **BLOCKED**: Grayed out, dependency chain shown as dotted line to blocking boss.
- **UNDER_ATTACK**: Agents clustered around boss. HP drains as sub-tasks complete. Particles, combat effects.
- **STALLED**: Under attack but no progress in 30+ min. Warning indicator. Needs attention.
- **DEFEATED**: Boss structure crumbles/explodes. Territory glows. Victory fanfare. Loot drop (the deliverable).
- **ARCHIVED**: Faded trophy remains on map. Historical record.

### HP Mechanics

Each boss's HP = number of discrete sub-tasks. Sources:

| Source | Example | HP Mapping |
|--------|---------|------------|
| Bootcamp manifest phases | "15 copy files" | HP = 15 |
| Meeting action items | "Follow up with Kelly" | HP = 1 |
| Scratchpad tasks | `- [ ] Wire Kit sequences` | HP = 1 |
| Manual creation | Command bar: `create boss "Ship Overclock v3" hp:8 territory:fulfillment` | HP = 8 |
| Campaign template | `bootcamp-factory` template auto-generates all bosses from manifest | Varies |

**HP drain events:**
- Agent completes a task file (writes to disk, returns one-liner) → -1 HP
- Manual checkbox (command bar: `complete "Copy Generation" task:3`) → -1 HP
- Webhook event (SamCart product created, Kit sequence loaded) → -1 HP
- Quality gate pass → -1 HP on the quality boss

### Dependencies — Kill Order

Bosses can depend on other bosses. A blocked boss cannot be assaulted until its dependencies are defeated.

Visual: dotted red line from blocked boss to its dependency. Line turns green and pulses when dependency is defeated and the boss unlocks.

This naturally creates **raid phases** — just like the Bootcamp Factory's Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 progression.

### Data Model

```sql
CREATE TABLE ae_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES ae_campaigns(id),
  name TEXT NOT NULL,
  description TEXT,
  territory TEXT NOT NULL,
  hp_total INTEGER NOT NULL DEFAULT 1,
  hp_remaining INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'unassaulted',  -- unassaulted, blocked, under_attack, stalled, defeated, archived
  dependencies UUID[],                -- other objective IDs that must be defeated first
  sub_tasks JSONB DEFAULT '[]',       -- [{name, completed, completed_by, completed_at}]
  priority INTEGER DEFAULT 0,         -- higher = more important
  created_at TIMESTAMPTZ DEFAULT now(),
  defeated_at TIMESTAMPTZ,
  metadata JSONB                      -- source info (manifest path, meeting ID, etc.)
);

CREATE TABLE ae_objective_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID REFERENCES ae_objectives(id),
  session_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  hp_drained INTEGER DEFAULT 0       -- how many sub-tasks this agent completed
);
```

### Feeding Objectives

**From Scratchpad (sync):**
- Parse `Scratchpad.md` daily headings
- Each `- [ ]` item = sub-task on a general "Daily Ops" boss
- Each `- [x]` item = completed → drain HP
- Group by implicit domain (file paths, keywords)

**From Meetings (auto-extract):**
- Meeting transcript → Haiku sub-agent extracts action items
- Each action item creates a mini-boss (HP=1) or adds to existing boss
- Territory assigned by keyword matching

**From Bootcamp Factory (template):**
- `bootcamp-manifest.json` → auto-generate full campaign with all bosses
- Phase gates become dependency chains
- Each sub-agent in the manifest = 1 HP on the relevant boss

**From Command Bar (manual):**
```
create campaign "Launch SSS #4"
create boss "Copy Generation" campaign:"Launch SSS #4" territory:fulfillment hp:15
create boss "Kit Wiring" campaign:"Launch SSS #4" territory:lead-gen hp:7 depends:"Copy Generation"
assault "Copy Generation"   → auto-deploys N agents
```

### Competitor Analysis as Intel → Boss Creation

When a competitor analysis reveals threats, those become bosses too:

```
OBJECTIVE: "Counter [Competitor] Launch"
├── HP: 4
├── Territory: lead-gen
├── Sub-tasks:
│   ├── Analyze their offer positioning
│   ├── Draft counter-narrative content (3 posts)
│   ├── Deploy urgency email to waitlist
│   └── Update LP with differentiators
└── Source: ae_intel threat event
```

Threats that escalate to action items automatically spawn bosses. The battlefield becomes a living strategic picture.

---

## 2. Skill System — Abilities as RTS Abilities

### Core Concept

When you select a Claw unit, the bottom of the screen shows its **ability bar** — like selecting a hero in League of Legends or a unit in Starcraft. Each skill the agent has access to is a clickable ability with an icon, cooldown indicator, and hotkey.

This replaces "type a natural language prompt hoping the agent knows what to do" with **click the damn button**.

### Ability Bar Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  SELECTED: Writer-01 [speakeasy-agent]                    Level 3  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Q]           [W]           [E]           [R]           [T]        │
│  ┌─────┐      ┌─────┐      ┌─────┐      ┌─────┐      ┌─────┐     │
│  │ 📝  │      │ 🎯  │      │ 🔍  │      │ ⚡  │      │ 💀  │     │
│  │ LI  │      │ TW  │      │ QUAL │      │ WEEK │      │ ULT  │    │
│  │POST │      │POST │      │AUDIT │      │BATCH │      │      │    │
│  └─────┘      └─────┘      └─────┘      └─────┘      └─────┘     │
│  Ready         Ready        2:30 CD       Ready        14:00 CD    │
│                                                                     │
│  [D]           [F]           [PASSIVE]                              │
│  ┌─────┐      ┌─────┐      ┌─────────────────────┐                │
│  │ 🖼️  │      │ 📊  │      │ Auto quality check   │                │
│  │IMAGE│      │CARSL│      │ on every post (free)  │                │
│  └─────┘      └─────┘      └─────────────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Ability Types

| Type | RTS Equivalent | Example | Behavior |
|------|---------------|---------|----------|
| **Basic (Q/W/E)** | Standard abilities | Generate LinkedIn Post | Single execution, short cooldown |
| **Combo (D/F)** | Utility abilities | Generate Image, Generate Carousel | Can chain with basic abilities |
| **Ultimate (R)** | Ultimate ability | Week Batch (plan + generate 7 days) | Long cooldown, high impact, expensive |
| **Passive** | Passive ability | Auto quality check on every output | Always active, no click needed |

### Cooldowns

Cooldowns are **real**, not cosmetic:
- **Token-based**: Ability costs X tokens. If unit is low on context, ability grayed out.
- **Time-based**: Some abilities have minimum intervals (don't spam 10 LinkedIn posts in 5 min).
- **Dependency-based**: Some abilities require another to be used first (can't generate carousel without content).

### Skill Builds — Unit Loadouts

Each unit type has a default skill loadout, but skills can be reassigned:

**Writer Build (Content DPS):**
```
Q: Generate LinkedIn Post
W: Generate Twitter Post
E: Quality Audit
R: Week Batch (ULT)
D: Generate Image
F: Generate Carousel
Passive: Auto quality check
```

**Scout Build (Intel Gatherer):**
```
Q: YouTube Research
W: Competitor Analysis
E: Analytics Check
R: Full Market Sweep (ULT)
D: Trend Jacking
F: Find Discussions
Passive: Auto-alert on spikes
```

**Engineer Build (Builder):**
```
Q: Create Skill
W: Build MCP Server
E: Test Skill
R: Full Product Build (ULT)
D: Package Plugin
F: Deploy to Vercel
Passive: Auto-validate on save
```

**Diplomat Build (Sales):**
```
Q: Prep Call Brief
W: Draft Proposal
E: Analyze Calls
R: Full Pipeline Review (ULT)
D: Customer Response
F: Meeting Prep
Passive: Auto-flag stale leads
```

### Clicking an Ability

1. Player selects unit
2. Player clicks ability (or presses hotkey Q/W/E/R/D/F)
3. If ability needs parameters → small modal: "Topic?" / "Client?" / "Target?"
4. Click fires the corresponding skill as a prompt to the unit's tmux session
5. Ability enters cooldown state (grayed, timer counting down)
6. When agent completes → cooldown resets, success particle burst on unit

### Leveling / Upgrades

Units gain XP from completing tasks. Higher level = more abilities unlocked:

```
Level 1: Q, W only
Level 2: + E ability
Level 3: + D, F abilities
Level 4: + Passive
Level 5: + R (Ultimate) unlocked
```

XP tracked per unit in `ae_sessions.xp` column. Purely a visualization/gamification layer — the underlying Claude session doesn't change. But it gates which buttons appear, preventing overwhelm with new units.

### Skill Discovery

New skills can be "researched" by Engineer units:
1. Engineer uses "Create Skill" ability
2. Skill gets created in the workspace
3. New ability icon appears in the skill registry
4. Can be assigned to any unit's loadout

This is the **tech tree** — Engineers unlock new abilities that other unit types can equip.

---

## 3. Art Direction — Advance Wars 3D vs. Starcraft/Warhammer

### The Question

Two aesthetic directions to explore. Build both as swappable themes.

### Option A: Advance Wars 3D

**The vibe:** Advance Wars / Into the Breach / Fire Emblem meets holographic command center. Clean, readable, toybox-military. Isometric 3/4 view. Bright but not childish.

**Visual characteristics:**
- Chunky, stylized unit sprites (not pixel art, not realistic — toy soldier scale)
- Clean terrain with distinct biomes per territory (grass for lead-gen, urban for sales, etc.)
- Weather effects per territory state (rain on threatened territories, sunshine on productive ones)
- Grid visible but subtle — square grid, not hex
- UI: clean, rounded corners, bold colors, easy to read at a glance
- Animations: snappy, exaggerated, satisfying (think Advance Wars attack animations)
- Camera: fixed isometric angle, zoom only (no rotation)

**Pros:**
- More readable at strategic zoom levels
- Easier to create distinct unit silhouettes
- Friendlier — better for demos and screenshots
- Advance Wars aesthetic is beloved and underused
- 3D isometric = depth without full 3D complexity

**Cons:**
- Less "serious" feel
- May not match the "war room" intensity of the vision doc
- Could feel game-y rather than tool-y

**Implementation:**
- PixiJS with isometric projection (current ISO_TILT approach works)
- Pre-rendered 3D sprites (render in Blender, export as sprite sheets)
- Or: real-time 3D with Three.js for units only, PixiJS for terrain/UI
- Terrain: tile-based with elevation, Advance Wars style biomes

### Option B: Starcraft / Warhammer

**The vibe:** Dark, gritty, data-dense. Current visual direction (PRD 06) pushed further. Units are abstract holographic projections. The battlefield is a war table, not a toy box.

**Visual characteristics:**
- Abstract/holographic unit representations (the current circles + glyphs, evolved)
- Dark terrain with neon data overlays (current Magnetic Residue palette)
- Particle-heavy — everything glows, pulses, streams
- No grid — freeform terrain with organic borders
- UI: angular, dark, dense, terminal-inspired
- Animations: smooth, particle-based, energy/data themed
- Camera: free pan + zoom + optional rotation

**Pros:**
- Matches the "weapon, not a toy" philosophy from PRD 06
- More impressive visually (the "wow" factor)
- Better at conveying data density
- Feels like a real command center

**Cons:**
- Harder to read at high unit counts
- More complex to build and maintain
- Can feel overwhelming
- Unit differentiation harder with abstract sprites

**Implementation:**
- Current PixiJS setup, evolved with more particle effects
- WebGL shaders for terrain (noise, flow fields)
- Holographic unit projections (animated shader effects)
- Post-processing: bloom, chromatic aberration, scanlines

### Recommended Approach: **Build Both, Ship a Toggle**

The renderer is already abstracted. Create a `ThemeManager` that swaps:
- Territory rendering style (biome tiles vs. neon terrain)
- Unit sprite sets (toy soldiers vs. holographic projections)
- Color palette (Advance Wars bright vs. Magnetic Residue dark)
- Particle style (cartoony pops vs. energy streams)
- UI skin (rounded/bold vs. angular/dark)

User toggles with a keybind (e.g., `V` for visual mode).

**Build order:**
1. Advance Wars 3D first — more readable, easier to debug, better for development
2. Starcraft/Warhammer as alternate skin — layer on after core gameplay works
3. Let user preference decide the default

### Advance Wars 3D — Detailed Spec

#### Terrain Tiles

| Territory | Biome | Tile Style |
|-----------|-------|-----------|
| HQ | Castle/Fort | Stone walls, watchtower, flag |
| Lead-Gen | Plains/Fields | Rolling green hills, scattered trees, signposts |
| Sales | Urban/Market | Buildings, market stalls, roads |
| Fulfillment | Workshop/Factory | Assembly lines, warehouses, conveyor belts |
| Support | Hospital/Outpost | Red cross tents, supply crates, radio tower |
| Retention | Castle Wall/Keep | Fortified walls, towers, moat |

Each tile is a 64x64 or 128x128 isometric sprite. Territories are composed of ~20-40 tiles each.

#### Unit Sprites (Isometric, 3/4 View)

| Unit Type | Visual | Size | Idle Animation |
|-----------|--------|------|---------------|
| Commander | General in greatcoat, star insignia | 2x | Pacing, gesturing at map |
| Lieutenant | Officer, shield emblem | 1.5x | Standing alert, scanning |
| Scout | Light gear, binoculars | 1x | Looking around, crouching |
| Writer | Quill + scroll, ink stains | 1x | Writing furiously, thinking |
| Engineer | Wrench + blueprints, goggles | 1x | Tinkering, building |
| Operative | Dark gear, crosshair visor | 1x | Stealth idle, weapon ready |
| Medic | Red cross armband, medical kit | 1x | Checking supplies, alert |
| Diplomat | Formal attire, briefcase | 1x | Reading documents, nodding |

**Attack animations** (when executing skills/tools):
- Writer: quill slashes through the air, ink splashes
- Scout: binoculars flash, data stream captures
- Engineer: wrench strikes, sparks fly, blueprint unfurls
- Commander: points sword, war cry, buff circle radiates
- Diplomat: extends hand, golden handshake wave

**Boss sprites:**
- 3-4x unit size
- Unique per territory type (Dragon for a huge objective, Fortress for infrastructure, etc.)
- Visible HP bar above
- Phase changes at 75%, 50%, 25% HP (boss gets angrier/damaged)
- Defeat: dramatic crumble/explosion, loot chest appears

#### Building Sprites

Objectives render as buildings that can be "sieged":

| HP Remaining | Visual State |
|-------------|-------------|
| 100% | Pristine building, flag flying |
| 75% | Minor damage, smoke wisps |
| 50% | Visible cracks, fires starting |
| 25% | Heavy damage, walls crumbling |
| 0% | Rubble + victory flag planted |

#### Weather / Mood

Territory state affects atmospheric rendering:

| State | Weather | Effect |
|-------|---------|--------|
| Healthy + active | Clear skies, sunbeams | Bright tiles, cheerful |
| Healthy + idle | Partly cloudy | Slightly dimmed |
| Threatened | Overcast, dark clouds | Desaturated, ominous |
| Under attack | Rain, lightning | Wet reflections, flash lighting |
| Stalled | Fog/mist | Low visibility, slow particles |
| Defeated (boss dead) | Golden hour | Warm glow, celebration particles |

---

## 4. Roadmap: Implementation Order

### Phase 1: Objective Data Layer
- `ae_objectives` + `ae_objective_assignments` Supabase tables
- Server-side objective management (create, update HP, defeat)
- WebSocket broadcast of objective state changes
- Command bar: `create boss`, `assault`, `complete` commands

### Phase 2: Objective Rendering
- Boss sprites on battlefield (placeholder rectangles initially)
- HP bars above bosses
- Dependency lines between bosses
- Status indicators (blocked/active/stalled)
- Defeat animation

### Phase 3: Skill/Ability Bar
- Ability bar UI component (HTML overlay, like resource bar)
- Skill registry (map unit types → available abilities)
- Click-to-cast: ability click → prompt to agent session
- Cooldown tracking and display
- Hotkey bindings (Q/W/E/R/D/F)

### Phase 4: Advance Wars Art Pass
- Isometric terrain tiles (sprite sheets)
- Unit sprite sheets (idle + working + attack + defeat per type)
- Building sprites (pristine → rubble, 5 damage states)
- Weather particle system per territory
- Camera: lock to isometric angle

### Phase 5: Starcraft/Warhammer Alternate Skin
- ThemeManager toggle system
- Holographic unit variants
- Neon terrain shader
- Dark UI skin swap
- Particle style variants

### Phase 6: Feed Integration
- Scratchpad → objective sync
- Meeting transcript → action item extraction → boss creation
- Bootcamp manifest → full campaign auto-generation
- Competitor intel → threat boss creation

---

## 5. Territory Production View (Factorio Mode)

### Core Concept

Clicking a territory doesn't open a dashboard panel. It zooms into the territory and reveals the **production chain** — inputs, processing nodes, outputs, throughput rates, and bottlenecks. The dashboard IS the map. You see where things are backed up the same way you see a Factorio belt overflowing.

This is the "map of a dashboard" — not charts in a sidebar, but the territory itself becomes a living schematic of how that business domain operates.

### Zoom Levels

| Zoom | What You See |
|------|-------------|
| **Strategic** (default) | Territories, units, roads, bosses. High-level overview. |
| **Tactical** (click territory) | Production chain view. Nodes, connections, throughput numbers, bottlenecks. |
| **Operational** (click node) | Detail panel for that specific metric. Historical chart, agent assignments, actions. |

### Territory Production Chains

Each territory has a defined flow of inputs → processing → outputs:

**Lead-Gen Territory:**
```
[Content Published] → [Impressions] → [Visitors] → [Subscribers] → [Waitlist]
     12/week            3.2K/week       890/week      67/week        41/week
                                                         ↑
                                                    BOTTLENECK
                                                   (7.5% conv,
                                                    target: 12%)
```

**Sales Territory:**
```
[Leads In] → [Call Booked] → [Proposal Sent] → [Negotiation] → [Closed Won]
  41/week      12/week          8/week            3/week         2/week
                                   ↑
                              BOTTLENECK
                            (15 proposals aging >7d,
                             avg close time: 23d)
```

**Fulfillment Territory:**
```
[New Students] → [Onboarded] → [Session Attendance] → [Completion] → [NPS Score]
   8/cohort        8/cohort        85% avg              72%            4.3/5.0
                                                          ↑
                                                     BOTTLENECK
                                                    (target: 80%,
                                                     drop at Session 4)
```

**Support Territory:**
```
[Tickets In] → [First Response] → [Resolution] → [Satisfaction]
   14/week       avg 2.4h           avg 18h          4.1/5.0
                                       ↑
                                  BOTTLENECK
                                 (3 tickets >48h,
                                  target: <24h)
```

**Retention Territory:**
```
[Active Clients] → [Renewal Pipeline] → [Upsell Candidates] → [Churn Risk]
     34                12 due next 30d      5 identified         2 flagged
                                                                    ↑
                                                               BOTTLENECK
                                                              (2 no contact
                                                               in 14+ days)
```

### Visual Language

**Nodes** = processing stations (small building/machine sprite):
- Size scales with throughput volume
- Color: green (healthy), amber (warning), red (bottleneck)
- Number overlay showing current throughput
- Animated if actively being worked by agents

**Connections** = pipes/belts between nodes:
- Width = throughput volume (thin=low, thick=high)
- Color gradient from source node color to destination node color
- Animated flow particles (like road marching dots, but between nodes)
- Backed-up connection: particles pile up at the destination node

**Bottleneck indicators:**
- Red glow + pulse on the constrained node
- "Backed up" particle pile animation (like Factorio belt overflow)
- Floating label: current metric vs. target (e.g., "7.5% / 12% target")
- Suggested action tooltip: "Deploy Writer to increase content output"

**Agent positions in production view:**
- Units working in this territory appear next to the node they're affecting
- Writer near the "Content Published" node
- Scout near the "Impressions" node
- Diplomat near the "Negotiation" node
- Shows which stations have workers and which are unmanned

### Data Sources per Node

Each node maps to a real metric query:

| Node | Data Source | Query |
|------|-----------|-------|
| Content Published | Supabase `content_log` | `count WHERE status='published' AND created > interval` |
| Impressions | Shield API (LinkedIn) | Hourly poll, cached in `ae_intel` |
| Subscribers | Kit API | `kit-subscribers` edge function |
| Revenue | Stripe/SamCart | Webhook → `ae_intel` |
| Tickets | Supabase or Slack | Channel activity or support table |
| NPS | Supabase `feedback` | `avg(score)` |
| Call Booked | Google Calendar | Calendar events with "call" keyword |

### Bottleneck Detection Algorithm

```typescript
interface ProductionNode {
  id: string
  territory: TerritoryId
  name: string
  metric: number          // current throughput
  target: number          // expected throughput
  capacity: number        // max possible throughput
  inputNodes: string[]    // upstream node IDs
  outputNodes: string[]   // downstream node IDs
}

function detectBottleneck(nodes: ProductionNode[]): ProductionNode | null {
  // A bottleneck is the node with the worst ratio of actual/target
  // that has sufficient input (upstream isn't the real problem)
  let worstRatio = Infinity
  let bottleneck: ProductionNode | null = null

  for (const node of nodes) {
    const ratio = node.metric / node.target
    if (ratio < worstRatio && ratio < 0.8) {
      // Check upstream: if input is also starved, the bottleneck is upstream
      const upstreamHealthy = node.inputNodes.every(id => {
        const upstream = nodes.find(n => n.id === id)
        return upstream ? (upstream.metric / upstream.target) > 0.8 : true
      })
      if (upstreamHealthy) {
        worstRatio = ratio
        bottleneck = node
      }
    }
  }
  return bottleneck
}
```

The bottleneck always points to where YOU need to act — not where the upstream failure is cascading. If content output is low because you haven't published, the bottleneck is "Content Published." If content output is fine but conversion is bad, the bottleneck is "Visitors → Subscribers."

### Implementation Path

1. Define production chain schemas per territory (JSON config)
2. Create `ProductionChainRenderer` (PixiJS, draws nodes + connections + flow)
3. Wire to strategic zoom: click territory → transition to production view
4. Wire data sources (start with mock data, replace with real queries)
5. Bottleneck detection algorithm running on 60s poll
6. Agent position overlay (show which agents are affecting which nodes)

### The Factorio Principle

> "The factory must grow."

In Factorio, you never look at a spreadsheet to find the bottleneck. You look at the MAP. You see the belt backed up, the furnace starved, the inserter idle. The fix is obvious from the visual.

Agent Empires applies the same principle: you never look at a Google Analytics dashboard to find your business bottleneck. You look at the MAP. You see the lead-gen funnel backed up at conversion, the sales pipeline starved at proposals, the support queue overflowing. The fix is obvious — deploy an agent to the red node.

---

## 6. Open Questions

1. **Sprite source**: AI-generated sprite sheets (fast, custom) vs. asset pack (consistent, limited) vs. commissioned pixel art (highest quality, slow)?
2. **3D or fake-3D**: Real Three.js for units in isometric view, or pre-rendered isometric sprites in PixiJS? Pre-rendered is simpler but less dynamic.
3. **Ability parameters**: When clicking an ability that needs input (e.g., "Generate LinkedIn Post" needs a topic), use inline command bar input or a small modal?
4. **Ultimate cooldowns**: Real time-based (24h for Week Batch) or token-based (costs 50K tokens)?
5. **Boss auto-generation**: How aggressive? Auto-create bosses from every Scratchpad task, or require manual creation for anything above mini-boss?
6. **Theme default**: Ship with Advance Wars by default (more accessible) or Starcraft (matches current aesthetic)?

---

## 7. The Bootcamp Factory Connection

The Bootcamp Factory PRD describes a 42-agent, 7-phase overnight build. In Agent Empires, this becomes:

```
CAMPAIGN: "Build [Client Name] Bootcamp"
│
├── BOSS: "Manifest Validation" (hq, HP=1, Phase 0)
│
├── BOSS: "Copy Bible + Hub Scaffold" (fulfillment, HP=3, Phase 1)
│   └── depends: Manifest Validation
│
├── BOSS: "Copy Generation" (fulfillment, HP=15, Phase 2)
│   └── depends: Copy Bible
│
├── BOSS: "Quality Gate" (hq, HP=3, Phase 3)
│   └── depends: Copy Generation
│
├── BOSS: "Build & Deploy" (lead-gen + sales, HP=11, Phase 4)
│   └── depends: Quality Gate
│
├── BOSS: "Infrastructure" (support + lead-gen, HP=5, Phase 5)
│   └── depends: Build & Deploy
│
└── BOSS: "Final Validation" (hq, HP=4, Phase 6)
    └── depends: Infrastructure
```

One `create campaign from:bootcamp-manifest.json` command generates all of this. You watch 42 agents siege 7 bosses overnight. Morning audit = checking which bosses are defeated and which stalled.

**This is the killer demo.** "I went to sleep and my agents defeated 7 bosses while I was gone. Here's the morning audit."

---

*Last updated: 2026-03-10*
*Next: Implement Phase 1 (Objective Data Layer) + Phase 3 (Ability Bar prototype)*
