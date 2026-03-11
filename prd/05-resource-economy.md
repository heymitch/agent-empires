# Agent Empires — Resource Tracking & Economy System

## PRD 05: The War Chest

> ### Status Summary (2026-03-10)
>
> **Assessment:** ResourceBar ships with revenue display, token aggregation, unit count, and score. The full economy (Morale resource, Economy Panel, Stripe webhook edge function, sparklines, income/expense feed) is unimplemented.
>
> - [x] **ResourceBar HUD (revenue, tokens, units, score)** — `src/hud/ResourceBar.ts`
> - [x] **Token tracking per session** — `ResourceBar.ts` accumulates per-session token estimates
> - [x] **Score display** — `ResourceBar.ts` renders campaign score
> - [x] **Revenue display ($MTD)** — `ResourceBar.ts` renders revenue field
> - [ ] **MORALE resource (4th primary resource)** — not implemented anywhere in src
> - [ ] **Economy Panel (expanded breakdown view)** — no EconomyPanel component found
> - [ ] **Supabase `ae_transactions` table** — referenced only in PRDs, no server code writes to it
> - [ ] **Stripe webhook edge function** — exists only as code block in this PRD, not deployed
> - [ ] **Income/expense live feed** — not implemented
> - [ ] **30-day sparkline on hover** — not implemented
> - [ ] **Resource particle animations (gold burst, coin-drain)** — not implemented
> - [ ] **Napoleon aesthetic (brass coin icons, parchment textures)** — not implemented

**Depends on:** `01-vision.md` (resource bar, campaign score), `02-physics-and-movement.md` (territory layout), `02c-combat-and-roads-spec.md` (particle systems)
**Status:** Design spec
**Last updated:** 2026-03-10

---

## Table of Contents

