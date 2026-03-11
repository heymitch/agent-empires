# Agent Empires — PRD 14: Objectives, Skills, Art, and Production

> Goals are bosses. Tasks are HP. Skills are abilities. Territory = Factorio factory.

Status legend: **[SHIPPED]** = code exists and compiles. **[OPEN]** = not yet built.

---

## 1. Objective System — Goals as Bosses

### Core Concept

Business objectives are **bosses on the battlefield** — visible structures in their territory that you assault with Claw squads. Each boss has HP equal to the number of sub-tasks required to complete it. Deploying agents drains HP. Boss dies when HP hits 0.

### Shipped Components

**[SHIPPED] ObjectiveManager** (`server/ObjectiveManager.ts`)
- Full CRUD: `createObjective`, `getObjective`, `getObjectives`, `getCampaignObjectives`
- HP management: `updateHP` with auto-status transitions (unassaulted -> under_attack -> defeated)
- Status management: `updateStatus`, `defeatObjective`
- Agent assignment: `assignAgent` with `ae_objective_assignments` tracking
- 30-second polling with WebSocket broadcast to all clients
- Cached accessor: `getLastObjectives()` for sync reads

**[SHIPPED] ObjectiveRenderer** (`src/renderer/ObjectiveRenderer.ts`)
- PixiJS v8 container-based rendering on `battlefield.roadLayer`
- Building sprites with status-based colors (gray/dark/red/amber/green)
- HP bars with color transitions: green (>50%) -> yellow (25-50%) -> red (<25%)
- HP-based damage states: cracks at 75%, 50%, 25%, rubble at 0%
- Defeated state: rubble + victory flag
- Blocked overlay: darkened building with 40% opacity black fill
- Dependency lines: dotted red (blocked) / solid green with arrow (unlocked)
- Animations: pulse on under_attack, flash on stalled, shake + particle burst on defeat
- Multi-objective territory placement with 8-position offset array
- Wired into main.ts game loop: `objectiveRenderer.update(dt)` called every frame
- WebSocket handler routes `objectives` messages to `objectiveRenderer.updateObjectives()`

**[SHIPPED] Supabase Tables**
```sql
ae_objectives (id, campaign_id, name, description, territory, hp_total, hp_remaining,
               status, dependencies, sub_tasks, priority, created_at, defeated_at, metadata)
ae_objective_assignments (id, objective_id, session_id, assigned_at, hp_drained)
```

**[SHIPPED] HTTP Endpoints** (in `server/index.ts`)
- `GET /objectives` — list all non-archived objectives
- `GET /objectives/:campaignId` — objectives for a specific campaign
- `POST /objectives` — create new objective (requires name, territory, hp_total)
- `PATCH /objectives/:id/hp` — update HP with delta
- `PATCH /objectives/:id/status` — set status (validates against allowed values)
- `POST /objectives/:id/assign` — assign an agent session to an objective
- `POST /objectives/seed` — generate sample campaign with 5 bosses across territories **[NEW]**

### Boss Lifecycle

```
UNASSAULTED -> UNDER_ATTACK -> DEFEATED -> ARCHIVED
                    |
                BLOCKED (dependency not met)
                STALLED (no agents assigned, timer running)
```

### HP Mechanics

Each boss HP = discrete sub-task count. HP drain events:
- Agent completes a task -> -1 HP via `PATCH /objectives/:id/hp`
- Manual via command bar -> -1 HP
- Webhook event -> -1 HP
- Auto-transition: HP reaches 0 -> status = defeated, defeated_at = now()

### Open Items

- **[OPEN] Real objective feeding**: Scratchpad.md parser, meeting transcript extractor, bootcamp manifest importer
- **[OPEN] Auto-assignment**: Match agents to objectives by territory and unit type
- **[OPEN] Objective completion triggers**: Webhook integration for SamCart, Kit, Stripe events
- **[OPEN] Command bar integration**: `create boss`, `assault`, `complete` commands in CommandRouter
- **[OPEN] Stalled detection**: Timer-based auto-transition to STALLED after 30min inactivity

---

## 2. Skill System — Abilities as RTS Abilities

