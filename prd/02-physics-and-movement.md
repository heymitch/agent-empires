# Agent Empires — Physics & Movement System

## PRD 02: How Things Move, Fight, and Build

> ### Status Summary (2026-03-10)
>
> **Assessment:** Core movement, terrain, fog, roads, combat animations, and resource bar are all shipped. Hex pathfinding (A*) and formation system are not yet implemented.
>
> - [x] **World geometry / territories** — `src/renderer/TerrainRenderer.ts`, `src/renderer/TerritoryRenderer.ts`
> - [x] **Unit rendering & positioning** — `src/renderer/UnitRenderer.ts`
> - [x] **Movement system** — `src/game/MovementManager.ts`
> - [x] **Fog of war** — `src/renderer/FogOfWar.ts`, `src/renderer/FogRenderer.ts`
> - [x] **Road rendering (tiered)** — `src/renderer/RoadRenderer.ts`, `server/RoadAggregator.ts`
> - [x] **Combat animations (tool calls)** — `src/game/CombatAnimator.ts`
> - [x] **Resource bar (tokens, units, score)** — `src/hud/ResourceBar.ts`
> - [x] **Minimap** — `src/renderer/MinimapRenderer.ts`
> - [x] **Particle system** — `src/renderer/ParticleSystem.ts`
> - [x] **Screen effects** — `src/renderer/ScreenEffects.ts`
> - [x] **Territory detection** — `server/TerritoryDetector.ts`
> - [ ] **Hex pathfinding (A*)** — no A*/pathfinding implementation found in src
> - [ ] **Formations / control groups** — `02f-formation-spec.md` still TODO
> - [ ] **Sound design** — `02e-sound-design-spec.md` still TODO (audio infra exists in `src/audio/` but no terrain/combat sounds)

**Depends on:** `01-vision.md`
**Sub-specs:** `02a-intel-pipeline-spec.md`, `02b-enemy-system-spec.md`, `02c-combat-and-roads-spec.md`

---

## 1. Core Principle: The Map IS the Business

The battlefield isn't a metaphor laid on top of data. The map IS the data. Every pixel of terrain, every road, every fogged zone represents something real. Movement through the map is movement through problem space.

| Map Property | Business Reality |
|---|---|
| Distance between points | Complexity/effort of a task |
| Terrain type | Nature of the work |
| Fog of war | What you don't know |
| Roads | Established workflows (skills executed repeatedly) |
| Unit position | What an agent is currently working on |
| Enemy position | Where problems exist (whether you see them or not) |
| Resource nodes | Opportunities waiting to be captured |
| Elevation | Strategic importance (high ground = leverage) |

**The fundamental insight**: When you issue an order and watch your unit march across the map, encounter terrain, engage an enemy, and claim territory — you're watching a Claude Code session load context, execute tools, produce output, and complete a task. The physics make the invisible visible and the abstract visceral.

---

## 2. World Geometry

### Map Dimensions

The world is a fixed-size 2D plane rendered in PixiJS:

```
World: 6000 x 4000 logical pixels
Hex grid: pointy-top hexagons, 40px radius
Grid dimensions: ~150 columns x 100 rows = ~15,000 hexes
Viewport: user's browser window (typically 1920x1080)
Zoom range: 0.3x (strategic overview) to 5x (unit close-up)
```

Why hexes: carried from Vibecraft's aesthetic, and hexes have uniform adjacency (6 neighbors, all equidistant) which makes pathfinding cleaner and movement more natural than square grids.

### Territory Layout

Six primary territories arranged in a strategic layout with natural chokepoints:

```
                    ┌─────────────────┐
                    │   LEAD-GEN      │
                    │   (The Frontier) │
                    │   ~open fields~  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────┴───────┐  ┌──┴──────────┐  ┌┴───────────────┐
     │  CONTENT        │  │   SALES     │  │  FULFILLMENT   │
     │  (The Plains)   │  │  (The Pass) │  │  (The Citadel) │
     │  ~grassland~    │  │  ~canyon~   │  │  ~fortress~    │
     └────────┬───────┘  └──┬──────────┘  └┬───────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴────────┐
                    │    SUPPORT      │
                    │  (The Marshes)  │
                    │   ~swampland~   │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │   RETENTION     │
                    │  (The Walls)    │
                    │   ~ramparts~    │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │      HQ         │
                    │  (The Keep)     │
                    │  ~castle/base~  │
                    └─────────────────┘
```

