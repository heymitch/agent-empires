# 06 — Napoleon UI Design System

## Status (as of 2026-03-10)

**Overall: SPEC-ONLY — not yet implemented.**

The current codebase uses a different visual direction:

| PRD 06 Spec | What's Actually Shipped |
|---|---|
| Parchment palette (`#F5ECD7`, `#E8D9B5`) | Cyberpunk dark (`#0a0a0f`, `#12121a`, `#1a1a2e`) |
| Ink text colors (`#1A1408` family) | Light-on-dark (`#e0e0e0`, `#808090`) |
| Brass/gold accents (`#C9A84C`) | Neon accents (`#00ffcc`, `#7b68ee`, `#ff3366`) |
| Regiment colors (muted military) | "Magnetic Residue" palette in `TerrainRenderer.ts` (warm dark tones) |
| Fonts: Playfair Display, EB Garamond, Libre Baskerville | Fonts: Orbitron, JetBrains Mono, Inter |
| Napoleon parchment/leather textures | No textures (flat dark surfaces) |
| Night mode (candlelight dimming) | Not implemented |
| Fog as dark sepia wash | Fog uses dark opacity overlay (`FogOfWar.ts`) — closer to spec than CSS |

**What IS partially aligned:**
- Fog of war concept (implemented in `FogOfWar.ts`, uses opacity-based approach)
- Territory colors as regiment identity (implemented, but with different hues)
- Minimap layout and behavior (implemented in `MinimapRenderer.ts`)
- Sound synthesis approach (Web Audio API, no files — matches Section 4 intent)

**Asset checklist status:**
- Fonts: Google Fonts listed but NOT loaded (different fonts in use)
- SVG Icons: 0 of ~43 icons created
- Textures: 0 of 4 textures created
- Sounds: Synthesized via Web Audio API (matches spec intent, different timbres)

**Decision needed:** Adopt Napoleon palette as planned, or formalize the current dark "Magnetic Residue" direction as the new design system.

---

## The War Room Aesthetic

Every pixel of Agent Empires should feel like Napoleon's command tent the night before Austerlitz. Hand-inked maps on parchment. Brass figurines marking unit positions. Wax-sealed dispatches arriving by courier. A field desk with quill and ink. Candlelight casting warm shadows across strategic documents. This is not a tech dashboard — it is a war room that happens to display real-time business data.

---

## 1. Visual Design Language

### 1.1 Color Palette

#### Primary Surfaces

| Token | Hex | Usage |
|-------|-----|-------|
| `--parchment-light` | `#F5ECD7` | Primary background, map base |
| `--parchment-mid` | `#E8D9B5` | Panel backgrounds, card surfaces |
| `--parchment-dark` | `#D4C49A` | Hover states, secondary surfaces |
| `--parchment-aged` | `#C7B88A` | Borders, dividers, aged edges |
| `--parchment-stain` | `#B8A67E` | Watermarks, subtle decoration |

#### Ink & Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--ink-black` | `#1A1408` | Primary text, bold map lines |
| `--ink-dark` | `#2C2410` | Secondary text, territory borders |
| `--ink-mid` | `#4A3F2F` | Body text, labels |
| `--ink-light` | `#6B5D4A` | Muted text, timestamps |
| `--ink-faded` | `#8C7D66` | Placeholders, disabled text |
| `--ink-ghost` | `#A89880` | Grid lines, watermarks |

#### Brass & Gold (Resources, Achievements)

| Token | Hex | Usage |
|-------|-----|-------|
| `--brass-highlight` | `#F0D78C` | Active gold, revenue flash |
| `--brass-primary` | `#C9A84C` | Resource icons, score plaque |
| `--brass-mid` | `#A6883A` | Brass frames, borders |
| `--brass-dark` | `#7A6428` | Brass shadows, depth |
| `--brass-patina` | `#5C6B4A` | Aged brass, background accents |

#### Regiment Colors (Territory / Domain Identity)

| Territory | Token | Hex | Inspired By |
|-----------|-------|-----|-------------|
| Lead-Gen | `--regiment-blue` | `#2B4570` | French Imperial Guard blue |
| Sales | `--regiment-crimson` | `#8B2500` | British redcoat, artillery |
| Fulfillment | `--regiment-green` | `#2E5A3A` | Rifle brigade green |
| Support | `--regiment-amber` | `#8B6914` | Signal corps gold |
| Retention | `--regiment-purple` | `#4A2860` | Royal engineer violet |
| HQ / Home | `--regiment-silver` | `#6B7B8D` | Command staff grey |

Each regiment color has three tints for map rendering:

```
--regiment-blue-wash: #2B457020   (territory fill, 12% opacity)
--regiment-blue-mid:  #2B457060   (territory border, 37% opacity)
--regiment-blue-full: #2B4570     (unit badges, icons, full opacity)
```

Apply the same pattern (`20`, `60`, full) for all six regiment colors.

#### Alert / Threat Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--wax-red` | `#8B1A1A` | Critical alerts, enemy units, wax seal |
| `--wax-red-bright` | `#B22222` | Active threat pulse |
| `--wax-red-glow` | `#D4382220` | Alert glow (12% opacity) |
| `--alert-amber` | `#B8860B` | Warning, aging ticket |
| `--alert-amber-glow` | `#B8860B20` | Warning glow |
| `--success-olive` | `#556B2F` | Victory, task complete |
| `--success-olive-bright` | `#6B8E23` | Success flash |

#### Fog of War

| Token | Hex | Usage |
|-------|-----|-------|
| `--fog-light` | `#1A140830` | 18% opacity — slight staleness |
| `--fog-mid` | `#1A140860` | 37% opacity — stale data |
| `--fog-heavy` | `#1A1408A0` | 62% opacity — very stale |
| `--fog-full` | `#1A1408D0` | 81% opacity — no data, nearly blind |
| `--fog-edge` | `#D4C49A` | Fog boundary blends into parchment |

Fog is NOT pure black. It is a dark sepia wash — like ink pooling on parchment. Edges are feathered, not hard.

#### Night Mode (Candlelight)

Night mode does not invert colors. It dims the war room as if candles are the only light source:

| Token | Hex | Usage |
|-------|-----|-------|
| `--night-bg` | `#1C1610` | Deep warm dark |
| `--night-surface` | `#2A2218` | Panel backgrounds |
| `--night-parchment` | `#3D3225` | Map surface |
| `--night-text` | `#C7B88A` | Text flips to parchment tone |
| `--night-brass` | `#D4A84C` | Brass gets warmer |
| `--candle-glow` | `#F5D78C40` | 25% opacity warm vignette at edges |
| `--candle-flicker` | `#F0C86030` | Subtle animated overlay |

In night mode, a subtle radial gradient from `--candle-glow` emanates from the center of the screen, fading to `--night-bg` at the edges — simulating candlelight on parchment.

### 1.2 Typography

#### Font Stack

```css
/* Commanding headers — Playfair Display (Google Fonts) */
--font-display: 'Playfair Display', 'Georgia', 'Times New Roman', serif;

/* Period-appropriate body — EB Garamond (Google Fonts) */
--font-body: 'EB Garamond', 'Garamond', 'Georgia', serif;

/* Tabular numbers for resources — Libre Baskerville (Google Fonts) */
--font-numbers: 'Libre Baskerville', 'Georgia', serif;

/* Technical data, file paths, tool calls — JetBrains Mono (Google Fonts) */
--font-mono: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;

/* Small labels, status badges — Cormorant SC (Google Fonts, small caps) */
--font-label: 'Cormorant SC', 'Georgia', serif;
```

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Libre+Baskerville:wght@400;700&family=JetBrains+Mono:wght@400;500&family=Cormorant+SC:wght@400;600;700&display=swap
```

#### Type Scale

| Level | Font | Weight | Size | Line Height | Letter Spacing | Usage |
|-------|------|--------|------|-------------|----------------|-------|
| `--type-title` | Display | 900 | 28px | 1.2 | 0.02em | Campaign name, victory banners |
| `--type-h1` | Display | 700 | 22px | 1.25 | 0.015em | Panel headers, territory names |
| `--type-h2` | Display | 700 | 18px | 1.3 | 0.01em | Section headers, unit names |
| `--type-h3` | Body | 600 | 16px | 1.35 | 0 | Sub-headers, tab labels |
| `--type-body` | Body | 400 | 14px | 1.5 | 0 | Intel feed, descriptions |
| `--type-body-sm` | Body | 400 | 13px | 1.45 | 0 | Secondary info, timestamps |
| `--type-caption` | Label | 600 | 11px | 1.3 | 0.08em | Status badges, small labels (all caps) |
| `--type-number` | Numbers | 700 | 16px | 1.0 | 0.02em | Resource counters, scores |
| `--type-number-lg` | Numbers | 700 | 24px | 1.0 | 0.02em | Score plaque, revenue |
| `--type-mono` | Mono | 400 | 12px | 1.4 | 0 | Tool calls, file paths |
| `--type-mono-sm` | Mono | 400 | 11px | 1.35 | 0 | Inline code, session IDs |

All number fonts use `font-variant-numeric: tabular-nums;` so columns of numbers align.

### 1.3 Iconography

All icons are rendered as SVG with a hand-drawn/engraved style — think copper-plate engraving from a Napoleonic field manual. Stroke-based, not filled. 1.5px stroke width at default size (20px).

#### Resource Icons

| Resource | Icon | Description |
|----------|------|-------------|
| Revenue (Gold) | Five-pointed star medal | Star with laurel wreath — like a military decoration |
| Context Tokens (Supply) | Powder keg | Small barrel silhouette with measurement lines |
| API Credits (Mana) | Hourglass | Sand timer, fills/drains to show remaining |
| Population Cap | Tent | Military tent silhouette with count overlay |
| Score | Brass plaque | Rectangular plate with engraved number |
| Time | Pocket watch | Open-face pocket watch, hands show time |

#### Unit Type Badges

| Unit | Badge | Description |
|------|-------|-------------|
| Commander | Crown | Simple crown with three points |
| Lieutenant | Shield | Heraldic shield with domain regiment color |
| Scout | Spyglass | Collapsed telescope at angle |
| Writer | Quill | Feather quill with ink drop |
| Engineer | Dividers | Compass/dividers tool (drafting instrument) |
| Operative | Crossed swords | Two sabers crossed at midpoint |
| Medic | Cross | Simple cross with serif ends |
| Diplomat | Olive branch | Single branch with leaves |

Each badge renders at 24x24px on the map, 16x16px in the roster panel. The badge background circle uses the regiment color of the unit's current territory.

#### Territory Heraldic Shields

Each territory has a small heraldic shield icon displayed at its center on the map and in the tab bar:

| Territory | Shield Element | Description |
|-----------|---------------|-------------|
| Lead-Gen | Trumpet | Herald's trumpet — announcing, broadcasting |
| Sales | Sword | Upright sword — closing deals, conquest |
| Fulfillment | Anvil | Blacksmith's anvil — building, forging |
| Support | Shield wall | Overlapping shields — defense, protection |
| Retention | Chain links | Interlocked chain — loyalty, binding |
| HQ | Eagle | Spread-wing eagle — command, oversight |

#### Status Signal Flags

| Status | Flag | Color |
|--------|------|-------|
| Idle | White pennant | `--parchment-light` with `--ink-light` border |
| Working | Green pennant | `--success-olive` |
| Waiting | Amber pennant | `--alert-amber` |
| Offline | Black pennant (lowered) | `--ink-dark` |
| Alert | Red pennant (waving) | `--wax-red` |

Flags are 8x12px pennants attached to unit sprites, fluttering with a 2-frame CSS animation.

#### Navigation

| Element | Icon |
|---------|------|
| Compass / Pan | 8-point compass rose |
| Zoom In | Spyglass (extended) |
| Zoom Out | Spyglass (collapsed) |
| Center on HQ | Eagle landing |
| Toggle Grid | Drafting square |
| Toggle Fog | Lantern |
| Settings | Gear (pocket watch style) |

### 1.4 Textures and Materials

All textures are tiling, loaded as PNG or generated procedurally in PixiJS/CSS.

#### Parchment Paper (Primary Surface)

A seamless 512x512px parchment tile with:
- Base color: `--parchment-light`
- Subtle fiber texture (very low contrast noise, ~3% variation)
- Occasional darker spots simulating age stains (placed randomly via shader, not baked)
- No creases or folds on the main map (those are reserved for panel edges)

Generate procedurally in PixiJS for the map, use a CSS background-image for HTML panels.

#### Aged/Weathered Edges

Panel borders use a torn/deckled edge effect:
- Inner content has clean edges
- Outer 4px border has irregular opacity (a 1D noise mask applied to the border)
- CSS implementation: `border-image` with a pre-rendered torn-edge PNG strip

For simpler implementation, use a `box-shadow` approach:
```css
.panel-aged-edge {
  box-shadow:
    inset 0 0 20px rgba(180, 160, 120, 0.3),
    inset 0 0 60px rgba(140, 120, 80, 0.1);
}
```

#### Brass Frame Borders

Important panels (score plaque, selected unit, campaign header) get brass borders:
- 2px solid `--brass-mid`
- Outer glow: `0 0 8px rgba(201, 168, 76, 0.2)`
- Corner accents: small brass rosette SVGs at each corner (optional, only on the score plaque)

#### Wax Seal Stamps

Achievement and alert indicators use wax seal circles:
- Circle: 28px diameter
- Color: `--wax-red` for alerts, `--brass-primary` for achievements
- Embossed texture: CSS `radial-gradient` + `box-shadow` for 3D effect
- Center content: number (alert count) or icon (achievement type)

```css
.wax-seal {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #B22222, #8B1A1A 60%, #6B1010);
  box-shadow:
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    inset 0 2px 2px rgba(255, 200, 200, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.25);
  color: #F5ECD7;
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
}
```

#### Ink Splatter Decoration

Subtle ink drops placed sparingly on panel corners and dividers:
- 3-4 small SVG splatter shapes (5-15px)
- Color: `--ink-ghost` (very faint)
- Placed via CSS `::before`/`::after` pseudo-elements
- Not animated — static decoration

#### Leather Texture (Command Bar)

The bottom command bar has a leather surface:
- Dark brown base: `#2A1F14`
- Subtle grain via CSS noise or background-image
- Stitching line: 1px dashed `--brass-dark` along top edge

