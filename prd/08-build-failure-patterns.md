# Agent Empires — Build Failure Patterns

## Lessons from the first build wave. Every sub-agent prompt MUST reference this doc.

---

## Law 8: Verify At Runtime, Not Just Compile

`npx vite build` succeeding does NOT mean the app works. Vite tree-shakes and only compiles what's imported from the entry point. A circular import, a missing DOM element, or an undefined variable will compile fine and explode at runtime.

**Every build agent MUST end with:**
```bash
# 1. Compile check
cd ~/agent-empires && npx vite build 2>&1 | tail -3

# 2. Runtime smoke test (catches circular imports, undefined refs)
cd ~/agent-empires && timeout 10 npx vite --open false 2>&1 &
sleep 3
curl -s http://localhost:4002 | head -5
# Use a headless check or at minimum verify no immediate crash in server logs
kill %1 2>/dev/null
```

If the agent can't verify runtime, it MUST flag: "COMPILE PASSES, RUNTIME UNTESTED — parent should verify before next phase."

---

## Failure Pattern 1: Circular Imports

**What happened:** `BattlefieldRenderer.ts` exported `WORLD_WIDTH`. `MinimapRenderer.ts` imported it from `BattlefieldRenderer`. `BattlefieldRenderer` also imported `MinimapRenderer`. Result: `WORLD_WIDTH` is `undefined` at MinimapRenderer's module-level initialization.

**Root cause:** Module-level constants evaluated before circular dependency resolves.

**Rule for sub-agents:**
> NEVER import constants from a file that also imports from your file. Shared constants (dimensions, config values, enums) MUST live in a dedicated `constants.ts` or `shared/` file that has ZERO imports from sibling modules.

**Detection:** Before writing imports, trace the dependency chain:
```
A imports B → does B import A? → CIRCULAR. Extract shared values to C.
```

**Fix pattern:**
```typescript
// BAD: renderer/BattlefieldRenderer.ts exports WORLD_WIDTH
//      renderer/MinimapRenderer.ts imports from BattlefieldRenderer
//      BattlefieldRenderer imports MinimapRenderer → BOOM

// GOOD: renderer/constants.ts exports WORLD_WIDTH (no imports from siblings)
//       BattlefieldRenderer imports from constants
//       MinimapRenderer imports from constants → no cycle
```

---

## Failure Pattern 2: Stale Naming

**What happened:** After forking Vibecraft → Agent Empires, the server still logged "Starting Vibecraft server" and "Open https://vibecraft.sh". The hook paths were updated in `defaults.ts` but server log strings were hardcoded.

**Root cause:** Find-and-replace on config values but not on user-facing strings.

**Rule for sub-agents:**
> When renaming a project fork, run a FULL grep for the old name across ALL files and update every occurrence. Not just config — log messages, HTML titles, error messages, URLs, comments.

**Required step in any rename/fork task:**
```bash
grep -r "vibecraft" --include="*.ts" --include="*.js" --include="*.html" --include="*.json" --include="*.md" --include="*.sh" -l
```
Every file in that list must be reviewed and updated.

---

## Failure Pattern 3: Vite Proxy Path Mismatch

**What happened:** The Vite dev server proxies `/ws` to the WebSocket server and `/api` to the HTTP API. But the upstream server may expect connections at the root path, not `/ws`. The proxy config can silently work or silently fail depending on how the upstream handles the path.

**Rule for sub-agents:**
> When configuring a Vite proxy, verify that the upstream server actually handles the proxied path. If the WebSocket server listens on `/` (root), the Vite proxy must rewrite `/ws` to `/`. Document the proxy mapping in a code comment.

**Verification:**
```bash
# Test that the WebSocket server accepts connections through the proxy
curl -s -o /dev/null -w "%{http_code}" -H "Upgrade: websocket" -H "Connection: Upgrade" http://localhost:4002/ws
```

---

## Failure Pattern 4: PixiJS v8 API Drift

