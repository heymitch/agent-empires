# Agent Empires — MVP Build Manifest

## The One Document a Builder Reads

**Goal:** Playable MVP today. Not all features. Not all polish. But the core loop working: see your agents on a battlefield, watch them fight, feel the dopamine.

---

## What "MVP" Means

The user opens a browser, sees a Napoleon-era war table with their business as a battlefield. Their current Claude Code session appears as the Commander unit. When they spawn sub-agents, new units materialize and march to territory. Tool calls animate as combat. Revenue pings as gold. Threats appear from fog. Roads start forming from repeated workflows.

**The MVP is NOT:**
- All 17 enemy types (3 is enough)
- All 8 unit types (Commander + Writer + Scout is enough)
- Full campaign mode (just the score and resource bar)
- Full economy panel (top bar resources only)
- All integrations (Stripe webhook + token tracking is enough)
- Perfect Napoleon aesthetic (color palette + fonts + parchment texture is enough, full animation polish comes later)

**The MVP IS:**
- Working battlefield renderer (PixiJS, hex grid, 6 territories)
- Live unit sprites driven by real Vibecraft session data
- Territory detection (which domain is a session working in?)
- Sub-agent spawning visible as unit deployment
- Tool calls → combat animations
- Fog of war (basic: cleared around units, regrows)
- Road stubs (track execution count, render trails)
- Resource bar (tokens, unit count, revenue placeholder)
- Napoleon color palette and typography applied
- Sound (reuse Vibecraft's Tone.js, retheme 3-4 key sounds)
- Command bar (send prompts to specific sessions)

---

## Architecture for the Build

### What We Touch

```
~/agent-empires/
├── package.json           # UPDATE: swap three → pixi.js
├── shared/
│   ├── types.ts           # EXTEND: add Territory, UnitType, HexCell, etc.
│   └── defaults.ts        # UPDATE: rename paths to agent-empires
├── server/
│   ├── index.ts           # KEEP + EXTEND: add territory detection
│   ├── TerritoryDetector.ts  # NEW: maps events to territories
│   └── ...existing...     # KEEP as-is
├── hooks/
│   └── vibecraft-hook.sh  # KEEP (rename paths only)
├── src/
│   ├── main.ts            # REWRITE: new entry point for PixiJS
│   ├── renderer/          # NEW: all PixiJS rendering
│   │   ├── BattlefieldRenderer.ts  # Main renderer
│   │   ├── HexGrid.ts              # Hex grid system
│   │   ├── TerritoryRenderer.ts    # Territory zones
│   │   ├── UnitRenderer.ts         # Unit sprites
│   │   ├── FogRenderer.ts          # Fog of war
│   │   ├── RoadRenderer.ts         # Road overlay
│   │   ├── ParticleSystem.ts       # Combat effects
│   │   └── MinimapRenderer.ts      # Minimap
│   ├── hud/               # NEW: HTML overlay panels
│   │   ├── ResourceBar.ts          # Top resource bar
│   │   ├── IntelPanel.ts           # Right panel (tabbed)
│   │   ├── CommandBar.ts           # Bottom command input
│   │   ├── UnitDetail.ts           # Selected unit info
│   │   └── Minimap.ts              # Minimap UI wrapper
│   ├── game/              # NEW: game logic
│   │   ├── GameState.ts            # Central state management
│   │   ├── UnitManager.ts          # Unit lifecycle
│   │   ├── TerritoryManager.ts     # Territory state
│   │   ├── FogManager.ts           # Fog of war logic
│   │   ├── RoadTracker.ts          # Road formation tracking
│   │   ├── CombatAnimator.ts       # Tool call → animation
│   │   └── ResourceTracker.ts      # Economy tracking
│   ├── events/            # KEEP + EXTEND
│   │   ├── EventBus.ts             # KEEP as-is
│   │   └── handlers/
│   │       ├── index.ts            # UPDATE: register new handlers
│   │       ├── battlefieldHandlers.ts  # NEW: route events to game state
│   │       ├── soundHandlers.ts    # KEEP + UPDATE sounds
│   │       └── ...existing...      # KEEP what's useful
│   ├── audio/             # KEEP + RETHEME
│   │   ├── SoundManager.ts         # UPDATE: new sound definitions
│   │   └── SpatialAudioContext.ts   # KEEP as-is
│   ├── api/               # KEEP + EXTEND
│   │   ├── SessionAPI.ts           # KEEP as-is
│   │   └── index.ts                # KEEP as-is
│   ├── styles/            # REWRITE for Napoleon theme
│   │   ├── index.css
│   │   ├── napoleon-theme.css      # NEW: the aesthetic
│   │   ├── hud.css
│   │   └── panels.css
│   └── ui/                # KEEP useful parts
│       ├── KeyboardShortcuts.ts    # UPDATE keybinds
│       ├── Toast.ts                # KEEP as-is
│       └── ...                     # Evaluate per-file
├── index.html             # REWRITE for new layout
├── bin/cli.js             # UPDATE: rename to agent-empires
└── prd/                   # Our specs (not shipped)
```

### What We DELETE (Vibecraft-specific)

```
DELETE: src/scene/WorkshopScene.ts          (Three.js scene → replaced by PixiJS)
DELETE: src/scene/stations/*.ts             (Workstations → replaced by territories)
DELETE: src/scene/StationPanels.ts          (Station panels → replaced by HUD)
DELETE: src/scene/ZoneNotifications.ts      (Zone notifs → replaced by battlefield notifs)
DELETE: src/entities/Claude.ts              (Legacy character)
DELETE: src/entities/ClaudeMon.ts           (Robot character → replaced by unit sprites)
DELETE: src/entities/animations/*.ts        (3D animations → replaced by 2D)
DELETE: src/entities/SubagentManager.ts     (3D subagent viz → replaced by unit spawning)
DELETE: src/ui/DrawMode.ts                  (Hex painting → not needed)
DELETE: src/ui/TextLabelModal.ts            (Text tiles → not needed for MVP)
DELETE: src/ui/ZoneInfoModal.ts             (Zone info → replaced by territory panel)
DELETE: src/ui/ZoneCommandModal.ts          (Zone commands → replaced by command bar)
DELETE: src/utils/HexGrid.ts               (Three.js hex grid → new PixiJS one)
```

### What We KEEP Untouched

```
KEEP: server/index.ts                      (Session management, WebSocket, hooks — gold)
KEEP: server/ProjectsManager.ts            (Project tracking)
KEEP: server/GitStatusManager.ts           (Git status per session)
KEEP: shared/types.ts                      (Extend, don't replace)
KEEP: hooks/vibecraft-hook.sh              (The pipeline — just rename paths)
KEEP: src/events/EventBus.ts               (Decoupled event system — perfect)
KEEP: src/events/EventClient.ts            (WebSocket client — perfect)
KEEP: src/api/SessionAPI.ts                (Session CRUD — perfect)
KEEP: src/audio/SoundManager.ts            (Sound synthesis — retheme, don't rewrite)
KEEP: src/audio/SpatialAudioContext.ts      (Spatial audio — perfect)
KEEP: src/ui/KeyboardShortcuts.ts          (Keybind system — update bindings)
KEEP: src/ui/Toast.ts                      (Toast notifications — restyle)
KEEP: src/ui/FeedManager.ts               (Activity feed — restyle for Intel panel)
KEEP: src/ui/QuestionModal.ts             (Permission UI — restyle)
KEEP: src/ui/PermissionModal.ts           (Permission UI — restyle)
KEEP: bin/cli.js                          (CLI — rename)
KEEP: docs/                               (Update for Agent Empires)
```

---

## Build Phases (Today)

### Phase A: Scaffold (1 hour)

**Objective:** PixiJS renders a hex grid with territories. Browser opens, you see a map.

1. `npm uninstall three @types/three` + `npm install pixi.js @pixi/particle-emitter`
2. Update `package.json` name, description, bin
3. Update `shared/defaults.ts` paths (vibecraft → agent-empires)
4. Create `src/renderer/BattlefieldRenderer.ts`:
   - Initialize PixiJS Application
   - Create hex grid (pointy-top, 40px radius)
   - Render 6 territory zones with distinct colors
   - Camera: zoom + pan (mouse wheel + drag)
   - Render territory labels
5. Create `src/renderer/HexGrid.ts`:
   - Axial coordinate system
   - Hex-to-pixel and pixel-to-hex conversion
   - Neighbor calculation
   - A* pathfinding
6. Rewrite `index.html` for new layout (canvas + HUD overlay)
7. Rewrite `src/main.ts` to initialize PixiJS instead of Three.js
8. Create `src/styles/napoleon-theme.css` with color palette
9. Verify: `npm run dev` opens browser showing hex battlefield with territories

### Phase B: Units (1 hour)

**Objective:** Session data from Vibecraft's server renders as unit sprites on the map.

1. Create `src/renderer/UnitRenderer.ts`:
   - Unit sprite class (circle + icon + nameplate + health bar)
   - Position in territory based on session data
   - Status ring (green/cyan/amber/red)
   - Selected state highlight
2. Create `src/game/UnitManager.ts`:
   - Receives session data from WebSocket
   - Creates/removes unit sprites when sessions start/end
   - Updates unit status from events
3. Create `server/TerritoryDetector.ts`:
   - Analyzes events to determine territory
   - File path matching: `/domains/sales/` → 'sales'
   - Skill name matching: `content:*` → 'content'
   - Fallback: 'hq'
4. Wire EventBus → UnitManager → UnitRenderer pipeline
5. Create `src/game/GameState.ts` as central state store
6. Verify: Start a Claude session, see a unit appear on the map in the right territory

### Phase C: Movement + Combat (1.5 hours)

**Objective:** Units march between territories and tool calls animate as attacks.

1. Implement A* pathfinding in `HexGrid.ts`
2. Add movement animation to `UnitRenderer.ts`:
   - Smooth interpolation between hexes
   - Speed varies by terrain type
   - Dust/particle trail during movement
3. Create `src/game/CombatAnimator.ts`:
   - Map each tool type to an animation
   - pre_tool_use → start animation
   - post_tool_use → impact + result (success sparkle / error flash)
   - Chain detection (rapid tool calls = combo)
4. Create `src/renderer/ParticleSystem.ts`:
   - Object pool (200 particles)
   - Burst effect (task complete)
   - Trail effect (unit moving)
   - Sparkle effect (success)
   - Error effect (red flash)
5. Wire tool call events → territory detection → unit movement → combat animation
6. Verify: Run a task in Claude, watch the unit march to the relevant territory and "fight"

### Phase D: Fog + Roads (1 hour)

**Objective:** Unexplored territory is fogged. Repeated workflows form visible roads.

1. Create `src/renderer/FogRenderer.ts`:
   - Semi-transparent dark overlay per hex
   - Fog level 0.0-1.0 controls opacity
   - Clearing animation (fade + particle bloom)
2. Create `src/game/FogManager.ts`:
   - Each hex starts fogged (except HQ)
   - Units clear fog in 2-hex radius
   - Fog regrows over time (hourly decay per territory config)
   - Territory freshness calculation
3. Create `src/game/RoadTracker.ts`:
   - Track `(skill, territory)` execution counts
   - Persist to localStorage (Supabase later)
   - Emit events when road level changes
4. Create `src/renderer/RoadRenderer.ts`:
   - Draw lines between frequently-accessed territories
   - Line style changes with road level (dotted → solid → thick → glowing)
5. Verify: Watch fog clear around your active units. Run a content skill 5 times, see a trail form.

### Phase E: HUD + Resources (1.5 hours)

**Objective:** Napoleon-themed HUD with resource bar, intel panel, command bar, minimap.

1. Create `src/hud/ResourceBar.ts`:
   - HTML overlay at top of screen
   - Token counter (aggregate from all sessions)
   - Unit count / population cap
   - Revenue placeholder (hardcoded initially, Stripe webhook later)
   - Score placeholder
   - Napoleon styling (parchment bg, brass accents, serif fonts)
2. Create `src/hud/IntelPanel.ts`:
   - Right-side tabbed panel
   - Intel tab: event feed (repurpose Vibecraft's FeedManager)
   - Unit tab: selected unit details
   - Styled as aged parchment with ink text
3. Create `src/hud/CommandBar.ts`:
   - Bottom input bar
   - Session selector dropdown
   - Send prompt to selected session (reuse Vibecraft's prompt system)
   - Styled as leather field desk
4. Create `src/renderer/MinimapRenderer.ts`:
   - Small canvas in bottom-left
   - Shows all territories, unit positions, fog state
   - Click to jump camera
   - Parchment background
5. Implement Napoleon theme CSS:
   - Color palette applied globally
   - Font stack loaded (serif headers, readable body)
   - Panel backgrounds (parchment texture via CSS gradient)
   - Brass border treatment
6. Verify: Full HUD visible. Resource bar updating. Command bar sends prompts. Minimap navigable.

### Phase F: Sound + Polish (30 min)

**Objective:** Retheme key sounds, add satisfying feedback.

1. Update `SoundManager.ts`:
   - Replace `spawn` sound with drum roll + horn stinger
   - Replace `success` with brass fanfare
   - Replace `error` with low drum
   - Replace `prompt` with quill scratch acknowledgment
   - Replace `walking` with marching boots
   - Keep spatial audio system as-is
2. Add terrain-specific movement sounds
3. Add fog-clearing chime
4. Add road-forming subtle build sound
5. Verify: Satisfying audio feedback for all major actions

---

## Territory Detection Algorithm (Critical for MVP)

This is the system that makes agents appear in the right place. It runs server-side on every event:

```typescript
// server/TerritoryDetector.ts

interface TerritoryRule {
  pattern: RegExp
  territory: TerritoryId
  priority: number  // Higher = checked first
}

const FILE_PATH_RULES: TerritoryRule[] = [
  // Direct domain matches
  { pattern: /domains\/lead-gen/,    territory: 'lead-gen',    priority: 100 },
  { pattern: /domains\/sales/,       territory: 'sales',       priority: 100 },
  { pattern: /domains\/fulfillment/, territory: 'fulfillment', priority: 100 },
  { pattern: /domains\/support/,     territory: 'support',     priority: 100 },
  { pattern: /domains\/retention/,   territory: 'retention',   priority: 100 },
  { pattern: /domains\/home/,        territory: 'hq',          priority: 100 },

  // Content-specific paths
  { pattern: /clients\/.*\/content/,  territory: 'content',    priority: 90 },
  { pattern: /prompts\//,            territory: 'content',     priority: 80 },

  // Infrastructure
  { pattern: /agent-runner\//,       territory: 'hq',          priority: 70 },
  { pattern: /scripts\//,            territory: 'hq',          priority: 70 },
  { pattern: /services\//,           territory: 'hq',          priority: 70 },

  // Skills map to fulfillment (building capabilities)
  { pattern: /skills\//,            territory: 'fulfillment',  priority: 60 },

  // Funnels = lead gen
  { pattern: /funnels\//,           territory: 'lead-gen',     priority: 60 },
]

const SKILL_RULES: TerritoryRule[] = [
  { pattern: /^content:/,           territory: 'content',      priority: 100 },
  { pattern: /^sales:/,             territory: 'sales',        priority: 100 },
  { pattern: /^consulting:/,        territory: 'sales',        priority: 100 },
  { pattern: /^fulfillment:/,       territory: 'fulfillment',  priority: 100 },
  { pattern: /^quality:/,           territory: 'content',      priority: 90 },
  { pattern: /^analytics:/,         territory: 'lead-gen',     priority: 80 },
  { pattern: /^slack:/,             territory: 'support',      priority: 70 },
  { pattern: /^publish:/,           territory: 'lead-gen',     priority: 80 },
  { pattern: /^queue:/,             territory: 'hq',           priority: 60 },
  { pattern: /^skills:/,            territory: 'fulfillment',  priority: 60 },
]

const TOOL_HEURISTICS: TerritoryRule[] = [
  { pattern: /^WebFetch|^WebSearch/,  territory: 'lead-gen',   priority: 30 },
  { pattern: /^Bash.*git/,           territory: 'hq',          priority: 20 },
]

export function detectTerritory(event: ClaudeEvent): TerritoryId {
  const candidates: { territory: TerritoryId; priority: number }[] = []

  // Check file paths in tool input
  if ('toolInput' in event) {
    const input = event.toolInput
    const filePath = input.file_path || input.path || input.command || ''

    for (const rule of FILE_PATH_RULES) {
      if (rule.pattern.test(String(filePath))) {
        candidates.push({ territory: rule.territory, priority: rule.priority })
      }
    }
  }

  // Check if this looks like a skill invocation
  if ('toolInput' in event && event.tool === 'Bash') {
    const cmd = String((event.toolInput as any).command || '')
    // Skill invocations often appear in prompt text
    for (const rule of SKILL_RULES) {
      if (rule.pattern.test(cmd)) {
        candidates.push({ territory: rule.territory, priority: rule.priority })
      }
    }
  }

  // Tool type heuristics (lowest priority)
  if ('tool' in event) {
    for (const rule of TOOL_HEURISTICS) {
      if (rule.pattern.test(event.tool)) {
        candidates.push({ territory: rule.territory, priority: rule.priority })
      }
    }
  }

  // Return highest priority match, or 'hq' as fallback
  if (candidates.length === 0) return 'hq'
  candidates.sort((a, b) => b.priority - a.priority)
  return candidates[0].territory
}
```

---

## State Management

Central game state that everything reads from:

```typescript
// src/game/GameState.ts

interface GameState {
  // Units (from Vibecraft sessions)
  units: Map<string, UnitState>

  // Territories
  territories: Map<TerritoryId, TerritoryState>

  // Fog
  hexFog: Map<string, number>  // "q,r" → fog level 0-1

  // Roads
  roads: Map<string, RoadState>  // "skill:from:to" → level + count

  // Resources
  resources: {
    tokens: { current: number; max: number }
    population: { current: number; max: number }
    revenue: { mtd: number; today: number }
    score: number
  }

  // Selection
  selectedUnitId: string | null
  selectedTerritory: TerritoryId | null
  cameraPosition: { x: number; y: number }
  cameraZoom: number
}

interface UnitState {
  sessionId: string
  name: string
  type: UnitType
  territory: TerritoryId
  status: 'idle' | 'marching' | 'working' | 'thinking' | 'offline'
  position: { x: number; y: number }  // Pixel position on map
  targetPosition?: { x: number; y: number }
  path?: HexCoord[]
  healthPercent: number  // Context tokens remaining
  currentTool?: string
  selected: boolean
  lastActivity: number
}

interface TerritoryState {
  id: TerritoryId
  name: string
  fog: number        // Average fog across territory hexes
  threatLevel: number
  activeUnits: string[]
  roadLevel: RoadLevel  // Highest road connecting to this territory
}
```

---

## MVP Success Criteria

After today's build, all of these should work:

- [x] Browser opens showing hex battlefield with 6 named territories — **SHIPPED** (`TerrainRenderer.ts`: 7 territories rendered with polygon zones, labels, noise-based terrain texture)
- [x] Existing Claude sessions appear as unit sprites in the correct territory — **SHIPPED** (`UnitRenderer.ts`: body circle + status ring + nameplate + health bar; `GameState.ts` + `main.ts` wiring)
- [x] Spawning a new session (Alt+N) shows a unit materializing on the map — **SHIPPED** (new-session modal in `index.html`, wired through `main.ts`)
- [x] Tool calls on a session animate as combat effects on that unit — **SHIPPED** (`CombatAnimator.ts`: per-tool colors, combo tracking, animated Graphics)
- [x] Unit moves between territories when the session works on different domains — **SHIPPED** (`MovementManager.ts`: lerp movement over 2s with particle trail)
- [x] Fog covers unexplored territories, clears around active units — **SHIPPED** (`FogOfWar.ts`: RenderTexture-based, visibility radius, stale/dark thresholds, radar sweep, regrowth). Note: `FogRenderer.ts` is a disabled stub — `FogOfWar.ts` is the real implementation.
- [x] Resource bar shows token usage and unit count — **SHIPPED** (`ResourceBar.ts`: connection status, revenue, context tokens, unit count, score)
- [x] Command bar sends prompts to selected sessions — **SHIPPED** (`CommandBar.ts`: session selector, textarea input, ticker notifications)
- [x] Minimap shows strategic overview — **SHIPPED** (`MinimapRenderer.ts`: 200x150 canvas, territory blobs, unit dots, camera viewport rect, click-to-jump)
- [ ] Napoleon color palette and typography applied throughout — **OPEN / DIVERGED**: CSS uses cyberpunk palette (Orbitron, neon `#00ffcc`). Terrain uses "Magnetic Residue" dark palette. Neither matches PRD 06 Napoleon parchment/brass spec. Typography is monospace, not serif.
- [x] Sound effects play for key events (deploy, combat, complete) — **SHIPPED** (`SoundManager.ts`: Web Audio API synthesis, RTS-themed sounds: `command_sent`, `unit_deployed`, `threat_spawn`, etc.)
- [x] Road stubs visible after repeated skill execution (even if just a trail) — **SHIPPED** (`RoadRenderer.ts`: animated roads between territory centers, 5 road levels with increasing width/glow)

---

## What Comes After MVP

Once the core loop works, we layer on:
1. **Enemy system** (from 02b) — start with 3 enemy types
2. **Full campaign mode** (from 01) — objectives with real metrics
3. **Autonomous monitoring** (from 04) — Stripe + analytics feeds
4. **Full economy panel** (from 05) — detailed resource management
5. **Animation polish** (from 02c) — full combat choreography
6. **Intelligence pipeline** (from 02a) — scout missions with intel processing

Each of these is a separate build session. The MVP proves the concept works and feels good. Then we proliferate.
