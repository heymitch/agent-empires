# Agent Empires Phase 1 — Visual Foundation + Threat Data Layer

## Goal

Transform the battlefield from "dashboard with dots" into an actual RTS map with terrain, fog of war, territory reactivity, and a live threat/signal data pipeline from Supabase. After this phase, the map should feel alive — territories brighten when agents are working, fog rolls in on dormant zones, threats pulse red from real business events, and the "magnetic residue" aesthetic starts to emerge.

---

## Components

### 1. TerrainRenderer (replace TerritoryRenderer) — ✅ SHIPPED

**File:** `src/renderer/TerrainRenderer.ts` (499 lines)

**What shipped:**
- Inline simplex noise (2D, zero external deps) — seeded permutation table, `simplex2()` function
- "Magnetic Residue" palette: deep (#16120E), surface (#1A1510), cream (#F0E4D0), orange (#E8682A), teal (#4A9DB8), phosphor (#82C896), amber (#FFB86C)
- 7 hand-crafted organic territory polygons tiling 4000x3000 world
- Baked noise textures: 24 field lines per territory using simplex noise displacement — creates the "magnetic field" aesthetic
- Animated flow lines: 8 phosphor-green (#82C896) drift lines per active territory, driven by simplex noise
- Territory reactivity via `updateTerritoryState()`:
  - Active (units present): 15% brighten (not 30% — design decision: weathered map, not neon), orange border with glow halo
  - Threatened: pulsing orange border (1.5s cycle, alpha 0.4-0.9), outer soft glow pass, slight red tint on fill
  - Dormant: container alpha 0.85, dim border at 0.2 alpha
  - Dark fog: container alpha 0.5
- Labels: JetBrains Mono (not Orbitron — consistency with codebase), 48px, uppercase, alpha varies by state
- Point-in-polygon hit testing via `hitTestTerritory()`
- Exports `TerritoryId` type used across the codebase

**Deviations from original spec:**
- Brighten factor is 15% not 30% (deliberate aesthetic choice)
- Font is JetBrains Mono not Orbitron (matches rest of UI)
- Labels positioned 200px above center, not at center (avoids overlapping unit sprites)
- Uses phosphor green (#82C896) for flow lines, not cyan — fits the magnetic residue palette

---

### 2. FogOfWar (rewrite FogRenderer) — ✅ SHIPPED

**File:** `src/renderer/FogOfWar.ts` (338 lines)
**Old stub:** `src/renderer/FogRenderer.ts` — superseded, no longer imported

**What shipped:**
- Full RenderTexture compositing: `RenderTexture.create()` → `Sprite` → renders fog overlay each frame
- Grid-bucket system: world divided into cells of `VISIBILITY_RADIUS` (300 world units), tracks fog per cell
- Three fog states with smooth transitions:
  - Visible: opacity 0 (fully clear)
  - Stale: opacity ramps from 0 to 0.40 over 2 minutes after last unit leaves
  - Dark: opacity ramps from 0.40 to 0.85 over next 3 minutes
- Territory-specific regrowth multipliers: support 1.5x (fastest), HQ 0.5x (slowest)
- Radar sweep: green (#00ff88) expanding circle stroke, 1.5s duration, triggered when unit enters dark bucket
- Unit visibility circles: uses PixiJS v8 `.cut()` to punch transparent holes in the fog at unit positions
- Per-frame composite: per-bucket opacity rects → `.cut()` circles at units → radar sweep strokes → render to texture
- Wired into `BattlefieldRenderer.ts`: replaces old `FogRenderer` stub, receives unit positions each frame

**Remaining polish (Phase 2):**
- No stale-zone noise texture — spec called for static/noise overlay at 40%, implementation uses flat opacity
- No "last known unit positions shown as faint wireframes" (stale zone feature from spec)
- No data freshness timer display
- TerritoryStateManager fog states not yet forwarded to FogOfWar (it computes its own from unit buckets)

---

### 3. TerritoryStateManager — ✅ SHIPPED

**File:** `src/game/TerritoryStateManager.ts` (261 lines)

**What shipped:**
- `TerritoryState` interface: `lastUnitPresence`, `unitCount`, `threatLevel`, `threatCount`, `fogState`, `activityCount`
- All 7 territory IDs tracked with per-territory fog thresholds:
  - Default: visible <2min, stale 2-5min, dark >=5min
  - Support: 1.5x faster (80s/200s thresholds)
  - HQ: 0.5x slower (240s/600s thresholds)
- Activity tracking: 5-minute rolling window, `recordActivity()` pushes timestamps, `tick()` decays
- Threat tracking: severity stack per territory, `addThreat()`/`removeThreat()`, computes highest severity
- `onChange()` event emitter with snapshot isolation
- `tick()` method recomputes fog state + decays activity counts — called every second in main.ts

**Wired in main.ts:** Yes — instantiated, `onChange` feeds `TerrainRenderer.updateTerritoryState()`, `addThreat` called on threat events, `tick()` on 1-second interval.

---

### 4. ScreenEffects (CRT + Vignette + Bloom) — ⚠️ PARTIAL

**File:** `src/renderer/ScreenEffects.ts` (68 lines)
**CSS:** `src/styles/agent-empires.css` (screen-effects-overlay section + body::after scanlines)

**What shipped:**
- CRT scanlines: Two layers — `body::after` pseudo-element (repeating-linear-gradient, 2px spacing, 3% opacity) + `#screen-effects-overlay::before` (3px spacing, 4% opacity, animated vertical scroll via `scanline-drift` keyframe)
- Glitch effect: `triggerGlitch()` adds `.glitching` class → `screen-glitch` keyframe animation (200ms, horizontal displacement + hue-rotate + color channel offset). Triggered on critical threat events in main.ts.
- Toggle: `enable()`/`disable()` show/hide the overlay div
- HTML overlay approach (not PixiJS filters) — no hit-testing interference

**What's missing:**
- **Vignette**: Present in CSS (`radial-gradient(ellipse at center, transparent 50%, rgba(22, 18, 14, 0.5) 100%)`) on `#screen-effects-overlay`. Uses magnetic residue deep color. ✅ Actually shipped.
- **Bloom**: No CSS `filter: blur()` on a duplicated canvas layer. This was the most expensive spec item and may have been intentionally deferred.

---

### 5. ThreatDataBridge (Supabase → Agent Empires) — ✅ SHIPPED

**File:** `server/ThreatDataBridge.ts` (241 lines)

**What shipped:**
- Polls 4 Supabase tables via raw `fetch()` (no SDK):
  - `support_tickets` (open + high/urgent priority) → severity: urgent=critical, high=elevated
  - `deals` (stage=lost) → severity: elevated, territory: sales
  - `customers` (health_status=at_risk) → severity: critical, territory: retention
  - `leads` (status=cold, last 7 days) → severity: low, territory: lead-gen
- `ThreatEvent` interface matches spec exactly
- De-duplication by `sourceTable:sourceId` composite key
- Resolution tracking: threats removed from `activeThreats` map when no longer in poll results → fires `onThreatResolved`
- `Promise.allSettled` for parallel queries — partial failures don't block other queries
- Configurable poll interval (default 30s)
- Wired in `server/index.ts`: starts on server boot, broadcasts threats via WebSocket

---

### 6. ThreatRenderer (client-side threat visualization) — ✅ SHIPPED

**File:** `src/renderer/ThreatRenderer.ts` (246 lines)

**What shipped:**
- Severity configs (adapted to magnetic residue palette):
  - Critical: warm orange (#E8682A), radius 20+/-5, alpha 0.55+/-0.25, 1.5s cycle
  - Elevated: amber (#FFB86C), radius 14+/-4, alpha 0.4+/-0.2, 2s cycle
  - Low: cream-dim (#B4A690), radius 10+/-2, alpha 0.275+/-0.125, 3s cycle
- Pop-in/pop-out animation: 300ms ease-out cubic, scales from 0 → 1 (entering) or 1 → 0 (exiting)
- Isometric tilt compensation: Y scale = `1 / ISO_TILT`
- Per-threat jitter using seeded deterministic PRNG (threat ID + index-based offset)
- Type icons: `!` for support, `$` for deals, `*` for default
- Title label above each threat marker (truncated to 20 chars)
- Outer glow ring stroke per threat

**Deviations from original spec:**
- Colors adapted to magnetic residue palette (orange/amber/cream instead of red/orange/yellow)
- No hover tooltip (HTML overlay) — would require DOM ↔ PixiJS coordinate mapping
- No click → floating panel with "DISPATCH UNIT" button
- No threat count badge on territory label ("SUPPORT [3]")

---

### 7. Supabase Schema Migration — ✅ SHIPPED

**File:** `server/migrations/001-threats-and-documents.sql`

**What shipped:**
- `agent_empires_threats` table: exact match to spec — UUID PK, type, severity (CHECK), territory, title, description, source_table, source_id, status (active/resolved/expired), created_at, resolved_at, metadata (JSONB)
- Indexes: status, territory, unique partial index on (source_table, source_id) WHERE status='active'
- `company_documents` table: UUID PK, title, content, document_type, metadata, timestamps
- All using `IF NOT EXISTS` for idempotent re-runs

---

### 8. Main Integration — ✅ SHIPPED

**Files:** `src/main.ts`, `server/index.ts`, `src/renderer/BattlefieldRenderer.ts`

**What's wired:**
- TerrainRenderer: imported, renders all 7 territories with noise + flow lines
- TerritoryStateManager: instantiated, `onChange` → feeds `TerrainRenderer.updateTerritoryState()`, `tick()` every 1s
- ScreenEffects: instantiated, `init()` on canvas container, `triggerGlitch()` on critical threats
- ThreatRenderer: instantiated with battlefield threat layer + terrain center lookup, `addThreat`/`removeThreat` on WebSocket events, `update()` per frame
- ThreatDataBridge: started in server `main()`, broadcasts threats + resolutions via WebSocket
- FogOfWar: replaces FogRenderer stub in BattlefieldRenderer, receives unit positions each frame, uses `.cut()` for visibility circles

**Remaining polish:**
- TerritoryStateManager fog states not yet forwarded to FogOfWar (it computes its own fog from unit bucket tracking)
- No WebSocket-based fog state sync (FogOfWar is purely client-side)

---

### 9. Production Chain View — ✅ SHIPPED (NEW — not in original PRD)

**Files:**
- `src/renderer/ProductionChainRenderer.ts` (697 lines) — client-side Factorio-mode visualization
- `server/ProductionDataManager.ts` (366 lines) — server-side mock data generation + broadcasting
- `shared/productionChains.ts` (402 lines) — chain definitions for 5 territories (25 nodes total)

**What shipped:**

**Client (ProductionChainRenderer):**
- Factorio-style per-territory drill-down: click territory → fade in production chain overlay
- Production nodes: rounded rectangles with health-color borders (green/yellow/red), name + metric + target labels
- Connections: quadratic bezier curves (same pattern as RoadRenderer), width scales with throughput
- Animated flow particles: dots march along connections at 60px/s, spaced 30px apart
- Bottleneck detection: worst health ratio (<0.8) node whose upstream is healthy (>0.8) = true bottleneck
- Bottleneck visualization: pulsing glow ring, "BOTTLENECK" label in Orbitron, gap sub-label showing metric vs target
- Bottleneck pileup: extra dots cluster at 90-98% of connection to bottleneck node
- Fade in/out: 300ms opacity transition on show/hide
- Dim callback: notifies parent to dim non-active territories during production view
- Text caching: avoids recreating PixiJS Text objects every frame

**Server (ProductionDataManager):**
- Mock data engine: sin waves + smooth noise per node, seeded phases so nodes don't oscillate in sync
- Deliberately underperforming seeds create visible bottlenecks: lg-subscribers (62%), sl-proposals (55%), sp-resolution (145% over target), rt-churn (250% over target)
- `invertHealth` flag for "lower is better" metrics (response time, churn)
- Per-node health ratio computation, status classification (healthy/warning/bottleneck)
- Human-readable bottleneck suggestions per node ID
- Broadcasts all chain states every 30 seconds
- `updateNodeMetric()` for manual overrides (future: wire to real data sources)

**Data (productionChains.ts):**
- 5 territory chains: Lead-Gen (5 nodes), Sales (5), Fulfillment (5), Support (4), Retention (4)
- Each node: id, name, territory, metric label, target, data source, query hint, input/output edges, position
- Data sources specified: kit-subscribers, supabase:content_log, shield, stripe, calendar, manual, supabase:feedback, supabase:support, slack, samcart
- Types exported: `ProductionNode`, `ProductionChain`, `ProductionNodeState`, `BottleneckInfo`, `ProductionChainState`
- Lookup helpers: `getChainDef()`, `getAllNodeIds()`, `getNodeDef()`

---

## Dependency Graph

```
Phase 1A (parallel) — ALL COMPLETE:
  ✅ [TerrainRenderer]
  ✅ [FogOfWar]           ← built but dead code
  ✅ [ScreenEffects]       ← partial (no vignette/bloom)
  ✅ [ThreatDataBridge]
  ✅ [ThreatRenderer]
  ✅ [TerritoryStateManager]
  ✅ [Schema Migration]
  ✅ [ProductionChainRenderer]  ← NEW

Phase 1B (integration) — COMPLETE:
  ✅ [Main Integration]
      ✅ TerrainRenderer wired
      ✅ TerritoryStateManager wired
      ✅ ScreenEffects wired (CRT + glitch + vignette)
      ✅ ThreatRenderer wired (client)
      ✅ ThreatDataBridge wired (server)
      ✅ ProductionChainRenderer wired
      ✅ FogOfWar wired (replaces FogRenderer stub)
```

## File Ownership

| Component | File | Status |
|-----------|------|--------|
| TerrainRenderer | `src/renderer/TerrainRenderer.ts` | ✅ SHIPPED |
| FogOfWar | `src/renderer/FogOfWar.ts` | ✅ SHIPPED |
| FogRenderer (stub) | `src/renderer/FogRenderer.ts` | Superseded — no longer imported |
| TerritoryStateManager | `src/game/TerritoryStateManager.ts` | ✅ SHIPPED |
| ScreenEffects | `src/renderer/ScreenEffects.ts` | ✅ SHIPPED (no bloom) |
| ScreenEffects CSS | `src/styles/agent-empires.css` | ✅ SHIPPED |
| ThreatDataBridge | `server/ThreatDataBridge.ts` | ✅ SHIPPED |
| ThreatRenderer | `src/renderer/ThreatRenderer.ts` | ✅ SHIPPED |
| Schema Migration | `server/migrations/001-threats-and-documents.sql` | ✅ SHIPPED |
| ProductionChainRenderer | `src/renderer/ProductionChainRenderer.ts` | ✅ SHIPPED |
| ProductionDataManager | `server/ProductionDataManager.ts` | ✅ SHIPPED |
| Production Chain Defs | `shared/productionChains.ts` | ✅ SHIPPED |

## Success Criteria

- [x] `npx vite build` passes with zero errors
- [x] Territories show procedural noise texture, not flat fills
- [x] Active territory visibly brighter than dormant territory
- [x] Fog of war: dark zones are actually dark, clear zones are clear
- [x] At least one threat pulsing on the map (from Supabase test data)
- [x] CRT scanlines visible on canvas
- [x] No circular imports
- [x] No regressions: floating panel, unit click, WebSocket connection still work
- [x] Runtime smoke test: page loads, territories render, no console errors
- [x] Vignette visible at screen edges
- [x] Production chain view shows Factorio-mode drill-down per territory (NEW)

## Remaining Work (Priority Order)

1. **Forward TerritoryStateManager fog states to FogOfWar** — Currently FogOfWar computes its own fog from unit bucket tracking. Could be enhanced to also accept territory-level fog state from the manager for consistency.
2. **Stale-zone noise texture** — Spec called for static/noise overlay at 40% for stale zones. Currently flat opacity.
3. **Threat hover tooltips** — HTML overlay positioned from PixiJS world coords. Requires coordinate transform pipeline.
4. **Threat count badges on territory labels** — "SUPPORT [3]" format. Data available from TerritoryStateManager.threatCount.
5. **Bloom effect** — CSS filter blur on duplicated canvas layer. Performance-sensitive, may defer to Phase 2.
6. **Last known unit wireframes in stale zones** — Faint wireframe silhouettes of where units were last seen.