### Core Concept

Select a Claw unit, the bottom of the screen shows its **ability bar** with clickable abilities mapped to Q/W/E/R/D/F. Click fires a slash command to the agent's tmux session.

### Shipped Components

**[SHIPPED] SkillRegistry** (`src/game/SkillRegistry.ts`)
- 30 skills across 5 unit types (6 active + 1 passive each)
- Unit types: Writer, Scout, Engineer, Commander, Diplomat
- Each skill has: id, name, icon (emoji), hotkey, cooldownMs, description, slashCommand, category
- `needsInput` flag + `inputPlaceholder` for parameterized skills
- Lookup functions: `getLoadoutForUnit`, `getSkillsForUnit`, `getSkillById`, `getSkillByHotkey`
- Unit type inference from session name: `inferUnitType()` with regex patterns

**Skill loadouts as shipped:**

| Unit | Q | W | E | R (Ult) | D | F | Passive |
|------|---|---|---|---------|---|---|---------|
| Writer | LinkedIn Post (45s) | Twitter Post (30s) | Quality Audit (60s) | Week Batch (300s) | Gen Image (45s) | Carousel (60s) | Auto Quality Check |
| Scout | YT Research (60s) | Analytics (45s) | Discussions (45s) | Market Sweep (600s) | Trend Jack (45s) | Chan Digest (60s) | Auto-Alert Spikes |
| Engineer | Create Skill (60s) | Build MCP (90s) | Test Skill (45s) | Full Build (600s) | Package (60s) | Deploy (90s) | Auto-Validate |
| Commander | Briefing (60s) | Queue (45s) | EOD Report (60s) | Campaign (600s) | Broadcast (30s) | Assign Task (30s) | Strategic Overview |
| Diplomat | Prep Call (60s) | Analyze Calls (90s) | Response (30s) | Pipeline (600s) | Meeting Prep (60s) | Proposal (90s) | Auto-Flag Stale |

**[SHIPPED] CooldownManager** (`src/game/CooldownManager.ts`)
- Per-unit, per-skill independent cooldown timers (in-memory, no persistence needed)
- `startCooldown`, `isOnCooldown`, `getRemainingMs`, `getCooldownFraction`
- Human-readable formatting: `formatRemaining()` -> "2:30" or "45s"
- Reset: per-skill or per-unit bulk reset
- Listener system: `onChange(callback)` for UI updates

**[SHIPPED] AbilityBar** (`src/hud/AbilityBar.ts`)
- HTML overlay positioned bottom-center of screen via `#main-area`
- Shows on unit select, hides on deselect
- 6 skill slots with emoji icons, names, hotkey labels
- Cooldown overlays with CSS custom property `--cd-fraction` for sweep animation
- `requestAnimationFrame` loop for live cooldown countdown
- Click-to-cast: fires `POST /sessions/:id/prompt` with slash command
- Parameter input modal: appears for skills with `needsInput: true`
- ESC to cancel, Enter to cast from modal
- Low-health detection: ultimate grayed out when <10% context remaining
- Sound effects: `command_sent` on cast, `error` on blocked
- Casting flash animation on the slot element
- Hotkey handling: Q/W/E/R/D/F consumed when ability bar is visible
- Full CSS in `src/styles/agent-empires.css` (~150 rules covering all states)

### Open Items

- **[OPEN] Skill execution backend**: Slash commands are POSTed to `/sessions/:id/prompt` but the actual command routing to real tools is not wired
- **[OPEN] Skill leveling**: XP system gating ability unlocks (Level 1-5 progression)
- **[OPEN] Skill discovery**: Engineer "Create Skill" producing new entries in the registry
- **[OPEN] Dependency-based cooldowns**: E.g., can't cast Carousel without prior content

---

## 3. Art Direction

### Shipped Assets

**[SHIPPED] 4 HTML sprite generators** (`assets/sprites/` + `scripts/`)
- `unit-sprites.html` — p5.js generator for all unit types (Writer, Scout, Engineer, Commander, Diplomat, etc.) with Anthropic-themed color palette
- `boss-buildings.html` — p5.js generator for boss building sprites with red enemy treatment, evil eyes, scale-by-HP tiers (128/192/256/320px), damage states
- `ability-icons.html` — Canvas-based ability icon generator for all 30 skills, organized by unit type
- `export-sprites.html` — JSZip-based export pipeline, bulk exports all sprite sheets as PNGs in a downloadable ZIP

