# Agent Empires Phase 2 — Unit Divisions & Sub-Agent Visibility

## Goal

Transform the battlefield from "same-looking dots" into a readable military command interface where unit type, model tier, role, health, and lineage are instantly visible. Every sub-agent appears as its own unit. Parent-child relationships are drawn as connection lines. The RTS "at a glance" principle: a commander should know the state of their forces without clicking anything.

---

## Division System ✅

Inspired by military branches — visually distinct silhouettes per model tier:

| Division | Model | Shape | Body Radius | Accent Color | Ring Width | Visual Weight |
|----------|-------|-------|-------------|--------------|------------|---------------|
| **Command** | Opus | Hexagon | 44px | Amber `#FFB86C` | 4px | Heavy — strategic leaders |
| **Operations** | Sonnet | Circle | 36px | Orange `#E8682A` | 3px | Standard — workhorse agents |
| **Recon** | Haiku | Diamond | 26px | Phosphor `#82C896` | 2.5px | Light — fast extraction |

### Detection Logic ✅ (`server/index.ts:1356`)

`detectUnitClass()` inspects recent events to classify new sessions:
- Standalone sessions (no Task tool parent) → **Command**
- Sub-agents spawned via Task tool → check `model` parameter in tool input:
  - `haiku` → **Recon**
  - `opus` → **Command** (rare — opus sub-agents)
  - default (sonnet or unspecified) → **Operations**

### Parent Tracking ✅ (`shared/types.ts`)

`parentSessionId?: string` on `ManagedSession` — set during auto-registration when `detectParentSession()` finds a recent Task tool call from another session.

---

## Unit Visual Indicators

### Body Shape ✅ (`UnitRenderer.ts` — `drawBody()`)
- **Command**: Hexagon — 6-point polygon with inner highlight
- **Operations**: Circle with inner highlight
- **Recon**: Diamond (4-point polygon rotated 45°) with inner highlight
- All shapes use territory-based fill colors at 0.9 alpha

### Health Bar ✅ (`UnitRenderer.ts` — `drawHealthBar()`)
- Maps context usage to health: `1 - (tokens.current / 200000)`
- Width scales with unit class: command=64px, operations=52px, recon=40px
- Color transitions:
  - Green `#82C896` (>50% remaining)
  - Amber `#FFB86C` (25-50% remaining)
  - Orange-red `#E8682A` (<25% remaining)

### Model Label ✅ (`UnitRenderer.ts`)
- Text below health bar: "OPUS", "SONNET", "HAIKU"
- Color matches division accent, 13px JetBrains Mono, 0.6 alpha
- Updates dynamically via `setUnitClass()`

### Status Ring ✅ (`UnitRenderer.ts` — `drawStatusRing()`)
- Pulsing ring with class-aware thickness (4/3/2.5px)
- Color by status: idle=phosphor green, working=warm orange, thinking=teal, offline=cream-dim
- Outer accent ring at radius+12, 1.5px width, 25% alpha — shows division color

### Selection Ring ✅ (`UnitRenderer.ts` — `drawSelectionRing()`)
- Dashed arc segments (12 segments, alternating visible/hidden)
- Uses division accent color at 0.8 alpha
- Rotates slowly when selected

### Zoom-Responsive Labels ✅ (`UnitRenderer.ts` — `setZoomScale()`)
- Counter-scales nameplate, tool text, model label, health bar based on zoom level
- Clamp at 2.5x to prevent absurd sizes at extreme zoom-out

---

## Parent-Child Connection Lines ✅ (`ConnectionLineRenderer.ts`)

- Marching ants dashed lines from parent to each active sub-agent
- Line color: parent's division accent color
- Alpha varies by sub-agent status
- Lines drawn in effects layer between parent and child world positions

---

## Roads System ✅ (`RoadRenderer.ts`)

- Bezier curve paths between territories
- Animated dot flow along road paths
- 5-tier level system based on movement frequency
- Hover tooltips showing road usage stats

---

## Virtual Sub-Agent Spawning ✅ (`server/index.ts ~line 1495`)

- Agent tool fires create temporary managed sessions
- Sub-agents tracked with `parentSessionId` linking back to spawning session
- Unit class auto-detected at registration time
- Sessions broadcast to all connected clients

---

## Sub-Agent Formation ✅ (`main.ts`)

- `getSubAgentPosition(parentX, parentY, childIndex, totalChildren)` helper
- Golden angle distribution: `angle = childIndex * 2.399963` radians
- Radius: `80 + (childIndex * 15)` pixels, capped at 200px
- Sub-agents override default territory spread with parent-relative positioning

---

## OPEN — Remaining Work

### ⬜ 1. Lifetime Fade ✅ (now implemented)

Sub-agents should visually age to signal remaining useful context.