```css
.command-bar-leather {
  background-color: #2A1F14;
  background-image: url("data:image/svg+xml,..."); /* tiny noise SVG, inline */
  border-top: 1px dashed var(--brass-dark);
}
```

#### Canvas/Tent Fabric (App Background)

Behind all panels and the map, the outermost background is tent canvas:
- Color: `#3D352B`
- Very subtle crosshatch/weave pattern (CSS repeating-linear-gradient)
- Visible only at the very edges of the screen and between panels

```css
.app-background {
  background-color: #3D352B;
  background-image:
    repeating-linear-gradient(
      0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px
    ),
    repeating-linear-gradient(
      90deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px
    );
}
```

---

## 2. HUD Layout — The War Table

### 2.1 Layout Grid (1920x1080)

```
┌──────────────────────────────────────────────────────────────────────┐
│ DISPATCH BANNER (top bar) — 1920 x 48px                             │
├────────────┬────────────────────────────────────────┬────────────────┤
│            │                                        │                │
│  ORDER OF  │         BATTLEFIELD MAP                │  INTELLIGENCE  │
│  BATTLE    │         (PixiJS Canvas)                │  DESK          │
│            │                                        │                │
│  260px     │         Fills remaining space           │  300px         │
│  wide      │         (~1360px at 1920)              │  wide          │
│            │                                        │                │
│  Left      │         Center                         │  Right         │
│  Panel     │                                        │  Panel         │
│            │                                        │                │
│            │                                        │                │
├────────────┴───────────┬────────────────────────────┴────────────────┤
│ MINIMAP (200x150)      │ COMMAND TENT (bottom bar) — fills remaining │
│ + QUICK ACTIONS        │ height: 120px                               │
│ width: 260px           │                                             │
└────────────────────────┴─────────────────────────────────────────────┘
```

Total breakdown:
- **Top bar**: full width x 48px
- **Left panel**: 260px x (1080 - 48 - 120) = 260 x 912px
- **Center canvas**: (1920 - 260 - 300) x 912 = 1360 x 912px
- **Right panel**: 300px x 912px
- **Bottom bar**: full width x 120px (minimap occupies left 260px of this)

### 2.2 Top Bar: The Dispatch Banner

A leather-brown strip with brass accents. Information laid out like a military dispatch header.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚔ AGENT EMPIRES   │ ★ $12,450 MTD │ ⏳ 67% Supply │ 🏕 5/8 Units │ ⏰ 3:42 │ 🔴 3 │
└──────────────────────────────────────────────────────────────────────┘
```

Left to right:
1. **Campaign title** — Playfair Display 18px bold, `--parchment-light` text on dark leather
2. **Revenue (Gold)** — Star medal icon + dollar amount, `--brass-highlight` text. Pulses gold on new revenue.
3. **Context Tokens (Supply)** — Powder keg icon + percentage bar. Bar fill: `--success-olive` > 50%, `--alert-amber` 20-50%, `--wax-red` < 20%.
4. **Population** — Tent icon + "active/max" count.
5. **Campaign Clock** — Pocket watch icon + time remaining in work block. Ticks down.
6. **Alert Count** — Wax seal (red circle) with number. Pulses if unacknowledged alerts exist. Click to open notification drawer.

Height: 48px. Background: `#2A1F14` (leather). Bottom border: 2px solid `--brass-dark`. All text vertically centered.

### 2.3 Left Panel: The Order of Battle

A parchment-colored roster of all deployed units. Collapsible to 48px (icon strip only) via a brass toggle tab.

#### Header
```
┌─────────────────────────┐
│ ORDER OF BATTLE    [−]  │
│ 5 units deployed        │
├─────────────────────────┤
```
- Playfair Display 16px, `--ink-dark`
- Unit count in EB Garamond 13px, `--ink-light`
- `[−]` collapse button styled as a brass minus sign

#### Unit Card (repeated per unit)

```
┌─────────────────────────┐
│ [👑] COMMANDER-01       │
│ ● Working               │
│ ██████████░░ 78%        │
│ Sales Front             │
│ "Prepping Kelly call"   │
└─────────────────────────┘
```

Each card is 260px wide, ~80px tall:
- **Badge** (24px) + **Unit name** (Playfair 14px bold)
- **Status dot** (8px circle, color per status) + status label (Cormorant SC 11px)
- **Health bar**: 200px wide, 6px tall, rounded 3px. Fill color matches supply thresholds.
- **Territory**: EB Garamond 13px, regiment color of current territory
- **Current task**: EB Garamond 12px italic, `--ink-light`, truncated with ellipsis at 1 line

