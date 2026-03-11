# Combat Animation System & Road-Building Mechanic

## Technical Design Document — Agent Empires v0.1

> ### Status Summary (2026-03-10)
>
> **Assessment:** Core combat animations and road rendering are shipped. Road tiering (execution count upgrades) is implemented. Combo system, sustained-tool animations, and full sound synthesis are not yet wired.
>
> - [x] **CombatAnimator (tool-call-to-animation mapping)** — `src/game/CombatAnimator.ts`
> - [x] **RoadRenderer (tiered road visuals, marching ants)** — `src/renderer/RoadRenderer.ts`
> - [x] **RoadAggregator (server-side execution counting)** — `server/RoadAggregator.ts`
> - [x] **ParticleSystem (burst/trail effects)** — `src/renderer/ParticleSystem.ts`
> - [x] **ScreenEffects (shake/flash)** — `src/renderer/ScreenEffects.ts`
> - [x] **Sound infrastructure** — `src/audio/SoundManager.ts`, `src/audio/SpatialAudioContext.ts`
> - [ ] **Combo counter / escalation system** — not found in codebase
> - [ ] **Sustained-tool animations (Write streaming, Bash long-running)** — not implemented
> - [ ] **Per-tool sound synthesis (Tone.js frequency table)** — SoundManager exists but full frequency table from spec not wired
> - [ ] **Road tier-up ceremony animations** — not implemented
> - [ ] **Territory-specific road colors** — not verified

**Depends on:** `01-vision.md` (core metaphor, PixiJS renderer, event system)
**Feeds into:** Phase 1 (unit movement), Phase 4 (particle effects, physics layer)

This document specifies the two primary dopamine systems: combat animations triggered by Claude tool calls, and the road-building mechanic that rewards repeated workflow execution with visible infrastructure.

---

## PART 1: COMBAT ANIMATION SYSTEM

Every Claude Code tool call is a combat action. The hook system (`hooks/vibecraft-hook.sh`) emits `pre_tool_use` and `post_tool_use` events via WebSocket. The combat animation system consumes these events and translates them into PixiJS sprite animations, particle bursts, screen effects, and sound cues.

### 1.1 Architecture

```
hook.sh → WebSocket → EventBus
                         ↓
              CombatAnimationController
                    ↓           ↓
          AnimationQueue    ParticlePool
                    ↓           ↓
              PixiJS Stage (render)
```

```typescript
interface CombatAnimation {
  /** Which tool triggered this */
  tool: ToolName
  /** Unit performing the action */
  unitId: string
  /** Target entity (file node, web target, sub-agent portal) */
  target?: AnimationTarget
  /** Pre-calculated timing */
  timing: {
    windupMs: number      // Before the hit
    impactMs: number      // The hit frame
    followThroughMs: number // After the hit
    totalMs: number
  }
  /** Particle config for this animation */
  particles: ParticleConfig
  /** Screen effect (shake, flash, etc.) */
  screenEffect?: ScreenEffect
  /** Sound cue identifier */
  sound: string
}

interface AnimationTarget {
  type: 'file' | 'directory' | 'url' | 'command' | 'subagent' | 'generic'
  label: string           // Filename, URL, command text
  worldPosition: PIXI.Point
}
```

### 1.2 Tool-to-Attack Mapping

Each Claude tool maps to a distinct combat animation archetype. The unit sprite performs the animation at its current world position, with particles and effects emanating from the impact point.

---

#### READ — The Scout's Sweep

**Metaphor:** Intelligence gathering. The unit opens a scroll/dossier and absorbs information.

**Animation (32 frames at 60fps = 533ms total):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–5 | 83ms | Unit turns toward file target, arm rises | Windup |
| 6–8 | 50ms | A translucent "page" sprite materializes in front of unit | Spawn effect |
| 9–20 | 200ms | Page glows with scan lines sweeping top-to-bottom | Active read |
| 21–26 | 100ms | Info particles (small blue dots) stream from page into unit | Absorption |
| 27–32 | 100ms | Page fades, unit returns to idle stance | Cooldown |