**What happened:** Sub-agents may use PixiJS v7 API patterns (`beginFill`, `endFill`, `lineStyle`) which don't exist in v8. The v8 API uses `.rect().fill()`, `.circle().stroke()`, etc.

**Rule for sub-agents:**
> When working with PixiJS, check the installed version first:
> ```bash
> cat node_modules/pixi.js/package.json | grep '"version"'
> ```
> If v8+, use the new API: `graphics.rect(x, y, w, h)` then `.fill(color)` or `.stroke({width, color})`. No `beginFill`/`endFill`. No `lineStyle`. `PIXI.Text` uses `new Text({ text: '...', style: { ... } })`.

---

## Failure Pattern 5: DOM Element Assumptions

**What happened:** HUD components assume DOM elements exist (e.g., `document.getElementById('resource-bar')!`). If the HTML was rewritten by one agent but the HUD component was written by a different agent with different element IDs, runtime crash.

**Rule for sub-agents:**
> If your code references DOM elements by ID, you MUST read `index.html` first to confirm those IDs exist. If creating DOM elements dynamically, document which IDs you create so other agents can reference them.

**Required at top of any HUD/UI component:**
```typescript
// DOM elements this component creates/expects:
// - #resource-bar (created in index.html)
// - .resource-value (created dynamically by this component)
```

---

## Failure Pattern 6: Parallel Agent File Conflicts

**What happened:** Phase B+C and Phase E both modified `src/main.ts`. Because they ran in parallel, the second agent's writes could overwrite the first's changes.

**Rule for sub-agents:**
> Parallel agents MUST NOT modify the same file. If two agents need to modify `main.ts`, either:
> 1. Run them sequentially
> 2. Have each write to separate files (e.g., `battlefieldInit.ts`, `hudInit.ts`) that main.ts imports
> 3. Use git worktrees so changes can be merged
>
> The build manifest must explicitly list which files each agent owns. File ownership = exclusive write access.

**In the build manifest, add:**
```yaml
agents:
  - id: phase-bc
    owns: [src/game/*, src/renderer/*, src/events/handlers/battlefieldHandlers.ts]
    reads: [src/main.ts, shared/types.ts]

  - id: phase-e
    owns: [src/hud/*, src/styles/agent-empires.css]
    reads: [src/main.ts, shared/types.ts]

  # main.ts is modified by NEITHER parallel agent
  # Parent integrates after both complete
```

---

## Failure Pattern 7: Type-Only Imports Not Used

**What happened:** Agent imports a type but uses the `import` statement instead of `import type`, causing Vite to try to bundle the module (which may cause circular deps or bloat).

**Rule for sub-agents:**
> Use `import type` for any import used ONLY in type positions (type annotations, interfaces, generics). This prevents the import from creating a runtime dependency.

```typescript
// BAD — creates runtime import even though only used as type
import { UnitRenderer } from './UnitRenderer'
function foo(unit: UnitRenderer) { ... }

// GOOD — type-only import, no runtime dependency
import type { UnitRenderer } from './UnitRenderer'
function foo(unit: UnitRenderer) { ... }
```

---

## Failure Pattern 8: Missing Error Boundaries in Async Init

**What happened:** `main.ts` calls `await battlefield.init()` which calls `await app.init()`. If PixiJS fails (WebGL not available, canvas not found), the entire app silently fails with no user feedback.

**Rule for sub-agents:**
> Any async initialization MUST have a try/catch that renders a visible error message to the user. Don't rely on console.error — users may not have devtools open.

```typescript
async function init() {
  try {
    await battlefield.init()
  } catch (err) {
    document.body.innerHTML = `
      <div style="color: #ff3366; padding: 40px; font-family: monospace;">
        <h1>Agent Empires failed to initialize</h1>
        <pre>${err}</pre>
      </div>
    `
    throw err
  }
}
```

---

## Meta-Rule: The Build Agent Checklist

Every build agent's prompt MUST include this checklist as a required final step:

