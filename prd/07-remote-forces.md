# Agent Empires — Remote Forces System

## Sub-PRD 07 — Distant Armies

**Parent PRD:** `01-vision.md` (Phase 5: Integration)
**Dependencies:** `shared/types.ts` (event types), `server/index.ts` (WebSocket server, POST /event), `hooks/vibecraft-hook.sh` (event producer)
**System:** Remote machine event ingestion, command delivery, chat interface, multi-machine topology
**Last updated:** 2026-03-10

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Remote Event Ingestion](#2-remote-event-ingestion)
3. [Remote Command Delivery](#3-remote-command-delivery)
4. [Chat Interface](#4-chat-interface)
5. [Remote Unit Visual Treatment](#5-remote-unit-visual-treatment)
6. [Multi-Machine Topology](#6-multi-machine-topology)
7. [Security](#7-security)
8. [Configuration & Setup](#8-configuration--setup)
9. [TypeScript Interfaces](#9-typescript-interfaces)
10. [Implementation Plan](#10-implementation-plan)

---

## 1. Design Philosophy

You are Napoleon at Austerlitz. Your Imperial Guard fights beside you (local tmux sessions on your Mac). But Davout's III Corps is 20 miles away, marching on the enemy's flank (Claude agents on OpenClaw). You cannot see them directly. You receive dispatches. You send orders by courier. And when Davout arrives on the battlefield, you hear the cannon fire before you see the column.

Remote forces are NOT second-class citizens. They are full units on the battlefield — they just arrive with latency, communicate through relays, and carry a signal indicator instead of a health bar. The general's job is the same: issue orders, receive reports, adjust the plan.

**Core rules:**

1. **Remote events look identical to local events once ingested.** The server normalizes them. The renderer does not care where an event originated. The only difference is metadata (`origin` field).
2. **Command delivery is async by nature.** Sending a prompt to a remote agent is a dispatch, not a function call. The UI must reflect this (dispatch sent → dispatch received → response incoming).
3. **Connection loss is fog of war, not failure.** If a remote machine goes dark, its units don't disappear — they go ghostly, like a regiment last seen entering a forest. When connection restores, their status catches up.
4. **One transport per machine, configured once.** The user picks direct, relay, or hybrid when registering the machine. The system handles the rest.
5. **Chat is dispatches.** The metaphor holds: every message to/from a remote agent is a military dispatch, timestamped, with delivery status. Not a chat bubble. A parchment with a wax seal.

---

## 2. Remote Event Ingestion

Currently: `Claude Code hook → hook.sh → POST http://localhost:4003/event → WebSocket → browser`

The problem: `localhost:4003` does not exist on a remote machine. We need the remote hook.sh to get events INTO the local server.

### 2.1 Transport Option A: Direct Network (Tailscale/WireGuard)

The simplest option when both machines are on the same Tailscale or WireGuard mesh network. The remote hook.sh POSTs directly to the Agent Empires server's Tailscale IP.

**Remote hook.sh changes:**

```bash
# In the remote machine's ~/.vibecraft/hooks/vibecraft-hook.sh (or equivalent)
# Override the notification URL to point at the Agent Empires server

# These are set INSTEAD of the default localhost values:
WS_NOTIFY_URL="${VIBECRAFT_WS_NOTIFY:-https://100.64.0.1:4003/event}"
ENABLE_WS_NOTIFY="true"

# Add authentication header to the curl call:
if [ "$ENABLE_WS_NOTIFY" = "true" ] && [ -n "$CURL" ]; then
  "$CURL" -s -X POST "$WS_NOTIFY_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AE_REMOTE_TOKEN}" \
    -H "X-AE-Origin: ${AE_MACHINE_ID:-unknown}" \
    -d "$event" \
    --connect-timeout 2 \
    --max-time 5 \
    >/dev/null 2>&1 &
fi
```

**Environment variables on remote machine (`~/.agent-empires/remote.env`):**

```bash
export VIBECRAFT_WS_NOTIFY="http://100.64.0.1:4003/event"
export AE_REMOTE_TOKEN="ae_tok_<64-char-hex>"
export AE_MACHINE_ID="openclaw-alpha"
```

The hook.sh sources this file at startup:

```bash
# Add to top of hook.sh on remote machine
AE_REMOTE_CONFIG="$HOME/.agent-empires/remote.env"
[ -f "$AE_REMOTE_CONFIG" ] && source "$AE_REMOTE_CONFIG"
```

**Server-side changes to `server/index.ts`:**

The existing `POST /event` handler needs three additions: token validation, origin tagging, and deduplication for remote events.

```typescript
// In the POST /event handler (server/index.ts line ~1497)
if (req.method === 'POST' && req.url === '/event') {
  // Check for remote event authentication
  const authHeader = req.headers['authorization']
  const originHeader = req.headers['x-ae-origin'] as string | undefined

  // If origin header present, this is a remote event — validate token
  if (originHeader) {
    const expectedToken = remoteForces.getTokenForMachine(originHeader)
    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      res.writeHead(401)
      res.end('Unauthorized')
      return
    }
  }

  collectRequestBody(req).then(body => {
    try {
      const event = JSON.parse(body) as ClaudeEvent
      // Tag remote events with origin metadata
      if (originHeader) {
        ;(event as any).origin = {
          machineId: originHeader,
          transport: 'direct',
          receivedAt: Date.now(),
          latencyMs: Date.now() - event.timestamp
        }
      }
      addEvent(event)
    } catch (e) { /* ... */ }
  })
}
```

**Latency:** 1-5ms on Tailscale mesh. Effectively real-time.

**Pros:** Lowest latency, simplest flow, no intermediary.
**Cons:** Requires both machines on same mesh network. Firewall/NAT issues if not using VPN.

### 2.2 Transport Option B: Supabase Relay

When direct network access is not possible (different networks, firewalled, cloud instances), events flow through a shared Supabase table. The remote hook writes to the table, the local server subscribes via Supabase Realtime.

**Supabase relay table:**

```sql
CREATE TABLE ae_remote_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  -- Deduplication: same event_id from same machine = duplicate
  UNIQUE(machine_id, event_id)
);

-- Index for subscription filtering
CREATE INDEX idx_ae_remote_events_unprocessed
  ON ae_remote_events (processed, created_at)
  WHERE processed = false;

-- Auto-cleanup: delete processed events older than 24h
-- (via pg_cron or Supabase scheduled function)
CREATE OR REPLACE FUNCTION cleanup_remote_events()
RETURNS void AS $$
  DELETE FROM ae_remote_events
  WHERE processed = true AND processed_at < now() - interval '24 hours';
$$ LANGUAGE sql;
```

**Remote hook.sh changes for Supabase relay:**

```bash
# Instead of POSTing to the AE server, POST to Supabase
SUPABASE_URL="${AE_SUPABASE_URL}"
SUPABASE_KEY="${AE_SUPABASE_KEY}"
MACHINE_ID="${AE_MACHINE_ID:-unknown}"

if [ "$ENABLE_WS_NOTIFY" = "true" ] && [ -n "$CURL" ] && [ -n "$SUPABASE_URL" ]; then
  relay_payload=$("$JQ" -n -c \
    --arg event_id "$event_id" \
    --arg machine_id "$MACHINE_ID" \
    --arg event_type "$event_type" \
    --arg session_id "$session_id" \
    --argjson payload "$event" \
    '{
      event_id: $event_id,
      machine_id: $machine_id,
      event_type: $event_type,
      session_id: $session_id,
      payload: $payload
    }')

  "$CURL" -s -X POST "${SUPABASE_URL}/rest/v1/ae_remote_events" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$relay_payload" \
    --connect-timeout 3 \
    --max-time 5 \
    >/dev/null 2>&1 &
fi
```

**Server-side Supabase subscription (`server/RemoteForces.ts`):**

```typescript
import { createClient } from '@supabase/supabase-js'

class SupabaseRelay {
  private supabase: ReturnType<typeof createClient>
  private processedIds = new Set<string>() // Rolling dedup window

  constructor(url: string, key: string) {
    this.supabase = createClient(url, key)
  }

  async subscribe(onEvent: (event: ClaudeEvent) => void): Promise<void> {
    this.supabase
      .channel('remote-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ae_remote_events',
          filter: 'processed=eq.false'
        },
        async (payload) => {
          const row = payload.new as RemoteEventRow
          const eventId = `${row.machine_id}:${row.event_id}`

          // Dedup check
          if (this.processedIds.has(eventId)) return
          this.processedIds.add(eventId)

          // Tag the event with origin metadata
          const event = row.payload as ClaudeEvent
          ;(event as any).origin = {
            machineId: row.machine_id,
            transport: 'supabase',
            receivedAt: Date.now(),
            latencyMs: Date.now() - event.timestamp,
            relayId: row.id
          }

          // Deliver to the event system
          onEvent(event)

          // Mark as processed
          await this.supabase
            .from('ae_remote_events')
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq('id', row.id)

          // Trim dedup set (keep last 10k entries)
          if (this.processedIds.size > 10000) {
            const entries = Array.from(this.processedIds)
            entries.slice(0, 5000).forEach(id => this.processedIds.delete(id))
          }
        }
      )
      .subscribe()
  }
}
```

**Latency:** 200-800ms typical (Supabase Realtime over WebSocket). Acceptable for strategic visibility, noticeable for chat.

**Deduplication strategy:** The `UNIQUE(machine_id, event_id)` constraint prevents duplicate inserts. The `processedIds` set on the server prevents double-processing from Realtime re-deliveries. The 24h cleanup prevents table bloat.

**Pros:** Works across any network boundary. Supabase handles auth, TLS, reliability.
**Cons:** Higher latency. Supabase dependency. Small cost if event volume is very high.

### 2.3 Transport Option C: Hybrid (Recommended)

Use direct network for low-latency event flow, with Supabase as a reliable fallback. The remote hook.sh tries direct POST first (1-second timeout), and if it fails, writes to Supabase.

**Remote hook.sh — hybrid transport:**

```bash
# Hybrid: try direct first, fall back to Supabase relay
DIRECT_URL="${AE_DIRECT_URL}"        # e.g., http://100.64.0.1:4003/event
SUPABASE_URL="${AE_SUPABASE_URL}"
SUPABASE_KEY="${AE_SUPABASE_KEY}"
REMOTE_TOKEN="${AE_REMOTE_TOKEN}"
MACHINE_ID="${AE_MACHINE_ID:-unknown}"

if [ "$ENABLE_WS_NOTIFY" = "true" ] && [ -n "$CURL" ]; then
  # Try direct POST first (fast timeout)
  direct_ok=0
  if [ -n "$DIRECT_URL" ]; then
    "$CURL" -s -X POST "$DIRECT_URL" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${REMOTE_TOKEN}" \
      -H "X-AE-Origin: ${MACHINE_ID}" \
      -d "$event" \
      --connect-timeout 1 \
      --max-time 2 \
      >/dev/null 2>&1 && direct_ok=1
  fi

  # If direct failed, relay through Supabase
  if [ "$direct_ok" -eq 0 ] && [ -n "$SUPABASE_URL" ]; then
    relay_payload=$("$JQ" -n -c \
      --arg event_id "$event_id" \
      --arg machine_id "$MACHINE_ID" \
      --arg event_type "$event_type" \
      --arg session_id "$session_id" \
      --argjson payload "$event" \
      '{
        event_id: $event_id,
        machine_id: $machine_id,
        event_type: $event_type,
        session_id: $session_id,
        payload: $payload
      }')

    "$CURL" -s -X POST "${SUPABASE_URL}/rest/v1/ae_remote_events" \
      -H "apikey: ${SUPABASE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      -d "$relay_payload" \
      --connect-timeout 3 \
      --max-time 5 \
      >/dev/null 2>&1 &
  fi
fi
```

**Why this is the recommended approach:**

- Normal operation: 1-5ms latency via direct POST
- Network blip: automatic fallback to Supabase (200-800ms), no events lost
- VPN down for hours: all events buffer in Supabase, catch up when server processes them
- The `&` on the Supabase fallback means it never blocks Claude, even on slow connections

**Server-side:** Run BOTH the direct POST /event handler (always on) AND the Supabase subscription (if configured). The dedup system (using `seenEventIds` set already in `server/index.ts`) prevents double-processing of events that arrive via both paths.

### 2.4 Distinguishing Remote vs Local Events

Every event flowing through the system gets an `origin` field after ingestion:

```typescript
interface EventOrigin {
  /** Machine ID from config (e.g., 'openclaw-alpha') */
  machineId: string
  /** How this event arrived */
  transport: 'local' | 'direct' | 'supabase'
  /** When the server received it (unix ms) */
  receivedAt: number
  /** Computed latency: receivedAt - event.timestamp */
  latencyMs: number
  /** Supabase row ID if relayed */
  relayId?: string
}
```

Local events get `origin.machineId = 'local'` and `origin.transport = 'local'` assigned by the server automatically. The `addEvent()` function in `server/index.ts` handles this:

```typescript
function addEvent(event: ClaudeEvent) {
  // Existing dedup check
  if (seenEventIds.has(event.id)) return
  seenEventIds.add(event.id)

  // Tag local events if not already tagged
  if (!(event as any).origin) {
    ;(event as any).origin = {
      machineId: 'local',
      transport: 'local',
      receivedAt: Date.now(),
      latencyMs: 0
    }
  }

  // ... rest of existing addEvent logic ...
}
```

### 2.5 Error Handling and Reconnection

**Direct transport failures:**
- Hook.sh uses `--connect-timeout 1 --max-time 2` — Claude is never blocked more than 2 seconds
- Failed POSTs are silent (fire-and-forget with `&`)
- Hybrid mode catches the failure and routes to Supabase

**Supabase subscription drops:**
- The `RemoteForces` class implements exponential backoff reconnection:

```typescript
class RemoteForces {
  private reconnectAttempts = 0
  private maxReconnectDelay = 30_000

  private async handleSubscriptionError() {
    this.reconnectAttempts++
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    )
    log(`Supabase relay disconnected. Reconnecting in ${delay}ms...`)
    setTimeout(() => this.connectSupabaseRelay(), delay)
  }

  private async connectSupabaseRelay() {
    try {
      await this.supabaseRelay.subscribe(event => this.ingestEvent(event))
      this.reconnectAttempts = 0
      log('Supabase relay reconnected')
    } catch (e) {
      this.handleSubscriptionError()
    }
  }
}
```

**Missed events during outage:**
- On reconnect, query `ae_remote_events WHERE processed = false ORDER BY created_at` to catch up
- Process backlog sequentially to maintain event ordering
- The server broadcasts a `remote_reconnected` event so the renderer can animate the unit re-materializing

---

## 3. Remote Command Delivery

The user clicks a remote unit on the battlefield, types an order. That text needs to reach a Claude Code session running on a different machine.

### 3.1 SSH Bridge

The most reliable command delivery: SSH into the remote machine and inject text into the tmux session.

**SSH command template:**

```bash
# Inject a prompt into a remote tmux session
ssh -o ConnectTimeout=5 \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    openclaw-alpha \
    "tmux load-buffer - <<'AEPROMPT' && tmux paste-buffer -t \${TMUX_SESSION} && sleep 0.1 && tmux send-keys -t \${TMUX_SESSION} Enter
${PROMPT_TEXT}
AEPROMPT"
```

**Server-side implementation (`server/RemoteCommands.ts`):**

```typescript
import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { randomBytes } from 'crypto'

interface SSHConfig {
  host: string             // SSH host (Tailscale IP, hostname, or SSH config alias)
  user?: string            // SSH user (default: current user)
  port?: number            // SSH port (default: 22)
  identityFile?: string    // Path to SSH private key
  controlPath?: string     // SSH multiplexing socket path
}

class SSHBridge {
  private config: SSHConfig
  private controlMaster: boolean = false

  constructor(config: SSHConfig) {
    this.config = config
  }

  /**
   * Start a persistent SSH connection (ControlMaster) to avoid
   * handshake latency on every command.
   */
  async startControlMaster(): Promise<void> {
    const socketPath = this.config.controlPath
      || `/tmp/ae-ssh-${this.config.host}-${randomBytes(4).toString('hex')}`

    return new Promise((resolve, reject) => {
      const args = this.buildSSHArgs([
        '-M',                             // Master mode
        '-S', socketPath,                 // Socket path
        '-o', 'ControlPersist=600',       // Keep alive 10 minutes
        '-N',                             // No remote command
        '-f',                             // Go to background
      ])

      execFile('ssh', args, { timeout: 10_000 }, (error) => {
        if (error) {
          reject(new Error(`SSH ControlMaster failed: ${error.message}`))
        } else {
          this.config.controlPath = socketPath
          this.controlMaster = true
          resolve()
        }
      })
    })
  }

  /**
   * Send a prompt to a remote tmux session.
   * Returns a dispatch ID for tracking delivery status.
   */
  async sendPrompt(
    tmuxSession: string,
    prompt: string,
    timeout: number = 15_000
  ): Promise<DispatchResult> {
    const dispatchId = randomBytes(8).toString('hex')
    const startTime = Date.now()

    // Write prompt to a local temp file to avoid shell escaping issues
    const tempFile = `/tmp/ae-dispatch-${dispatchId}.txt`
    writeFileSync(tempFile, prompt)

    try {
      // Step 1: Copy the prompt file to the remote machine
      await this.scp(tempFile, `/tmp/ae-dispatch-${dispatchId}.txt`, timeout)

      // Step 2: Load into tmux buffer, paste, and send Enter
      const remoteCmd = [
        `tmux load-buffer /tmp/ae-dispatch-${dispatchId}.txt`,
        `tmux paste-buffer -t ${this.escapeTmuxSession(tmuxSession)}`,
        `sleep 0.1`,
        `tmux send-keys -t ${this.escapeTmuxSession(tmuxSession)} Enter`,
        `rm -f /tmp/ae-dispatch-${dispatchId}.txt`
      ].join(' && ')

      await this.exec(remoteCmd, timeout)

      return {
        dispatchId,
        status: 'delivered',
        latencyMs: Date.now() - startTime,
        deliveredAt: Date.now()
      }
    } catch (error) {
      return {
        dispatchId,
        status: 'failed',
        latencyMs: Date.now() - startTime,
        error: (error as Error).message
      }
    } finally {
      try { unlinkSync(tempFile) } catch {}
    }
  }

  /**
   * Execute a command on the remote machine via SSH.
   */
  private exec(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildSSHArgs([this.config.host, command])

      execFile('ssh', args, { timeout }, (error, stdout, stderr) => {
        if (error) reject(error)
        else resolve(stdout)
      })
    })
  }

  /**
   * Copy a file to the remote machine via scp.
   */
  private scp(localPath: string, remotePath: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = this.config.user
        ? `${this.config.user}@${this.config.host}:${remotePath}`
        : `${this.config.host}:${remotePath}`

      const args = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=accept-new',
      ]
      if (this.config.controlPath) {
        args.push('-o', `ControlPath=${this.config.controlPath}`)
      }
      if (this.config.identityFile) {
        args.push('-i', this.config.identityFile)
      }
      if (this.config.port) {
        args.push('-P', String(this.config.port))
      }
      args.push(localPath, target)

      execFile('scp', args, { timeout }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private buildSSHArgs(extra: string[]): string[] {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
    ]
    if (this.config.controlPath) {
      args.push('-o', `ControlPath=${this.config.controlPath}`)
    }
    if (this.config.identityFile) {
      args.push('-i', this.config.identityFile)
    }
    if (this.config.port) {
      args.push('-p', String(this.config.port))
    }
    if (this.config.user) {
      args.push('-l', this.config.user)
    }
    args.push(...extra)
    return args
  }

  private escapeTmuxSession(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`Invalid tmux session name: ${name}`)
    }
    return name
  }

  async destroy(): Promise<void> {
    if (this.controlMaster && this.config.controlPath) {
      try {
        await this.exec('', 0) // no-op to close
        execFile('ssh', [
          '-S', this.config.controlPath,
          '-O', 'exit',
          this.config.host
        ])
      } catch {}
    }
  }
}
```

**Connection pooling:** The `ControlMaster` SSH multiplexing keeps a persistent TCP connection open. Subsequent SSH commands reuse it, reducing per-command latency from ~200ms (handshake) to ~5ms (multiplexed). The `ControlPersist=600` keeps it alive for 10 minutes of inactivity.

**Timeout and retry:**

```typescript
async sendPromptWithRetry(
  tmuxSession: string,
  prompt: string,
  maxRetries: number = 2
): Promise<DispatchResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await this.sendPrompt(tmuxSession, prompt)
    if (result.status === 'delivered') return result

    // If ControlMaster is stale, restart it
    if (attempt < maxRetries) {
      await this.startControlMaster().catch(() => {})
    }
  }
  return {
    dispatchId: randomBytes(8).toString('hex'),
    status: 'failed',
    latencyMs: 0,
    error: `Failed after ${maxRetries + 1} attempts`
  }
}
```

### 3.2 Webhook Bridge

For machines that are reachable over HTTP but not via SSH (cloud instances, restricted environments). Deploy a lightweight API on the remote machine.

**Remote-side API (`remote-bridge/index.ts`):**

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { randomBytes, timingSafeEqual } from 'crypto'

const PORT = parseInt(process.env.AE_BRIDGE_PORT || '4004')
const AUTH_TOKEN = process.env.AE_BRIDGE_TOKEN || ''
const MAX_BODY = 64 * 1024 // 64KB max prompt size

if (!AUTH_TOKEN) {
  console.error('AE_BRIDGE_TOKEN must be set')
  process.exit(1)
}

function authenticate(req: IncomingMessage): boolean {
  const header = req.headers['authorization'] || ''
  const provided = Buffer.from(header.replace('Bearer ', ''))
  const expected = Buffer.from(AUTH_TOKEN)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
    return
  }

  // List tmux sessions
  if (req.method === 'GET' && req.url === '/sessions') {
    if (!authenticate(req)) { res.writeHead(401); res.end(); return }

    execFile('tmux', ['list-sessions', '-F', '#{session_name}:#{session_activity}'],
      (err, stdout) => {
        if (err) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
          return
        }
        const sessions = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [name, activity] = line.split(':')
          return { name, lastActivity: parseInt(activity) * 1000 }
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ sessions }))
      }
    )
    return
  }

  // Send prompt to a session
  if (req.method === 'POST' && req.url === '/prompt') {
    if (!authenticate(req)) { res.writeHead(401); res.end(); return }

    let body = ''
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) { res.writeHead(413); res.end(); return }
      body += chunk
    }

    try {
      const { session, text } = JSON.parse(body)
      if (!session || !text) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'session and text required' }))
        return
      }

      // Validate session name
      if (!/^[a-zA-Z0-9_-]+$/.test(session)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'invalid session name' }))
        return
      }

      // Write to temp file, load into tmux, paste, enter
      const tempFile = `/tmp/ae-bridge-${randomBytes(8).toString('hex')}.txt`
      writeFileSync(tempFile, text)

      execFile('tmux', ['load-buffer', tempFile], (err1) => {
        if (err1) {
          try { unlinkSync(tempFile) } catch {}
          res.writeHead(500)
          res.end(JSON.stringify({ error: `load-buffer failed: ${err1.message}` }))
          return
        }

        execFile('tmux', ['paste-buffer', '-t', session], (err2) => {
          if (err2) {
            try { unlinkSync(tempFile) } catch {}
            res.writeHead(500)
            res.end(JSON.stringify({ error: `paste-buffer failed: ${err2.message}` }))
            return
          }

          setTimeout(() => {
            execFile('tmux', ['send-keys', '-t', session, 'Enter'], (err3) => {
              try { unlinkSync(tempFile) } catch {}
              if (err3) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: `send-keys failed: ${err3.message}` }))
                return
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                status: 'delivered',
                session,
                timestamp: Date.now()
              }))
            })
          }, 100)
        })
      })
    } catch (e) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'invalid JSON' }))
    }
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`AE Remote Bridge listening on port ${PORT}`)
})
```

**Integration with agent-runner:** The existing `agent-runner` at `~/speakeasy-agent/agent-runner/` already has webhook endpoints (`POST /trigger`, `POST /enqueue`). The remote bridge is a separate, simpler process because:
- Agent-runner has business logic (queue, Slack, email drafts) we don't need for raw prompt injection
- The bridge should be as lightweight as possible — it just shuttles text into tmux
- It runs alongside agent-runner, not inside it

However, the bridge can optionally be added as a route in agent-runner if the user prefers fewer processes:

```javascript
// In agent-runner/src/index.js, add a route:
// POST /ae-prompt — Agent Empires remote prompt injection
if (req.method === 'POST' && req.url === '/ae-prompt') {
  // Same logic as bridge /prompt endpoint above
}
```

### 3.3 Slack Relay (Fallback)

When both SSH and HTTP are unavailable (complete network partition, machine behind aggressive firewall). Uses the existing Slack integration.

**Sending a command via Slack:**

```typescript
async sendPromptViaSlack(
  machineId: string,
  sessionName: string,
  prompt: string
): Promise<DispatchResult> {
  const dispatchId = randomBytes(8).toString('hex')
  const agentUserId = remoteForces.getSlackUserId(machineId)
  const channel = remoteForces.getSlackChannel(machineId) || 'C09JYTW7UJZ' // #friday-space

  const message = [
    `<@${agentUserId}>`,
    `TASK: Execute prompt in session "${sessionName}"`,
    `CONTEXT: Dispatch ${dispatchId} from Agent Empires`,
    `PROMPT:\n${prompt}`,
    `OUTPUT: Execute and report completion via hook events`,
    `PRIORITY: immediate`
  ].join('\n')

  const botToken = process.env.SLACK_FLOWSTACK_BOT_TOKEN
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel, text: message })
  })

  const data = await response.json()
  return {
    dispatchId,
    status: data.ok ? 'sent' : 'failed',
    latencyMs: 0,
    error: data.ok ? undefined : data.error
  }
}
```

**How the remote agent picks it up:** The remote machine's agent-runner (or a Claude session with Slack socket mode) receives the message, parses the structured TASK format, and injects the PROMPT into the named tmux session. Response flows back through the normal event pipeline (hook.sh events).

**Latency:** 500ms-2s for delivery. Response time depends on the agent's polling interval.

### 3.4 Command Delivery Priority

The `RemoteForces` class tries transports in order:

```typescript
async sendCommand(
  machineId: string,
  sessionName: string,
  prompt: string
): Promise<DispatchResult> {
  const machine = this.getMachine(machineId)
  if (!machine) throw new Error(`Unknown machine: ${machineId}`)

  // Try transports in priority order
  const transports = this.getTransportOrder(machine)

  for (const transport of transports) {
    switch (transport) {
      case 'ssh':
        const sshResult = await machine.sshBridge.sendPromptWithRetry(
          sessionName, prompt
        )
        if (sshResult.status === 'delivered') return sshResult
        break

      case 'webhook':
        const webhookResult = await this.sendViaWebhook(
          machine, sessionName, prompt
        )
        if (webhookResult.status === 'delivered') return webhookResult
        break

      case 'slack':
        return this.sendPromptViaSlack(machineId, sessionName, prompt)
    }
  }

  return {
    dispatchId: randomBytes(8).toString('hex'),
    status: 'failed',
    latencyMs: 0,
    error: 'All transport methods failed'
  }
}
```

---

## 4. Chat Interface

When the user selects a remote unit, the right Intel Panel switches to a "Dispatches" tab — a threaded conversation with that unit styled as military field dispatches.

### 4.1 Dispatch Panel Design

```
┌──────────────────────────────────────────────┐
│  DISPATCHES — Lt. Friday (OpenClaw Alpha)    │
│  ▰▰▰▰░ Signal: 4/5  │  Latency: 3ms        │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ ← DISPATCH SENT                       │  │
│  │ 10:43:02 — Order No. 0x7a3f           │  │
│  │                                       │  │
│  │ Analyze the conversion funnel for     │  │
│  │ the CCB waitlist page. Check the      │  │
│  │ Supabase analytics table for drop-    │  │
│  │ off points.                           │  │
│  │                                       │  │
│  │ ✓ Dispatch received  10:43:02         │  │
│  │ ✓ Agent processing   10:43:04         │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ → DISPATCH RECEIVED                   │  │
│  │ 10:44:17 — Report No. 0x7a40          │  │
│  │                                       │  │
│  │ Analysis complete. Three drop-off     │  │
│  │ points identified:                    │  │
│  │                                       │  │
│  │ 1. Landing page → email field: 68%    │  │
│  │    drop-off (above fold CTA hidden)   │  │
│  │ 2. Email submit → thank you: 12%     │  │
│  │    drop-off (normal)                  │  │
│  │ 3. Thank you → first email open: 34% │  │
│  │    drop-off (subject line weak)       │  │
│  │                                       │  │
│  │ Recommend: Move CTA above fold,      │  │
│  │ A/B test subject lines.              │  │
│  │                                       │  │
│  │ ✓ Delivered 10:44:17                  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ ⟳ DISPATCH IN TRANSIT...              │  │
│  │ 10:45:30 — Order No. 0x7a41          │  │
│  │                                       │  │
│  │ Good. Now implement fix #1 — move     │  │
│  │ the CTA button above the fold.        │  │
│  │                                       │  │
│  │ ◌ Awaiting delivery confirmation...   │  │
│  └────────────────────────────────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────┐ [SEND]  │
│ │ Type your orders...              │         │
│ └──────────────────────────────────┘         │
└──────────────────────────────────────────────┘
```

### 4.2 Dispatch Data Model

```typescript
interface Dispatch {
  /** Unique dispatch ID (hex) */
  id: string
  /** Which direction */
  direction: 'outbound' | 'inbound'
  /** Target machine + session */
  machineId: string
  sessionId: string
  /** The message content */
  content: string
  /** Sequential order number within this conversation */
  orderNumber: number
  /** Timestamps */
  createdAt: number
  /** Delivery tracking */
  status: DispatchStatus
  /** When the status last changed */
  statusUpdatedAt: number
}

