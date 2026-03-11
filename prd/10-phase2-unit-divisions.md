# Agent Empires Phase 2 — Unit Divisions & Sub-Agent Visibility

## Goal

Transform the battlefield from "same-looking dots" into a readable military command interface where unit type, model tier, role, health, and lineage are instantly visible. Every sub-agent appears as its own unit. Parent-child relationships are drawn as connection lines. The RTS "at a glance" principle: a commander should know the state of their forces without clicking anything.

---

## Division System

Inspired by military branches — visually distinct silhouettes per model tier:

| Division | Model | Shape | Body Radius | Accent Color | Visual Weight |
|----------|-------|-------|-------------|--------------|---------------|
| **Command** | Opus | Hexagon | 24px | Gold `#FFB86C` | Heavy — strategic leaders |
| **Operations** | Sonnet | Circle + chevron | 20px | Cyan `#00FFCC` | Standard — workhorse agents |
| **Recon** | Haiku | Diamond | 14px | Phosphor `#82C896` | Light — fast extraction |

### Detection Logic
- Standalone sessions (launched by user) → **Command**
- Sub-agents spawned via `Task` tool → check `model` parameter:
  - `haiku` → **Recon**
  - `opus` → **Command** (rare, for opus sub-agents)
  - default (sonnet or unspecified) → **Operations**

---

## Unit Visual Indicators

### Health Bar (Context Window)
- Maps context usage to health: 100% context remaining = full green bar
- Color transitions: green (>50%) → amber (25-50%) → red (<25%)
- Width scales with unit class (command=36px, operations=30px, recon=22px)

### Model Label
- Tiny text below health bar: "OPUS", "SONNET", "HAIKU"
- Color matches division accent
- 7px JetBrains Mono

### Status Ring
- Existing pulse animation, now class-aware (thicker for command, thinner for recon)
- Outer accent ring shows division color at 25% opacity

### Lifetime Indicator (Phase 2B)
- Sub-agents fade slightly as they age (opacity 1.0 → 0.7 over lifetime)
- Completed sub-agents shrink-animate to 0 over 500ms then remove
- Offline units dim to 30% opacity (already partially implemented)

---

## Parent-Child Connection Lines (Phase 2B)

### Visual
- Thin dashed line from parent unit to each active sub-agent
- Color: parent's division accent at 30% opacity
- Animated dash pattern (marching ants) while sub-agent is working
- Line fades when sub-agent completes

### Data Model
- Server tracks `parentSessionId` on each managed session
- Detected from the `Task` tool's `pre_tool_use` event (the session that called Task = parent)
- Client draws lines in the effects layer between parent and child world positions

### Formation
- Sub-agents cluster near their parent but offset in a fan pattern
- Avoid overlapping — use angular distribution around parent position

---

## Roads System Preview (Phase 2C)

- Repeated unit movement between territories creates persistent "TRON data highways"
- Road opacity = movement frequency (faint → bright)
- Thin animated cyan lines along road paths
- Roads are the "magnetic residue" — the traces left by agent activity

---

## File Changes

| File | Change |
|------|--------|
| `src/renderer/UnitRenderer.ts` | Add UnitClass, division shapes, model label, class-specific sizing |
| `server/index.ts` | detectUnitClass() helper, parentSessionId tracking |
| `src/main.ts` | Wire unitClass from session to UnitRenderer |
| `shared/types.ts` | Add unitClass and parentSessionId to ManagedSession (Phase 2B) |
| `src/renderer/ConnectionLineRenderer.ts` | NEW — parent-child lines (Phase 2B) |
| `src/renderer/RoadsRenderer.ts` | NEW — TRON data highways (Phase 2C) |

---

## Success Criteria

- [ ] Opus sessions render as hexagons with gold accent
- [ ] Sonnet sub-agents render as circles with cyan accent
- [ ] Haiku sub-agents render as diamonds with green accent
- [ ] Model label visible below each unit
- [ ] Context health bar color-transitions correctly
- [ ] Sub-agents auto-detected from Task tool events
- [ ] `npx vite build` passes with zero errors
- [ ] No visual regressions on existing floating panel, combat, movement