**Interactions:**
- Click card → selects unit on map, opens Unit tab in right panel
- Drag card → reorder priority (visual only, for user's mental model)
- Right-click → context menu: View Terminal, Send Order, Reassign, Kill Unit
- Hover → subtle brass border glow

#### Control Group Indicators

Below the unit list, small numbered brass tokens (1-9) show which control groups have units assigned:

```
┌─────────────────────────┐
│ Groups: [1]●● [2]●●● [5]● │
└─────────────────────────┘
```

Each token is a 20px brass circle with the group number. Dots below show unit count. Click to select that group.

### 2.4 Right Panel: The Intelligence Desk

Five tabs, each styled as a leather-bound dossier folder tab:

```
┌─────────────────────────────┐
│ [Intel] [Unit] [Campaign] [Econ] [Codex] │
├─────────────────────────────┤
│                             │
│  (Tab content area)         │
│  300px wide, scrollable     │
│                             │
└─────────────────────────────┘
```

Tab bar: 32px tall. Active tab has `--parchment-light` background with brass underline. Inactive tabs: `--parchment-dark`, `--ink-faded` text.

#### Intel Tab

Scrolling feed of intelligence dispatches. Each dispatch is a small card:

```
┌─────────────────────────────┐
│ ▲ HIGH — Sales Front        │
│ Kelly SME: Call in 2 hours  │
│ Source: Google Calendar      │
│ 14 minutes ago              │
├─────────────────────────────┤
│ ▬ LOW — Lead-Gen Front      │
│ LinkedIn impressions +23%   │
│ Source: Shield Analytics     │
│ 1 hour ago                  │
└─────────────────────────────┘
```

- Severity marker: `▲` CRITICAL (red), `▲` HIGH (amber), `▬` MEDIUM (ink), `▽` LOW (faded)
- Territory tag uses regiment color
- Source and timestamp in `--type-body-sm`
- Click dispatch → camera jumps to relevant territory

#### Unit Tab (shows when a unit is selected)

Detailed dossier on the selected unit:

```
┌─────────────────────────────┐
│ [👑] COMMANDER-01           │
│ ─────────────────────────── │
│ Status: ● Working           │
│ Territory: Sales Front      │
│ Deployed: 2h 14m ago        │
│ Tokens: ██████░░░░ 62%      │
│                             │
│ Current Task:               │
│ "Analyzing Kelly's SME      │
│  workflow for call prep"    │
│                             │
│ Recent Activity:            │
│ • Read kelly-sme-workflow   │
│ • Queried Supabase pipeline │
│ • Generated call brief      │
│                             │
│ [📺 View Terminal]          │
│ [📝 Send Order]             │
│ [🔄 Reassign]  [☠ Kill]    │
└─────────────────────────────┘
```

Buttons styled as brass command tokens (see Button Styles in CSS section).

#### Campaign Tab

Shows active campaign objectives as a progress report:

```
┌─────────────────────────────┐
│ CAMPAIGN: Scale CCB to 100  │
│ Score: ████████░░ 78%       │
│ ─────────────────────────── │
│                             │
│ ✦ New Leads         350/500 │
│   ██████████████░░░ 70%     │
│                             │
│ ✦ Students Enrolled  72/100 │
│   ██████████████░░░ 72%     │
│                             │
│ ✦ Session NPS       4.6/4.5 │
│   ████████████████████ 102% │
│   ✓ COMPLETE                │
└─────────────────────────────┘
```

Completed objectives get a wax seal stamp (olive green) next to them.

#### Economy Tab

Resource ledger styled like an accountant's book:

```
┌─────────────────────────────┐
│ TREASURY                    │
│ ─────────────────────────── │
│ Revenue MTD      $12,450    │
│ Revenue Target   $20,000    │
│ Burn Rate        $2.40/hr   │
│ ─────────────────────────── │
│ SUPPLY LINES                │
│ Active Sessions   5/8       │
│ Avg Token Usage   64%       │
│ Sessions Today    12        │
│ Tasks Completed   34        │
│ ─────────────────────────── │
│ RECENT TRANSACTIONS         │
│ +$497  CCB enrollment  2h   │
│ +$97   Plugin sale     6h   │
│ -$20   API credits     1d   │
└─────────────────────────────┘
```

Numbers right-aligned, using `--font-numbers` with `tabular-nums`.

#### Codex Tab

Achievement medals and campaign statistics. Medals displayed as a grid of wax seals:

```
┌─────────────────────────────┐
│ MEDALS OF DISTINCTION       │
│                             │
│  [★] [⚔] [📜] [🎖] [░]   │
│  [🏰] [░] [░] [░] [░]     │
│                             │
│ ★ First Blood               │
│   "First $100 revenue day"  │
│   Earned: March 3, 2026     │
│                             │
│ CAMPAIGN RECORD             │
│ Campaigns Won: 3            │
│ Campaigns Lost: 1           │
│ Longest Streak: 12 days     │
│ Total Revenue: $47,280      │
│ Units Deployed: 234         │
└─────────────────────────────┘
```

Earned medals: full color wax seal. Unearned: `░` grey placeholder with lock icon.

### 2.5 Bottom Bar: The Command Tent

Dark leather surface, 120px tall, divided into three zones:

```
┌──────────────────┬───────────────────────────────────────────────────┐
│                  │ COMMAND INPUT                                      │
│    MINIMAP       │ > _                                                │
│    200x150       │                                                    │
│                  ├───────────────────────────────────────────────────┤
│                  │ ⚡ Deploy │ 🎯 Rally │ 📡 Scout │ ⏸ Pause All   │
│  [Quick btns]    │ ─── DISPATCHES ──────────────────────────────── │
│                  │ ● Sales: Kelly call brief ready                    │
│                  │ ● Support: 2 tickets resolved by Medic-01         │
└──────────────────┴───────────────────────────────────────────────────┘
```

#### Minimap (Left 260px)

- 200x150px parchment-colored miniature of the full battlefield
- Territory zones shown as colored regions (regiment wash colors)
- Unit positions as 3px dots (regiment color of their type)
- Threat indicators as red pulsing dots
- Camera viewport shown as a brass-bordered rectangle
- Click anywhere to jump camera
- Below minimap: 4 quick-action brass tokens (Deploy, Rally, Scout, Pause All)

#### Command Input (Center-Right, top half)

Styled as a field desk with quill:

- Input field: 600px wide, 36px tall
- Background: `--parchment-mid` with subtle inner shadow
- Left icon: quill SVG in `--ink-light`
- Placeholder: "Issue orders..." in `--ink-faded`, italic EB Garamond
- Active: brass glow border, quill icon darkens
- Font: EB Garamond 15px
- Autocomplete dropdown: parchment panel below, entries highlighted with `--parchment-dark`

#### Quick Actions (Center-Right, middle)

4 brass command tokens in a row:
- Each: 32px tall pill shape, `--brass-mid` background, `--ink-black` text
- Hover: `--brass-highlight` background
- Active/pressed: `--brass-dark` background, inset shadow

#### Dispatch Ticker (Center-Right, bottom)

A horizontal scrolling ribbon of recent events:
- Background: slightly darker leather `#231A10`
- Text: EB Garamond 12px, `--parchment-dark`
- Each dispatch prefixed with a colored dot (regiment color of relevant territory)
- Auto-scrolls left, pauses on hover
- Styled like a telegram ticker tape

---

## 3. Animation Language

Every interaction has weight and physicality. No generic fades or slides. Everything moves like it exists in a candlelit tent — paper unfurls, brass clicks, wax stamps, ink flows.

### 3.1 Timing Curves

```css
/* Brass mechanical — for buttons, plaques, medals */
--ease-brass: cubic-bezier(0.34, 1.56, 0.64, 1);  /* slight overshoot, like a brass mechanism clicking */

/* Scroll unfurl — for panels, tooltips */
--ease-unfurl: cubic-bezier(0.22, 0.61, 0.36, 1);  /* smooth deceleration, like paper unrolling */

/* Ink flow — for territory fills, fog clearing */
--ease-ink: cubic-bezier(0.4, 0, 0.2, 1);  /* standard material ease for fluid movements */

/* Stamp impact — for wax seals, alerts */
--ease-stamp: cubic-bezier(0.17, 0.89, 0.32, 1.28);  /* hard overshoot, like pressing a seal */

/* Candle flicker — for ambient animations */
--ease-flicker: cubic-bezier(0.45, 0.05, 0.55, 0.95);  /* gentle oscillation */
```

### 3.2 Panel Transitions

#### Panel Open (Scroll Unfurl)
Panel height animates from 0 to full, with a slight `scaleY` overshoot. Content fades in 100ms after the panel reaches full height.

```css
@keyframes panel-unfurl {
  0% {
    max-height: 0;
    opacity: 0;
    transform: scaleY(0.8);
    transform-origin: top center;
  }
  60% {
    opacity: 1;
    transform: scaleY(1.02);
  }
  100% {
    max-height: 600px;
    opacity: 1;
    transform: scaleY(1);
  }
}
/* Duration: 350ms, ease: --ease-unfurl */
```

#### Panel Close (Scroll Roll-up)
Reverse of unfurl. Content fades first (100ms), then panel height collapses (250ms).

#### Tab Switch (Page Turn)
Active tab content slides out left with 5deg rotation (like a page turning), new content slides in from right with -5deg rotation settling to 0.

```css
@keyframes tab-page-out {
  0%   { transform: rotateY(0deg); opacity: 1; }
  100% { transform: rotateY(-8deg); opacity: 0; transform-origin: left center; }
}
@keyframes tab-page-in {
  0%   { transform: rotateY(8deg); opacity: 0; transform-origin: right center; }
  100% { transform: rotateY(0deg); opacity: 1; }
}
/* Duration: 200ms each, ease: --ease-unfurl */
```

#### Tooltip (Sealed Note)
Tooltips scale from 0.85 to 1.0 with a slight Y offset, simulating a folded note being opened:

```css
@keyframes tooltip-unseal {
  0%   { transform: scale(0.85) translateY(4px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
/* Duration: 180ms, ease: --ease-stamp */
```

### 3.3 Number Changes

#### Gold Increasing (Revenue Event)
1. Number text flashes `--brass-highlight` (100ms)
2. Number scales to 1.15x then back to 1.0x (300ms, `--ease-brass`)
3. Tiny gold particle burst (3-5 particles) rises from the number and fades (PixiJS particles, 500ms)
4. Sound: coin cascade (see Sound section)

```css
@keyframes number-increase-gold {
  0%   { transform: scale(1); color: var(--brass-primary); }
  30%  { transform: scale(1.15); color: var(--brass-highlight); }
  100% { transform: scale(1); color: var(--brass-primary); }
}
```

#### Tokens Decreasing (Supply Drain)
1. Bar fill width animates smoothly to new value (400ms, `--ease-ink`)
2. If crossing a threshold (50% or 20%), bar color transitions to the new threshold color (200ms)
3. A brief "sand grain" particle falls from the bar end (PixiJS, 3 particles, 300ms)

#### Score Change (Brass Plaque Flip)
The score plaque does a 3D flip:
1. `rotateX` from 0 to 90deg (number hidden at 90deg midpoint) — 150ms
2. Number updates while hidden
3. `rotateX` from -90deg to 0deg — 150ms
4. Slight brass gleam sweep (linear-gradient overlay animating left-to-right, 200ms)

```css
@keyframes plaque-flip-out {
  0%   { transform: rotateX(0deg); }
  100% { transform: rotateX(90deg); }
}
@keyframes plaque-flip-in {
  0%   { transform: rotateX(-90deg); }
  100% { transform: rotateX(0deg); }
}
```

#### Negative Change (Ink Splatter / Red Wax Drip)
1. Number flashes `--wax-red` (100ms)
2. Number shakes horizontally: translateX(-2px, 2px, -1px, 0) over 200ms
3. A tiny ink drop SVG fades in below the number, then fades out (400ms)

```css
@keyframes number-negative-shake {
  0%   { transform: translateX(0); color: var(--ink-dark); }
  20%  { transform: translateX(-2px); color: var(--wax-red); }
  40%  { transform: translateX(2px); color: var(--wax-red); }
  60%  { transform: translateX(-1px); color: var(--wax-red-bright); }
  80%  { transform: translateX(1px); }
  100% { transform: translateX(0); color: var(--ink-dark); }
}
```

### 3.4 Alerts and Notifications

#### New Threat (Wax Seal Stamp)
The most dramatic animation in the system — it should feel like a dispatch being urgently stamped.

1. Red wax seal appears at `scale(2.5)` and `opacity(0)` — 0ms
2. Slams down to `scale(1)` with `--ease-stamp` — 200ms (the "stamp" moment)
3. Brief overshoot to `scale(0.95)` then back to `scale(1)` — 100ms
4. Subtle ring ripple expands outward from seal (a circle border that scales and fades) — 400ms
5. Sound: brass thud + wax stamp (see Sound section)

```css
@keyframes wax-stamp {
  0%   { transform: scale(2.5); opacity: 0; }
  50%  { transform: scale(0.95); opacity: 1; }
  65%  { transform: scale(1.03); }
  100% { transform: scale(1); opacity: 1; }
}
/* Duration: 300ms, ease: --ease-stamp */

@keyframes stamp-ripple {
  0%   { transform: scale(1); opacity: 0.4; border-width: 2px; }
  100% { transform: scale(2.5); opacity: 0; border-width: 0.5px; }
}
/* Duration: 500ms, ease: ease-out */
```

#### Mission Complete (Scroll Unfurl + Calligraphy)
1. A scroll banner unfurls from center (height 0 to ~60px, width 0 to ~400px) — 400ms
2. Text appears letter by letter (like being written by a quill) — 30ms per character
3. Scroll remains for 3 seconds, then rolls back up — 300ms
4. Sound: scroll unfurl + brief trumpet stinger

#### Achievement Earned (Medal Pin)
1. Medal appears above the notification area, drops down with gravity curve — 300ms
2. "Pins" into place with a slight bounce — `--ease-brass`
3. Brief golden sparkle burst (4 particles) — 200ms
4. Sound: metallic clink
5. Achievement toast slides in from right with medal icon, remains 5 seconds

#### Warning (Candle Flicker)
1. Screen vignette darkens by 5% for 500ms, then returns — creates a brief "shadow" effect
2. The relevant territory border pulses amber twice — 200ms per pulse
3. A small amber pennant icon waves in the notification area

```css
@keyframes vignette-warning {
  0%   { box-shadow: inset 0 0 100px rgba(0, 0, 0, 0); }
  50%  { box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.08); }
  100% { box-shadow: inset 0 0 100px rgba(0, 0, 0, 0); }
}
```

### 3.5 Map Animations (PixiJS)

#### Fog Clearing
Fog is a dark overlay sprite with an alpha mask. Clearing animates the mask:
1. A circular reveal expands from the scout unit's position — 800ms, `--ease-ink`
2. The fog alpha fades from current value to new value with soft edges
3. Parchment detail beneath "develops" like a photograph — fine lines appear first, then shading
4. Sound: atmospheric whoosh + reveal chord

#### Unit Movement
1. Brass figurine sprite lerps from origin to destination — speed: 120px/sec
2. Slight "bob" on Y axis (1px sine wave) during movement — simulates being carried
3. Small dust particles trail behind (2 particles per 50px traveled, `--parchment-dark` color)
4. Shadow sprite follows 2px offset, 50% opacity
5. Sound: brief march step loop while moving

#### Combat (Ink Clash)
1. Attacking unit faces target (sprite flips if needed)
2. Ink splash particle burst at the contact point — 6-8 particles in `--ink-dark`, spreading radially
3. Small spark particles (2-3) in `--brass-highlight` mixed in
4. Target unit flashes red (`--wax-red`) for 150ms
5. Damage number floats up from target: "-15" in `--wax-red`, fades over 600ms
6. Sound: sword clash or cannon blast depending on unit type

#### Territory Capture (Watercolor Bleed)
The signature map animation. When a territory changes color:
1. New regiment color starts as a small dot at the capturing unit's position
2. Color spreads outward in an organic, watercolor-bleeding pattern — 1200ms
3. Uses a noise-based displacement to create irregular spread edges (not a clean circle)
4. Old color fades as new color arrives — crossfade at the boundary
5. Territory border ink line redraws in the new regiment color — 400ms
6. Sound: drum roll building, then triumphant horn stinger at completion

Implementation: PixiJS displacement filter with animated noise texture scaling from 0 to territory bounds.

#### Road Building (Quill Stroke)
1. Ink line draws from point A to point B along the road path — speed: 200px/sec
2. Line starts thin (0.5px) and thickens to final width (2-3px based on level) as it draws
3. Small ink drops at intervals along the line (every ~60px)
4. Sound: quill scratching

#### Revenue Event (Gold Leaf Flash)
1. Territory briefly glows with `--brass-highlight` at 15% opacity — 200ms in, 600ms out
2. A gold leaf texture overlay sweeps across the territory left-to-right — 400ms
3. Gold coin particle (single) rises from territory center, arcs to the revenue counter in the top bar
4. Revenue number triggers the gold-increase animation (see 3.3)
5. Sound: coin chime + register ching

---

## 4. Sound Design (Napoleon Era)

All sounds synthesized via Tone.js (no audio files needed, matching Vibecraft's approach). Each sound described by its synthesis parameters.

### 4.1 Ambient Soundscapes

#### War Room Ambient (Default)
A very subtle background layer — barely perceptible, adds warmth:
- **Brown noise** base at -35dB (sounds like distant wind outside the tent)
- **Fire crackle**: Random filtered noise bursts, 0.5-2 per second, -30dB, bandpass 2000-4000Hz
- **Paper rustle**: Occasional filtered noise sweep, every 15-30 seconds, -35dB (like a map being adjusted)
- Master volume: -28dB (this should be felt, not heard)

#### Night Mode Ambient
- Brown noise lowered to -40dB
- Fire crackle frequency reduced to 0.2-0.5 per second
- Add: low sine tone at 180Hz, -45dB, with slow LFO (owl-like)
- Add: high filtered noise at 8000Hz, -40dB, intermittent (crickets)

### 4.2 UI Interaction Sounds

#### Button Click (Quill Scratch)
```
Tone.js: NoiseSynth
  noise type: white
  filter: bandpass, frequency 3000Hz, Q 2
  envelope: attack 0.005, decay 0.06, sustain 0, release 0.02
  volume: -18dB
```
Very short, crisp — like a quill nib touching parchment.

#### Panel Open (Scroll Unfurl)
```
Tone.js: NoiseSynth
  noise type: pink
  filter: lowpass, frequency sweep 200Hz → 2000Hz over 300ms
  envelope: attack 0.01, decay 0.3, sustain 0, release 0.1
  volume: -20dB
```
Rising whoosh — paper unfurling.

#### Panel Close (Scroll Roll)
Same as open but reversed: frequency sweep 2000Hz → 200Hz.

#### Tab Switch (Page Turn)
```
Tone.js: NoiseSynth
  noise type: white
  filter: bandpass, frequency 4000Hz, Q 3
  envelope: attack 0.002, decay 0.08, sustain 0, release 0.04
  volume: -22dB
```
Quick, papery "fwip" sound.

#### Number Update (Abacus Click)
```
Tone.js: MetalSynth
  frequency: 800
  harmonicity: 5.1
  modulationIndex: 16
  resonance: 2000
  octaves: 0.5
  envelope: attack 0.001, decay 0.05, sustain 0, release 0.03
  volume: -24dB
```
Tiny metallic click — like a bead sliding on an abacus rod.

#### Alert Bell (Brass Bell — 3 severity tones)

**LOW:**
```
Tone.js: Synth (triangle wave)
  frequency: 880Hz (A5)
  envelope: attack 0.001, decay 0.3, sustain 0, release 0.5
  volume: -20dB
```

**HIGH:**
```
Tone.js: Synth (triangle wave)
  frequency: 660Hz (E5) → 880Hz (A5) portamento 50ms, played twice 200ms apart
  volume: -16dB
```

**CRITICAL:**
```
Tone.js: Synth (triangle wave)
  frequency: 440Hz (A4) → 880Hz (A5) → 440Hz, three strikes 150ms apart
  Add: NoiseSynth white, bandpass 1000Hz, -22dB, 50ms burst (impact)
  volume: -14dB
```

### 4.3 Action Sounds

#### Unit Deploy (Drum Roll + Horn)
```
Drum roll:
  Tone.js: NoiseSynth, white
  filter: bandpass 300Hz, Q 1
  envelope: attack 0.01, decay 0.5, sustain 0.3, release 0.3
  Tremolo: frequency 20Hz, depth 0.8
  volume: -18dB, duration 600ms

Horn stinger (after drum roll):
  Tone.js: Synth (sawtooth)
  filter: lowpass 1500Hz
  frequency: [C4, E4, G4] arpeggiated at 80ms intervals
  envelope: attack 0.02, decay 0.2, sustain 0.1, release 0.4
  volume: -16dB
```

#### Unit March (Boot Steps)
```
Tone.js: NoiseSynth
  noise type: brown
  filter: lowpass 400Hz
  envelope: attack 0.005, decay 0.08, sustain 0, release 0.05
  Triggered every 250ms while unit is moving
  volume: -26dB (spatial — louder when unit is near camera center)
```

#### Combat — Sword Clash
```
Tone.js: MetalSynth
  frequency: 200
  harmonicity: 12
  modulationIndex: 20
  resonance: 3000
  octaves: 1.5
  envelope: attack 0.001, decay 0.15, sustain 0, release 0.2
  volume: -14dB
```

#### Combat — Cannon Blast
```
Tone.js: NoiseSynth (the boom)
  noise type: brown
  filter: lowpass 200Hz, sweep to 80Hz over 300ms
  envelope: attack 0.001, decay 0.4, sustain 0, release 0.3
  volume: -10dB

Plus: MetalSynth (the crack)
  frequency: 50
  harmonicity: 0.1
  resonance: 500
  envelope: attack 0.001, decay 0.05, sustain 0, release 0.1
  volume: -12dB
```

#### Victory Fanfare
```
Tone.js: PolySynth (3 voices, sawtooth)
  filter: lowpass 2000Hz
  Chord sequence: C4-E4-G4 (200ms) → hold 300ms → C4-F4-A4 (200ms) → C4-E4-G4-C5 (400ms)
  envelope: attack 0.05, decay 0.1, sustain 0.6, release 0.5
  volume: -12dB
  Total duration: ~1.5 seconds
```

#### Defeat (Somber Horn)
```
Tone.js: Synth (sawtooth)
  filter: lowpass 800Hz
  frequency: E3 → D3 portamento 400ms → hold 200ms → C3 hold 600ms
  envelope: attack 0.1, decay 0.2, sustain 0.5, release 0.8
  volume: -16dB
```

#### Revenue (Coin Drop + Register)
```
Coin drop:
  Tone.js: MetalSynth
  frequency: 1200
  harmonicity: 8
  modulationIndex: 12
  resonance: 4000
  octaves: 1
  envelope: attack 0.001, decay 0.1, sustain 0, release 0.15
  volume: -18dB
  Triggered 3 times at 60ms intervals (cascade)

Register ching:
  Tone.js: MetalSynth
  frequency: 2000
  harmonicity: 12
  modulationIndex: 20
  resonance: 6000
  envelope: attack 0.001, decay 0.2, sustain 0, release 0.3
  volume: -16dB
  Triggered 150ms after last coin
```

#### Achievement (Medal Pin + Brief Cheer)
```
Pin:
  Tone.js: MetalSynth
  frequency: 1500
  harmonicity: 10
  resonance: 5000
  envelope: attack 0.001, decay 0.08, sustain 0, release 0.1
  volume: -16dB

Cheer (subtle):
  Tone.js: NoiseSynth, pink
  filter: bandpass 1500Hz, Q 0.5
  envelope: attack 0.05, decay 0.3, sustain 0.1, release 0.2
  volume: -25dB
```

### 4.4 Music Stingers (Short Clips, Not Loops)

These are brief musical moments — never continuous background music:

| Trigger | Duration | Description |
|---------|----------|-------------|
| Campaign start | 5 sec | Military march: snare roll → brass melody (C-E-G-C ascending) |
| Morning briefing | 3 sec | Reveille: simple bugle call (G-C-E-G ascending, trumpet synth) |
| Boss threat | 4 sec | Dramatic drumming: low toms building in speed |
| Campaign won | 8 sec | Victory march: full brass fanfare + snare cadence |
| All units idle | 2 sec | Single bugle note, fading (subtle "wake up" reminder) |

All stingers use the same PolySynth brass voice, varied by arrangement. Volume: -14dB, auto-duck all other sounds by 6dB during stinger.

---

## 5. Responsive Layout

### 5.1 Breakpoint Definitions

| Breakpoint | Width | Name | Layout Behavior |
|------------|-------|------|-----------------|
| XL | >= 1920px | Full War Table | All panels visible, no compromises |
| L | 1440–1919px | Field Command | Compressed panels, smaller minimap |
| M | 1280–1439px | Tent Desk | Collapsible side panels, simplified bottom |
| S | 1024–1279px | Field Map | Overlay panels, no persistent sidebars |
| Touch | Any + touch | Touch Command | Tap/drag/pinch gestures |

### 5.2 XL (1920px+) — Full War Table

The reference layout from Section 2. Everything visible simultaneously:
- Left panel: 260px, always open
- Right panel: 300px, always open
- Bottom bar: 120px with full minimap
- Canvas: remaining center space

### 5.3 L (1440px) — Field Command

```
Left panel:  220px (narrower cards, truncate task text at 1 line)
Right panel: 260px (narrower, compact intel cards)
Bottom bar:  100px (minimap 160x120)
Canvas:      960px wide
```

Changes:
- Unit cards: remove territory line, show as colored dot on badge instead
- Intel cards: single-line format (severity icon + title, timestamp on hover)
- Economy tab: remove "Recent Transactions" section, just show summary
- Command input: 500px wide
- Dispatch ticker: hidden (notifications only via alert count)

### 5.4 M (1280px) — Tent Desk

```
Left panel:  COLLAPSED by default (48px icon strip, click to expand as overlay)
Right panel: COLLAPSED by default (48px tab strip, click to expand as overlay)
Bottom bar:  80px (minimap 140x100, quick actions become icon-only)
Canvas:      FULL WIDTH (1280px minus any open overlays)
```

Changes:
- Side panels open as 280px overlays on top of the canvas (semi-transparent parchment bg)
- Close button prominent on overlay panels
- Canvas gets full width when panels closed — maximum battlefield visibility
- Command input: 400px, centered in bottom bar
- Unit selection opens right panel automatically
- Minimap: smaller, no quick-action buttons below it (moved to context menu)

### 5.5 S (1024px) — Field Map

```
ALL panels: overlay only, triggered by buttons/hotkeys
Bottom bar:  64px (command input only, no minimap)
Canvas:      FULL SCREEN
```

Changes:
- Top bar: campaign name hidden, only show resource icons + numbers
- Left panel: full-screen overlay (modal), triggered by hotkey or hamburger icon
- Right panel: full-screen overlay (modal), triggered by unit selection or tab hotkeys
- Minimap: toggle overlay with `M` key, appears as floating 180x135 panel bottom-left
- Bottom bar: just the command input + alert seal
- All keyboard shortcuts still work

### 5.6 Touch Support

Touch input augments keyboard/mouse — it does NOT replace the desktop layout. Agent Empires is desktop-first.

| Gesture | Action |
|---------|--------|
| Tap unit | Select (opens unit detail panel) |
| Tap territory | Select territory, show info tooltip |
| Tap empty space | Deselect all |
| One-finger drag on canvas | Pan camera |
| Two-finger pinch | Zoom in/out (0.5x–4x) |
| Two-finger drag | Pan camera (alternative) |
| Long press unit | Open context menu (View Terminal, Send Order, etc.) |
| Long press territory | Open territory context menu (Deploy Here, Scout, etc.) |
| Swipe from left edge | Open Order of Battle panel |
| Swipe from right edge | Open Intelligence Desk panel |
| Tap command bar | Focus input, open virtual keyboard |

Touch targets: minimum 44x44px for all interactive elements. Unit sprites on canvas: minimum 48x48px touch area (even if visual sprite is smaller).

---

## 6. CSS Implementation

### 6.1 CSS Custom Properties (Complete Theme)

```css
:root {
  /* ===== SURFACES ===== */
  --parchment-light: #F5ECD7;
  --parchment-mid: #E8D9B5;
  --parchment-dark: #D4C49A;
  --parchment-aged: #C7B88A;
  --parchment-stain: #B8A67E;

  /* ===== INK & TEXT ===== */
  --ink-black: #1A1408;
  --ink-dark: #2C2410;
  --ink-mid: #4A3F2F;
  --ink-light: #6B5D4A;
  --ink-faded: #8C7D66;
  --ink-ghost: #A89880;

  /* ===== BRASS & GOLD ===== */
  --brass-highlight: #F0D78C;
  --brass-primary: #C9A84C;
  --brass-mid: #A6883A;
  --brass-dark: #7A6428;
  --brass-patina: #5C6B4A;

  /* ===== REGIMENT COLORS ===== */
  --regiment-blue: #2B4570;
  --regiment-blue-wash: rgba(43, 69, 112, 0.12);
  --regiment-blue-mid: rgba(43, 69, 112, 0.37);

  --regiment-crimson: #8B2500;
  --regiment-crimson-wash: rgba(139, 37, 0, 0.12);
  --regiment-crimson-mid: rgba(139, 37, 0, 0.37);

  --regiment-green: #2E5A3A;
  --regiment-green-wash: rgba(46, 90, 58, 0.12);
  --regiment-green-mid: rgba(46, 90, 58, 0.37);

  --regiment-amber: #8B6914;
  --regiment-amber-wash: rgba(139, 105, 20, 0.12);
  --regiment-amber-mid: rgba(139, 105, 20, 0.37);

  --regiment-purple: #4A2860;
  --regiment-purple-wash: rgba(74, 40, 96, 0.12);
  --regiment-purple-mid: rgba(74, 40, 96, 0.37);

  --regiment-silver: #6B7B8D;
  --regiment-silver-wash: rgba(107, 123, 141, 0.12);
  --regiment-silver-mid: rgba(107, 123, 141, 0.37);

  /* ===== ALERTS ===== */
  --wax-red: #8B1A1A;
  --wax-red-bright: #B22222;
  --wax-red-glow: rgba(212, 56, 34, 0.12);
  --alert-amber: #B8860B;
  --alert-amber-glow: rgba(184, 134, 11, 0.12);
  --success-olive: #556B2F;
  --success-olive-bright: #6B8E23;

  /* ===== FOG ===== */
  --fog-light: rgba(26, 20, 8, 0.18);
  --fog-mid: rgba(26, 20, 8, 0.37);
  --fog-heavy: rgba(26, 20, 8, 0.62);
  --fog-full: rgba(26, 20, 8, 0.81);

  /* ===== NIGHT MODE (applied via .night-mode class) ===== */
  --night-bg: #1C1610;
  --night-surface: #2A2218;
  --night-parchment: #3D3225;
  --night-text: #C7B88A;
  --night-brass: #D4A84C;
  --candle-glow: rgba(245, 215, 140, 0.25);
  --candle-flicker: rgba(240, 200, 96, 0.18);

  /* ===== LEATHER ===== */
  --leather-dark: #2A1F14;
  --leather-mid: #3A2E20;
  --leather-stitch: var(--brass-dark);

  /* ===== CANVAS TENT ===== */
  --tent-bg: #3D352B;

  /* ===== TYPOGRAPHY ===== */
  --font-display: 'Playfair Display', 'Georgia', 'Times New Roman', serif;
  --font-body: 'EB Garamond', 'Garamond', 'Georgia', serif;
  --font-numbers: 'Libre Baskerville', 'Georgia', serif;
  --font-mono: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  --font-label: 'Cormorant SC', 'Georgia', serif;

  /* ===== ANIMATION CURVES ===== */
  --ease-brass: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-unfurl: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-ink: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-stamp: cubic-bezier(0.17, 0.89, 0.32, 1.28);
  --ease-flicker: cubic-bezier(0.45, 0.05, 0.55, 0.95);

  /* ===== LAYOUT ===== */
  --top-bar-height: 48px;
  --bottom-bar-height: 120px;
  --left-panel-width: 260px;
  --right-panel-width: 300px;
  --left-panel-collapsed: 48px;
  --right-panel-collapsed: 48px;

  /* ===== Z-INDEX LAYERS ===== */
  --z-canvas: 1;
  --z-fog-overlay: 10;
  --z-hud-panels: 100;
  --z-top-bar: 200;
  --z-bottom-bar: 200;
  --z-tooltip: 300;
  --z-modal: 400;
  --z-notification: 500;
  --z-achievement: 600;
}
```

### 6.2 Night Mode Overrides

```css
.night-mode {
  --parchment-light: var(--night-parchment);
  --parchment-mid: var(--night-surface);
  --parchment-dark: #332A1E;
  --parchment-aged: #2E261A;
  --ink-black: #C7B88A;
  --ink-dark: #B8A67E;
  --ink-mid: #A89880;
  --ink-light: #8C7D66;
  --ink-faded: #6B5D4A;
  --leather-dark: #1A1408;
  --leather-mid: #221B12;
  --tent-bg: #151210;
}

.night-mode .app-wrapper::after {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse 60% 60% at 50% 50%,
    transparent 0%,
    rgba(28, 22, 16, 0.4) 60%,
    rgba(28, 22, 16, 0.7) 100%
  );
  pointer-events: none;
  z-index: var(--z-fog-overlay);
  animation: candle-ambient 4s var(--ease-flicker) infinite;
}

@keyframes candle-ambient {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.92; }
  75% { opacity: 0.97; }
}
```

### 6.3 Base Styles

```css
/* ===== RESET & BASE ===== */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  overflow: hidden;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-mid);
  background: var(--tent-bg);
  -webkit-font-smoothing: antialiased;
}

/* ===== APP LAYOUT ===== */
.app-wrapper {
  display: grid;
  grid-template-rows: var(--top-bar-height) 1fr var(--bottom-bar-height);
  grid-template-columns: var(--left-panel-width) 1fr var(--right-panel-width);
  grid-template-areas:
    "topbar   topbar   topbar"
    "left     canvas   right"
    "bottom   bottom   bottom";
  height: 100vh;
  width: 100vw;
  background-color: var(--tent-bg);
  background-image:
    repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px),
    repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px);
}
```

### 6.4 Top Bar (Dispatch Banner)

```css
.dispatch-banner {
  grid-area: topbar;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  height: var(--top-bar-height);
  background-color: var(--leather-dark);
  border-bottom: 2px solid var(--brass-dark);
  z-index: var(--z-top-bar);
  font-family: var(--font-label);
}

.dispatch-banner__campaign-name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  color: var(--parchment-light);
  letter-spacing: 0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.dispatch-banner__resource {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--parchment-aged);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.dispatch-banner__resource-icon {
  width: 20px;
  height: 20px;
  opacity: 0.8;
}

.dispatch-banner__resource-value {
  font-family: var(--font-numbers);
  font-size: 16px;
  font-weight: 700;
  color: var(--brass-highlight);
  font-variant-numeric: tabular-nums;
}

.dispatch-banner__resource--gold .dispatch-banner__resource-value {
  color: var(--brass-highlight);
}

.dispatch-banner__resource--supply .dispatch-banner__resource-value {
  color: var(--success-olive-bright);
}

.dispatch-banner__supply-bar {
  width: 80px;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.dispatch-banner__supply-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 400ms var(--ease-ink), background-color 200ms ease;
}

.dispatch-banner__supply-fill--healthy { background: var(--success-olive-bright); }
.dispatch-banner__supply-fill--warning { background: var(--alert-amber); }
.dispatch-banner__supply-fill--critical { background: var(--wax-red-bright); }

.dispatch-banner__alert-seal {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #B22222, #8B1A1A 60%, #6B1010);
  box-shadow:
    inset 0 -2px 4px rgba(0, 0, 0, 0.3),
    inset 0 2px 2px rgba(255, 200, 200, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.25);
  color: var(--parchment-light);
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-left: auto;
}

.dispatch-banner__alert-seal--active {
  animation: seal-pulse 1.5s var(--ease-flicker) infinite;
}

@keyframes seal-pulse {
  0%, 100% { box-shadow: inset 0 -2px 4px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.25); }
  50% { box-shadow: inset 0 -2px 4px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.25), 0 0 12px rgba(178,34,34,0.4); }
}
```

### 6.5 Panel Styles (Parchment + Brass)

```css
/* ===== BASE PANEL ===== */
.panel {
  background-color: var(--parchment-mid);
  box-shadow:
    inset 0 0 20px rgba(180, 160, 120, 0.3),
    inset 0 0 60px rgba(140, 120, 80, 0.1),
    2px 0 8px rgba(0, 0, 0, 0.15);
  overflow-y: auto;
  overflow-x: hidden;
}

.panel__header {
  padding: 12px 16px 8px;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--ink-dark);
  letter-spacing: 0.015em;
  border-bottom: 1px solid var(--parchment-aged);
}

.panel__header-subtitle {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-light);
  margin-top: 2px;
}

/* ===== LEFT PANEL (ORDER OF BATTLE) ===== */
.panel--left {
  grid-area: left;
  width: var(--left-panel-width);
  z-index: var(--z-hud-panels);
  border-right: 1px solid var(--parchment-aged);
  transition: width 300ms var(--ease-unfurl);
}

.panel--left.collapsed {
  width: var(--left-panel-collapsed);
}

/* ===== RIGHT PANEL (INTELLIGENCE DESK) ===== */
.panel--right {
  grid-area: right;
  width: var(--right-panel-width);
  z-index: var(--z-hud-panels);
  border-left: 1px solid var(--parchment-aged);
}

/* ===== PANEL TAB BAR ===== */
.panel-tabs {
  display: flex;
  height: 32px;
  border-bottom: 1px solid var(--parchment-aged);
  background: var(--parchment-dark);
}

.panel-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-faded);
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0 8px;
  transition: color 150ms ease, background 150ms ease;
  position: relative;
}

.panel-tab:hover {
  color: var(--ink-mid);
  background: var(--parchment-mid);
}

.panel-tab--active {
  color: var(--ink-dark);
  background: var(--parchment-light);
}

.panel-tab--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 20%;
  right: 20%;
  height: 2px;
  background: var(--brass-primary);
  border-radius: 1px 1px 0 0;
}
```

### 6.6 Unit Card

```css
.unit-card {
  padding: 10px 14px;
  border-bottom: 1px solid var(--parchment-aged);
  cursor: pointer;
  transition: background 150ms ease;
  position: relative;
}

.unit-card:hover {
  background: var(--parchment-dark);
}

.unit-card--selected {
  background: var(--parchment-dark);
  box-shadow: inset 3px 0 0 var(--brass-primary);
}

.unit-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-card__badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.unit-card__name {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-dark);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unit-card__status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.unit-card__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.unit-card__status-dot--idle { background: var(--parchment-stain); }
.unit-card__status-dot--working { background: var(--success-olive); }
.unit-card__status-dot--waiting { background: var(--alert-amber); }
.unit-card__status-dot--offline { background: var(--ink-faded); }
.unit-card__status-dot--alert { background: var(--wax-red); }

.unit-card__status-label {
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-light);
}

.unit-card__health-bar {
  width: 100%;
  height: 6px;
  background: var(--parchment-aged);
  border-radius: 3px;
  margin-top: 6px;
  overflow: hidden;
}

.unit-card__health-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 400ms var(--ease-ink);
}

.unit-card__territory {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--ink-light);
  margin-top: 4px;
}

.unit-card__task {
  font-family: var(--font-body);
  font-size: 12px;
  font-style: italic;
  color: var(--ink-faded);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 6.7 Button Styles

```css
/* ===== BRASS COMMAND TOKEN (Primary) ===== */
.btn-brass {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-black);
  background: linear-gradient(180deg, var(--brass-highlight) 0%, var(--brass-primary) 100%);
  border: 1px solid var(--brass-dark);
  border-radius: 4px;
  cursor: pointer;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: all 120ms ease;
}

.btn-brass:hover {
  background: linear-gradient(180deg, #F5E0A0 0%, var(--brass-highlight) 100%);
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.btn-brass:active {
  background: linear-gradient(180deg, var(--brass-mid) 0%, var(--brass-dark) 100%);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.2);
  transform: translateY(1px);
}

/* ===== INK BUTTON (Secondary) ===== */
.btn-ink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--parchment-light);
  background: var(--ink-dark);
  border: 1px solid var(--ink-mid);
  border-radius: 4px;
  cursor: pointer;
  transition: all 120ms ease;
}