### Current Aesthetic

The live renderer uses **procedural Graphics-drawn shapes** (PixiJS v8 Graphics API), not sprite textures:
- Units: colored circles with glyph overlays (holographic/abstract style)
- Bosses: rectangular buildings with roof triangles, status-colored borders, crack overlays
- Terrain: organic polygon territories with gradient fills (Magnetic Residue palette)

### Art Gap

**[OPEN] Sprite texture loading**: The HTML generators produce PNG sprite sheets, but these are NOT loaded into PixiJS as `Texture` objects. The renderers draw everything procedurally. Bridging this gap means:
1. Export PNGs from the HTML generators (or commit pre-exported PNGs)
2. Load as PixiJS `Assets.load()` textures
3. Replace `Graphics` drawing with `Sprite` rendering in ObjectiveRenderer, UnitRenderer, etc.

### Design Direction: Holographic War Room (current default)

Dark terrain, neon data overlays, particle-heavy, angular UI. Matches the "weapon, not a toy" philosophy. All current rendering code targets this direction.

---

## 4. Roadmap — What's Done, What's Next

| Phase | Scope | Status |
|-------|-------|--------|
| 1. Objective Data Layer | Supabase tables, ObjectiveManager, HTTP endpoints, WebSocket broadcast | **SHIPPED** |
| 2. Objective Rendering | Building sprites, HP bars, dependency lines, defeat animation, status visuals | **SHIPPED** |
| 3. Skill/Ability Bar | AbilityBar UI, SkillRegistry (30 skills), CooldownManager, hotkeys, input modal | **SHIPPED** |
| 4. Production Chains | ProductionChainRenderer, ProductionDataManager, mock data, bottleneck detection | **SHIPPED** |
| 5. Sprite Art Pass | PNG texture loading, replace procedural drawing with real sprites | OPEN |
| 6. Feed Integration | Scratchpad sync, meeting extraction, manifest import, webhook triggers | OPEN |
| 7. Skill Execution | Wire slash commands to real agent sessions, parameter routing | OPEN |
| 8. Leveling & XP | Unit XP tracking, ability unlock gating, visual level indicators | OPEN |

---

## 5. Territory Production View (Factorio Mode)

### Shipped Components

**[SHIPPED] Production Chain Definitions** (`shared/productionChains.ts`)

5 territory chains with 23 total nodes:

**Lead-Gen** (5 nodes): Content Published -> Impressions -> Visitors -> Subscribers -> Waitlist
- Data sources: supabase:content_log, shield, manual, kit-subscribers, kit-subscribers
- Targets: 12/wk, 5000/wk, 1200/wk, 80/wk, 50/wk

**Sales** (5 nodes): Leads In -> Call Booked -> Proposal Sent -> Negotiation -> Closed Won
- Data sources: kit-subscribers, calendar, manual, manual, stripe
- Targets: 40/wk, 12/wk, 8/wk, 5 active, 3/wk

**Fulfillment** (5 nodes): New Students -> Onboarded -> Session Attendance -> Completion -> NPS Score
- Data sources: stripe, manual, manual, manual, supabase:feedback
- Targets: 10/cohort, 10/cohort, 90%, 80%, 4.5/5

**Support** (4 nodes): Tickets In -> First Response -> Resolution -> Satisfaction
- Data sources: supabase:support (x3), supabase:feedback
- Targets: 15/wk, 2h avg, 18h avg, 4.5/5
- Note: Response and Resolution use `invertHealth` (lower = better)

**Retention** (4 nodes): Active Clients -> Renewal Pipeline + Upsell Candidates + Churn Risk
- Data sources: all manual
- Targets: 40, 15 due, 8 identified, 0 flagged
- Note: Churn Risk uses `invertHealth`, branches from Active Clients to both Upsell and Churn