**Why this layout:**
- Lead-Gen is at the FRONTIER — it's where you push outward, claim new territory, encounter unknowns
- Content is the PLAINS — fast, open, productive but exposed
- Sales is the PASS — a chokepoint, everything flows through conversion
- Fulfillment is the CITADEL — fortified, structured, where you deliver
- Support is the MARSHES — hard to navigate, draining, enemies spawn here naturally
- Retention is the WALLS — defensive position, you're protecting what you've built
- HQ is the KEEP — your base, where commanders sit, where the score lives

Traffic flows naturally: leads come in from the frontier, move through content/sales, convert in the pass, get fulfilled in the citadel. Support and retention are the defensive lines. This mirrors the actual customer journey.

### Hex Properties

Every hex on the map has properties:

```typescript
interface HexCell {
  q: number                    // Axial coordinate
  r: number                    // Axial coordinate
  territory: TerritoryId       // Which domain this belongs to
  terrain: TerrainType         // Affects movement and combat
  elevation: number            // 0-3 (affects visibility and defense)
  fogLevel: number             // 0.0 (clear) to 1.0 (full fog)
  roadLevel: RoadLevel         // none, trail, dirt, paved, highway
  occupants: string[]          // Unit/enemy IDs currently here
  resourceNode?: ResourceNode  // If this hex has a resource
  lastScouted: number          // Timestamp of last intel update
  threatLevel: number          // 0.0 (safe) to 1.0 (dangerous)
}

type TerrainType =
  | 'grassland'    // Content territory — fast, open
  | 'forest'       // Research areas — slow, concealed
  | 'mountain'     // Engineering/technical — slow, defensible
  | 'swamp'        // Support/bugs — draining, enemies spawn
  | 'canyon'       // Sales — narrow, high-stakes passage
  | 'fortress'     // Fulfillment — structured, protected
  | 'rampart'      // Retention — walls, defensive bonuses
  | 'keep'         // HQ — your base, fastest everything
  | 'river'        // Communication channels — fast along, slow across
  | 'bridge'       // Integration points (MCP servers) — cross rivers

type RoadLevel = 'none' | 'trail' | 'dirt' | 'paved' | 'highway'
```

---

## 3. Movement System

### Speed Model

Movement speed is calculated per-hex as the unit traverses:

```typescript
function getMovementCost(unit: Unit, hex: HexCell): number {
  const baseCost = TERRAIN_COSTS[hex.terrain]       // Base terrain cost
  const roadBonus = ROAD_MULTIPLIERS[hex.roadLevel]  // Road speed boost
  const unitMod = UNIT_SPEED_MODS[unit.type]         // Unit type modifier
  const elevationCost = hex.elevation * 0.15          // Uphill penalty

  return (baseCost - roadBonus) * unitMod + elevationCost
}
```

**Terrain Base Costs** (seconds per hex at 1x speed):

| Terrain | Cost | Feel |
|---|---|---|
| keep | 0.05 | Near instant — home turf |
| grassland | 0.2 | Quick — open ground |
| fortress | 0.25 | Moderate — structured paths |
| canyon | 0.3 | Moderate — narrow passage |
| river (along) | 0.15 | Fast — flowing with current |
| river (across) | 0.6 | Slow — fording |
| bridge | 0.1 | Fast — built crossing |
| forest | 0.4 | Slow — thick cover |
| rampart | 0.3 | Moderate — defensive terrain |
| mountain | 0.5 | Very slow — steep climb |
| swamp | 0.6 | Draining — worst terrain |

**Road Multipliers** (subtracted from base cost):

