# Agent Empires — Live Agent Visibility System

## PRD 03: How Agents Appear, Move, and Act on the Battlefield

> ### Status Summary (2026-03-10)
>
> **Assessment:** Session tracking, unit rendering, sub-agent spawning, territory detection, and the event-to-animation pipeline are all shipped. Commander/prime session distinction exists but is not formalized per spec.
>
> - [x] **Session tracking (tmux management)** — `server/index.ts` (ManagedSession, tmux send/validate)
> - [x] **UnitRenderer (agent sprites on map)** — `src/renderer/UnitRenderer.ts`
> - [x] **SubagentManager (Task tool spawn visualization)** — `src/entities/SubagentManager.ts`
> - [x] **Territory detection (file-path-to-territory mapping)** — `server/TerritoryDetector.ts`
> - [x] **Movement between territories** — `src/game/MovementManager.ts`
> - [x] **CombatAnimator (tool-use animations)** — `src/game/CombatAnimator.ts`
> - [x] **Connection line renderer** — `src/renderer/ConnectionLineRenderer.ts`
> - [ ] **Prime/Commander session formal designation (PrimeSessionResolver)** — partial (SkillRegistry references commander but no formal resolver)
> - [x] **Unit status lifecycle (idle/working/combat/exhausted/offline)** — 6 states with distinct colors, pulse speeds, and server-side transitions
> - [ ] **Context exhaustion / unit collapse animation** — not implemented
> - [ ] **Loot orb return from sub-agents** — not implemented
> - [ ] **Deploy animation with portal circle** — not implemented

**Depends on:** `01-vision.md`, `02-physics-and-movement.md`
**Parent phase:** Phase 0 (Foundation) + Phase 1 (Command & Control)
**Last updated:** 2026-03-10

---

## Table of Contents