.btn-ink:hover {
  background: var(--ink-mid);
}

.btn-ink:active {
  background: var(--ink-black);
  transform: translateY(1px);
}

/* ===== GHOST BUTTON (Tertiary) ===== */
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-mid);
  background: transparent;
  border: 1px solid var(--parchment-aged);
  border-radius: 4px;
  cursor: pointer;
  transition: all 120ms ease;
}

.btn-ghost:hover {
  background: var(--parchment-dark);
  border-color: var(--ink-light);
}

/* ===== DANGER BUTTON (Kill Unit, etc.) ===== */
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-family: var(--font-label);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--parchment-light);
  background: var(--wax-red);
  border: 1px solid #6B1010;
  border-radius: 4px;
  cursor: pointer;
  transition: all 120ms ease;
}

.btn-danger:hover {
  background: var(--wax-red-bright);
}
```

### 6.8 Command Bar (Field Desk Input)

```css
.command-tent {
  grid-area: bottom;
  display: grid;
  grid-template-columns: var(--left-panel-width) 1fr;
  height: var(--bottom-bar-height);
  background-color: var(--leather-dark);
  border-top: 1px dashed var(--brass-dark);
  z-index: var(--z-bottom-bar);
}

.command-tent__minimap-area {
  padding: 8px 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

.command-tent__main {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  gap: 6px;
}

.command-input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--parchment-mid);
  border: 1px solid var(--parchment-aged);
  border-radius: 4px;
  padding: 0 12px;
  height: 36px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.command-input-wrapper:focus-within {
  border-color: var(--brass-primary);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.08),
    0 0 0 2px rgba(201, 168, 76, 0.2);
}