| Road Level | Speed Reduction | Visual |
|---|---|---|
| none | 0.0 | Raw terrain |
| trail | 0.05 | Faint dotted line |
| dirt | 0.1 | Visible brown path |
| paved | 0.15 | Clean stone road |
| highway | 0.2 | Glowing golden route |

**Unit Type Speed Modifiers** (multiplied with final cost):

| Unit Type | Modifier | Notes |
|---|---|---|
| Scout | 0.6x | Fastest — built for recon |
| Operative | 0.75x | Quick — light and flexible |
| Writer | 1.0x | Standard speed |
| Commander | 1.0x | Standard (but buffs nearby units) |
| Lieutenant | 0.9x | Slightly faster — field officer |
| Diplomat | 1.0x | Standard |
| Engineer | 1.3x | Slow — carrying equipment |
| Medic | 0.85x | Moderate — needs to reach wounded |

### Pathfinding

A* pathfinding on the hex grid with cost-aware routing:

```typescript
function findPath(start: HexCoord, end: HexCoord, unit: Unit): HexCoord[] {
  // A* with movement cost as edge weight
  // Prefers roads over raw terrain
  // Avoids fog hexes unless unit is a scout
  // Avoids enemy-occupied hexes unless unit is engaging
  // Returns array of hex coords to traverse
}
```

**Path visualization:**
- Selected unit shows projected path as animated dotted line
- Color-coded by terrain difficulty (green=easy, yellow=moderate, red=hard)
- Estimated time to arrival shown at endpoint
- Path recalculates in real-time as terrain/roads change

### Movement Animation

Units don't teleport between hexes. They physically traverse the path:

```typescript
interface MovementState {
  path: HexCoord[]           // Remaining hexes to traverse
  currentHex: HexCoord       // Where unit is now
  nextHex: HexCoord          // Where unit is heading
  progress: number           // 0.0-1.0 between current and next
  speed: number              // Current movement speed
  facing: number             // Direction in radians
  animState: 'marching' | 'climbing' | 'wading' | 'sprinting'
}
```

**Animation details per terrain:**
- **Grassland**: Unit sprite does a quick march, slight bob. Dust trail particles.
- **Forest**: Slower march, sprite partially occluded by tree sprites. Rustling leaf particles.
- **Mountain**: Climbing animation, sprite leans forward. Pebble particles.
- **Swamp**: Wading animation, sprite sinks slightly. Bubble particles. Screen slightly desaturates.
- **Canyon**: Normal march but walls visible on sides. Echo effect on sounds.
- **River**: Swimming/wading animation. Splash particles. Current pushes sprite if crossing.
- **Road**: Confident march, increased stride. Road glows briefly as unit passes.
- **Highway**: Sprint animation. Speed lines. Whoosh sound. Most satisfying movement.

### Movement Phases (What's Really Happening)

This is critical — movement maps to real Claude activity:

```
USER ISSUES ORDER: "Scout-01, investigate competitor launches"

Phase 1: ACKNOWLEDGE (0.3s)
  Visual: Unit turns toward destination, brief salute
  Claude: Session receives prompt, begins processing

Phase 2: DEPART (0.5s)
  Visual: Unit leaves current hex, brief acceleration
  Claude: Loading context, reading CLAUDE.md, importing skills

Phase 3: MARCH (variable — 2-15 seconds)
  Visual: Unit traverses hex path toward target area
  Claude: Executing initial tool calls (Read, Grep to gather context)
  Mapping: Each hex traversed = one context-loading operation

  The march ISN'T filler animation. Each hex the unit passes through
  represents a real preparatory step:
  - Hex 1: Reading relevant files
  - Hex 2: Searching for prior work
  - Hex 3: Loading skill instructions
  - Hex N: Ready to engage

  This means complex tasks = longer marches, which FEELS RIGHT.
  A simple edit is a 2-hex walk. A deep research mission is a 20-hex trek.

Phase 4: ARRIVE (0.3s)
  Visual: Unit reaches destination hex, plants flag/takes position
  Claude: Context fully loaded, beginning primary task execution

Phase 5: ENGAGE (variable — the bulk of the work)
  Visual: Combat/work animations (tool calls as attacks)
  Claude: Executing the actual task — writing, researching, building
  See: 02c-combat-and-roads-spec.md for full combat animation system

Phase 6: RESOLVE (0.5-2s)
  Visual: Victory/failure animation, loot drops, territory update
  Claude: Task complete, output written, session returns to idle

Phase 7: REDEPLOY or RETURN (variable)
  Visual: Unit either gets new orders or marches home
  Claude: Awaiting next prompt or entering idle state
```

