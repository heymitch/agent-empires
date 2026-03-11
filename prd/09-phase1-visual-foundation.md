# Agent Empires Phase 1 — Visual Foundation + Threat Data Layer

## Goal

Transform the battlefield from "dashboard with dots" into an actual RTS map with terrain, fog of war, territory reactivity, and a live threat/signal data pipeline from Supabase. After this phase, the map should feel alive — territories brighten when agents are working, fog rolls in on dormant zones, threats pulse red from real business events, and the "magnetic residue" aesthetic starts to emerge.

---

## Components

### 1. TerrainRenderer (replace TerritoryRenderer)

**What:** Procedural terrain texture inside each territory polygon. Perlin noise displacement, elevation shading, organic edges instead of flat color fills.

**Spec:**
- Each territory gets a base color (from existing palette) + noise layer
- Noise should create a "magnetic field" look — flowing lines, not random static
- Active territories (units present) brighten by 30% and border glow intensifies
- Threatened territories pulse red on border (1.5s cycle)
- Dormant territories (no activity for 5+ minutes) dim to 40% opacity
- Territory labels remain (Orbitron font, positioned at center)
- Use PixiJS Graphics + Noise.js (or inline simplex) for the procedural layer
- Must keep the 7 territory polygon shapes from current TerritoryRenderer
- Add subtle animated "energy flow" lines within active territories (thin cyan lines that drift)

**Output:** `src/renderer/TerrainRenderer.ts` (replaces `TerritoryRenderer.ts`)

**Reads:** Current `TerritoryRenderer.ts` for polygon data, `prd/06-visual-direction.md` for color tokens

---

### 2. FogOfWar (rewrite FogRenderer)

**What:** Real fog of war using RenderTexture compositing. Three fog states per territory, radar-sweep reveal, regrowth over time.

**Spec:**
- **Visible** (units present): Fully clear, no fog. Bright territory.
- **Stale** (no unit for 2-5 min): Semi-transparent grid ghost overlay. Last known unit positions shown as faint wireframes. Data freshness timer shown.
- **Dark** (no unit for 5+ min, or never explored): Full dark overlay (85% opacity). Only territory outline faintly visible.
- Implementation: Full-world RenderTexture. Draw black rect. For each unit, draw a clear circle (radius 300 world units) using `erase` blend mode or AlphaFilter mask approach.
- Stale zones: Draw with static/noise texture at 40% opacity instead of clear.
- Radar sweep animation when a unit enters a dark zone: bright line sweeps from unit position outward in a 360-degree arc over 1.5 seconds, clearing fog as it goes.
- Fog regrowth: When last unit leaves a territory, fog begins returning after 2 minutes, reaching full dark at 5 minutes.
- Territory-specific regrowth rates (from PRD 02): Support regrows fastest (high churn), HQ regrows slowest (stable).

**Output:** `src/renderer/FogOfWar.ts` (replaces `FogRenderer.ts`)

**Reads:** Current `FogRenderer.ts`, `prd/02-physics-and-movement.md` (fog section), `src/renderer/constants.ts`

---

### 3. TerritoryStateManager

**What:** Tracks per-territory state (active/stale/dark/threatened) and drives visual reactivity.

**Spec:**
- Maintains a `Map<TerritoryId, TerritoryState>` with:
  - `lastUnitPresence: number` (timestamp of last unit in zone)
  - `unitCount: number` (current units in zone)
  - `threatLevel: 'none' | 'low' | 'elevated' | 'critical'`
  - `fogState: 'visible' | 'stale' | 'dark'`
  - `activityCount: number` (events in last 5 min, drives "brightness")
- Updated by: unit movement events, threat events from Supabase, fog timer ticks
- Emits change events that TerrainRenderer and FogOfWar subscribe to
- Computes fog state from `lastUnitPresence` vs current time
- Computes brightness from `activityCount` (0 events = dim, 10+ = full bright)

**Output:** `src/game/TerritoryStateManager.ts`

**Reads:** `src/game/GameState.ts`, `src/renderer/TerritoryRenderer.ts` (for territory IDs/shapes)

