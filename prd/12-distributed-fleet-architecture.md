# Agent Empires — Distributed Fleet Architecture

## Sub-PRD 12 — The Empire Stretches

**Parent PRD:** `01-vision.md` (Phase 5+)
**Dependencies:** `07-remote-forces.md` (remote event ingestion, transport), `04-autonomous-monitoring.md` (heartbeat/freshness model), `11-geographic-zoom-system.md` (remote agents render at national zoom), `02b-enemy-system-spec.md` (threats are what agents fight)
**System:** Multi-machine Claw fleet management, unit persistence tiers, heartbeat protocol, RTS command mapping, attention scaling
**Last updated:** 2026-03-10

---

## Table of Contents

1. [Vision](#1-vision)
2. [Unit Persistence Model](#2-unit-persistence-model)
3. [Distributed Topology](#3-distributed-topology)
4. [Heartbeat Protocol](#4-heartbeat-protocol)
5. [RTS Command Mapping](#5-rts-command-mapping)
6. [Attention Scaling](#6-attention-scaling)
7. [The Ender Pattern](#7-the-ender-pattern)
8. [Three Scaling Limiters](#8-three-scaling-limiters)
9. [Implementation Plan](#9-implementation-plan)
10. [Dependencies](#10-dependencies)

---

## 1. Vision

PRD 07 solved a mechanical problem: how do events from a remote machine reach the war room? This PRD solves the strategic problem that 07 enables: **how does one human command a fleet of Claw instances distributed across multiple machines, with each instance having a different lifespan, autonomy level, and purpose?**

The bottleneck is not compute. A Hetzner VPS is $5/month. Claw subscriptions are flat-rate. The bottleneck is not cost. The bottleneck is **attention**. Every Claw instance you spin up is another thing demanding your eyeballs. Without structure, the failure mode is predictable: you launch 8 agents, 3 go idle because you forgot about them, 2 duplicate work because you didn't coordinate, 1 hits an error and burns context spinning on it for 40 minutes while you're looking at something else, and 2 actually do useful work. That's a 25% efficiency rate. Pathetic.

The distributed fleet architecture attacks this problem at every layer:

1. **Unit persistence tiers** eliminate the "what kind of agent is this?" question. Generals last forever. Officers last hours. Operatives last minutes. You know what you're looking at instantly.
2. **The heartbeat protocol** compresses "SSH into machine, read scrollback, assess status" from 30-60 seconds into a structured JSON packet that renders as a glanceable status ring.
3. **RTS command mapping** lets you issue orders through the interface instead of alt-tabbing to terminals. Select unit, issue command, zoom out. 2-3 seconds.
4. **Attention scaling curves** define exactly how the system behaves at 5 agents, 15 agents, and 30+ agents — because the answer is different at each scale.

The result: a local Claw on your Mac and a Claw on a VPS 3,000 miles away look identical on the battlefield. Same unit sprite. Same status ring. Same command interface. The only visual difference is a subtle signal wave on remote units indicating network latency.

---

## 2. Unit Persistence Model

Not all agents are created equal. A CEO agent that runs all day is fundamentally different from a sub-agent that lives for 90 seconds to extract a PDF. Treating them the same on the map is a lie — and lies in your command interface get people (agents) killed (context-exhausted).

### 2.1 Three Tiers

| Tier | Name | Battlefield Title | Lifespan | Spawn Method | Map Behavior |
|------|------|------------------|----------|-------------|-------------|
| **General** | User | The user's own sessions | Session-long (hours to all-day) | Manual — user opens a Claw instance | Always visible, never fade, crown icon, prominent status ring |
| **Officer** | Department Head | Persistent Claw instances with domain context | Hours | Deployed via war room or bootstrap script on a VPS | Visible, fade to 50% opacity after 30min idle, revivable with a click, shield icon |
| **Operative** | Sub-agent | Spawned for one task, returns result, dies | Seconds to minutes | Spawned by a General or Officer (the Meeseeks pattern) | Flash in with spawn particle, execute, shrink-die on completion, crosshair icon |

### 2.2 General Tier — The User

Generals are the user's own Claw sessions. On the local Mac, this is whatever tmux windows you have open. On a remote machine, this would be a persistent SSH session you're actively working in.

**Rules:**
- Always rendered at full size and opacity
- Crown icon — instantly distinguishable from all other units
- Status ring is thicker (4px vs 2px for other tiers)
- Never auto-killed, never faded, never garbage-collected
- If a General goes idle, the status ring shifts to amber but the unit stays fully visible
- Maximum simultaneous Generals: practical limit ~3 (you only have so many screens)

### 2.3 Officer Tier — Department Heads

Officers are the backbone of the fleet. They are persistent Claw instances — running on your Mac in a tmux window, or on a VPS with a domain-specific CLAUDE.md loaded — that manage a business front for hours at a stretch.

**Examples:**
- Content Officer on VPS #1: loaded with content CLAUDE.md, runs content generation cycles, spawns Operatives for individual posts
- Sales Officer on VPS #2: monitors pipeline, preps call briefs, alerts on aging deals
- Support Officer on local Mac: watches ticket queue, drafts responses, escalates blockers

**Rules:**
- Shield icon with territory-colored tint
- Fade to 50% opacity after 30 minutes of idle (no heartbeat status change)
- Revivable: clicking a faded Officer sends a wake-up prompt ("Status report. What's your current state?")
- Auto-kill after configurable timeout (default: 4 hours idle) to prevent context-exhausted zombies
- Officers can spawn Operatives — this is their primary scaling mechanism
- Maximum Officers per machine: limited by Claw subscription (typically 5 concurrent)

**Officer Deployment Template:**

```typescript
interface OfficerDeployment {
  tier: 'officer'
  name: string                     // "Content Lead", "Sales Ops"
  machineId: string                // Which machine to deploy on
  territory: string                // Which business domain
  claudeMdPath: string             // Domain-specific CLAUDE.md to load
  initialPrompt: string            // Boot prompt — what's the mission?
  idleTimeoutMs: number            // Auto-kill after this much idle (default: 4h)
  escalationRules: EscalationRule[] // When to ping the General
  maxOperatives: number            // How many sub-agents can it spawn? (default: 3)
}
```

### 2.4 Operative Tier — The Meeseeks

"I'm Mr. Meeseeks, look at me!" An Operative exists to serve a single purpose and then cease to exist. It is spawned by a General or Officer, given a task, completes the task (or fails), writes output to disk/Supabase, and dies.

**Examples:**
- "Extract key points from this PDF" — spawns, reads PDF, writes summary to file, dies
- "Research competitor pricing page" — spawns, browses, writes findings, dies
- "Run quality audit on this draft" — spawns, audits, writes score, dies

**Rules:**
- Crosshair icon, smaller than Officers (70% size)
- Flash-in animation on spawn (particle burst + rapid scale from 0 to 100%)
- Shrink-die animation on completion (scale to 0 over 300ms + fade + final particle pop)
- No idle timeout — they either complete or hit context limits
- Failed Operatives turn red before dying, leaving a brief "tombstone" marker for 60 seconds
- Completed Operatives leave a brief green "checkmark" marker for 30 seconds
- Never directly commanded by the user — only by their parent General/Officer
- Maximum lifespan: 10 minutes. If still running, the parent gets an escalation alert

### 2.5 Tier Transitions

Tiers are fixed at spawn. An Operative cannot be promoted to Officer mid-task. However:

- An Officer can be **decommissioned** — gracefully shut down with a "wrap up and write final report" prompt
- A repeatedly-spawned Operative pattern can be **promoted to a Patrol** — converting it from ephemeral spawns to a recurring Officer behavior (see Section 5: RTS Command Mapping)

### 2.6 Visual Hierarchy

The tier system creates an instant visual hierarchy on the battlefield:

```
GENERAL (crown, large, always visible, thick status ring)
  └── OFFICER (shield, medium, territory-tinted, may be faded)
        └── OPERATIVE (crosshair, small, appears/disappears rapidly)
```

At a glance, you know: the crown is you. The shields are your department heads. The crosshairs are the worker bees. If you see a territory with only crosshairs and no shield, something went wrong — the Officer crashed or was killed.

---

## 3. Distributed Topology

### 3.1 The Fleet Map

```
LOCAL MAC (your desk — the command tent)
├── CEO Agent (General — your primary Claw session)
├── Agent Empires UI (browser — the war room map)
├── Agent Empires Server (aggregates all heartbeats, manages state)
├── Local Officers (tmux windows — Content Lead, Support Lead)
└── Local Operatives (spawned by local Officers, ephemeral)

VPS #1 — Hetzner, Ashburn VA ($5/mo)
├── Content Officer (persistent Claw, content-domain CLAUDE.md)
├── Content Operatives (spawned as needed — draft writers, editors, researchers)
└── Heartbeat Agent (lightweight process → Agent Empires server)

VPS #2 — Hetzner, Helsinki ($5/mo)
├── Sales Officer (persistent Claw, sales-domain CLAUDE.md)
├── Sales Operatives (deal research, call prep, proposal drafts)
└── Heartbeat Agent → Agent Empires server

OPENCLAW INSTANCE (cloud Claw, no SSH access)
├── Claw session(s) with hook configured per PRD 07
└── Events flow via Supabase relay (Transport Option B from 07)
```

### 3.2 Machine Registry

Every machine in the fleet is registered with the Agent Empires server. This is the `machines.config.json` that PRD 07 introduced, extended with fleet-specific metadata:

```typescript
interface MachineRegistration {
  id: string                       // "local-mac", "vps-ashburn", "openclaw-alpha"
  name: string                     // Human-readable label for the map
  location: {
    label: string                  // "Ashburn, VA" — for geographic zoom rendering
    lat: number                    // 39.0438 — for national-tier positioning
    lng: number                    // -77.4874
  }
  transport: 'direct' | 'relay' | 'hybrid'  // From PRD 07
  maxConcurrentClaws: number       // Subscription/resource limit on this machine
  activeClaws: ClawInstance[]      // Current running instances (updated via heartbeat)
  status: 'online' | 'degraded' | 'offline'
  lastHeartbeat: number            // Unix timestamp
  costPerHour?: number             // Optional — for the resource economy display
}

interface ClawInstance {
  sessionId: string
  tier: 'general' | 'officer' | 'operative'
  name: string                     // "Content Lead", "PDF Extractor #3"
  territory: string                // Which business domain
  status: 'working' | 'idle' | 'stuck' | 'completing' | 'dead'
  currentTask: string              // One-line description
  contextUsagePercent: number      // 0-100
  spawnedAt: number                // Unix timestamp
  parentSessionId?: string         // If Operative, who spawned it
  escalationFlags: EscalationFlag[]
}

type EscalationFlag =
  | 'need_human_input'
  | 'hit_error'
  | 'task_complete'
  | 'context_exhausted'
  | 'stuck_loop'
  | 'awaiting_approval'
```

### 3.3 Geographic Rendering

Remote machines render at their physical location on the national zoom tier (PRD 11). When you zoom out from theater to national, your local Mac's agents collapse into the Phoenix base node. The Ashburn VPS appears as a satellite node on the Virginia coast. The Helsinki VPS glows faintly in Northern Europe on the global tier.

Each satellite node follows the same rules as the Phoenix base node:
- Outer ring color = worst active threat on that machine
- Inner glow intensity = number of active Claws
- Hovering shows tooltip: machine name, active agents count, top task
- Clicking zooms into a theater-style sub-view of THAT machine's agents

This means the general can see, at national zoom: "My Mac in Phoenix has 4 agents running green. Ashburn has 2 agents, one amber (idle). Helsinki is offline." In one glance. No SSH. No alt-tab.

### 3.4 The Identical Unit Principle

This is the non-negotiable design rule: **a Claw instance on your local Mac and a Claw instance on a VPS 3,000 miles away look identical on the battlefield.**

Same unit sprite. Same status ring. Same tier icon. Same command interface. The only visual difference:

- **Local units:** Solid status ring, no signal indicator
- **Remote units:** Status ring with a subtle animated "signal wave" — a sine-wave displacement along the ring circumference. The wave frequency indicates latency:
  - < 50ms: fast pulse (barely visible)
  - 50-200ms: moderate pulse
  - 200-500ms: slow, visible pulse
  - 500ms+: very slow pulse, ring gets a slight grain/static texture
  - Disconnected: ring goes fully static/grainy, unit fades to ghost opacity

This treatment is from PRD 07's visual spec, extended with the latency-frequency mapping.

---

## 4. Heartbeat Protocol

PRD 07 handles raw event ingestion — every tool call, every file write, every prompt/response flows from remote machines to the server. The heartbeat protocol is a **layer on top of that**: a lightweight, structured status summary sent at fixed intervals, designed for the fleet management view rather than the activity feed.

### 4.1 Heartbeat Payload

```typescript
interface Heartbeat {
  // Identity
  machineId: string
  sessionId: string
  tier: 'general' | 'officer' | 'operative'
  name: string

  // Status
  status: 'working' | 'idle' | 'stuck' | 'completing' | 'dead'
  currentTask: string              // One-line: "Writing LinkedIn post about skill stacking"
  territory: string                // Which business domain

  // Health
  contextUsagePercent: number      // 0-100
  uptimeSeconds: number            // How long since spawn
  lastToolCallAt: number           // Unix timestamp of last tool execution

  // Activity snapshot
  recentToolCalls: ToolCallSummary[]  // Last 5 tool calls (name + timestamp, no payloads)
  filesWritten: string[]              // Files created/modified in last heartbeat interval
  filesRead: string[]                 // Files read in last heartbeat interval

  // Escalation
  escalationFlags: EscalationFlag[]
  escalationMessage?: string       // Human-readable context for the flag

  // Operatives (only for Officers)
  activeOperatives?: {
    count: number
    statuses: Array<{ name: string, status: string, task: string }>
  }

  // Metadata
  heartbeatVersion: 1
  sentAt: number                   // Unix timestamp
}

interface ToolCallSummary {
  tool: string                     // "Read", "Write", "Bash", "Edit"
  timestamp: number
  durationMs?: number
}
```

### 4.2 Heartbeat Frequency

| Tier | Interval | Rationale |
|------|----------|-----------|
| General | 10 seconds | You're looking at this. Keep it fresh. |
| Officer | 30 seconds | Important but not moment-to-moment. |
| Operative | 15 seconds | Short-lived, need to catch state changes before they die. |
| Machine-level | 60 seconds | "Am I alive?" check, separate from per-Claw heartbeats. |

### 4.3 Heartbeat Generation

On each machine, a lightweight heartbeat agent runs alongside the Claw instances. It does NOT run inside the Claw sessions (that would consume context tokens). It is a separate process that:

1. Reads tmux pane content for each Claw window (via `tmux capture-pane`)
2. Parses the latest tool calls from the hook event log (`~/.agent-empires/events.jsonl`)
3. Checks process health (is the Claw session still responding?)
4. Packages the heartbeat payload
5. Sends it via the configured transport (direct POST or Supabase relay)

```bash
# heartbeat-agent.sh — runs on every fleet machine
# Launched by the bootstrap script, runs as a background process

HEARTBEAT_INTERVAL=${AE_HEARTBEAT_INTERVAL:-30}  # seconds
AE_SERVER_URL="${AE_SERVER_URL}"
AE_MACHINE_ID="${AE_MACHINE_ID}"

while true; do
  # Collect status from all Claw tmux windows
  for window in $(tmux list-windows -t agent-empires -F '#{window_index}:#{window_name}'); do
    window_id=$(echo "$window" | cut -d: -f1)
    window_name=$(echo "$window" | cut -d: -f2)

    # Capture last 50 lines of the pane
    pane_content=$(tmux capture-pane -t "agent-empires:$window_id" -p -S -50)

    # Extract status from pane content (working/idle/stuck heuristics)
    status=$(classify_status "$pane_content")

    # Extract current task from pane content
    current_task=$(extract_current_task "$pane_content")

    # Read context usage from hook events
    context_pct=$(get_context_usage "$window_name")

    # Build and send heartbeat
    send_heartbeat "$window_name" "$status" "$current_task" "$context_pct"
  done

  sleep "$HEARTBEAT_INTERVAL"
done
```

### 4.4 Status Classification

The heartbeat agent classifies Claw status using simple heuristics from the pane content:

| Status | Detection Heuristic |
|--------|-------------------|
| **working** | Tool call happened in the last 30 seconds |
| **idle** | No tool call in > 60 seconds, prompt is visible (waiting for input) |
| **stuck** | Same tool call repeated 3+ times OR error message visible in pane OR no progress in > 5 minutes while status was "working" |
| **completing** | Output file being written OR "task complete" in recent output |
| **dead** | tmux window no longer exists OR process exited |

### 4.5 Heartbeat Rendering

On the battlefield, each heartbeat updates the unit's visual state:

- **Status ring color:** Green (working), cyan (idle), amber (stuck), red (dead)
- **Context bar:** Horizontal bar under the unit, depletes left-to-right as context fills
- **Task label:** Floating text above the unit, updates with `currentTask` from heartbeat
- **Escalation ping:** If `escalationFlags` is non-empty, the unit emits a pulsing attention ping on the minimap (sound + visual, severity-coded)

### 4.6 Heartbeat Failure Detection

If a machine's heartbeat stops:

| Silence Duration | Response |
|-----------------|----------|
| 1 missed heartbeat | No action (network hiccup) |
| 2 missed heartbeats | Unit status ring goes amber, signal wave slows |
| 3 missed heartbeats | Unit goes "ghost" (50% opacity, static ring texture), minimap warning |
| 5 missed heartbeats | Unit marked offline, territory fog increases, alert pushed to notification tray |
| 10+ missed heartbeats | Machine marked offline, all its units go ghost, "Lost Contact" label |

This follows PRD 07's principle: connection loss is fog of war, not failure.

---

## 5. RTS Command Mapping

The whole point of the RTS interface is that 30 years of genre UX innovation solved the problem of one human managing many autonomous units. Here's what maps and what doesn't.

### 5.1 Commands That Map

#### Select + Order

Click a unit, issue a command. This is the foundational RTS interaction and it maps perfectly.

- **Local unit:** Click unit on map → command bar focuses → type order → `tmux send-keys` to that Claw's window
- **Remote unit:** Click unit on map → command bar focuses → type order → dispatch via PRD 07's command delivery (direct POST or Supabase command queue)

For Officers, "issue a command" often means delegation: the Officer receives the order, decomposes it, and spawns Operatives. You don't micromanage the Operatives — you told the Officer what to do.

#### Rally Point

Set the default territory for new units spawned from a machine. When a VPS's Officer spawns Operatives, they inherit the rally point territory.

```typescript
interface RallyPoint {
  machineId: string
  territory: string                // Default territory for new spawns
  defaultPromptSuffix?: string     // Appended to every Operative's initial prompt
}
```

**Map interaction:** Right-click a territory → "Set as rally point for [machine]" → future Operatives from that machine auto-position in that territory.

#### Control Groups (Ctrl+1-9)

Save unit selections for instant recall. This is how you manage at scale.

```typescript
interface ControlGroup {
  slot: number                     // 1-9
  label?: string                   // "Content Team", "Sales Floor"
  unitIds: string[]                // Session IDs (local + remote)
}
```

**Usage:** Select Content Officer + its two active Operatives → Ctrl+1 → now pressing "1" selects all three. Type a command → it goes to all selected units as a batch order.

**Batch order semantics:** The command is sent to every unit in the control group. Each unit interprets it independently. This is "all units, advance" — not "first unit does step 1, second does step 2." For sequential orchestration, use an Officer.

**Cross-machine control groups:** A control group can contain units from different machines. Ctrl+1 might select a local Officer and a remote Operative. The command routing layer handles delivery to each machine's transport.

#### Patrol / Waypoint

Recurring monitoring tasks, visualized as patrol loops on the map. This is the agent-runner cron equivalent, but visible.

```typescript
interface PatrolRoute {
  unitId: string                   // The patrolling Officer
  waypoints: PatrolWaypoint[]
  intervalMs: number               // How often to complete the circuit
  active: boolean
}

interface PatrolWaypoint {
  territory: string
  action: string                   // "Check support tickets", "Audit content queue"
  maxDurationMs: number            // Move on if action takes too long
}
```

**Map rendering:** A dashed animated line loops between territories, showing the patrol route. The Officer's icon moves along the route as it executes each waypoint's action.

**This replaces invisible cron jobs with visible patrol routes.** You can see that the Support Officer patrols Support → Fulfillment → Support every 30 minutes. If it stops moving, something's wrong.

#### Attack-Move

"Deploy to this territory and handle all threats." The unit moves to the territory, identifies enemies (from PRD 02b), and engages them in priority order.

**Implementation:** Send the Officer a prompt that includes:
1. The territory's current threat list (from `ae_intel`)
2. Standing orders: "Resolve all threats in this territory. Start with CRITICAL, then HIGH. Report when clear."
3. The Officer spawns Operatives as needed to handle individual threats

**Map rendering:** The unit moves toward the territory with a red-tinted movement trail. When it arrives, engagement lines appear between the unit and enemy sprites as threats are worked.

#### Retreat / Recall

Kill sub-agents that are burning context on dead ends. Essential for preventing the #1 failure mode: an agent spinning on an impossible task for 40 minutes.

- **Soft retreat:** Send "Stop current task, save progress, report status" → the Claw wraps up gracefully
- **Hard retreat:** Kill the tmux window / terminate the Claw process → immediate death, no save
- **Recall:** Pull all Operatives back to their parent Officer → each gets "Stop, write output to disk, exit"

**Map interaction:** Select unit → press `R` → soft retreat. `Shift+R` → hard retreat. Select Officer → press `R` → recall all its Operatives.

### 5.2 Commands That Don't Map

Not everything from RTS translates. Acknowledging what DOESN'T work prevents building features that mislead.

| RTS Command | Why It Doesn't Map |
|------------|-------------------|
| **Box-select to redirect mid-task** | You can't merge or redirect a running Claw instance's context. Box-selecting 5 agents and saying "everyone do this different thing now" doesn't work — each agent has its own context window. You can send them all the same NEW prompt, but you can't merge their existing work. |
| **Resource gathering** | Revenue is a scoreboard metric, not a mechanic. Agents don't "gather gold." Revenue appears as a campaign metric and resource bar number. |
| **Building placement** | Skill creation is tech tree research, not building placement. You don't "place a barracks" — you run `/skills:create` in an Engineer session. |
| **Fog-of-war reveal via unit movement** | Fog in Agent Empires is driven by data freshness, not unit position. Moving a unit to a territory doesn't clear fog — the unit must actually check data sources (run monitors, query APIs). |
| **Unit formation** | Agents don't benefit from spatial positioning relative to each other. There's no "flanking bonus" for running 3 content agents simultaneously. |

### 5.3 Keyboard Shortcut Extensions

Building on `01-vision.md` Section 7 shortcuts, adding fleet-specific bindings:

| Key | Action |
|-----|--------|
| `Ctrl+1-9` | Recall control group |
| `Ctrl+Shift+1-9` | Assign selected units to control group |
| `D` | Deploy new unit (opens deployment dialog — pick tier, machine, territory) |
| `R` | Soft retreat selected unit(s) |
| `Shift+R` | Hard retreat (kill) selected unit(s) |
| `P` | Set patrol route for selected Officer |
| `A` | Attack-move selected unit to clicked territory |
| `Shift+A` | Select all units in current territory |
| `H` | Jump to home machine (local Mac) |
| `N` | Cycle through machines (next machine's theater view) |

---

## 6. Attention Scaling

The fleet architecture is designed around a truth: managing 5 agents is a different activity than managing 15, which is a different activity than managing 30. The interface must adapt.

### 6.1 Without the War Room (Current State)

| Agent Count | Experience |
|------------|-----------|
| 1-3 | Manageable. Alt-tab between terminals. Read scrollback. Issue commands. |
| 4-7 | Stressful. Losing track of what each agent is doing. Starting to forget about agents. Discovering idle agents 20 minutes later. |
| 8+ | Impossible. Agents idle or duplicate work. You're context-switching faster than the agents are. Net negative productivity — would be faster to do it yourself. |

### 6.2 With the War Room

| Agent Count | Mode | Experience |
|------------|------|-----------|
| 1-5 | **Direct command** | Glance at map, everything's green, command individual units. Feels like playing an RTS in the early game — you have time, you're building. |
| 5-15 | **Control group management** | Control groups become essential. "Content team, status." "Sales team, priority shift." You're issuing orders to groups, not individuals. Territory view shows which fronts are covered. Exception alerts pull you to problems. |
| 15-30 | **General mode** | Officers manage fronts. You respond to escalations, not tasks. The map is your primary interface — not terminals. Green territories = don't touch. Amber territories = check in. Red = intervene. You're Eisenhower, not a squad leader. |
| 30+ | **AI officers with autonomous authority** | Officers make tactical decisions without asking. They spawn Operatives, prioritize threats, reroute resources. You only see escalations that Officers themselves can't resolve. The war room shows you the war, not the battles. |

### 6.3 Interface Adaptations by Scale

The UI should adapt to agent count:

```typescript
interface ScaleMode {
  mode: 'direct' | 'control_group' | 'general' | 'autonomous'
  agentThreshold: number
  uiChanges: string[]
}

const SCALE_MODES: ScaleMode[] = [
  {
    mode: 'direct',
    agentThreshold: 0,
    uiChanges: [
      'Individual unit labels always visible',
      'Task descriptions shown in full',
      'No auto-grouping',
      'Command bar auto-targets last selected unit'
    ]
  },
  {
    mode: 'control_group',
    agentThreshold: 6,
    uiChanges: [
      'Control group indicators appear',
      'Unit labels shorten to abbreviations',
      'Territory summary badges appear (showing unit count + status)',
      'Command bar suggests control group targets',
      'Idle alerts become more aggressive (amber at 5min, red at 15min)'
    ]
  },
  {
    mode: 'general',
    agentThreshold: 16,
    uiChanges: [
      'Operative labels hidden (only Officers and Generals labeled)',
      'Operatives cluster around their parent Officer as small dots',
      'Territory view becomes primary (not individual units)',
      'Escalation-only notification mode — silence everything below HIGH',
      'Auto-zoom to theater overview (0.5x) showing all territories',
      'Officer status summaries replace individual unit details'
    ]
  },
  {
    mode: 'autonomous',
    agentThreshold: 31,
    uiChanges: [
      'Officers get autonomous decision authority (configurable)',
      'Only CRITICAL escalations reach the General',
      'Territory heatmap replaces unit sprites for Operative density',
      'Campaign progress becomes the primary HUD element',
      'Daily summary digest replaces real-time activity feed'
    ]
  }
]
```

### 6.4 The Attention Budget

At any given moment, the General has approximately 3-5 "attention slots" — things they can actively track. The scaling system ensures the RIGHT things fill those slots:

| Scale | Attention Slots Filled With |
|-------|---------------------------|
| Direct | Individual agent outputs |
| Control Group | Group statuses + exceptions |
| General | Territory health + Officer escalations |
| Autonomous | Campaign metrics + critical blockers only |

The interface should never present MORE items than the General can process. If there are 25 Operatives running, the General does not see 25 status lines — they see 4 Officer summaries, each showing "3/5 Operatives active, on track."

---

## 7. The Ender Pattern

The user operates like Ender Wiggin in the final battle: commanding from the strategic view, but capable of taking direct control of any unit at any moment. The system must support both modes seamlessly.

### 7.1 The Bottleneck Attack Cycle

This is the core operational loop of the distributed fleet:

```
1. MORNING BRIEF
   └── Map loads. All territories across all machines visible.
       Threats are marked. Agent statuses are current.
       "I can see everything."

2. IDENTIFY BOTTLENECK
   └── "Sales has 3 critical threats and zero units deployed."
       The territory is red. No shields visible. Enemy sprites crowding.
       "That's where I fight today."

3. DEPLOY
   └── Spin up Hetzner VPS #2 (or use existing).
       Run bootstrap script → Sales Officer deployed with domain CLAUDE.md.
       Officer appears on map at VPS location, moves to Sales territory.
       "The cavalry is coming."

4. OFFICER SELF-MANAGES
   └── Officer reads the territory's threat list from Supabase.
       Spawns Operatives: one for deal research, one for call prep, one for proposal draft.
       Heartbeats show progress. Operatives flash in and out.
       "The front is being worked."

5. ZOOM OUT
   └── General leaves Sales territory. Checks other fronts.
       Content is green (Officer running patrol, all Operatives completing).
       Support is amber (one aging ticket — Officer handling it).
       "Other fronts are stable."

6. ESCALATION
   └── Sales Officer flags: "Prospect Kelly replied with objections I don't have
       context for. Need human input on pricing strategy."
       Minimap ping. Notification tray alert. Sound cue.
       "They need me."

7. DIRECT INTERVENTION
   └── Click stuck unit. See the conversation context.
       Type pricing guidance directly into the command bar.
       Officer receives it, adjusts approach, continues.
       "Guidance delivered. Back to overview."

8. RESOLUTION
   └── Sales Officer reports: "3 threats resolved. 2 calls prepped.
       1 proposal drafted and ready for review."
       Enemy sprites die with combat animations.
       VPS spins down (or Officer enters patrol mode for ongoing monitoring).
       "Front secured."
```

### 7.2 The Zoom Curve

The Ender Pattern is fundamentally about zoom fluidity:

```
STRATEGIC VIEW (national zoom)
│  "All my machines. All my fronts. Where's the fire?"
│  Time here: 80% of session
│
├── TACTICAL VIEW (theater zoom, one territory)
│   "This front specifically. What are my units doing?"
│   Time here: 15% of session
│
└── DIRECT CONTROL (terminal view, one unit)
    "I'm looking at exactly what this Claw is doing."
    Time here: 5% of session
```

The best generals spend the LEAST time in direct control. Every minute in a terminal is a minute not watching the other fronts. The war room's job is to keep you at the strategic level and only pull you down when genuinely necessary.

### 7.3 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|-------------|---------|----------|
| **Terminal camping** | Watching one agent's output for 20 minutes while other fronts go unattended | Auto-fade: if terminal view is open > 3min, minimap pulses with "other fronts need attention" |
| **Micromanaging Officers** | Giving Officers step-by-step instructions instead of goals | Prompt template: Officers receive objectives, not instructions. "Resolve all support tickets" not "First open the ticket queue, then read ticket #4523..." |
| **Operative hoarding** | Spinning up 15 Operatives simultaneously because it feels productive | Concurrency limits per Officer (default 3). Queuing for excess tasks. |
| **Ignoring escalations** | Notification fatigue from too many LOW alerts | Severity-based suppression at scale (Section 6.3). Only HIGH+ at 15+ agents. |
| **Zombie fleets** | Forgetting about VPS instances with idle Officers | Cost ticker in resource bar. Idle Officers > 4h auto-kill with final report. |

---

## 8. Three Scaling Limiters

You can have infinite compute and infinite Claw subscriptions. The fleet still won't scale past these three limiters:

### 8.1 Task Decomposition Quality

Can you break a goal into clean, independent tasks? Bad decomposition is the #1 fleet killer.

**Good decomposition:**
```
Goal: "Prepare for Kelly sales call tomorrow"
├── [Operative] Research Kelly's company — recent news, funding, team size
├── [Operative] Pull our last 3 interactions with Kelly from Supabase
├── [Operative] Draft talking points based on her stated objections
└── [Officer] Synthesize all three into a call prep brief
```

Each task is independent. No Operative needs another's output. They run in parallel.

**Bad decomposition:**
```
Goal: "Prepare for Kelly sales call tomorrow"
├── [Operative] Research Kelly's company and draft talking points based on our history
└── [Operative] Also research Kelly's company but focus on pricing objections
```

Overlapping scope. Both agents will research the same things. The outputs will conflict. The Officer will waste context merging duplicates.

**The rule:** If two Operatives might read the same source or write about the same topic, the decomposition is wrong. Restructure until every task has zero overlap.

### 8.2 Context Handoff

How does Agent B get context when Agent A finishes? This is the supply chain of the fleet.

| Handoff Method | Speed | Reliability | Best For |
|---------------|-------|------------|---------|
| **Files on disk** | Instant (same machine) | High | Local Operatives writing to shared workspace |
| **Supabase tables** | 1-3 seconds (Realtime) | High | Cross-machine handoffs, persistent state |
| **Roads system** (from PRD 02c) | Visual, tracked | High | Structured data flowing between territories |
| **Parent Officer context** | Instant | Medium (context limits) | Officer reading Operative outputs and synthesizing |

The critical constraint: **Operatives write to disk. They do not return content to their parent.** The parent Officer reads the output file. This prevents the parent's context from being flooded with child output.

### 8.3 Escalation Routing

How fast does a stuck agent reach you? Every minute a stuck agent waits for human input is wasted compute time (and on a VPS, wasted dollars).

**Escalation pipeline:**

```
Claw detects it needs help
  → Sets escalation flag in heartbeat
    → Heartbeat agent sends it within next interval (10-30 seconds)
      → Server receives, classifies severity
        → LOW: Intel panel entry, no sound
        → MEDIUM: Notification tray, subtle sound
        → HIGH: Minimap ping + attention-getting sound + badge on territory
        → CRITICAL: Full-screen flash + alarm sound + auto-zoom to unit
```

**Target latency:** Under 60 seconds from "agent is stuck" to "General sees the alert." On direct transport, this is achievable with 10-30 second heartbeat intervals. On Supabase relay, add 1-3 seconds for Realtime propagation.

**The cost of slow escalation:** If an Officer is stuck and it takes 10 minutes for you to notice, that's 10 minutes of VPS time wasted. At scale (10 Officers on VPS instances), slow escalation costs real money. The heartbeat/alert pipeline is the critical path of the fleet architecture.

---

## 9. Implementation Plan

### Phase A: Heartbeat Foundation

**Estimated effort:** 2 build sessions

1. **Heartbeat payload definition** — TypeScript interfaces in `shared/types.ts`, extending existing event types
2. **Heartbeat agent script** — `scripts/heartbeat-agent.sh` that runs on any fleet machine, reads tmux pane state, sends heartbeat JSON
3. **Server heartbeat receiver** — New endpoint `POST /heartbeat` in `server/index.ts`, validates, stores in-memory state, broadcasts to WebSocket clients
4. **Heartbeat renderer** — Unit status ring, context bar, and task label update from heartbeat data instead of raw hook events
5. **Failure detection** — Missed-heartbeat escalation ladder (Section 4.6)

### Phase B: Unit Persistence Tiers

**Estimated effort:** 2 build sessions

1. **Tier-aware unit rendering** — Crown/shield/crosshair icons, size differentiation, opacity fade rules
2. **Officer lifecycle** — Idle timeout, fade behavior, revive-on-click prompt, auto-kill with final report
3. **Operative lifecycle** — Flash-in/shrink-die animations, tombstone/checkmark markers, max lifespan enforcement
4. **Officer-Operative parent-child rendering** — Connection lines, Operative clustering around parent at general mode scale
5. **Deployment dialog** — Pick tier, machine, territory, initial prompt. Wire to session spawn API.

### Phase C: Fleet Command System

**Estimated effort:** 2 build sessions

1. **Cross-machine control groups** — Ctrl+1-9 binding stores unit IDs (local + remote), batch command delivery routes to correct transports
2. **Rally point system** — Per-machine default territory, right-click to set, inheritance for spawned Operatives
3. **Patrol routes** — Visual dashed-line loop on map, Officer movement animation along waypoints, interval-based re-execution
4. **Attack-move** — Threat list injection into Officer prompt, engagement line rendering
5. **Retreat/recall** — Soft retreat prompt, hard kill, recursive recall of Officer's Operatives

### Phase D: Attention Scaling

**Estimated effort:** 1 build session

1. **Scale mode detection** — Count active agents, switch UI mode at thresholds
2. **Label/detail suppression** — Progressive information hiding as scale increases
3. **Territory summary badges** — Agent count + worst status per territory
4. **Escalation filtering** — Severity-based notification suppression at scale
5. **Anti-pattern alerts** — Terminal camping detection, zombie fleet cost ticker

### Phase E: Remote Bootstrap

**Estimated effort:** 1 build session

1. **Bootstrap script** — Single script to deploy on any VPS: installs Claw, configures heartbeat agent, sets transport, registers with Agent Empires server
2. **Machine registration flow** — Server accepts new machine registration, generates auth token, adds to `machines.config.json`
3. **One-command deploy** — `ssh vps-1 "curl -s https://your-server/bootstrap | bash"` → machine appears on map
4. **Teardown script** — Clean removal: kill all Claws, stop heartbeat, deregister from server

---

## 10. Dependencies

### 10.1 Must Be Built First

| Dependency | PRD | Status | Why Required |
|-----------|-----|--------|-------------|
| Remote event ingestion | `07-remote-forces.md` | Spec'd | Heartbeats use the same transport layer (direct or Supabase relay) |
| Remote command delivery | `07-remote-forces.md` | Spec'd | Fleet commands route through 07's dispatch system |
| Unit rendering | `01-vision.md` Phase 1 | Built | Tier sprites extend existing unit renderer |
| Monitor orchestrator | `04-autonomous-monitoring.md` | Spec'd | Heartbeat failure detection reuses freshness/fog model |
| Geographic zoom | `11-geographic-zoom-system.md` | Spec'd | Remote machines render at their physical location on national tier |
| Enemy system | `02b-enemy-system-spec.md` | Spec'd | Attack-move requires threat list from territory |

### 10.2 New Infrastructure

| Dependency | Purpose | Cost |
|-----------|---------|------|
| Hetzner VPS (per remote machine) | Run Claw instances remotely | ~$5/mo per VPS |
| Claw subscription (per machine) | OpenClaw access for each VPS | Subscription-dependent |
| Tailscale (optional) | Direct transport mesh between machines | Free for personal use |

### 10.3 Builds On But Does Not Require

| System | Relationship |
|--------|-------------|
| Campaign mode (from `01-vision.md` Phase 3) | Fleet metrics feed campaign objectives, but the fleet works without campaigns |
| Roads system (`02c-combat-and-roads-spec.md`) | Context handoff uses Roads visually, but files-on-disk works without it |
| Agentic build orchestrator (`~/Overclock/meta-prompts/ORCHESTRATOR.md`) | The orchestrator pattern informs Officer deployment, but Officers work without it |

---

## Appendix A: The Meeseeks Contract

Every Operative implicitly agrees to this contract at spawn:

1. **I exist to complete one task.** Not two. Not "and also while you're at it." One.
2. **I write my output to disk.** I do not return content to my parent's context. Files only.
3. **I die when done.** No lingering. No "is there anything else?" Completion → write output → exit.
4. **If I'm stuck for > 2 minutes, I escalate.** I set the `stuck_loop` or `need_human_input` flag. I do not spin.
5. **If I hit 80% context, I wrap up.** I write whatever I have, note it's incomplete, and exit. Better a partial result than a context-exhausted crash.
6. **I don't spawn children.** Only Officers spawn Operatives. Operatives do not spawn sub-Operatives. The hierarchy is two levels deep, maximum.

## Appendix B: Fleet Economics

Quick math on the attention economy:

| Metric | Without Fleet | With Fleet |
|--------|--------------|-----------|
| Time to check one agent's status | 30-60 seconds (SSH, read, assess) | 2-3 seconds (glance at map status ring) |
| Time to issue one command | 15-30 seconds (alt-tab, find terminal, type) | 5 seconds (click unit, type in command bar) |
| Time to notice stuck agent | 5-40 minutes (whenever you remember to check) | 10-60 seconds (heartbeat → alert pipeline) |
| Agents manageable by one human | 3-5 (terminal-based) | 15-30 (war room), 30+ (with autonomous Officers) |
| Effective agent utilization | ~25% (agents idle because you forgot) | ~80% (idle detection, escalation, patrol routes) |
| VPS waste from zombie agents | High (forgot to kill VPS, agent idle for hours) | Low (auto-kill after timeout, cost ticker visible) |

The fleet pays for itself if it prevents ONE 4-hour zombie VPS per week ($0.03/hr * 4hr = $0.12, but the real cost is the wasted Claw context window and the tasks that didn't get done).

## Appendix C: Signal Wave Rendering

The signal wave effect on remote unit status rings:

```typescript
// In the unit renderer, for remote units only
function renderSignalWave(
  ctx: CanvasRenderingContext2D,
  unit: UnitSprite,
  latencyMs: number,
  timestamp: number
): void {
  const baseRadius = unit.tier === 'general' ? 24 : unit.tier === 'officer' ? 20 : 16
  const ringWidth = unit.tier === 'general' ? 4 : 2

  // Wave frequency inversely proportional to latency
  // Low latency = fast wave (barely visible), high latency = slow wave (very visible)
  const frequency = latencyMs < 50 ? 12 :
                    latencyMs < 200 ? 6 :
                    latencyMs < 500 ? 2 : 0.5

  // Wave amplitude increases with latency
  const amplitude = latencyMs < 50 ? 0.5 :
                    latencyMs < 200 ? 1.5 :
                    latencyMs < 500 ? 3 : 5

  // Draw the ring with sine displacement
  const segments = 64
  ctx.beginPath()
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const wave = Math.sin(angle * 8 + timestamp * frequency * 0.001) * amplitude
    const r = baseRadius + wave
    const x = unit.position.x + Math.cos(angle) * r
    const y = unit.position.y + Math.sin(angle) * r

    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.strokeStyle = unit.statusColor
  ctx.lineWidth = ringWidth

  // Add grain/static for very high latency or disconnected
  if (latencyMs > 500) {
    ctx.setLineDash([2, 2])
    ctx.globalAlpha = 0.7 + Math.random() * 0.3  // Flicker
  }

  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1.0
}
```