**The key timing insight**: Movement duration scales with task complexity because Claude's context-loading phase IS the march. A simple "edit this line" has 2-3 preparatory Read calls = short march. A "research the competitive landscape" has 15-20 preparatory calls = long trek across the map. The physics aren't simulated — they're reflecting reality.

---

## 4. Terrain System

### Terrain Assignment

Terrain isn't random — it's determined by business domain characteristics:

| Territory | Primary Terrain | Why |
|---|---|---|
| Lead-Gen (Frontier) | Grassland + Forest edges | Open opportunity, but research (forest) on the borders |
| Content (Plains) | Grassland with scattered forest | Fast production, occasional deep-dive research |
| Sales (Pass) | Canyon | Narrow conversion funnel — everything squeezes through |
| Fulfillment (Citadel) | Fortress | Structured, protected, methodical |
| Support (Marshes) | Swamp + River | Hard, draining, enemies love it here |
| Retention (Walls) | Rampart | Defensive fortifications |
| HQ (Keep) | Keep | Your base — fastest everything |
| Borders | Forest, Mountain | Transitions between domains are harder |
| Unexplored edges | Heavy fog + Mountain | The unknown is always uphill |

### Dynamic Terrain

Terrain can change based on business state:

```typescript
interface TerrainModifier {
  trigger: string          // What causes the change
  fromTerrain: TerrainType
  toTerrain: TerrainType
  territory: TerritoryId
  duration?: number        // Temporary change (ms), or permanent
}

// Examples:
const TERRAIN_EVENTS: TerrainModifier[] = [
  {
    // When support backlog is cleared, swamp dries up
    trigger: 'support_tickets_zero',
    fromTerrain: 'swamp',
    toTerrain: 'grassland',
    territory: 'support',
    duration: undefined // permanent until tickets return
  },
  {
    // Revenue spike turns grassland into fertile territory
    trigger: 'revenue_spike',
    fromTerrain: 'grassland',
    toTerrain: 'keep', // temporarily feels like home base
    territory: 'sales',
    duration: 3600000 // 1 hour celebration
  },
  {
    // System outage turns any terrain into swamp
    trigger: 'system_outage',
    fromTerrain: '*',
    toTerrain: 'swamp',
    territory: '*',
    duration: null // until resolved
  },
  {
    // Competitor launch creates mountains in frontier
    trigger: 'competitor_launch',
    fromTerrain: 'grassland',
    toTerrain: 'mountain',
    territory: 'lead-gen',
    duration: 604800000 // 1 week, then erodes back
  }
]
```

This means the map is ALIVE. Good weeks feel different than bad weeks. The terrain shifts like weather, and you have to adapt your strategy.

### Elevation

Elevation adds a vertical dimension to the 2D map (rendered as hill shading):

| Elevation | Visual | Gameplay Effect |
|---|---|---|
| 0 (valley) | Dark shading | No bonuses, slightly concealed |
| 1 (flat) | Standard | Default — no modifiers |
| 2 (hill) | Light elevated | +1 hex vision range, slight defense bonus |
| 3 (peak) | Prominent feature | +3 hex vision, strong defense, slow approach |

Elevation creates **natural chokepoints and vantage points**:
- A scout on a hill can see further (reveals more fog)
- A unit defending a hill is harder to "attack" (tasks take longer to resolve against you)
- Valleys are fast to move through but vulnerable

### Terrain Effects on Combat