---

### 4. ScreenEffects (CRT + Vignette + Bloom)

**What:** Post-processing overlay on the PixiJS canvas for the cyberpunk aesthetic.

**Spec:**
- CRT scanlines: Horizontal lines every 3px at 4% opacity, animated vertical scroll (subtle)
- Vignette: Radial gradient from transparent center to dark edges (12% opacity at corners)
- Bloom: CSS `filter: blur()` on a duplicated canvas layer at low opacity for glow effect on neon elements (cheaper than PixiJS filters)
- Glitch effect: Triggered on critical alerts — brief horizontal slice displacement + color channel offset, 200ms duration
- Implementation: HTML overlay div with CSS (not PixiJS filters — cheaper, doesn't affect hit testing)
- Toggle-able via settings (some users may find scanlines annoying)

**Output:** `src/renderer/ScreenEffects.ts` + additions to `src/styles/agent-empires.css`

**Reads:** `prd/06-visual-direction.md` (has exact CSS for scanlines + glitch keyframes)

---

### 5. ThreatDataBridge (Supabase → Agent Empires)

**What:** Server-side module that polls Supabase for business events and maps them to battlefield threats.

**Spec:**
- Polls every 30 seconds (configurable):
  - `support_tickets` where `status = 'open'` and `priority IN ('high', 'urgent')` → SUPPORT territory threats
  - `deals` where `stage = 'lost'` or `close_date < now()` → SALES territory threats
  - `customers` where `health_status = 'at_risk'` → RETENTION territory threats
  - `leads` where `status = 'cold'` and `created_at > now() - interval '7 days'` → LEAD-GEN territory threats
- Each threat becomes a `ThreatEvent`:
  ```typescript
  interface ThreatEvent {
    id: string
    type: 'support_ticket' | 'deal_lost' | 'churn_risk' | 'cold_lead'
    severity: 'low' | 'elevated' | 'critical'
    territory: TerritoryId
    title: string
    description: string
    sourceTable: string
    sourceId: string
    timestamp: number
  }
  ```
- Broadcasts via WebSocket as `{ type: 'threat', payload: ThreatEvent }`
- De-duplicates by `sourceTable + sourceId` so resolved threats don't re-fire
- Tracks resolution: when a ticket status changes to 'resolved', broadcasts `{ type: 'threat_resolved', payload: { id } }`

**Environment:**
- `SUPABASE_URL` = `https://dquuimhmbofdhdsbdbly.supabase.co`
- `SUPABASE_KEY` = from `.env` (service role key)

**Output:** `server/ThreatDataBridge.ts`

**Reads:** Supabase schema (tables: `support_tickets`, `deals`, `customers`, `leads`), `server/index.ts` (for broadcast pattern)

---

### 6. ThreatRenderer (client-side threat visualization)

**What:** Renders threats on the battlefield as pulsing enemy markers, inspired by situation-monitor's hotspot visualization.

**Spec:**
- Each active threat renders as a pulsing circle on the threatened territory:
  - `critical`: Red (#ff3366), radius oscillates 15→25, opacity 0.8→0.3, 1.5s cycle
  - `elevated`: Orange (#ffaa00), radius oscillates 10→18, opacity 0.6→0.2, 2s cycle
  - `low`: Yellow (#ffd700), radius oscillates 8→12, opacity 0.4→0.15, 3s cycle
- Position: Random offset within territory bounds (jittered so multiple threats don't stack)
- Hover tooltip (HTML overlay): threat title, description, age
- Click: Opens floating panel variant showing threat detail + "DISPATCH UNIT" button
- When resolved: shrink animation (300ms) then remove
- Multiple threats on same territory cluster in a formation (not overlapping)
- Threat count badge appears on territory label: "SUPPORT [3]"

**Output:** `src/renderer/ThreatRenderer.ts`

**Reads:** `prd/02b-enemy-system-spec.md` (threat categories), `src/renderer/TerritoryRenderer.ts` (territory bounds)

---

### 7. Supabase Schema Migration

**What:** Create the `agent_empires_threats` table and `company_documents` table (referenced everywhere but missing).

**Spec:**
- `agent_empires_threats`:
  ```sql
  CREATE TABLE agent_empires_threats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'elevated', 'critical')),
    territory TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'expired')),
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
  );
  CREATE INDEX idx_threats_status ON agent_empires_threats(status);
  CREATE INDEX idx_threats_territory ON agent_empires_threats(territory);
  CREATE UNIQUE INDEX idx_threats_source ON agent_empires_threats(source_table, source_id) WHERE status = 'active';
  ```

- `company_documents` (the missing table CLAUDE.md references):
  ```sql
  CREATE TABLE company_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT,
    document_type TEXT DEFAULT 'general',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  ```

**Output:** `server/migrations/001-threats-and-documents.sql` + executed via Supabase MCP

---

### 8. Main Integration

**What:** Wire all new components into `main.ts` and `server/index.ts`.

**Spec (client - main.ts):**
- Replace `TerritoryRenderer` import with `TerrainRenderer`
- Replace `FogRenderer` import with `FogOfWar`
- Add `TerritoryStateManager` — feed it unit movement events + threat events
- Add `ThreatRenderer` — subscribe to threat WebSocket events
- Add `ScreenEffects` — init after PixiJS app is created
- Wire `TerritoryStateManager` change events → `TerrainRenderer.updateTerritoryState()` + `FogOfWar.updateFogState()`
- Wire threat events from EventClient → `ThreatRenderer.addThreat()` / `.removeThreat()`
- Keep all existing functionality (floating panel, combat animator, movement, etc.)

**Spec (server - index.ts):**
- Import and start `ThreatDataBridge` in `main()`
- Pass `broadcast` function to ThreatDataBridge so it can push threats to clients
- Add threat event types to `ServerMessage` union in `shared/types.ts`

**Output:** Modifications to `src/main.ts`, `server/index.ts`, `shared/types.ts`

**This is a SEQUENTIAL component** — runs after all parallel builders complete.

---

## Dependency Graph

```
Phase 1A (parallel):
  [TerrainRenderer] [FogOfWar] [ScreenEffects] [ThreatDataBridge] [ThreatRenderer] [TerritoryStateManager] [Schema Migration]

Phase 1B (sequential, after 1A):
  [Main Integration] — wires everything together

Phase 1C (sequential, after 1B):
  [Validator] — build + runtime smoke test
```

## File Ownership (no conflicts)

| Agent | Owns (exclusive write) | Reads |
|-------|----------------------|-------|
| W1-terrain | `src/renderer/TerrainRenderer.ts` | TerritoryRenderer.ts, constants.ts, 06-visual-direction.md |
| W1-fog | `src/renderer/FogOfWar.ts` | FogRenderer.ts, constants.ts, 02-physics.md |
| W1-effects | `src/renderer/ScreenEffects.ts`, CSS additions | 06-visual-direction.md |
| W1-threat-bridge | `server/ThreatDataBridge.ts` | server/index.ts, .env |
| W1-threat-render | `src/renderer/ThreatRenderer.ts` | TerritoryRenderer.ts, 02b-enemy-system.md |
| W1-state | `src/game/TerritoryStateManager.ts` | GameState.ts, TerritoryRenderer.ts |
| W1-schema | `server/migrations/001-*.sql` | Supabase schema |
| W1-integrate | `src/main.ts`, `server/index.ts`, `shared/types.ts` | All of the above |
| W1-validate | None (read-only) | Everything |

## Success Criteria

- [ ] `npx vite build` passes with zero errors
- [ ] Territories show procedural noise texture, not flat fills
- [ ] Active territory visibly brighter than dormant territory
- [ ] Fog of war: dark zones are actually dark, clear zones are clear (not just dim overlay)
- [ ] At least one threat pulsing on the map (from Supabase test data)
- [ ] CRT scanlines visible on canvas
- [ ] No circular imports (trace all new import chains)
- [ ] No regressions: floating panel, unit click, WebSocket connection still work
- [ ] Runtime smoke test: page loads, territories render, no console errors beyond chrome extension noise