```
BEFORE REPORTING DONE:
□ Ran `npx vite build` — zero errors
□ Checked for circular imports (traced import chains)
□ Verified DOM element IDs match between HTML and TS
□ Used `import type` for type-only imports
□ No hardcoded old project names (grep for "vibecraft")
□ No module-level code that depends on circular imports
□ Async init has error boundary with visible error message
□ No media APIs (AudioContext, WebGL) initialized before user gesture
□ WebSocket clients use exponential backoff (not flat interval)
□ Server startup checks port availability before binding
□ Listed all files created/modified in the completion report
□ Flagged any files that were READ but not OWNED (potential conflict)
□ All non-relative imports resolve to installed packages (no phantom deps)
□ No `import 'dotenv/config'` — use process.env directly in Node.js
```

---

## Failure Pattern 9: Port Collision (EADDRINUSE)

**What happened:** Running `npm run dev` while a previous instance was still alive. The server crashes with `EADDRINUSE: address already in use :::4003`. The client starts fine but can't reach the backend, so the WebSocket proxy spams "socket hang up" errors.

**Root cause:** No port check before binding. Developer restarts without killing the old process.

**Rule for sub-agents:**
> Before starting any server, verify the port is available. If occupied, identify and kill the stale process. Build scripts should include a pre-flight check.

**Pre-flight pattern:**
```bash
# Kill any stale process on the target port before starting
lsof -ti :4003 | xargs kill 2>/dev/null
sleep 1
npm run dev
```

---

## Failure Pattern 10: WebSocket Reconnect Spam

**What happened:** The EventClient used a flat 2-second reconnect interval with `maxReconnectAttempts: Infinity`. When the backend was down, the browser hammered the server with connection attempts every 2 seconds, flooding the console with errors and wasting resources.

**Root cause:** No exponential backoff on reconnect.

**Rule for sub-agents:**
> Any WebSocket client MUST use exponential backoff for reconnection: `delay = min(baseInterval * 2^attempt, maxDelay)`. Cap at 30 seconds. Reset attempt counter on successful connection.

```typescript
// BAD: flat interval
setTimeout(() => this.connect(), 2000)

// GOOD: exponential backoff capped at 30s
const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 30000)
setTimeout(() => this.connect(), delay)
```

---

## Failure Pattern 11: Eager Audio/Media Initialization

**What happened:** Importing `SoundManager` (which imports `Tone.js`) at module scope triggers `new AudioContext()` before any user gesture. Browsers block this and log: "The AudioContext was not allowed to start."

**Root cause:** Top-level `import * as Tone from 'tone'` in any module pulled in by the entry point creates the AudioContext at parse time.

**Rule for sub-agents:**
> Any module that creates browser media contexts (AudioContext, MediaStream, WebGL) must be lazy-loaded with `import()` or deferred until after a user gesture. Never import media libraries at module scope from the entry point chain.

**Fix pattern:**
```typescript
// BAD: static import pulls in AudioContext at module load
import { soundManager } from '../audio'
soundManager.play('notification')

// GOOD: dynamic import defers until needed (after user gesture)
import('../audio').then(({ soundManager }) => soundManager.play('notification'))
```

---

## Failure Pattern 12: Phantom Dependencies

**What happened:** A sub-agent added `import 'dotenv/config'` to `ThreatDataBridge.ts` because it read env vars. But `dotenv` wasn't in `package.json`. Vite build succeeded (tree-shaking skipped server-only code), but the server crashed at runtime: `ERR_MODULE_NOT_FOUND: Cannot find package 'dotenv'`.

**Root cause:** Sub-agent assumed a dependency existed because the spec mentioned env vars. Never checked `package.json`.

**Rule for sub-agents:**
> BEFORE adding ANY import, verify the package exists in `package.json`:
> ```bash
> cat package.json | grep '"dotenv"'
> ```
> If it's not there, either:
> 1. Use `process.env` directly (Node.js has native env var access — no dotenv needed)
> 2. Install it explicitly with `npm install`
> 3. Flag to parent: "Needs dependency: dotenv"
>
> NEVER assume a package is installed. `import 'foo'` with no `foo` in node_modules = instant crash.