Terrain doesn't just affect movement — it modifies how well units perform tasks:

| Terrain | Combat Modifier | Reasoning |
|---|---|---|
| Grassland | 1.0x (neutral) | Standard conditions |
| Forest | 0.8x speed, +20% discovery chance | Slower but finds more |
| Mountain | 0.7x speed, +30% quality | Slow but thorough |
| Swamp | 0.6x speed, +50% token drain | Everything costs more here |
| Canyon | 1.0x speed, -20% escape chance | Committed once you enter |
| Fortress | 1.1x speed, +10% quality | Structured environment helps |
| Keep | 1.3x speed, -30% token cost | Home advantage |
| Road/Highway | +speed, no combat mods | Roads help movement, not combat |

---

## 5. Road-Building System

### The Core Loop

Roads are the most important long-term mechanic. They represent your business becoming more efficient over time.

**How roads form:**

```typescript
interface RoadTracker {
  // Key: "skillName:fromTerritory:toTerritory" or "skillName:territory"
  pathSignature: string
  executionCount: number
  lastExecuted: number
  currentLevel: RoadLevel
  decayRate: number        // Executions lost per day of inactivity
}

const ROAD_THRESHOLDS = {
  trail: 3,     // 3 executions of same workflow path
  dirt: 10,     // 10 executions
  paved: 30,    // 30 executions
  highway: 100  // 100 executions — this is a CORE workflow
}

const DECAY_RATES = {
  trail: 1,     // Loses 1 count per day unused
  dirt: 0.5,    // Loses 0.5 per day
  paved: 0.2,   // Very slow decay
  highway: 0.05 // Almost permanent — highways are earned
}
```

**What counts as an "execution":**
- Running a skill (e.g., `/content:generate-linkedin`) = 1 execution on that path
- The path is: skill type + territory where work originated
- Example: Running `/content:generate-linkedin` from the Content territory 30 times → paved road from HQ to Content
- Running `/sales:prep-call` 100 times → highway from HQ to Sales

### Road Visualization (PixiJS)

Each road level has distinct rendering:

**No Road:**
- Raw terrain texture
- Unit kicks up terrain-specific particles (dust, leaves, pebbles)

**Trail (3+ executions):**
- Faint dotted line in terrain color
- Slightly lighter texture along path
- Unit still kicks up particles but fewer

**Dirt Road (10+ executions):**
- Solid brown line, 2px wide
- Clear path through terrain
- Footprint/wheel track texture
- Units move noticeably faster

**Paved Road (30+ executions):**
- Gray stone texture, 4px wide
- Clean edges with subtle borders
- Ambient particles: occasional sparkle
- Units move confidently, increased stride

**Highway (100+ executions):**
- Golden glowing line, 6px wide
- Pulsing energy particles flowing along direction of travel
- Slight bloom/glow effect
- Units sprint with speed lines
- Satisfying whoosh sound when unit enters highway
- Visible from minimap (golden threads across the map)

### Road Network Visualization

When zoomed out to strategic view, the road network forms a visible **circulatory system** of your business:

```
Day 1:   Just HQ. Everything is wilderness.
Week 1:  Faint trails radiating from HQ to Content and Sales.
Week 2:  Dirt roads to Content. Trail to Fulfillment.
Month 1: Paved roads to Content and Sales. Dirt to Fulfillment.
         The "content machine" is visible as infrastructure.
Month 3: Highways to Content. Paved to Sales, Fulfillment.
         Your business's core workflows are VISIBLE as golden paths.
Month 6: Highway network connecting all active territories.
         The map looks like a civilization. YOU built that.
```

This progression creates a deeply satisfying sense of **empire building**. You can look at your map and SEE how efficient your business has become.

### Strategic Road Building

The user can intentionally prioritize road building:

1. **Identify bottleneck**: "Why is sales prep so slow?" (No road to Sales territory)
2. **Deploy repeatedly**: Run `/sales:prep-call` 10 times over a week
3. **Watch road form**: Trail → Dirt road appears on the map
4. **Feel the improvement**: Sales units now move 40% faster to that territory