1. [Prime Agent as Commander Unit](#1-prime-agent-as-commander-unit)
2. [Sub-Agent Spawning as Unit Deployment](#2-sub-agent-spawning-as-unit-deployment)
3. [Territory Detection Algorithm](#3-territory-detection-algorithm)
4. [Multi-Session Battlefield State](#4-multi-session-battlefield-state)
5. [Event-to-Animation Pipeline](#5-event-to-animation-pipeline)
6. [The "Watching Claude Think" Experience](#6-the-watching-claude-think-experience)
7. [TypeScript Interfaces](#7-typescript-interfaces)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Prime Agent as Commander Unit

The user's active Claude Code session — the terminal they're physically typing into — is the **Commander** on the battlefield. It has special visual treatment, special behavior, and a fundamentally different relationship to the map than every other unit.

### 1.1 Identifying the Prime Session

The system must distinguish the prime (commander) session from all others. There are three identification strategies, applied in priority order:

```typescript
interface PrimeSessionResolver {
  /**
   * Strategy 1: EXPLICIT DESIGNATION
   * The user marks a session as "prime" when creating it, or via the UI.
   * Stored in ManagedSession.role = 'commander'.
   * This is the authoritative signal.
   */
  checkExplicitDesignation(session: ManagedSession): boolean

  /**
   * Strategy 2: FIRST SESSION HEURISTIC
   * If no session is explicitly designated as commander, the FIRST session
   * created in the current agent-empires tmux session is treated as prime.
   * Rationale: The user's own terminal is always Window 1 (index 0 or 1).
   */
  checkFirstSession(sessions: ManagedSession[]): ManagedSession | null

  /**
   * Strategy 3: MOST RECENT USER PROMPT
   * If multiple sessions exist with no explicit commander, the session that
   * most recently received a user_prompt_submit event is treated as the
   * active commander. This handles the case where the user switches
   * between terminal windows.
   */
  checkMostRecentPrompt(sessions: ManagedSession[]): ManagedSession | null
}
```

**Resolution order:**
1. Check for `session.role === 'commander'` — if found, that's the commander
2. If none, check for the session with `tmuxWindow === 1` (first window)
3. If ambiguous, the session with the most recent `user_prompt_submit` timestamp wins
4. If still ambiguous (server just started, no events), the first session in creation order

**Why not just "the session that got the last prompt"?** Because the user might be watching the commander think for 2 minutes while a lieutenant receives a prompt via the command bar. The commander is a sticky designation, not a transient one.

### 1.2 Commander Visual Identity

The commander sprite is visually distinct from all other units:

```typescript
interface CommanderVisuals {
  // Sprite: 1.5x the size of standard units
  spriteScale: 1.5

  // Crown/star icon rendered above the unit at all times
  insignia: 'crown'

  // Pulsing golden aura (PixiJS glow filter, 4px radius)
  aura: {
    color: 0xFFD700    // Gold
    intensity: 0.6
    pulseSpeed: 1.5    // seconds per cycle
    pulseRange: [0.4, 0.8]  // min/max intensity
  }

  // Status ring is thicker (4px vs 2px for standard units)
  statusRingWidth: 4

  // Nameplate says "COMMANDER" instead of session name
  // (session name shown in smaller text below)
  nameplate: {
    primaryLabel: 'COMMANDER'
    secondaryLabel: session.name
    font: 'bold'
  }

  // Camera follows commander by default (F key to toggle)
  cameraFollow: true

  // Always visible on minimap regardless of zoom (rendered as larger dot)
  minimapScale: 2.0
}
```

### 1.3 Commander Position from Domain Detection

The commander's position on the map reflects what they're currently working on. This is driven by the Territory Detection Algorithm (Section 3), but the commander has special positioning rules:

```typescript
interface CommanderPositioning {
  /**
   * The commander's "home hex" is always in HQ (The Keep).
   * When idle, the commander returns here.
   */
  homeTerritory: 'hq'

  /**
   * When the commander works on a tool call that maps to a territory,
   * the commander DOES NOT physically march there.
   * Instead, a "command beam" visual connects the commander to the
   * territory being affected. The commander stays at HQ or their
   * current position.
   *
   * Rationale: The general doesn't march to the front lines.
   * They command from HQ and their presence is felt through orders.
   *
   * EXCEPTION: If the commander has been working exclusively in one
   * territory for >30 seconds (sustained focus), the commander
   * slowly drifts toward that territory's border hex closest to HQ.
   * This creates a visual "leaning in" effect.
   */
  movementMode: 'command-beam' | 'drift'

  /**
   * Drift threshold: how many consecutive tool calls in the same
   * territory before the commander starts drifting toward it.
   */
  driftThreshold: 5  // tool calls

  /**
   * Drift speed: how fast the commander moves toward the focused territory.
   * Much slower than standard march — it's a gravitational pull, not an order.
   */
  driftSpeed: 0.3  // hex per second (vs 1-5 hex/sec for normal march)

  /**
   * When the territory focus changes (new tool call in a different domain),
   * the drift resets and the commander slowly returns toward HQ.
   */
  driftResetBehavior: 'return-to-hq'
}
```

**How territory is determined from tool calls:**

The commander's tool calls flow through the Territory Detection Algorithm (Section 3). Each tool call returns a `TerritoryId`. The system maintains a rolling window:

```typescript
class CommanderTerritoryTracker {
  private recentTerritories: { territory: TerritoryId; timestamp: number }[] = []
  private readonly WINDOW_SIZE = 10  // last 10 tool calls
  private readonly WINDOW_TIME = 60_000  // or last 60 seconds

  onToolCall(event: PreToolUseEvent): TerritoryId {
    const territory = detectTerritory(event)
    this.recentTerritories.push({ territory, timestamp: Date.now() })

    // Prune old entries
    this.recentTerritories = this.recentTerritories.filter(
      t => t.timestamp > Date.now() - this.WINDOW_TIME
    ).slice(-this.WINDOW_SIZE)

    return this.getDominantTerritory()
  }

  getDominantTerritory(): TerritoryId {
    if (this.recentTerritories.length === 0) return 'hq'

    // Count occurrences, weighted by recency
    const counts = new Map<TerritoryId, number>()
    const now = Date.now()

    for (const entry of this.recentTerritories) {
      const recencyWeight = 1 - ((now - entry.timestamp) / this.WINDOW_TIME) * 0.5
      const current = counts.get(entry.territory) || 0
      counts.set(entry.territory, current + recencyWeight)
    }

    // Return highest weighted territory
    let best: TerritoryId = 'hq'
    let bestScore = 0
    for (const [territory, score] of counts) {
      if (score > bestScore) {
        bestScore = score
        best = territory
      }
    }

    return best
  }
}
```

### 1.4 User Typing a Prompt (Command Animation)

When the user submits a prompt (`user_prompt_submit` event), the commander performs a **Command Broadcast** animation:

```typescript
interface CommandBroadcastAnimation {
  // Phase 1: WIND-UP (0.3s)
  // Commander raises arm/staff, glowing energy gathers
  windUp: {
    duration: 300
    spriteFrame: 'command-raise'
    particleEffect: 'energy-gather'  // particles flow TOWARD commander
    particleColor: 0xFFD700
    sound: 'command-acknowledge'     // crisp tone
  }

  // Phase 2: BROADCAST (0.5s)
  // Expanding ring of light emanates from commander
  // Like a radar ping but golden
  broadcast: {
    duration: 500
    ringEffect: {
      color: 0xFFD700
      startRadius: 20     // pixels
      endRadius: 400      // pixels (covers nearby territory)
      opacity: [0.8, 0.0] // fades as it expands
      lineWidth: 3
    }
    screenFlash: {
      color: 0xFFD700
      opacity: 0.05        // very subtle
      duration: 200
    }
    sound: 'command-issue'  // horn/bugle note
  }

  // Phase 3: COMMAND PENNANT (persistent until stop event)
  // Small flag/banner appears above commander showing truncated prompt
  pennant: {
    text: truncate(prompt, 40)  // "Deploy scout to investigate competi..."
    backgroundColor: 0x1a1a2e
    textColor: 0xFFD700
    fadeOutOnStop: true          // disappears when Claude finishes responding
  }
}
```

### 1.5 Commander Issuing a Task (Spawn Animation)

When the commander's session calls the `Task` tool (spawning a sub-agent), the commander performs a **Deployment** animation. This is distinct from the standard command broadcast — it's heavier, more dramatic:

```typescript
interface DeploymentAnimation {
  // Phase 1: SUMMON (0.5s)
  // Commander slams staff/hand down, portal circle appears at feet
  summon: {
    duration: 500
    spriteFrame: 'command-deploy'
    groundEffect: {
      type: 'portal-circle'
      color: 0x00FFFF        // Cyan (matches sub-agent palette)
      radius: 30
      rotationSpeed: 2       // radians per second
      runeCount: 6           // glowing symbols around the circle
    }
    sound: 'deploy-summon'   // deep bass note + rising tone
  }

  // Phase 2: MATERIALIZE (0.8s)
  // New unit sprite assembles from particles at the portal
  materialize: {
    duration: 800
    particleEffect: {
      type: 'converge'       // particles fly INWARD to form the unit
      count: 30
      spread: 100            // starting radius
      color: 'unit-type-color'  // color based on detected unit type
    }
    unitAppearance: 'fade-in-bottom-up'  // unit draws from feet to head
    sound: 'deploy-materialize'  // crystallization/assembly sound
  }

  // Phase 3: ORDERS (0.3s)
  // Animated line connects commander to new unit briefly
  // Task description appears as floating text near the new unit
  orders: {
    duration: 300
    connectionLine: {
      from: 'commander'
      to: 'new-unit'
      color: 0xFFD700
      style: 'animated-dash'
      fadeAfter: 2000        // line fades after 2 seconds
    }
    orderText: {
      text: truncate(taskInput.description, 60)
      style: 'floating-fade'
    }
  }

  // Phase 4: MARCH OUT (variable)
  // New unit turns toward its target territory and begins marching
  // See Section 2 for full march behavior
  marchOut: 'see-section-2'
}
```

---

## 2. Sub-Agent Spawning as Unit Deployment

When any session (commander or otherwise) calls the `Task` tool, a sub-agent Claude Code session is spawned. This sub-agent gets its own `sessionId` delivered via hook events. On the battlefield, it becomes a new unit.

### 2.1 Unit Type Detection

The system determines what TYPE of unit the sub-agent is from the `Task` tool input. The `TaskToolInput` provides `description`, `prompt`, and `subagent_type`.

```typescript
type UnitType =
  | 'commander'    // Prime session only
  | 'lieutenant'   // Domain lead
  | 'scout'        // Research/recon
  | 'writer'       // Content production
  | 'engineer'     // Builds/deploys/creates
  | 'operative'    // General task execution
  | 'medic'        // Fix/support/debug
  | 'diplomat'     // Sales/outreach

interface UnitTypeDetector {
  detect(taskInput: TaskToolInput): UnitType
}

/**
 * Detection algorithm: check subagent_type first, then keyword-match
 * on description and prompt.
 */
function detectUnitType(taskInput: TaskToolInput): UnitType {
  const { description, prompt, subagent_type } = taskInput

  // 1. Explicit subagent_type mapping (if the caller specifies)
  const SUBAGENT_TYPE_MAP: Record<string, UnitType> = {
    'research': 'scout',
    'researcher': 'scout',
    'analyst': 'scout',
    'writer': 'writer',
    'content': 'writer',
    'editor': 'writer',
    'builder': 'engineer',
    'engineer': 'engineer',
    'developer': 'engineer',
    'coder': 'engineer',
    'fixer': 'medic',
    'debugger': 'medic',
    'support': 'medic',
    'sales': 'diplomat',
    'outreach': 'diplomat',
    'lead': 'lieutenant',
    'manager': 'lieutenant',
    'coordinator': 'lieutenant',
  }

  if (subagent_type) {
    const normalized = subagent_type.toLowerCase().trim()
    if (SUBAGENT_TYPE_MAP[normalized]) {
      return SUBAGENT_TYPE_MAP[normalized]
    }
  }

  // 2. Keyword analysis on description + prompt
  const text = `${description} ${prompt}`.toLowerCase()

  const KEYWORD_SCORES: { type: UnitType; keywords: string[]; weight: number }[] = [
    {
      type: 'scout',
      keywords: ['research', 'investigate', 'analyze', 'find out', 'look up', 'search',
                 'discover', 'survey', 'monitor', 'check', 'explore', 'scan',
                 'competitor', 'trend', 'market', 'analytics'],
      weight: 1,
    },
    {
      type: 'writer',
      keywords: ['write', 'draft', 'compose', 'create content', 'linkedin post',
                 'twitter', 'newsletter', 'blog', 'copy', 'email draft', 'article',
                 'headline', 'hook', 'caption', 'script'],
      weight: 1,
    },
    {
      type: 'engineer',
      keywords: ['build', 'implement', 'code', 'deploy', 'create skill', 'scaffold',
                 'package', 'compile', 'install', 'configure', 'setup', 'migrate',
                 'refactor', 'architect', 'infrastructure', 'database', 'api'],
      weight: 1,
    },
    {
      type: 'medic',
      keywords: ['fix', 'debug', 'repair', 'resolve', 'troubleshoot', 'patch',
                 'hotfix', 'error', 'bug', 'broken', 'failing', 'support ticket',
                 'customer issue', 'complaint'],
      weight: 1,
    },
    {
      type: 'diplomat',
      keywords: ['sales', 'proposal', 'pitch', 'outreach', 'follow up', 'call prep',
                 'partnership', 'negotiate', 'prospect', 'lead', 'close', 'deal',
                 'pricing', 'contract', 'client'],
      weight: 1,
    },
    {
      type: 'lieutenant',
      keywords: ['coordinate', 'orchestrate', 'manage', 'oversee', 'batch',
                 'pipeline', 'workflow', 'sequence', 'campaign', 'multi-step',
                 'parallel', 'delegate'],
      weight: 1,
    },
  ]

  const scores = new Map<UnitType, number>()

  for (const { type, keywords, weight } of KEYWORD_SCORES) {
    let score = 0
    for (const kw of keywords) {
      if (text.includes(kw)) score += weight
    }
    scores.set(type, score)
  }

  // Find highest score
  let bestType: UnitType = 'operative'  // default fallback
  let bestScore = 0

  for (const [type, score] of scores) {
    if (score > bestScore) {
      bestScore = score
      bestType = type
    }
  }

  // Require minimum confidence (at least 2 keyword hits)
  return bestScore >= 2 ? bestType : 'operative'
}
```

### 2.2 Deployment Location Detection

Where the new unit deploys on the map is determined by analyzing the task's `prompt` and `description` for territory signals:

```typescript
function detectDeploymentTerritory(taskInput: TaskToolInput): TerritoryId {
  const text = `${taskInput.description} ${taskInput.prompt}`

  // 1. Check for explicit file paths in the prompt
  const filePathTerritory = detectTerritoryFromFilePaths(text)
  if (filePathTerritory) return filePathTerritory

  // 2. Check for skill references
  const skillTerritory = detectTerritoryFromSkillNames(text)
  if (skillTerritory) return skillTerritory

  // 3. Check for domain keywords
  const keywordTerritory = detectTerritoryFromKeywords(text)
  if (keywordTerritory) return keywordTerritory

  // 4. Fallback: deploy at the parent session's current territory
  // The sub-agent starts near its parent and marches if it later
  // touches files in a different territory.
  return getSessionTerritory(taskInput.parentSessionId) || 'hq'
}
```

The file path and keyword detection functions are defined fully in Section 3 (Territory Detection Algorithm).

### 2.3 Spawn-to-March Animation Sequence

The full lifecycle of a sub-agent on the battlefield:

```
[Task tool_use detected on parent session]
        |
        v
PHASE 1: MATERIALIZE AT PARENT (0.8s)
  - New unit sprite assembles at the parent unit's position
  - Particle convergence effect (30 particles, inward)
  - Unit type determines sprite + color
  - Sound: deploy-materialize
        |
        v
PHASE 2: RECEIVE ORDERS (0.3s)
  - Animated dash-line from parent to new unit
  - Task description floats above new unit briefly
  - Sound: order-acknowledge
        |
        v
PHASE 3: MARCH TO TERRITORY (2-8s, terrain-dependent)
  - Unit turns toward target territory
  - A* pathfinding calculates hex route
  - Unit marches along path (speed per 02-physics)
  - March duration = estimated task complexity
  - If target territory === parent territory, skip march (already there)
  - Sound: marching footsteps (spatial, fading as unit moves away)
        |
        v
PHASE 4: ARRIVE + ENGAGE (variable)
  - Unit reaches target hex, plants position
  - Subsequent tool calls from this sessionId animate on THIS unit
  - Working particles, tool-specific animations play on this sprite
  - See Section 5 for per-event animation mapping
        |
        v
PHASE 5: SUB-AGENT TOOL CALLS (duration of task)
  - Each pre_tool_use from this sessionId: weapon/tool animation
  - Each post_tool_use: result particle (green spark or red spark)
  - File reads/writes show context labels floating above unit
  - Status ring stays cyan (working) throughout
        |
        v
PHASE 6: COMPLETION (subagent_stop event)
  - Victory animation: unit raises weapon/tool, golden burst
  - Loot drop: small golden orb floats from unit back toward parent
    (represents the return value / work product)
  - Sound: task-complete (triumphant short stinger)
  - Unit status ring turns green (idle)
        |
        v
PHASE 7: RETURN OR DISSOLVE (1.5s)
  - Option A (default): Unit dissolves with reverse-particle effect
    (particles scatter outward, sprite fades, 1.5s)
    Used when: sub-agent session ends after task completion
  - Option B: Unit marches back to parent's position, then dissolves
    Used when: sub-agent writes output to parent's territory
  - Option C: Unit remains on battlefield as idle unit
    Used when: session stays alive (lieutenant managing a domain)
```

### 2.4 Sub-Agent Tool Calls on the Correct Unit

When a sub-agent makes tool calls, those events must animate on the SUB-AGENT's unit sprite, not the parent. The key is the `sessionId` field on every event.

```typescript
class SessionToUnitRouter {
  // Maps Claude sessionId -> battlefield unit ID
  private sessionUnitMap = new Map<string, string>()

  /**
   * When a Task tool_use is detected (pre_tool_use where tool === 'Task'),
   * we don't yet know the sub-agent's sessionId. We know:
   * - The parent sessionId (from the event)
   * - The toolUseId (unique to this Task invocation)
   *
   * When the sub-agent's FIRST event arrives, its sessionId will be new
   * (not in our map). We associate it with the pending Task.
   */
  onTaskSpawn(parentSessionId: string, toolUseId: string, taskInput: TaskToolInput): void {
    const unitId = createUnit(taskInput)
    this.pendingSpawns.set(toolUseId, unitId)
  }

  /**
   * When we see a session_start event with a sessionId we haven't seen,
   * AND we have pending spawns, link them.
   *
   * Heuristic: the session_start that arrives closest in time to the
   * Task pre_tool_use is the sub-agent for that Task.
   */
  onSessionStart(event: SessionStartEvent): void {
    if (this.sessionUnitMap.has(event.sessionId)) return  // known session

    // Check for pending spawn (FIFO — oldest pending Task gets linked first)
    const [toolUseId, unitId] = this.getOldestPendingSpawn()
    if (toolUseId && unitId) {
      this.sessionUnitMap.set(event.sessionId, unitId)
      this.pendingSpawns.delete(toolUseId)
    }
  }

  /**
   * Route any event to the correct unit sprite.
   */
  getUnitForSession(sessionId: string): string | null {
    return this.sessionUnitMap.get(sessionId) || null
  }

  private pendingSpawns = new Map<string, string>()

  private getOldestPendingSpawn(): [string, string] | [null, null] {
    const first = this.pendingSpawns.entries().next()
    if (first.done) return [null, null]
    return first.value
  }
}
```

### 2.5 Nested Sub-Agents

When a sub-agent spawns its OWN sub-agent (Task within a Task), the system handles it identically:

1. The sub-agent's unit becomes the "parent" for the animation
2. New unit materializes at the sub-agent's position
3. New unit marches to ITS detected territory
4. Visually, you see a chain: Commander -> Lieutenant -> Operative

**Visual hierarchy indicators:**
- Sub-agents are 80% the scale of their parent
- Sub-sub-agents are 80% of THAT (64% of commander scale)
- Minimum scale: 50% of commander (prevents invisible units)
- Connection lines: thin animated dash-lines from child to parent, fading after 3s
- Color inheritance: sub-agents inherit a tint from their parent's aura

```typescript
interface UnitHierarchy {
  unitId: string
  parentUnitId: string | null  // null = top-level session (commander or independent)
  depth: number                // 0 = top-level, 1 = sub-agent, 2 = sub-sub-agent
  scale: number                // 1.0 for commander, 0.8^depth for sub-agents (min 0.5)
}
```

---

## 3. Territory Detection Algorithm

This is the most critical system for live visibility. Given ANY Claude Code event, determine which battlefield territory it belongs to.

### 3.1 Territory Definitions

```typescript
type TerritoryId =
  | 'lead-gen'      // The Frontier — ads, funnels, landing pages, SEO
  | 'content'       // The Plains — content creation, social media, newsletters
  | 'sales'         // The Pass — pipeline, proposals, calls, CRM
  | 'fulfillment'   // The Citadel — product delivery, onboarding, courses
  | 'support'       // The Marshes — tickets, bug fixes, customer issues
  | 'retention'     // The Walls — churn prevention, upsells, NPS
  | 'hq'            // The Keep — personal, meta-work, planning, general
```

### 3.2 The Detection Pipeline

Territory detection runs as a pipeline of classifiers. Each returns a `TerritoryId | null`. The first non-null result wins.

```typescript
interface TerritorySignal {
  territory: TerritoryId
  confidence: number     // 0.0 - 1.0
  source: string         // Which classifier produced this signal
}

function detectTerritory(event: ClaudeEvent): TerritoryId {
  const signals: TerritorySignal[] = []

  // Run all classifiers, collect signals
  signals.push(...classifyByFilePath(event))
  signals.push(...classifyBySkillName(event))
  signals.push(...classifyByToolType(event))
  signals.push(...classifyByBashCommand(event))
  signals.push(...classifyByPromptContent(event))

  if (signals.length === 0) return 'hq'  // default fallback

  // Sort by confidence descending
  signals.sort((a, b) => b.confidence - a.confidence)

  // If top signal has >0.8 confidence, use it directly
  if (signals[0].confidence >= 0.8) return signals[0].territory

  // Otherwise, weighted vote across all signals
  const votes = new Map<TerritoryId, number>()
  for (const signal of signals) {
    const current = votes.get(signal.territory) || 0
    votes.set(signal.territory, current + signal.confidence)
  }

  let best: TerritoryId = 'hq'
  let bestScore = 0
  for (const [territory, score] of votes) {
    if (score > bestScore) {
      bestScore = score
      best = territory
    }
  }

  return best
}
```

### 3.3 Classifier: File Path Analysis

The highest-confidence signal. File paths directly map to domains.

```typescript
function classifyByFilePath(event: ClaudeEvent): TerritorySignal[] {
  // Extract file paths from the event
  const paths = extractFilePaths(event)
  if (paths.length === 0) return []

  const signals: TerritorySignal[] = []

  for (const filePath of paths) {
    const normalized = filePath.toLowerCase()

    // TIER 1: Exact domain directory matches (confidence: 0.95)
    const DOMAIN_PATH_MAP: [RegExp, TerritoryId][] = [
      // speakeasy-agent domain directories
      [/domains\/lead-gen\//,                     'lead-gen'],
      [/domains\/sales\//,                        'sales'],
      [/domains\/fulfillment\//,                  'fulfillment'],
      [/domains\/support\//,                      'support'],
      [/domains\/retention\//,                    'retention'],
      [/domains\/home\//,                         'hq'],
      [/domains\/scaling\//,                      'hq'],

      // Product-specific paths
      [/products\/cowork-bootcamp/,               'fulfillment'],
      [/products\/overclock/,                     'fulfillment'],
      [/products\/skill-trainer/,                 'fulfillment'],
      [/products\/content-agent/,                 'content'],
      [/products\/cowork-bootcamp-plugins/,       'fulfillment'],

      // Skill-specific paths
      [/skills\/content/,                         'content'],
      [/skills\/social/,                          'content'],
      [/skills\/newsletter/,                      'content'],
      [/skills\/sales/,                           'sales'],
      [/skills\/customer-response/,               'support'],
      [/skills\/support/,                         'support'],

      // Known repos by directory name
      [/content-agent/,                           'content'],
      [/cowork-cnc/,                              'content'],
      [/lp-factory/,                              'lead-gen'],
    ]

    for (const [pattern, territory] of DOMAIN_PATH_MAP) {
      if (pattern.test(normalized)) {
        signals.push({ territory, confidence: 0.95, source: 'file-path-domain' })
        break
      }
    }

    // TIER 2: File type / directory name heuristics (confidence: 0.6)
    const FILE_TYPE_MAP: [RegExp, TerritoryId][] = [
      [/\/(funnels?|landing|ads?|campaigns?)\//,   'lead-gen'],
      [/\/(content|posts?|newsletters?|social)\//,  'content'],
      [/\/(sales|pipeline|proposals?|crm)\//,       'sales'],
      [/\/(deliver|onboard|courses?|sessions?)\//,  'fulfillment'],
      [/\/(support|tickets?|bugs?|issues?)\//,      'support'],
      [/\/(retention|churn|nps|upsell)\//,          'retention'],
    ]

    for (const [pattern, territory] of FILE_TYPE_MAP) {
      if (pattern.test(normalized)) {
        signals.push({ territory, confidence: 0.6, source: 'file-path-type' })
        break
      }
    }
  }

  return signals
}

/**
 * Extract file paths from any event type.
 */
function extractFilePaths(event: ClaudeEvent): string[] {
  const paths: string[] = []

  if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
    const input = event.toolInput as Record<string, unknown>

    // Read, Write, Edit all have file_path
    if (input.file_path && typeof input.file_path === 'string') {
      paths.push(input.file_path)
    }

    // Grep has path
    if (input.path && typeof input.path === 'string') {
      paths.push(input.path)
    }

    // Bash commands may contain file paths
    if (event.tool === 'Bash' && input.command && typeof input.command === 'string') {
      // Extract paths from bash commands (rough heuristic)
      const pathMatches = (input.command as string).match(
        /(?:^|\s)(\/[^\s;|&>]+|~\/[^\s;|&>]+|\.[^\s;|&>]*\/[^\s;|&>]+)/g
      )
      if (pathMatches) {
        paths.push(...pathMatches.map(p => p.trim()))
      }
    }

    // Task tool: extract paths from the prompt
    if (event.tool === 'Task' && input.prompt && typeof input.prompt === 'string') {
      const taskPaths = (input.prompt as string).match(
        /(?:^|\s)(\/[^\s;|&>"']+)/g
      )
      if (taskPaths) {
        paths.push(...taskPaths.map(p => p.trim()))
      }
    }
  }

  // Also check the session's cwd
  if (event.cwd) {
    paths.push(event.cwd)
  }

  return paths
}
```

### 3.4 Classifier: Skill Name Analysis

Skill invocations (detected from Bash commands or tool descriptions) map to territories.

```typescript
function classifyBySkillName(event: ClaudeEvent): TerritorySignal[] {
  if (event.type !== 'pre_tool_use') return []

  const signals: TerritorySignal[] = []

  // Detect skill invocations from Bash commands
  // Skills are invoked as: /skill-name, /domain:skill-name, or via command files
  const input = event.toolInput as Record<string, unknown>

  let text = ''
  if (event.tool === 'Bash' && input.command) {
    text = input.command as string
  }
  if (input.description) {
    text += ' ' + (input.description as string)
  }

  const SKILL_TERRITORY_MAP: [RegExp, TerritoryId, number][] = [
    // Content skills (confidence 0.9)
    [/\/content:/,                     'content', 0.9],
    [/generate-linkedin/,              'content', 0.9],
    [/generate-twitter/,               'content', 0.9],
    [/generate-carousel/,              'content', 0.9],
    [/generate-newsletter/,            'content', 0.9],
    [/newsletter-writer/,              'content', 0.9],
    [/social-content/,                 'content', 0.9],
    [/voice-memo-to-post/,             'content', 0.9],
    [/trend-jacking/,                  'content', 0.85],

    // Lead-gen skills
    [/\/lead-gen:/,                    'lead-gen', 0.9],
    [/vercel-landing-page/,            'lead-gen', 0.85],
    [/figma-to-vercel/,                'lead-gen', 0.85],
    [/lp-factory/,                     'lead-gen', 0.9],

    // Sales skills
    [/\/sales:/,                       'sales', 0.9],
    [/sales:prep-call/,                'sales', 0.95],
    [/offer-doc-builder/,              'sales', 0.85],
    [/meeting-prep/,                   'sales', 0.85],

    // Fulfillment skills
    [/\/fulfillment:/,                 'fulfillment', 0.9],
    [/session-builder/,                'fulfillment', 0.9],
    [/course-skill-extractor/,         'fulfillment', 0.9],
    [/plugin-packager/,                'fulfillment', 0.85],
    [/skill-maker/,                    'fulfillment', 0.85],

    // Support skills
    [/\/support:/,                     'support', 0.9],
    [/customer-response/,              'support', 0.9],

    // Quality skills (map to content since they're content QA)
    [/\/quality:/,                     'content', 0.7],
    [/audit-ai-detection/,             'content', 0.7],
    [/check-gptzero/,                  'content', 0.7],

    // Engineering skills (map to HQ — meta/infrastructure work)
    [/skill-creator/,                  'hq', 0.7],
    [/mcp-builder/,                    'hq', 0.7],
  ]

  for (const [pattern, territory, confidence] of SKILL_TERRITORY_MAP) {
    if (pattern.test(text)) {
      signals.push({ territory, confidence, source: 'skill-name' })
    }
  }

  return signals
}
```

### 3.5 Classifier: Tool Type Heuristics

Certain tools, by their nature, lean toward specific territories.

```typescript
function classifyByToolType(event: ClaudeEvent): TerritorySignal[] {
  if (event.type !== 'pre_tool_use') return []

  const signals: TerritorySignal[] = []
  const tool = event.tool

  // Low-confidence signals — these are weak heuristics,
  // only used when stronger signals aren't available
  const TOOL_TERRITORY_HINTS: Record<string, { territory: TerritoryId; confidence: number }> = {
    // Web tools suggest outward-facing work
    'WebFetch':  { territory: 'lead-gen', confidence: 0.3 },
    'WebSearch': { territory: 'lead-gen', confidence: 0.3 },

    // Task tool suggests delegation (HQ activity — commanding)
    'Task':      { territory: 'hq', confidence: 0.2 },

    // TodoWrite suggests planning (HQ)
    'TodoWrite': { territory: 'hq', confidence: 0.2 },
  }

  const hint = TOOL_TERRITORY_HINTS[tool]
  if (hint) {
    signals.push({ ...hint, source: 'tool-type' })
  }

  // MCP tool detection — specific MCP tools map to territories
  if (tool.startsWith('mcp__')) {
    const MCP_TERRITORY_MAP: [RegExp, TerritoryId, number][] = [
      [/mcp__claude_ai_Slack/,     'support', 0.5],
      [/mcp__claude_ai_Notion/,    'fulfillment', 0.4],
      [/mcp__claude_ai_Supabase/,  'hq', 0.3],
      [/mcp__claude_ai_Vercel/,    'lead-gen', 0.5],
      [/mcp__claude_ai_Gamma/,     'content', 0.6],
      [/mcp__claude_ai_Gmail/,     'sales', 0.4],
      [/mcp__claude_ai_Google_Calendar/, 'hq', 0.3],
      [/mcp__claude_ai_Asana/,     'fulfillment', 0.5],
      [/mcp__pencil/,              'content', 0.5],  // Figma/design
    ]

    for (const [pattern, territory, confidence] of MCP_TERRITORY_MAP) {
      if (pattern.test(tool)) {
        signals.push({ territory, confidence, source: 'mcp-tool' })
        break
      }
    }
  }

  return signals
}
```

### 3.6 Classifier: Bash Command Analysis

Bash commands carry rich semantic information.

```typescript
function classifyByBashCommand(event: ClaudeEvent): TerritorySignal[] {
  if (event.type !== 'pre_tool_use' || event.tool !== 'Bash') return []

  const input = event.toolInput as BashToolInput
  const cmd = input.command.toLowerCase()
  const signals: TerritorySignal[] = []

  // Git operations in specific directories
  if (cmd.includes('git') && cmd.includes('content-agent')) {
    signals.push({ territory: 'content', confidence: 0.8, source: 'bash-git' })
  }

  // npm/node scripts with domain keywords
  const BASH_KEYWORD_MAP: [RegExp, TerritoryId, number][] = [
    // Deployment / shipping
    [/npm\s+(run\s+)?build|npm\s+publish|vercel\s+deploy/, 'fulfillment', 0.6],
    [/build\.sh|dist\//,                                     'fulfillment', 0.5],

    // Content-related commands
    [/consult-mentors|generate.*content|ayrshare/,          'content', 0.7],
    [/gptzero|ai.*detect/,                                   'content', 0.6],

    // Analytics / research
    [/curl.*api|analytics|metrics|stripe/,                   'lead-gen', 0.4],
    [/youtube-research|scan-x-trends/,                       'content', 0.7],

    // Database operations
    [/supabase|psql|sql/,                                    'hq', 0.3],

    // Slack operations
    [/slack\.com\/api/,                                      'support', 0.4],

    // Calendar / scheduling
    [/calendar|schedule|sync.*ics/,                          'hq', 0.4],

    // Email operations
    [/mail|kit.*api|convertkit/,                             'lead-gen', 0.5],
  ]

  for (const [pattern, territory, confidence] of BASH_KEYWORD_MAP) {
    if (pattern.test(cmd)) {
      signals.push({ territory, confidence, source: 'bash-keyword' })
    }
  }

  return signals
}
```

### 3.7 Classifier: Prompt Content Analysis

For `user_prompt_submit` events, the prompt text itself carries territory signals.

```typescript
function classifyByPromptContent(event: ClaudeEvent): TerritorySignal[] {
  if (event.type !== 'user_prompt_submit') return []

  const prompt = (event as UserPromptSubmitEvent).prompt.toLowerCase()
  const signals: TerritorySignal[] = []

  const PROMPT_KEYWORD_MAP: [RegExp, TerritoryId, number][] = [
    // Lead-gen / marketing
    [/\b(funnel|landing page|ad|campaign|seo|traffic)\b/,     'lead-gen', 0.6],
    [/\b(lead|opt-?in|waitlist|signup)\b/,                     'lead-gen', 0.5],

    // Content
    [/\b(write|post|newsletter|article|content|hook|thread)\b/, 'content', 0.5],
    [/\b(linkedin|twitter|x\.com|social|carousel)\b/,          'content', 0.6],

    // Sales
    [/\b(sale|prospect|proposal|call prep|pipeline|deal|close)\b/, 'sales', 0.6],
    [/\b(pricing|invoice|contract|client meeting)\b/,              'sales', 0.5],

    // Fulfillment
    [/\b(deliver|onboard|course|session|bootcamp|plugin|skill)\b/, 'fulfillment', 0.5],
    [/\b(product|ship|release|launch|package)\b/,                   'fulfillment', 0.4],

    // Support
    [/\b(support|ticket|bug|fix|issue|customer.*problem)\b/,       'support', 0.6],
    [/\b(debug|error|broken|failing)\b/,                            'support', 0.5],

    // Retention
    [/\b(churn|retain|renewal|nps|satisfaction|upsell)\b/,         'retention', 0.7],

    // HQ / personal
    [/\b(plan|strategy|schedule|personal|home|family)\b/,          'hq', 0.4],
    [/\b(scratchpad|briefing|meeting notes)\b/,                     'hq', 0.5],
  ]

  for (const [pattern, territory, confidence] of PROMPT_KEYWORD_MAP) {
    if (pattern.test(prompt)) {
      signals.push({ territory, confidence, source: 'prompt-keyword' })
    }
  }

  return signals
}
```

### 3.8 Complete Territory Mapping Table

Quick-reference for the most common signals:

| Signal Type | Example | Territory | Confidence |
|---|---|---|---|
| File path: `domains/sales/` | Read `/domains/sales/prospects/kelly.md` | sales | 0.95 |
| File path: `domains/fulfillment/` | Edit in fulfillment products | fulfillment | 0.95 |
| File path: `domains/lead-gen/` | Write to funnels directory | lead-gen | 0.95 |
| File path: `content-agent/` | Any file in content-agent repo | content | 0.95 |
| Skill: `/content:generate-linkedin` | Bash running content skill | content | 0.9 |
| Skill: `/sales:prep-call` | Sales call preparation | sales | 0.95 |
| Skill: `session-builder` | Building course sessions | fulfillment | 0.9 |
| MCP: `mcp__claude_ai_Vercel__deploy` | Deploying to Vercel | lead-gen | 0.5 |
| MCP: `mcp__claude_ai_Gamma__generate` | Creating presentation | content | 0.6 |
| Tool: `WebSearch` | General web search | lead-gen | 0.3 |
| Bash: `git commit` in content-agent | Git ops in content repo | content | 0.8 |
| Bash: `npm run build` | Building a package | fulfillment | 0.6 |
| Prompt: "write a LinkedIn post" | User typing content request | content | 0.5 |
| Prompt: "prep for Kelly sales call" | User requesting sales prep | sales | 0.6 |
| No signal detected | Unknown work | hq | fallback |

### 3.9 Territory Transition Smoothing

To prevent the commander from flickering between territories on every tool call, the system applies hysteresis:

```typescript
class TerritoryTransitionSmoother {
  private currentTerritory: TerritoryId = 'hq'
  private candidateTerritory: TerritoryId | null = null
  private candidateCount = 0
  private readonly TRANSITION_THRESHOLD = 3  // consecutive signals needed

  onNewSignal(territory: TerritoryId): TerritoryId {
    if (territory === this.currentTerritory) {
      // Reinforces current position — reset any pending transition
      this.candidateTerritory = null
      this.candidateCount = 0
      return this.currentTerritory
    }

    if (territory === this.candidateTerritory) {
      this.candidateCount++
      if (this.candidateCount >= this.TRANSITION_THRESHOLD) {
        // Confirmed transition
        this.currentTerritory = territory
        this.candidateTerritory = null
        this.candidateCount = 0
      }
    } else {
      // New candidate — start counting
      this.candidateTerritory = territory
      this.candidateCount = 1
    }

    return this.currentTerritory
  }
}
```

---

## 4. Multi-Session Battlefield State

When multiple Claude Code windows are running simultaneously (managed or unmanaged), each gets its own unit on the battlefield.

### 4.1 Session-to-Unit Mapping

```typescript
interface BattlefieldUnit {
  /** Our internal unit ID (UUID) */
  id: string

  /** The Claude Code sessionId this unit represents */
  claudeSessionId: string

  /** The managed session ID (if this is a managed session) */
  managedSessionId?: string

  /** Unit type (detected or assigned) */
  type: UnitType

  /** Current territory */
  territory: TerritoryId

  /** Current hex position */
  hexPosition: HexCoord

  /** Is this the commander? */
  isCommander: boolean

  /** Is this a sub-agent? (spawned via Task tool) */
  isSubAgent: boolean

  /** Parent unit ID (if sub-agent) */
  parentUnitId?: string

  /** Hierarchy depth (0 = top-level) */
  depth: number

  /** Current status */
  status: UnitStatus

  /** Visual state */
  visual: {
    spriteScale: number
    statusRingColor: number
    auraColor?: number
    currentAnimation: string
  }

  /** Current nameplate text */
  nameplate: {
    primary: string     // "COMMANDER" or session name
    secondary?: string  // Current tool or task
    progress?: number   // 0-1 if estimable
  }

  /** Last activity timestamp (for idle detection) */
  lastActivity: number

  /** Timestamp when unit entered current status */
  statusSince: number
}

type UnitStatus =
  | 'spawning'    // Materialize animation playing
  | 'marching'    // Moving between hexes
  | 'idle'        // Waiting for orders
  | 'working'     // Executing tool calls
  | 'thinking'    // Between tool calls (Claude reasoning)
  | 'complete'    // Task finished, victory animation
  | 'returning'   // Marching back to parent/HQ
  | 'offline'     // Session disconnected
  | 'exhausted'   // Context tokens depleted
```

### 4.2 Hex Collision Avoidance

Multiple units should not stack on the same hex. When a unit is assigned to a territory, it picks a hex within that territory that isn't occupied:

```typescript
class HexOccupancyManager {
  // Maps hex coord string "q,r" -> unit IDs
  private occupied = new Map<string, Set<string>>()

  /**
   * Find the nearest unoccupied hex to the target within a territory.
   * Uses BFS radiating outward from the target hex.
   */
  findAvailableHex(
    target: HexCoord,
    territory: TerritoryId,
    unitId: string
  ): HexCoord {
    const key = `${target.q},${target.r}`
    const occupants = this.occupied.get(key)

    // If target is unoccupied or has only this unit, use it
    if (!occupants || occupants.size === 0 || (occupants.size === 1 && occupants.has(unitId))) {
      return target
    }

    // BFS for nearest empty hex in the same territory
    const visited = new Set<string>([key])
    const queue: HexCoord[] = getHexNeighbors(target)

    for (const neighbor of queue) {
      const nKey = `${neighbor.q},${neighbor.r}`
      if (visited.has(nKey)) continue
      visited.add(nKey)

      // Must be in the same territory
      if (getHexTerritory(neighbor) !== territory) continue

      const nOccupants = this.occupied.get(nKey)
      if (!nOccupants || nOccupants.size === 0) {
        return neighbor
      }

      // Add this hex's neighbors to the queue
      queue.push(...getHexNeighbors(neighbor))
    }

    // Extreme fallback: stack on the target hex
    // (visual offset applied in rendering — see below)
    return target
  }

  /**
   * When units DO share a hex (stacking), render them with small offsets:
   * - 1 unit: centered
   * - 2 units: offset left/right by 8px
   * - 3 units: triangle formation, offset by 8px
   * - 4+ units: circle formation, offset by 10px
   */
  getStackingOffset(unitId: string, hex: HexCoord): { x: number; y: number } {
    const key = `${hex.q},${hex.r}`
    const occupants = Array.from(this.occupied.get(key) || [])
    const index = occupants.indexOf(unitId)
    const count = occupants.length

    if (count <= 1) return { x: 0, y: 0 }

    const angle = (index / count) * Math.PI * 2
    const radius = count <= 3 ? 8 : 10
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    }
  }

  claim(hex: HexCoord, unitId: string): void {
    const key = `${hex.q},${hex.r}`
    if (!this.occupied.has(key)) this.occupied.set(key, new Set())
    this.occupied.get(key)!.add(unitId)
  }

  release(hex: HexCoord, unitId: string): void {
    const key = `${hex.q},${hex.r}`
    this.occupied.get(key)?.delete(unitId)
  }
}
```

### 4.3 Managed vs Observed Sessions

Sessions fall into two categories:

```typescript
interface SessionVisualCategory {
  /**
   * MANAGED: Created through the Agent Empires UI (Deploy button, command bar).
   * These are "your" units — full color, full interactivity.
   * - Full brightness sprites
   * - Nameplate with assigned name
   * - Full status ring
   * - Can receive orders via command bar
   * - Click to select, right-click for context menu
   */
  managed: {
    spriteOpacity: 1.0
    interactable: true
    showInControlGroups: true
    showInResourceBar: true
  }

  /**
   * OBSERVED: Detected via hook events but not created through Agent Empires.
   * These are "wild" sessions — the user's personal Claude Code terminal,
   * or a session from another tool.
   * - Slightly transparent (80% opacity)
   * - Nameplate shows Claude session ID (abbreviated)
   * - Dashed status ring (distinguishing visual)
   * - Can be "claimed" (right-click → Claim Session → becomes managed)
   * - Limited interaction until claimed
   */
  observed: {
    spriteOpacity: 0.8
    interactable: 'limited'   // Can click to view, but not command
    showInControlGroups: false
    showInResourceBar: false   // Doesn't count toward population cap
    statusRingStyle: 'dashed'
    claimable: true            // Right-click → "Claim as [unit type]"
  }
}
```

### 4.4 Unit Nameplate

Every unit displays a nameplate above its sprite:

```typescript
interface UnitNameplate {
  // Line 1: Unit name (bold, larger)
  // COMMANDER | Writer-01 | Scout-03 | [session-abc123]
  primaryLabel: string

  // Line 2: Current activity (smaller, muted)
  // "Reading config.ts" | "Building newsletter" | "Idle" | ""
  secondaryLabel: string

  // Line 3 (optional): Progress indicator
  // Only shown for long-running tasks with estimable progress
  progressBar?: {
    percent: number
    color: number   // Green for healthy, yellow for slow, red for stalled
  }

  // Visual properties
  backgroundColor: number   // Semi-transparent dark
  textColor: number         // White for managed, gray for observed
  maxWidth: 120             // pixels — text truncates with ellipsis
  offsetY: -30              // pixels above unit sprite center
}
```

The secondary label updates on every tool call:

```typescript
function getActivityLabel(event: ClaudeEvent): string {
  if (event.type === 'pre_tool_use') {
    switch (event.tool) {
      case 'Read':
        return `Reading ${basename(event.toolInput.file_path as string)}`
      case 'Write':
        return `Writing ${basename(event.toolInput.file_path as string)}`
      case 'Edit':
        return `Editing ${basename(event.toolInput.file_path as string)}`
      case 'Bash':
        return `Running ${truncate((event.toolInput as BashToolInput).command, 25)}`
      case 'Grep':
        return `Searching "${truncate(event.toolInput.pattern as string, 20)}"`
      case 'Glob':
        return `Finding ${truncate(event.toolInput.pattern as string, 20)}`
      case 'WebFetch':
        return `Fetching web page`
      case 'WebSearch':
        return `Searching web`
      case 'Task':
        return `Deploying sub-agent`
      default:
        if (event.tool.startsWith('mcp__')) {
          // Extract readable name from MCP tool
          const parts = event.tool.split('__')
          return `Using ${parts[parts.length - 1]}`
        }
        return `Using ${event.tool}`
    }
  }

  if (event.type === 'stop') return 'Complete'
  if (event.type === 'user_prompt_submit') return 'Receiving orders'

  return ''
}
```

### 4.5 Status Transitions

```
                    session_start
                         │
                         v
    ┌──────────────── SPAWNING ────────────────┐
    │                 (0.8s)                    │
    │                    │                      │
    │         materialize animation             │
    │                    │                      │
    │                    v                      │
    │               MARCHING                    │
    │            (to territory)                 │
    │                    │                      │
    │         arrives at target hex             │
    │                    │                      │
    │                    v                      │
    │    ┌────────── IDLE ◄──────────────┐     │
    │    │              │                │      │
    │    │    pre_tool_use              stop    │
    │    │              │                │      │
    │    │              v                │      │
    │    │          WORKING ─────────────┘     │
    │    │           │    │                     │
    │    │     no event   pre_tool_use          │
    │    │    for 3s      (continues)           │
    │    │           │                          │
    │    │           v                          │
    │    │       THINKING ──── pre_tool_use ──► WORKING
    │    │                                      │
    │    │                                      │
    │    │   subagent_stop ──► COMPLETE (1.5s)  │
    │    │                         │             │
    │    │                    dissolve/return    │
    │    │                         │             │
    │    │                    [unit removed]     │
    │    │                                      │
    │    │   session_end ──► OFFLINE             │
    │    │                     │                 │
    │    │               ghost sprite            │
    │    │              (50% opacity,            │
    │    │               desaturated,            │
    │    │               static pose)            │
    │    │                     │                 │
    │    │              session_start            │
    │    │              (reconnect)              │
    │    └─────────────────────┘                │
    │                                           │
    │   context exhausted ──► EXHAUSTED         │
    │                           │                │
    │                     collapsed sprite       │
    │                     (red pulse, fallen)    │
    │                     needs manual restart   │
    └───────────────────────────────────────────┘
```

### 4.6 Disconnected Session Handling

When a session goes offline (tmux health check fails, or `session_end` received):

```typescript
interface OfflineUnitVisuals {
  // Sprite becomes semi-transparent and desaturated
  opacity: 0.4
  saturation: 0.2   // PixiJS ColorMatrixFilter

  // Status ring turns dark red, stops animating
  statusRingColor: 0x660000
  statusRingPulse: false

  // Ghost particle effect: slow, sparse, upward-drifting particles
  // Like the unit is fading from existence
  ghostParticles: {
    color: 0x888888
    count: 3          // sparse
    speed: 0.5
    direction: 'up'
    opacity: [0.3, 0.0]
  }

  // Nameplate shows "[OFFLINE]" suffix
  nameplateModifier: ' [OFFLINE]'

  // Unit stays at its last known position
  // Does NOT return to HQ or dissolve — it's a ghost/memorial
  positionBehavior: 'freeze'

  // After 5 minutes offline, unit slowly sinks into the ground
  // (sprite Y position decreases, simulating sinking)
  sinkAfter: 300_000  // 5 minutes
  sinkDuration: 10_000
  sinkDistance: 15     // pixels downward

  // After 30 minutes offline, unit is removed from the battlefield
  // (unless it's the commander or a managed persistent session)
  removeAfter: 1_800_000  // 30 minutes
  removeExceptions: ['commander', 'managed-persistent']
}
```

---

## 5. Event-to-Animation Pipeline

For every Vibecraft/Agent Empires event type, this section specifies exactly what animation plays on which unit.

### 5.1 Master Event-Animation Map

```typescript
interface EventAnimationHandler {
  eventType: HookEventType
  resolveUnit: (event: ClaudeEvent) => BattlefieldUnit | null
  animation: AnimationSpec
}

const EVENT_ANIMATION_MAP: EventAnimationHandler[] = [
  // ─────────────────────────────────────────────────────────
  // pre_tool_use
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'pre_tool_use',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      // Unit enters WORKING state
      statusTransition: 'working',
      statusRingColor: 0x00FFFF,  // cyan

      // Tool-specific weapon animation
      spriteAnimation: (event: PreToolUseEvent) => {
        return TOOL_ANIMATIONS[event.tool] || TOOL_ANIMATIONS['default']
      },

      // Particle effect: small burst at unit's feet
      particles: {
        type: 'burst',
        count: 5,
        color: (event: PreToolUseEvent) => TOOL_COLORS[event.tool] || 0x00FFFF,
        spread: 15,
        lifetime: 500,
      },

      // Floating label update
      nameplate: (event: PreToolUseEvent) => ({
        secondaryLabel: getActivityLabel(event),
      }),

      // Sound: tool-specific (from Vibecraft sound system)
      sound: (event: PreToolUseEvent) => `tool-${event.tool.toLowerCase()}`,

      // Territory update: check if this tool call changes the unit's territory
      territoryCheck: true,
    },
  },

  // ─────────────────────────────────────────────────────────
  // post_tool_use
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'post_tool_use',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      // SUCCESS: green spark burst + brief glow
      onSuccess: {
        particles: {
          type: 'spark',
          count: 8,
          color: 0x00FF88,   // green
          spread: 20,
          lifetime: 600,
          direction: 'up',   // sparks fly upward
        },
        spriteFlash: {
          color: 0x00FF88,
          duration: 200,
          intensity: 0.3,
        },
        sound: 'result-success',
      },

      // FAILURE: red spark burst + shake animation
      onFailure: {
        particles: {
          type: 'spark',
          count: 12,
          color: 0xFF4444,   // red
          spread: 25,
          lifetime: 800,
          direction: 'scatter',
        },
        spriteShake: {
          intensity: 3,     // pixels
          duration: 400,
          frequency: 20,    // Hz
        },
        sound: 'result-error',

        // Small red "!" indicator above unit (fades after 3s)
        alertIndicator: {
          icon: '!',
          color: 0xFF4444,
          duration: 3000,
        },
      },

      // Nameplate clears secondary label after a delay
      // (will be replaced by next pre_tool_use or thinking state)
      nameplateDelay: {
        secondaryLabel: '',
        delay: 1500,
      },
    },
  },

  // ─────────────────────────────────────────────────────────
  // stop — Claude finished responding
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'stop',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      statusTransition: 'idle',
      statusRingColor: 0x00FF88,  // green (idle)

      // Completion animation depends on whether this is a sub-agent
      onSubAgent: {
        // Sub-agent: victory pose + dissolve (see Section 2.3)
        spriteAnimation: 'victory-pose',
        particles: {
          type: 'celebration',
          count: 20,
          color: 0xFFD700,
          spread: 30,
          lifetime: 1000,
          direction: 'up-scatter',
        },
        sound: 'task-complete',
        // Then trigger return/dissolve sequence (Section 2.3 Phase 7)
      },

      onTopLevel: {
        // Top-level session: subtle completion effect
        spriteAnimation: 'at-ease',   // relaxed idle pose
        particles: {
          type: 'shimmer',
          count: 6,
          color: 0x00FF88,
          spread: 10,
          lifetime: 800,
        },
        sound: 'stop',
      },

      // Clear command pennant (if commander)
      clearPennant: true,

      // Update nameplate
      nameplate: { secondaryLabel: 'Standing by' },
    },
  },

  // ─────────────────────────────────────────────────────────
  // user_prompt_submit — User sent a new prompt
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'user_prompt_submit',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      statusTransition: 'working',

      // Commander gets the full Command Broadcast (Section 1.4)
      onCommander: 'command-broadcast-animation',

      // Non-commander units: brief "orders received" animation
      onOther: {
        spriteAnimation: 'salute',  // quick acknowledgment pose
        particles: {
          type: 'pulse',
          count: 1,
          color: 0xFFD700,
          spread: 40,
          lifetime: 500,
        },
        sound: 'command-acknowledge',
      },

      // Show prompt pennant
      pennant: {
        text: (event: UserPromptSubmitEvent) => truncate(event.prompt, 40),
        duration: 'until-stop',
      },

      nameplate: { secondaryLabel: 'Processing orders' },
    },
  },

  // ─────────────────────────────────────────────────────────
  // notification — System notification
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'notification',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      // Notification type determines the visual
      handler: (event: NotificationEvent) => {
        switch (event.notificationType) {
          case 'permission_prompt':
            return {
              // Unit raises hand / attention pose
              spriteAnimation: 'attention',
              statusRingColor: 0xFFAA00,  // amber (waiting)
              statusTransition: 'waiting' as UnitStatus,

              // Pulsing exclamation above unit
              alertIndicator: {
                icon: '?',
                color: 0xFFAA00,
                duration: 'until-resolved',
                pulse: true,
              },

              // Territory-level attention pulse
              territoryAlert: {
                color: 0xFFAA00,
                pulse: true,
              },

              sound: 'attention-needed',
            }

          case 'idle_prompt':
            return {
              // Unit has been idle and Claude is prompting
              alertIndicator: {
                icon: '...',
                color: 0x888888,
                duration: 5000,
              },
            }

          default:
            return {
              // Generic notification: small info badge
              alertIndicator: {
                icon: 'i',
                color: 0x4488FF,
                duration: 3000,
              },
              sound: 'notification',
            }
        }
      },
    },
  },

  // ─────────────────────────────────────────────────────────
  // session_start — New session started
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'session_start',
    resolveUnit: (e) => {
      // This might be a new session we haven't seen
      // If it matches a pending sub-agent spawn, link it
      return getOrCreateUnitForSession(e.sessionId)
    },
    animation: {
      // If this is a KNOWN pending sub-agent: spawn animation (Section 2.3)
      onSubAgent: 'spawn-sequence',

      // If this is a NEW unrecognized session: quiet appearance
      onNewSession: {
        spriteAnimation: 'fade-in',
        particles: {
          type: 'converge',
          count: 10,
          color: 0x4488FF,
          spread: 50,
          lifetime: 600,
        },
        sound: 'session-new',
        // Classified as "observed" until claimed
        sessionCategory: 'observed',
      },

      // If this is a RECONNECTING session: ghost solidifies
      onReconnect: {
        spriteAnimation: 'solidify',  // opacity 0.4 -> 1.0
        particles: {
          type: 'shimmer',
          count: 8,
          color: 0x00FF88,
          spread: 15,
          lifetime: 500,
        },
        statusTransition: 'idle',
        sound: 'session-reconnect',
      },
    },
  },

  // ─────────────────────────────────────────────────────────
  // session_end — Session ended
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'session_end',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      statusTransition: 'offline',

      // Ghost effect: sprite fades and desaturates
      spriteAnimation: 'ghost-fade',
      fadeToOpacity: 0.4,
      desaturate: 0.8,

      // Slow upward particle drift (ghost dissipation)
      particles: {
        type: 'drift-up',
        count: 5,
        color: 0x888888,
        spread: 10,
        lifetime: 2000,
        continuous: true,   // keeps going while offline
        interval: 1000,     // new particles every second
      },

      // Status ring goes dark red, stops pulsing
      statusRingColor: 0x660000,

      sound: 'session-end',

      nameplate: { secondaryLabel: '[OFFLINE]' },
    },
  },

  // ─────────────────────────────────────────────────────────
  // subagent_stop — Sub-agent completed
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'subagent_stop',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      // Victory animation on the sub-agent's unit
      spriteAnimation: 'victory-pose',
      statusTransition: 'complete',

      // Golden burst
      particles: {
        type: 'celebration',
        count: 25,
        color: 0xFFD700,
        spread: 35,
        lifetime: 1200,
        direction: 'up-scatter',
      },

      // Loot orb: golden sphere floats from sub-agent to parent
      lootOrb: {
        color: 0xFFD700,
        size: 6,
        travelTime: 1500,  // ms to float to parent
        trail: true,       // sparkle trail behind the orb
        onArrive: {
          // When loot reaches parent, small reception particle burst
          particles: {
            type: 'absorb',
            count: 8,
            color: 0xFFD700,
            spread: 10,
            lifetime: 400,
          },
        },
      },

      sound: 'task-complete',

      // After victory animation, trigger dissolve sequence
      dissolveAfter: 2000,  // 2 seconds to enjoy the victory
    },
  },

  // ─────────────────────────────────────────────────────────
  // pre_compact — Context compaction triggered
  // ─────────────────────────────────────────────────────────
  {
    eventType: 'pre_compact',
    resolveUnit: (e) => getUnitBySessionId(e.sessionId),
    animation: {
      // Visual: unit glows briefly, "memory compression" effect
      spriteAnimation: 'compact',

      // Spiral particle effect: particles spiral inward toward unit
      // (represents context being compressed)
      particles: {
        type: 'spiral-inward',
        count: 15,
        color: 0xAA88FF,    // purple (memory/knowledge color)
        spread: 40,
        lifetime: 1500,
        rotationSpeed: 3,
      },

      // Health bar (context tokens) briefly flashes and resets upward
      healthBarFlash: {
        color: 0xAA88FF,
        duration: 500,
        // The actual token count updates when new session_start arrives
      },

      // Warning indicator
      alertIndicator: {
        icon: '~',          // compact symbol
        color: 0xAA88FF,
        duration: 2000,
      },

      sound: 'compact',      // ethereal compression sound

      nameplate: { secondaryLabel: 'Compacting memory...' },
    },
  },
]
```

### 5.2 Tool-Specific Animations

Each tool type has a distinct weapon/work animation:

```typescript
const TOOL_ANIMATIONS: Record<string, SpriteAnimationSpec> = {
  // Read: Unit pulls out scroll/book, quick read gesture
  Read: {
    name: 'read-scroll',
    frames: ['reach', 'hold-scroll', 'scan', 'return'],
    duration: 400,
    loop: false,
  },

  // Write: Unit pulls out quill/stylus, writes in air
  Write: {
    name: 'write-quill',
    frames: ['draw-quill', 'write-1', 'write-2', 'write-3', 'flourish'],
    duration: 600,
    loop: false,
  },

  // Edit: Unit holds wrench/tool, tightening gesture
  Edit: {
    name: 'edit-wrench',
    frames: ['grab-tool', 'adjust-1', 'adjust-2', 'tighten'],
    duration: 400,
    loop: false,
  },

  // Bash: Unit slams terminal/hammer down
  Bash: {
    name: 'bash-hammer',
    frames: ['raise', 'swing', 'impact', 'recover'],
    duration: 300,
    loop: false,
    impactFrame: 2,  // trigger screen shake on this frame
    screenShake: { intensity: 1, duration: 100 },
  },

  // Grep/Glob: Unit holds lens/scanner, sweeping motion
  Grep: {
    name: 'search-scan',
    frames: ['raise-lens', 'scan-left', 'scan-right', 'lower'],
    duration: 500,
    loop: false,
  },
  Glob: { /* same as Grep */ },

  // WebFetch/WebSearch: Unit raises antenna/beacon, receiving signal
  WebFetch: {
    name: 'web-beacon',
    frames: ['raise-antenna', 'signal-pulse-1', 'signal-pulse-2', 'receive'],
    duration: 600,
    loop: false,
  },
  WebSearch: { /* same as WebFetch */ },

  // Task: Unit raises staff, portal opens (Section 1.5)
  Task: {
    name: 'deploy-summon',
    frames: ['raise-staff', 'channel', 'portal-open', 'release'],
    duration: 800,
    loop: false,
  },

  // Default: generic gesture for unknown tools
  default: {
    name: 'generic-action',
    frames: ['prepare', 'execute', 'complete'],
    duration: 300,
    loop: false,
  },
}

// Color palette per tool type (for particles and effects)
const TOOL_COLORS: Record<string, number> = {
  Read:      0x4488FF,  // blue (knowledge)
  Write:     0x44FF88,  // green (creation)
  Edit:      0xFFAA44,  // orange (modification)
  Bash:      0xFF4444,  // red (execution/power)
  Grep:      0x88AAFF,  // light blue (search)
  Glob:      0x88AAFF,
  WebFetch:  0xAA44FF,  // purple (external)
  WebSearch: 0xAA44FF,
  Task:      0x00FFFF,  // cyan (delegation)
  TodoWrite: 0xFFFF44,  // yellow (planning)
  default:   0xCCCCCC,  // gray
}
```

---

## 6. The "Watching Claude Think" Experience

Between tool calls, Claude is reasoning — reading the results, deciding what to do next. This invisible thinking phase is where the intelligence lives, and it deserves visual representation.

### 6.1 Thinking State Detection

```typescript
class ThinkingStateDetector {
  // Per-session tracking
  private sessionTimers = new Map<string, {
    lastToolEnd: number      // timestamp of last post_tool_use
    thinkingTimeout: NodeJS.Timeout | null
    isThinking: boolean
  }>()

  private readonly THINKING_DELAY = 1500  // ms before "thinking" triggers
  private readonly MAX_THINKING = 60_000  // 60s max before it's "stalled"

  onPostToolUse(sessionId: string): void {
    const state = this.getOrCreate(sessionId)
    state.lastToolEnd = Date.now()
    state.isThinking = false

    // Clear existing timer
    if (state.thinkingTimeout) clearTimeout(state.thinkingTimeout)

    // Start new timer: if no pre_tool_use arrives within THINKING_DELAY,
    // transition to thinking state
    state.thinkingTimeout = setTimeout(() => {
      state.isThinking = true
      this.emit('thinking-start', sessionId)
    }, this.THINKING_DELAY)
  }

  onPreToolUse(sessionId: string): void {
    const state = this.getOrCreate(sessionId)

    if (state.thinkingTimeout) {
      clearTimeout(state.thinkingTimeout)
      state.thinkingTimeout = null
    }

    if (state.isThinking) {
      state.isThinking = false
      this.emit('thinking-end', sessionId)
    }
  }

  onStop(sessionId: string): void {
    // Claude finished — clear thinking state
    const state = this.getOrCreate(sessionId)
    if (state.thinkingTimeout) clearTimeout(state.thinkingTimeout)
    state.isThinking = false
    this.emit('thinking-end', sessionId)
  }

  private getOrCreate(sessionId: string) {
    if (!this.sessionTimers.has(sessionId)) {
      this.sessionTimers.set(sessionId, {
        lastToolEnd: 0,
        thinkingTimeout: null,
        isThinking: false,
      })
    }
    return this.sessionTimers.get(sessionId)!
  }

  private emit(event: string, sessionId: string): void {
    // EventBus emission — handled by the animation system
    eventBus.emit(event, { sessionId })
  }
}
```

**Why 1.5 seconds?** Tool calls that are rapid-fire (Read -> Read -> Read) should NOT trigger the thinking animation between each one. 1.5s is long enough to filter out inter-tool gaps but short enough that when Claude genuinely pauses to reason, the user sees it within 2 seconds.

### 6.2 Thinking Animation Variants

The thinking animation varies based on context — what was the last tool used, and what territory is the unit in?

```typescript
interface ThinkingAnimation {
  /** Base thinking visual: always shown */
  base: {
    // Pulsing aura around the unit (slower, softer than working aura)
    aura: {
      color: 0xAA88FF     // purple (cognition color)
      intensity: 0.3
      pulseSpeed: 3.0     // seconds per cycle (slow, contemplative)
      pulseRange: [0.15, 0.35]
    }

    // Status ring transitions to purple
    statusRingColor: 0xAA88FF

    // Unit sprite: subtle idle sway animation
    spriteAnimation: 'thinking-idle'

    // Nameplate shows thinking indicator
    nameplate: { secondaryLabel: 'Thinking...' }
  }

  /** Context-specific thinking overlays */
  variants: ThinkingVariant[]
}

const THINKING_VARIANTS: ThinkingVariant[] = [
  {
    // RESEARCH THINKING: after WebSearch/WebFetch or in lead-gen territory
    condition: (ctx) =>
      ctx.lastTool === 'WebSearch' || ctx.lastTool === 'WebFetch' ||
      ctx.territory === 'lead-gen',
    overlay: {
      // Small "?" symbols float up from the unit
      particles: {
        type: 'symbol-float',
        symbols: ['?', '...', '!'],
        count: 1,         // one symbol at a time
        interval: 2000,   // every 2 seconds
        color: 0x88AAFF,
        floatDistance: 30,
        lifetime: 2000,
      },
      // Thought bubble with magnifying glass icon
      thoughtBubble: {
        icon: 'magnifying-glass',
        size: 'small',
      },
    },
  },
  {
    // WRITING THINKING: after Edit/Write or in content territory
    condition: (ctx) =>
      ctx.lastTool === 'Edit' || ctx.lastTool === 'Write' ||
      ctx.territory === 'content',
    overlay: {
      // Small quill/pen icon in thought bubble
      thoughtBubble: {
        icon: 'quill',
        size: 'small',
      },
      // Faint text fragment particles (like letters dissolving)
      particles: {
        type: 'text-fragments',
        count: 2,
        interval: 3000,
        color: 0x44FF88,
        lifetime: 1500,
      },
    },
  },
  {
    // ENGINEERING THINKING: after Bash or in fulfillment territory
    condition: (ctx) =>
      ctx.lastTool === 'Bash' || ctx.territory === 'fulfillment',
    overlay: {
      // Gear icon in thought bubble
      thoughtBubble: {
        icon: 'gear',
        size: 'small',
      },
      // Small rotating gear particles
      particles: {
        type: 'rotating-symbol',
        symbols: ['gear'],
        count: 2,
        rotationSpeed: 1,
        color: 0xFFAA44,
        lifetime: 3000,
      },
    },
  },
  {
    // STRATEGY THINKING: commander unit or after Task/TodoWrite
    condition: (ctx) =>
      ctx.isCommander || ctx.lastTool === 'Task' || ctx.lastTool === 'TodoWrite',
    overlay: {
      // Strategy table appears in front of unit (small holographic display)
      strategyTable: {
        width: 40,
        height: 25,
        opacity: 0.4,
        color: 0xFFD700,
        animated: true,  // faint grid lines scroll across
      },
      thoughtBubble: {
        icon: 'crown',
        size: 'medium',
      },
    },
  },
  {
    // DEFAULT THINKING: generic contemplation
    condition: () => true,  // fallback — always matches
    overlay: {
      thoughtBubble: {
        icon: 'ellipsis',  // three dots
        size: 'small',
        animated: true,    // dots pulse sequentially
      },
    },
  },
]
```

### 6.3 Thought Bubble Rendering

```typescript
interface ThoughtBubble {
  /** The bubble sprite — small rounded rectangle above the unit */
  container: {
    width: 24           // pixels
    height: 20
    cornerRadius: 6
    backgroundColor: 0x1a1a2e
    borderColor: 0xAA88FF
    borderWidth: 1
    opacity: 0.85

    // Position: offset above unit, above the nameplate
    offsetY: -50

    // Bobbing animation: gentle float up/down
    bob: {
      amplitude: 2      // pixels
      frequency: 0.5    // Hz
    }

    // Tail: small triangle pointing down toward unit
    tail: true
  }

  /** Icon inside the bubble */
  icon: {
    name: string        // 'magnifying-glass', 'quill', 'gear', 'crown', 'ellipsis'
    size: 12           // pixels
    color: 0xAA88FF
    animated: boolean   // some icons pulse or rotate
  }
}
```

### 6.4 Stalled Thinking Detection

If a unit has been "thinking" for too long, it might be stalled:

```typescript
const THINKING_ESCALATION = {
  // Normal thinking: 1.5s - 15s
  // (most Claude reasoning fits here)
  normal: {
    threshold: 1500,
    animation: 'base-thinking',
  },

  // Extended thinking: 15s - 45s
  // (complex reasoning, large context processing)
  extended: {
    threshold: 15_000,
    animation: 'deep-thinking',  // aura intensifies, particles speed up
    nameplate: { secondaryLabel: 'Deep in thought...' },
  },

  // Possibly stalled: 45s - 90s
  // (might be waiting for something, or hitting rate limits)
  possiblyStalled: {
    threshold: 45_000,
    animation: 'stalled-warning',  // aura flickers, color shifts to amber
    nameplate: { secondaryLabel: 'Processing... (slow)' },
    alertIndicator: {
      icon: '~',
      color: 0xFFAA00,
      duration: 'until-resolved',
    },
  },

  // Stalled: >90s without a tool call
  // (something is likely wrong)
  stalled: {
    threshold: 90_000,
    animation: 'stalled',          // aura turns red, unit sprite slumps
    nameplate: { secondaryLabel: 'STALLED' },
    alertIndicator: {
      icon: '!',
      color: 0xFF4444,
      pulse: true,
    },
    sound: 'unit-stalled',
    // Notify the intel panel
    intelAlert: {
      severity: 'medium',
      title: 'Unit may be stalled',
    },
  },
}
```

---

## 7. TypeScript Interfaces

Complete type definitions for the Live Agent Visibility system. These extend the existing `shared/types.ts`.

```typescript
// ============================================================================
// File: shared/visibility-types.ts
// Live Agent Visibility System — Type Definitions
// ============================================================================

import type {
  ClaudeEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  HookEventType,
  ManagedSession,
} from './types'

// ─── Territory ───────────────────────────────────────────────────────────────

export type TerritoryId =
  | 'lead-gen'
  | 'content'
  | 'sales'
  | 'fulfillment'
  | 'support'
  | 'retention'
  | 'hq'

export interface TerritorySignal {
  territory: TerritoryId
  confidence: number
  source: string
}

export interface TerritoryClassifier {
  classify(event: ClaudeEvent): TerritorySignal[]
}

// ─── Units ───────────────────────────────────────────────────────────────────

export type UnitType =
  | 'commander'
  | 'lieutenant'
  | 'scout'
  | 'writer'
  | 'engineer'
  | 'operative'
  | 'medic'
  | 'diplomat'

export type UnitStatus =
  | 'spawning'
  | 'marching'
  | 'idle'
  | 'working'
  | 'thinking'
  | 'complete'
  | 'returning'
  | 'offline'
  | 'exhausted'

export interface HexCoord {
  q: number
  r: number
}

export interface BattlefieldUnit {
  id: string
  claudeSessionId: string
  managedSessionId?: string
  type: UnitType
  territory: TerritoryId
  hexPosition: HexCoord
  isCommander: boolean
  isSubAgent: boolean
  parentUnitId?: string
  depth: number
  status: UnitStatus
  visual: UnitVisualState
  nameplate: UnitNameplate
  lastActivity: number
  statusSince: number
}

export interface UnitVisualState {
  spriteScale: number
  statusRingColor: number
  statusRingStyle: 'solid' | 'dashed'
  auraColor?: number
  auraIntensity?: number
  currentAnimation: string
  opacity: number
  saturation: number
}

export interface UnitNameplate {
  primaryLabel: string
  secondaryLabel: string
  progressBar?: { percent: number; color: number }
  backgroundColor: number
  textColor: number
}

export interface UnitHierarchy {
  unitId: string
  parentUnitId: string | null
  depth: number
  scale: number
}

// ─── Session Routing ─────────────────────────────────────────────────────────

export interface SessionUnitMapping {
  claudeSessionId: string
  unitId: string
  isSubAgent: boolean
  parentToolUseId?: string
  spawnedAt: number
}

export interface PendingSpawn {
  toolUseId: string
  parentSessionId: string
  parentUnitId: string
  taskInput: {
    description: string
    prompt: string
    subagent_type: string
  }
  detectedUnitType: UnitType
  detectedTerritory: TerritoryId
  timestamp: number
}

// ─── Animations ──────────────────────────────────────────────────────────────

export interface ParticleSpec {
  type: 'burst' | 'spark' | 'converge' | 'drift-up' | 'spiral-inward'
       | 'celebration' | 'shimmer' | 'pulse' | 'absorb'
       | 'symbol-float' | 'text-fragments' | 'rotating-symbol'
  count: number
  color: number | ((event: ClaudeEvent) => number)
  spread: number
  lifetime: number
  direction?: 'up' | 'scatter' | 'up-scatter' | 'inward'
  continuous?: boolean
  interval?: number
  symbols?: string[]
  rotationSpeed?: number
}

export interface SpriteAnimationSpec {
  name: string
  frames: string[]
  duration: number
  loop: boolean
  impactFrame?: number
  screenShake?: { intensity: number; duration: number }
}

export interface ThinkingContext {
  sessionId: string
  lastTool: string
  territory: TerritoryId
  isCommander: boolean
  thinkingDuration: number
}

export interface ThinkingVariant {
  condition: (ctx: ThinkingContext) => boolean
  overlay: {
    particles?: ParticleSpec
    thoughtBubble?: {
      icon: string
      size: 'small' | 'medium' | 'large'
      animated?: boolean
    }
    strategyTable?: {
      width: number
      height: number
      opacity: number
      color: number
      animated: boolean
    }
  }
}

// ─── Deployment Animation ────────────────────────────────────────────────────

export interface DeploymentSequence {
  parentUnit: BattlefieldUnit
  newUnit: BattlefieldUnit
  targetTerritory: TerritoryId
  targetHex: HexCoord
  phases: {
    materialize: { duration: number }
    receiveOrders: { duration: number; orderText: string }
    march: { path: HexCoord[]; estimatedDuration: number }
  }
}

// ─── Loot Orb (sub-agent completion) ─────────────────────────────────────────

export interface LootOrb {
  fromUnitId: string
  toUnitId: string
  color: number
  size: number
  travelTime: number
  trail: boolean
}

// ─── Hex Occupancy ───────────────────────────────────────────────────────────

export interface HexOccupancy {
  hex: HexCoord
  unitIds: string[]
  stackingOffsets: Map<string, { x: number; y: number }>
}

// ─── Commander Tracking ──────────────────────────────────────────────────────

export interface CommanderState {
  unitId: string
  sessionId: string
  dominantTerritory: TerritoryId
  driftPosition: HexCoord
  recentTerritories: { territory: TerritoryId; timestamp: number }[]
  pennantText?: string
}

// ─── Event Animation Mapping ─────────────────────────────────────────────────

export interface EventAnimationEntry {
  eventType: HookEventType
  resolveUnit: (event: ClaudeEvent) => BattlefieldUnit | null
  getAnimation: (event: ClaudeEvent, unit: BattlefieldUnit) => AnimationCommand[]
}

export interface AnimationCommand {
  type: 'status-transition' | 'sprite-animation' | 'particles'
       | 'sound' | 'nameplate-update' | 'alert-indicator'
       | 'territory-check' | 'loot-orb' | 'pennant'
       | 'sprite-flash' | 'sprite-shake' | 'aura-change'
       | 'dissolve' | 'ghost-fade'
  payload: Record<string, unknown>
  delay?: number
  duration?: number
}
```

---

## 8. Implementation Plan

### Phase 0a (Today): Core Plumbing

1. **Add `shared/visibility-types.ts`** with all types from Section 7
2. **Implement `TerritoryDetector`** class with all five classifiers (Section 3)
3. **Implement `SessionToUnitRouter`** to map sessionIds to units (Section 2.4)
4. **Implement `ThinkingStateDetector`** (Section 6.1)
5. **Extend `ManagedSession`** with `role: UnitType` and `parentSessionId` fields

### Phase 0b (Today): Minimal Visuals

6. **Commander identification** — mark the prime session, render crown insignia
7. **Unit sprites at territory positions** — static placement based on territory detection
8. **Status ring colors** — idle (green), working (cyan), thinking (purple), offline (red)
9. **Nameplate with activity label** — show current tool name

### Phase 1a (This Week): Animation Pipeline

10. **Event-to-animation router** — process each event through the master map (Section 5)
11. **Tool-specific particle effects** — burst on pre_tool_use, spark on post_tool_use
12. **Thinking state animation** — pulsing aura + thought bubble after 1.5s gap
13. **Sub-agent spawn animation** — materialize + march sequence

### Phase 1b (This Week): Multi-Session

14. **Hex occupancy manager** — collision avoidance (Section 4.2)
15. **Managed vs observed session styling** — opacity and ring differences
16. **Offline ghost sprites** — fade + desaturate on session_end
17. **Loot orb** on subagent_stop — golden orb returns to parent

### Phase 2 (Next Week): Polish

18. **Commander drift** — gravitational pull toward focused territory
19. **Command broadcast animation** on user_prompt_submit
20. **Context-specific thinking variants** — research/writing/engineering/strategy
21. **Stalled detection** with escalating visual warnings
22. **Connection lines** — animated dashes from commander to active sub-agents

---

## Appendix: Event Flow Diagram

Complete lifecycle of a typical multi-agent interaction:

```
USER types: "Research competitor pricing and draft a comparison doc"
    │
    │  user_prompt_submit (sessionId: cmd-001)
    │
    ├──► COMMANDER: Command Broadcast animation
    │    - Golden ring expands outward
    │    - Pennant shows "Research competitor pricing..."
    │    - Status: idle → working
    │
    │  [Claude thinks for ~2s]
    │
    │  pre_tool_use: Read (file: domains/sales/context/competitors.md)
    │    sessionId: cmd-001
    │
    ├──► COMMANDER: Read animation (scroll gesture)
    │    - Blue particles burst
    │    - Territory signal: sales (0.95)
    │    - Commander drift begins toward Sales territory
    │
    │  post_tool_use: Read (success: true)
    │
    ├──► COMMANDER: Green spark burst
    │
    │  [Claude thinks for 1.8s → thinking state triggers]
    │
    ├──► COMMANDER: Thinking animation
    │    - Purple pulsing aura
    │    - Thought bubble with magnifying glass (research context)
    │
    │  pre_tool_use: Task (description: "Research competitor pricing")
    │    sessionId: cmd-001
    │
    ├──► COMMANDER: Deploy animation
    │    - Portal circle at feet
    │    - New SCOUT unit materializes (keyword: "research")
    │    - Animated dash-line from commander to scout
    │
    │  session_start (sessionId: sub-042)
    │    [Linked to pending spawn]
    │
    ├──► SCOUT: Spawn complete, begins march to lead-gen territory
    │    - A* path from commander position to Lead-Gen
    │    - 3-second march animation
    │
    │  pre_tool_use: WebSearch (sessionId: sub-042)
    │
    ├──► SCOUT: WebSearch animation (antenna/beacon gesture)
    │    - Purple particles (external tool color)
    │    - Nameplate: "Searching web"
    │    - [Meanwhile commander continues separately...]
    │
    │  pre_tool_use: Task (description: "Draft comparison document")
    │    sessionId: cmd-001
    │
    ├──► COMMANDER: Second deploy animation
    │    - WRITER unit materializes
    │    - Marches to Content territory
    │
    │  [Both sub-agents working in parallel, animations on their own sprites]
    │
    │  subagent_stop (sessionId: sub-042)
    │
    ├──► SCOUT: Victory pose + golden burst
    │    - Loot orb floats back to Commander
    │    - Commander receives loot (absorption particles)
    │    - Scout dissolves (reverse particle scatter)
    │
    │  subagent_stop (sessionId: sub-043)
    │
    ├──► WRITER: Victory pose + golden burst
    │    - Loot orb floats to Commander
    │    - Writer dissolves
    │
    │  stop (sessionId: cmd-001)
    │
    └──► COMMANDER: Completion animation
         - Status: working → idle
         - Green shimmer particles
         - Pennant fades
         - Commander drifts back toward HQ
         - Nameplate: "Standing by"
```