**Detection:** Add to build agent checklist:
```bash
# Verify all imports resolve
grep -rh "from '" server/ | grep -v node_modules | sed "s/.*from '//;s/'.*//" | grep -v '^\.' | sort -u | while read pkg; do
  root=$(echo $pkg | cut -d/ -f1)
  [ -d "node_modules/$root" ] || echo "MISSING: $root"
done
```

---

## Failure Pattern 13: IPv6 localhost Resolution (macOS)

**What happened:** `fetch('http://localhost:4003/...')` failed intermittently on macOS. Node resolved `localhost` to `::1` (IPv6) while the server only bound to `0.0.0.0` (IPv4). Connection refused.

**Root cause:** macOS resolves `localhost` to IPv6 first. If the server doesn't explicitly listen on IPv6, connections fail silently or intermittently.

**Rule for sub-agents:**
> Always use `127.0.0.1` instead of `localhost` in URLs. This forces IPv4 and eliminates DNS resolution ambiguity.

```typescript
// BAD
const url = 'http://localhost:4003/api'

// GOOD
const url = 'http://127.0.0.1:4003/api'
```

---

## Failure Pattern 14: Sub-Agents Not Visible on Battlefield

**What happened:** Claude Code's `Agent` tool spawns sub-processes that share the parent's session ID. The server saw events from one session, not multiple. Sub-agents were invisible on the map.

**Root cause:** Unlike `tmux` sessions which get unique IDs, `Agent` tool sub-agents are internal to Claude Code and don't create separate event streams.

**Fix:** Virtual sub-agent spawning — intercept `pre_tool_use` for `Agent` tool, create a temporary `ManagedSession` with a synthetic ID (`${sessionId}-sub-${toolUseId}`), mark it as a child of the parent. On `post_tool_use`, retire the virtual unit after 30s.

**Rule for sub-agents:**
> When tracking agent spawning, don't assume every agent creates a unique session. Check how the tool actually works. The `Agent` tool reuses the parent session — you must synthesize visibility from tool events.

---

## Failure Pattern 15: Unreadable Labels at Default Zoom

**What happened:** Territory labels were set to 12px font size. At normal map zoom (0.3-0.5x), labels were invisible. User reported "I can't see them at all."

**Root cause:** Labels were designed for 1:1 zoom but the map renders at strategic zoom-out by default.

**Rule for sub-agents:**
> Design all text at the EXPECTED zoom level, not 1:1. Territory labels at 48px bold with 0.35 alpha look right at strategic zoom. Unit labels use counter-scaling (`setZoomScale`) to maintain readability. Always ask: "What zoom will users see this at?"

---

## Failure Pattern 16: Dead Code from Sub-Agent Builds

**What happened:** FogOfWar.ts (338 lines) was built by a sub-agent but never wired into BattlefieldRenderer. It sat as dead code — compiles fine, does nothing at runtime.

**Root cause:** Sub-agent built the component correctly but the integration step (wiring into main.ts/BattlefieldRenderer) was a separate task that got missed.

**Rule for sub-agents:**
> When building a new renderer/manager, ALSO wire it into the init chain. At minimum, add the import + instantiation. If you can't modify main.ts (file ownership conflict), FLAG IT: "Built FogOfWar.ts — NOT WIRED. Parent must add to BattlefieldRenderer init."

---

## Integration into Orchestrator

Add to the agentic build orchestrator as **Law 8**:

> **8. Runtime-verify, not just compile.** `tsc` and `vite build` passing means syntax is valid. It does NOT mean the app works. Every builder must smoke-test at runtime or explicitly flag "RUNTIME UNTESTED". The validator phase must include runtime verification — not just file existence checks.

And add a new section to Phase D (Launch Builders):

> **8. Anti-patterns reference:** Include the path to this failure patterns doc in every builder prompt. Builders must check their work against these known failure modes before reporting done.