This creates a meta-game: **which workflow do I invest in automating?** The answer is visible on the map. The parts of your business with highways are the parts that scale. The parts still in swamp with no roads are bottlenecks.

---

## 6. Time Model

### Real-Time vs Game-Time

Agent Empires runs in **real-time** — there's no speed-up or slow-down. But the *animation* of movement is compressed:

```
Real duration of a Claude task: 30 seconds to 15 minutes
Animation duration:
  - March phase: 2-8 seconds (scaled from task complexity estimate)
  - Combat phase: matches real tool call timing
  - Resolution: 0.5-2 seconds
```

**March duration estimation:**

The system estimates task complexity from the prompt and pre-allocates march time:

```typescript
function estimateMarchDuration(prompt: string, territory: Territory): number {
  // Keyword analysis for complexity signals
  const complexitySignals = [
    'research', 'analyze', 'deep dive',    // +3s
    'create', 'write', 'build',            // +2s
    'edit', 'fix', 'update',               // +1s
    'check', 'verify', 'status'            // +0s
  ]

  const baseDuration = 2 // seconds
  const complexityBonus = calculateComplexity(prompt, complexitySignals)
  const terrainMod = getTerrainCost(territory)

  return Math.min(baseDuration + complexityBonus * terrainMod, 8)
}
```

If the march finishes before Claude starts executing tools, the unit "scouts the area" (idle animation at destination). If Claude starts executing before the march ends, the march accelerates to catch up. The animation never blocks real work — it's a lens, not a gate.

### Idle Time

When a unit has no orders, it exhibits idle behavior in its current hex:

- **At HQ**: Rest animation (leaning, stretching)
- **At territory**: Patrol animation (small movements within territory)
- **On road**: Maintenance animation (improving road, subtle activity)
- **In fog**: Nervous idle (looking around, checking surroundings)

Idle units slowly "degrade" — their status ring dims from green to yellow after 5 minutes. This creates gentle pressure to keep units busy. An army of idle soldiers is a wasted army.

---

## 7. Vision and Fog of War

### Vision Range

Each unit has a vision range (in hexes) that clears fog around it:

| Unit Type | Vision Range | Notes |
|---|---|---|
| Scout | 6 hexes | Best vision — purpose-built |
| Commander | 4 hexes | Good overview |
| Lieutenant | 3 hexes | Standard field officer |
| All others | 2 hexes | Basic awareness |
| +Elevation bonus | +1-3 hexes | Hills/peaks extend vision |

### Fog States

Each hex has a fog level with three visual states:

```
UNDISCOVERED (fogLevel = 1.0):
  - Completely black/dark
  - No terrain visible
  - Enemies here are invisible
  - Can only be cleared by scout entering range

PREVIOUSLY SCOUTED (fogLevel = 0.3-0.9):
  - Terrain visible but dimmed
  - Known enemies shown as last-known-position ghosts
  - Data staleness indicated by fog thickness
  - Auto-degrades over time (data goes stale)

  fogLevel = 0.3 + (hoursSinceLastScout / maxFreshness) * 0.7
  maxFreshness varies by territory (Lead-Gen = 24h, Support = 4h)

VISIBLE (fogLevel = 0.0):
  - Full visibility, bright terrain
  - Real-time enemy positions
  - Resource nodes visible with details
  - Active within a unit's vision range OR recently scouted
```

### Fog Regrowth

Fog returns over time if a territory isn't actively monitored. This creates the **core tension**: you can't watch everything at once. You have to choose which fronts to keep illuminated.

```typescript
const FOG_REGROWTH_RATES: Record<TerritoryId, number> = {
  'lead-gen':    0.02,  // per hour — frontier shifts fast
  'content':     0.01,  // moderate — content metrics age slowly
  'sales':       0.03,  // fast — pipeline changes daily
  'fulfillment': 0.005, // slow — delivery is stable
  'support':     0.04,  // fastest — issues can emerge any time
  'retention':   0.015, // moderate — churn signals need watching
  'hq':          0.0    // never — HQ is always visible
}
```

