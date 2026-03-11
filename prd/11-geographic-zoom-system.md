# Agent Empires — Geographic Zoom System

## Sub-PRD 11 — Three Altitudes of Command

**Parent PRD:** `01-vision.md` (Phase 3+)
**Dependencies:** `02a-intel-pipeline-spec.md` (Scout/Intel HQ), `02b-enemy-system-spec.md` (Enemy Bestiary), `04-autonomous-monitoring.md` (Monitoring Agents)
**System:** Multi-tier map renderer, zoom-driven layer compositor, geographic data ingestion
**Last updated:** 2026-03-10

---

> ### STATUS SUMMARY (Audit 2026-03-10)
>
> **Overall: NOT STARTED — pure spec, zero implementation**
>
> | Component | PRD Spec | Code Reality |
> |-----------|----------|--------------|
> | **Zoom tiers (theater/national/global)** | Three tiers with opacity cross-fade at 0.08-0.12 and 0.25-0.35 | `BattlefieldRenderer.ts` has a single linear zoom (0.15-2.0) with no tier detection, no layer compositor, no opacity curves |
> | **Semantic zoom (detail reduction at low zoom)** | Labels fade, roads thin, sprites shrink to dots at zoom < 0.3 | `UnitRenderer.setZoomScale()` counter-scales labels to stay readable — the opposite of PRD intent. `TerrainRenderer` renders at full detail regardless of zoom |
> | **National base map** | Stylized US map from GeoJSON, Magnetic Residue aesthetic | Does not exist. No geo assets, no `us-states-simplified.json`, no national renderer |
> | **Global base map** | World continent outlines, macro force visualization | Does not exist |
> | **ZoomController class** | Exponential zoom, tier detection, camera center interpolation | Does not exist. Zoom is handled inline in `BattlefieldRenderer.setupInputHandlers()` with linear delta |
> | **Aesthetic transition** | Parchment-to-Magnetic-Residue color/font lerp | Does not exist. Background is already dark (#16120E) — no parchment phase to transition from |
> | **Competitor/deal/macro data layers** | Monitor-fed markers at geographic positions | Does not exist. No monitors, no data sources, no national/global renderers |
>
> **What exists that PRD 11 can build on:**
> - `BattlefieldRenderer` already has pan/zoom with worldContainer transform — refactorable into ZoomController
> - `UnitRenderer.setZoomScale()` proves zoom-reactive rendering works — just needs to reduce detail instead of preserving it
> - The Magnetic Residue palette is already the default aesthetic (background `#16120E`, PAL constants in TerrainRenderer) — the parchment-to-MR transition is backwards from reality; the theater IS already MR
>
> **Blocking dependencies:** Monitor Orchestrator (PRD 04) for national/global data layers. Theater tier works standalone.

---

## Table of Contents

1. [Vision](#1-vision)
2. [Zoom Tier Specifications](#2-zoom-tier-specifications)
3. [Layer Architecture](#3-layer-architecture)
4. [Data Sources](#4-data-sources)
5. [Transition System](#5-transition-system)
6. [Implementation Plan](#6-implementation-plan)
7. [Dependencies](#7-dependencies)

---

## 1. Vision

Right now the war room shows one thing: your territory. Your agents, your domains, your threats. That's the tactical view — and it's the right default. But a general who only looks at the ground in front of his boots is going to get flanked by forces he never saw forming on the horizon.

The geographic zoom system adds two additional altitudes above the existing theater view. Pull back and your territory shrinks to a single glowing node on a stylized US map, surrounded by competitor positions, regional deal pipelines, and industry signals. Pull back further and the entire US becomes a node on a world map showing macro forces — rate changes, regulatory waves, platform shifts — rolling across the globe like weather systems.

Three altitudes. One camera. Smooth transitions. The general controls what level of strategic awareness they need at any moment by scrolling.

### Why This Matters

The theater view answers: "What is happening in my business right now?"
The national view answers: "What is happening in my market?"
The global view answers: "What is happening in the world that will hit my market next?"

These are three fundamentally different time horizons:
- **Theater:** Hours to days. Operational.
- **National:** Weeks to months. Competitive.
- **Global:** Months to quarters. Strategic.

Without all three, you're a general who can see his own troops but not the enemy army assembling over the hill, and definitely not the weather system that's about to turn the road to mud.

### Core Principles

1. **Nothing spawns without a data source.** This rule from `02b-enemy-system-spec.md` extends to every zoom tier. A competitor marker only appears if a monitoring agent detected it. A macro wave only appears if an API returned the data. No decorative threats.
2. **Information density scales with altitude.** Theater shows individual agents, individual enemies, individual file writes. National shows aggregated positions and regional patterns. Global shows broad forces and trend arrows. You cannot see individual agents from orbit. You should not see macro trends from the ground.
3. **Smooth transitions, not jump cuts.** Zooming from theater to national is a continuous camera pull. Layers cross-fade. Your territory morphs from a polygon map to a single node. There is no loading screen between tiers.
4. **The aesthetic is Magnetic Residue.** This is NOT the Napoleon parchment of the theater view. At national and global zoom, the map style shifts to a darker, more technical aesthetic — warm dark tones, vector outlines, phosphor glows. Think Cold War situation room projected onto magnetic residue film. The theater parchment fades into this as you zoom out.

---

## 2. Zoom Tier Specifications

### 2.1 Theater Tier — The Battlefield

| Property | Value |
|----------|-------|
| **Zoom range** | 0.3 - 2.0 (current default: 1.0) |
| **Base map** | Territory polygons (business domains), centered on Phoenix AZ |
| **Aesthetic** | Napoleon parchment (existing `06-napoleon-ui-design-system.md`) |
| **Font** | Playfair Display (headers), EB Garamond (body), JetBrains Mono (data) |
| **What's visible** | Individual agents (units), domain territories, enemy sprites, roads, buildings, fog of war |

This is the existing war room. Everything in `01-vision.md` through `10-phase2-unit-divisions.md` describes this tier. No changes to existing behavior.

**At the bottom of the theater zoom range (0.3)**, territorial detail begins to simplify:
- Agent unit labels fade out (unit shapes remain)
- Road connections become thinner
- Enemy sprites shrink to colored dots
- Territory names shift from full labels to abbreviations (e.g., "Fulfillment" becomes "FUL")

This visual simplification is the signal that you're about to cross into the national tier.

### 2.2 National Tier — The Campaign Map

| Property | Value |
|----------|-------|
| **Zoom range** | 0.08 - 0.3 |
| **Base map** | Stylized US map (vector outlines, no satellite imagery) |
| **Aesthetic** | Magnetic Residue (dark, warm, technical) |
| **Font** | JetBrains Mono exclusively |
| **What's visible** | Your base (Phoenix), competitor HQs, regional deal pipeline, industry signals |

The national tier is a completely different map layer that cross-fades in as you zoom past 0.3. Your theater territory — the detailed polygon map with agents and enemies — collapses into a single glowing node anchored at Phoenix, AZ.

#### Your Base Node

Your Phoenix node is not a simple dot. It is a miniaturized pulse of the theater:
- Outer ring color reflects overall health (phosphor green = healthy, amber = stressed, wax red = critical)
- Inner glow intensity maps to active agent count (more agents = brighter)
- A tiny activity sparkline orbits the node showing the last hour of hook events
- Hovering the node shows a tooltip with theater-level summary stats (agents active, threats pending, revenue today)
- Clicking the node triggers a smooth zoom back into theater tier

#### Competitor Positions

Competitor HQs render as enemy base markers on the US map. Each competitor gets a position based on their real headquarters location.

| Visual Property | Specification |
|----------------|---------------|
| **Shape** | Diamond with inner cross (fortress icon) |
| **Color** | Threat class purple from `02b` (`--regiment-purple` family) |
| **Size** | Scales with estimated competitor revenue/headcount (3 tiers: small/mid/large) |
| **Label** | Company name in JetBrains Mono, 9px, `#F0E4D0` cream |
| **Pulse** | Slow pulse if competitor had recent activity (new feature, funding round, acquisition) |
| **Connection lines** | Dashed lines to your base if you share customers or compete on the same deals |

Competitor data is NOT hardcoded. Competitors appear only when a monitoring agent (from `04-autonomous-monitoring.md`) writes a competitor intel record to Supabase. No monitoring agent, no competitor node.

#### Regional Deal Pipeline

Active deals from your CRM render as pipeline markers at their geographic locations:

| Deal Stage | Visual |
|-----------|--------|
| **Prospect** | Small hollow circle, cream `#F0E4D0`, 40% opacity |
| **Qualified** | Filled circle, amber `#FFB86C` |
| **Proposal sent** | Filled circle with outward pulse, orange `#E8682A` |
| **Negotiation** | Pulsing ring, bright orange |
| **Closed won** | Solid star, phosphor green `#82C896`, celebration particle burst on close |
| **Closed lost** | X mark, fades to 20% opacity over 7 days then disappears |

#### Industry Signals

Regional industry events render as semi-transparent wave overlays:

- **Conference/event:** Concentric ripple emanating from event city, teal `#4A9DB8`
- **Regulatory change:** Horizontal gradient bar across affected states, amber `#FFB86C`
- **Competitor launch:** Expanding ring from competitor's base node, purple with 15% opacity
- **Market growth signal:** Upward arrow icon at region center, phosphor green

### 2.3 Global Tier — The Strategic Horizon

| Property | Value |
|----------|-------|
| **Zoom range** | 0.02 - 0.08 |
| **Base map** | World map vector outline (continents only, no country borders except US) |
| **Aesthetic** | Magnetic Residue at maximum darkness |
| **Font** | JetBrains Mono, 8px for labels |
| **What's visible** | Macro forces, trend waves, global market indicators |

At global zoom, the entire US becomes a single region. Your base is still visible as a warm glow within the US outline. Everything else is macro.

#### Macro Force Visualization

Global-scale events render as weather-like systems moving across the world map:

| Force Type | Visual Treatment |
|-----------|-----------------|
| **Interest rate changes** | Slow-moving pressure fronts (red = rising, blue = falling) emanating from the country's central bank location |
| **AI regulation** | Amber hazard zones that expand over affected regions (EU AI Act as amber wash over Europe, etc.) |
| **Platform shifts** | Teal ripple waves from platform HQ (e.g., OpenAI policy change ripples from SF) |
| **Economic contraction** | Dark fog creeping over affected regions — uses the fog system from `06` but at continental scale |
| **Funding waves** | Green aurora-like glow over regions experiencing VC activity surges |

#### Trend Arrows

Large directional arrows overlay the map showing where macro momentum is heading:
- Arrow width = magnitude of the trend
- Arrow color = category (financial = amber, regulatory = orange, technology = teal)
- Arrow opacity = confidence level (strong signal = 80%, weak = 30%)
- Arrows animate slowly in their direction of travel (2px/second)

#### The US Detail

Even at global zoom, the US has slightly more detail than other regions:
- State outlines are faintly visible (5% opacity cream lines)
- Your base glow is always visible as a warm orange-cream dot
- Active deal regions within the US show as very subtle warm spots

---

## 3. Layer Architecture

The zoom system is a layer compositor, not three separate maps. Every element belongs to a layer, and each layer has an opacity curve tied to the zoom level.

### 3.1 Layer Stack (bottom to top)

```
Layer 0: GLOBAL_BASE      — World map vector outlines
Layer 1: GLOBAL_FORCES    — Macro trend waves, pressure fronts, arrows
Layer 2: NATIONAL_BASE    — US map vector outline with state boundaries
Layer 3: NATIONAL_MARKERS — Competitor nodes, deal pipeline, industry signals
Layer 4: THEATER_BASE     — Territory polygons (business domains)
Layer 5: THEATER_UNITS    — Agent units, enemy sprites, roads, buildings
Layer 6: HUD              — Resource bar, minimap, command panel (always visible)
```

### 3.2 Opacity Curves

Each layer has an opacity function `f(zoom) -> [0.0, 1.0]`:

```typescript
interface LayerOpacity {
  layer: string
  opacity: (zoom: number) => number
}

const LAYER_OPACITIES: LayerOpacity[] = [
  {
    layer: 'GLOBAL_BASE',
    opacity: (z) => z < 0.05 ? 1.0 :
                     z < 0.12 ? lerp(1.0, 0.0, (z - 0.05) / 0.07) :
                     0.0
  },
  {
    layer: 'GLOBAL_FORCES',
    opacity: (z) => z < 0.06 ? 1.0 :
                     z < 0.10 ? lerp(1.0, 0.0, (z - 0.06) / 0.04) :
                     0.0
  },
  {
    layer: 'NATIONAL_BASE',
    opacity: (z) => z < 0.08 ? 0.3 :   // faintly visible even at global
                     z < 0.12 ? lerp(0.3, 1.0, (z - 0.08) / 0.04) :
                     z < 0.28 ? 1.0 :
                     z < 0.35 ? lerp(1.0, 0.0, (z - 0.28) / 0.07) :
                     0.0
  },
  {
    layer: 'NATIONAL_MARKERS',
    opacity: (z) => z < 0.10 ? 0.0 :
                     z < 0.15 ? lerp(0.0, 1.0, (z - 0.10) / 0.05) :
                     z < 0.25 ? 1.0 :
                     z < 0.32 ? lerp(1.0, 0.0, (z - 0.25) / 0.07) :
                     0.0
  },
  {
    layer: 'THEATER_BASE',
    opacity: (z) => z < 0.25 ? 0.0 :
                     z < 0.35 ? lerp(0.0, 1.0, (z - 0.25) / 0.10) :
                     1.0
  },
  {
    layer: 'THEATER_UNITS',
    opacity: (z) => z < 0.30 ? 0.0 :
                     z < 0.40 ? lerp(0.0, 1.0, (z - 0.30) / 0.10) :
                     1.0
  },
  {
    layer: 'HUD',
    opacity: () => 1.0  // always visible
  }
]
```

The overlap zones (0.08-0.12 for global-to-national, 0.25-0.35 for national-to-theater) create the cross-fade effect. During these transitions, both the departing and arriving layers are partially visible simultaneously.

### 3.3 Canvas Renderer Changes

The existing `CanvasRenderer` needs to become zoom-tier-aware:

```typescript
interface ZoomTier {
  id: 'theater' | 'national' | 'global'
  zoomRange: [number, number]
  center: { lat: number, lng: number }  // geographic anchor
  layers: string[]
  renderFn: (ctx: CanvasRenderingContext2D, viewport: Viewport) => void
}

const ZOOM_TIERS: ZoomTier[] = [
  {
    id: 'theater',
    zoomRange: [0.3, 2.0],
    center: { lat: 33.4484, lng: -112.0740 },  // Phoenix, AZ
    layers: ['THEATER_BASE', 'THEATER_UNITS'],
    renderFn: renderTheaterTier
  },
  {
    id: 'national',
    zoomRange: [0.08, 0.3],
    center: { lat: 39.8283, lng: -98.5795 },  // Geographic center of US
    layers: ['NATIONAL_BASE', 'NATIONAL_MARKERS'],
    renderFn: renderNationalTier
  },
  {
    id: 'global',
    zoomRange: [0.02, 0.08],
    center: { lat: 20.0, lng: 0.0 },  // Centered on Atlantic
    layers: ['GLOBAL_BASE', 'GLOBAL_FORCES'],
    renderFn: renderGlobalTier
  }
]
```

### 3.4 The "Your Base" Collapse

The most visually complex transition is the theater-to-national morph. As zoom crosses from 0.35 down to 0.25:

1. **Territory polygons** shrink toward Phoenix center point (CSS transform-origin set to Phoenix coords)
2. **Agent units** accelerate toward the center, trailing phosphor green streaks
3. **Enemy sprites** fade to colored dots, then disappear
4. **Territory polygon** morphs into a circular node via SVG path interpolation (polygon vertices lerp toward circle arc points)
5. **The node settles** at Phoenix's geographic coordinates on the national map
6. **Health ring appears** around the node — color derived from the worst active threat

Reversing (zooming in from national to theater) plays this in reverse: the node expands, polygon vertices spread back to territory positions, units emerge from the center and slide to their positions.

Total transition duration: 400ms at normal scroll speed. The animation is zoom-position-driven, not time-driven — pausing the scroll pauses the morph mid-transition.

---

## 4. Data Sources

### 4.1 Theater Tier Data (Existing)

Already built or spec'd in other PRDs:

| Data | Source | PRD Reference |
|------|--------|---------------|
| Agent positions & status | Hook system via WebSocket | `01-vision.md` |
| Enemy sprites | ThreatDataBridge → enemy spawner | `02b-enemy-system-spec.md` |
| Territory health | Supabase realtime queries | `04-autonomous-monitoring.md` |
| Fog of war | Monitor freshness timestamps | `04-autonomous-monitoring.md` |
| Intel markers | Scout pipeline → Intel HQ | `02a-intel-pipeline-spec.md` |

### 4.2 National Tier Data (New)

| Data | Source | Update Frequency | Cost |
|------|--------|-------------------|------|
| **Competitor HQ locations** | Manual config + monitoring agent enrichment | Weekly refresh | $0 (one-time research per competitor) |
| **Competitor activity** | RSS feeds (company blogs, press releases), Crunchbase free tier | Every 6 hours | $0 |
| **Deal pipeline by region** | Supabase `deals` table (city/state fields) or CRM API | Real-time (Supabase Realtime) | $0 |
| **Industry events** | Conference API aggregators, RSS feeds | Daily | $0 |
| **Regional market signals** | Google Trends API (free), industry subreddits via RSS | Every 12 hours | $0 |

#### Competitor Config

Competitors are defined in a config file, not hardcoded in the renderer:

```typescript
// server/config/competitors.ts
interface CompetitorConfig {
  id: string
  name: string
  hq: { lat: number, lng: number, city: string, state: string }
  tier: 'small' | 'mid' | 'large'
  monitorSources: string[]  // RSS URLs, API endpoints
  threatClasses: string[]   // Which threat classes they can trigger
}

const COMPETITORS: CompetitorConfig[] = [
  {
    id: 'competitor-jasper',
    name: 'Jasper',
    hq: { lat: 30.2672, lng: -97.7431, city: 'Austin', state: 'TX' },
    tier: 'large',
    monitorSources: [
      'https://www.jasper.ai/blog/feed',
      'https://news.crunchbase.com/feed/?company=jasper-ai'
    ],
    threatClasses: ['Competitive', 'Content']
  }
  // ... more competitors
]
```

#### Competitor Monitor

New monitor class extending the `04-autonomous-monitoring.md` MonitorOrchestrator:

```typescript
// server/monitors/competitor-monitor.ts
class CompetitorMonitor implements Monitor {
  id = 'competitor-monitor'
  intervalMs = 6 * 60 * 60 * 1000  // 6 hours
  territories = ['Lead-Gen', 'Sales']

  async poll(): Promise<IntelRecord[]> {
    const competitors = loadCompetitorConfig()
    const findings: IntelRecord[] = []

    for (const competitor of competitors) {
      for (const source of competitor.monitorSources) {
        const items = await fetchRSS(source)
        const newItems = filterSinceLastCheck(items, competitor.id)

        for (const item of newItems) {
          findings.push({
            source: 'competitor-monitor',
            category: 'competitive',
            severity: classifySeverity(item, competitor.tier),
            geo: competitor.hq,
            payload: {
              competitorId: competitor.id,
              title: item.title,
              url: item.link,
              published: item.pubDate
            }
          })
        }
      }
    }

    return findings
  }
}
```

### 4.3 Global Tier Data (New)

| Data | Source | Update Frequency | Cost |
|------|--------|-------------------|------|
| **Interest rates** | FRED API (Federal Reserve Economic Data, free) | Daily | $0 |
| **AI regulation tracking** | RSS feeds (EU AI Act tracker, US Congress AI bills) | Daily | $0 |
| **Platform policy changes** | Anthropic/OpenAI/Google blog RSS | Every 6 hours | $0 |
| **VC funding trends** | Crunchbase free tier, TechCrunch RSS | Daily | $0 |
| **News sentiment** | RSS feed aggregation + simple keyword scoring (no LLM needed) | Every 12 hours | $0 |

#### Macro Force Ingestion

Global data does NOT need AI to interpret. The monitor ingests structured data and maps it to force types:

```typescript
// server/monitors/macro-monitor.ts
interface MacroForce {
  type: 'rate_change' | 'regulation' | 'platform_shift' | 'contraction' | 'funding_wave'
  origin: { lat: number, lng: number }  // Geographic source of the force
  affectedRegions: GeoRegion[]          // Where it impacts
  magnitude: number                      // 0.0 - 1.0, drives visual size
  direction: 'incoming' | 'receding'
  confidence: number                     // 0.0 - 1.0, drives opacity
  source: string                         // URL or API that provided the data
  detectedAt: number                     // Unix timestamp
}
```

The key insight: macro forces are mapped to geographic origins. A Fed rate change originates from Washington DC. An EU AI regulation originates from Brussels. A platform shift originates from the platform company's HQ. This geographic anchoring makes them feel real on the map — they're coming from somewhere, heading somewhere.

---

## 5. Transition System

### 5.1 Zoom Controller

The zoom controller manages the continuous zoom variable and determines which tier is "active" (for interaction and data loading purposes):

```typescript
class ZoomController {
  private zoom: number = 1.0  // Start at theater default
  private activeTier: ZoomTier

  // Zoom is exponential, not linear.
  // Each scroll notch multiplies/divides by 1.15.
  // This means it takes ~15 scrolls to go from theater (1.0) to global (0.02).
  private readonly ZOOM_FACTOR = 1.15
  private readonly ZOOM_MIN = 0.02
  private readonly ZOOM_MAX = 2.0

  handleWheel(deltaY: number) {
    const direction = deltaY > 0 ? 'out' : 'in'
    this.zoom = direction === 'out'
      ? Math.max(this.ZOOM_MIN, this.zoom / this.ZOOM_FACTOR)
      : Math.min(this.ZOOM_MAX, this.zoom * this.ZOOM_FACTOR)

    this.activeTier = this.determineTier(this.zoom)
    this.updateLayerOpacities(this.zoom)
    this.updateCameraCenter(this.zoom)
  }

  private determineTier(z: number): ZoomTier {
    if (z >= 0.3) return ZOOM_TIERS[0]  // theater
    if (z >= 0.08) return ZOOM_TIERS[1] // national
    return ZOOM_TIERS[2]                 // global
  }

  // Camera center smoothly interpolates between tier centers
  private updateCameraCenter(z: number) {
    const phoenixCenter = { lat: 33.4484, lng: -112.0740 }
    const usCenter = { lat: 39.8283, lng: -98.5795 }
    const globalCenter = { lat: 20.0, lng: 0.0 }

    if (z >= 0.3) {
      this.cameraCenter = phoenixCenter
    } else if (z >= 0.08) {
      // Lerp from Phoenix to US center as we zoom out through national tier
      const t = (0.3 - z) / (0.3 - 0.08)
      this.cameraCenter = lerpGeo(phoenixCenter, usCenter, t)
    } else {
      // Lerp from US center to global center
      const t = (0.08 - z) / (0.08 - 0.02)
      this.cameraCenter = lerpGeo(usCenter, globalCenter, t)
    }
  }
}
```

### 5.2 Aesthetic Transition

The visual style itself transitions between tiers. This is the "parchment to magnetic residue" shift:

```typescript
interface AestheticState {
  bgColor: string
  mapStrokeColor: string
  mapStrokeWidth: number
  fontFamily: string
  glowIntensity: number
  gridVisible: boolean
}

const THEATER_AESTHETIC: AestheticState = {
  bgColor: '#F5ECD7',          // parchment-light
  mapStrokeColor: '#2C2410',   // ink-dark
  mapStrokeWidth: 2,
  fontFamily: 'Playfair Display, Georgia, serif',
  glowIntensity: 0.0,
  gridVisible: false
}

const NATIONAL_AESTHETIC: AestheticState = {
  bgColor: '#16120E',          // magnetic residue deep
  mapStrokeColor: '#F0E4D0',   // cream outlines on dark
  mapStrokeWidth: 1.5,
  fontFamily: 'JetBrains Mono, monospace',
  glowIntensity: 0.6,
  gridVisible: true             // subtle coordinate grid
}

const GLOBAL_AESTHETIC: AestheticState = {
  bgColor: '#16120E',          // same deep dark
  mapStrokeColor: '#F0E4D040', // cream at 25% — fainter outlines
  mapStrokeWidth: 1,
  fontFamily: 'JetBrains Mono, monospace',
  glowIntensity: 0.8,          // more glow, less line
  gridVisible: true
}
```

During transition zones, these aesthetics are lerped. The parchment background color smoothly darkens to `#16120E`. Map stroke colors brighten and thin. The serif font cross-fades to monospace (achieved by rendering both with inverse opacity and matching positions).

### 5.3 Magnetic Residue Palette (Full Specification)

The national and global tiers use this palette exclusively:

| Token | Hex | Usage |
|-------|-----|-------|
| `--mr-deep` | `#16120E` | Primary background, void |
| `--mr-surface` | `#1A1510` | Panel backgrounds, card surfaces |
| `--mr-elevated` | `#231E17` | Hover states, raised elements |
| `--mr-cream` | `#F0E4D0` | Primary text, map outlines, labels |
| `--mr-cream-dim` | `#F0E4D060` | Secondary text, 37% opacity |
| `--mr-orange` | `#E8682A` | Primary accent, active states, your base glow |
| `--mr-phosphor` | `#82C896` | Success, health, active agents |
| `--mr-teal` | `#4A9DB8` | Intel, events, platform signals |
| `--mr-amber` | `#FFB86C` | Warnings, deals, financial data |
| `--mr-red` | `#C94040` | Critical threats, losses |

Glow effects use these colors at 20-40% opacity with CSS `box-shadow` or canvas `shadowBlur`. Lines are crisp 1px vectors — no anti-aliased softness. The effect should feel like a phosphor display photographed on magnetic tape.

### 5.4 Map Geometry

The national and global maps are NOT raster images. They are vector path data rendered on canvas.

**US Map:** GeoJSON simplified to ~2000 points (state boundaries). Source: US Census Bureau TIGER/Line shapefiles, simplified via mapshaper to reduce complexity. Stored as a static JSON asset:

```
client/assets/geo/us-states-simplified.json     (~50KB)
client/assets/geo/world-continents-simplified.json  (~30KB)
```

**World Map:** Natural Earth 110m resolution continent outlines. No country borders, no city markers (those come from data layers).

Both are projected using Mercator for simplicity (this is a war room, not a cartography tool — nobody will complain about Greenland being too big).

---

## 6. Implementation Plan

### Phase 3A — National Tier Foundation

**Estimated effort:** 2-3 build sessions

1. **Geo asset pipeline** — Download, simplify, convert US states + world continents to canvas-renderable path data. Store as static JSON.
2. **Layer compositor** — Refactor `CanvasRenderer` to support the layer stack with zoom-driven opacity curves. Each layer gets its own off-screen canvas for independent opacity control.
3. **Zoom controller** — Replace current linear zoom with exponential zoom. Add tier detection and camera center interpolation.
4. **National base map** — Render US state outlines in Magnetic Residue style. Static — no data layers yet.
5. **"Your base" node** — Implement the theater-to-node collapse animation. Phoenix glow node with health ring.
6. **Aesthetic transition** — Background color lerp, font cross-fade, glow intensity ramp during transition zones.

### Phase 3B — National Data Layers

**Estimated effort:** 2 build sessions

1. **Competitor config + monitor** — `competitors.ts` config file, `CompetitorMonitor` class integrated with MonitorOrchestrator. RSS feed polling.
2. **Competitor renderer** — Diamond fortress icons at geographic positions. Pulse on activity. Dashed connection lines.
3. **Deal pipeline renderer** — Read deal locations from Supabase, render pipeline markers. Stage-based visual treatment.
4. **Industry signal renderer** — RSS-sourced event markers, conference ripples, regional gradient overlays.

### Phase 3C — Global Tier

**Estimated effort:** 2 build sessions

1. **Global base map** — World continent outlines at maximum Magnetic Residue darkness.
2. **Macro force monitors** — FRED API monitor (rates), RSS aggregator (regulation, platform news), Crunchbase free tier (funding).
3. **Force renderer** — Pressure fronts, hazard zones, ripple waves, fog creep. Each force type has its own canvas draw routine.
4. **Trend arrows** — Directional magnitude arrows with animated travel. Width/color/opacity from data.
5. **US detail at global zoom** — Faint state outlines, base glow, deal region warm spots.

### Phase 3D — Polish & Integration

**Estimated effort:** 1 build session

1. **Minimap at all tiers** — The HUD minimap shows a thumbnail of the tier two levels below (at national, minimap shows theater; at global, minimap shows national).
2. **Keyboard shortcuts** — `1` = snap to theater, `2` = snap to national, `3` = snap to global. Animated transitions between snap points.
3. **Tier indicator** — Small label in HUD corner showing current tier name and zoom percentage.
4. **Performance profiling** — Ensure 60fps at all tiers. Global tier should be cheapest (fewest elements). National tier is the rendering challenge (most marker types).
5. **Data source health** — Extend the freshness dashboard from `04` to show national/global monitor health. If the competitor monitor dies, competitor nodes fog up.

---

## 7. Dependencies

### 7.1 Must Be Built First

| Dependency | PRD | Status | Why Required |
|-----------|-----|--------|--------------|
| Territory renderer | `01-vision.md` | Phase 1 built | Theater tier IS this — zoom system wraps it |
| Enemy system | `02b-enemy-system-spec.md` | Phase 1 built | Theater enemies need to survive the zoom refactor |
| Monitor orchestrator | `04-autonomous-monitoring.md` | Phase 2 | National/global data layers feed through monitors |
| HUD system | `06-napoleon-ui-design-system.md` | Phase 1 built | HUD must remain visible across tiers |

### 7.2 New External Dependencies

| Dependency | Purpose | License | Bundle Impact |
|-----------|---------|---------|---------------|
| GeoJSON path data (US states) | National base map | Public domain (Census Bureau) | ~50KB static JSON |
| GeoJSON path data (world) | Global base map | Public domain (Natural Earth) | ~30KB static JSON |
| FRED API | Interest rate data | Free, no key required for basic access | API calls only |
| RSS parser (e.g., `fast-xml-parser`) | Competitor/news monitoring | MIT | ~15KB |

No paid APIs. No mapping libraries (Mapbox, Leaflet, Google Maps). The maps are rendered directly on canvas from simplified GeoJSON coordinates. This keeps the bundle small, the aesthetic fully controlled, and the cost at $0.

### 7.3 Does NOT Depend On

- Phase 4+ features (resource economy, tech tree)
- Any specific CRM integration (deal data is read from Supabase — whatever writes to Supabase is the CRM adapter's problem)
- Mobile support (this is a desktop war room)
- Real-time collaboration (single general, single war room)

---

## Appendix A: Magnetic Residue Reference Board

The Magnetic Residue aesthetic draws from:
- Cold War situation room photography (dark rooms, glowing projection maps)
- Magnetic tape residue patterns (warm analog noise, no digital clean lines)
- Phosphor CRT displays (green/amber text on dark, slight bloom)
- Topographic military maps shot on film (high contrast, warm shadows)

It is the visual opposite of the theater's Napoleon parchment — and that contrast IS the point. Zooming out doesn't just show more geography. It shifts the emotional register from "field commander in a tent" to "intelligence director in a bunker." The war room gets colder and more technical as the altitude increases.

## Appendix B: Zoom Math Quick Reference

```
Zoom 2.00  ████████████████████████ Theater (max zoom in)
Zoom 1.00  ████████████████         Theater (default)
Zoom 0.50  ████████████             Theater (pulled back)
Zoom 0.30  ██████████  ─── TRANSITION ZONE ─── Theater → National
Zoom 0.20  ████████                 National
Zoom 0.12  ██████                   National
Zoom 0.08  █████   ─── TRANSITION ZONE ─── National → Global
Zoom 0.05  ███                      Global
Zoom 0.02  ██                       Global (max zoom out)

Scroll notches from default (1.0) to full global (0.02):
  1.0 → 0.87 → 0.76 → 0.66 → 0.57 → 0.50 → 0.43 → 0.37 → 0.33 → 0.28
  → 0.25 → 0.21 → 0.19 → 0.16 → 0.14 → 0.12 → 0.10 → 0.09 → 0.08
  → 0.07 → 0.06 → 0.05 → 0.04 → 0.03 → 0.02

  ~25 scroll notches from theater default to full global.
  ~10 scroll notches from theater to national.
  ~7 scroll notches from national to global.
```