.command-input__icon {
  width: 16px;
  height: 16px;
  color: var(--ink-light);
  flex-shrink: 0;
}

.command-input__field {
  flex: 1;
  border: none;
  background: transparent;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--ink-dark);
  outline: none;
}

.command-input__field::placeholder {
  color: var(--ink-faded);
  font-style: italic;
}

/* ===== QUICK ACTION TOKENS ===== */
.quick-actions {
  display: flex;
  gap: 8px;
}

.quick-action-token {
  padding: 4px 12px;
  font-family: var(--font-label);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--parchment-aged);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  cursor: pointer;
  transition: all 120ms ease;
}

.quick-action-token:hover {
  color: var(--brass-highlight);
  background: rgba(201, 168, 76, 0.1);
  border-color: var(--brass-dark);
}

/* ===== DISPATCH TICKER ===== */
.dispatch-ticker {
  height: 24px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
  padding: 0 10px;
  display: flex;
  align-items: center;
}

.dispatch-ticker__track {
  display: flex;
  gap: 32px;
  animation: ticker-scroll 30s linear infinite;
  white-space: nowrap;
}

.dispatch-ticker__track:hover {
  animation-play-state: paused;
}

.dispatch-ticker__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--parchment-stain);
}

.dispatch-ticker__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

@keyframes ticker-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```

### 6.9 Intel Card

```css
.intel-card {
  padding: 10px 14px;
  border-bottom: 1px solid var(--parchment-aged);
  cursor: pointer;
  transition: background 150ms ease;
}