A territory with 0.04/hour fog regrowth goes fully dark in 25 hours without a scout. This means Support needs **constant monitoring** — you either keep a scout there or accept blind spots. Lead-Gen and Sales go stale in about two days. Fulfillment stays clear for a week.

### Scouting as Fog Clearing

When a scout enters a fogged hex:
1. **Immediate**: hex fog drops to 0.0, beautiful "reveal" particle effect
2. **Cascade**: adjacent hexes fog drops proportional to distance (creates a bloom)
3. **Discovery check**: roll for enemy/resource detection based on terrain
4. **Terrain assignment**: if undiscovered, assigns terrain type based on domain
5. **Intel generation**: scout's Claude session begins gathering data for this area

The fog-clearing effect is one of the most satisfying moments in any RTS. We want it to feel GOOD — a burst of light, a chime sound, the map literally expanding. Each revealed hex might contain a threat or an opportunity, creating micro-moments of tension and reward.

---

## 8. Gravity and Attraction

### Task Affinity

Units aren't just ordered to locations — they're attracted to work that matches their type:

```typescript
interface TaskAffinity {
  unitType: UnitType
  taskTypes: string[]     // Skill categories this unit excels at
  territoryPreference: TerritoryId[] // Where this unit "wants" to be
  attractionStrength: number // 0-1, how strongly pulled toward matching work
}

const AFFINITIES: TaskAffinity[] = [
  {
    unitType: 'writer',
    taskTypes: ['content:*', 'quality:*', 'fulfillment:eec-*'],
    territoryPreference: ['content', 'lead-gen'],
    attractionStrength: 0.8
  },
  {
    unitType: 'scout',
    taskTypes: ['research:*', 'analytics:*', 'consulting:analyze-*'],
    territoryPreference: ['lead-gen', 'sales'],
    attractionStrength: 0.9
  },
  {
    unitType: 'diplomat',
    taskTypes: ['sales:*', 'consulting:*', 'client:*'],
    territoryPreference: ['sales'],
    attractionStrength: 0.85
  }
]
```

When a task is queued and no explicit unit is assigned, the system suggests the nearest unit with highest affinity. The unit's nameplate briefly pulses to indicate "I could handle this."

### Rally Points

Rally points are persistent output destinations. When a unit completes work, the output "projectile" flies to the rally point:

```typescript
interface RallyPoint {
  id: string
  name: string            // "Notion Content DB", "Kit Email List", "GitHub Repo"
  position: HexCoord      // Where it appears on the map
  type: 'notion' | 'kit' | 'slack' | 'github' | 'supabase' | 'custom'
  territory: TerritoryId
  sprite: string          // Building sprite to render
}
```

Rally points are rendered as small **buildings** on the map. When content is published, a projectile arcs from the writer unit to the Notion rally point. When code is pushed, it arcs to GitHub. This creates visible **supply lines** that show where your business outputs flow.

---

## 9. Formation and Group Behavior

### Control Groups

Units can be assigned to control groups (Ctrl+1 through Ctrl+9):

```typescript
interface ControlGroup {
  id: number               // 1-9
  name: string            // "Content Team", "Sales Force"
  unitIds: string[]       // Session IDs
  formation: FormationType
  rallyPoint?: HexCoord   // Default destination for group orders
}

type FormationType =
  | 'spread'    // Units distribute across territory
  | 'stack'     // Units cluster at same location
  | 'line'      // Units form a defensive line
  | 'wedge'     // V-formation, commander at point
```

### Group Orders

When a control group receives an order:
1. Commander/Lieutenant in the group receives the primary order
2. Other units receive support orders (matching their type)
3. Units march in formation toward the territory
4. Upon arrival, they spread according to formation type

Example: "Content Team, execute weekly batch"
- Lieutenant receives `/content:week-batch` command
- Writer-01 receives "LinkedIn post" sub-task
- Writer-02 receives "Twitter thread" sub-task
- Scout receives "research trending topics" support task
- All four march to Content territory in wedge formation
- On arrival, spread out and begin their individual tasks
- Progress visible as a coordinated campaign