**Implementation** (`UnitRenderer.ts`):
- `createdAt: number` field, set to `Date.now()` in constructor
- In `update(dt)`, calculate `age = (Date.now() - createdAt) / 1000`
- If `parentSessionId` is set (sub-agent), lerp container alpha: `1.0 → 0.7` over 120 seconds
- If status is `'offline'`, alpha = 0.3 (overrides age fade)
- Formula: `alpha = Math.max(0.7, 1.0 - (age / 120) * 0.3)`

### ⬜ 2. Shrink-to-Zero Animation

When a sub-agent completes (session removed from server), animate scale to 0 over 500ms before destroying.

**Spec**:
- Currently: `battlefield.removeUnit(id)` is called immediately when session disappears from the session list
- Target: Instead of immediate removal, trigger a 500ms scale tween: `container.scale` from current → 0
- After tween completes, call `destroy()` and remove from units map
- Use PixiJS ticker-based animation (no external tween lib):
  ```
  shrinkTimer: number = 0
  isShrinking: boolean = false

  startShrink(): void — sets isShrinking = true, shrinkTimer = 0

  In update(dt):
    if isShrinking:
      shrinkTimer += dt
      progress = Math.min(1, shrinkTimer / 0.5)
      scale = 1 - progress
      container.scale.set(scale)
      if progress >= 1: emit 'shrink-complete' or set flag for parent to remove
  ```
- `BattlefieldRenderer.removeUnit()` should call `unit.startShrink()` instead of immediate destroy, then clean up on completion

### ⬜ 3. Sprite Atlas Integration

`scripts/export-sprites.html` generates PixiJS atlas JSON + sprite sheets. UnitRenderer still uses procedural Graphics shapes.

**Spec**:
- Load atlas on app init: `Assets.load('sprites/unit-atlas.json')` → returns `Spritesheet`
- In UnitRenderer constructor, check if atlas is available (pass via constructor or global):
  - If atlas loaded: create `Sprite` from atlas frame matching unit class (`command.png`, `operations.png`, `recon.png`)
  - If atlas missing: fall back to current procedural `drawBody()` (Graphics shapes)
- Sprite sizing: scale sprite to match `CLASS_CONFIG[unitClass].radius * 2` dimensions
- Territory tint: apply `sprite.tint = TERRITORY_UNIT_COLORS[territory]`
- On `setUnitClass()`: swap sprite texture from atlas if available, else redraw Graphics
- Atlas frames expected: `command.png`, `operations.png`, `recon.png`, `command-selected.png`, etc.

### ⬜ 4. Golden Angle Formation ✅ (now implemented)

Sub-agents distribute around parent using golden angle spacing.

**Implementation** (`main.ts`):
- `getSubAgentPosition(parentX, parentY, childIndex)` helper function
- `angle = childIndex * 2.399963` (golden angle in radians)
- `radius = Math.min(200, 80 + childIndex * 15)` pixels
- Returns `{ x: parentX + cos(angle) * radius, y: parentY + sin(angle) * radius }`
- Called in `ensureUnit()` when `session.parentSessionId` is set — overrides default territory spread

---

## File Map (Current State)

| File | Status | What It Does |
|------|--------|-------------|
| `src/renderer/UnitRenderer.ts` | ✅ Shipped | Division shapes, class sizing, health bar, model label, status ring, selection ring, zoom scaling, lifetime fade |
| `src/renderer/ConnectionLineRenderer.ts` | ✅ Shipped | Marching ants parent-child lines |
| `src/renderer/RoadRenderer.ts` | ✅ Shipped | Bezier curve roads with animated dots, 5 tiers |
| `server/index.ts` | ✅ Shipped | `detectUnitClass()` at line 1356, `detectParentSession()`, auto-registration with unitClass |
| `shared/types.ts` | ✅ Shipped | `parentSessionId` on ManagedSession |
| `src/main.ts` | ✅ Shipped | Wires unitClass, parentSessionId, sub-agent formation positioning |
| `scripts/export-sprites.html` | ✅ Exists | Generates atlas JSON + sprite sheets (not yet wired to renderer) |

---

## Success Criteria

- [x] Opus sessions render as hexagons with amber accent
- [x] Sonnet sub-agents render as circles with orange accent
- [x] Haiku sub-agents render as diamonds with phosphor green accent
- [x] Model label visible below each unit (13px JetBrains Mono)
- [x] Context health bar with green→amber→red transitions at 50%/25%
- [x] Sub-agents auto-detected from Task tool events via `detectUnitClass()`
- [x] `parentSessionId` tracked and connection lines drawn
- [x] Roads system with bezier curves, dot animation, 5 tiers
- [x] Zoom-responsive label scaling
- [x] Sub-agent golden angle formation around parent
- [x] Lifetime fade: sub-agents fade 1.0→0.7 over 120s
- [ ] Shrink-to-zero animation on sub-agent completion
- [ ] Sprite atlas integration (procedural Graphics → Sprite textures)
- [x] `npx vite build` passes with zero errors