.intel-card:hover {
  background: var(--parchment-dark);
}

.intel-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.intel-card__severity {
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.intel-card__severity--critical { color: var(--wax-red-bright); }
.intel-card__severity--high { color: var(--alert-amber); }
.intel-card__severity--medium { color: var(--ink-mid); }
.intel-card__severity--low { color: var(--ink-faded); }

.intel-card__territory {
  font-family: var(--font-label);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 1px 6px;
  border-radius: 2px;
  margin-left: auto;
}

.intel-card__title {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-dark);
  margin-top: 4px;
}

.intel-card__meta {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--ink-faded);
}
```

### 6.10 Scrollbar Styling

```css
/* ===== LEATHER SCROLL THUMBS ===== */
.panel::-webkit-scrollbar {
  width: 8px;
}

.panel::-webkit-scrollbar-track {
  background: var(--parchment-dark);
  border-radius: 4px;
}

.panel::-webkit-scrollbar-thumb {
  background: var(--brass-mid);
  border-radius: 4px;
  border: 1px solid var(--parchment-aged);
}

.panel::-webkit-scrollbar-thumb:hover {
  background: var(--brass-primary);
}

/* Firefox */
.panel {
  scrollbar-width: thin;
  scrollbar-color: var(--brass-mid) var(--parchment-dark);
}
```

### 6.11 Animation Keyframes (All Transitions)

```css
/* ===== PANEL UNFURL ===== */
@keyframes panel-unfurl {
  0% { max-height: 0; opacity: 0; transform: scaleY(0.8); transform-origin: top; }
  60% { opacity: 1; transform: scaleY(1.02); }
  100% { max-height: 600px; opacity: 1; transform: scaleY(1); }
}

@keyframes panel-roll-up {
  0% { max-height: 600px; opacity: 1; transform: scaleY(1); }
  40% { opacity: 0; }
  100% { max-height: 0; opacity: 0; transform: scaleY(0.8); transform-origin: top; }
}

/* ===== TAB TRANSITIONS ===== */
@keyframes tab-page-out {
  0% { transform: rotateY(0deg); opacity: 1; }
  100% { transform: rotateY(-8deg); opacity: 0; transform-origin: left; }
}

@keyframes tab-page-in {
  0% { transform: rotateY(8deg); opacity: 0; transform-origin: right; }
  100% { transform: rotateY(0deg); opacity: 1; }
}

/* ===== WAX SEAL STAMP ===== */
@keyframes wax-stamp {
  0% { transform: scale(2.5); opacity: 0; }
  50% { transform: scale(0.95); opacity: 1; }
  65% { transform: scale(1.03); }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes stamp-ripple {
  0% { transform: scale(1); opacity: 0.4; border-width: 2px; }
  100% { transform: scale(2.5); opacity: 0; border-width: 0.5px; }
}

/* ===== NUMBER CHANGES ===== */
@keyframes number-increase-gold {
  0% { transform: scale(1); color: var(--brass-primary); }
  30% { transform: scale(1.15); color: var(--brass-highlight); }
  100% { transform: scale(1); color: var(--brass-primary); }
}

@keyframes number-negative-shake {
  0% { transform: translateX(0); }
  20% { transform: translateX(-2px); }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1px); }
  80% { transform: translateX(1px); }
  100% { transform: translateX(0); }
}

@keyframes plaque-flip-out {
  0% { transform: rotateX(0deg); }
  100% { transform: rotateX(90deg); }
}

@keyframes plaque-flip-in {
  0% { transform: rotateX(-90deg); }
  100% { transform: rotateX(0deg); }
}

/* ===== TOOLTIP ===== */
@keyframes tooltip-unseal {
  0% { transform: scale(0.85) translateY(4px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

/* ===== SCROLL BANNER (MISSION COMPLETE) ===== */
@keyframes scroll-unfurl-horizontal {
  0% { width: 0; height: 0; opacity: 0; }
  50% { width: 400px; height: 10px; opacity: 1; }
  100% { width: 400px; height: 60px; opacity: 1; }
}

/* ===== VIGNETTE WARNING ===== */
@keyframes vignette-warning {
  0% { box-shadow: inset 0 0 100px rgba(0,0,0,0); }
  50% { box-shadow: inset 0 0 100px rgba(0,0,0,0.08); }
  100% { box-shadow: inset 0 0 100px rgba(0,0,0,0); }
}

/* ===== FLAG FLUTTER (Status Pennants) ===== */
@keyframes flag-flutter {
  0%, 100% { transform: skewX(0deg); }
  50% { transform: skewX(-3deg); }
}

/* ===== SEAL PULSE ===== */
@keyframes seal-pulse {
  0%, 100% { box-shadow: 0 2px 6px rgba(0,0,0,0.25); }
  50% { box-shadow: 0 2px 6px rgba(0,0,0,0.25), 0 0 12px rgba(178,34,34,0.4); }
}

/* ===== GOLD GLEAM SWEEP (Score Plaque) ===== */
@keyframes brass-gleam {
  0% { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

/* Usage on a plaque: */
.score-plaque::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(245, 215, 140, 0.3) 50%,
    transparent 100%
  );
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: brass-gleam 400ms ease-out;
  pointer-events: none;
}
```

### 6.12 PixiJS Canvas Overlay Positioning

The HTML HUD sits on top of the PixiJS canvas. The canvas fills the center grid cell.

```css
/* ===== CANVAS CONTAINER ===== */
.battlefield-container {
  grid-area: canvas;
  position: relative;
  overflow: hidden;
  background: var(--parchment-light);
}

.battlefield-container canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* ===== FLOATING HUD ELEMENTS OVER CANVAS ===== */
.canvas-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: var(--z-fog-overlay);
}

.canvas-overlay > * {
  pointer-events: auto;
}

/* Unit tooltips float over the canvas */
.unit-tooltip {
  position: absolute;
  background: var(--parchment-mid);
  border: 1px solid var(--brass-mid);
  border-radius: 4px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  animation: tooltip-unseal 180ms var(--ease-stamp) both;
  max-width: 200px;
  z-index: var(--z-tooltip);
}

/* Selection box drawn by dragging on canvas */
.selection-box {
  position: absolute;
  border: 1px dashed var(--brass-primary);
  background: rgba(201, 168, 76, 0.08);
  pointer-events: none;
}
```

### 6.13 Responsive Overrides

```css
/* ===== L BREAKPOINT (1440px) ===== */
@media (max-width: 1919px) {
  :root {
    --left-panel-width: 220px;
    --right-panel-width: 260px;
    --bottom-bar-height: 100px;
  }
}

/* ===== M BREAKPOINT (1280px) ===== */
@media (max-width: 1439px) {
  :root {
    --bottom-bar-height: 80px;
  }

  .app-wrapper {
    grid-template-columns: 1fr;
    grid-template-areas:
      "topbar"
      "canvas"
      "bottom";
  }

  .panel--left,
  .panel--right {
    position: fixed;
    top: var(--top-bar-height);
    bottom: var(--bottom-bar-height);
    width: 280px;
    z-index: var(--z-modal);
    transform: translateX(-100%);
    transition: transform 300ms var(--ease-unfurl);
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.3);
  }

  .panel--left.open { transform: translateX(0); left: 0; }
  .panel--right { right: 0; left: auto; transform: translateX(100%); }
  .panel--right.open { transform: translateX(0); }
}

/* ===== S BREAKPOINT (1024px) ===== */
@media (max-width: 1279px) {
  :root {
    --top-bar-height: 40px;
    --bottom-bar-height: 64px;
  }

  .dispatch-banner__campaign-name { display: none; }

  .panel--left.open,
  .panel--right.open {
    width: 100%;
  }

  .command-tent {
    grid-template-columns: 1fr;
  }

  .command-tent__minimap-area {
    display: none;
  }
}
```

---

## 7. PixiJS Rendering Style Guide

All in-canvas rendering follows the Napoleon aesthetic. The map is a hand-drawn military cartographic document, not a pixel-art game world.

### 7.1 Map Tile Rendering

The battlefield is a single large parchment surface with watercolor territory washes, NOT discrete tile sprites.

#### Base Layer (Parchment)

```typescript
// Create the parchment base as a tiling sprite
const parchmentTexture = generateParchmentTexture(app.renderer, 512, 512);

function generateParchmentTexture(renderer: PIXI.Renderer, w: number, h: number): PIXI.Texture {
  const g = new PIXI.Graphics();

  // Base parchment color
  g.beginFill(0xF5ECD7);
  g.drawRect(0, 0, w, h);
  g.endFill();

  // Subtle noise — random tiny dots to simulate paper fiber
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const alpha = Math.random() * 0.06; // Very subtle
    const shade = 0xC7B88A; // Parchment-aged
    g.beginFill(shade, alpha);
    g.drawCircle(x, y, Math.random() * 1.5 + 0.5);
    g.endFill();
  }

  return renderer.generateTexture(g);
}