---

## 10. The Economy of Attention

### Population Cap

The user has a limited number of concurrent Claude sessions (subscription dependent):

```
Free tier: 1-2 concurrent sessions = 1-2 units
Pro tier: ~5 concurrent sessions = 5 units
Team tier: potentially more

Population cap is displayed in the resource bar.
You CANNOT deploy more units than your cap allows.
This creates hard choices: where do you deploy your limited army?
```

### Token Budget as Fuel

Each unit consumes context tokens as fuel. This maps to the "supply" resource in RTS games:

```typescript
interface UnitResources {
  sessionId: string
  contextTokensUsed: number     // Current session usage
  contextTokensMax: number      // Estimated context window
  contextHealthPercent: number  // Displayed as health bar
  estimatedTokensPerHex: number // Fuel cost of movement
}
```

When a unit's context is nearly exhausted:
- Health bar turns red
- Unit moves slower (animation only — doesn't actually slow Claude)
- Warning alert: "Writer-01 running low on context"
- User must decide: rotate (new session) or let it finish

When context is fully exhausted:
- Claude hits context limit, session becomes unresponsive
- Unit "collapses" on the map (dramatic animation)
- Replaced by a "wounded" sprite that needs revival (new session with /continue)
- Any incomplete work is flagged in the intel panel

This creates real resource management tension. You can't just spam units — each one has a finite lifespan measured in tokens.

---

## 11. Sub-Spec Index

The following documents provide implementation-level detail for systems introduced here:

| Spec | Covers | Status |
|---|---|---|
| `02a-intel-pipeline-spec.md` | Scout → Intel HQ pipeline, raw intel format, intel products | In progress |
| `02b-enemy-system-spec.md` | Enemy bestiary, behavior state machines, spawn system, combat resolution | In progress |
| `02c-combat-and-roads-spec.md` | Tool-to-attack animations, combat choreography, road formation algorithm, terrain rendering | In progress |
| `02d-minimap-spec.md` | Minimap rendering, alert system, camera controls | TODO |
| `02e-sound-design-spec.md` | Military-themed sound palette, spatial audio, terrain sounds | TODO |
| `02f-formation-spec.md` | Control groups, formation types, group orders | TODO |

---

## 12. Implementation Priority

For Phase 0 prototype, implement in this order:

1. **Hex grid + territories** — Static map with 6 zones, terrain assigned
2. **Unit sprites** — Basic sprites that position in territories based on session data
3. **Movement** — A* pathfinding, units march between hexes with speed modifiers
4. **Fog of war** — Semi-transparent overlay, clears around units
5. **Road stubs** — Track execution counts, render trail/dirt road
6. **Basic combat** — Tool calls trigger attack animations on current hex
7. **Resource bar** — Token tracking, unit count

Everything else (intel pipeline, enemy system, campaigns, formations) comes in later phases. The prototype needs to FEEL right before we add complexity.

---

## Appendix: Why This Creates Dopamine

The reason RTS games are addictive isn't the complexity — it's the **feedback loops**:

1. **Exploration reward**: Fog clears → new territory revealed → might contain threat OR opportunity → micro-gambling dopamine
2. **Efficiency reward**: Road forms → future tasks faster → visible infrastructure → "I built this" satisfaction
3. **Combat reward**: Tool calls = attacks → rapid-fire visual feedback → task completes = victory → XP/loot feelings
4. **Territory reward**: More domain controlled = more business visibility → empire-building satisfaction
5. **Threat response**: Enemy appears → urgency spike → deploy unit → enemy dies → relief + reward
6. **Progression**: Map Day 1 vs Month 6 → dramatic visual transformation → the game equivalent of a "before/after"

Every one of these maps to real business outcomes. The dopamine isn't fake — it's amplifying the natural satisfaction of work well done with the visual language of a genre built to make that satisfaction addictive.