**[SHIPPED] ProductionDataManager** (`server/ProductionDataManager.ts`)
- Mock data engine: sin waves + dual-frequency noise per node for realistic variation
- Seeded bottlenecks: lg-subscribers (62%), sl-proposals (55%), sp-resolution (145% of target), rt-churn (250%)
- `buildNodeState()`: calculates healthRatio with `invertHealth` support for "lower is better" metrics
- Health thresholds: >0.8 = healthy, 0.6-0.8 = warning, <0.6 = bottleneck
- `detectBottleneckForChain()`: finds worst-ratio node whose upstream is healthy (the REAL bottleneck, not cascade)
- `generateSuggestion()`: 23 node-specific human-readable suggestions (e.g., "Deploy Writer agents to increase content output")
- 30-second polling with WebSocket broadcast per territory
- Manual override: `updateNodeMetric(nodeId, value)` for injecting real data

**[SHIPPED] ProductionChainRenderer** (`src/renderer/ProductionChainRenderer.ts`)
- PixiJS v8 rendering on `battlefield.productionLayer`
- Node sprites with health-based coloring (green/amber/red)
- Connection lines with animated flow particles
- Bottleneck indicator: red glow + pulse + floating label
- Wired into main.ts: receives `production` WebSocket messages, caches per-territory

**[SHIPPED] Bottleneck Detection Algorithm** (as implemented in ProductionDataManager)
```
For each node in chain:
  if healthRatio < 0.8:
    check all upstream inputs
    if all upstream healthRatio > 0.8:
      this is the real bottleneck (not a cascade)
  return node with worst ratio that passes upstream check
```

### Open Items

- **[OPEN] Real data sources**: Wire Kit subscribers API, Stripe webhooks, Supabase content_log queries, Shield API
- **[OPEN] Operational zoom**: Click a node -> detail panel with historical chart and agent assignments
- **[OPEN] Agent positioning**: Show which agents are near which production nodes

---

## 6. Resolved Questions

| Question | Resolution |
|----------|-----------|
| Ability parameters | Small modal with text input. Shipped in AbilityBar with ESC/Enter support. |
| Ultimate cooldowns | Time-based (300s for Writer Week Batch, 600s for others). Token check only gates display. |
| Sprite source | HTML/Canvas generators (p5.js + Canvas API). Fast iteration, custom to our palette. |
| Theme default | Holographic war room (dark/neon) is the shipped default. Advance Wars as future alt skin. |

### Remaining Open Questions

1. **Boss auto-generation**: How aggressive? Manual-only for now, add Scratchpad sync later.
2. **Sprite loading**: When to replace procedural Graphics with texture Sprites? After core gameplay stabilizes.
3. **Skill execution routing**: POST to `/sessions/:id/prompt` exists — need the server to actually dispatch to tmux.

---

## 7. Bootcamp Factory Connection

Campaign template maps bootcamp phases to objective chains:

```
CAMPAIGN: "Build [Client] Bootcamp"
  Phase 0: "Manifest Validation"      (hq, HP=1)
  Phase 1: "Copy Bible + Scaffold"    (fulfillment, HP=3, depends: Phase 0)
  Phase 2: "Copy Generation"          (fulfillment, HP=15, depends: Phase 1)
  Phase 3: "Quality Gate"             (hq, HP=3, depends: Phase 2)
  Phase 4: "Build & Deploy"           (lead-gen, HP=11, depends: Phase 3)
  Phase 5: "Infrastructure"           (support, HP=5, depends: Phase 4)
  Phase 6: "Final Validation"         (hq, HP=4, depends: Phase 5)
```

### Next Steps

- **[OPEN]** `POST /campaigns/from-template` endpoint accepting a bootcamp-manifest.json
- **[OPEN]** Auto-generate all objectives with dependency chains from template
- **[OPEN]** `create campaign from:bootcamp-manifest.json` command bar integration

The killer demo: "I went to sleep and my agents defeated 7 bosses while I was gone."

---

*Last updated: 2026-03-10*
*Shipped: Objectives (data + render), Skills (30 abilities + UI), Production (5 chains + bottleneck detection), Art generators (4 HTML tools)*