const parchmentTiling = new PIXI.TilingSprite(
  parchmentTexture,
  WORLD_WIDTH,  // 4000
  WORLD_HEIGHT  // 3000
);
worldContainer.addChild(parchmentTiling);
```

#### Territory Wash Layer

Each territory is a watercolor wash — a filled polygon with soft, irregular edges.

```typescript
interface TerritoryVisual {
  id: string;
  polygon: number[];        // Flat array of [x,y] pairs defining the boundary
  regimentColor: number;    // e.g., 0x2B4570 for lead-gen
  washAlpha: number;        // 0.12 base, increases with activity
  borderAlpha: number;      // 0.37 base
}

function renderTerritoryWash(territory: TerritoryVisual, container: PIXI.Container) {
  // Wash fill — soft, watercolor-like
  const wash = new PIXI.Graphics();
  wash.beginFill(territory.regimentColor, territory.washAlpha);
  wash.drawPolygon(territory.polygon);
  wash.endFill();

  // Apply a blur filter for soft edges (watercolor bleed effect)
  wash.filters = [new PIXI.BlurFilter(8, 4)]; // strength 8, quality 4

  container.addChild(wash);

  // Border — ink stroke, slightly irregular
  const border = new PIXI.Graphics();
  border.lineStyle({
    width: 2.5,
    color: territory.regimentColor,
    alpha: territory.borderAlpha,
    cap: PIXI.LINE_CAP.ROUND,
    join: PIXI.LINE_JOIN.ROUND,
  });
  border.drawPolygon(territory.polygon);
  container.addChild(border);
}
```

#### Hex Grid Overlay (Subtle Ink Lines)

The hex grid is barely visible — like faint pencil guidelines on the parchment.

```typescript
function renderHexGrid(container: PIXI.Container, worldW: number, worldH: number) {
  const hexSize = 60; // pixels per hex edge
  const g = new PIXI.Graphics();

  g.lineStyle({
    width: 0.5,
    color: 0xA89880, // --ink-ghost
    alpha: 0.2,
  });

  const hexH = hexSize * 2;
  const hexW = Math.sqrt(3) * hexSize;

  for (let row = 0; row * hexH * 0.75 < worldH; row++) {
    for (let col = 0; col * hexW < worldW; col++) {
      const offsetX = row % 2 === 1 ? hexW / 2 : 0;
      const cx = col * hexW + offsetX;
      const cy = row * hexH * 0.75;
      drawHex(g, cx, cy, hexSize);
    }
  }

  container.addChild(g);
}

function drawHex(g: PIXI.Graphics, cx: number, cy: number, size: number) {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
  }
  g.drawPolygon(points);
}
```

### 7.2 Unit Sprite Style

Units are top-down brass figurines with drop shadows. Each unit type has a distinct silhouette.

#### Sprite Structure

Each unit is a `PIXI.Container` with these children (bottom to top):

1. **Shadow** — dark ellipse, 60% opacity, offset 2px right + 3px down
2. **Base disc** — 20px diameter circle in regiment color of current territory
3. **Figurine silhouette** — unit type icon (crown, shield, quill, etc.) in `0xC9A84C` (brass)
4. **Status ring** — 22px diameter circle stroke, color per status
5. **Flag pennant** — 8x12px colored pennant, flutters with animation
6. **Task label** — floating text above, EB Garamond 10px

```typescript
class UnitSprite extends PIXI.Container {
  private shadow: PIXI.Graphics;
  private baseDisc: PIXI.Graphics;
  private figurine: PIXI.Sprite;
  private statusRing: PIXI.Graphics;
  private flag: PIXI.Graphics;
  private taskLabel: PIXI.Text;

  constructor(config: UnitConfig) {
    super();

    // Shadow
    this.shadow = new PIXI.Graphics();
    this.shadow.beginFill(0x1A1408, 0.3);
    this.shadow.drawEllipse(2, 3, 12, 8);
    this.shadow.endFill();
    this.addChild(this.shadow);

    // Base disc — regiment color
    this.baseDisc = new PIXI.Graphics();
    this.baseDisc.beginFill(config.regimentColor, 0.8);
    this.baseDisc.drawCircle(0, 0, 10);
    this.baseDisc.endFill();
    this.addChild(this.baseDisc);

    // Figurine icon (loaded from spritesheet)
    this.figurine = new PIXI.Sprite(config.iconTexture);
    this.figurine.anchor.set(0.5);
    this.figurine.width = 16;
    this.figurine.height = 16;
    this.figurine.tint = 0xC9A84C; // Brass color
    this.addChild(this.figurine);

    // Status ring
    this.statusRing = new PIXI.Graphics();
    this.updateStatus(config.status);
    this.addChild(this.statusRing);

    // Task label
    this.taskLabel = new PIXI.Text('', {
      fontFamily: 'EB Garamond',
      fontSize: 10,
      fill: 0x4A3F2F,
      align: 'center',
    });
    this.taskLabel.anchor.set(0.5, 1);
    this.taskLabel.y = -18;
    this.addChild(this.taskLabel);
  }

  updateStatus(status: UnitStatus) {
    const colors: Record<UnitStatus, number> = {
      idle: 0xA89880,
      working: 0x556B2F,
      waiting: 0xB8860B,
      offline: 0x4A3F2F,
      alert: 0x8B1A1A,
    };

    this.statusRing.clear();
    this.statusRing.lineStyle(1.5, colors[status], 0.9);
    this.statusRing.drawCircle(0, 0, 12);
  }

  setTask(text: string) {
    this.taskLabel.text = text.length > 20 ? text.substring(0, 18) + '...' : text;
  }
}
```

#### Unit Selection Highlight

When selected, the unit gets:
- Status ring changes to `0xC9A84C` (brass), width increases to 2.5px
- A pulsing glow circle behind the unit (24px radius, brass color, 15% opacity, pulsing)
- Sound: quill scratch click

```typescript
setSelected(selected: boolean) {
  if (selected) {
    this.selectionGlow = new PIXI.Graphics();
    this.selectionGlow.beginFill(0xC9A84C, 0.15);
    this.selectionGlow.drawCircle(0, 0, 24);
    this.selectionGlow.endFill();
    this.addChildAt(this.selectionGlow, 0); // Behind everything

    // Pulse animation via ticker
    this.selectionGlow.alpha = 0.15;
    // Animate alpha between 0.1 and 0.25 using sine wave
  } else {
    this.selectionGlow?.destroy();
    this.selectionGlow = null;
  }
}
```

#### Enemy Unit Sprites

Enemy sprites (threats) use the same structure but:
- Base disc: `0x8B1A1A` (wax red)
- Figurine tint: `0x2C2410` (dark ink) — menacing silhouette
- Status ring: always `0xB22222` (wax red bright), pulsing
- No task label — replaced with threat name
- Shadow is slightly larger and darker (threat feels heavier)

### 7.3 Effect Rendering

#### Ink Splash (Combat, Task Failure)

```typescript
function createInkSplash(x: number, y: number, container: PIXI.Container) {
  const particles: PIXI.Graphics[] = [];

  for (let i = 0; i < 7; i++) {
    const p = new PIXI.Graphics();
    const size = Math.random() * 3 + 1;
    p.beginFill(0x1A1408, 0.7);
    p.drawCircle(0, 0, size);
    p.endFill();
    p.position.set(x, y);
    container.addChild(p);
    particles.push(p);

    // Animate outward with gravity
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 60 + 20;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 30; // upward bias

    animateParticle(p, vx, vy, 500); // 500ms lifetime
  }
}

function animateParticle(p: PIXI.Graphics, vx: number, vy: number, lifetime: number) {
  const start = Date.now();
  const ticker = (delta: number) => {
    const elapsed = Date.now() - start;
    const t = elapsed / lifetime;
    if (t >= 1) {
      p.destroy();
      PIXI.Ticker.shared.remove(ticker);
      return;
    }
    p.x += vx * delta * 0.016; // normalize to ~60fps
    p.y += vy * delta * 0.016;
    vy += 120 * delta * 0.016; // gravity
    p.alpha = 1 - t; // fade out
  };
  PIXI.Ticker.shared.add(ticker);
}
```

#### Quill Stroke (Road Building, Border Drawing)

Animated line that appears to be drawn by an invisible quill:

```typescript
function animateQuillStroke(
  path: PIXI.Point[],
  container: PIXI.Container,
  color: number = 0x2C2410,
  width: number = 2,
  speed: number = 200 // pixels per second
) {
  const line = new PIXI.Graphics();
  container.addChild(line);

  let currentSegment = 0;
  let segmentProgress = 0;

  const totalLength = calculatePathLength(path);
  const duration = (totalLength / speed) * 1000;
  const start = Date.now();

  const ticker = () => {
    const elapsed = Date.now() - start;
    const t = Math.min(elapsed / duration, 1);
    const targetDist = t * totalLength;

    // Redraw line up to targetDist
    line.clear();
    line.lineStyle({ width, color, alpha: 0.8, cap: PIXI.LINE_CAP.ROUND });
    line.moveTo(path[0].x, path[0].y);

    let accum = 0;
    for (let i = 1; i < path.length; i++) {
      const segLen = distBetween(path[i - 1], path[i]);
      if (accum + segLen <= targetDist) {
        line.lineTo(path[i].x, path[i].y);
        accum += segLen;
      } else {
        const remaining = targetDist - accum;
        const frac = remaining / segLen;
        const px = path[i - 1].x + (path[i].x - path[i - 1].x) * frac;
        const py = path[i - 1].y + (path[i].y - path[i - 1].y) * frac;
        line.lineTo(px, py);
        break;
      }
    }

    // Add ink drop at the current pen tip every ~60px
    // (track last drop position, spawn small circle when distance exceeds 60)

    if (t >= 1) {
      PIXI.Ticker.shared.remove(ticker);
    }
  };

  PIXI.Ticker.shared.add(ticker);
}
```

#### Watercolor Territory Spread (Territory Capture)

The signature visual. New color bleeds outward from the capture point with organic, noise-driven edges.

```typescript
function animateTerritoryCaptureWash(
  origin: PIXI.Point,
  territory: TerritoryVisual,
  newColor: number,
  container: PIXI.Container
) {
  // Create a radial mask that grows from origin
  const mask = new PIXI.Graphics();
  const wash = new PIXI.Graphics();

  // Draw the full territory wash in new color
  wash.beginFill(newColor, 0.12);
  wash.drawPolygon(territory.polygon);
  wash.endFill();
  wash.filters = [new PIXI.BlurFilter(8, 4)];
  wash.mask = mask;
  container.addChild(wash);
  container.addChild(mask);

  // Animate mask radius from 0 to territory bounding radius
  const maxRadius = calculateBoundingRadius(territory.polygon, origin);
  const duration = 1200; // ms
  const start = Date.now();

  const ticker = () => {
    const t = Math.min((Date.now() - start) / duration, 1);
    // Ease-in-out for organic feel
    const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const radius = easedT * maxRadius;

    mask.clear();
    mask.beginFill(0xFFFFFF);
    // Draw an irregular circle using noise for organic edge
    const points: number[] = [];
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
      const noise = 0.85 + Math.random() * 0.3; // 85%-115% variation
      const r = radius * noise;
      points.push(
        origin.x + Math.cos(angle) * r,
        origin.y + Math.sin(angle) * r
      );
    }
    mask.drawPolygon(points);
    mask.endFill();

    if (t >= 1) {
      // Clean up mask, keep wash
      wash.mask = null;
      mask.destroy();
      PIXI.Ticker.shared.remove(ticker);
    }
  };

  PIXI.Ticker.shared.add(ticker);
}
```

### 7.4 Fog of War Shader

Fog is rendered as a full-world overlay that darkens areas proportional to their fog level. It is NOT a per-hex toggle — it is a smooth, painted effect.

```typescript
class FogOverlay {
  private container: PIXI.Container;
  private fogGraphics: PIXI.Graphics;