**Particles:**
- Type: `info_stream` — 8–12 small blue (#4FC3F7) circles, 3px radius
- Emit from page center, arc toward unit head position
- Lifetime: 400ms, ease-out fade
- Gravity: none (float)

**Screen effect:** None (reads are quiet, non-disruptive)

**Sound:** Soft page turn + subtle data-absorption hum. Tone.js: sine wave sweep 800Hz→1200Hz over 200ms, volume 0.15

**Duration scaling:** If `toolInput.limit > 500` or no limit specified (reading full file), extend frames 9–20 to 350ms. A quick `Read` with `limit: 20` compresses to 300ms total.

**PixiJS implementation:**
```typescript
class ReadAnimation extends BaseAnimation {
  private pageSprite: PIXI.Sprite
  private scanLine: PIXI.Graphics
  private infoParticles: ParticleEmitter

  play(unit: UnitSprite, target: AnimationTarget): void {
    // Page sprite: 24x32px translucent blue rectangle with rounded corners
    this.pageSprite = new PIXI.Sprite(PIXI.Texture.WHITE)
    this.pageSprite.width = 24
    this.pageSprite.height = 32
    this.pageSprite.tint = 0x4FC3F7
    this.pageSprite.alpha = 0
    this.pageSprite.position.set(unit.x + 16, unit.y - 8)

    // Scan line: 1px tall white bar that sweeps down the page
    this.scanLine = new PIXI.Graphics()
    this.scanLine.rect(0, 0, 22, 1).fill({ color: 0xFFFFFF, alpha: 0.8 })

    // Tween sequence:
    // 1. Fade in page (0→0.6 alpha over 83ms)
    // 2. Sweep scan line top→bottom (200ms, ease-in-out)
    // 3. Emit info_stream particles (100ms burst)
    // 4. Fade out page (100ms)
  }
}
```

---

#### WRITE — The Artillery Strike

**Metaphor:** Creating something from nothing. Heavy, impactful. A cannon fires and a structure materializes at the target location.

**Animation — Single file creation (48 frames = 800ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–8 | 133ms | Unit braces, charge effect builds (orange glow at hands) | Windup — energy gathering |
| 9–12 | 67ms | Projectile launches from unit toward file target position | Launch |
| 13–18 | 100ms | Projectile travels in slight arc, trailing orange sparks | Flight |
| 19–22 | 67ms | Impact explosion at target: expanding ring + file icon appears | Impact |
| 23–36 | 217ms | File icon solidifies, "construction" particles settle around it | Materialization |
| 37–48 | 183ms | Glow fades, file icon persists as terrain feature | Settle |

**Animation — Sustained writing (content file, >500 chars):**

The initial launch happens once, then the unit enters a "channeling" state:
- Unit sprite gets a persistent orange aura (pulsing alpha 0.3→0.6, 1s cycle)
- Continuous stream of small orange particles from unit to file target
- Stream intensity proportional to content length (more chars = denser stream)
- Every 200ms, a small "brick" sprite (4x4px) travels along the stream and stacks at the target
- When `post_tool_use` fires, final impact explosion (1.5x normal size)

**Particles — Impact:**
- Type: `construction_burst` — 16–24 orange (#FF9800) squares, 2–4px
- Emit radially from impact point
- Lifetime: 600ms
- Gravity: 0.3 (they fall slightly, like debris)
- Rotation: random spin on each particle

**Particles — Channeling stream:**
- Type: `energy_stream` — continuous emitter, 3 particles/frame
- Color: gradient orange (#FF9800) to yellow (#FFE082)
- Size: 2px circles
- Path: bezier curve from unit to target with slight wave oscillation
- Lifetime: matches travel time (depends on distance)

**Screen effect:** Subtle screen shake on impact — 2px displacement, 3 frames, horizontal bias

**Sound:**
- Windup: Rising tone 200Hz→600Hz, sawtooth wave, 133ms, volume 0.2
- Launch: Short percussive hit (noise burst, 50ms, volume 0.4)
- Impact: Low thud (80Hz sine, 100ms decay) + sparkle (high frequency noise, 60ms)
- Channeling: Continuous low hum (120Hz, volume 0.1, slight vibrato)

---

#### EDIT — The Precision Strike

**Metaphor:** Surgical operation. A sniper shot or scalpel cut — fast, precise, minimal collateral.

**Animation — Single edit (24 frames = 400ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–3 | 50ms | Unit raises arm, targeting reticle appears at file position | Aim |
| 4–6 | 50ms | Thin beam (2px wide) fires from unit to target | Fire |
| 7–10 | 67ms | Beam connects, "cut" effect at target (line splits, shifts) | Impact |
| 11–18 | 133ms | Old text fragments scatter outward (small white squares) | Debris |
| 19–24 | 100ms | New text "slots in" with green glow, beam fades | Resolution |

**Animation — Bulk edit (`replace_all: true`):**

Same opener, but the beam fans into 3–5 beams that hit different points on the target simultaneously. Each impact triggers its own mini-debris scatter. Feels like a shotgun blast vs a sniper shot.

**Visual difference between single and bulk:**
- Single: One thin cyan (#00BCD4) beam, pinpoint debris
- Bulk: Multiple beams in a spread pattern, more debris, wider scatter radius
- `replace_all` adds a brief "scanning sweep" (horizontal line across target) before the multi-beam fires

**Particles:**
- Type: `code_fragments` — 6–10 white/gray squares, 2–3px
- Emit from impact point outward in a narrow cone (30-degree spread)
- Lifetime: 400ms
- Gravity: 0.5 (fragments fall away)
- Then 4–6 green (#4CAF50) squares "snap in" from edges to center — the replacement

**Screen effect:** None for single edit. Bulk edit gets a 1px shake, 2 frames.

**Sound:**
- Aim: High-pitched charging tone (2000Hz, 50ms, volume 0.1)
- Fire: Sharp crack (noise burst + high sine, 30ms, volume 0.3)
- Impact: Glass-break texture (filtered noise, 80ms, volume 0.2)
- Bulk: Same but layered 3–5 times with 30ms stagger

---

#### BASH — The Siege Engine

**Metaphor:** Heavy ordnance. A catapult or battering ram. Bash commands are brute force — they shell out to the OS. The animation should feel weighty and consequential.

**Animation (36 frames = 600ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–6 | 100ms | Unit plants stance wide, "loading" gear animation | Windup |
| 7–9 | 50ms | Terminal icon (">_") charges with green energy | Charge |
| 10–14 | 83ms | Green shockwave expands outward from unit in a ring | Blast |
| 15–24 | 167ms | Impact zone (radius ~40px) flashes with terminal-green glow | Execution |
| 25–30 | 100ms | If success: zone clears to normal. If fail: zone turns red briefly | Result |
| 31–36 | 100ms | Debris particles settle, unit returns to stance | Cooldown |

**Special case — long-running commands (`timeout > 5000` or `run_in_background`):**
- After frame 14, unit enters a "holding" stance with a spinning gear icon overhead
- Green pulse ring repeats every 500ms (heartbeat) until `post_tool_use` arrives
- On completion, the final explosion is 2x size (reward for patience)

**Particles:**
- Type: `shockwave_debris` — 20–30 mixed green (#4CAF50) and gray (#9E9E9E) fragments
- Emit in a ring pattern from unit center
- Lifetime: 500ms
- Gravity: 0.8 (heavy, grounded feel)
- Size: 3–6px (larger than other tool particles)

**Screen effect:**
- Standard command: 3px shake, 4 frames, omnidirectional
- `npm install`, `git push`, or commands with `sudo`: 5px shake, 6 frames
- Background command: no shake (it's quiet)

**Sound:**
- Charge: Low rumble (60Hz, 100ms ramp up, volume 0.2)
- Blast: Kick drum hit (synthesized: 150Hz→40Hz sweep, 80ms, volume 0.5)
- Execution hum: Filtered noise at 200Hz, volume 0.1, duration matches execution
- Success: Resolved chord (C major: 262Hz + 330Hz + 392Hz, 150ms, volume 0.2)
- Failure: Dissonant low tone (73Hz + 78Hz, 200ms, volume 0.3)

---

#### GREP / GLOB — The Reconnaissance Sweep

**Metaphor:** Radar sweep or sonar ping. The unit scans a wide area looking for targets. Grep is searching content (deeper), Glob is searching names (surface-level).

**Animation — Grep (40 frames = 667ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–4 | 67ms | Unit raises scanning device (binocular/radar icon) | Prepare |
| 5–24 | 333ms | Expanding arc sweeps outward from unit, 180-degree cone | Sweep |
| 25–32 | 133ms | Highlighted "hit" dots appear along the sweep path | Results materialize |
| 33–40 | 133ms | Hit dots pulse once then fade to persistent markers | Settle |

The sweep is a translucent purple (#7C4DFF) arc that expands from the unit's facing direction. As the arc passes over "terrain" (file representations in the territory), matching areas light up with small diamond markers.

**Animation — Glob (28 frames = 467ms):**

Faster and more surface-level:
- Same arc sweep but completes in 200ms (faster scan)
- No depth — the arc is thin (2px) instead of filled
- Hit markers are simpler (circles instead of diamonds)
- Feels like a quick radar ping vs Grep's deep sonar

**Particles:**
- Grep: `sonar_pulse` — expanding ring of 20 small purple dots, ring radius grows from 0 to 80px
- Glob: `radar_ping` — single expanding circle outline (no fill), purple, 0→60px radius

**Screen effect:** None (reconnaissance is quiet)

**Sound:**
- Grep: Sonar ping (sine 1500Hz, 100ms, with echo/reverb tail 400ms, volume 0.2)
- Glob: Quick radar blip (sine 2000Hz, 40ms, no reverb, volume 0.15)
- Each hit marker: tiny click (noise, 10ms, volume 0.05) — creates a satisfying rapid-fire click pattern when many results return

---

#### WEBFETCH / WEBSEARCH — The Ranged Bombardment

**Metaphor:** Long-range artillery or calling in an airstrike. The target is distant (off-map, external), so a projectile must travel far. This is the most dramatic single-tool animation.

**Animation — WebFetch (60 frames = 1000ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–8 | 133ms | Unit aims upward at 45 degrees, targeting arc appears | Aim |
| 9–14 | 100ms | Projectile launches upward-outward with bright trail | Launch |
| 15–30 | 267ms | Projectile arcs across screen toward map edge, shrinking | Flight |
| 31–36 | 100ms | Projectile exits visible area (or hits "cloud" icon at map edge) | Exit |
| 37–48 | 200ms | Pause — waiting for response. Unit in "listening" stance | Wait |
| 49–54 | 100ms | Return projectile (data packet) arrives from same direction | Return |
| 55–60 | 100ms | Data packet impacts unit, info particles burst outward | Receive |

The projectile is a bright white (#FFFFFF) circle with a comet tail (gradient white→transparent, 20px trail). The return packet is cyan (#00BCD4) and slightly larger.

**WebSearch variant:** Same structure but the outgoing projectile splits into 3–5 smaller projectiles at frame 15 (fan pattern), representing multiple search results. All return as separate data packets between frames 49–54, arriving in quick succession.

**Particles:**
- Launch trail: `comet_tail` — continuous emitter, 2 particles/frame, white fading to transparent, 2px, 200ms lifetime
- Return burst: `data_burst` — 12–16 cyan particles, radial burst from unit, 500ms lifetime
- WebSearch additional: each return packet gets its own mini-burst (6 particles each)

**Screen effect:**
- Launch: 1px upward shake (recoil feel)
- Return impact: 2px shake, 3 frames

**Sound:**
- Aim: Ascending whistle (sine sweep 400Hz→1200Hz, 133ms, volume 0.15)
- Launch: Whoosh (filtered noise, bandpass 800-2000Hz, 100ms, volume 0.3)
- Flight: Fading whistle (1200Hz→800Hz descending, 267ms, volume 0.1→0)
- Wait: Subtle static crackle (noise, very low volume 0.03)
- Return: Descending whistle (reverse of launch) + impact thud

---

#### TASK — Reinforcements

**Metaphor:** Calling in reinforcements. A portal opens, a new unit emerges. This is the most visually dramatic animation because spawning a sub-agent is a significant event.

**Animation (90 frames = 1500ms):**

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–12 | 200ms | Unit raises both arms, purple energy gathers at a point 20px ahead | Summon charge |
| 13–24 | 200ms | Portal sprite opens — expanding purple (#7C4DFF) oval with swirl particles | Portal opening |
| 25–42 | 300ms | Portal stabilizes, inner glow intensifies, lightning arcs around rim | Portal active |
| 43–54 | 200ms | New mini-unit sprite emerges from portal center, stumbles forward | Emergence |
| 55–66 | 200ms | Sub-agent unit materializes fully, gets its own status ring | Materialization |
| 67–78 | 200ms | Portal collapses inward with implosion particles | Portal close |
| 79–90 | 200ms | Connection line (dotted, animated) forms between parent and sub-agent | Link established |

The portal is rendered as an oval PIXI.Graphics with animated radial gradient:
```typescript
// Portal rendering (simplified)
const portal = new PIXI.Graphics()
// Outer ring: purple, pulsing
portal.circle(0, 0, 20).stroke({ color: 0x7C4DFF, width: 3, alpha: pulseAlpha })
// Inner fill: dark center fading to purple edge
// Swirl: rotating particle ring inside the oval
```

**Sub-agent unit sprite:** 60% scale of parent unit, tinted with parent's color but slightly desaturated. Has its own health bar (context budget). Connected to parent via animated dotted line.

**Particles:**
- Portal opening: `void_swirl` — 30 purple particles orbiting the portal center, spiral inward
- Emergence: `materialization_sparks` — 20 white+purple particles burst outward from portal
- Portal close: `implosion` — all remaining particles rush to center point, then single bright flash

**Screen effect:** 2px shake during emergence (frames 43–54). Brief purple tint overlay (alpha 0.05) during portal active phase.

**Sound:**
- Summon charge: Rising harmonic (C3→C4 over 200ms, sine + slight overdrive, volume 0.2)
- Portal open: Reverse cymbal crash (noise, 200ms, bandpass sweep low→high, volume 0.3)
- Portal active: Sustained low drone (80Hz, volume 0.15, with slight tremolo)
- Emergence: Synth stab (saw wave, C4, 100ms attack, volume 0.25)
- Portal close: Implosion whoosh (high→low noise sweep, 200ms, volume 0.2)
- Link: Subtle ping (2000Hz sine, 30ms, volume 0.1)

---

#### MCP TOOL CALLS — Foreign Ordnance

**Metaphor:** Calling in support from allied forces. MCP tools (Figma, Slack, Notion, Supabase, Vercel, etc.) are external services — the unit sends a request to an off-map ally.

**Animation (40 frames = 667ms):**

MCP calls share a common animation structure with a service-specific color accent:

| MCP Server | Accent Color | Icon Shape |
|-----------|-------------|------------|
| Figma | `#A259FF` (purple) | Diamond |
| Slack | `#4A154B` (aubergine) | Hash mark |
| Notion | `#000000` (black) | Page icon |
| Supabase | `#3ECF8E` (green) | Database cylinder |
| Vercel | `#000000` (black) | Triangle |
| Gamma | `#FF6B35` (orange) | Slides icon |
| Gmail | `#EA4335` (red) | Envelope |
| Google Calendar | `#4285F4` (blue) | Calendar grid |
| Asana | `#F06A6A` (coral) | Checkmark |
| Unknown MCP | `#9E9E9E` (gray) | Gear |

| Frame | Duration | Visual | Notes |
|-------|----------|--------|-------|
| 0–6 | 100ms | Unit extends hand, service icon appears above with accent glow | Request prep |
| 7–14 | 133ms | Icon launches upward (like WebFetch but with service color trail) | Send |
| 15–26 | 200ms | Icon reaches map edge, unit in "linked" stance with service color aura | Waiting |
| 27–34 | 133ms | Return burst in service accent color, data flows to unit | Response |
| 35–40 | 100ms | Service icon fades, accent particles settle | Complete |

**Sound:** Same as WebFetch structure but the launch sound has a unique pitch per service (preventing audio monotony when multiple MCP calls chain).

---

### 1.3 Combat Sequence Choreography

Real Claude tasks involve 5–50+ tool calls in rapid succession. The animation system must create rhythm, not chaos.

#### Animation Queue

```typescript
class AnimationQueue {
  private queue: CombatAnimation[] = []
  private playing: CombatAnimation | null = null
  private comboCount: number = 0
  private lastToolTime: number = 0

  /** Time window (ms) for consecutive tools to count as a combo */
  static COMBO_WINDOW = 2000

  /** Minimum gap between animation starts (prevents visual overload) */
  static MIN_GAP_MS = 100

  /** Maximum queue depth before we start compressing */
  static MAX_QUEUE = 8

  enqueue(anim: CombatAnimation): void {
    const now = Date.now()

    // Combo detection
    if (now - this.lastToolTime < AnimationQueue.COMBO_WINDOW) {
      this.comboCount++
    } else {
      this.comboCount = 1
    }
    this.lastToolTime = now

    // Queue overflow: compress by reducing animation duration
    if (this.queue.length >= AnimationQueue.MAX_QUEUE) {
      this.compressQueue()
    }

    anim.comboIndex = this.comboCount
    this.queue.push(anim)

    if (!this.playing) {
      this.playNext()
    }
  }

  private compressQueue(): void {
    // Reduce all queued animations to 50% duration
    // Skip windup frames, go straight to impact
    for (const anim of this.queue) {
      anim.timing.windupMs = 0
      anim.timing.followThroughMs *= 0.5
      anim.timing.totalMs = anim.timing.impactMs + anim.timing.followThroughMs
    }
  }
}
```

#### Rhythm and Pacing

The system creates natural rhythm through three mechanisms:

**1. Combo Acceleration**

When tools fire within 2 seconds of each other, each subsequent animation is faster and more intense:

| Combo Count | Speed Multiplier | Particle Multiplier | Screen Shake Multiplier |
|-------------|-----------------|---------------------|------------------------|
| 1 | 1.0x | 1.0x | 1.0x |
| 2 | 1.1x | 1.2x | 1.0x |
| 3 | 1.2x | 1.4x | 1.1x |
| 4 | 1.3x | 1.6x | 1.2x |
| 5+ | 1.5x | 2.0x | 1.3x |

At combo 5+, a persistent "combo fire" aura appears around the unit — a faint flickering orange glow (animated alpha 0.1→0.2, 200ms cycle). This aura persists as long as tools keep firing within the combo window.

**2. Combo Counter Display**

When comboCount >= 3, a floating combo counter appears above the unit:

```typescript
class ComboDisplay {
  private text: PIXI.Text
  private style = new PIXI.TextStyle({
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    fill: '#FFE082',           // Gold
    stroke: { color: '#000', width: 2 },
    dropShadow: { color: '#FF9800', blur: 4, distance: 0 }
  })

  update(count: number): void {
    if (count < 3) {
      this.text.visible = false
      return
    }
    this.text.visible = true
    this.text.text = `${count}x COMBO`

    // Scale pop on increment
    this.text.scale.set(1.3)
    // Tween back to 1.0 over 150ms (bounce ease)
  }
}
```

**3. Breathing Room (Thinking Phase)**

When Claude is thinking (time between `post_tool_use` and next `pre_tool_use` > 1 second), the unit enters a "reposition" animation:

- Unit shifts position slightly (2–5px random drift within its zone)
- Status ring shifts from cyan (working) to a pulsing blue (thinking)
- A subtle "thought bubble" icon (three ascending dots) appears briefly
- Ambient particle rate drops to zero
- Sound: very quiet ambient hum fades in (100Hz, volume 0.02)

This creates the visual rhythm: **burst → breathe → burst → breathe**, like a real combat engagement. The player can feel Claude processing between tool volleys.

**4. Overlap Allowance**

When the queue has 2+ items AND the current animation is past its impact frame, the next animation can begin its windup phase. This creates overlapping animations that feel fluid rather than strictly sequential:

```
Time →
Tool 1: [==WINDUP==][IMPACT][==FOLLOWTHROUGH==]
Tool 2:                 [==WINDUP==][IMPACT][==FOLLOWTHROUGH==]
Tool 3:                                [==WINDUP==][IMPACT][==FOLLOW==]
```

The overlap is only allowed in the followthrough→windup transition, never impact→impact (which would be visually confusing).

#### Camera Behavior

```typescript
interface CameraBehavior {
  /** Auto-zoom to action when combat starts */
  autoFocusOnCombat: boolean

  /** Zoom level during active combat (closer = more dramatic) */
  combatZoom: number          // 1.5x (vs default 1.0x)

  /** Time before camera auto-focuses on active unit (ms) */
  focusDelay: number          // 3000ms (don't snap immediately)

  /** Camera returns to overview after this idle time (ms) */
  returnToOverviewDelay: number  // 10000ms

  /** Smooth camera pan speed (pixels/second) */
  panSpeed: number            // 800

  /** Camera shake is reduced when zoomed out */
  shakeAttenuation: number    // shake * (1 / currentZoom)
}
```

Camera rules:
- If only one unit is active: auto-pan to center on it after 3 seconds of activity
- If multiple units are active: stay at overview zoom, show connection lines between them
- When combat starts (first tool call after idle): smooth zoom from current to 1.5x over 500ms
- When combat ends (unit goes idle for 10s): smooth zoom back to 1.0x over 1000ms
- User camera control always overrides auto-behavior (any pan/zoom input cancels auto for 30 seconds)
- Screen shake is attenuated by zoom level: a 3px shake at 2x zoom becomes 1.5px shake. At 0.5x zoom it becomes 6px shake. This keeps shake perceptible but not nauseating at any zoom.

---

### 1.4 Engagement Types (Task-Specific Combat Choreography)

Different kinds of real work produce different combat rhythms. The system detects engagement type from the tool call pattern and applies an appropriate visual treatment.

#### Content Creation — Sustained Barrage

**Tool pattern:** `Read` (1–3) → `Write` (1) → [thinking] → `Write` (1) → `Edit` (2–5) → `Write` (1)
**Detection:** 3+ Write calls within 60 seconds, targeting files in content directories

**Visual narrative:**
1. **Opening reconnaissance** (0–10s): Read animations scout the terrain — quiet, methodical sweeps
2. **First salvo** (10–20s): First Write fires — full artillery animation, dramatic. Territory brightens.
3. **Sustained bombardment** (20–120s): Subsequent Writes enter channeling mode. The unit has a persistent orange aura, continuous particle stream to the target file. The file target grows a visible "document" sprite that gets taller/larger with each Write.
4. **Precision refinement** (120–180s): Edits fire as sniper shots at the growing document. Each Edit makes the document sprite flash and shift (old→new). The rhythm tightens — smaller animations, faster cadence.
5. **Final delivery** (180s+): Last Write gets a 2x impact explosion. The document sprite gets a gold border. Territory ownership shifts slightly (color intensifies).

**Ambient:** During sustained bombardment, nearby idle units turn to "watch" (face toward the active unit). Creates a sense of the whole army being aware of the offensive.

#### Code Refactoring — Surgical Strikes

**Tool pattern:** `Grep`/`Glob` (2–5) → `Read` (3–8) → `Edit` (5–20) → `Bash` (1–2, running tests)
**Detection:** 5+ Edit calls within 60 seconds, especially with `replace_all: true`

**Visual narrative:**
1. **Area scan** (0–15s): Grep/Glob sweeps cover large territory area — multiple radar pings in succession
2. **Target acquisition** (15–30s): Read animations focus on specific files — hit markers from the scan phase glow brighter, creating a "target lock" effect
3. **Precision strike sequence** (30–90s): Rapid Edit animations fire in quick succession. Sniper beams connect to multiple target files. With each Edit, a small "fixed" checkmark appears at the impact point. The combo counter climbs fast.
4. **Verification** (90–120s): Bash fires — the siege engine animation with green shockwave. If tests pass (success), all the checkmarks flash green simultaneously. If tests fail, they flash red and the unit enters a defensive stance.

**Ambient:** The sniper beam trails linger for 2 seconds (fading), creating a visible web of connections between edited files. This "strike pattern" visualization makes refactoring feel strategic.

#### Research — Reconnaissance in Force

**Tool pattern:** `Grep`/`Glob` (3–8) → `WebFetch`/`WebSearch` (2–5) → `Read` (5–15) → `Write` (1, the synthesis)
**Detection:** 2+ WebFetch/WebSearch calls + 5+ Read calls within 120 seconds

**Visual narrative:**
1. **Local sweep** (0–20s): Grep/Glob animations scan the home territory — multiple overlapping radar arcs
2. **Long-range reconnaissance** (20–60s): WebFetch projectiles launch outward — this is the dramatic phase. Multiple projectiles in flight simultaneously (each to a different URL). The unit has a wide-stance "calling in fire support" pose.
3. **Intelligence processing** (60–120s): Return data packets arrive in bursts. Each Read animation is faster (compressed — research mode reads are quick absorptions). The unit is surrounded by floating page sprites (3–5 simultaneously).
4. **Strategic synthesis** (120s+): A single large Write animation fires — but this one has a special "intel report" variant: the artillery shell is wrapped in the page sprites that were floating around the unit. Impact creates a document with a glowing "intelligence" classification marker.

**Ambient:** During long-range reconnaissance, a thin animated line extends from the unit to the map edge in the direction of each active WebFetch. These lines pulse when data returns. Creates a sense of the unit being "connected to the outside world."

#### Debugging — Defensive Battle

**Tool pattern:** `Read` (1–2) → `Bash` (1, fails) → `Read` (2–3) → `Edit` (1–2) → `Bash` (1, test again) → repeat
**Detection:** Bash call with `success: false` followed by Read→Edit→Bash cycle

**Visual narrative:**
1. **Initial contact** (0–10s): Read + Bash — normal animations, but the Bash impact zone turns RED (failure). An "enemy" marker appears at the failure point.
2. **Assessment** (10–30s): Multiple Read animations — but the page sprites have a red tint. The unit is visually "investigating" the enemy position. Posture is defensive (hunched, shield up).
3. **Counter-attack** (30–60s): Edit fires at the enemy position. The sniper beam is now red→green (transforming the enemy). Each Edit chip away at the enemy marker (it shrinks, cracks appear in its sprite).
4. **Verification strike** (60s+): Bash fires again. If success: the enemy marker SHATTERS with a large particle explosion (30+ particles, mixed red debris and green "fixed" particles). Victory stinger plays. If fail: cycle repeats, enemy marker regenerates slightly.

**Ambient:** During debugging, the territory zone around the failure point dims and gets a subtle red fog overlay. Nearby units' status rings flash amber briefly (alert: something's wrong here). When the bug is fixed, the territory brightens with a visible "cleansing" wave spreading outward from the fix point.

#### Building (Skill Creation) — Siege Warfare

**Tool pattern:** Extended sequences of all tool types. Hundreds of calls over 10–60 minutes. Read→Write→Edit→Bash→Grep→Write→Edit→Write cycles.
**Detection:** 50+ total tool calls within a session, Write calls targeting a skill directory structure

**Visual narrative:**
1. **Siege begins** (0–5min): Normal animations for the first 20–30 tool calls. But a "construction site" sprite grows around the target area — scaffolding, cranes, activity indicators.
2. **Construction intensifies** (5–20min): As more files are created, the construction site grows physically larger on the map. Each Write adds a visible "brick" to the structure. Edits smooth the edges. Bash calls are foundation-laying explosions.
3. **Structure takes shape** (20–40min): The construction site resolves into a recognizable "building" sprite — a skill icon or structure that matches the unit type building it. Half-built structures have scaffolding overlay.
4. **Final assembly** (40–60min): Last few tool calls have amplified animations (1.5x particles, louder sounds). The building sprite solidifies, scaffolding falls away (falling-scaffolding particle animation, 2 seconds).
5. **Completion** (on `stop` event): Building sprite gets a golden glow, "NEW SKILL" text floats up. If this is a Write to `SKILL.md`, the building permanently adds to the territory as a new terrain feature.

**Ambient:** During siege warfare, the minimap shows a pulsing construction indicator at the build site. Other units in the same territory move slightly away (giving the builder space — prevents visual overlap).

---

### 1.5 Impact Effects

#### Screen Shake

```typescript
interface ScreenShake {
  /** Pixel displacement (before zoom attenuation) */
  intensity: number
  /** Number of frames to shake */
  durationFrames: number
  /** Directional bias: 'horizontal' | 'vertical' | 'omnidirectional' */
  direction: 'horizontal' | 'vertical' | 'omni'
  /** Decay curve: 'linear' | 'exponential' */
  decay: 'linear' | 'exponential'
}

// Shake per tool type (base values, multiplied by combo multiplier)
const SHAKE_TABLE: Record<string, ScreenShake> = {
  Write:     { intensity: 2, durationFrames: 3, direction: 'horizontal', decay: 'exponential' },
  Bash:      { intensity: 3, durationFrames: 4, direction: 'omni', decay: 'exponential' },
  BashFail:  { intensity: 4, durationFrames: 6, direction: 'omni', decay: 'linear' },
  Task:      { intensity: 2, durationFrames: 4, direction: 'vertical', decay: 'exponential' },
  WebFetch:  { intensity: 1, durationFrames: 2, direction: 'vertical', decay: 'linear' },
  EditBulk:  { intensity: 1, durationFrames: 2, direction: 'horizontal', decay: 'linear' },
  // Read, Edit (single), Grep, Glob: no shake
}
```

Implementation: offset the PIXI stage container's position by random values within intensity bounds, applying decay per frame. Always return to exact (0,0) on the last frame to prevent drift.

```typescript
class ScreenShakeController {
  private stageContainer: PIXI.Container
  private shakeQueue: ScreenShake[] = []
  private currentFrame: number = 0

  apply(shake: ScreenShake, zoomLevel: number): void {
    // Attenuate by zoom
    const attenuated = { ...shake, intensity: shake.intensity / zoomLevel }
    this.shakeQueue.push(attenuated)
  }

  tick(): void {
    if (this.shakeQueue.length === 0) return

    const shake = this.shakeQueue[0]
    this.currentFrame++

    const progress = this.currentFrame / shake.durationFrames
    const decayMult = shake.decay === 'linear'
      ? 1 - progress
      : Math.pow(1 - progress, 2)

    const magnitude = shake.intensity * decayMult
    const dx = shake.direction === 'vertical' ? 0 : (Math.random() - 0.5) * 2 * magnitude
    const dy = shake.direction === 'horizontal' ? 0 : (Math.random() - 0.5) * 2 * magnitude

    this.stageContainer.position.set(dx, dy)

    if (this.currentFrame >= shake.durationFrames) {
      this.stageContainer.position.set(0, 0)
      this.shakeQueue.shift()
      this.currentFrame = 0
    }
  }
}
```

#### Task Completion Particle Explosion

When a `stop` event fires (Claude finished its response):

```typescript
interface CompletionExplosion {
  /** Center point: unit's world position */
  origin: PIXI.Point
  /** Particle count scales with tools used during this task */
  particleCount: number  // clamp(toolsUsed * 3, 12, 60)
  /** Color based on outcome */
  color: number          // success: 0x4CAF50 (green), mixed: 0xFFE082 (gold)
  /** Duration */
  lifetimeMs: number     // 800ms
  /** Pattern */
  pattern: 'radial_burst' | 'fountain' | 'confetti'
}
```

Completion explosion pattern selection:
- 1–5 tools used: `radial_burst` (simple, quick)
- 6–20 tools used: `fountain` (particles launch upward then fall, more celebratory)
- 21+ tools used: `confetti` (multi-colored, multi-shaped particles — squares, circles, triangles — falling with rotation and horizontal drift)

#### Damage Numbers / Progress Indicators

Floating text that rises from the unit or impact point:

```typescript
class FloatingText {
  private text: PIXI.Text
  private velocity: { x: number, y: number }
  private lifetime: number
  private elapsed: number = 0

  constructor(
    content: string,
    color: string,
    position: PIXI.Point,
    lifetime: number = 1200
  ) {
    this.text = new PIXI.Text({
      text: content,
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        fill: color,
        stroke: { color: '#000000', width: 1.5 },
      }
    })
    this.text.anchor.set(0.5)
    this.text.position.copyFrom(position)
    this.velocity = { x: (Math.random() - 0.5) * 20, y: -40 }
    this.lifetime = lifetime
  }

  tick(deltaMs: number): boolean {
    this.elapsed += deltaMs
    const progress = this.elapsed / this.lifetime

    // Rise and slow down
    this.text.y += this.velocity.y * (deltaMs / 1000)
    this.text.x += this.velocity.x * (deltaMs / 1000)
    this.velocity.y *= 0.98 // Decelerate

    // Fade out in last 30%
    if (progress > 0.7) {
      this.text.alpha = 1 - ((progress - 0.7) / 0.3)
    }

    return this.elapsed < this.lifetime
  }
}
```

Floating text triggers:
| Event | Text | Color |
|-------|------|-------|
| File written | `+filename.ts` | `#4CAF50` (green) |
| File edited | `~filename.ts` | `#00BCD4` (cyan) |
| File read | filename (small, fast fade) | `#4FC3F7` (light blue) |
| Bash success | `$ OK` | `#4CAF50` (green) |
| Bash fail | `$ FAIL` | `#F44336` (red) |
| Lines added | `+127 lines` | `#4CAF50` (green) |
| Lines removed | `-43 lines` | `#F44336` (red) |
| Sub-agent spawned | `+AGENT` | `#7C4DFF` (purple) |
| Task complete | `MISSION COMPLETE` | `#FFE082` (gold) |
| Combo milestone (10, 25, 50) | `10x STREAK!` | `#FF9800` (orange) |

#### Territory Color Shifts

As work completes in a territory, its base color intensifies:

```typescript
class TerritoryRenderer {
  private baseColor: number
  private activityLevel: number = 0  // 0.0 to 1.0
  private targetActivity: number = 0

  /** Called when tool calls happen in this territory */
  recordActivity(): void {
    this.targetActivity = Math.min(this.targetActivity + 0.02, 1.0)
  }

  /** Called every frame */
  tick(deltaMs: number): void {
    // Smooth approach to target
    this.activityLevel += (this.targetActivity - this.activityLevel) * 0.01

    // Decay over time (30 seconds to lose 50%)
    this.targetActivity *= 0.9999

    // Apply to territory sprite
    const brightness = 0.4 + (this.activityLevel * 0.6)  // 40% base → 100% at full activity
    this.territorySprite.tint = this.adjustBrightness(this.baseColor, brightness)

    // Ambient particle rate scales with activity
    this.ambientEmitter.frequency = this.activityLevel * 0.5 // particles per frame
  }
}
```

Active territories glow with subtle ambient particles — tiny dots of the territory's color drifting upward. A territory that hasn't seen work in 5+ minutes dims back to 40% brightness with no ambient particles.

#### Nearby Unit Reactions

When combat happens near idle units, they respond:

```typescript
class UnitReactionSystem {
  /** Distance within which idle units react to combat */
  static REACTION_RADIUS = 120  // pixels

  onToolCall(activeUnit: UnitSprite, tool: ToolName): void {
    const nearbyIdle = this.getUnitsInRadius(activeUnit.position, UnitReactionSystem.REACTION_RADIUS)
      .filter(u => u.status === 'idle' && u.id !== activeUnit.id)

    for (const unit of nearbyIdle) {
      // Turn to face the action
      const angle = Math.atan2(
        activeUnit.position.y - unit.position.y,
        activeUnit.position.x - unit.position.x
      )
      unit.setFacingAngle(angle, 300) // 300ms turn duration

      // Brief status ring flash (amber, 200ms)
      unit.flashStatusRing(0xFFC107, 200)

      // Small "!" indicator for dramatic events (Task, Bash fail)
      if (tool === 'Task' || (tool === 'Bash' && !this.lastBashSuccess)) {
        unit.showAlertBubble('!', 1000) // 1 second
      }
    }
  }
}
```

---

### 1.6 Victory and Defeat Animations

#### Task Completed Successfully (`stop` event, no errors)

**Duration:** 2000ms

**Sequence:**
1. (0–200ms) Unit strikes a victory pose (arm raised, weapon up)
2. (200–600ms) Completion explosion fires (pattern based on tools used, see 1.5)
3. (600–1000ms) Gold shimmer overlay on the unit sprite (alpha 0→0.3→0, sine wave)
4. (1000–1500ms) `MISSION COMPLETE` floating text rises from unit, plus stats text:
   - `12 files | 847 lines | 2m 14s` (summary of the task's work)
5. (1500–2000ms) Everything fades, unit returns to idle stance. Status ring goes green.

**Sound:** Three-note ascending victory stinger (C5→E5→G5, sine waves, 100ms each, volume 0.25). Followed by a subtle "crowd cheer" texture (filtered noise with bandpass, very low volume 0.05, 500ms).

**Territory effect:** The territory the unit is in gets a brief brightness pulse (0.3→1.0→0.6 over 1 second), then settles at a slightly higher baseline than before the task.

#### Task Failed (`stop` event with errors, or Bash failures dominating)

**Duration:** 1500ms

**Sequence:**
1. (0–200ms) Unit stumbles backward (3px recoil from facing direction)
2. (200–600ms) Red particle burst (12 particles, small, fast-moving outward)
3. (600–1000ms) Unit kneels / defensive crouch sprite
4. (1000–1200ms) Red "X" mark appears at the failure point, pulses twice
5. (1200–1500ms) Unit slowly returns to standing. Status ring blinks red 3 times then goes amber (waiting).

**Sound:** Low dissonant hit (70Hz + 74Hz, sawtooth, 200ms, volume 0.3). Followed by descending two-note motif (G4→D4, 200ms, volume 0.15).

**Territory effect:** Brief red tint on the territory (alpha 0.05, 500ms). No lasting darkening — failures are setbacks, not territory loss.

#### Context Exhausted (Unit "Dies")

When a session's token budget is depleted, the unit can no longer function. This is the most dramatic negative event.

**Duration:** 3000ms

**Sequence:**
1. (0–300ms) Unit's health bar hits zero. Red flash on entire unit sprite.
2. (300–800ms) Unit sprite begins to "dissolve" — pixel-by-pixel disintegration effect. Small squares break off from the sprite edges and drift outward.
3. (800–1500ms) Dissolution accelerates. The unit is visibly fragmenting. Status ring shatters (ring breaks into 4 arc segments that fly outward).
4. (1500–2200ms) Only the unit's core (center 20%) remains, flickering.
5. (2200–2800ms) Final collapse — remaining pixels implode to a point, bright flash.
6. (2800–3000ms) A small gravestone/marker sprite appears where the unit stood. The marker persists for 30 seconds, showing the unit's name and final stats.

**Particle system:** The dissolution uses a custom "disintegrate" effect:
```typescript
class DisintegrationEffect {
  private sourceSprite: PIXI.Sprite
  private pixels: DisintegratePixel[] = []

  /** Sample 100-200 "pixels" from the sprite's bounding box */
  init(): void {
    const bounds = this.sourceSprite.getBounds()
    const sampleCount = 150

    for (let i = 0; i < sampleCount; i++) {
      this.pixels.push({
        x: bounds.x + Math.random() * bounds.width,
        y: bounds.y + Math.random() * bounds.height,
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60 - 20, // Slight upward bias
        size: 2 + Math.random() * 2,
        color: this.sourceSprite.tint,
        alpha: 1.0,
        delay: Math.random() * 1200, // Stagger dissolution
      })
    }
  }

  tick(elapsed: number): void {
    for (const p of this.pixels) {
      if (elapsed < p.delay) continue
      const t = (elapsed - p.delay) / 1500
      p.x += p.vx * 0.016
      p.y += p.vy * 0.016
      p.vy += 30 * 0.016 // Gravity
      p.alpha = Math.max(0, 1 - t)
    }

    // Fade original sprite as pixels detach
    const dissolveProgress = Math.min(elapsed / 2200, 1)
    this.sourceSprite.alpha = 1 - dissolveProgress
  }
}
```

**Sound:** Sustained descending tone (440Hz→110Hz over 2 seconds, saw wave with increasing noise filter, volume 0.2→0.4→0). Final flash gets a sharp transient (noise, 30ms, volume 0.5).

**Territory effect:** Territory darkens in the area where the unit died. A small "scar" (darker patch, 40px radius) persists for 60 seconds. Fog of war creeps in slightly around the loss point.

#### Sub-Agent Completed (`subagent_stop` event)

**Duration:** 1200ms

**Sequence:**
1. (0–200ms) Connection line between parent and sub-agent brightens (pulses white)
2. (200–600ms) Sub-agent performs a mini-victory pose + gold particle burst
3. (600–800ms) Sub-agent sprite begins fading. A "loot package" icon (small golden chest) appears at its position.
4. (800–1000ms) Loot package animates along the connection line from sub-agent to parent unit
5. (1000–1200ms) Loot package reaches parent, small burst of gold particles. Sub-agent sprite fully removed. Connection line fades.

**Sound:** Quick ascending melody (E5→G5, 80ms each, sine, volume 0.15) + coin pickup sound (high click at 3000Hz, 20ms, volume 0.2).

**Data:** The loot package is cosmetic, but the floating text shows what the sub-agent produced: `+skill.md` or `+report.txt` or whatever files were written.

#### Boss Enemy Defeated (Major Threat Resolved)

When a HIGH or CRITICAL threat (from `ae_intel`) is resolved:

**Duration:** 4000ms

**Sequence:**
1. (0–500ms) The enemy sprite (threat) freezes, cracks appear across its surface (animated crack lines growing outward from center)
2. (500–1000ms) Cracks widen, light beams emanate from the cracks (4–6 thin white lines)
3. (1000–1500ms) Enemy sprite SHATTERS — 40+ fragments fly outward with rotation and gravity. Large screen shake (5px, 8 frames, exponential decay).
4. (1500–2500ms) Where the enemy stood, a "cleared" marker appears with green glow expanding outward in a ring (0→80px radius, 1 second). All fog in a 100px radius clears instantly.
5. (2500–3500ms) Green particles rain down over the entire territory (20–30 particles, falling like confetti). Territory brightness increases to maximum.
6. (3500–4000ms) Everything settles. The cleared marker becomes a small trophy icon that persists.

**Sound:** Build-up (rising filtered noise, 500ms) → Shatter (layered hits: kick drum + high crash + glass break, 200ms, volume 0.6 — loudest sound in the game) → Victory fanfare (C major arpeggio: C4→E4→G4→C5, each 150ms, bright saw wave, volume 0.3) → Crowd ambiance fade (500ms).

**Special:** If the camera is not already focused on this territory, it auto-pans to it when the shatter happens (player shouldn't miss this moment). This is the one event that overrides user camera control.

---

## PART 2: ROAD-BUILDING MECHANIC

Roads represent workflow automation maturity. As the user repeatedly executes similar tasks between territories, visible paths form on the map — eventually becoming highways that provide tangible speed benefits.

### 2.1 Road Formation Algorithm

#### Data Model

```typescript
interface RoadSegment {
  /** Unique segment identifier */
  id: string
  /** Origin territory */
  from: string         // territory ID, e.g., 'lead-gen'
  /** Destination territory */
  to: string           // territory ID, e.g., 'fulfillment'
  /** Skill/workflow type that created this path */
  skillType: string    // e.g., 'content:generate-linkedin', 'skills:create', 'research'
  /** Total traversals (incremented each time this exact route is used) */
  traversals: number
  /** Current road tier */
  tier: RoadTier
  /** Last time this road was used (for decay calculation) */
  lastUsed: number     // Unix timestamp ms
  /** Creation timestamp */
  createdAt: number
  /** Waypoints for rendering (world-space coordinates) */
  waypoints: PIXI.Point[]
  /** Visual state */
  renderState: RoadRenderState
}

type RoadTier = 'none' | 'trail' | 'dirt' | 'paved' | 'highway'

interface RoadRenderState {
  /** Current visual width (interpolated between tiers) */
  width: number
  /** Current opacity */
  alpha: number
  /** Glow intensity */
  glowIntensity: number
  /** Traffic particle rate (particles per second) */
  trafficRate: number
  /** Color */
  color: number
}
```

#### What Constitutes a "Path"

A path is defined by the tuple: **(origin_territory, destination_territory, skill_category)**

- **Origin territory:** Where the unit was when the task started (from `ManagedSession.territory`)
- **Destination territory:** Where the output landed. Determined by:
  - File write path → map to territory by directory (`domains/lead-gen/` → `lead-gen`)
  - Slack message → `sales` or `support` depending on channel
  - Sub-agent spawn → wherever the sub-agent is deployed
  - If origin == destination, it's an "internal road" (loop within a territory)
- **Skill category:** Grouped by the type of work, not individual tool calls:
  - `content` — Write-heavy tasks producing articles, posts, emails
  - `build` — Mixed tool tasks producing skills, code, infrastructure
  - `research` — Read/WebFetch-heavy tasks producing reports
  - `support` — Read/Edit tasks resolving tickets or fixing bugs
  - `sales` — Tasks involving CRM, proposals, call prep
  - `ops` — Bash-heavy tasks (deploys, scripts, infrastructure)

**Path recording logic:**
```typescript
class PathTracker {
  /** Called when a task completes (stop event) */
  recordTraversal(session: ManagedSession, toolHistory: ToolCall[]): void {
    const origin = session.territory
    const destinations = this.inferDestinations(toolHistory)
    const skillType = this.classifySkillType(toolHistory)

    for (const dest of destinations) {
      const key = `${origin}::${dest}::${skillType}`
      const existing = this.roads.get(key)

      if (existing) {
        existing.traversals++
        existing.lastUsed = Date.now()
        existing.tier = this.calculateTier(existing.traversals)
      } else {
        this.roads.set(key, {
          id: crypto.randomUUID(),
          from: origin,
          to: dest,
          skillType,
          traversals: 1,
          tier: 'trail',
          lastUsed: Date.now(),
          createdAt: Date.now(),
          waypoints: this.generateWaypoints(origin, dest),
          renderState: TRAIL_RENDER_STATE,
        })
      }
    }
  }

  private classifySkillType(tools: ToolCall[]): string {
    const counts = { Write: 0, Read: 0, Edit: 0, Bash: 0, WebFetch: 0, Grep: 0, Task: 0 }
    for (const t of tools) counts[t.tool] = (counts[t.tool] || 0) + 1

    if (counts.Write > counts.Edit * 2) return 'content'
    if (counts.Edit > 5 && counts.Bash > 0) return 'build'
    if (counts.WebFetch > 1 || (counts.Read > 5 && counts.Grep > 2)) return 'research'
    if (counts.Bash > counts.Write) return 'ops'
    return 'general'
  }
}
```

#### Progression Tiers

| Tier | Traversals Required | Visual Width | Particle Rate | Speed Bonus | Color |
|------|--------------------:|-------------:|--------------:|------------:|-------|
| none | 0 | 0px | 0/s | 0% | — |
| trail | 1–4 | 1px | 0/s | +10% | `#5D4037` (brown, 40% alpha) |
| dirt | 5–14 | 2px | 0.5/s | +25% | `#795548` (brown, 60% alpha) |
| paved | 15–39 | 3px | 2/s | +50% | `#9E9E9E` (gray, 80% alpha) |
| highway | 40+ | 5px | 5/s | +100% | `#FFE082` (gold, 100% alpha) |

The transition between tiers is not instant — it's a smooth visual interpolation over 2 seconds:

```typescript
class RoadRenderer {
  /** Smoothly transition between tier render states */
  transitionTier(road: RoadSegment, newTier: RoadTier): void {
    const target = TIER_RENDER_STATES[newTier]
    const current = road.renderState

    // Tween over 2 seconds
    gsap.to(current, {
      width: target.width,
      alpha: target.alpha,
      glowIntensity: target.glowIntensity,
      trafficRate: target.trafficRate,
      color: target.color,
      duration: 2,
      ease: 'power2.inOut',
      onUpdate: () => this.redrawRoad(road),
    })

    // Celebration effect on tier-up
    this.emitTierUpParticles(road)
  }

  /** Particles along the road when tier increases */
  private emitTierUpParticles(road: RoadSegment): void {
    const count = road.tier === 'highway' ? 40 : road.tier === 'paved' ? 20 : 10
    for (const wp of road.waypoints) {
      this.particlePool.emit('road_sparkle', wp, {
        count: count / road.waypoints.length,
        color: TIER_RENDER_STATES[road.tier].color,
        lifetime: 1000,
        spread: 10,
      })
    }
  }
}
```

#### Decay

Roads degrade if unused. This prevents the map from becoming a permanent highway spaghetti.

```typescript
interface DecayConfig {
  /** Hours of inactivity before decay starts */
  gracePeriodHours: number     // 72 hours (3 days)

  /** Traversals lost per hour after grace period */
  decayRatePerHour: number     // 0.5 traversals/hour

  /** Minimum traversals (roads never fully disappear once created) */
  minimumTraversals: number    // 1 (trails persist forever once established)

  /** Highway bonus: highways decay at 50% rate */
  highwayDecayMultiplier: number  // 0.5
}

class RoadDecaySystem {
  /** Run every hour */
  tick(): void {
    const now = Date.now()

    for (const road of this.roads.values()) {
      const hoursSinceUse = (now - road.lastUsed) / (1000 * 60 * 60)

      if (hoursSinceUse <= this.config.gracePeriodHours) continue

      const decayHours = hoursSinceUse - this.config.gracePeriodHours
      const decayMult = road.tier === 'highway' ? this.config.highwayDecayMultiplier : 1
      const traversalsLost = decayHours * this.config.decayRatePerHour * decayMult

      road.traversals = Math.max(
        this.config.minimumTraversals,
        road.traversals - traversalsLost
      )

      const newTier = this.calculateTier(road.traversals)
      if (newTier !== road.tier) {
        road.tier = newTier
        this.roadRenderer.transitionTier(road, newTier)
      }
    }
  }
}
```

Decay timeline example:
- Day 0: Highway (45 traversals)
- Day 3: Grace period ends (still highway, 45 traversals)
- Day 5: 24 hours of decay at 0.25/hour (highway rate) = 39 traversals → downgrades to paved
- Day 9: 72 more hours at 0.5/hour = 3 traversals → downgrades to trail
- Day 11+: Stays at 1 traversal (minimum) = permanent trail

#### PixiJS Road Rendering

Roads are drawn as PIXI.Graphics paths connecting territory centers via waypoints:

```typescript
class RoadGraphics {
  private graphics: PIXI.Graphics
  private glowGraphics: PIXI.Graphics
  private trafficEmitter: ParticleEmitter

  draw(road: RoadSegment): void {
    const { waypoints, renderState } = road

    // Main road line
    this.graphics.clear()
    this.graphics.moveTo(waypoints[0].x, waypoints[0].y)
    for (let i = 1; i < waypoints.length; i++) {
      // Use bezier curves through waypoints for organic feel
      const prev = waypoints[i - 1]
      const curr = waypoints[i]
      const cp = this.controlPoint(prev, curr)
      this.graphics.quadraticCurveTo(cp.x, cp.y, curr.x, curr.y)
    }
    this.graphics.stroke({
      color: renderState.color,
      width: renderState.width,
      alpha: renderState.alpha,
      cap: 'round',
      join: 'round',
    })

    // Glow layer (wider, lower alpha, blurred)
    if (renderState.glowIntensity > 0) {
      this.glowGraphics.clear()
      // Same path, but wider and with blur filter
      this.glowGraphics.stroke({
        color: renderState.color,
        width: renderState.width * 3,
        alpha: renderState.glowIntensity * 0.2,
        cap: 'round',
      })
    }

    // Traffic particles (dots moving along the road path)
    this.trafficEmitter.frequency = renderState.trafficRate
  }

  /** Generate organic control point for bezier curve */
  private controlPoint(a: PIXI.Point, b: PIXI.Point): PIXI.Point {
    const mid = new PIXI.Point((a.x + b.x) / 2, (a.y + b.y) / 2)
    const perp = new PIXI.Point(-(b.y - a.y) * 0.15, (b.x - a.x) * 0.15)
    return new PIXI.Point(mid.x + perp.x, mid.y + perp.y)
  }
}
```

**Traffic particles:** Small dots (2px, road color) that move along the road path from origin to destination. They follow the bezier curve path at a constant speed. Higher tier roads have more particles and they move faster. This creates the impression of actual traffic/supply flow.

```typescript
class TrafficParticle {
  private t: number = 0          // 0.0 to 1.0 along the road path
  private speed: number          // road tier dependent

  constructor(road: RoadSegment) {
    this.speed = {
      trail: 0,                  // no traffic on trails
      dirt: 0.002,               // slow
      paved: 0.004,              // moderate
      highway: 0.008,            // fast
    }[road.tier] ?? 0
  }

  tick(): PIXI.Point | null {
    this.t += this.speed
    if (this.t > 1.0) return null  // arrived, remove
    return this.getPositionOnPath(this.t)
  }
}
```

---

### 2.2 Speed Modifiers

Speed in Agent Empires is metaphorical — it represents how quickly a unit becomes productive after being assigned to a territory. In practical terms: the delay before Claude starts working, the visual speed of the unit moving between territories, and the visual "efficiency" of combat animations.

#### Base Terrain Speed

Each territory type has underlying terrain that affects base movement speed:

| Territory | Terrain Type | Base Speed Multiplier | Rationale |
|-----------|-------------|----------------------|-----------|
| HQ (Home) | Open Field | 1.0x | Familiar ground, no obstacles |
| Lead-Gen | Forest | 0.7x | Complex landscape, many channels to navigate |
| Sales | Open Field | 1.0x | Direct engagement, clear sight lines |
| Fulfillment | Plains | 0.9x | Mostly clear but some process overhead |
| Support | Swamp | 0.5x | Slow, messy, unpredictable terrain |
| Retention | Hills | 0.6x | Uphill battle, relationship maintenance |
| Content Base | Forest | 0.7x | Research-dense, many sources to navigate |

#### Road Speed Bonus

Road bonuses stack multiplicatively with base terrain speed:

| Road Tier | Speed Bonus | Effective Speed in Swamp (0.5x base) | Effective Speed in Open (1.0x base) |
|-----------|------------|--------------------------------------|-------------------------------------|
| none | +0% | 0.50x | 1.00x |
| trail | +10% | 0.55x | 1.10x |
| dirt | +25% | 0.63x | 1.25x |
| paved | +50% | 0.75x | 1.50x |
| highway | +100% | 1.00x | 2.00x |

A highway through swamp brings you back to baseline (1.0x). A highway through open field doubles your speed. This means building roads through difficult terrain is particularly valuable.

#### Unit Type Speed Modifiers

| Unit Type | Speed Modifier | Rationale |
|-----------|---------------|-----------|
| Scout | 1.5x | Fast reconnaissance, light equipment |
| Writer | 1.0x | Standard mobility |
| Commander | 0.9x | Slightly slower, carrying command gear |
| Lieutenant | 1.0x | Standard mobility |
| Engineer | 0.7x | Slow, heavy equipment (but builds roads faster) |
| Operative | 1.2x | Quick deployment, mission-focused |
| Medic | 1.1x | Rapid response |
| Diplomat | 0.8x | Deliberate pace, relationship-focused |

#### Speed → Visual Translation

```typescript
interface SpeedConfig {
  /** Base unit movement speed in pixels/second */
  baseMovementSpeed: number    // 200 px/s

  /** How speed translates to movement animation */
  calculateMovementDuration(
    origin: PIXI.Point,
    destination: PIXI.Point,
    unitType: UnitType,
    roadTier: RoadTier,
    terrainType: TerrainType
  ): number {
    const distance = Math.sqrt(
      Math.pow(destination.x - origin.x, 2) +
      Math.pow(destination.y - origin.y, 2)
    )
    const terrainMult = TERRAIN_SPEED[terrainType]
    const roadMult = 1 + ROAD_SPEED_BONUS[roadTier]
    const unitMult = UNIT_SPEED[unitType]
    const effectiveSpeed = this.baseMovementSpeed * terrainMult * roadMult * unitMult

    return (distance / effectiveSpeed) * 1000  // ms
  }

  /** Minimum travel time (no instant teleportation even on highways) */
  minimumTravelMs: number    // 300ms

  /** Maximum travel time (cap to prevent boring waits) */
  maximumTravelMs: number    // 5000ms
}
```

In practice, territory centers are 400–800px apart. A standard unit on open terrain with no road traverses at 200px/s = 2–4 second travel animation. With a highway, that halves to 1–2 seconds. A scout on a highway zooms at `200 * 1.0 * 2.0 * 1.5 = 600px/s` = ~0.7–1.3 seconds (clamped to 0.3s minimum).

**Speed also affects animation playback:** Units on highways play combat animations 10% faster (they're in the groove, efficient). Units in swamp without roads play animations 10% slower (labored). This is subtle but contributes to the feel that roads = efficiency.

#### Road Crossing Terrain

Yes, roads can cross any terrain type. The visual changes per terrain:

| Road Through | Visual Adaptation |
|-------------|-------------------|
| Open Field | Standard flat road sprite |
| Forest | Road clears trees along path (2-tile-wide clearing) |
| Swamp | Elevated boardwalk/causeway (road rendered slightly above terrain) |
| Hills | Switchback curves (waypoints zigzag) |
| Mountains | Tunnel entrance/exit sprites at mountain edges |
| River | Bridge sprite at crossing point |

These adaptations are purely visual — the speed bonus is the same regardless. But they add tremendous visual richness as the map develops.

---

### 2.3 Infrastructure as Strategy

#### Intentional Road Building

Users cannot directly "build" a road. Roads form organically from work. However, users can intentionally trigger road formation by:

1. **Running repeated tasks on the same route:** Assigning a Writer to do 5 LinkedIn posts in a row (Lead-Gen→Content Base route) builds that road fast.
2. **Using the `/patrol` skill:** Setting a unit to patrol between two territories on a schedule — each patrol cycle counts as a traversal.
3. **Deploying an Engineer:** Engineers have a passive ability: their traversals count double for road progression. A dedicated Engineer unit running between Sales and Fulfillment builds that highway 2x faster.

This creates a strategic meta-game: "Which routes should I invest in automating?"

#### Supply Lines (Token Economy)

Units on higher-tier roads consume tokens more efficiently:

| Road Tier | Token Efficiency Bonus |
|-----------|----------------------|
| none | 0% (base rate) |
| trail | +2% |
| dirt | +5% |
| paved | +10% |
| highway | +20% |

This is cosmetic in the current version (Claude subscriptions don't have per-token costs), but it maps to the health bar visualization: units on highways show their health bar depleting slightly slower, reinforcing the "infrastructure = efficiency" feeling.

When the system moves to API-based billing, this becomes real: optimized workflows (highways) genuinely cost fewer tokens because the skills are refined, prompts are tighter, and fewer retries are needed.

#### Road Visualization Tiers (Detailed)

**Trail (1–4 traversals):**
- 1px dashed line, brown (#5D4037), 40% alpha
- Dash pattern: 4px on, 8px off
- No glow, no traffic
- Subtle — you have to look for it

**Dirt Road (5–14 traversals):**
- 2px solid line, brown (#795548), 60% alpha
- Slight texture: very subtle noise pattern along the path
- 0.5 traffic particles/second (tiny brown dots)
- No glow

**Paved Road (15–39 traversals):**
- 3px solid line, gray (#9E9E9E), 80% alpha
- Clean edges, slight bevel effect (1px lighter line on top edge)
- 2 traffic particles/second (gray dots moving along path)
- Subtle glow: 6px wide, 10% alpha, same color
- Lane markings: thin dashed white center line (cosmetic detail)

**Highway (40+ traversals):**
- 5px solid line, gold (#FFE082), 100% alpha
- Bright glow: 12px wide, 20% alpha, golden pulse (sine wave, 2s cycle)
- 5 traffic particles/second (gold dots, 3px, faster movement)
- Dual lane markings (white dashed lines)
- Edge lights: tiny bright dots every 20px along both sides (like highway reflectors)
- Ambient sound: when camera is near a highway, subtle rushing/humming sound (80Hz, volume 0.02)

#### Network Effects

When roads connect to form a network (3+ territories linked by paved+ roads), a visual "network" overlay activates:

```typescript
class RoadNetwork {
  /** Detect connected road networks */
  findNetworks(): RoadNetwork[] {
    // Graph traversal: find all connected territories via paved+ roads
    const networks: Set<string>[] = []
    // Union-find on territory connections where road.tier >= 'paved'
    return networks.filter(n => n.size >= 3)
  }

  /** Visual treatment for network territories */
  applyNetworkEffect(territories: string[]): void {
    for (const t of territories) {
      // Subtle "connected" indicator: small icon in territory corner
      // showing number of connected territories
      this.addNetworkBadge(t, territories.length)

      // Territories in a network get a +5% ambient brightness bonus
      this.territory.networkBonus = 0.05
    }

    // Network-wide fast travel: units can move between ANY two
    // network territories at highway speed, even if the direct
    // road between them is only paved. The network IS the highway.
    this.enableFastTravel(territories)
  }
}
```

**Fast travel visualization:** When a unit moves between two network territories that don't have a direct highway, the unit briefly enters a "network transit" animation: unit shrinks to 50%, zips along the road network path (connecting roads light up in sequence as the unit passes through intermediate territories), then re-enlarges at the destination. This takes 500ms regardless of distance — the network advantage.

#### Infrastructure Score

A visible metric in the Resource Bar showing overall automation maturity:

```typescript
class InfrastructureScore {
  calculate(): { score: number, grade: string, breakdown: Record<string, number> } {
    const roads = this.roadTracker.getAllRoads()
    const territories = this.getTerritories()

    // Possible connections: every pair of territories + self-loops
    const possibleRoutes = territories.length * (territories.length - 1) + territories.length
    const existingRoutes = roads.length

    // Coverage: what % of possible routes have at least a trail
    const coverage = existingRoutes / possibleRoutes

    // Quality: weighted average of road tiers
    const tierWeights = { trail: 1, dirt: 3, paved: 7, highway: 15 }
    const qualitySum = roads.reduce((sum, r) => sum + (tierWeights[r.tier] || 0), 0)
    const maxQuality = possibleRoutes * tierWeights.highway
    const quality = qualitySum / maxQuality

    // Network bonus: connected networks boost score
    const networks = this.findNetworks()
    const networkBonus = networks.reduce((sum, n) => sum + n.size * 0.02, 0)

    const score = Math.min(1.0, (coverage * 0.3 + quality * 0.5 + networkBonus * 0.2))

    const grade = score >= 0.8 ? 'S' : score >= 0.6 ? 'A' : score >= 0.4 ? 'B' :
                  score >= 0.2 ? 'C' : score >= 0.1 ? 'D' : 'F'

    return {
      score: Math.round(score * 100),
      grade,
      breakdown: { coverage: Math.round(coverage * 100), quality: Math.round(quality * 100) }
    }
  }
}
```

**HUD display:** `INFRA: 47% [B]` in the resource bar. Clicking it expands to show the breakdown and a minimap highlight of all roads.

---

### 2.4 Terrain Generation

#### Territory-to-Terrain Mapping

Terrain is not random. It's assigned based on the business domain's characteristics:

```typescript
const TERRITORY_TERRAIN: Record<string, TerrainConfig> = {
  'hq': {
    baseType: 'plains',
    features: ['command-post', 'barracks'],
    color: 0x4A5568,           // Slate
    description: 'Home base — flat, organized, familiar'
  },
  'lead-gen': {
    baseType: 'forest',
    features: ['watchtower', 'trails', 'clearings'],
    color: 0x2D5F2D,           // Forest green
    description: 'Dense landscape — many channels, hard to navigate without paths'
  },
  'sales': {
    baseType: 'plains',
    features: ['arena', 'training-ground'],
    color: 0x1565C0,           // Deep blue
    description: 'Open field — clear engagement, direct confrontation'
  },
  'fulfillment': {
    baseType: 'plains',
    features: ['forge', 'workshop', 'warehouse'],
    color: 0xE65100,           // Deep orange
    description: 'Productive plains — factories and workshops'
  },
  'support': {
    baseType: 'swamp',
    features: ['triage-tent', 'watchtower'],
    color: 0x4A148C,           // Deep purple
    description: 'Treacherous swamp — unpredictable, draining, but clearable'
  },
  'retention': {
    baseType: 'hills',
    features: ['fortress', 'garden'],
    color: 0x00695C,           // Teal
    description: 'Hilly terrain — relationships are uphill battles worth fighting'
  },
  'content-base': {
    baseType: 'forest',
    features: ['library', 'scriptorium'],
    color: 0x33691E,           // Light forest green
    description: 'Research forest — deep knowledge, many sources to explore'
  },
}
```

#### Dynamic Terrain

Terrain changes over time based on business activity. This is the deepest satisfaction loop in the game.

**Support Swamp → Clearing:**
- Initial state: Full swamp (0.5x speed, murky green-purple texture, fog particles)
- As support tickets are resolved, the swamp "drains" in patches
- Each resolved HIGH/CRITICAL ticket clears a 40px radius around the resolution point
- After 80% of active threats are resolved: terrain upgrades to "drained marshland" (0.7x speed, lighter texture)
- After 95% resolution over 7 days: terrain upgrades to "solid ground" (0.9x speed, clean texture)
- If tickets pile up again: swamp slowly returns (1% regression per unresolved ticket per day)

**Lead-Gen Forest → Cultivated Forest:**
- Initial state: Dense forest (0.7x speed, dark green, limited visibility)
- Each successful content campaign clears a "path" through the forest
- After 10 campaigns: forest becomes "cultivated" (0.85x speed, lighter green, clearings visible)
- After 30 campaigns: "park-like forest" (0.95x speed, beautiful canopy, dappled light effects)

**Visual implementation:**
```typescript
class DynamicTerrain {
  private clearingProgress: number = 0  // 0.0 to 1.0

  /** Called when work resolves in this territory */
  recordClearing(amount: number): void {
    this.clearingProgress = Math.min(1.0, this.clearingProgress + amount)
    this.updateTerrainTexture()
  }

  private updateTerrainTexture(): void {
    // Blend between terrain states based on progress
    // 0.0 = full swamp/forest texture
    // 0.5 = mixed (patchy clearing)
    // 1.0 = fully cleared/cultivated

    // Territory sprite uses a multi-layer approach:
    // Layer 0: Base terrain texture (always visible)
    // Layer 1: "Improved" terrain texture (fades in with progress)
    // Layer 2: Feature sprites (buildings, landmarks) appear at thresholds

    this.improvedLayer.alpha = this.clearingProgress
    this.baseLayer.alpha = 1 - (this.clearingProgress * 0.6) // Never fully invisible
  }
}
```

#### Terrain Modifiers Beyond Speed

| Terrain Type | Speed | Fog Accumulation Rate | Combat Animation Speed | Ambient Sound |
|-------------|-------|----------------------|----------------------|---------------|
| Plains | 1.0x | Normal | Normal | Wind, grass |
| Forest | 0.7x | 1.5x faster fog buildup | 0.95x (slightly slower) | Birds, rustling |
| Swamp | 0.5x | 2x faster fog buildup | 0.85x (sluggish) | Bubbling, insects |
| Hills | 0.6x | Normal | Normal | Wind, echo |
| Mountains | 0.4x | 2x faster fog buildup | 0.8x (heavy) | Howling wind |
| River (crossing) | 0.3x (without bridge) | N/A | 0.7x | Water rushing |

**Fog accumulation:** Difficult terrain goes dark faster when not monitored. Swamp (support) and mountains need more frequent scout patrols to stay visible. This naturally creates a cadence: you need to check on support more often than sales.

**Combat animation speed:** Units fighting in swamp look like they're wading through mud — all their animations play at 85% speed. On plains, everything is crisp. This is a 15% timing modifier applied to all animation durations. Subtle but it changes the feel of working in different domains.

#### Procedural Terrain Features

Each territory has procedurally placed features that create visual interest and natural chokepoints:

```typescript
interface TerrainFeature {
  type: 'hill' | 'valley' | 'river' | 'bridge' | 'ruin' | 'outpost' | 'landmark'
  position: PIXI.Point
  radius: number               // Visual footprint
  speedModifier: number        // Local speed adjustment (-0.2 to +0.2)
  sprite: string               // Sprite sheet key
  interactable: boolean        // Can units interact with this?
}

function generateFeatures(territory: TerrainConfig): TerrainFeature[] {
  const features: TerrainFeature[] = []
  const rng = seedRandom(territory.id)  // Deterministic per territory

  // Rivers: 1 per forest/swamp territory, creating natural chokepoints
  if (['forest', 'swamp'].includes(territory.baseType)) {
    features.push({
      type: 'river',
      position: randomPointInBounds(territory.bounds, rng),
      radius: 30,
      speedModifier: -0.3,
      sprite: 'terrain/river-segment',
      interactable: false,
    })
    // Bridge spawns on the river once a road crosses it
    // (deferred — bridge appears when road intersects river)
  }

  // Hills: 2-3 per hills territory, creating zigzag paths
  if (territory.baseType === 'hills') {
    const hillCount = 2 + Math.floor(rng() * 2)
    for (let i = 0; i < hillCount; i++) {
      features.push({
        type: 'hill',
        position: randomPointInBounds(territory.bounds, rng),
        radius: 25,
        speedModifier: -0.15,
        sprite: 'terrain/hill',
        interactable: false,
      })
    }
  }

  // Landmarks: 1 per territory (the territory's "main building")
  features.push({
    type: 'landmark',
    position: centerOf(territory.bounds),
    radius: 20,
    speedModifier: 0,
    sprite: `buildings/${territory.features[0]}`,
    interactable: true,
  })

  return features
}
```

**Chokepoints:** Rivers and hill clusters create natural bottlenecks where roads become especially valuable. A highway through a mountain pass or bridge across a river feels genuinely strategic because without it, that crossing is painful. The player naturally prioritizes automating routes through difficult terrain.

---

### 2.5 The Map Over Time

This is the emotional arc. The progression from chaos to civilization is the core satisfaction loop.

#### Day 1 — Terra Incognita

**Visual state:**
- 80% of the map is fogged (dark, translucent overlay with subtle noise animation)
- Only HQ territory is clearly visible (where the user starts)
- No roads exist
- 1–2 units deployed (Commander at HQ, maybe one Operative)
- Terrain features barely visible through fog (silhouettes only)
- Enemy threats are invisible (they exist but fog hides them)
- The minimap is almost entirely dark with one bright spot (HQ)

**Feeling:** Isolation. The unknown. "Where do I even start?" But HQ is warm and well-lit — a safe haven. The first unit deployed into the fog feels brave.

**What the player does:** Sends first unit to a nearby territory. Fog begins clearing along the path. The first trail appears — faint, barely visible, but it's THEIRS.

#### Week 1 — Beachheads

**Visual state:**
- 40–50% fog cleared
- 2–3 territories have active units
- Trails crisscross between HQ and 2 adjacent territories
- 1–2 trails have upgraded to dirt roads (the most-used routes)
- First enemy threats visible (support tickets, aging leads) — red markers on the map
- Some terrain features revealed (the forge in Fulfillment, watchtower in Lead-Gen)
- First "construction site" visible (if building a skill)
- Minimap shows cleared areas with colored dots for units

**Feeling:** Expansion. Each cleared territory feels earned. The dirt roads feel like progress — "I can see my workflow becoming efficient." First enemy defeated feels like a real victory.

**What the player does:** Starts deliberately running repeated tasks to strengthen key routes. Deploys Scouts to clear fog faster. First "defensive" action against support threats.

#### Month 1 — Established Empire

**Visual state:**
- 80–90% fog cleared
- All core territories have been visited multiple times
- Visible road network: 3–5 paved roads connecting key territories, 8–10 dirt roads, dozens of trails
- First highway forming (the most-used route, probably HQ→Content→Lead-Gen)
- The highway GLOWS — golden path visible across the map. Traffic particles flowing. It's beautiful.
- Territory colors are vibrant (high activity levels)
- 3–5 buildings/landmarks visible per territory
- Enemy threats contained to edges — occasional new ones spawn but get handled quickly
- The construction sites have resolved into permanent buildings (skills built)
- Minimap shows a real civilization: bright territories, connecting roads, unit positions

**Infrastructure Score:** 35–45% [C+ or B-]

**Feeling:** Mastery building. The map tells a story of growth. The highway makes the player feel POWERFUL — watching a unit zip along it is visceral. The difference between highway speed and trudging through unroaded swamp is stark. "I built this."

**What the player does:** Strategic road investment. "I should build a highway through Support because it's still swampy." Deploys Engineers to accelerate key routes. Starts thinking about network effects.

#### Month 6 — The Empire

**Visual state:**
- 95–100% fog cleared (only the deepest edges have any remaining)
- Dense highway network: 8–12 highways, the rest paved
- The map is ALIVE: traffic particles flowing on every highway, ambient particles in every territory, units moving efficiently between fronts
- Territories are fully developed: each has 5–8 visible buildings, clear landmarks, cultivated terrain
- The support swamp has been drained to marshland (if tickets are managed)
- Lead-gen forest is cultivated with clear paths
- Multiple road networks with fast-travel enabled
- Enemy threats are rare and get swarmed by multiple units immediately
- Trophy icons dot the map where major threats were defeated
- The minimap looks like a satellite photo of a developed nation

**Infrastructure Score:** 70–85% [A or S]

**Feeling:** This is the peak dopamine. The map IS the player's business. Every road, every building, every cleared territory represents real work done. The contrast with Day 1 is staggering. The player can zoom all the way out and see their empire — a glowing network of highways, busy territories, and well-defended borders. They built this. Claude built this. Together.

**What the player does:** Optimizes. Finds the few remaining trails and builds them up. Tackles the hardest terrain. Deploys units to the frontier (new business domains, new product lines). The empire expands outward.

---

### 2.6 Persistence

Road data and terrain state must persist across sessions.

```typescript
// Saved to Supabase (new table)
interface RoadPersistence {
  table: 'ae_roads'
  schema: {
    id: 'UUID PRIMARY KEY',
    from_territory: 'TEXT NOT NULL',
    to_territory: 'TEXT NOT NULL',
    skill_type: 'TEXT NOT NULL',
    traversals: 'INTEGER DEFAULT 1',
    tier: 'TEXT DEFAULT trail',
    last_used: 'TIMESTAMPTZ DEFAULT now()',
    created_at: 'TIMESTAMPTZ DEFAULT now()',
    waypoints: 'JSONB',  // Array of {x, y} points
  }
}

// Also saved to Supabase
interface TerrainPersistence {
  table: 'ae_terrain_state'
  schema: {
    id: 'UUID PRIMARY KEY',
    territory_id: 'TEXT NOT NULL UNIQUE',
    clearing_progress: 'REAL DEFAULT 0',
    features_revealed: 'JSONB',  // Array of feature IDs
    terrain_type_override: 'TEXT',  // null = use default
    last_updated: 'TIMESTAMPTZ DEFAULT now()',
  }
}
```

**SQL:**
```sql
CREATE TABLE ae_roads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_territory TEXT NOT NULL,
  to_territory TEXT NOT NULL,
  skill_type TEXT NOT NULL,
  traversals INTEGER DEFAULT 1,
  tier TEXT DEFAULT 'trail',
  last_used TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  waypoints JSONB,
  UNIQUE(from_territory, to_territory, skill_type)
);

CREATE TABLE ae_terrain_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id TEXT NOT NULL UNIQUE,
  clearing_progress REAL DEFAULT 0,
  features_revealed JSONB DEFAULT '[]'::jsonb,
  terrain_type_override TEXT,
  last_updated TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_ae_roads_territories ON ae_roads(from_territory, to_territory);
CREATE INDEX idx_ae_roads_last_used ON ae_roads(last_used);
```

---

## APPENDIX A: Particle Pool Implementation

All particle effects share a single object pool to prevent garbage collection spikes:

```typescript
class ParticlePool {
  private pool: PIXI.Sprite[] = []
  private active: Set<PIXI.Sprite> = new Set()
  private container: PIXI.Container

  /** Pre-allocate 500 particle sprites at startup */
  constructor(stage: PIXI.Container) {
    this.container = new PIXI.Container()
    this.container.zIndex = 1000  // Always on top
    stage.addChild(this.container)

    for (let i = 0; i < 500; i++) {
      const sprite = new PIXI.Sprite(PIXI.Texture.WHITE)
      sprite.visible = false
      sprite.anchor.set(0.5)
      this.container.addChild(sprite)
      this.pool.push(sprite)
    }
  }

  acquire(): PIXI.Sprite | null {
    const sprite = this.pool.pop()
    if (!sprite) return null  // Pool exhausted — drop the particle silently
    sprite.visible = true
    this.active.add(sprite)
    return sprite
  }

  release(sprite: PIXI.Sprite): void {
    sprite.visible = false
    sprite.alpha = 1
    sprite.scale.set(1)
    sprite.rotation = 0
    sprite.tint = 0xFFFFFF
    this.active.delete(sprite)
    this.pool.push(sprite)
  }

  /** Performance budget: never exceed 200 active particles */
  get available(): number {
    return Math.min(this.pool.length, 200 - this.active.size)
  }
}
```

## APPENDIX B: Animation Timing Reference

Quick reference for all animation durations (at 1.0x speed, no combo modifier):

| Tool | Windup | Impact | Follow-through | Total |
|------|--------|--------|----------------|-------|
| Read | 83ms | 250ms | 200ms | 533ms |
| Write (single) | 133ms | 267ms | 400ms | 800ms |
| Write (sustained) | 133ms | open-ended | 200ms | variable |
| Edit (single) | 50ms | 117ms | 233ms | 400ms |
| Edit (bulk) | 100ms | 167ms | 233ms | 500ms |
| Bash | 100ms | 250ms | 250ms | 600ms |
| Bash (long-running) | 100ms | open-ended | 300ms | variable |
| Grep | 67ms | 333ms | 267ms | 667ms |
| Glob | 67ms | 200ms | 200ms | 467ms |
| WebFetch | 133ms | 467ms | 400ms | 1000ms |
| WebSearch | 133ms | 467ms | 400ms | 1000ms |
| Task (spawn) | 400ms | 500ms | 600ms | 1500ms |
| MCP (generic) | 100ms | 333ms | 233ms | 667ms |

## APPENDIX C: Sound Frequency Reference

All synthesized via Tone.js (no audio files required):

| Sound | Waveform | Frequency | Duration | Volume |
|-------|----------|-----------|----------|--------|
| Read: page turn | Noise (bandpass 2-4kHz) | — | 80ms | 0.1 |
| Read: absorption | Sine | 800→1200Hz sweep | 200ms | 0.15 |
| Write: charge | Sawtooth | 200→600Hz | 133ms | 0.2 |
| Write: launch | Noise burst | — | 50ms | 0.4 |
| Write: impact | Sine + noise | 80Hz + sparkle | 100ms | 0.3 |
| Edit: aim | Sine | 2000Hz | 50ms | 0.1 |
| Edit: fire | Noise + sine | — | 30ms | 0.3 |
| Edit: glass break | Filtered noise | — | 80ms | 0.2 |
| Bash: rumble | Sine | 60Hz | 100ms | 0.2 |
| Bash: kick | Sine sweep | 150→40Hz | 80ms | 0.5 |
| Bash: success | Chord (C maj) | 262+330+392Hz | 150ms | 0.2 |
| Bash: fail | Dissonant | 73+78Hz | 200ms | 0.3 |
| Grep: sonar | Sine + reverb | 1500Hz | 100ms+400ms tail | 0.2 |
| Glob: radar | Sine | 2000Hz | 40ms | 0.15 |
| WebFetch: whistle | Sine sweep | 400→1200Hz | 133ms | 0.15 |
| WebFetch: whoosh | Bandpass noise | 800-2000Hz | 100ms | 0.3 |
| Task: summon | Sine | C3→C4 | 200ms | 0.2 |
| Task: portal | Reverse noise | — | 200ms | 0.3 |
| Task: emergence | Sawtooth | C4 | 100ms | 0.25 |
| Combo (5+): fire crackle | Noise (low) | — | Continuous | 0.05 |
| Victory: stinger | Sine (3 notes) | C5→E5→G5 | 300ms | 0.25 |
| Defeat: hit | Sawtooth | 70+74Hz | 200ms | 0.3 |
| Boss shatter | Layered | Kick+crash+glass | 200ms | 0.6 |
| Road tier-up | Sine arpeggio | Service dependent | 400ms | 0.15 |
| Highway ambient | Sine | 80Hz | Continuous | 0.02 |