type DispatchStatus =
  | 'composing'       // User is typing (local only)
  | 'sending'         // POST/SSH in flight
  | 'delivered'       // Remote machine confirmed receipt
  | 'processing'      // Agent is working (we see pre_tool_use events)
  | 'responded'       // Agent's stop event arrived with response
  | 'failed'          // Delivery failed
  | 'timeout'         // No response within expected window

interface DispatchThread {
  /** Machine + session this thread targets */
  machineId: string
  sessionId: string
  /** Ordered list of dispatches */
  dispatches: Dispatch[]
  /** Connection quality (computed from recent latency samples) */
  signalStrength: 1 | 2 | 3 | 4 | 5
  /** Average latency over last 10 events */
  avgLatencyMs: number
}
```

### 4.3 Message Flow

**Outbound (user sends order):**

1. User types in the dispatch input and presses Enter or clicks SEND
2. Dispatch created with status `sending`, rendered immediately in panel
3. `RemoteForces.sendCommand()` fires (SSH → webhook → Slack fallback)
4. On success: status updates to `delivered`, timestamp shown
5. When the agent starts processing (first `pre_tool_use` event from that session): status updates to `processing`
6. When the agent completes (a `stop` event with `response` field from that session): a new inbound dispatch is created with the response content, outbound dispatch status becomes `responded`

**Inbound (agent responds):**

1. A `stop` event arrives from the remote session with a non-empty `response` field
2. The `RemoteForces` class checks if there's an active dispatch thread for that machine+session
3. If yes: creates an inbound dispatch with the response content
4. The dispatch panel scrolls to show the new message
5. A sound plays (radio crackle + dispatch received tone)

**Status tracking via events:**

```typescript
// In server/RemoteForces.ts — called for every ingested event
handleEvent(event: ClaudeEvent & { origin: EventOrigin }) {
  if (event.origin.machineId === 'local') return

  const thread = this.getThread(event.origin.machineId, event.sessionId)
  if (!thread) return

  // Update signal strength from latency
  this.updateSignalStrength(thread, event.origin.latencyMs)

  // Track dispatch status progression
  const pendingDispatch = thread.dispatches.find(
    d => d.direction === 'outbound' && d.status === 'delivered'
  )

  if (pendingDispatch) {
    if (event.type === 'pre_tool_use' || event.type === 'user_prompt_submit') {
      pendingDispatch.status = 'processing'
      pendingDispatch.statusUpdatedAt = Date.now()
      this.broadcastDispatchUpdate(thread, pendingDispatch)
    }
  }

  if (event.type === 'stop' && (event as any).response) {
    // Create inbound dispatch from response
    const inbound: Dispatch = {
      id: randomBytes(8).toString('hex'),
      direction: 'inbound',
      machineId: event.origin.machineId,
      sessionId: event.sessionId,
      content: (event as any).response,
      orderNumber: thread.dispatches.length,
      createdAt: Date.now(),
      status: 'responded',
      statusUpdatedAt: Date.now()
    }
    thread.dispatches.push(inbound)

    // Mark the outbound dispatch as responded
    if (pendingDispatch) {
      pendingDispatch.status = 'responded'
      pendingDispatch.statusUpdatedAt = Date.now()
    }

    this.broadcastDispatchUpdate(thread, inbound)
  }
}
```

### 4.4 Message Persistence

Dispatch history is stored in two places:

1. **In-memory** (server): the `DispatchThread` objects, limited to last 100 dispatches per thread. This is the primary source during a session.

2. **Supabase** (persistent): for history across server restarts.

```sql
CREATE TABLE ae_dispatches (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,          -- 'outbound' or 'inbound'
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  order_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  status_updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ae_dispatches_thread
  ON ae_dispatches (machine_id, session_id, created_at);
```

On server startup, the last 50 dispatches per active thread are loaded from Supabase. On dispatch creation/update, a debounced write persists to Supabase (batch upsert every 5 seconds).

### 4.5 Typing/Processing Indicators

- **"Dispatch in transit"**: shown from `sending` until `delivered` — typically 1-5ms (SSH) or 200-800ms (Supabase relay)
- **"Agent processing"**: shown from the first `pre_tool_use` event after delivery — stays until `stop`
- **"Awaiting delivery confirmation"**: shown when `sending` takes longer than 2 seconds — indicates potential transport issue
- **Timeout**: if no `stop` event arrives within 5 minutes of delivery, the dispatch status changes to `timeout` and a subtle warning appears

### 4.6 CSS Theme (Napoleon dispatch style)

```css
/* Dispatch panel — styled as military field communications */

.dispatch-panel {
  background: #1a1714;
  border: 1px solid #3d352a;
  font-family: 'IM Fell English', 'Georgia', serif;
}

.dispatch-header {
  background: #2a2420;
  border-bottom: 2px solid #5a4d3c;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #c4b59a;
  font-variant: small-caps;
  letter-spacing: 1px;
}

.signal-indicator {
  display: flex;
  gap: 2px;
  align-items: flex-end;
}

.signal-bar {
  width: 3px;
  background: #5a4d3c;
  border-radius: 1px;
}
.signal-bar.active { background: #8b9a6b; }
.signal-bar:nth-child(1) { height: 4px; }
.signal-bar:nth-child(2) { height: 7px; }
.signal-bar:nth-child(3) { height: 10px; }
.signal-bar:nth-child(4) { height: 13px; }
.signal-bar:nth-child(5) { height: 16px; }

.dispatch-message {
  margin: 8px 12px;
  padding: 12px 16px;
  border-radius: 4px;
  position: relative;
}

.dispatch-outbound {
  background: #1e2a1e;
  border-left: 3px solid #5a7a3a;
}

.dispatch-inbound {
  background: #2a2420;
  border-left: 3px solid #8b7355;
}

.dispatch-label {
  font-size: 10px;
  font-variant: small-caps;
  letter-spacing: 2px;
  margin-bottom: 4px;
}
.dispatch-outbound .dispatch-label { color: #7a9a5a; }
.dispatch-inbound .dispatch-label { color: #a8926f; }

.dispatch-meta {
  font-size: 11px;
  color: #6b5f4f;
  margin-bottom: 8px;
}

.dispatch-content {
  color: #d4c5a9;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.dispatch-status {
  font-size: 11px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid #2a2420;
}
.dispatch-status.delivered { color: #5a7a3a; }
.dispatch-status.processing { color: #a89a5a; }
.dispatch-status.failed { color: #8b3a3a; }
.dispatch-status.timeout { color: #6b4a2a; }

/* Processing animation */
.dispatch-status.processing::after {
  content: '';
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #a89a5a;
  border-top-color: transparent;
  border-radius: 50%;
  animation: dispatch-spin 1s linear infinite;
  margin-left: 6px;
  vertical-align: middle;
}

@keyframes dispatch-spin {
  to { transform: rotate(360deg); }
}

/* Transit animation — pulsing border */
.dispatch-in-transit {
  border-left-color: #a89a5a;
  animation: dispatch-pulse 1.5s ease-in-out infinite;
}

@keyframes dispatch-pulse {
  0%, 100% { border-left-color: #a89a5a; }
  50% { border-left-color: #5a4d3c; }
}

.dispatch-input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #3d352a;
  background: #1e1a16;
}

.dispatch-input {
  flex: 1;
  background: #2a2420;
  border: 1px solid #3d352a;
  color: #d4c5a9;
  padding: 8px 12px;
  font-family: inherit;
  font-size: 14px;
  border-radius: 4px;
  outline: none;
}
.dispatch-input:focus {
  border-color: #5a7a3a;
}
.dispatch-input::placeholder {
  color: #5a4d3c;
  font-style: italic;
}

.dispatch-send-btn {
  background: #3a4a2a;
  border: 1px solid #5a7a3a;
  color: #8b9a6b;
  padding: 8px 16px;
  font-family: inherit;
  font-variant: small-caps;
  letter-spacing: 1px;
  cursor: pointer;
  border-radius: 4px;
}
.dispatch-send-btn:hover {
  background: #4a5a3a;
}
```

---

## 5. Remote Unit Visual Treatment

### 5.1 Regiment Colors

Local units and each remote machine get a distinct regiment color:

| Regiment | Color | Hex | Usage |
|----------|-------|-----|-------|
| **Imperial Guard** (local) | Gold | `#c4a84a` | Local tmux sessions |
| **Eastern Army** (openclaw-alpha) | Steel | `#708090` | First remote machine |
| **Western Army** (openclaw-beta) | Crimson | `#8b3a3a` | Second remote machine |
| **Reserve Force** (cloud) | Navy | `#3a4a6b` | Cloud instances |
| **Foreign Legion** (other) | Olive | `#6b6b3a` | Additional machines |

Regiment color affects:
- Unit nameplate background
- Status ring tint
- Connection line color (commander → unit)
- Territory presence indicator
- Minimap dot color

### 5.2 Signal Indicator

Every remote unit displays a small antenna icon with signal bars on its nameplate:

```typescript
interface RemoteUnitOverlay {
  /** Signal strength (1-5 bars), computed from latency */
  signalStrength: 1 | 2 | 3 | 4 | 5
  /** Current latency to this machine */
  latencyMs: number
  /** Connection status */
  connectionStatus: 'connected' | 'degraded' | 'disconnected'
}

function latencyToSignal(avgLatencyMs: number): 1 | 2 | 3 | 4 | 5 {
  if (avgLatencyMs < 10) return 5       // <10ms = excellent (Tailscale direct)
  if (avgLatencyMs < 50) return 4       // <50ms = good
  if (avgLatencyMs < 200) return 3      // <200ms = fair
  if (avgLatencyMs < 1000) return 2     // <1s = poor (Supabase relay)
  return 1                               // >1s = barely connected
}
```

The signal indicator is rendered as a small PixiJS sprite group:
- Antenna icon (4x12 px line with 3px circle on top)
- 5 bars beside it, filled based on signal strength
- Green when connected, amber when degraded, red when disconnected

### 5.3 Latency Display

The unit's nameplate (floating text below the sprite) shows:

```
Lt. Friday [E]          ← [E] = Eastern Army regiment badge
3ms | ▰▰▰▰▰            ← latency + signal bars
```

For units with high latency or degraded connection:

```
Cpl. Builder [W]
847ms | ▰▰░░░           ← amber text, fewer bars
```

### 5.4 Disconnection State

When a remote machine stops sending events (no event for 2x the expected heartbeat interval):

**Visual treatment:**
- Unit sprite becomes semi-transparent (alpha 0.3)
- A static/noise overlay texture animates over the sprite (like TV static)
- The signal indicator shows all bars empty, red
- The nameplate shows "SIGNAL LOST" instead of latency
- A subtle red pulse emanates from the unit every 5 seconds

**Implementation:**

```typescript
// In UnitRenderer.ts or RemoteUnitOverlay.ts
function applyDisconnectionEffect(unit: UnitSprite) {
  // Fade the sprite
  unit.sprite.alpha = 0.3

  // Add static noise overlay
  const staticTexture = generateNoiseTexture(unit.width, unit.height)
  const staticOverlay = new PIXI.Sprite(staticTexture)
  staticOverlay.blendMode = PIXI.BLEND_MODES.ADD
  staticOverlay.alpha = 0.4
  unit.addChild(staticOverlay)

  // Animate the noise (swap texture every 200ms)
  unit.staticInterval = setInterval(() => {
    staticOverlay.texture = generateNoiseTexture(unit.width, unit.height)
  }, 200)

  // Red pulse ring
  const pulse = new PIXI.Graphics()
  unit.addChild(pulse)
  const pulseAnim = () => {
    pulse.clear()
    const t = (Date.now() % 5000) / 5000
    if (t < 0.3) {
      const radius = 20 + t * 60
      const alpha = 0.4 * (1 - t / 0.3)
      pulse.lineStyle(2, 0x8b3a3a, alpha)
      pulse.drawCircle(0, 0, radius)
    }
  }
  PIXI.Ticker.shared.add(pulseAnim)
  unit.pulseAnim = pulseAnim
}
```

### 5.5 Reconnection Animation

When connection is restored:
1. The static overlay dissolves (alpha 1.0 → 0 over 500ms)
2. The sprite fades back in (alpha 0.3 → 1.0 over 500ms)
3. A "signal acquired" particle burst (green sparks)
4. The signal bars fill up one by one (staggered 100ms each)
5. A subtle chime plays (radio tuning → clear signal)
6. Any queued events from the outage period process rapidly, and the unit's activity catches up

### 5.6 Army Grouping

Remote units from the same machine cluster together visually:

```typescript
interface ArmyGroup {
  machineId: string
  name: string                    // "Eastern Army"
  color: number                   // Regiment color
  insignia: string                // Regiment badge icon
  units: string[]                 // Session IDs on this machine
  /** Computed center of mass for the group */
  centroid: { x: number, y: number }
  /** Banner position (flag above the group) */
  bannerPosition: { x: number, y: number }
}
```

When multiple remote units from the same machine are on the same territory, they form a visual cluster:
- Units are positioned within 40px of each other (tighter than random local placement)
- A regiment banner (flag sprite) floats above the group showing the army name
- A subtle colored boundary line outlines the group
- The group moves as a unit when reassigned to a different territory

---

## 6. Multi-Machine Topology

### 6.1 Configuration

```
Your Mac (Agent Empires HQ)
  ├── Local Forces (tmux sessions)
  ├── OpenClaw Alpha (Linux server #1) — "Eastern Army"
  ├── OpenClaw Beta (Linux server #2) — "Western Army"
  └── Cloud Instance (AWS/GCP) — "Reserve Force"
```

### 6.2 Machine Registry

Each remote machine is registered in the configuration file:

```jsonc
// ~/.agent-empires/config/remote-forces.json
{
  "forces": [
    {
      "id": "openclaw-alpha",
      "name": "Eastern Army",
      "host": "100.64.0.2",
      "sshAlias": "openclaw",
      "transport": {
        "primary": "direct",
        "fallback": "supabase",
        "directUrl": "http://100.64.0.2:4003/event",
        "bridgeUrl": "http://100.64.0.2:4004",
        "supabase": true
      },
      "auth": {
        "token": "ae_tok_<64-char-hex>",
        "sshIdentity": "~/.ssh/openclaw_ed25519"
      },
      "regiment": {
        "color": "#708090",
        "insignia": "eagle",
        "name": "Eastern Army"
      },
      "heartbeatIntervalMs": 30000,
      "sessions": "auto"
    },
    {
      "id": "cloud-reserve",
      "name": "Reserve Force",
      "host": "ec2-xx-xx-xx-xx.compute-1.amazonaws.com",
      "transport": {
        "primary": "webhook",
        "fallback": "supabase",
        "bridgeUrl": "https://ec2-xx-xx-xx-xx.compute-1.amazonaws.com:4004",
        "supabase": true
      },
      "auth": {
        "token": "ae_tok_<64-char-hex>",
        "sshIdentity": "~/.ssh/aws_ed25519"
      },
      "regiment": {
        "color": "#3a4a6b",
        "insignia": "anchor",
        "name": "Reserve Force"
      },
      "heartbeatIntervalMs": 60000,
      "sessions": "auto"
    }
  ],
  "supabase": {
    "url": "https://dquuimhmbofdhdsbdbly.supabase.co",
    "anonKey": "eyJ..."
  },
  "slack": {
    "channel": "C09JYTW7UJZ",
    "botToken": "xoxb-..."
  }
}
```

**Session discovery:** When `sessions` is `"auto"`, the server periodically queries the remote machine for its tmux sessions:
- Via SSH: `ssh openclaw "tmux list-sessions -F '#{session_name}'"` every 30s
- Via webhook bridge: `GET /sessions` every 30s
- Sessions that appear/disappear update the battlefield in real-time

**Session override:** You can also specify explicit sessions:

```jsonc
"sessions": [
  { "tmuxSession": "friday", "name": "Lt. Friday", "unitType": "lieutenant" },
  { "tmuxSession": "builder", "name": "Eng. Builder", "unitType": "engineer" }
]
```

### 6.3 Health Monitoring

Each machine has a health monitor that runs at `heartbeatIntervalMs`:

```typescript
interface MachineHealth {
  machineId: string
  status: 'online' | 'degraded' | 'offline'
  /** Average latency from last 10 events */
  avgLatencyMs: number
  /** Last event received from this machine */
  lastEventAt: number
  /** Time since last event */
  silentForMs: number
  /** System metrics (if SSH available) */
  system?: {
    loadAvg: number[]
    memoryUsedPct: number
    uptimeSeconds: number
    tmuxSessionCount: number
  }
  /** Transport health */
  transports: {
    direct: 'ok' | 'timeout' | 'refused' | 'unknown'
    ssh: 'ok' | 'auth_failed' | 'timeout' | 'unknown'
    webhook: 'ok' | 'timeout' | 'refused' | 'unknown'
    supabase: 'ok' | 'error' | 'unknown'
  }
}
```

**Health check implementation:**

```typescript
async checkMachineHealth(machine: RemoteMachine): Promise<MachineHealth> {
  const health: MachineHealth = {
    machineId: machine.id,
    status: 'offline',
    avgLatencyMs: this.getAvgLatency(machine.id),
    lastEventAt: this.getLastEventTime(machine.id),
    silentForMs: Date.now() - this.getLastEventTime(machine.id),
    transports: {
      direct: 'unknown', ssh: 'unknown',
      webhook: 'unknown', supabase: 'unknown'
    }
  }

  // Check direct connection
  if (machine.transport.directUrl) {
    try {
      const start = Date.now()
      const resp = await fetch(`${machine.transport.directUrl.replace('/event', '/health')}`, {
        signal: AbortSignal.timeout(3000)
      })
      if (resp.ok) {
        health.transports.direct = 'ok'
        health.avgLatencyMs = Date.now() - start
      }
    } catch (e) {
      health.transports.direct = (e as Error).message.includes('timeout')
        ? 'timeout' : 'refused'
    }
  }

  // Check SSH
  if (machine.sshAlias || machine.host) {
    try {
      const result = await machine.sshBridge.exec('echo ok', 5000)
      health.transports.ssh = 'ok'

      // Grab system metrics while we're connected
      const metrics = await machine.sshBridge.exec(
        'uptime && free -m | grep Mem && tmux list-sessions 2>/dev/null | wc -l',
        5000
      )
      health.system = parseSystemMetrics(metrics)
    } catch (e) {
      health.transports.ssh = (e as Error).message.includes('auth')
        ? 'auth_failed' : 'timeout'
    }
  }

  // Check webhook bridge
  if (machine.transport.bridgeUrl) {
    try {
      const resp = await fetch(`${machine.transport.bridgeUrl}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      health.transports.webhook = resp.ok ? 'ok' : 'refused'
    } catch {
      health.transports.webhook = 'timeout'
    }
  }

  // Determine overall status
  const anyOk = Object.values(health.transports).some(t => t === 'ok')
  const silentTooLong = health.silentForMs > machine.heartbeatIntervalMs * 3

  if (anyOk && !silentTooLong) {
    health.status = 'online'
  } else if (anyOk) {
    health.status = 'degraded'
  } else {
    health.status = 'offline'
  }

  return health
}
```

### 6.4 Failover

When a machine goes offline, its work is NOT automatically reassigned. This is a design decision: the general decides whether to redeploy, not the system.

What the system DOES:

1. **Visual alert:** Machine's units go ghostly, banner shows red exclamation
2. **Notification:** "Eastern Army: SIGNAL LOST — 3 units unresponsive" in notification tray
3. **Intel event:** An `ae_intel` record is created with `severity: 'high'` and `territory: 'all'`
4. **Command suggestion:** The command bar shows a contextual suggestion: "Reassign Eastern Army tasks? /redeploy openclaw-alpha → local"

The user can then:
- Wait for the machine to come back
- Manually reassign specific sessions to local tmux
- Use the `/redeploy` command to spawn local replacements with the same session configs

```typescript
// /redeploy command handler
async redeployForce(sourceMachineId: string, targetMachineId: string = 'local') {
  const machine = this.getMachine(sourceMachineId)
  if (!machine) return

  for (const session of machine.sessions) {
    // Spawn a new local session with the same config
    const newSession = await this.sessionManager.create({
      name: `${session.name} (redeployed)`,
      cwd: session.cwd || process.cwd(),
      flags: { skipPermissions: true }
    })

    // If the session had a last known prompt/task, re-issue it
    const lastDispatch = this.getLastOutboundDispatch(
      sourceMachineId, session.tmuxSession
    )
    if (lastDispatch && lastDispatch.status !== 'responded') {
      await this.sessionManager.sendPrompt(newSession.id, lastDispatch.content)
    }
  }
}
```

---

## 7. Security

### 7.1 Authentication

Every remote connection uses bearer tokens:

```typescript
interface RemoteAuthConfig {
  /** Bearer token for HTTP event ingestion and webhook bridge */
  token: string
  /** Path to SSH private key (Ed25519 recommended) */
  sshIdentity?: string
  /** Token rotation: when this token expires (ISO 8601) */
  tokenExpiry?: string
}
```

**Token generation:**

```bash
# Generate a new remote force token
openssl rand -hex 32 | sed 's/^/ae_tok_/'
# Output: ae_tok_7a3f...64 chars
```

Tokens are stored in `~/.agent-empires/config/remote-forces.json` on the local machine, and in `~/.agent-empires/remote.env` on each remote machine. They are never transmitted in events — only in HTTP headers.

### 7.2 Event Validation

Every remote event is validated before ingestion:

```typescript
function validateRemoteEvent(event: unknown, machineId: string): ClaudeEvent | null {
  // Must be an object
  if (typeof event !== 'object' || event === null) return null

  const e = event as Record<string, unknown>

  // Required fields
  if (typeof e.id !== 'string') return null
  if (typeof e.timestamp !== 'number') return null
  if (typeof e.type !== 'string') return null
  if (typeof e.sessionId !== 'string') return null

  // Event type must be a known type
  const validTypes = [
    'pre_tool_use', 'post_tool_use', 'stop', 'subagent_stop',
    'session_start', 'session_end', 'user_prompt_submit',
    'notification', 'pre_compact'
  ]
  if (!validTypes.includes(e.type as string)) return null

  // Timestamp sanity check (not more than 5 minutes in the future,
  // not more than 1 hour in the past)
  const now = Date.now()
  if (e.timestamp > now + 300_000) return null
  if (e.timestamp < now - 3_600_000) return null

  // Size check: no single event larger than 100KB
  if (JSON.stringify(event).length > 100_000) return null

  return event as ClaudeEvent
}
```

### 7.3 Secret Protection

Events from remote machines may contain tool inputs with file paths, code, or other sensitive data. The system never:
- Logs full event payloads to console (only type + sessionId)
- Transmits events to any third party
- Stores events in Supabase ae_remote_events longer than 24 hours

The Supabase relay table uses `service_role` key on the remote machine (for inserts) and Row Level Security on the server (for reads):

```sql
ALTER TABLE ae_remote_events ENABLE ROW LEVEL SECURITY;

-- Only the service role can insert
CREATE POLICY "service_insert" ON ae_remote_events
  FOR INSERT WITH CHECK (true);

-- Only the service role can read/update
CREATE POLICY "service_select" ON ae_remote_events
  FOR SELECT USING (true);

CREATE POLICY "service_update" ON ae_remote_events
  FOR UPDATE USING (true);
```

### 7.4 Audit Log

Every remote command sent is logged:

```sql
CREATE TABLE ae_command_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  transport TEXT NOT NULL,         -- 'ssh', 'webhook', 'slack'
  dispatch_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,       -- SHA-256 of prompt (not the prompt itself)
  prompt_length INTEGER NOT NULL,
  status TEXT NOT NULL,            -- 'delivered', 'failed', 'timeout'
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

The audit log stores a hash of the prompt, not the prompt itself — for accountability without leaking sensitive content.

### 7.5 Rate Limiting

Remote event ingestion is rate-limited per machine:

```typescript
class RateLimiter {
  private windows = new Map<string, number[]>()
  private maxPerMinute = 300  // ~5 events/second, generous for active coding
  private maxPerSecond = 30   // Burst protection

  isAllowed(machineId: string): boolean {
    const now = Date.now()
    const window = this.windows.get(machineId) || []

    // Clean old entries
    const recent = window.filter(t => t > now - 60_000)

    // Check per-minute
    if (recent.length >= this.maxPerMinute) return false

    // Check per-second burst
    const lastSecond = recent.filter(t => t > now - 1000)
    if (lastSecond.length >= this.maxPerSecond) return false

    recent.push(now)
    this.windows.set(machineId, recent)
    return true
  }
}
```

---

## 8. Configuration & Setup

### 8.1 Complete Setup Flow

#### Step 1: Register Remote Machine

On the local Mac (Agent Empires HQ):

```bash
# Interactive setup
npx agent-empires remote add

# Or non-interactive
npx agent-empires remote add \
  --id openclaw-alpha \
  --name "Eastern Army" \
  --host 100.64.0.2 \
  --transport hybrid \
  --ssh-alias openclaw \
  --color "#708090" \
  --insignia eagle
```

This creates/updates `~/.agent-empires/config/remote-forces.json` and generates a token.

#### Step 2: Install Hooks on Remote Machine

```bash
# From local Mac, push the hook config to the remote machine
npx agent-empires remote setup openclaw-alpha

# This SSHs into the remote machine and:
# 1. Creates ~/.agent-empires/remote.env with the token and URLs
# 2. Copies the modified hook.sh (with hybrid transport)
# 3. Configures Claude Code hooks to use the modified hook.sh
# 4. Optionally installs the webhook bridge (remote-bridge)
# 5. Verifies the hook fires by sending a test event
```

**What the setup script does on the remote machine:**

```bash
#!/bin/bash
# Executed on the remote machine via SSH during setup

MACHINE_ID="$1"
DIRECT_URL="$2"
SUPABASE_URL="$3"
SUPABASE_KEY="$4"
TOKEN="$5"

# Create config directory
mkdir -p ~/.agent-empires

# Write remote.env
cat > ~/.agent-empires/remote.env << EOF
export AE_MACHINE_ID="${MACHINE_ID}"
export AE_DIRECT_URL="${DIRECT_URL}"
export AE_SUPABASE_URL="${SUPABASE_URL}"
export AE_SUPABASE_KEY="${SUPABASE_KEY}"
export AE_REMOTE_TOKEN="${TOKEN}"
export VIBECRAFT_ENABLE_WS_NOTIFY="true"
EOF

# Install the hook (copies the hybrid hook.sh)
mkdir -p ~/.agent-empires/hooks
# ... (hook.sh content written here)

# Configure Claude Code to use our hook
# This varies by Claude Code version — the setup detects and configures
# either ~/.claude/settings.json or the project-level hooks config
```

#### Step 3: Configure Transport

Already done in step 1 via the `--transport` flag. The user can change it later:

```bash
npx agent-empires remote config openclaw-alpha --transport direct
npx agent-empires remote config openclaw-alpha --transport supabase
npx agent-empires remote config openclaw-alpha --transport hybrid
```

#### Step 4: Verify Connection

```bash
npx agent-empires remote test openclaw-alpha
```

Output:

```
Testing connection to openclaw-alpha (Eastern Army)...

  SSH connection:     OK (4ms)
  Direct POST:        OK (3ms)
  Webhook bridge:     OK (5ms)
  Supabase relay:     OK (312ms)
  Event round-trip:   OK (7ms)
  Session discovery:  Found 2 sessions: friday, builder

All transports operational.
```

#### Step 5: See Remote Units on Battlefield

After verification, the server automatically:
1. Subscribes to events from the remote machine
2. Discovers tmux sessions
3. Creates `ManagedSession` entries with the remote machine's regiment color
4. Broadcasts `session_update` messages to the browser
5. The renderer creates unit sprites with the remote overlay (signal, latency, regiment badge)

Units appear with a brief deployment animation: a column of smoke, the regiment banner unfurls, and the units materialize one by one.

### 8.2 CLI Commands Summary

```
npx agent-empires remote add [options]       # Register a new remote machine
npx agent-empires remote setup <id>          # Push hooks + config to remote machine
npx agent-empires remote test <id>           # Test all transports
npx agent-empires remote config <id> [opts]  # Update machine configuration
npx agent-empires remote remove <id>         # Unregister a machine
npx agent-empires remote list                # Show all registered machines + status
npx agent-empires remote health              # Health report for all machines
```

---

## 9. TypeScript Interfaces

Complete type definitions for the Remote Forces system. These extend `shared/types.ts`.

```typescript
// ============================================================================
// Remote Forces Types (extend shared/types.ts)
// ============================================================================

/** Origin metadata attached to every event after ingestion */
export interface EventOrigin {
  machineId: string
  transport: 'local' | 'direct' | 'supabase'
  receivedAt: number
  latencyMs: number
  relayId?: string
}

/** A Claude event with origin metadata (all events after server processing) */
export type OriginatedEvent = ClaudeEvent & { origin: EventOrigin }

/** Remote machine registration */
export interface RemoteMachine {
  id: string
  name: string
  host: string
  sshAlias?: string
  transport: RemoteTransportConfig
  auth: RemoteAuthConfig
  regiment: RegimentConfig
  heartbeatIntervalMs: number
  sessions: 'auto' | RemoteSessionConfig[]
}

export interface RemoteTransportConfig {
  primary: 'direct' | 'webhook' | 'ssh'
  fallback?: 'supabase' | 'slack'
  directUrl?: string
  bridgeUrl?: string
  supabase?: boolean
}

export interface RemoteAuthConfig {
  token: string
  sshIdentity?: string
  tokenExpiry?: string
}

export interface RegimentConfig {
  color: string
  insignia: string
  name: string
}

export interface RemoteSessionConfig {
  tmuxSession: string
  name: string
  unitType: string
}

/** Dispatch result from sending a command */
export interface DispatchResult {
  dispatchId: string
  status: 'delivered' | 'sent' | 'failed'
  latencyMs: number
  deliveredAt?: number
  error?: string
}

/** A single dispatch message in a conversation thread */
export interface Dispatch {
  id: string
  direction: 'outbound' | 'inbound'
  machineId: string
  sessionId: string
  content: string
  orderNumber: number
  createdAt: number
  status: DispatchStatus
  statusUpdatedAt: number
}

export type DispatchStatus =
  | 'composing'
  | 'sending'
  | 'delivered'
  | 'processing'
  | 'responded'
  | 'failed'
  | 'timeout'

/** A conversation thread with a remote unit */
export interface DispatchThread {
  machineId: string
  sessionId: string
  dispatches: Dispatch[]
  signalStrength: 1 | 2 | 3 | 4 | 5
  avgLatencyMs: number
}

/** Machine health status */
export interface MachineHealth {
  machineId: string
  status: 'online' | 'degraded' | 'offline'
  avgLatencyMs: number
  lastEventAt: number
  silentForMs: number
  system?: SystemMetrics
  transports: TransportHealth
}

export interface SystemMetrics {
  loadAvg: number[]
  memoryUsedPct: number
  uptimeSeconds: number
  tmuxSessionCount: number
}

export interface TransportHealth {
  direct: 'ok' | 'timeout' | 'refused' | 'unknown'
  ssh: 'ok' | 'auth_failed' | 'timeout' | 'unknown'
  webhook: 'ok' | 'timeout' | 'refused' | 'unknown'
  supabase: 'ok' | 'error' | 'unknown'
}

/** Remote unit visual overlay (for renderer) */
export interface RemoteUnitOverlay {
  signalStrength: 1 | 2 | 3 | 4 | 5
  latencyMs: number
  connectionStatus: 'connected' | 'degraded' | 'disconnected'
  regimentColor: string
  regimentInsignia: string
  regimentName: string
}

/** Army group (visual clustering of units from same machine) */
export interface ArmyGroup {
  machineId: string
  name: string
  color: number
  insignia: string
  units: string[]
  centroid: { x: number; y: number }
  bannerPosition: { x: number; y: number }
}

/** Remote forces configuration file */
export interface RemoteForcesConfig {
  forces: RemoteMachine[]
  supabase?: {
    url: string
    anonKey: string
  }
  slack?: {
    channel: string
    botToken: string
  }
}

/** Extended ManagedSession for remote units */
export interface RemoteManagedSession extends ManagedSession {
  /** Remote machine this session runs on */
  remoteMachineId: string
  /** Regiment display config */
  regiment: RegimentConfig
  /** Current remote overlay state */
  remoteOverlay: RemoteUnitOverlay
}

// ============================================================================
// WebSocket Message Extensions
// ============================================================================

/** Additional server messages for remote forces */
export type RemoteServerMessage =
  | { type: 'dispatch_update'; payload: { thread: string; dispatch: Dispatch } }
  | { type: 'machine_health'; payload: MachineHealth }
  | { type: 'remote_reconnected'; payload: { machineId: string } }
  | { type: 'remote_disconnected'; payload: { machineId: string; lastEventAt: number } }

/** Additional client messages for remote forces */
export type RemoteClientMessage =
  | { type: 'send_dispatch'; payload: { machineId: string; sessionId: string; text: string } }
  | { type: 'get_dispatches'; payload: { machineId: string; sessionId: string; limit?: number } }
  | { type: 'get_machine_health'; payload: { machineId: string } }
```

---

## 10. Implementation Plan

### Phase 1: Core Plumbing (2-3 days)

1. **Create `server/RemoteForces.ts`** — the main orchestrator class
   - Load `remote-forces.json` config
   - Initialize SSH bridges with ControlMaster
   - Start Supabase relay subscription (if configured)
   - Expose `ingestEvent()` for the POST /event handler
   - Expose `sendCommand()` for the dispatch system
   - Health monitoring loop

2. **Extend `server/index.ts`** — integrate remote forces
   - Add token validation to POST /event
   - Tag events with `origin` metadata
   - Initialize `RemoteForces` on server startup
   - Add `/remote/health` endpoint
   - Add `/remote/dispatch` endpoint (for browser → remote prompt delivery)

3. **Extend `shared/types.ts`** — add all interfaces from section 9

4. **Create `remote-bridge/index.ts`** — the lightweight API for remote machines

### Phase 2: Renderer Integration (2 days)

5. **Remote unit overlay in renderer** — signal indicator, latency, regiment badge
6. **Disconnection/reconnection visual effects** — ghost state, static, pulse
7. **Army grouping** — cluster + banner for same-machine units
8. **Regiment color system** — tint nameplates, status rings, minimap dots

### Phase 3: Chat Interface (2 days)

9. **Dispatch panel UI** — HTML/CSS, Napoleon aesthetic
10. **Dispatch WebSocket messages** — send_dispatch, dispatch_update
11. **Status tracking** — sending → delivered → processing → responded
12. **Message persistence** — Supabase ae_dispatches table + in-memory cache

### Phase 4: CLI & Setup (1 day)

13. **`npx agent-empires remote` CLI commands** — add, setup, test, config, list
14. **Remote hook.sh generator** — creates the hybrid hook for remote machines
15. **One-command setup** — `npx agent-empires remote setup <id>` does everything via SSH

### Phase 5: Polish (1 day)

16. **Sound design** — dispatch sent/received tones, signal lost/acquired
17. **Supabase schema migrations** — ae_remote_events, ae_dispatches, ae_command_audit
18. **Security hardening** — rate limiting, event validation, audit logging
19. **Documentation** — update CLAUDE.md, add to _index.md

**Total estimate:** 8-10 days

---

## Appendix A: Supabase Schema Summary

```sql
-- Remote event relay (for Supabase transport)
CREATE TABLE ae_remote_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  UNIQUE(machine_id, event_id)
);

-- Dispatch history
CREATE TABLE ae_dispatches (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  order_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  status_updated_at TIMESTAMPTZ DEFAULT now()
);

-- Command audit log
CREATE TABLE ae_command_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  transport TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  prompt_length INTEGER NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ae_remote_events_unprocessed
  ON ae_remote_events (processed, created_at) WHERE processed = false;
CREATE INDEX idx_ae_dispatches_thread
  ON ae_dispatches (machine_id, session_id, created_at);
CREATE INDEX idx_ae_command_audit_machine
  ON ae_command_audit (machine_id, created_at);
```

## Appendix B: Remote Hook Environment Variables

Set on each remote machine in `~/.agent-empires/remote.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `AE_MACHINE_ID` | Yes | Unique machine identifier matching config |
| `AE_REMOTE_TOKEN` | Yes | Bearer token for authentication |
| `AE_DIRECT_URL` | If using direct transport | e.g., `http://100.64.0.1:4003/event` |
| `AE_SUPABASE_URL` | If using Supabase relay | Supabase project URL |
| `AE_SUPABASE_KEY` | If using Supabase relay | Supabase anon or service key |
| `VIBECRAFT_ENABLE_WS_NOTIFY` | Yes | Must be `"true"` |

## Appendix C: File Manifest

```
server/
  RemoteForces.ts         # Main orchestrator — config, health, dispatch routing
  RemoteCommands.ts       # SSH bridge, webhook bridge, Slack relay
  SupabaseRelay.ts        # Supabase Realtime subscription for remote events
  RemoteEventValidator.ts # Event validation and rate limiting

shared/
  types.ts                # Extended with all Remote Forces interfaces

src/
  ui/DispatchPanel.ts     # Chat/dispatch UI component
  renderer/RemoteOverlay.ts    # Signal indicator, regiment badge, ghost effects
  renderer/ArmyGroupRenderer.ts  # Army clustering and banners
  events/handlers/remoteHandlers.ts  # Dispatch status tracking

remote-bridge/
  index.ts                # Lightweight HTTP bridge for remote machines
  package.json

bin/
  cli.js                  # Extended with `remote` subcommands

styles/
  dispatches.css          # Napoleon-era dispatch panel styling
```