  constructor(worldContainer: PIXI.Container) {
    this.container = new PIXI.Container();
    this.fogGraphics = new PIXI.Graphics();
    this.container.addChild(this.fogGraphics);
    worldContainer.addChild(this.container);

    // Fog sits above territories but below units
    this.container.zIndex = 5;
  }

  update(territories: Map<string, { polygon: number[]; fogLevel: number }>) {
    this.fogGraphics.clear();

    for (const [id, terr] of territories) {
      if (terr.fogLevel <= 0.02) continue; // Fully clear, skip

      // Fog color: dark sepia, not black
      // Alpha scales with fog level
      const alpha = terr.fogLevel * 0.75; // Max 75% opacity even at full fog
      this.fogGraphics.beginFill(0x1A1408, alpha);
      this.fogGraphics.drawPolygon(terr.polygon);
      this.fogGraphics.endFill();
    }

    // Apply blur for soft edges between fogged/clear territories
    this.fogGraphics.filters = [new PIXI.BlurFilter(12, 6)];
  }

  // Animate fog clearing when a scout reveals a territory
  animateClear(territoryId: string, fromPoint: PIXI.Point, duration: number = 800) {
    // Same radial reveal as territory capture, but removing fog instead of adding color
    // Creates a "hole" in the fog that expands from the scout's position
  }
}
```

Fog edge treatment: where fog meets clear parchment, the boundary is feathered (blur filter handles this). The fog should look like ink wash pooling at the edges of the territory — NOT like a shadow or a flat overlay.

### 7.5 Road Rendering

Roads are ink lines connecting territories. Higher-level roads are darker and thicker.

```typescript
const ROAD_STYLES: Record<number, { width: number; color: number; alpha: number; dash?: number[] }> = {
  1: { width: 1.0, color: 0xA89880, alpha: 0.4 },                    // Dirt path — ghost ink
  2: { width: 1.5, color: 0x6B5D4A, alpha: 0.5 },                    // Trade route — light ink
  3: { width: 2.0, color: 0x4A3F2F, alpha: 0.6 },                    // Supply line — mid ink
  4: { width: 2.5, color: 0x2C2410, alpha: 0.7 },                    // Military road — dark ink
  5: { width: 3.0, color: 0x1A1408, alpha: 0.8 },                    // Imperial highway — black ink
};

function renderRoad(path: PIXI.Point[], level: number, container: PIXI.Container) {
  const style = ROAD_STYLES[level] || ROAD_STYLES[1];
  const g = new PIXI.Graphics();

  g.lineStyle({
    width: style.width,
    color: style.color,
    alpha: style.alpha,
    cap: PIXI.LINE_CAP.ROUND,
    join: PIXI.LINE_JOIN.ROUND,
  });

  g.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    g.lineTo(path[i].x, path[i].y);
  }

  container.addChild(g);
}
```

### 7.6 Building / Rally Point Rendering

Buildings are ink-sketch illustrations — like icons drawn by a cartographer on a military map. They sit at fixed positions within territories.

```typescript
// Building sprites are loaded from a spritesheet of hand-drawn ink sketches
// Each is ~32x32px, monochrome ink on transparent background
// Tinted with territory regiment color at 50% blend

const BUILDING_TYPES = {
  notion_db:    { icon: 'building-archive',   label: 'Archive' },
  kit_list:     { icon: 'building-outpost',   label: 'Outpost' },
  supabase:     { icon: 'building-fortress',  label: 'Fortress' },
  github_repo:  { icon: 'building-workshop',  label: 'Workshop' },
  slack_channel: { icon: 'building-signal',   label: 'Signal Tower' },
  stripe:       { icon: 'building-treasury',  label: 'Treasury' },
  calendar:     { icon: 'building-watchtower', label: 'Watchtower' },
};

function renderBuilding(
  type: keyof typeof BUILDING_TYPES,
  position: PIXI.Point,
  container: PIXI.Container
) {
  const config = BUILDING_TYPES[type];
  const sprite = new PIXI.Sprite(PIXI.Texture.from(config.icon));
  sprite.anchor.set(0.5);
  sprite.position.copyFrom(position);
  sprite.width = 32;
  sprite.height = 32;
  sprite.alpha = 0.7; // Ink sketch, not bold

  // Label below
  const label = new PIXI.Text(config.label, {
    fontFamily: 'Cormorant SC',
    fontSize: 9,
    fill: 0x6B5D4A,
    align: 'center',
    letterSpacing: 1,
  });
  label.anchor.set(0.5, 0);
  label.position.set(position.x, position.y + 20);

  container.addChild(sprite);
  container.addChild(label);
}
```

### 7.7 Particle System Colors and Shapes

All particles match the Napoleon aesthetic — no neon, no pure white, no modern glows.

| Effect | Shape | Color(s) | Size | Lifetime |
|--------|-------|----------|------|----------|
| Task complete | Circle | `0x556B2F` (olive), `0x6B8E23` | 1-3px | 400ms |
| Revenue | Circle | `0xC9A84C` (brass), `0xF0D78C` | 2-4px | 600ms |
| Error/failure | Splat (irregular) | `0x8B1A1A` (wax red), `0x2C2410` | 2-5px | 500ms |
| Unit spawn | Circle (smoke puff) | `0xD4C49A` (parchment-aged), `0xB8A67E` | 3-6px | 800ms |
| Combat spark | Diamond | `0xF0D78C` (brass highlight) | 1-2px | 300ms |
| Fog clearing | Circle (dissolve) | `0xF5ECD7` (parchment light) | 4-8px | 600ms |
| Connection line | Dashed line segment | `0xC9A84C` at 40% alpha | 1px wide | Persistent |
| Projectile trail | Circle | Match regiment color, 30% alpha | 1-2px | 200ms |

#### Gold Coin Particle (Revenue)

Special case: revenue events spawn a gold coin that arcs from the territory to the revenue counter in the top bar.

```typescript
function spawnGoldCoinArc(
  worldOrigin: PIXI.Point,
  screenTarget: PIXI.Point, // Revenue counter position in screen space
  container: PIXI.Container
) {
  const coin = new PIXI.Graphics();
  coin.beginFill(0xC9A84C);
  coin.drawEllipse(0, 0, 4, 3); // Slightly oval = coin seen at angle
  coin.endFill();
  coin.beginFill(0xF0D78C, 0.5);
  coin.drawEllipse(-1, -1, 2, 1.5); // Highlight
  coin.endFill();

  container.addChild(coin);

  // Parabolic arc from origin to target over 800ms
  const duration = 800;
  const start = Date.now();
  const arcHeight = 80; // pixels above the midpoint

  const ticker = () => {
    const t = Math.min((Date.now() - start) / duration, 1);
    const easedT = t; // Linear for smooth arc

    // Lerp x
    coin.x = worldOrigin.x + (screenTarget.x - worldOrigin.x) * easedT;
    // Parabolic y
    const midY = (worldOrigin.y + screenTarget.y) / 2 - arcHeight;
    coin.y = (1 - easedT) * (1 - easedT) * worldOrigin.y
           + 2 * (1 - easedT) * easedT * midY
           + easedT * easedT * screenTarget.y;

    // Scale down as it approaches target (perspective)
    coin.scale.set(1 - easedT * 0.5);
    coin.alpha = 1 - easedT * 0.3;

    if (t >= 1) {
      coin.destroy();
      PIXI.Ticker.shared.remove(ticker);
      // Trigger revenue number animation in HUD
    }
  };

  PIXI.Ticker.shared.add(ticker);
}
```

### 7.8 Minimap Rendering

The minimap mirrors the full battlefield at reduced scale, rendered into a separate `PIXI.Application` or `PIXI.RenderTexture`.

```typescript
class Minimap {
  private rt: PIXI.RenderTexture;
  private sprite: PIXI.Sprite;
  private graphics: PIXI.Graphics;
  private viewportRect: PIXI.Graphics;

  private readonly MINIMAP_W = 200;
  private readonly MINIMAP_H = 150;
  private readonly WORLD_W = 4000;
  private readonly WORLD_H = 3000;

  constructor(hudContainer: PIXI.Container) {
    this.rt = PIXI.RenderTexture.create({
      width: this.MINIMAP_W,
      height: this.MINIMAP_H,
    });
    this.sprite = new PIXI.Sprite(this.rt);
    this.graphics = new PIXI.Graphics();
    this.viewportRect = new PIXI.Graphics();

    hudContainer.addChild(this.sprite);
    hudContainer.addChild(this.viewportRect);
  }

  update(
    renderer: PIXI.Renderer,
    territories: TerritoryVisual[],
    units: UnitSprite[],
    threats: UnitSprite[],
    camera: { x: number; y: number; width: number; height: number }
  ) {
    const scaleX = this.MINIMAP_W / this.WORLD_W;
    const scaleY = this.MINIMAP_H / this.WORLD_H;

    this.graphics.clear();

    // Parchment base
    this.graphics.beginFill(0xE8D9B5);
    this.graphics.drawRect(0, 0, this.MINIMAP_W, this.MINIMAP_H);
    this.graphics.endFill();

    // Territory washes (simplified)
    for (const t of territories) {
      this.graphics.beginFill(t.regimentColor, 0.2);
      const scaled = t.polygon.map((v, i) => v * (i % 2 === 0 ? scaleX : scaleY));
      this.graphics.drawPolygon(scaled);
      this.graphics.endFill();
    }

    // Unit dots
    for (const u of units) {
      this.graphics.beginFill(0x556B2F); // Green = friendly
      this.graphics.drawCircle(u.x * scaleX, u.y * scaleY, 2);
      this.graphics.endFill();
    }

    // Threat dots (pulsing red)
    for (const t of threats) {
      this.graphics.beginFill(0xB22222);
      this.graphics.drawCircle(t.x * scaleX, t.y * scaleY, 2);
      this.graphics.endFill();
    }

    renderer.render(this.graphics, { renderTexture: this.rt });

    // Camera viewport rectangle
    this.viewportRect.clear();
    this.viewportRect.lineStyle(1, 0xC9A84C, 0.8);
    this.viewportRect.drawRect(
      camera.x * scaleX,
      camera.y * scaleY,
      camera.width * scaleX,
      camera.height * scaleY
    );
  }
}
```

---

## 8. Asset Checklist

A summary of all assets needed before implementation begins:

### Fonts (Google Fonts — free)
- [x] Playfair Display (400, 700, 900)
- [x] EB Garamond (400, 500, 600, 700 + italic 400, 500)
- [x] Libre Baskerville (400, 700)
- [x] JetBrains Mono (400, 500)
- [x] Cormorant SC (400, 600, 700)

### SVG Icons (Hand-drawn / engraved style, created or sourced)
- [ ] 6 resource icons (star medal, powder keg, hourglass, tent, brass plaque, pocket watch)
- [ ] 8 unit badge icons (crown, shield, spyglass, quill, dividers, crossed swords, cross, olive branch)
- [ ] 6 territory heraldic shields (trumpet, sword, anvil, shield wall, chain links, eagle)
- [ ] 5 status flag pennants (white, green, amber, black, red)
- [ ] 7 navigation icons (compass rose, zoom in/out, center, grid, lantern, gear)
- [ ] 7 building sketch icons (archive, outpost, fortress, workshop, signal tower, treasury, watchtower)
- [ ] 4 ink splatter decorations (small SVGs for panel corners)

### Textures (Generated procedurally or from free sources)
- [ ] Parchment tile (512x512 PNG or procedural)
- [ ] Torn/deckled edge border-image strip
- [ ] Leather grain tile (128x128 or inline SVG noise)
- [ ] Wax seal base (can be pure CSS, see section 1.4)

### Sounds (All synthesized via Tone.js — no audio files)
- All sounds defined by synthesis parameters in Section 4
- Zero audio files needed

---

*This document is the visual and experiential soul of Agent Empires. Every hex, every unit, every notification should feel like it belongs on Napoleon's war table. When in doubt, ask: "Would this look right drawn in ink on aged parchment, lit by candlelight?" If yes, ship it.*