1. [Resource Types — The Full Economy](#1-resource-types)
2. [The Resource Bar (Top HUD)](#2-the-resource-bar)
3. [Economy Panel (Expanded View)](#3-economy-panel)
4. [Token Tracking Deep Dive](#4-token-tracking)
5. [Income/Expense Live Feed](#5-income-expense-feed)
6. [The Score](#6-the-score)
7. [Napoleon Aesthetic Guidelines](#7-napoleon-aesthetic)
8. [Supabase Schema](#8-supabase-schema)
9. [TypeScript Interfaces](#9-typescript-interfaces)
10. [PixiJS Rendering](#10-pixi-rendering)
11. [Implementation Plan](#11-implementation-plan)

---

## 1. Resource Types

Every number in the economy maps to something real. No vanity metrics. If you can't trace a resource back to a Supabase query, a Stripe webhook, or a tmux session, it doesn't belong on the HUD.

### 1.1 Primary Resources (Always Visible in Top Bar)

These four resources are always on screen. The general never takes his eyes off them.

#### GOLD — Revenue ($)

| Property | Value |
|---|---|
| **Business meaning** | Money in. Stripe payments, client invoices, one-time and recurring. |
| **Data source** | `ae_transactions` table, fed by Stripe webhooks via Supabase edge function |
| **Update frequency** | Real-time (Supabase Realtime subscription on `ae_transactions`) |
| **Display format** | `$12,450 MTD` with delta `(+$350 today)` |
| **Icon** | Brass coin with imperial eagle stamp |
| **Color** | `#C9A84C` (aged gold) normal, `#E8C84C` on increase, `#8B4513` on decrease |
| **Critical thresholds** | Below daily average for 3 consecutive days → amber pulse. Revenue event → gold burst particles from originating territory. Refund → red flash + coin-drain animation. |
| **Historical** | 30-day sparkline on hover. Full breakdown in Economy Panel. |

#### SUPPLY — Context Tokens (Aggregate)

| Property | Value |
|---|---|
| **Business meaning** | Total context window capacity across all active Claude sessions. The fuel for your army. |
| **Data source** | Vibecraft hook events (`pre_tool_use`, `post_tool_use`) contain token estimates. Aggregated in `ae_token_ledger`. Fallback: estimate from tool call count × average tokens per tool type. |
| **Update frequency** | Per tool call (real-time via WebSocket) |
| **Display format** | Fill bar with percentage: `████░░ 67%` + absolute when hovered: `134K / 200K` |
| **Icon** | Powder keg (ammunition supply) |
| **Color** | `#4A7C59` (forest green) > 50%, `#C9A84C` (amber) 20-50%, `#8B2500` (crimson) < 20% |
| **Critical thresholds** | Any single unit < 20% → that unit's health bar pulses red + notification: "Writer-01 running low on supply — rotate or complete current task." Aggregate < 30% → top bar supply icon pulses. |
| **Historical** | Hourly token burn rate chart in Economy Panel. Per-unit breakdown on click. |

#### POPULATION — Active Agents / Max Sessions

| Property | Value |
|---|---|
| **Business meaning** | How many Claude Code sessions are running vs. your subscription's concurrent limit. |
| **Data source** | tmux session list (already tracked by Vibecraft's session manager). Max from `ae_config.max_concurrent_sessions`. |
| **Update frequency** | On session spawn/kill (real-time) |
| **Display format** | `4/5` (current / max) |
| **Icon** | Regiment banner with count |
| **Color** | `#4A7C59` (green) when headroom available, `#C9A84C` (amber) at max-1, `#8B2500` (red) at max |
| **Critical thresholds** | At max → "Army at full strength. Dismiss a unit before deploying." At 0 → "No units deployed. Your empire is undefended." |
| **Historical** | Peak concurrent by hour (when is the army largest?) in Economy Panel. |

#### TIME — Work Block Remaining

| Property | Value |
|---|---|
| **Business meaning** | How much focused work time remains in the current block. Integrates with Google Calendar to know when the next meeting/interruption hits. |
| **Data source** | Google Calendar MCP → next event calculation. User can also set manual blocks via command bar: `set work block 3h`. Stored in `ae_config`. |
| **Update frequency** | Every 60 seconds (countdown timer) + on calendar change |
| **Display format** | `2h 15m left` (countdown) or `FREE` if no upcoming events |
| **Icon** | Pocket watch (brass, Napoleonic) |
| **Color** | `#4A7C59` > 1h, `#C9A84C` 15m-1h, `#8B2500` < 15m |
| **Critical thresholds** | < 15 minutes → "Prepare to withdraw. 15 minutes until [Meeting Name]." < 5 minutes → resource bar flashes, all unit task labels show estimated time to complete. |
| **Historical** | Total focused hours per day/week in Economy Panel. |

### 1.2 Secondary Resources (Economy Panel)

These appear in the expanded Economy Panel and as territory-level indicators on the map. Not always on screen, but always tracked.

#### CRYSTAL — Content Assets Produced

| Property | Value |
|---|---|
| **Business meaning** | Content output: LinkedIn posts, emails, carousels, newsletters, tweets. The ammunition your lead-gen front fires. |
| **Data source** | Hook events where tool = `Write` and file path matches content patterns (`content/`, `posts/`, `emails/`). Counted in `ae_production_log` with type = `content`. Also manual entries from command bar: `log crystal: published LI post on skill stacking`. |
| **Update frequency** | Per content creation event |
| **Display format** | `23 this week` with breakdown by type on hover |
| **Icon** | Crystal inkwell (diamond shape with quill) |
| **Color** | `#6B5B95` (royal purple) |
| **Threshold** | Below weekly target → territory fog increases on Lead-Gen front. Above target → crystal shimmer effect on Lead-Gen territory. |

#### IRON — Technical Assets Built

| Property | Value |
|---|---|
| **Business meaning** | Skills, tools, integrations, plugins, edge functions — the infrastructure of your empire. |
| **Data source** | Hook events where tool = `Write` and file path matches `skills/`, `SKILL.md`, `.plugin.zip`, `edge-functions/`. Counted in `ae_production_log` with type = `technical`. |
| **Update frequency** | Per build event |
| **Display format** | `7 skills, 3 tools this month` |
| **Icon** | Anvil with hammer |
| **Color** | `#5B7C99` (steel blue) |
| **Threshold** | New skill created → anvil strike animation + sound. Infrastructure Score recalculates. |

#### FOOD — Leads & Subscribers

| Property | Value |
|---|---|
| **Business meaning** | Pipeline fuel. Kit subscribers, waitlist signups, inbound inquiries. Without food, the army starves — no new revenue. |
| **Data source** | Kit API (ConvertKit) subscriber count, polled hourly. Stripe customer creation events. Manual: `log food: 12 new CCB waitlist signups`. Stored in `ae_resource_snapshots`. |
| **Update frequency** | Hourly poll + real-time on webhook events |
| **Display format** | `1,247 total` with `+34 this week` delta |
| **Icon** | Grain sack (wheat sheaf) |
| **Color** | `#8B7355` (wheat brown) |
| **Threshold** | Week-over-week decline → amber warning on Lead-Gen territory. 3 consecutive weeks of decline → "Famine warning: lead pipeline contracting." |

#### MANA — API Credits & Edge Function Invocations

| Property | Value |
|---|---|
| **Business meaning** | External API calls that cost money or have rate limits: Supabase edge function invocations, Ayrshare posts, GPTZero checks, OpenAI embeddings. |
| **Data source** | Supabase edge function logs (`ae_api_usage`). OpenAI billing API. Ayrshare usage endpoint. |
| **Update frequency** | Hourly aggregate |
| **Display format** | `$4.20 today` (API costs) with breakdown on hover |
| **Icon** | Alchemist's flask (glowing blue) |
| **Color** | `#4169E1` (royal blue) |
| **Threshold** | Daily API spend > $10 → warning. Any single API hitting rate limit → red flask icon + notification. |

### 1.3 Derived Metrics (Kingdom Stats)

Calculated from primary and secondary resources. Shown in the Economy Panel's "State of the Empire" section and referenced in Campaign scoring.

| Metric | Formula | Display |
|---|---|---|
| **MRR** | Sum of active Stripe subscriptions with `interval=month` | `$8,200/mo` |
| **Burn Rate** | Tokens consumed per hour (rolling 4h average) | `12.4K tok/hr` |
| **Efficiency** | (Crystal + Iron produced) / (tokens consumed / 10000) | `3.2 assets per 10K tokens` |
| **Territory Control** | Count of territories with fog < 0.3 / total territories | `4/6 (67%)` |
| **Army Strength** | `(commanders×5) + (lieutenants×3) + (scouts×2) + (others×1)` | `17 strength` |
| **Infrastructure Score** | Unique skills available + active integrations + road count (from 02c) | `Score: 42` |
| **Runway** | Current MRR / monthly burn (subscriptions + API costs + tools) | `14.2 months` |
| **Campaign Velocity** | Score change per day (rolling 7-day) | `+2.3/day` |

---

## 2. The Resource Bar (Top HUD)

### 2.1 Layout Specification

The resource bar is a fixed-position HTML overlay above the PixiJS canvas. Not rendered in PixiJS — DOM elements for crisp text and easy interaction.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🪙 $12,450 MTD (+$350)  │  ⚊ ████░░ 67%  │  ⚑ 4/5  │  ⏱ 2h15m  │  ★ 847 │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Pixel Layout (1920px viewport)

```
Total bar: 1920px × 48px, fixed top
Padding: 16px left/right
Background: rgba(42, 36, 28, 0.92) — dark parchment with slight transparency

Segments (left to right):
┌────────────────────────────────────────────────────────────────────────┐
│ [GOLD]        [SUPPLY]       [POP]     [TIME]      [SCORE]  [ALERTS] │
│ 0-380px       380-720px      720-920   920-1140    1140-1400 1400+   │
│ 24% width     21% width      12.5%     13.8%       16.2%    flex     │
└────────────────────────────────────────────────────────────────────────┘

Each segment:
  - Icon: 24×24px sprite (left-aligned within segment)
  - Label: 12px uppercase, color #8B7355 (muted wheat)
  - Value: 18px bold, color per resource
  - Delta: 12px, green for positive, red for negative
  - Separator: 1px vertical line, color #5C4A32 (dark brass)
```

#### CSS Specification

```css
:root {
  /* Napoleon palette */
  --parchment-dark: #2A241C;
  --parchment-mid: #3D3428;
  --parchment-light: #F4E8C1;
  --brass: #C9A84C;
  --brass-bright: #E8C84C;
  --brass-dim: #8B7355;
  --ink-dark: #1A1610;
  --ink-mid: #3D3428;
  --crimson: #8B2500;
  --crimson-bright: #C41E3A;
  --forest: #4A7C59;
  --forest-bright: #5DAE6E;
  --amber: #C9A84C;
  --steel: #5B7C99;
  --royal-purple: #6B5B95;
  --royal-blue: #4169E1;
  --wheat: #8B7355;
  --wax-red: #8B0000;

  /* Typography */
  --font-display: 'Playfair Display', 'Georgia', serif;
  --font-body: 'Source Serif 4', 'Georgia', serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
  --font-data: 'Tabular Nums', 'JetBrains Mono', monospace;

  /* Candlelight warmth — applied as a subtle overlay */
  --warmth-filter: sepia(8%) saturate(110%) brightness(98%);
}

.resource-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--parchment-dark);
  border-bottom: 2px solid var(--brass-dim);
  display: flex;
  align-items: center;
  padding: 0 16px;
  z-index: 1000;
  font-family: var(--font-data);
  filter: var(--warmth-filter);
  /* Aged parchment texture overlay */
  background-image:
    url('/textures/parchment-grain.png'),
    linear-gradient(180deg, rgba(60, 50, 35, 0.95), rgba(42, 36, 28, 0.98));
  background-blend-mode: overlay;
}

.resource-segment {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-right: 1px solid var(--brass-dim);
  height: 100%;
  cursor: pointer;
  transition: background 0.2s ease;
}

.resource-segment:hover {
  background: rgba(201, 168, 76, 0.08);
}

.resource-segment:last-child {
  border-right: none;
}

.resource-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.resource-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--brass-dim);
  font-family: var(--font-display);
}

.resource-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--parchment-light);
  font-variant-numeric: tabular-nums;
  /* Ensures numbers don't shift layout when they change */
  min-width: 80px;
}

.resource-delta {
  font-size: 11px;
  font-weight: 400;
}

.resource-delta--positive { color: var(--forest-bright); }
.resource-delta--negative { color: var(--crimson-bright); }
.resource-delta--neutral  { color: var(--brass-dim); }

/* Supply bar specific */
.supply-bar-track {
  width: 120px;
  height: 12px;
  background: var(--ink-dark);
  border-radius: 2px;
  border: 1px solid var(--brass-dim);
  overflow: hidden;
}

.supply-bar-fill {
  height: 100%;
  border-radius: 1px;
  transition: width 0.6s ease-out, background-color 0.3s ease;
}

.supply-bar-fill--healthy { background: var(--forest); }
.supply-bar-fill--warning { background: var(--amber); }
.supply-bar-fill--critical {
  background: var(--crimson);
  animation: supply-pulse 1s ease-in-out infinite;
}

@keyframes supply-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Score badge */
.score-badge {
  background: linear-gradient(135deg, var(--brass), var(--brass-bright));
  color: var(--ink-dark);
  font-size: 16px;
  font-weight: 800;
  padding: 4px 12px;
  border-radius: 4px;
  font-family: var(--font-display);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15);
}
```

### 2.2 Animation Behaviors

```typescript
/** Number count-up/down animation for resource values */
interface ResourceAnimation {
  /** Target value to animate toward */
  target: number
  /** Current displayed value */
  current: number
  /** Duration in ms — longer for bigger deltas */
  durationMs: number
  /** Easing function */
  easing: 'easeOutCubic' | 'easeOutExpo'
}

/**
 * When a value changes:
 * 1. Flash the value text:
 *    - Increase → bright green (#5DAE6E) flash, fades back in 800ms
 *    - Decrease → bright red (#C41E3A) flash, fades back in 800ms
 * 2. Count up/down from old value to new value over 600ms
 * 3. Delta text appears/updates with +/- amount
 * 4. If gold increases by > $100, play coin-clink sound
 * 5. If supply drops below threshold, transition bar color over 300ms
 */

const ANIMATION_CONFIG = {
  valueFlashDuration: 800,
  countDuration: 600,
  countEasing: 'easeOutCubic',
  deltaFadeIn: 200,
  barColorTransition: 300,
  // Stagger multiple simultaneous updates by 100ms each
  staggerDelay: 100,
} as const
```

### 2.3 Warning States

| Condition | Visual | Sound |
|---|---|---|
| Supply < 20% aggregate | Supply bar pulses red (1s cycle). Bar segment background shifts to `rgba(139,37,0,0.15)`. | Low drum warning (single hit) |
| Supply < 10% aggregate | Supply bar solid red + "CRITICAL" badge appears. | War drum roll (repeating) |
| Single unit < 15% supply | That unit's icon in the bar gets a red pip. | Subtle radar ping |
| Gold declining 3+ days | Gold value color shifts to amber. Downward arrow icon appears. | None (silent drain is scarier) |
| Population at max | Pop count turns amber. Deploy button disabled with tooltip. | None |
| Time < 5 minutes | Time segment background pulses amber. Value turns red. | Pocket watch chime |
| Score milestone (every 100) | Score badge does a brass shimmer animation (1.5s). | Trumpet stinger |

### 2.4 Click Interactions

| Click Target | Result |
|---|---|
| Gold segment | Opens Economy Panel → Income tab |
| Supply segment | Opens Economy Panel → Token Breakdown tab (per-unit fuel gauges) |
| Population segment | Opens Unit Roster overlay (list of all units with status) |
| Time segment | Opens Calendar sidebar (upcoming events, work block controls) |
| Score segment | Opens Campaign Panel → Score breakdown |
| Any segment (hover, hold 500ms) | Shows sparkline tooltip: 7-day trend mini-chart |

### 2.5 Sparkline Tooltip

On hover-hold (500ms delay to avoid flicker), a tooltip appears below the segment:

```
┌─────────────────────────┐
│  Revenue — 7 Day Trend  │
│  ╱╲    ╱╲               │
│ ╱  ╲╱╱╱  ╲╱╲            │
│ $8.2K ──────── $12.4K   │
│ Mar 3          Mar 10   │
└─────────────────────────┘

Width: 240px, Height: 80px
Background: var(--parchment-dark)
Border: 1px solid var(--brass-dim)
Chart: SVG path, stroke var(--brass), fill none
Labels: var(--font-mono), 10px, var(--brass-dim)
```

---

## 3. Economy Panel (Expanded View)

The Economy Panel is the general's war chest review — opened by clicking Gold or pressing `E`. It slides in from the right (400px wide) or can be expanded to full overlay (80% viewport).

This is NOT a spreadsheet. It's a campaign ledger rendered on parchment.

### 3.1 Panel Sections

#### Tab 1: Treasury (Income & Expenses)

```
┌─────────────────────────────────────────┐
│  ≡ THE TREASURY                    [×]  │
│  ─────────────────────────────────────  │
│                                         │
│  CAMPAIGN COFFERS          March 2026   │
│  ┌─────────────────────────────────┐    │
│  │  Revenue    $12,450    ████████ │    │
│  │  Expenses    $2,180    ██░░░░░░ │    │
│  │  ─────────────────────────────  │    │
│  │  Net         $10,270   ★ PROFIT │    │
│  └─────────────────────────────────┘    │
│                                         │
│  INCOME BY SOURCE                       │
│  ┌───────────────────────────────────┐  │
│  │ ■ CCB Subscriptions   $6,200  50%│  │
│  │ ■ Skool Memberships   $3,400  27%│  │
│  │ ■ Consulting          $1,850  15%│  │
│  │ ■ One-time Sales      $1,000   8%│  │
│  └───────────────────────────────────┘  │
│                                         │
│  EXPENSES BY CATEGORY                   │
│  ┌───────────────────────────────────┐  │
│  │ ▪ Claude Pro            $200   9%│  │
│  │ ▪ Supabase              $25    1%│  │
│  │ ▪ Vercel                $20    1%│  │
│  │ ▪ Kit (ConvertKit)     $149    7%│  │
│  │ ▪ Skool                $99     5%│  │
│  │ ▪ API Costs (mana)     $127    6%│  │
│  │ ▪ Other tools        $1,560   71%│  │
│  └───────────────────────────────────┘  │
│                                         │
│  RUNWAY: 14.2 months at current burn    │
│  MRR: $8,200 (▲ 12% vs last month)     │
│                                         │
│  [View Full Ledger]  [Export CSV]       │
└─────────────────────────────────────────┘
```

Rendered with:
- Horizontal bar charts using CSS (not a charting library — keeps the hand-drawn feel)
- Color-coded by source (each income stream gets a territory color)
- Parchment card backgrounds with subtle drop shadows
- Serif headers, mono numbers

#### Tab 2: Supply Depot (Token Breakdown)

```
┌─────────────────────────────────────────┐
│  ≡ SUPPLY DEPOT                    [×]  │
│  ─────────────────────────────────────  │
│                                         │
│  AGGREGATE BURN: 12.4K tokens/hr        │
│  TODAY: 89,200 tokens consumed          │
│  ESTIMATED COST: ~$2.40                 │
│                                         │
│  PER-UNIT FUEL GAUGES                   │
│  ┌───────────────────────────────────┐  │
│  │ Commander-01  ████████░░  82%     │  │
│  │   Task: Orchestrating CCB batch   │  │
│  │   Burn rate: 3.2K/hr              │  │
│  │                                   │  │
│  │ Writer-01     █████░░░░░  48%  ⚠  │  │
│  │   Task: LinkedIn post series      │  │
│  │   Burn rate: 5.1K/hr ← HEAVY     │  │
│  │                                   │  │
│  │ Scout-01      ███████░░░  71%     │  │
│  │   Task: Competitor analysis       │  │
│  │   Burn rate: 2.8K/hr              │  │
│  │                                   │  │
│  │ Engineer-01   ██████████  95%     │  │
│  │   Task: Idle (awaiting orders)    │  │
│  │   Burn rate: 0.1K/hr             │  │
│  └───────────────────────────────────┘  │
│                                         │
│  BURN RATE CHART (last 24h)             │
│  ┌───────────────────────────────────┐  │
│  │      ╱╲                           │  │
│  │  ╱╲╱╱  ╲     ╱╲                  │  │
│  │ ╱       ╲╲╱╱╱  ╲╲╱              │  │
│  │ 9am    12pm    3pm    6pm   now  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  TOP TOKEN CONSUMERS (this week)        │
│  1. Content generation    42%           │
│  2. Research/scouting     28%           │
│  3. Skill building        18%           │
│  4. Orchestration         12%           │
│                                         │
│  [Rotate Writer-01]  [Optimize All]     │
└─────────────────────────────────────────┘
```

#### Tab 3: Production (Crystal + Iron)

```
┌─────────────────────────────────────────┐
│  ≡ PRODUCTION REPORT               [×]  │
│  ─────────────────────────────────────  │
│                                         │
│  CRYSTAL (Content)     23 this week     │
│  ┌───────────────────────────────────┐  │
│  │ LinkedIn posts      8   ████████  │  │
│  │ Emails              6   ██████    │  │
│  │ Carousels           4   ████      │  │
│  │ Newsletters         3   ███       │  │
│  │ Tweets              2   ██        │  │
│  └───────────────────────────────────┘  │
│  Weekly target: 20  Status: ★ EXCEEDED  │
│                                         │
│  IRON (Technical)      4 this month     │
│  ┌───────────────────────────────────┐  │
│  │ Skills built        2             │  │
│  │ Plugins packaged    1             │  │
│  │ Edge functions      1             │  │
│  └───────────────────────────────────┘  │
│                                         │
│  FOOD (Pipeline)                        │
│  Total subscribers: 1,247 (+34 WoW)     │
│  CCB waitlist: 89                       │
│  Skool members: 312                     │
│  ┌───────────────────────────────────┐  │
│  │ Subscriber growth (30d)           │  │
│  │         ╱╱╱                       │  │
│  │    ╱╱╱╱╱                          │  │
│  │ ╱╱╱                               │  │
│  └───────────────────────────────────┘  │
│                                         │
│  EFFICIENCY: 3.2 assets per 10K tokens  │
│  vs last week: 2.8 (▲ 14%)             │
└─────────────────────────────────────────┘
```

#### Tab 4: State of the Empire (Derived Metrics Dashboard)

A single-page overview with all Kingdom Stats rendered as a Napoleon-era campaign report. Think: field marshal's briefing document.

```
┌──────────────────────────────────────────────┐
│  ═══ STATE OF THE EMPIRE ═══                 │
│  Campaign: Q1 2026 — Scale CCB to 100        │
│  Day 68 of Campaign  |  Score: 847           │
│                                              │
│  ┌──────────────┐  ┌──────────────┐          │
│  │  MRR         │  │  RUNWAY      │          │
│  │  $8,200/mo   │  │  14.2 months │          │
│  │  ▲ 12% MoM   │  │  ● HEALTHY   │          │
│  └──────────────┘  └──────────────┘          │
│                                              │
│  ┌──────────────┐  ┌──────────────┐          │
│  │  ARMY        │  │  TERRITORY   │          │
│  │  17 strength │  │  4/6 control │          │
│  │  4 units     │  │  67%         │          │
│  └──────────────┘  └──────────────┘          │
│                                              │
│  ┌──────────────┐  ┌──────────────┐          │
│  │  EFFICIENCY  │  │  VELOCITY    │          │
│  │  3.2 per 10K │  │  +2.3/day    │          │
│  │  ▲ vs 2.8    │  │  ETA: 23 days│          │
│  └──────────────┘  └──────────────┘          │
│                                              │
│  INFRASTRUCTURE: 42 (12 skills, 7 integr.,   │
│    23 roads)                                 │
│                                              │
│  ── GENERAL'S ASSESSMENT ──                  │
│  "Empire expanding. Lead-gen front needs     │
│   reinforcement — food supply declining.     │
│   Recommend deploying Scout to assess."      │
│                                              │
│  (Auto-generated summary from derived        │
│   metrics. Updated hourly.)                  │
└──────────────────────────────────────────────┘
```

The "General's Assessment" is a 2-3 sentence plain-English summary generated by analyzing all derived metrics for anomalies, trends, and recommendations. This runs as a lightweight prompt to the Commander unit hourly, or on-demand when the panel opens.

---

## 4. Token Tracking Deep Dive

### 4.1 Data Collection

Token data comes from three sources, in order of reliability:

**Source 1: Vibecraft Hook Events (Primary)**

The existing hook at `hooks/vibecraft-hook.sh` fires on every Claude tool call. Each event includes the tool name and parameters. We estimate tokens from this:

```typescript
/**
 * Token estimation from hook events.
 *
 * Claude Code doesn't expose exact token counts via hooks,
 * but we can estimate from tool call patterns:
 */
const TOKEN_ESTIMATES: Record<string, { input: number; output: number }> = {
  Read:       { input: 200, output: 2000 },   // Reading a file
  Edit:       { input: 500, output: 300 },     // Editing a file
  Write:      { input: 300, output: 100 },     // Writing a file
  Bash:       { input: 300, output: 500 },     // Running a command
  Grep:       { input: 150, output: 800 },     // Searching
  Glob:       { input: 100, output: 400 },     // File matching
  WebSearch:  { input: 200, output: 3000 },    // Web search
  WebFetch:   { input: 200, output: 5000 },    // Fetching a page
  // MCP tools — higher variance
  mcp_supabase: { input: 300, output: 1000 },
  mcp_slack:    { input: 200, output: 500 },
  mcp_notion:   { input: 200, output: 1500 },
  // Sub-agent spawn — big ticket
  SubAgent:     { input: 1000, output: 500 },
  // Default for unknown tools
  _default:     { input: 300, output: 500 },
}

/**
 * The thinking/reasoning between tool calls is the biggest consumer.
 * We estimate this as a multiplier on tool I/O:
 *   reasoning_tokens ≈ (input + output) × 1.5
 *
 * Total per tool call ≈ input + output + reasoning
 *                     ≈ (input + output) × 2.5
 */
function estimateTokensForEvent(event: HookEvent): number {
  const est = TOKEN_ESTIMATES[event.tool] ?? TOKEN_ESTIMATES._default
  const ioTokens = est.input + est.output
  return Math.round(ioTokens * 2.5)
}
```

**Source 2: Session Cost File (Secondary)**

Claude Code writes a `.cost` file or embeds cost data in its session metadata. If available at `~/.claude/projects/*/session-costs.json`, we parse it for actual billing data.

```typescript
interface SessionCostData {
  sessionId: string
  totalInputTokens: number
  totalOutputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedCostUSD: number
  lastUpdated: string
}
```

**Source 3: Conversation Turn Counter (Fallback)**

If hooks fail, count conversation turns from tmux scrollback. Each turn ≈ 3,000-8,000 tokens depending on unit type.

### 4.2 Token Ledger

All token events flow into a local ledger (file-based for speed, synced to Supabase periodically):

```typescript
interface TokenLedgerEntry {
  sessionId: string
  unitType: string
  territory: string
  timestamp: number       // Unix ms
  toolName: string
  estimatedTokens: number
  cumulativeTokens: number
  // Derived
  sessionMaxTokens: number  // 200K for Claude, estimated
  percentUsed: number
}
```

Local file: `~/.agent-empires/data/token-ledger.jsonl` (append-only, one JSON per line)

### 4.3 Per-Unit Fuel Gauge (Battlefield Display)

Each unit sprite on the map shows a fuel gauge — the equivalent of a health bar in an RTS.

```typescript
interface FuelGauge {
  /** 0.0 to 1.0 — percentage of estimated context window remaining */
  level: number
  /** Tokens consumed this session */
  tokensUsed: number
  /** Estimated max (200K for standard, varies by model) */
  tokensMax: number
  /** Current burn rate (tokens per minute, rolling 10-min average) */
  burnRate: number
  /** Estimated minutes until empty at current burn rate */
  minutesRemaining: number
  /** Visual state */
  state: 'full' | 'healthy' | 'warning' | 'critical' | 'empty'
}

function calculateFuelState(level: number): FuelGauge['state'] {
  if (level > 0.8) return 'full'
  if (level > 0.5) return 'healthy'
  if (level > 0.2) return 'warning'
  if (level > 0.0) return 'critical'
  return 'empty'
}
```

**Rendering (PixiJS):**

```typescript
class FuelGaugeRenderer {
  private bar: PIXI.Graphics
  private bg: PIXI.Graphics
  private label: PIXI.Text

  // Positioned below the unit sprite
  static readonly WIDTH = 32
  static readonly HEIGHT = 4
  static readonly OFFSET_Y = 18 // Below unit center

  static readonly COLORS = {
    full:     0x4A7C59, // forest green
    healthy:  0x4A7C59,
    warning:  0xC9A84C, // amber
    critical: 0x8B2500, // crimson
    empty:    0x3D3428, // dark parchment (bar invisible)
    bg:       0x1A1610, // ink dark
    border:   0x5C4A32, // brass dim
  }

  update(gauge: FuelGauge): void {
    const { WIDTH, HEIGHT, COLORS } = FuelGaugeRenderer

    // Background
    this.bg.clear()
    this.bg.beginFill(COLORS.bg)
    this.bg.drawRect(0, 0, WIDTH, HEIGHT)
    this.bg.endFill()
    this.bg.lineStyle(1, COLORS.border, 0.6)
    this.bg.drawRect(0, 0, WIDTH, HEIGHT)

    // Fill
    this.bar.clear()
    this.bar.beginFill(COLORS[gauge.state])
    this.bar.drawRect(0, 0, WIDTH * gauge.level, HEIGHT)
    this.bar.endFill()

    // Critical pulse animation
    if (gauge.state === 'critical') {
      // Handled by animation loop — oscillate alpha 0.5 to 1.0
    }
  }
}
```

### 4.4 Low-Fuel Warnings & Auto-Rotation

When a unit hits 20% fuel:

1. Fuel gauge pulses red on the battlefield
2. Notification appears: "Writer-01 at 20% supply. Recommend: complete current task and rotate."
3. In the Supply Depot panel, a "Rotate" button appears next to the unit
4. Clicking "Rotate" sends the unit a graceful shutdown prompt: "Wrap up your current task, write a status summary to disk, and signal completion."
5. After the unit completes, it's killed and a fresh session can be spawned with the same template

Auto-rotation (optional, configured in `ae_config`):
```typescript
interface AutoRotationConfig {
  enabled: boolean
  /** Trigger rotation at this fuel level */
  threshold: number  // default: 0.15 (15%)
  /** Send this prompt to the unit before killing */
  gracefulShutdownPrompt: string
  /** Wait this many ms for graceful shutdown before force-kill */
  gracePeriodMs: number  // default: 60000 (1 min)
}
```

### 4.5 Token Cost Estimation

```typescript
/**
 * Claude Pro subscription = $20/mo for ~unlimited usage
 * Claude Max = $100/mo or $200/mo
 *
 * For cost display purposes, we use API-equivalent pricing
 * even though the user is on a subscription. This shows the
 * "value extracted" from the subscription.
 *
 * Rates (API equivalent, per 1M tokens):
 */
const TOKEN_COST_PER_MILLION = {
  input: 15.00,       // Claude Opus 4 input
  output: 75.00,      // Claude Opus 4 output
  cacheRead: 1.50,    // Cached input
  cacheWrite: 18.75,  // Cache write
}

function estimateCostUSD(tokens: { input: number; output: number }): number {
  return (tokens.input / 1_000_000 * TOKEN_COST_PER_MILLION.input) +
         (tokens.output / 1_000_000 * TOKEN_COST_PER_MILLION.output)
}
```

Display as "API-equivalent value" in the Supply Depot: `~$2.40 value extracted today`

This reframes the subscription as ROI: "Your $20/mo subscription delivered $847 in API-equivalent compute this month."

---

## 5. Income/Expense Live Feed

### 5.1 Transaction Feed (Battlefield Overlay)

A scrolling feed docked to the bottom-left of the battlefield (above the minimap). Shows the last 5 transactions, auto-fades after 10 seconds.

```
┌─────────────────────────────────────┐
│  🪙 +$497  CCB Subscription         │  ← 2 min ago
│  🪙 +$29   Skool membership         │  ← 14 min ago
│  🔴 -$20   Claude Pro renewal       │  ← 1h ago
│  🪙 +$150  Consulting (Kelly)       │  ← 3h ago
│  🪙 +$29   Skool membership         │  ← 5h ago
└─────────────────────────────────────┘
```

Each entry is a DOM element with CSS animation:

```css
.transaction-entry {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--parchment-light);
  padding: 4px 12px;
  background: rgba(42, 36, 28, 0.85);
  border-left: 3px solid var(--brass);
  margin-bottom: 2px;
  animation: txn-slide-in 0.4s ease-out;
  opacity: 1;
  transition: opacity 2s ease-out;
}

.transaction-entry--income {
  border-left-color: var(--forest-bright);
}

.transaction-entry--expense {
  border-left-color: var(--crimson);
}

.transaction-entry--refund {
  border-left-color: var(--crimson-bright);
  background: rgba(139, 37, 0, 0.15);
}

@keyframes txn-slide-in {
  from {
    transform: translateX(-20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

### 5.2 Battlefield Animations Per Transaction Type

```typescript
interface TransactionAnimation {
  type: 'income' | 'expense' | 'refund'
  amount: number
  source: string
  territory: string  // Which domain generated this
}

const TRANSACTION_EFFECTS: Record<string, TransactionEffect> = {
  income: {
    // Gold coins burst upward from the territory that generated the revenue
    particles: {
      type: 'coin-burst',
      count: Math.min(Math.floor(amount / 10), 30), // More coins for bigger payments
      color: 0xC9A84C,
      velocity: { x: [-50, 50], y: [-120, -60] },
      gravity: 150,
      lifetime: 1200,
      sprite: 'coin-small', // 8x8 gold coin sprite
    },
    // Territory gets a brief golden shimmer
    territoryEffect: {
      type: 'shimmer',
      color: 0xC9A84C,
      alpha: 0.15,
      duration: 2000,
    },
    sound: 'coin-cascade', // Layered: more coins = more clinks
  },

  expense: {
    // Supply drains visually — small red particles drift downward
    particles: {
      type: 'drain',
      count: 5,
      color: 0x8B2500,
      velocity: { x: [-10, 10], y: [20, 40] },
      gravity: 0,
      lifetime: 800,
      sprite: 'spark-small',
    },
    sound: 'quill-scratch', // Expense recorded in the ledger
  },

  refund: {
    // Red flash on territory + enemy unit spawns briefly
    particles: {
      type: 'explosion',
      count: 15,
      color: 0xC41E3A,
      velocity: { x: [-80, 80], y: [-80, 80] },
      gravity: 50,
      lifetime: 600,
      sprite: 'spark-medium',
    },
    territoryEffect: {
      type: 'flash',
      color: 0xC41E3A,
      alpha: 0.3,
      duration: 400,
    },
    // Brief enemy sprite (skull icon) appears and fades
    spawnEnemy: {
      type: 'refund-specter',
      lifetime: 3000,
      fadeIn: 200,
      fadeOut: 800,
    },
    sound: 'war-drum-hit',
  },
}
```

### 5.3 Net Income Ticker

Always visible in the resource bar's gold segment. Shows real-time daily P&L:

```typescript
interface NetIncomeTicker {
  /** Gross revenue today */
  revenueToday: number
  /** Expenses today (subscriptions prorated + API costs) */
  expensesToday: number
  /** Net = revenue - expenses */
  netToday: number
  /** Running MTD totals */
  revenueMTD: number
  expensesMTD: number
  netMTD: number
}

// Display in gold segment:
// Primary: "$12,450 MTD"
// Secondary (smaller, below): "+$350 today" or "-$20 today"
// Color: green if net positive, red if net negative
```

### 5.4 Transaction-to-Territory Mapping

Every transaction is attributed to a territory based on its source:

```typescript
const TRANSACTION_TERRITORY_MAP: Record<string, string> = {
  // Stripe product IDs → territories
  'prod_ccb_subscription': 'fulfillment',
  'prod_skool_membership': 'fulfillment',
  'prod_consulting_hourly': 'sales',
  'prod_plugin_sale': 'fulfillment',
  'prod_course_sale': 'fulfillment',

  // Expense categories → territories
  'expense_claude': 'hq',
  'expense_supabase': 'hq',
  'expense_vercel': 'hq',
  'expense_kit': 'lead-gen',
  'expense_skool': 'fulfillment',
  'expense_api': 'hq',
  'expense_ads': 'lead-gen',
}
```

---

## 6. The Score

### 6.1 Philosophy

The score is the single number that tells you whether you're winning. It's not revenue alone — a general who's rich but losing territory isn't winning. It's not production alone — output without income is a losing campaign.

The score is a **weighted composite** that reflects the health of the entire empire. It goes up AND down. The general earns victory, not participation.

### 6.2 Score Formula

```typescript
interface ScoreInputs {
  // Revenue metrics (weight: 35%)
  mrrGrowth: number          // MoM % change, normalized 0-100
  revenueVsTarget: number    // % of campaign revenue target hit, 0-100

  // Production metrics (weight: 25%)
  contentOutput: number      // Crystal produced vs weekly target, 0-100
  technicalOutput: number    // Iron produced vs monthly target, 0-100
  efficiency: number         // Assets per 10K tokens vs baseline, 0-100

  // Pipeline metrics (weight: 20%)
  leadGrowth: number         // WoW subscriber growth %, normalized 0-100
  pipelineHealth: number     // Active leads / target, 0-100

  // Operational metrics (weight: 20%)
  territoryControl: number   // % territories with fog < 0.3, 0-100
  threatResponse: number     // % threats resolved within SLA, 0-100
  armyUtilization: number    // % units actively working vs idle, 0-100
}

const SCORE_WEIGHTS = {
  revenue: 0.35,
  production: 0.25,
  pipeline: 0.20,
  operations: 0.20,
} as const

function calculateScore(inputs: ScoreInputs): number {
  const revenue = (inputs.mrrGrowth * 0.6 + inputs.revenueVsTarget * 0.4)
  const production = (inputs.contentOutput * 0.4 + inputs.technicalOutput * 0.3 + inputs.efficiency * 0.3)
  const pipeline = (inputs.leadGrowth * 0.5 + inputs.pipelineHealth * 0.5)
  const operations = (inputs.territoryControl * 0.3 + inputs.threatResponse * 0.4 + inputs.armyUtilization * 0.3)

  const raw = (
    revenue * SCORE_WEIGHTS.revenue +
    production * SCORE_WEIGHTS.production +
    pipeline * SCORE_WEIGHTS.pipeline +
    operations * SCORE_WEIGHTS.operations
  )

  // Scale to 0-1000 range
  // Score CAN decrease if metrics decline
  return Math.round(raw * 10)
}
```

### 6.3 Score Decay

The score is not a high-water mark. It reflects current state:

- **Recalculated every hour** from live data
- Revenue metrics use rolling 30-day windows (so a great month fades over time)
- Production metrics use rolling 7-day windows (recent output matters more)
- Operational metrics are instantaneous (current fog, current threats)

This means: stop working and the score drops. Stop shipping content and production score falls. Ignore threats and operations score tanks. The empire demands attention.

### 6.4 Milestones & Celebrations

| Score | Milestone | Celebration |
|---|---|---|
| 100 | "First Command" | Brass horn fanfare. Wax seal stamp appears on HUD: "Commissioned." |
| 250 | "Field Officer" | Trumpet stinger. Map border briefly illuminates gold. |
| 500 | "Colonel" | Full trumpet fanfare (3 seconds). Gold particle burst from HQ. Title updates in corner. |
| 750 | "Brigadier General" | Orchestral swell. All territories shimmer gold briefly. |
| 1000 | "Major General" | Full victory fanfare. Fireworks particles across entire map. Wax seal: "Thousand Club." |
| 2500 | "Lieutenant General" | Extended celebration. Campaign victory screen overlay (5 seconds). |
| 5000 | "General of the Army" | Everything above + permanent gold border on HUD. |
| 10000 | "Emperor" | Napoleon's coronation moment. Full-screen parchment overlay with wax seal, stats summary, and orchestral crescendo. This is the endgame. |

Implementation:
```typescript
interface Milestone {
  threshold: number
  title: string
  celebration: {
    sound: string
    particles: ParticleConfig
    overlay?: OverlayConfig
    waxSeal?: { text: string; position: 'hud' | 'center' }
    duration: number
  }
}
```

### 6.5 Leaderboard (Self-Competition)

No multiplayer, but the general competes against himself:

```typescript
interface ScoreHistory {
  /** Score snapshots taken hourly */
  snapshots: Array<{ timestamp: number; score: number }>

  /** Derived comparisons */
  comparisons: {
    today: number
    yesterday: number
    thisWeek: number
    lastWeek: number
    thisMonth: number
    lastMonth: number
    allTimeHigh: number
    allTimeHighDate: string
  }

  /** Streaks */
  streaks: {
    currentWinStreak: number    // Consecutive days score increased
    longestWinStreak: number
    currentLossStreak: number   // Consecutive days score decreased
  }
}
```

Displayed in the Score panel:

```
┌─────────────────────────────────────┐
│  ★ CAMPAIGN SCORE: 847              │
│  Rank: Colonel                      │
│  ─────────────────────────────────  │
│  Today:      847  (▲ +12)           │
│  Yesterday:  835                    │
│  This week:  avg 821               │
│  Last week:  avg 798  (▲ +2.9%)    │
│  ─────────────────────────────────  │
│  All-time high: 903 (Mar 4, 2026)  │
│  Win streak: 4 days                │
│  ─────────────────────────────────  │
│  Next milestone: 1000 (Major Gen)  │
│  Progress: ████████░░ 84.7%        │
│  At current velocity: ~23 days     │
└─────────────────────────────────────┘
```

### 6.6 Campaign Score vs All-Time

- **Campaign score**: Resets when a new campaign starts. Measures performance within the current campaign's objectives.
- **All-time score**: Never resets. Cumulative total — the sum of all campaign final scores + current campaign score.
- **Resource bar shows campaign score** (the actionable number).
- **Profile/settings shows all-time score** (the legacy number).

---

## 7. Napoleon Aesthetic Guidelines

### 7.1 Color Palette

```css
/* ═══ THE NAPOLEON PALETTE ═══
 *
 * Primary inspiration: Campaign war rooms, aged maps,
 * brass instruments, candlelit strategy sessions,
 * hand-drawn cartography, wax-sealed dispatches.
 */

:root {
  /* ── Parchment (backgrounds) ── */
  --parchment-cream:   #F4E8C1;  /* Lightest — panel backgrounds */
  --parchment-aged:    #E8D5A3;  /* Slightly yellowed — card backgrounds */
  --parchment-mid:     #3D3428;  /* Dark parchment — overlay backgrounds */
  --parchment-dark:    #2A241C;  /* Darkest — primary background */
  --parchment-charred: #1A1610;  /* Near-black — deepest shadows */

  /* ── Brass & Gold (accents, financial data) ── */
  --brass-bright:  #E8C84C;  /* Bright gold — highlights, celebrations */
  --brass:         #C9A84C;  /* Standard gold — primary accent */
  --brass-dim:     #8B7355;  /* Muted gold — borders, secondary text */
  --brass-shadow:  #5C4A32;  /* Dark brass — separators, deep borders */

  /* ── Ink (text) ── */
  --ink-black:     #1A1610;  /* Darkest text — headers on light bg */
  --ink-dark:      #2E2820;  /* Body text on light backgrounds */
  --ink-sepia:     #5C4A32;  /* Secondary text, captions */

  /* ── Campaign Colors (status, alerts) ── */
  --victory-green:   #4A7C59;  /* Success, healthy, positive */
  --victory-bright:  #5DAE6E;  /* Bright success flash */
  --caution-amber:   #C9A84C;  /* Warning, attention needed */
  --danger-crimson:  #8B2500;  /* Critical, danger, loss */
  --danger-bright:   #C41E3A;  /* Bright danger flash */

  /* ── Resource Colors ── */
  --gold-resource:   #C9A84C;  /* Revenue */
  --supply-green:    #4A7C59;  /* Tokens (healthy) */
  --crystal-purple:  #6B5B95;  /* Content assets */
  --iron-steel:      #5B7C99;  /* Technical assets */
  --food-wheat:      #8B7355;  /* Pipeline/leads */
  --mana-blue:       #4169E1;  /* API credits */

  /* ── Wax Seal ── */
  --wax-red:         #8B0000;  /* Seal base */
  --wax-highlight:   #A52A2A;  /* Seal highlight */

  /* ── Map Terrain ── */
  --terrain-grass:   #6B7F5C;  /* Plains (Content territory) */
  --terrain-canyon:  #8B7355;  /* Canyon (Sales territory) */
  --terrain-stone:   #7C7C7C;  /* Fortress (Fulfillment) */
  --terrain-marsh:   #5B6B5C;  /* Swamp (Support) */
  --terrain-wall:    #9B8B7B;  /* Ramparts (Retention) */
  --terrain-field:   #8B9B6B;  /* Open fields (Lead-Gen) */
}
```

### 7.2 Typography

```css
/* ── Font Stack ──
 *
 * Load order:
 * 1. Playfair Display (Google Fonts) — headers, titles, rank names
 * 2. Source Serif 4 (Google Fonts) — body text, descriptions
 * 3. JetBrains Mono (Google Fonts) — numbers, data, code
 *
 * Fallbacks: Georgia → serif for display/body, Courier New → monospace for data
 */

@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@300;400;500;700&display=swap');

:root {
  --font-display: 'Playfair Display', 'Georgia', serif;
  --font-body: 'Source Serif 4', 'Georgia', serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}

/* Usage guide:
 *
 * Playfair Display 900:  Major headers ("THE TREASURY", "STATE OF THE EMPIRE")
 * Playfair Display 700:  Section headers, rank titles, milestone names
 * Playfair Display 400i: Quotes, the General's Assessment
 *
 * Source Serif 4, 400:   Body text, descriptions, transaction entries
 * Source Serif 4, 600:   Emphasized body text, labels
 * Source Serif 4, 300:   Subtle captions, timestamps
 *
 * JetBrains Mono 700:    Primary numbers ($12,450)
 * JetBrains Mono 500:    Secondary numbers, percentages
 * JetBrains Mono 300:    Timestamps, IDs, technical data
 */

/* Number rendering — always use tabular figures for alignment */
.resource-value,
.transaction-amount,
.score-display,
.metric-number {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

### 7.3 Textures & Visual Treatments

```typescript
/**
 * Texture loading for the Napoleon aesthetic.
 * All textures are tiling PNGs in /public/textures/
 */
const TEXTURES = {
  /** Subtle grain overlay for parchment surfaces */
  parchmentGrain: '/textures/parchment-grain.png',    // 256x256 tile, very subtle
  /** Heavier aged paper for panels and cards */
  parchmentAged: '/textures/parchment-aged.png',      // 512x512, visible aging
  /** Canvas texture for the battlefield background */
  mapCanvas: '/textures/map-canvas.png',               // 512x512, cloth weave
  /** Ink splatter for dividers and accents */
  inkSplatter: '/textures/ink-splatter.png',           // Various splatter sprites
  /** Wax seal stamp template */
  waxSeal: '/textures/wax-seal-base.png',             // 128x128, red wax circle

  /**
   * Generation approach:
   * - Create these as simple procedural textures with Canvas2D
   * - Parchment grain: Perlin noise at low contrast
   * - Aged paper: Perlin noise + brown color mapping + edge darkening
   * - Map canvas: Crosshatch pattern
   * - Ink splatter: Random bezier curves
   * - Wax seal: Radial gradient with bump texture
   *
   * No external assets needed. All procedurally generated at build time
   * via scripts/generate-textures.ts
   */
}
```

### 7.4 PixiJS Rendering Approach

```typescript
/**
 * Economy-specific rendering sits in the PixiJS layer for:
 * 1. Particle effects (coin bursts, drains, celebrations)
 * 2. Fuel gauges on units
 * 3. Territory shimmer/flash effects
 * 4. Transaction origin markers
 *
 * The HUD (resource bar, economy panel, transaction feed) is DOM-based
 * for text clarity and ease of styling.
 */

class EconomyRenderer {
  private particlePool: ParticlePool
  private territoryEffects: Map<string, PIXI.Graphics>

  constructor(private stage: PIXI.Container) {
    // Economy particles layer — above units, below HUD
    this.particlePool = new ParticlePool(stage, {
      maxParticles: 500,
      spritesheet: '/sprites/economy-particles.json',
    })
  }

  /**
   * Coin burst effect — triggered on revenue events.
   * Coins spawn at the territory's center and arc upward
   * with gravity, then fade.
   */
  emitCoinBurst(territory: string, amount: number): void {
    const center = getTerritoryCenter(territory)
    const count = Math.min(Math.ceil(amount / 20), 30)

    for (let i = 0; i < count; i++) {
      this.particlePool.emit({
        texture: 'coin-small',
        x: center.x + (Math.random() - 0.5) * 40,
        y: center.y,
        vx: (Math.random() - 0.5) * 100,
        vy: -(60 + Math.random() * 80),
        gravity: 150,
        lifetime: 800 + Math.random() * 400,
        fadeOut: true,
        scale: 0.5 + Math.random() * 0.5,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 4,
      })
    }
  }

  /**
   * Territory shimmer — brief golden overlay that fades.
   * Used for revenue events, milestone celebrations.
   */
  shimmerTerritory(territory: string, color: number, alpha: number, durationMs: number): void {
    const bounds = getTerritoryBounds(territory)
    const overlay = new PIXI.Graphics()
    overlay.beginFill(color, alpha)
    overlay.drawRect(bounds.x, bounds.y, bounds.width, bounds.height)
    overlay.endFill()
    overlay.alpha = 0

    this.stage.addChild(overlay)

    // Fade in, hold, fade out
    const fadeIn = durationMs * 0.15
    const hold = durationMs * 0.5
    const fadeOut = durationMs * 0.35

    gsap.timeline()
      .to(overlay, { alpha: 1, duration: fadeIn / 1000 })
      .to(overlay, { alpha: 0, duration: fadeOut / 1000, delay: hold / 1000 })
      .then(() => {
        this.stage.removeChild(overlay)
        overlay.destroy()
      })
  }

  /**
   * Score milestone celebration — fireworks across the map.
   */
  celebrateMilestone(milestone: Milestone): void {
    const { celebration } = milestone

    // Multiple burst points across the map
    const points = [
      { x: 1000, y: 800 },
      { x: 3000, y: 600 },
      { x: 2000, y: 1200 },
      { x: 4000, y: 1000 },
      { x: 1500, y: 2000 },
    ]

    points.forEach((point, i) => {
      setTimeout(() => {
        this.particlePool.emit({
          texture: 'spark-large',
          x: point.x,
          y: point.y,
          vx: 0,
          vy: -200,
          gravity: 80,
          lifetime: 1500,
          fadeOut: true,
          scale: 1.5,
          // On death, spawn child particles (firework burst)
          onDeath: (p) => {
            for (let j = 0; j < 20; j++) {
              const angle = (j / 20) * Math.PI * 2
              this.particlePool.emit({
                texture: 'spark-small',
                x: p.x,
                y: p.y,
                vx: Math.cos(angle) * 120,
                vy: Math.sin(angle) * 120,
                gravity: 60,
                lifetime: 600 + Math.random() * 300,
                fadeOut: true,
                scale: 0.4 + Math.random() * 0.4,
                tint: [0xC9A84C, 0xE8C84C, 0xF4E8C1][Math.floor(Math.random() * 3)],
              })
            }
          },
        })
      }, i * 300) // Stagger bursts
    })
  }
}
```

### 7.5 Sound Design for Economy Events

Building on the sound system from `01-vision.md` Section 8:

```typescript
/**
 * Economy sounds — all synthesized via Tone.js (no audio files).
 * Keeps the Vibecraft approach: everything is generated, nothing is loaded.
 */
const ECONOMY_SOUNDS = {
  /** Single coin clink — small payment */
  'coin-single': {
    type: 'metallic',
    frequency: 2400,
    decay: 0.15,
    volume: -18,
  },

  /** Coin cascade — larger payment, multiple clinks staggered */
  'coin-cascade': {
    type: 'sequence',
    notes: [2400, 2600, 2200, 2800, 2500],
    stagger: 60,  // ms between each
    decay: 0.12,
    volume: -15,
  },

  /** Quill scratch — expense recorded */
  'quill-scratch': {
    type: 'noise',
    filter: 'highpass',
    frequency: 3000,
    duration: 0.3,
    volume: -24,
  },

  /** War drum hit — refund or threat */
  'war-drum-hit': {
    type: 'membrane',
    frequency: 60,
    decay: 0.8,
    volume: -10,
  },

  /** Pocket watch chime — time warning */
  'watch-chime': {
    type: 'bell',
    frequency: 1200,
    decay: 1.5,
    volume: -20,
  },

  /** Trumpet stinger — milestone */
  'trumpet-stinger': {
    type: 'brass',
    notes: [523, 659, 784], // C5, E5, G5 (major chord)
    stagger: 120,
    sustain: 0.4,
    volume: -12,
  },

  /** Full fanfare — major milestone */
  'victory-fanfare': {
    type: 'sequence',
    notes: [523, 659, 784, 1047], // C5, E5, G5, C6
    stagger: 200,
    sustain: 0.6,
    volume: -8,
    // Add reverb tail
    reverb: { decay: 2.0, wet: 0.3 },
  },

  /** Low supply warning */
  'supply-warning': {
    type: 'membrane',
    frequency: 80,
    decay: 0.4,
    volume: -16,
    repeat: 2,
    repeatInterval: 400,
  },
}
```

### 7.6 Wax Seal Stamps

Wax seals appear for milestones, achievements, and campaign completions. Rendered as PixiJS sprites with a subtle 3D effect:

```typescript
class WaxSealRenderer {
  /**
   * Creates a wax seal stamp at the specified position.
   * The seal "presses" in with a scale animation + sound.
   */
  static create(options: {
    text: string
    position: PIXI.Point
    color?: number  // default: 0x8B0000
    size?: number   // default: 64
  }): PIXI.Container {
    const seal = new PIXI.Container()

    // Base circle — wax red with radial gradient
    const base = new PIXI.Graphics()
    base.beginFill(options.color ?? 0x8B0000)
    base.drawCircle(0, 0, options.size ?? 64)
    base.endFill()

    // Inner ring — slightly lighter
    const ring = new PIXI.Graphics()
    ring.lineStyle(2, 0xA52A2A, 0.6)
    ring.drawCircle(0, 0, (options.size ?? 64) * 0.75)

    // Text — centered, uppercase, serif
    const text = new PIXI.Text(options.text.toUpperCase(), {
      fontFamily: 'Playfair Display',
      fontSize: Math.round((options.size ?? 64) * 0.3),
      fill: 0xE8D5A3,
      align: 'center',
      fontWeight: '700',
    })
    text.anchor.set(0.5)

    seal.addChild(base, ring, text)

    // Stamp animation: scale from 1.3 → 1.0 with bounce
    seal.scale.set(1.3)
    seal.alpha = 0
    gsap.to(seal.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2)' })
    gsap.to(seal, { alpha: 1, duration: 0.15 })

    return seal
  }
}
```

---

## 8. Supabase Schema

### 8.1 New Tables for Economy System

```sql
-- ═══════════════════════════════════════════════════
-- AGENT EMPIRES — ECONOMY TABLES
-- Depends on: ae_campaigns, ae_intel (from 01-vision.md)
-- ═══════════════════════════════════════════════════

-- ── Transaction ledger (revenue + expenses) ──
CREATE TABLE ae_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'refund')),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  source TEXT NOT NULL,          -- 'stripe', 'manual', 'api_cost', 'subscription'
  source_id TEXT,                -- Stripe payment ID, invoice ID, etc.
  product TEXT,                  -- 'ccb_subscription', 'skool_membership', etc.
  territory TEXT NOT NULL,       -- Which domain this maps to
  description TEXT,
  metadata JSONB,               -- Stripe event data, receipt URL, etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for MTD queries
CREATE INDEX idx_ae_transactions_created ON ae_transactions(created_at DESC);
CREATE INDEX idx_ae_transactions_type ON ae_transactions(type);
CREATE INDEX idx_ae_transactions_territory ON ae_transactions(territory);

-- Enable realtime for live feed
ALTER PUBLICATION supabase_realtime ADD TABLE ae_transactions;

-- ── Token usage ledger ──
CREATE TABLE ae_token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  territory TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  cumulative_tokens INTEGER NOT NULL,
  session_max_tokens INTEGER DEFAULT 200000,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partitioned by day for performance (high volume table)
CREATE INDEX idx_ae_token_ledger_session ON ae_token_ledger(session_id, created_at DESC);
CREATE INDEX idx_ae_token_ledger_day ON ae_token_ledger(created_at DESC);

-- ── Resource snapshots (periodic readings of all resource values) ──
CREATE TABLE ae_resource_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,  -- 'gold', 'supply', 'population', 'crystal', 'iron', 'food', 'mana'
  value NUMERIC NOT NULL,
  metadata JSONB,              -- Breakdown data (e.g., per-source for gold)
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_resource_snapshots_type ON ae_resource_snapshots(resource_type, snapshot_at DESC);

-- ── Score history ──
CREATE TABLE ae_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES ae_campaigns(id),
  score INTEGER NOT NULL,
  inputs JSONB NOT NULL,        -- All ScoreInputs values at time of calculation
  snapshot_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_score_campaign ON ae_score_history(campaign_id, snapshot_at DESC);

-- ── Production log (crystal + iron tracking) ──
CREATE TABLE ae_production_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('content', 'technical')),
  subtype TEXT,                 -- 'linkedin_post', 'email', 'skill', 'plugin', etc.
  session_id TEXT,              -- Which unit produced this
  territory TEXT NOT NULL,
  description TEXT,
  file_path TEXT,               -- Where the output was written
  tokens_spent INTEGER,         -- Estimated tokens to produce this asset
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_production_type ON ae_production_log(type, created_at DESC);

-- ── API usage tracking (mana) ──
CREATE TABLE ae_api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,        -- 'openai', 'ayrshare', 'gptzero', 'supabase_edge'
  endpoint TEXT,
  cost_usd NUMERIC(8,4),
  tokens_used INTEGER,
  rate_limit_remaining INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_api_usage_service ON ae_api_usage(service, created_at DESC);

-- ── Economy configuration ──
CREATE TABLE ae_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert defaults
INSERT INTO ae_config (key, value) VALUES
  ('max_concurrent_sessions', '5'),
  ('token_cost_per_million_input', '15.00'),
  ('token_cost_per_million_output', '75.00'),
  ('content_weekly_target', '20'),
  ('technical_monthly_target', '8'),
  ('auto_rotation_enabled', 'true'),
  ('auto_rotation_threshold', '0.15'),
  ('score_recalculation_interval_minutes', '60'),
  ('work_block_default_hours', '4');

-- ── Stripe webhook handler (edge function receives, inserts here) ──
-- The edge function at /functions/v1/stripe-webhook parses Stripe events
-- and inserts into ae_transactions. Mapping:
--   checkout.session.completed → type: 'income'
--   invoice.paid → type: 'income'
--   charge.refunded → type: 'refund'
--   invoice.payment_failed → ae_intel with severity 'critical'

-- ── Hourly resource snapshot cron ──
-- pg_cron job that snapshots all resource values:
SELECT cron.schedule(
  'ae-resource-snapshot',
  '0 * * * *',  -- Every hour
  $$
  INSERT INTO ae_resource_snapshots (resource_type, value, metadata)
  SELECT 'gold', COALESCE(SUM(CASE WHEN type = 'income' THEN amount WHEN type = 'refund' THEN -amount ELSE 0 END), 0),
    jsonb_build_object('mtd', true)
  FROM ae_transactions
  WHERE created_at >= date_trunc('month', now());

  INSERT INTO ae_resource_snapshots (resource_type, value, metadata)
  SELECT 'food', COUNT(*), jsonb_build_object('source', 'kit_poll')
  FROM ae_resource_snapshots
  WHERE resource_type = 'food'
  ORDER BY snapshot_at DESC LIMIT 1;
  $$
);

-- ── Hourly score recalculation cron ──
SELECT cron.schedule(
  'ae-score-recalculate',
  '5 * * * *',  -- 5 minutes past every hour
  $$
  -- Score calculation runs server-side via the WebSocket server,
  -- which queries all inputs and inserts into ae_score_history.
  -- This cron just triggers the server endpoint:
  SELECT net.http_post(
    'http://localhost:4545/api/recalculate-score',
    '{}',
    'application/json'
  );
  $$
);
```

### 8.2 Realtime Subscriptions

```typescript
// In server/EconomyRouter.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)

// Live transaction feed → broadcast to all connected browsers
supabase
  .channel('economy-transactions')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'ae_transactions' },
    (payload) => {
      broadcastToClients({
        type: 'economy:transaction',
        payload: payload.new,
      })
    }
  )
  .subscribe()

// Score updates → resource bar refresh
supabase
  .channel('economy-score')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'ae_score_history' },
    (payload) => {
      broadcastToClients({
        type: 'economy:score-update',
        payload: {
          score: payload.new.score,
          inputs: payload.new.inputs,
        },
      })
    }
  )
  .subscribe()
```

---

## 9. TypeScript Interfaces

### 9.1 Core Economy Types

```typescript
// shared/economy-types.ts

/** ── Primary Resources ── */

export interface GoldResource {
  revenueToday: number
  revenueMTD: number
  expensesToday: number
  expensesMTD: number
  netToday: number
  netMTD: number
  lastTransaction?: Transaction
}

export interface SupplyResource {
  /** Aggregate across all active sessions */
  totalTokensUsed: number
  totalTokensMax: number
  percentUsed: number
  /** Per-unit breakdown */
  units: UnitSupply[]
  /** Rolling burn rate (tokens per hour) */
  burnRatePerHour: number
  /** Estimated API-equivalent cost today */
  estimatedCostToday: number
}

export interface UnitSupply {
  sessionId: string
  unitType: string
  territory: string
  tokensUsed: number
  tokensMax: number
  percentUsed: number
  burnRatePerHour: number
  minutesRemaining: number
  state: 'full' | 'healthy' | 'warning' | 'critical' | 'empty'
  currentTask?: string
}

export interface PopulationResource {
  current: number
  max: number
  units: Array<{
    sessionId: string
    unitType: string
    territory: string
    status: 'idle' | 'working' | 'waiting' | 'offline'
  }>
}

export interface TimeResource {
  /** Minutes remaining in current work block */
  minutesRemaining: number
  /** Next calendar event */
  nextEvent?: {
    title: string
    startsAt: string
    minutesUntil: number
  }
  /** Whether currently in a work block */
  inWorkBlock: boolean
  /** Total focused hours today */
  focusedHoursToday: number
}

/** ── Secondary Resources ── */

export interface CrystalResource {
  thisWeek: number
  thisMonth: number
  weeklyTarget: number
  breakdown: Record<string, number>  // subtype → count
}

export interface IronResource {
  thisMonth: number
  monthlyTarget: number
  breakdown: Record<string, number>
}

export interface FoodResource {
  totalSubscribers: number
  weekOverWeekDelta: number
  sources: Record<string, number>  // 'kit' → 1100, 'skool' → 312, etc.
}

export interface ManaResource {
  costToday: number
  costMTD: number
  breakdown: Record<string, { cost: number; calls: number }>
}

/** ── Composite State ── */

export interface EconomyState {
  gold: GoldResource
  supply: SupplyResource
  population: PopulationResource
  time: TimeResource
  crystal: CrystalResource
  iron: IronResource
  food: FoodResource
  mana: ManaResource
  score: ScoreState
  derivedMetrics: DerivedMetrics
}

export interface ScoreState {
  current: number
  campaignId: string
  rank: string
  nextMilestone: { threshold: number; title: string }
  progressToNext: number
  comparisons: {
    today: number
    yesterday: number
    thisWeek: number
    lastWeek: number
    allTimeHigh: number
    allTimeHighDate: string
  }
  streak: {
    currentWin: number
    longestWin: number
    currentLoss: number
  }
}

export interface DerivedMetrics {
  mrr: number
  mrrGrowth: number         // MoM percentage
  burnRate: number           // tokens per hour
  efficiency: number         // assets per 10K tokens
  territoryControl: number   // 0-1
  armyStrength: number
  infrastructureScore: number
  runway: number             // months
  campaignVelocity: number   // score points per day
}

/** ── Transaction ── */

export interface Transaction {
  id: string
  type: 'income' | 'expense' | 'refund'
  amount: number
  currency: string
  source: string
  sourceId?: string
  product?: string
  territory: string
  description?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

/** ── Events (WebSocket) ── */

export type EconomyEvent =
  | { type: 'economy:transaction'; payload: Transaction }
  | { type: 'economy:score-update'; payload: { score: number; inputs: ScoreInputs } }
  | { type: 'economy:supply-update'; payload: SupplyResource }
  | { type: 'economy:milestone'; payload: Milestone }
  | { type: 'economy:fuel-warning'; payload: { sessionId: string; level: number } }
  | { type: 'economy:time-warning'; payload: { minutesRemaining: number; nextEvent?: string } }

/** ── Score Calculation ── */

export interface ScoreInputs {
  mrrGrowth: number
  revenueVsTarget: number
  contentOutput: number
  technicalOutput: number
  efficiency: number
  leadGrowth: number
  pipelineHealth: number
  territoryControl: number
  threatResponse: number
  armyUtilization: number
}

/** ── Milestones ── */

export interface Milestone {
  threshold: number
  title: string
  rank: string
  celebration: {
    sound: string
    particleEffect: 'coin-burst' | 'fireworks' | 'shimmer-all'
    overlay?: 'wax-seal' | 'victory-screen' | 'coronation'
    waxSealText?: string
    durationMs: number
  }
}

export const MILESTONES: Milestone[] = [
  { threshold: 100, title: 'First Command', rank: 'Ensign',
    celebration: { sound: 'trumpet-stinger', particleEffect: 'coin-burst', overlay: 'wax-seal', waxSealText: 'COMMISSIONED', durationMs: 3000 } },
  { threshold: 250, title: 'Field Officer', rank: 'Captain',
    celebration: { sound: 'trumpet-stinger', particleEffect: 'shimmer-all', durationMs: 2000 } },
  { threshold: 500, title: 'Colonel', rank: 'Colonel',
    celebration: { sound: 'trumpet-stinger', particleEffect: 'fireworks', overlay: 'wax-seal', waxSealText: 'COLONEL', durationMs: 4000 } },
  { threshold: 750, title: 'Brigadier General', rank: 'Brigadier',
    celebration: { sound: 'victory-fanfare', particleEffect: 'fireworks', durationMs: 5000 } },
  { threshold: 1000, title: 'Major General', rank: 'Major General',
    celebration: { sound: 'victory-fanfare', particleEffect: 'fireworks', overlay: 'wax-seal', waxSealText: 'THOUSAND CLUB', durationMs: 6000 } },
  { threshold: 2500, title: 'Lieutenant General', rank: 'Lt. General',
    celebration: { sound: 'victory-fanfare', particleEffect: 'fireworks', overlay: 'victory-screen', durationMs: 8000 } },
  { threshold: 5000, title: 'General of the Army', rank: 'General',
    celebration: { sound: 'victory-fanfare', particleEffect: 'fireworks', overlay: 'victory-screen', durationMs: 10000 } },
  { threshold: 10000, title: 'Emperor', rank: 'Emperor',
    celebration: { sound: 'victory-fanfare', particleEffect: 'fireworks', overlay: 'coronation', waxSealText: 'EMPEROR', durationMs: 15000 } },
]
```

---

## 10. PixiJS Rendering

### 10.1 Economy Layer Architecture

```typescript
// src/economy/EconomyLayer.ts

import * as PIXI from 'pixi.js'
import { EconomyRenderer } from './EconomyRenderer'
import { FuelGaugeRenderer } from './FuelGaugeRenderer'
import { TransactionAnimator } from './TransactionAnimator'
import { MilestoneAnimator } from './MilestoneAnimator'

/**
 * The economy layer sits between the unit layer and the HUD layer
 * in the PixiJS display list:
 *
 *   [0] Terrain (bottom)
 *   [1] Roads
 *   [2] Territory effects (shimmer, flash)
 *   [3] Units + fuel gauges
 *   [4] Economy particles (coins, sparks) ← THIS LAYER
 *   [5] Projectiles
 *   [6] Fog of war
 *   [7] UI overlays (wax seals, milestone screens)
 */
export class EconomyLayer {
  public container: PIXI.Container
  private renderer: EconomyRenderer
  private fuelGauges: Map<string, FuelGaugeRenderer> = new Map()
  private transactionAnimator: TransactionAnimator
  private milestoneAnimator: MilestoneAnimator

  constructor(private app: PIXI.Application) {
    this.container = new PIXI.Container()
    this.container.sortableChildren = true

    this.renderer = new EconomyRenderer(this.container)
    this.transactionAnimator = new TransactionAnimator(this.container)
    this.milestoneAnimator = new MilestoneAnimator(this.container)
  }

  /** Called on every economy WebSocket event */
  handleEvent(event: EconomyEvent): void {
    switch (event.type) {
      case 'economy:transaction':
        this.transactionAnimator.animate(event.payload)
        break

      case 'economy:supply-update':
        this.updateFuelGauges(event.payload.units)
        break

      case 'economy:milestone':
        this.milestoneAnimator.celebrate(event.payload)
        break

      case 'economy:fuel-warning':
        this.highlightUnit(event.payload.sessionId, 'warning')
        break
    }
  }

  /** Update all fuel gauges from supply data */
  private updateFuelGauges(units: UnitSupply[]): void {
    for (const unit of units) {
      let gauge = this.fuelGauges.get(unit.sessionId)
      if (!gauge) {
        gauge = new FuelGaugeRenderer()
        this.fuelGauges.set(unit.sessionId, gauge)
        this.container.addChild(gauge.container)
      }
      gauge.update({
        level: 1 - unit.percentUsed,
        tokensUsed: unit.tokensUsed,
        tokensMax: unit.tokensMax,
        burnRate: unit.burnRatePerHour / 60,
        minutesRemaining: unit.minutesRemaining,
        state: unit.state,
      })
    }

    // Remove gauges for units that no longer exist
    for (const [id, gauge] of this.fuelGauges) {
      if (!units.find(u => u.sessionId === id)) {
        this.container.removeChild(gauge.container)
        gauge.destroy()
        this.fuelGauges.delete(id)
      }
    }
  }

  /** Tick — called every frame for animations */
  tick(delta: number): void {
    this.renderer.tick(delta)
    this.transactionAnimator.tick(delta)
    for (const gauge of this.fuelGauges.values()) {
      gauge.tick(delta)
    }
  }

  destroy(): void {
    this.container.destroy({ children: true })
    this.fuelGauges.clear()
  }
}
```

### 10.2 Particle Pool

```typescript
// src/economy/ParticlePool.ts

import * as PIXI from 'pixi.js'

interface Particle {
  sprite: PIXI.Sprite
  vx: number
  vy: number
  gravity: number
  lifetime: number
  maxLifetime: number
  fadeOut: boolean
  rotationSpeed: number
  active: boolean
  onDeath?: (p: { x: number; y: number }) => void
}

/**
 * Object-pooled particle system for economy effects.
 * Pre-allocates sprites to avoid GC during animations.
 */
export class ParticlePool {
  private particles: Particle[] = []
  private pool: Particle[] = []

  constructor(
    private container: PIXI.Container,
    private config: { maxParticles: number }
  ) {
    // Pre-allocate
    for (let i = 0; i < config.maxParticles; i++) {
      const sprite = new PIXI.Sprite()
      sprite.visible = false
      sprite.anchor.set(0.5)
      container.addChild(sprite)

      this.pool.push({
        sprite,
        vx: 0, vy: 0, gravity: 0,
        lifetime: 0, maxLifetime: 0,
        fadeOut: false, rotationSpeed: 0,
        active: false,
      })
    }
  }

  emit(config: {
    texture: string | PIXI.Texture
    x: number
    y: number
    vx: number
    vy: number
    gravity?: number
    lifetime: number
    fadeOut?: boolean
    scale?: number
    rotation?: number
    rotationSpeed?: number
    tint?: number
    onDeath?: (p: { x: number; y: number }) => void
  }): void {
    const particle = this.pool.find(p => !p.active)
    if (!particle) return // Pool exhausted, skip

    const texture = typeof config.texture === 'string'
      ? PIXI.Texture.from(config.texture)
      : config.texture

    particle.sprite.texture = texture
    particle.sprite.position.set(config.x, config.y)
    particle.sprite.scale.set(config.scale ?? 1)
    particle.sprite.rotation = config.rotation ?? 0
    particle.sprite.tint = config.tint ?? 0xFFFFFF
    particle.sprite.alpha = 1
    particle.sprite.visible = true

    particle.vx = config.vx
    particle.vy = config.vy
    particle.gravity = config.gravity ?? 0
    particle.lifetime = config.lifetime
    particle.maxLifetime = config.lifetime
    particle.fadeOut = config.fadeOut ?? false
    particle.rotationSpeed = config.rotationSpeed ?? 0
    particle.onDeath = config.onDeath
    particle.active = true

    this.particles.push(particle)
  }

  tick(deltaMs: number): void {
    const dt = deltaMs / 1000

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (!p.active) continue

      // Physics
      p.vy += p.gravity * dt
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      p.sprite.rotation += p.rotationSpeed * dt

      // Lifetime
      p.lifetime -= deltaMs
      if (p.fadeOut) {
        p.sprite.alpha = Math.max(0, p.lifetime / p.maxLifetime)
      }

      // Death
      if (p.lifetime <= 0) {
        const pos = { x: p.sprite.x, y: p.sprite.y }
        p.active = false
        p.sprite.visible = false
        p.onDeath?.(pos)
        this.particles.splice(i, 1)
      }
    }
  }
}
```

---

## 11. Implementation Plan

### Phase Assignment

This economy system spans multiple build phases from `01-vision.md` Section 10:

| Component | Phase | Priority |
|---|---|---|
| Resource bar HUD (Gold, Supply, Pop, Time) | **Phase 0** | P0 — visible immediately |
| Fuel gauges on unit sprites | **Phase 0** | P0 — core unit info |
| Token tracking from hook events | **Phase 0** | P0 — data foundation |
| Economy panel (Treasury tab) | **Phase 1** | P1 — first expansion |
| Supply Depot tab | **Phase 1** | P1 — token management |
| Transaction live feed (DOM) | **Phase 2** | P1 — requires Stripe integration |
| Coin burst particles | **Phase 4** | P2 — polish layer |
| Territory shimmer effects | **Phase 4** | P2 — polish |
| Score system | **Phase 3** | P1 — campaign integration |
| Milestone celebrations | **Phase 4** | P2 — polish |
| Wax seal stamps | **Phase 4** | P2 — polish |
| Supabase economy tables | **Phase 2** | P0 — data layer for everything |
| Stripe webhook edge function | **Phase 5** | P1 — real revenue data |
| Sound effects (economy) | **Phase 4** | P2 — audio polish |
| Napoleon aesthetic (CSS, fonts, textures) | **Phase 0** | P0 — sets the tone from day 1 |
| Score history / self-competition | **Phase 3** | P2 — nice-to-have |

### File Structure

```
src/
├── economy/
│   ├── EconomyLayer.ts          # PixiJS container for all economy rendering
│   ├── EconomyRenderer.ts       # Particle effects, territory effects
│   ├── FuelGaugeRenderer.ts     # Per-unit supply bars
│   ├── TransactionAnimator.ts   # Coin bursts, drain effects, refund explosions
│   ├── MilestoneAnimator.ts     # Celebration sequences
│   ├── ParticlePool.ts          # Object-pooled particle system
│   ├── WaxSealRenderer.ts       # Milestone stamp sprites
│   └── ScoreCalculator.ts       # Client-side score computation (mirrors server)
├── hud/
│   ├── ResourceBar.ts           # Top bar (DOM-based)
│   ├── EconomyPanel.ts          # Expanded economy view (DOM-based)
│   ├── TransactionFeed.ts       # Live transaction overlay (DOM-based)
│   ├── SparklineTooltip.ts      # Hover sparklines (SVG)
│   └── ScorePanel.ts            # Score breakdown view
server/
├── EconomyRouter.ts             # Supabase realtime subscriptions, score recalc
├── TokenTracker.ts              # Aggregates hook events into token ledger
├── StripeWebhookHandler.ts      # Edge function logic (deployed to Supabase)
└── ScoreEngine.ts               # Server-side score calculation + history
shared/
├── economy-types.ts             # All interfaces from Section 9
└── economy-constants.ts         # Thresholds, weights, colors, milestones
public/
├── textures/
│   ├── parchment-grain.png      # Procedurally generated
│   ├── parchment-aged.png
│   ├── map-canvas.png
│   └── wax-seal-base.png
├── sprites/
│   ├── economy-particles.json   # Spritesheet: coins, sparks, flask
│   └── economy-particles.png
└── fonts/                       # Self-hosted fallback (Google Fonts primary)
```

### Build Order (What to Code First)

1. **`shared/economy-types.ts`** — All interfaces. Everything depends on these.
2. **`shared/economy-constants.ts`** — Colors, thresholds, milestones, weights.
3. **Napoleon CSS** — Add to `index.html` / main stylesheet. Fonts, palette, textures.
4. **`server/TokenTracker.ts`** — Hook event → token estimate → ledger entry. Enables Supply.
5. **`src/economy/FuelGaugeRenderer.ts`** — Renders on existing unit sprites. Visual proof of life.
6. **`src/hud/ResourceBar.ts`** — The top bar. Hardcode Gold/Time initially, wire Supply/Pop from live data.
7. **Supabase tables** — Run the SQL from Section 8. Schema in place for everything downstream.
8. **`server/EconomyRouter.ts`** — Realtime subscriptions. Data flows to browser.
9. **`src/hud/EconomyPanel.ts`** — Treasury + Supply Depot tabs. First deep-dive view.
10. **`src/economy/ParticlePool.ts`** → **`TransactionAnimator.ts`** — Coin bursts when revenue arrives.
11. **`server/ScoreEngine.ts`** → **`src/economy/ScoreCalculator.ts`** — The score goes live.
12. **Everything else** — Milestones, wax seals, celebrations, sounds. Polish layer.

---

## Appendix A: Procedural Texture Generation

```typescript
// scripts/generate-textures.ts
// Run once at build time: npx ts-node scripts/generate-textures.ts

import { createCanvas } from 'canvas'
import { writeFileSync } from 'fs'

function generateParchmentGrain(size: number = 256): Buffer {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Base cream
  ctx.fillStyle = '#F4E8C1'
  ctx.fillRect(0, 0, size, size)

  // Noise overlay
  const imageData = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < imageData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 15
    imageData.data[i] += noise     // R
    imageData.data[i + 1] += noise // G
    imageData.data[i + 2] += noise // B
  }
  ctx.putImageData(imageData, 0, 0)

  return canvas.toBuffer('image/png')
}

function generateMapCanvas(size: number = 512): Buffer {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Base warm grey
  ctx.fillStyle = '#E8D5A3'
  ctx.fillRect(0, 0, size, size)

  // Crosshatch pattern (cloth weave)
  ctx.strokeStyle = 'rgba(139, 115, 85, 0.08)'
  ctx.lineWidth = 1
  for (let i = 0; i < size; i += 4) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
    ctx.stroke()
  }

  // Noise
  const imageData = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < imageData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 10
    imageData.data[i] += noise
    imageData.data[i + 1] += noise
    imageData.data[i + 2] += noise
  }
  ctx.putImageData(imageData, 0, 0)

  return canvas.toBuffer('image/png')
}

// Generate and write
writeFileSync('public/textures/parchment-grain.png', generateParchmentGrain())
writeFileSync('public/textures/map-canvas.png', generateMapCanvas())
console.log('Textures generated.')
```

## Appendix B: Stripe Webhook Edge Function

```typescript
// supabase/functions/stripe-webhook/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PRODUCT_TERRITORY_MAP: Record<string, string> = {
  'prod_ccb': 'fulfillment',
  'prod_skool': 'fulfillment',
  'prod_consulting': 'sales',
  'prod_plugin': 'fulfillment',
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'invoice.paid': {
      const obj = event.data.object as any
      const amount = (obj.amount_total ?? obj.amount_paid ?? 0) / 100
      const productId = obj.metadata?.product_id ?? 'unknown'

      await supabase.from('ae_transactions').insert({
        type: 'income',
        amount,
        source: 'stripe',
        source_id: obj.id,
        product: productId,
        territory: PRODUCT_TERRITORY_MAP[productId] ?? 'sales',
        description: `${event.type}: ${obj.customer_email ?? 'unknown'}`,
        metadata: { stripe_event_id: event.id, customer: obj.customer },
      })
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      const amount = (charge.amount_refunded ?? 0) / 100

      await supabase.from('ae_transactions').insert({
        type: 'refund',
        amount,
        source: 'stripe',
        source_id: charge.id,
        territory: 'sales',
        description: `Refund: ${charge.billing_details?.email ?? 'unknown'}`,
        metadata: { stripe_event_id: event.id },
      })

      // Also create an intel alert for refunds
      await supabase.from('ae_intel').insert({
        source: 'stripe',
        territory: 'sales',
        severity: 'high',
        title: `Refund: $${amount}`,
        body: { charge_id: charge.id, email: charge.billing_details?.email },
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as any
      await supabase.from('ae_intel').insert({
        source: 'stripe',
        territory: 'sales',
        severity: 'critical',
        title: `Payment failed: ${invoice.customer_email}`,
        body: { invoice_id: invoice.id, amount: (invoice.amount_due ?? 0) / 100 },
      })
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```
