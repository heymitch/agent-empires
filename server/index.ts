/**
 * Agent Empires WebSocket Server
 *
 * This server:
 * 1. Watches the events JSONL file for changes
 * 2. Accepts HTTP POST /event for real-time hook notifications
 * 3. Broadcasts events to connected WebSocket clients
 * 4. Tracks tool durations by matching pre/post events
 * 5. Proxies voice input to Deepgram for transcription
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket, RawData } from 'ws'
import { watch } from 'chokidar'
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync, statSync } from 'fs'
import { exec, execFile } from 'child_process'
import { dirname, resolve, join, extname } from 'path'
import { hostname } from 'os'
import { randomUUID, randomBytes } from 'crypto'
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'
import type { LiveClient } from '@deepgram/sdk'
import type {
  ClaudeEvent,
  ServerMessage,
  ClientMessage,
  PreToolUseEvent,
  PostToolUseEvent,
  ManagedSession,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionPromptRequest,
  GitStatus,
  TextTile,
  CreateTextTileRequest,
  UpdateTextTileRequest,
  FleetMessage,
  FleetRegisterMessage,
} from '../shared/types.js'
import { DEFAULTS } from '../shared/defaults.js'
import { GitStatusManager } from './GitStatusManager.js'
import { ProjectsManager } from './ProjectsManager.js'
import { fileURLToPath } from 'url'
import { detectTerritory } from './TerritoryDetector.js'
import { ThreatDataBridge } from './ThreatDataBridge.js'
import { SupabasePersistence } from './SupabasePersistence.js'
import { RoadAggregator } from './RoadAggregator.js'
import { ObjectiveManager } from './ObjectiveManager.js'
import { ProductionDataManager } from './ProductionDataManager.js'
import { HandoffListener } from './HandoffListener.js'
import { MonitorOrchestrator } from './monitors/orchestrator.js'
import { WasteDetector } from './WasteDetector.js'
import { FleetSignaling } from './FleetSignaling.js'
import { FleetPersistence } from './FleetPersistence.js'

// Supabase persistence (initialized in startServer if env vars present)
let persistence: SupabasePersistence | null = null

// Objective manager (initialized in main if env vars present)
let objectiveManager: ObjectiveManager | null = null

// Production data manager (Factorio Mode — initialized in main if env vars present)
let productionManager: ProductionDataManager | null = null

// Handoff listener (Realtime subscription — initialized in main if env vars present)
let handoffListener: HandoffListener | null = null

// Monitor orchestrator (PRD 04 — autonomous monitoring)
let monitorOrchestrator: MonitorOrchestrator | null = null

// Waste detector (PRD 13, Section 6 — downstream consumer detection)
let wasteDetector: WasteDetector | null = null

// Fleet signaling (PRD 07 — remote forces WebRTC relay)
let fleetSignaling: FleetSignaling | null = null

// Fleet persistence (PRD 12 — battlefield state survives restarts)
let fleetPersistence: FleetPersistence | null = null

// Road aggregator (hoisted for fleet persistence access)
let roadAggregator: RoadAggregator | null = null

// ============================================================================
// Version (read from package.json)
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================================
// Load .env (no dotenv dependency — simple manual parse)
// ============================================================================
;(function loadEnv() {
  const envPaths = [
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../.env'),
  ]
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex === -1) continue
        const key = trimmed.slice(0, eqIndex).trim()
        const value = trimmed.slice(eqIndex + 1).trim()
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
      break
    }
  }
})()

function getPackageVersion(): string {
  try {
    // Try multiple locations (dev vs compiled)
    const locations = [
      resolve(__dirname, '../package.json'),      // dev: server/ -> package.json
      resolve(__dirname, '../../package.json'),   // compiled: dist/server/ -> package.json
    ]
    for (const loc of locations) {
      if (existsSync(loc)) {
        const pkg = JSON.parse(readFileSync(loc, 'utf-8'))
        return pkg.version || 'unknown'
      }
    }
  } catch {
    // Ignore errors
  }
  return 'unknown'
}

const VERSION = getPackageVersion()

// ============================================================================
// Configuration (env vars override DEFAULTS from shared/defaults.ts)
// ============================================================================

/** Expand ~ to home directory in paths */
function expandHome(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return path.replace('~', process.env.HOME || '')
  }
  return path
}

const PORT = parseInt(process.env.VIBECRAFT_PORT ?? String(DEFAULTS.SERVER_PORT), 10)
const EVENTS_FILE = resolve(expandHome(process.env.VIBECRAFT_EVENTS_FILE ?? DEFAULTS.EVENTS_FILE))
const PENDING_PROMPT_FILE = resolve(expandHome(process.env.VIBECRAFT_PROMPT_FILE ?? '~/.vibecraft/data/pending-prompt.txt'))
const MAX_EVENTS = parseInt(process.env.VIBECRAFT_MAX_EVENTS ?? String(DEFAULTS.MAX_EVENTS), 10)
const DEBUG = process.env.VIBECRAFT_DEBUG === 'true'
const TMUX_SESSION = process.env.VIBECRAFT_TMUX_SESSION ?? DEFAULTS.TMUX_SESSION
const SESSIONS_FILE = resolve(expandHome(process.env.VIBECRAFT_SESSIONS_FILE ?? DEFAULTS.SESSIONS_FILE))
const TILES_FILE = resolve(expandHome(process.env.VIBECRAFT_TILES_FILE ?? '~/.vibecraft/data/tiles.json'))

/** Time before a "working" session auto-transitions to idle (failsafe for missed events) */
const WORKING_TIMEOUT_MS = 120_000 // 2 minutes

/** Time before a continuously-working session transitions to 'exhausted' (2 hours) */
const EXHAUSTED_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Track when each session started its current continuous work period */
const sessionWorkStart: Map<string, number> = new Map()

/** Maximum request body size (1MB) - prevents DoS via memory exhaustion */
const MAX_BODY_SIZE = 1024 * 1024

/** How often to check for stale "working" sessions */
const WORKING_CHECK_INTERVAL_MS = 10_000 // 10 seconds

/** Extended PATH for exec() - includes Homebrew and user paths for macOS/Linux */
const HOME = process.env.HOME || ''
const EXEC_PATH = [
  `${HOME}/.local/bin`,     // User local bin (Claude CLI default location)
  '/opt/homebrew/bin',      // macOS Apple Silicon Homebrew
  '/usr/local/bin',         // macOS Intel Homebrew / Linux local
  process.env.PATH || '',
].join(':')

/** Options for exec() with extended PATH */
const EXEC_OPTIONS = { env: { ...process.env, PATH: EXEC_PATH } }

/** Deepgram API key from environment */
const DEEPGRAM_API_KEY_ENV = 'DEEPGRAM_API_KEY'

/** Deepgram transcription settings */
const DEEPGRAM_MODEL = 'nova-2'
const DEEPGRAM_LANGUAGE = 'en'

/**
 * Validate WebSocket origin header to prevent CSRF attacks.
 * Only browser clients should connect, so we require a valid origin.
 */
function isOriginAllowed(origin: string | undefined): boolean {
  // Require origin header - only browsers send this
  if (!origin) return false

  try {
    const url = new URL(origin)

    // Allow any port on localhost/127.0.0.1 (local development)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return true
    }

    // Production: exact hostname match with HTTPS required
    if ((url.hostname === 'vibecraft.sh' || url.hostname === 'agent-empires.sh') && url.protocol === 'https:') {
      return true
    }

    return false
  } catch {
    return false // Invalid URL format
  }
}

/**
 * Validate and sanitize a directory path for use in shell commands.
 * Returns the resolved path if valid, throws if invalid.
 */
function validateDirectoryPath(inputPath: string): string {
  // Resolve to absolute path (handles ~, .., etc.)
  const resolved = resolve(expandHome(inputPath))

  // Check path exists and is a directory
  if (!existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${inputPath}`)
  }

  const stat = statSync(resolved)
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${inputPath}`)
  }

  // Reject paths with shell metacharacters that could enable injection
  // Even with execFile, tmux passes commands to a shell
  const dangerousChars = /[;&|`$(){}[\]<>\\'"!#*?]/
  if (dangerousChars.test(resolved)) {
    throw new Error(`Directory path contains invalid characters: ${inputPath}`)
  }

  return resolved
}

/**
 * Validate a tmux session name.
 * tmux session names should only contain alphanumeric, underscore, hyphen.
 */
function validateTmuxSession(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid tmux session name: ${name}`)
  }
  return name
}

/**
 * Promisified execFile helper
 */
function execFileAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, EXEC_OPTIONS, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * Safely collect request body with size limit to prevent DoS.
 * Returns a promise that resolves with the body string or rejects on error/oversized.
 */
function collectRequestBody(req: IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0

    req.on('data', (chunk: Buffer | string) => {
      size += chunk.length
      if (size > maxSize) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      body += chunk
    })

    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * Safely send text to a tmux session using load-buffer + paste-buffer.
 * Uses execFile with proper arguments to prevent shell injection.
 */
async function sendToTmuxSafe(tmuxSession: string, text: string): Promise<void> {
  // Validate session name
  validateTmuxSession(tmuxSession)

  // Create temp file with cryptographically secure random name
  const tempFile = `/tmp/agent-empires-prompt-${Date.now()}-${randomBytes(16).toString('hex')}.txt`
  writeFileSync(tempFile, text)

  try {
    // Load text into tmux buffer
    await execFileAsync('tmux', ['load-buffer', tempFile])
    // Paste buffer into session
    await execFileAsync('tmux', ['paste-buffer', '-t', tmuxSession])
    // Send Enter to submit
    await new Promise(r => setTimeout(r, 100)) // Small delay like original
    await execFileAsync('tmux', ['send-keys', '-t', tmuxSession, 'Enter'])
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// State
// ============================================================================

/** All events in memory */
const events: ClaudeEvent[] = []

/** Track seen event IDs to prevent duplicates (from file watcher + POST) */
const seenEventIds = new Set<string>()

/** Track in-flight tool uses for duration calculation */
const pendingToolUses = new Map<string, PreToolUseEvent>()

/** Connected WebSocket clients */
const clients = new Set<WebSocket>()

/** Last read position in file */
let lastFileSize = 0

/** Token tracking per session */
interface SessionTokens {
  lastSeen: number  // Last token count seen in output
  cumulative: number  // Running total (estimated)
  lastUpdate: number  // Timestamp
}
const sessionTokens = new Map<string, SessionTokens>()

/** Last parsed tmux output (to detect changes) */
let lastTmuxHash = ''

/** Track pending permission prompts per session */
interface PermissionOption {
  number: string     // "1", "2", "3"
  label: string      // "Yes", "Yes, and always allow...", "No"
}

interface PermissionPrompt {
  tool: string
  context: string       // The full prompt text
  options: PermissionOption[]  // Available choices
  detectedAt: number
}
const pendingPermissions = new Map<string, PermissionPrompt>()

/** Track sessions that have had the bypass permissions warning handled */
const bypassWarningHandled = new Set<string>()

/** Managed sessions registry */
const managedSessions = new Map<string, ManagedSession>()

/** Text tiles (grid labels) */
const textTiles = new Map<string, TextTile>()

/** Git status tracker for managed sessions */
const gitStatusManager = new GitStatusManager()

/** Project directories manager */
const projectsManager = new ProjectsManager()

/** Active voice transcription sessions (WebSocket client → Deepgram connection) */
const voiceSessions = new Map<WebSocket, LiveClient>()

/** Deepgram API key (loaded on startup) */
let deepgramApiKey: string | null = null

/** Load Deepgram API key from environment */
function loadDeepgramKey(): string | null {
  const key = process.env[DEEPGRAM_API_KEY_ENV]?.trim()
  if (key) {
    log('Deepgram API key loaded from environment')
    return key
  }
  log(`${DEEPGRAM_API_KEY_ENV} not set - voice input disabled`)
  return null
}

/** Map Claude Code session IDs to our managed session IDs */
const claudeToManagedMap = new Map<string, string>()

/** Counter for generating session names */
let sessionCounter = 0

// ============================================================================
// Logging
// ============================================================================

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args)
}

function debug(...args: unknown[]) {
  if (DEBUG) {
    console.log(`[DEBUG ${new Date().toISOString()}]`, ...args)
  }
}

// ============================================================================
// Token Tracking
// ============================================================================

/**
 * Parse token count from Claude Code output
 * Patterns:
 *   ↓ 879 tokens
 *   ↓ 1,234 tokens
 *   ↓ 12.5k tokens
 *   ↓ 12k tokens
 */
function parseTokensFromOutput(output: string): number | null {
  // Match patterns like: ↓ 879 tokens, ↓ 1,234 tokens, ↓ 12.5k tokens
  const patterns = [
    /↓\s*([0-9,]+)\s*tokens?/gi,           // ↓ 879 tokens, ↓ 1,234 tokens
    /↓\s*([0-9.]+)k\s*tokens?/gi,          // ↓ 12.5k tokens, ↓ 12k tokens
  ]

  let maxTokens = 0

  // Pattern 1: plain numbers (possibly with commas)
  const plainMatches = output.matchAll(patterns[0])
  for (const match of plainMatches) {
    const num = parseInt(match[1].replace(/,/g, ''), 10)
    if (num > maxTokens) maxTokens = num
  }

  // Pattern 2: k suffix (thousands)
  const kMatches = output.matchAll(patterns[1])
  for (const match of kMatches) {
    const num = Math.round(parseFloat(match[1]) * 1000)
    if (num > maxTokens) maxTokens = num
  }

  return maxTokens > 0 ? maxTokens : null
}

/**
 * Poll tmux output for token counts
 */
function pollTokens(tmuxSession: string): void {
  try {
    validateTmuxSession(tmuxSession)
  } catch {
    debug(`Invalid tmux session for token polling: ${tmuxSession}`)
    return
  }

  execFile('tmux', ['capture-pane', '-t', tmuxSession, '-p', '-S', '-50'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) {
      debug(`Token poll failed: ${error.message}`)
      return
    }

    // Simple hash to detect changes
    const hash = stdout.slice(-500)
    if (hash === lastTmuxHash) return
    lastTmuxHash = hash

    const tokens = parseTokensFromOutput(stdout)
    if (tokens === null) return

    // Update session tokens (use TMUX_SESSION as session ID for now)
    let session = sessionTokens.get(tmuxSession)
    if (!session) {
      session = { lastSeen: 0, cumulative: 0, lastUpdate: Date.now() }
      sessionTokens.set(tmuxSession, session)
    }

    // If we see a higher token count, update cumulative
    if (tokens > session.lastSeen) {
      const delta = tokens - session.lastSeen
      session.cumulative += delta
      session.lastSeen = tokens
      session.lastUpdate = Date.now()

      debug(`Tokens updated: ${tokens} (cumulative: ${session.cumulative})`)

      // Broadcast token update
      broadcast({
        type: 'tokens',
        payload: {
          session: tmuxSession,
          current: tokens,
          cumulative: session.cumulative,
        },
      } as ServerMessage)
    } else if (tokens < session.lastSeen && tokens > 0) {
      // Token count dropped - likely new conversation, reset tracking
      session.lastSeen = tokens
      session.lastUpdate = Date.now()
      debug(`Token count reset detected: ${tokens}`)
    }
  })
}

/**
 * Start polling for tokens
 */
function startTokenPolling(): void {
  // Poll every 2 seconds - poll all managed sessions
  setInterval(() => {
    for (const session of managedSessions.values()) {
      if (session.status !== 'offline') {
        pollTokens(session.tmuxSession)
      }
    }
    // Also poll the default session for backwards compatibility
    if (!managedSessions.size) {
      pollTokens(TMUX_SESSION)
    }
  }, 2000)
  log(`Token polling started`)
}

// ============================================================================
// Permission Prompt Detection
// ============================================================================

/**
 * Parse tmux output to detect Claude Code permission prompts.
 *
 * Claude Code prompts look like:
 *   ● Bash(rm /tmp/test.txt)
 *   ⎿  Running PreToolUse hook…
 *   ─────────────────────────────
 *   Bash command
 *
 *      rm /tmp/test.txt
 *
 *   Do you want to proceed?
 *   ❯ 1. Yes
 *     2. Yes, and always allow access to tmp/ from this project
 *     3. No
 *
 *   Esc to cancel · Tab to add additional instructions
 *
 * OR (plan mode):
 *   · Bash(prompt: run TypeScript compiler)
 *   Would you like to proceed?
 *
 *     1. Yes, and bypass permissions
 *   ❯ 2. Yes, and manually approve edits
 *     3. Type here to tell Claude what to change
 *
 *   ctrl-g to edit in Vim · ~/.claude/plans/...
 */
function detectPermissionPrompt(output: string): { tool: string; context: string; options: PermissionOption[] } | null {
  const lines = output.split('\n')

  // Look for "Do you want to proceed?" OR "Would you like to proceed?" in recent output
  let proceedLineIdx = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    if (/(Do you want|Would you like) to proceed\?/i.test(lines[i])) {
      proceedLineIdx = i
      break
    }
  }

  if (proceedLineIdx === -1) return null

  // CRITICAL: Verify this is a real Claude Code prompt by checking for the footer
  // "Esc to cancel · Tab to add additional instructions" OR "ctrl-g to edit in Vim"
  let hasFooter = false
  let hasSelector = false
  for (let i = proceedLineIdx + 1; i < Math.min(lines.length, proceedLineIdx + 15); i++) {
    if (/Esc to cancel|ctrl-g to edit/i.test(lines[i])) {
      hasFooter = true
      break
    }
    // Also check for the ❯ selector arrow which indicates the interactive menu
    if (/^\s*❯/.test(lines[i])) {
      hasSelector = true
    }
  }

  // Must have either the footer or the selector arrow to be a real prompt
  if (!hasFooter && !hasSelector) {
    debug('Skipping false positive: no "Esc to cancel"/"ctrl-g" footer or ❯ selector found')
    return null
  }

  // Parse numbered options below the "Do you want to proceed?" line
  const options: PermissionOption[] = []
  for (let i = proceedLineIdx + 1; i < Math.min(lines.length, proceedLineIdx + 10); i++) {
    const line = lines[i]

    // Stop if we hit the footer
    if (/Esc to cancel/i.test(line)) break

    // Match options like "❯ 1. Yes" or "  2. Yes, and always..."
    // The arrow (❯) indicates current selection, but we want all options
    const optionMatch = line.match(/^\s*[❯>]?\s*(\d+)\.\s+(.+)$/)
    if (optionMatch) {
      options.push({
        number: optionMatch[1],
        label: optionMatch[2].trim()
      })
    }
  }

  // Need at least 2 options to be valid
  if (options.length < 2) return null

  // Find the tool name - look backwards for "● ToolName(...)" or "Bash command" header
  let tool = 'Unknown'
  for (let i = proceedLineIdx; i >= Math.max(0, proceedLineIdx - 20); i--) {
    // Match tool header like "● Bash(rm /tmp/test.txt)" or "· Bash(prompt: ...)"
    // ● = bullet, ◐ = half-filled circle, · = middle dot (plan mode)
    const toolMatch = lines[i].match(/[●◐·]\s*(\w+)\s*\(/)
    if (toolMatch) {
      tool = toolMatch[1]
      break
    }
    // Also match standalone tool type like "Bash command" or "Read file"
    const cmdMatch = lines[i].match(/^\s*(Bash|Read|Write|Edit|Grep|Glob|Task|WebFetch|WebSearch)\s+\w+/i)
    if (cmdMatch) {
      tool = cmdMatch[1]
      break
    }
  }

  // Build context from the prompt area (between tool header and options)
  const contextStart = Math.max(0, proceedLineIdx - 10)
  const contextEnd = proceedLineIdx + 1 + options.length
  const context = lines.slice(contextStart, contextEnd).join('\n').trim()

  debug(`Detected permission prompt: tool=${tool}, options=${options.map(o => o.number + ':' + o.label).join(', ')}`)

  return { tool, context, options }
}

/**
 * Detect the bypass permissions warning that appears on first use of --dangerously-skip-permissions.
 * Returns true if the warning is detected and needs to be accepted.
 *
 * The warning looks like:
 *   ╭──────────────────────────────────────────────────────────────────────────────╮
 *   │                                  WARNING                                     │
 *   │                                                                              │
 *   │  You are entering Bypass Permissions mode. In this mode:                     │
 *   │   • All tool calls will be auto-approved                                     │
 *   │   ...                                                                        │
 *   │                                                                              │
 *   │  Are you sure you want to continue?                                          │
 *   │                                                                              │
 *   │      1. No, exit Claude Code                                                 │
 *   │    ❯ 2. Yes, I understand and accept the risks                               │
 *   ╰──────────────────────────────────────────────────────────────────────────────╯
 */
function detectBypassWarning(output: string): boolean {
  // Must have both WARNING and Bypass Permissions mode
  return output.includes('WARNING') && output.includes('Bypass Permissions mode')
}

/**
 * Poll a session for permission prompts
 */
function pollPermissions(sessionId: string, tmuxSession: string): void {
  try {
    validateTmuxSession(tmuxSession)
  } catch {
    debug(`Invalid tmux session for permission polling: ${tmuxSession}`)
    return
  }

  execFile('tmux', ['capture-pane', '-t', tmuxSession, '-p', '-S', '-50'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) {
      debug(`Permission poll failed for ${tmuxSession}: ${error.message}`)
      return
    }

    // Check for bypass permissions warning (first-time use of --dangerously-skip-permissions)
    if (detectBypassWarning(stdout) && !bypassWarningHandled.has(sessionId)) {
      log(`Bypass permissions warning detected for session ${sessionId}, auto-accepting...`)
      bypassWarningHandled.add(sessionId)
      // Send "2" to accept the warning
      execFile('tmux', ['send-keys', '-t', tmuxSession, '2'], EXEC_OPTIONS, (err) => {
        if (err) {
          log(`Failed to auto-accept bypass warning: ${err.message}`)
        } else {
          log(`Bypass permissions warning accepted for session ${sessionId}`)
        }
      })
      return // Don't process further this poll cycle
    }

    const prompt = detectPermissionPrompt(stdout)
    const existing = pendingPermissions.get(sessionId)

    if (prompt && !existing) {
      // New permission prompt detected
      pendingPermissions.set(sessionId, {
        tool: prompt.tool,
        context: prompt.context,
        options: prompt.options,
        detectedAt: Date.now(),
      })

      log(`Permission prompt detected for session ${sessionId}: ${prompt.tool} (${prompt.options.length} options)`)

      // Broadcast to clients with options
      broadcast({
        type: 'permission_prompt',
        payload: {
          sessionId,
          tool: prompt.tool,
          context: prompt.context,
          options: prompt.options,
        },
      } as ServerMessage)

      // Update session status
      const session = managedSessions.get(sessionId)
      if (session) {
        session.status = 'waiting'
        session.currentTool = prompt.tool
        broadcastSessions()
      }
    } else if (!prompt && existing) {
      // Permission prompt was resolved (user responded in terminal or elsewhere)
      pendingPermissions.delete(sessionId)
      log(`Permission prompt resolved for session ${sessionId}`)

      // Broadcast resolution
      broadcast({
        type: 'permission_resolved',
        payload: { sessionId },
      } as ServerMessage)

      // Reset session status
      const session = managedSessions.get(sessionId)
      if (session && session.status === 'waiting') {
        session.status = 'working'
        session.currentTool = undefined
        broadcastSessions()
      }
    }
  })
}

/**
 * Start polling for permission prompts
 */
function startPermissionPolling(): void {
  // Poll every 1 second (more frequent than tokens since permissions are time-sensitive)
  setInterval(() => {
    for (const session of managedSessions.values()) {
      if (session.status !== 'offline') {
        pollPermissions(session.id, session.tmuxSession)
      }
    }
  }, 1000)
  log(`Permission polling started`)
}

/**
 * Send a permission response to a session.
 * The response should be the option number ("1", "2", "3", etc.)
 */
function sendPermissionResponse(sessionId: string, optionNumber: string): boolean {
  const session = managedSessions.get(sessionId)
  if (!session) {
    log(`Cannot send permission response: session ${sessionId} not found`)
    return false
  }

  // Validate it's a number
  if (!/^\d+$/.test(optionNumber)) {
    log(`Invalid permission response: ${optionNumber} (expected number)`)
    return false
  }

  // Validate tmux session name
  try {
    validateTmuxSession(session.tmuxSession)
  } catch {
    log(`Invalid tmux session name: ${session.tmuxSession}`)
    return false
  }

  // Send the option number to tmux - Claude Code expects just the number
  execFile('tmux', ['send-keys', '-t', session.tmuxSession, optionNumber], EXEC_OPTIONS, (error) => {
    if (error) {
      log(`Failed to send permission response: ${error.message}`)
      return
    }

    log(`Sent permission response to ${session.name}: option ${optionNumber}`)

    // Clear the pending permission
    pendingPermissions.delete(sessionId)

    // Update session status
    session.status = 'working'
    session.currentTool = undefined
    broadcastSessions()
  })

  return true
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Generate a short ID for tmux session names
 */
function shortId(): string {
  return randomUUID().slice(0, 8)
}

/**
 * Create a new managed session
 */
function createSession(options: CreateSessionRequest = {}): Promise<ManagedSession> {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    sessionCounter++
    const name = options.name || `Claude ${sessionCounter}`
    const tmuxSession = `agent-empires-${shortId()}`

    // Validate cwd to prevent command injection
    let cwd: string
    try {
      cwd = validateDirectoryPath(options.cwd || process.cwd())
    } catch (err) {
      reject(err)
      return
    }

    // Build claude command with flags
    const flags = options.flags || {}
    const claudeArgs: string[] = []

    // Defaults: continue=true, skipPermissions=true, chrome=false
    if (flags.continue !== false) {
      claudeArgs.push('-c')
    }
    if (flags.skipPermissions !== false) {
      // --permission-mode=bypassPermissions skips the workspace trust dialog
      // --dangerously-skip-permissions skips tool permission prompts
      claudeArgs.push('--permission-mode=bypassPermissions')
      claudeArgs.push('--dangerously-skip-permissions')
    }
    if (flags.chrome) {
      claudeArgs.push('--chrome')
    }

    const claudeCmd = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude'

    // Spawn tmux session with claude using execFile to prevent shell injection
    // Arguments are passed as array, not interpolated into a shell string
    execFile('tmux', [
      'new-session',
      '-d',
      '-s', tmuxSession,
      '-c', cwd,
      `PATH=${EXEC_PATH} ${claudeCmd}`
    ], EXEC_OPTIONS, (error) => {
      if (error) {
        log(`Failed to spawn session: ${error.message}`)
        reject(new Error(`Failed to spawn session: ${error.message}`))
        return
      }

      const session: ManagedSession = {
        id,
        name,
        tmuxSession,
        status: 'idle',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        cwd,
      }

      managedSessions.set(id, session)
      log(`Created session: ${name} (${id.slice(0, 8)}) -> tmux:${tmuxSession} cmd:'${claudeCmd}'`)

      // Track git status for this session
      if (cwd) {
        gitStatusManager.track(id, cwd)
        // Remember this directory for future autocomplete
        projectsManager.addProject(cwd, name)
      }

      // Broadcast and persist
      broadcastSessions()
      saveSessions()

      // Persist to Supabase
      if (persistence) {
        persistence.upsertSession(session)
        persistence.logEvent({
          sessionId: session.id,
          eventType: 'deploy',
          summary: `Deployed ${session.name}`,
          payload: { cwd: session.cwd, source: 'manual' },
        })
      }

      resolve(session)
    })
  })
}

/**
 * Get all managed sessions
 */
function getSessions(): ManagedSession[] {
  return Array.from(managedSessions.values()).map(session => ({
    ...session,
    gitStatus: gitStatusManager.getStatus(session.id) ?? undefined,
  }))
}

/**
 * Get a session by ID
 */
function getSession(id: string): ManagedSession | undefined {
  return managedSessions.get(id)
}

/**
 * Update a session
 */
function updateSession(id: string, updates: UpdateSessionRequest): ManagedSession | null {
  const session = managedSessions.get(id)
  if (!session) return null

  if (updates.name) {
    session.name = updates.name
  }
  if (updates.zonePosition) {
    session.zonePosition = updates.zonePosition
  }

  log(`Updated session: ${session.name} (${id.slice(0, 8)})`)
  broadcastSessions()
  saveSessions()
  return session
}

/**
 * Delete/kill a session
 */
function deleteSession(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const session = managedSessions.get(id)
    if (!session) {
      resolve(false)
      return
    }

    // Kill the tmux session using execFile to prevent shell injection
    try {
      validateTmuxSession(session.tmuxSession)
    } catch {
      log(`Invalid tmux session name: ${session.tmuxSession}`)
      resolve(false)
      return
    }

    execFile('tmux', ['kill-session', '-t', session.tmuxSession], EXEC_OPTIONS, (error) => {
      if (error) {
        log(`Warning: Failed to kill tmux session: ${error.message}`)
      }

      managedSessions.delete(id)
      gitStatusManager.untrack(id)
      // Clean up mapping
      for (const [claudeId, managedId] of claudeToManagedMap) {
        if (managedId === id) {
          claudeToManagedMap.delete(claudeId)
        }
      }

      log(`Deleted session: ${session.name} (${id.slice(0, 8)})`)
      broadcastSessions()
      saveSessions()
      resolve(true)
    })
  })
}

/**
 * Send a prompt to a specific session
 */
async function sendPromptToSession(id: string, prompt: string): Promise<{ ok: boolean; error?: string }> {
  const session = managedSessions.get(id)
  if (!session) {
    return { ok: false, error: 'Session not found' }
  }

  try {
    await sendToTmuxSafe(session.tmuxSession, prompt)
    session.lastActivity = Date.now()
    log(`Prompt sent to ${session.name}: ${prompt.slice(0, 50)}...`)
    return { ok: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log(`Failed to send prompt to ${session.name}: ${msg}`)
    return { ok: false, error: msg }
  }
}

/**
 * Check if tmux sessions are still alive and update status
 */
function checkSessionHealth(): void {
  exec('tmux list-sessions -F "#{session_name}"', EXEC_OPTIONS, (error, stdout) => {
    if (error) {
      // tmux might not be running
      for (const session of managedSessions.values()) {
        if (session.status !== 'offline') {
          session.status = 'offline'
        }
      }
      return
    }

    const activeSessions = new Set(stdout.trim().split('\n'))
    let changed = false

    for (const session of managedSessions.values()) {
      const isAlive = activeSessions.has(session.tmuxSession)
      const newStatus = isAlive ? (session.status === 'offline' ? 'idle' : session.status) : 'offline'

      if (session.status !== newStatus) {
        const wasOnline = session.status !== 'offline'
        session.status = newStatus
        changed = true

        // Sync status to Supabase
        if (persistence) {
          if (newStatus === 'offline' && wasOnline) {
            persistence.terminateSession(session.id)
            persistence.logEvent({
              sessionId: session.id,
              eventType: 'terminate',
              summary: `${session.name} went offline`,
            })
          } else if (newStatus !== 'offline') {
            persistence.updateSessionStatus(session.id, newStatus)
          }
        }
      }
    }

    if (changed) {
      broadcastSessions()
      saveSessions() // Persist state changes
    }
  })
}

/**
 * Check for stale "working" sessions and transition them to idle
 * This is a failsafe for missed stop events
 */
function checkWorkingTimeout(): void {
  const now = Date.now()
  let changed = false

  for (const session of managedSessions.values()) {
    if (session.status === 'working' || session.status === 'combat') {
      const timeSinceActivity = now - session.lastActivity

      // Check for exhaustion: continuously working for >2 hours
      const workStart = sessionWorkStart.get(session.id)
      if (workStart && (now - workStart) > EXHAUSTED_THRESHOLD_MS) {
        log(`Session "${session.name}" exhausted after ${Math.round((now - workStart) / 60000)}min of continuous work`)
        session.status = 'exhausted'
        changed = true
        continue
      }

      // Existing failsafe: no activity for 2 min → idle
      if (session.status === 'working' && timeSinceActivity > WORKING_TIMEOUT_MS) {
        log(`Session "${session.name}" timed out after ${Math.round(timeSinceActivity / 1000)}s of no activity`)
        session.status = 'idle'
        session.currentTool = undefined
        sessionWorkStart.delete(session.id)
        changed = true
      }
    }

    // Clear work start tracker when session goes idle or offline
    if (session.status === 'idle' || session.status === 'offline') {
      sessionWorkStart.delete(session.id)
    }
  }

  if (changed) {
    broadcastSessions()
    saveSessions()
  }
}

/**
 * Save sessions to disk for persistence across restarts
 */
function saveSessions(): void {
  try {
    const data = {
      sessions: Array.from(managedSessions.values()),
      claudeToManagedMap: Array.from(claudeToManagedMap.entries()),
      sessionCounter,
    }
    writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2))
    debug(`Saved ${managedSessions.size} sessions to ${SESSIONS_FILE}`)
  } catch (e) {
    console.error('Failed to save sessions:', e)
  }
}

/**
 * Load sessions from disk on startup
 */
function loadSessions(): void {
  if (!existsSync(SESSIONS_FILE)) {
    debug('No saved sessions file found')
    return
  }

  try {
    const content = readFileSync(SESSIONS_FILE, 'utf-8')
    const data = JSON.parse(content)

    // Restore sessions
    if (Array.isArray(data.sessions)) {
      for (const session of data.sessions) {
        // Mark all as offline initially - health check will update
        session.status = 'offline'
        session.currentTool = undefined
        managedSessions.set(session.id, session)
        // Track git status if session has a cwd
        if (session.cwd) {
          gitStatusManager.track(session.id, session.cwd)
        }
      }
    }

    // Ensure sessions have readable names (project name preferred over callsign)
    for (const [id, session] of managedSessions) {
      if (!session.name || session.name.startsWith('Claude ')) {
        const cwdBase = session.cwd ? session.cwd.split('/').pop() : null
        session.name = cwdBase || generateCallsign(id)
      }
    }

    // Restore linking map
    if (Array.isArray(data.claudeToManagedMap)) {
      for (const [claudeId, managedId] of data.claudeToManagedMap) {
        claudeToManagedMap.set(claudeId, managedId)
      }
    }

    // Restore counter
    if (typeof data.sessionCounter === 'number') {
      sessionCounter = data.sessionCounter
    }

    log(`Loaded ${managedSessions.size} sessions from ${SESSIONS_FILE}`)
  } catch (e) {
    console.error('Failed to load sessions:', e)
  }
}

/**
 * Broadcast current sessions to all clients
 */
function broadcastSessions(): void {
  broadcast({
    type: 'sessions',
    payload: getSessions(),
  })
}

// ============================================================================
// Text Tiles (Grid Labels)
// ============================================================================

/**
 * Get all text tiles
 */
function getTiles(): TextTile[] {
  return Array.from(textTiles.values())
}

/**
 * Save text tiles to disk
 */
function saveTiles(): void {
  try {
    const data = Array.from(textTiles.values())
    writeFileSync(TILES_FILE, JSON.stringify(data, null, 2))
    debug(`Saved ${textTiles.size} tiles to ${TILES_FILE}`)
  } catch (e) {
    console.error('Failed to save tiles:', e)
  }
}

/**
 * Load text tiles from disk
 */
function loadTiles(): void {
  if (!existsSync(TILES_FILE)) {
    debug('No saved tiles file found')
    return
  }

  try {
    const content = readFileSync(TILES_FILE, 'utf-8')
    const data = JSON.parse(content) as TextTile[]

    for (const tile of data) {
      textTiles.set(tile.id, tile)
    }

    log(`Loaded ${textTiles.size} tiles from ${TILES_FILE}`)
  } catch (e) {
    console.error('Failed to load tiles:', e)
  }
}

/**
 * Broadcast text tiles to all clients
 */
function broadcastTiles(): void {
  broadcast({
    type: 'text_tiles',
    payload: getTiles(),
  })
}

// ============================================================================
// Voice Transcription (Deepgram)
// ============================================================================

/**
 * Start a voice transcription session for a WebSocket client
 */
function startVoiceSession(ws: WebSocket): boolean {
  if (!deepgramApiKey) {
    ws.send(JSON.stringify({ type: 'voice_error', payload: { error: 'Voice input not configured' } }))
    return false
  }

  // Clean up any existing session
  stopVoiceSession(ws)

  try {
    const deepgram = createClient(deepgramApiKey)
    const connection = deepgram.listen.live({
      model: DEEPGRAM_MODEL,
      language: DEEPGRAM_LANGUAGE,
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
    })

    connection.on(LiveTranscriptionEvents.Open, () => {
      ws.send(JSON.stringify({ type: 'voice_ready', payload: {} }))
    })

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript
      if (transcript) {
        ws.send(JSON.stringify({
          type: 'voice_transcript',
          payload: { transcript, isFinal: data.is_final }
        }))
      }
    })

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      ws.send(JSON.stringify({ type: 'voice_utterance_end', payload: {} }))
    })

    connection.on(LiveTranscriptionEvents.Error, (error) => {
      log(`Deepgram error: ${error}`)
      ws.send(JSON.stringify({ type: 'voice_error', payload: { error: String(error) } }))
    })

    connection.on(LiveTranscriptionEvents.Close, () => {
      voiceSessions.delete(ws)
    })

    voiceSessions.set(ws, connection)
    debug('Voice session started')
    return true
  } catch (e) {
    log(`Failed to start voice session: ${e}`)
    ws.send(JSON.stringify({ type: 'voice_error', payload: { error: String(e) } }))
    return false
  }
}

/**
 * Stop a voice transcription session
 */
function stopVoiceSession(ws: WebSocket): void {
  const connection = voiceSessions.get(ws)
  if (connection) {
    try {
      connection.requestClose()
    } catch (e) {
      // Ignore close errors
    }
    voiceSessions.delete(ws)
    debug('Voice session stopped')
  }
}

/**
 * Send audio data to Deepgram for transcription
 */
function sendVoiceAudio(ws: WebSocket, audioData: Buffer): void {
  const connection = voiceSessions.get(ws)
  if (!connection) return

  try {
    // Convert Node.js Buffer to ArrayBuffer for Deepgram SDK
    const arrayBuffer = audioData.buffer.slice(
      audioData.byteOffset,
      audioData.byteOffset + audioData.byteLength
    )
    connection.send(arrayBuffer)
  } catch (e) {
    debug(`Error sending audio: ${e}`)
  }
}

/**
 * Link a Claude Code session ID to a managed session
 */
function linkClaudeSession(claudeSessionId: string, managedSessionId: string): void {
  claudeToManagedMap.set(claudeSessionId, managedSessionId)
}

/**
 * Find managed session by Claude Code session ID
 */
function findManagedSession(claudeSessionId: string): ManagedSession | undefined {
  const managedId = claudeToManagedMap.get(claudeSessionId)
  if (managedId) {
    return managedSessions.get(managedId)
  }
  return undefined
}

// ============================================================================
// Event Processing
// ============================================================================

function processEvent(event: ClaudeEvent): ClaudeEvent {
  // Track pre_tool_use for duration calculation
  if (event.type === 'pre_tool_use') {
    const preEvent = event as PreToolUseEvent
    pendingToolUses.set(preEvent.toolUseId, preEvent)
    debug(`Tracking tool use: ${preEvent.tool} (${preEvent.toolUseId})`)
  }

  // Calculate duration for post_tool_use
  if (event.type === 'post_tool_use') {
    const postEvent = event as PostToolUseEvent
    const preEvent = pendingToolUses.get(postEvent.toolUseId)
    if (preEvent) {
      postEvent.duration = postEvent.timestamp - preEvent.timestamp
      pendingToolUses.delete(postEvent.toolUseId)
      debug(`Tool ${postEvent.tool} took ${postEvent.duration}ms`)
    }
  }

  return event
}

/** Detect unit class for a newly discovered session */
function detectUnitClass(sessionId: string, eventList: ClaudeEvent[]): string {
  // Check recent events for a Task tool call that might have spawned this session
  const now = Date.now()
  const recentTaskCalls = eventList
    .filter(e =>
      e.type === 'pre_tool_use' &&
      (e as PreToolUseEvent).tool === 'Task' &&
      now - e.timestamp < 30000 &&
      e.sessionId !== sessionId
    ) as PreToolUseEvent[]

  if (recentTaskCalls.length > 0) {
    // This is likely a sub-agent — check for model hints
    const lastTask = recentTaskCalls[recentTaskCalls.length - 1]
    const input = lastTask.toolInput as Record<string, unknown>
    const model = String(input.model || '').toLowerCase()
    if (model.includes('haiku')) return 'recon'
    if (model.includes('opus')) return 'command'
    return 'operations' // default sub-agents to sonnet/operations
  }

  return 'command' // standalone sessions are command class
}

/** Detect parent session for a newly discovered session */
function detectParentSession(sessionId: string, eventList: ClaudeEvent[]): string | undefined {
  const now = Date.now()
  // Look for a recent Task tool call from a different session
  const recentTaskCalls = eventList
    .filter(e =>
      e.type === 'pre_tool_use' &&
      (e as PreToolUseEvent).tool === 'Task' &&
      now - e.timestamp < 30000 &&
      e.sessionId !== sessionId
    ) as PreToolUseEvent[]

  if (recentTaskCalls.length > 0) {
    const lastTask = recentTaskCalls[recentTaskCalls.length - 1]
    // Find the managed session ID for the parent's claude session ID
    const parentManagedId = claudeToManagedMap.get(lastTask.sessionId)
    return parentManagedId || lastTask.sessionId
  }

  return undefined
}

/** Generate a deterministic military callsign from a session ID */
function generateCallsign(sessionId: string): string {
  const prefixes = [
    'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Ghost',
    'Havoc', 'Iron', 'Jackal', 'Kilo', 'Lima', 'Maverick', 'Neon',
    'Omega', 'Phoenix', 'Raven', 'Sierra', 'Titan', 'Viper', 'Wolf',
    'Apex', 'Bolt', 'Cipher', 'Dagger', 'Ember', 'Falcon', 'Gryphon',
  ]
  const suffixes = [
    'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Zero', 'Prime', 'Lead', 'Wing', 'Core', 'Edge', 'Node',
  ]
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0
  }
  const p = Math.abs(hash) % prefixes.length
  const s = Math.abs(hash >> 8) % suffixes.length
  return `${prefixes[p]}-${suffixes[s]}`
}

function addEvent(event: ClaudeEvent) {
  // Skip duplicates (hook writes to file AND posts to server)
  if (seenEventIds.has(event.id)) {
    debug(`Skipping duplicate event: ${event.id}`)
    return
  }
  seenEventIds.add(event.id)

  // Trim old IDs to prevent memory leak (keep last 2x MAX_EVENTS)
  if (seenEventIds.size > MAX_EVENTS * 2) {
    const idsToKeep = [...seenEventIds].slice(-MAX_EVENTS)
    seenEventIds.clear()
    idsToKeep.forEach(id => seenEventIds.add(id))
  }

  const processed = processEvent(event)
  events.push(processed)

  // Trim old events if over limit
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }

  // Update managed session status based on event
  // Auto-register unknown Claude sessions as managed sessions (hook-discovered units)
  let managedSession = findManagedSession(event.sessionId)
  if (!managedSession && event.sessionId && event.sessionId !== 'unknown') {
    const id = event.sessionId
    const cwdName = event.cwd ? event.cwd.split('/').pop() : undefined
    const callsign = generateCallsign(id)
    const parentId = detectParentSession(event.sessionId, events)
    const session: ManagedSession = {
      id,
      name: cwdName || callsign,
      status: 'working',
      cwd: event.cwd || undefined,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      claudeSessionId: id,
      parentSessionId: parentId,
      source: 'hook',
    } as any
    ;(session as any).unitClass = detectUnitClass(event.sessionId, events)
    managedSessions.set(id, session)
    claudeToManagedMap.set(id, id)
    log(`Auto-registered session from hook: ${session.name} (${id.slice(0, 12)}) [${(session as any).unitClass}]${parentId ? ` parent:${parentId.slice(0, 12)}` : ''}`)
    managedSession = session
    broadcastSessions()
    saveSessions()

    // Persist auto-registered session to Supabase
    if (persistence) {
      persistence.upsertSession(session)
      persistence.logEvent({
        sessionId: id,
        eventType: 'deploy',
        summary: `Auto-registered ${session.name}`,
        payload: { source: 'hook', unitClass: (session as any).unitClass, parentId },
      })
    }
  }
  if (managedSession) {
    const prevStatus = managedSession.status
    managedSession.lastActivity = Date.now() // Use current time for accurate timeout tracking
    managedSession.cwd = event.cwd

    // Update status based on event type
    switch (event.type) {
      case 'pre_tool_use':
        // Only override combat with working if not currently in combat (combat is sticky until objective completes)
        if (managedSession.status !== 'combat') {
          managedSession.status = 'working'
        }
        managedSession.currentTool = (event as PreToolUseEvent).tool
        // Track when continuous work started
        if (!sessionWorkStart.has(managedSession.id)) {
          sessionWorkStart.set(managedSession.id, Date.now())
        }

        // Virtual sub-agent: when parent fires an Agent tool, spawn a temporary unit
        if ((event as PreToolUseEvent).tool === 'Agent') {
          const preEvt = event as PreToolUseEvent
          const input = preEvt.toolInput as Record<string, unknown>
          const desc = String(input.description || input.prompt || '').slice(0, 60)
          const subId = `${event.sessionId}-sub-${preEvt.toolUseId}`
          const subSession: ManagedSession = {
            id: subId,
            name: desc || 'Sub-Agent',
            status: 'working',
            cwd: event.cwd || undefined,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            claudeSessionId: subId,
            parentSessionId: managedSession.id,
            source: 'hook',
          } as any
          const model = String(input.model || '').toLowerCase()
          ;(subSession as any).unitClass = model.includes('haiku') ? 'recon' : model.includes('opus') ? 'command' : 'operations'
          managedSessions.set(subId, subSession)
          claudeToManagedMap.set(subId, subId)
          log(`[SubAgent] Spawned virtual unit: ${subSession.name} (${subId.slice(0, 20)}...) parent:${managedSession.name}`)
          broadcastSessions()
        }
        break

      case 'post_tool_use':
        // Tool completed - update activity time but stay "working"
        // (Claude might be using more tools, stop event marks idle)
        managedSession.currentTool = undefined

        // Virtual sub-agent: when Agent tool completes, retire the virtual unit
        if ((event as PostToolUseEvent).tool === 'Agent') {
          const postEvt = event as PostToolUseEvent
          const subId = `${event.sessionId}-sub-${postEvt.toolUseId}`
          const subSession = managedSessions.get(subId)
          if (subSession) {
            subSession.status = 'offline'
            log(`[SubAgent] Completed: ${subSession.name}`)
            broadcastSessions()
            // Remove after 30 seconds so it fades out on the battlefield
            setTimeout(() => {
              managedSessions.delete(subId)
              claudeToManagedMap.delete(subId)
              broadcastSessions()
              saveSessions()
            }, 30000)
          }
        }
        break

      case 'user_prompt_submit':
        // User submitted prompt - Claude is now processing
        managedSession.status = 'working'
        managedSession.currentTool = undefined
        break

      case 'stop':
      case 'session_end':
        managedSession.status = 'idle'
        managedSession.currentTool = undefined
        sessionWorkStart.delete(managedSession.id)
        break
    }

    // Broadcast and persist if status changed
    if (managedSession.status !== prevStatus) {
      broadcastSessions()
      saveSessions()
    }
  }

  // Detect territory and attach to event before broadcasting
  const territory = detectTerritory(processed)
  const enriched = { ...processed, territory } as ClaudeEvent & { territory: string }

  // Broadcast to all clients
  broadcast({ type: 'event', payload: enriched })

  // Persist event + status to Supabase (fire-and-forget)
  if (persistence && managedSession) {
    const sessionId = managedSession.id

    switch (event.type) {
      case 'pre_tool_use': {
        const toolName = (event as PreToolUseEvent).tool
        persistence.logEvent({
          sessionId,
          eventType: 'tool_call',
          territory,
          toolName,
          summary: `Using ${toolName}`,
        })
        persistence.incrementSessionStats(sessionId, 'tools_invoked')
        persistence.updateSessionStatus(sessionId, 'working', territory)
        break
      }
      case 'post_tool_use': {
        const postEvent = event as PostToolUseEvent
        const duration = (postEvent as any).durationMs || undefined
        persistence.logEvent({
          sessionId,
          eventType: 'tool_call',
          territory,
          toolName: postEvent.tool,
          summary: `Completed ${postEvent.tool}`,
          durationMs: duration,
        })
        break
      }
      case 'stop':
      case 'session_end':
        persistence.logEvent({
          sessionId,
          eventType: 'status_change',
          territory,
          summary: `Session ${event.type === 'session_end' ? 'ended' : 'stopped'}`,
        })
        persistence.updateSessionStatus(sessionId, 'idle', territory)
        persistence.incrementSessionStats(sessionId, 'tasks_completed')
        break

      case 'user_prompt_submit':
        persistence.logEvent({
          sessionId,
          eventType: 'status_change',
          territory,
          summary: 'Received prompt',
        })
        persistence.updateSessionStatus(sessionId, 'working', territory)
        break
    }
  }
}

// ============================================================================
// File Watching
// ============================================================================

function loadEventsFromFile() {
  if (!existsSync(EVENTS_FILE)) {
    debug(`Events file not found: ${EVENTS_FILE}`)
    return
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8')
  const lines = content.trim().split('\n').filter(Boolean)

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ClaudeEvent
      processEvent(event)
      events.push(event)
    } catch (e) {
      debug(`Failed to parse event line: ${line}`)
    }
  }

  lastFileSize = content.length
  log(`Loaded ${events.length} events from file`)
}

function watchEventsFile() {
  // Ensure directory exists
  const dir = dirname(EVENTS_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // Create file if it doesn't exist
  if (!existsSync(EVENTS_FILE)) {
    appendFileSync(EVENTS_FILE, '')
  }

  const watcher = watch(EVENTS_FILE, {
    persistent: true,
    usePolling: true,
    interval: 100,
  })

  watcher.on('change', () => {
    try {
      const content = readFileSync(EVENTS_FILE, 'utf-8')

      // Only process new content
      if (content.length > lastFileSize) {
        const newContent = content.slice(lastFileSize)
        const newLines = newContent.trim().split('\n').filter(Boolean)

        for (const line of newLines) {
          try {
            const event = JSON.parse(line) as ClaudeEvent
            addEvent(event)
            debug(`New event from file: ${event.type}`)
          } catch (e) {
            debug(`Failed to parse new event: ${line}`)
          }
        }

        lastFileSize = content.length
      }
    } catch (e) {
      debug(`Error reading events file: ${e}`)
    }
  })

  log(`Watching events file: ${EVENTS_FILE}`)
}

// ============================================================================
// WebSocket
// ============================================================================

function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

function handleClientMessage(ws: WebSocket, message: ClientMessage) {
  switch (message.type) {
    case 'subscribe':
      debug('Client subscribed')
      break

    case 'get_history': {
      const limit = message.payload?.limit ?? 100
      const history = events.slice(-limit)
      const response: ServerMessage = { type: 'history', payload: history }
      ws.send(JSON.stringify(response))
      debug(`Sent ${history.length} historical events`)
      break
    }

    case 'ping':
      // Just acknowledge, no response needed
      break

    case 'voice_start':
      startVoiceSession(ws)
      break

    case 'voice_stop':
      stopVoiceSession(ws)
      break

    case 'permission_response': {
      const { sessionId, response } = message.payload
      sendPermissionResponse(sessionId, response)
      break
    }

    default:
      debug(`Unknown message type: ${(message as { type: string }).type}`)
  }
}

// ============================================================================
// HTTP Server (for hook notifications)
// ============================================================================

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin

  // CORS headers - only allow specific origins
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  if (req.method === 'OPTIONS') {
    // Preflight: reject if origin not allowed
    if (!origin || !isOriginAllowed(origin)) {
      res.writeHead(403)
      res.end()
      return
    }
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/event') {
    collectRequestBody(req).then(body => {
      try {
        const event = JSON.parse(body) as ClaudeEvent
        addEvent(event)
        debug(`Received event via HTTP: ${event.type}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        debug(`Failed to parse HTTP event: ${e}`)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      version: VERSION,
      clients: clients.size,
      events: events.length,
      voiceEnabled: !!deepgramApiKey,
    }))
    return
  }

  // Test roads — inject sample data to verify rendering
  if (req.method === 'GET' && req.url === '/test-roads') {
    const testRoads = [
      { fromTerritory: 'hq', toTerritory: 'fulfillment', packetCount: 45, roadLevel: 4, lastPacketAt: new Date().toISOString() },
      { fromTerritory: 'hq', toTerritory: 'lead-gen', packetCount: 12, roadLevel: 2, lastPacketAt: new Date().toISOString() },
      { fromTerritory: 'fulfillment', toTerritory: 'support', packetCount: 70, roadLevel: 5, lastPacketAt: new Date().toISOString() },
      { fromTerritory: 'lead-gen', toTerritory: 'sales', packetCount: 8, roadLevel: 2, lastPacketAt: new Date().toISOString() },
      { fromTerritory: 'sales', toTerritory: 'fulfillment', packetCount: 25, roadLevel: 3, lastPacketAt: new Date().toISOString() },
    ]
    broadcast({ type: 'roads', payload: testRoads } as any)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, roads: testRoads.length }))
    return
  }

  // POST /packets — spawn a visual packet on a road
  if (req.method === 'POST' && req.url === '/packets') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const { from, to, priority, label } = JSON.parse(body)
        if (!from || !to) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing from/to' }))
          return
        }
        const packet = {
          id: randomUUID(),
          fromTerritory: from,
          toTerritory: to,
          priority: priority || 'normal',
          label: label || undefined,
          createdAt: Date.now(),
        }
        broadcast({ type: 'packet', payload: packet } as any)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, packet }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    })
    return
  }

  // GET /packets/test — spawn 5 test packets on various roads
  if (req.method === 'GET' && req.url === '/packets/test') {
    const testPackets = [
      { from: 'hq', to: 'fulfillment', priority: 'critical', label: 'deploy' },
      { from: 'lead-gen', to: 'sales', priority: 'high', label: 'handoff' },
      { from: 'sales', to: 'fulfillment', priority: 'normal', label: 'ticket' },
      { from: 'fulfillment', to: 'support', priority: 'low', label: 'docs' },
      { from: 'hq', to: 'lead-gen', priority: 'high', label: 'campaign' },
    ]
    for (const tp of testPackets) {
      const packet = {
        id: randomUUID(),
        fromTerritory: tp.from,
        toTerritory: tp.to,
        priority: tp.priority,
        label: tp.label,
        createdAt: Date.now(),
      }
      broadcast({ type: 'packet', payload: packet } as any)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, count: testPackets.length }))
    return
  }

  // Config (username, etc)
  if (req.method === 'GET' && req.url === '/config') {
    const username = process.env.USER || process.env.USERNAME || 'claude-user'
    const host = hostname()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      username,
      hostname: host,
      tmuxSession: TMUX_SESSION,
    }))
    return
  }

  // Stats
  if (req.method === 'GET' && req.url === '/stats') {
    const toolCounts: Record<string, number> = {}
    const toolDurations: Record<string, number[]> = {}

    for (const event of events) {
      if (event.type === 'post_tool_use') {
        const e = event as PostToolUseEvent
        toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1
        if (e.duration !== undefined) {
          toolDurations[e.tool] = toolDurations[e.tool] ?? []
          toolDurations[e.tool].push(e.duration)
        }
      }
    }

    const avgDurations: Record<string, number> = {}
    for (const [tool, durations] of Object.entries(toolDurations)) {
      avgDurations[tool] = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length
      )
    }

    // Collect token data
    const tokens: Record<string, { current: number; cumulative: number }> = {}
    for (const [session, data] of sessionTokens) {
      tokens[session] = { current: data.lastSeen, cumulative: data.cumulative }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      totalEvents: events.length,
      toolCounts,
      avgDurations,
      tokens,
    }))
    return
  }

  // Submit prompt from browser
  if (req.method === 'POST' && req.url === '/prompt') {
    collectRequestBody(req).then(body => {
      try {
        const { prompt, send } = JSON.parse(body) as { prompt: string; send?: boolean }
        if (!prompt || typeof prompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Prompt is required' }))
          return
        }

        // Write prompt to file
        const dir = dirname(PENDING_PROMPT_FILE)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
        writeFileSync(PENDING_PROMPT_FILE, prompt, 'utf-8')
        log(`Prompt saved: ${prompt.slice(0, 50)}...`)

        // If send=true, inject into tmux session
        if (send) {
          // Use safe helper to prevent command injection
          sendToTmuxSafe(TMUX_SESSION, prompt)
            .then(() => {
              log(`Prompt sent to tmux session: ${TMUX_SESSION}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, saved: PENDING_PROMPT_FILE, sent: true }))
            })
            .catch((error) => {
              log(`tmux send failed: ${error.message}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: true,
                saved: PENDING_PROMPT_FILE,
                sent: false,
                tmuxError: error.message
              }))
            })
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, saved: PENDING_PROMPT_FILE }))
      } catch (e) {
        debug(`Failed to save prompt: ${e}`)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // Get pending prompt
  if (req.method === 'GET' && req.url === '/prompt') {
    if (existsSync(PENDING_PROMPT_FILE)) {
      const prompt = readFileSync(PENDING_PROMPT_FILE, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt, file: PENDING_PROMPT_FILE }))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt: null }))
    }
    return
  }

  // Clear pending prompt
  if (req.method === 'DELETE' && req.url === '/prompt') {
    if (existsSync(PENDING_PROMPT_FILE)) {
      unlinkSync(PENDING_PROMPT_FILE)
      log('Pending prompt cleared')
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // Get tmux output (Claude's responses)
  if (req.method === 'GET' && req.url === '/tmux-output') {
    try {
      validateTmuxSession(TMUX_SESSION)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session name', output: '' }))
      return
    }

    // Capture last 100 lines from tmux pane
    execFile('tmux', ['capture-pane', '-t', TMUX_SESSION, '-p', '-S', '-100'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: error.message, output: '' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, output: stdout }))
    })
    return
  }

  // Cancel - send Ctrl+C to tmux (legacy, for backwards compat)
  if (req.method === 'POST' && req.url === '/cancel') {
    try {
      validateTmuxSession(TMUX_SESSION)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session name' }))
      return
    }

    execFile('tmux', ['send-keys', '-t', TMUX_SESSION, 'C-c'], EXEC_OPTIONS, (error) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (error) {
        log(`Cancel failed: ${error.message}`)
        res.end(JSON.stringify({ ok: false, error: error.message }))
      } else {
        log(`Sent Ctrl+C to tmux session: ${TMUX_SESSION}`)
        res.end(JSON.stringify({ ok: true }))
      }
    })
    return
  }

  // ============================================================================
  // Session Management Endpoints
  // ============================================================================

  // Get server info (cwd, etc.)
  if (req.method === 'GET' && req.url === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, cwd: process.cwd() }))
    return
  }

  // List all sessions
  if (req.method === 'GET' && req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, sessions: getSessions() }))
    return
  }

  // Force refresh sessions (trigger health check)
  if (req.method === 'POST' && req.url === '/sessions/refresh') {
    log('Manual session refresh requested')
    checkSessionHealth()
    // Return current sessions (health check updates async, but we give immediate response)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, sessions: getSessions() }))
    return
  }

  // Create a new session
  if (req.method === 'POST' && req.url === '/sessions') {
    collectRequestBody(req).then(async body => {
      try {
        const options = body ? JSON.parse(body) as CreateSessionRequest : {}
        const session = await createSession(options)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, session }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // ============================================================================
  // Projects API (known directories for autocomplete)
  // ============================================================================

  // List all known projects
  if (req.method === 'GET' && req.url === '/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, projects: projectsManager.getProjects() }))
    return
  }

  // Autocomplete path
  if (req.method === 'GET' && req.url?.startsWith('/projects/autocomplete')) {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const query = url.searchParams.get('q') || ''
    const results = projectsManager.autocomplete(query)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, results }))
    return
  }

  // Remove a project from the list
  if (req.method === 'DELETE' && req.url?.startsWith('/projects/')) {
    const path = decodeURIComponent(req.url.slice('/projects/'.length))
    projectsManager.removeProject(path)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // Session-specific endpoints: /sessions/:id
  const sessionMatch = req.url?.match(/^\/sessions\/([a-f0-9-]+)(?:\/(.+))?$/)
  if (sessionMatch) {
    const sessionId = sessionMatch[1]
    const action = sessionMatch[2] // e.g., "prompt", "cancel"

    // GET /sessions/:id - Get session details
    if (req.method === 'GET' && !action) {
      const session = getSession(sessionId)
      if (session) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, session }))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
      }
      return
    }

    // PATCH /sessions/:id - Update session (rename)
    if (req.method === 'PATCH' && !action) {
      collectRequestBody(req).then(body => {
        try {
          const updates = JSON.parse(body) as UpdateSessionRequest
          const session = updateSession(sessionId, updates)
          if (session) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, session }))
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // DELETE /sessions/:id - Kill session
    if (req.method === 'DELETE' && !action) {
      deleteSession(sessionId).then((deleted) => {
        if (deleted) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
        }
      })
      return
    }

    // POST /sessions/:id/prompt - Send prompt to specific session
    if (req.method === 'POST' && action === 'prompt') {
      collectRequestBody(req).then(async body => {
        try {
          const { prompt } = JSON.parse(body) as SessionPromptRequest
          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Prompt is required' }))
            return
          }
          const result = await sendPromptToSession(sessionId, prompt)
          res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // POST /sessions/:id/cancel - Send Ctrl+C to specific session
    if (req.method === 'POST' && action === 'cancel') {
      const session = getSession(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
        return
      }

      try {
        validateTmuxSession(session.tmuxSession)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session name' }))
        return
      }

      execFile('tmux', ['send-keys', '-t', session.tmuxSession, 'C-c'], EXEC_OPTIONS, (error) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (error) {
          res.end(JSON.stringify({ ok: false, error: error.message }))
        } else {
          log(`Sent Ctrl+C to ${session.name}`)
          res.end(JSON.stringify({ ok: true }))
        }
      })
      return
    }

    // POST /sessions/:id/permission - Respond to a permission prompt
    if (req.method === 'POST' && action === 'permission') {
      const session = getSession(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
        return
      }

      collectRequestBody(req).then(body => {
        try {
          const { response } = JSON.parse(body) as { response: string }
          if (!response) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Missing response field' }))
            return
          }

          sendPermissionResponse(sessionId, response)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // POST /sessions/:id/restart - Restart an offline session
    if (req.method === 'POST' && action === 'restart') {
      const session = getSession(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
        return
      }

      // Validate inputs to prevent command injection
      try {
        validateTmuxSession(session.tmuxSession)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session name' }))
        return
      }

      let cwd: string
      try {
        cwd = validateDirectoryPath(session.cwd || process.cwd())
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: `Invalid directory: ${err instanceof Error ? err.message : err}` }))
        return
      }

      // Kill existing tmux session if it exists (ignore errors)
      execFile('tmux', ['kill-session', '-t', session.tmuxSession], EXEC_OPTIONS, () => {
        // Respawn tmux session with claude using execFile
        execFile('tmux', [
          'new-session',
          '-d',
          '-s', session.tmuxSession,
          '-c', cwd,
          `PATH=${EXEC_PATH} claude -c --permission-mode=bypassPermissions --dangerously-skip-permissions`
        ], EXEC_OPTIONS, (error) => {
          if (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `Failed to restart: ${error.message}` }))
            return
          }

          // Update session state
          session.status = 'idle'
          session.lastActivity = Date.now()
          session.claudeSessionId = undefined // Will be re-linked when events come in
          session.currentTool = undefined

          // Clear old linking
          for (const [claudeId, managedId] of claudeToManagedMap) {
            if (managedId === session.id) {
              claudeToManagedMap.delete(claudeId)
            }
          }

          log(`Restarted session: ${session.name} (${session.id.slice(0, 8)})`)
          broadcastSessions()
          saveSessions()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, session }))
        })
      })
      return
    }

    // POST /sessions/:id/link - Link Claude session ID to managed session
    if (req.method === 'POST' && action === 'link') {
      collectRequestBody(req).then(body => {
        try {
          const { claudeSessionId } = JSON.parse(body) as { claudeSessionId: string }
          if (!claudeSessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'claudeSessionId is required' }))
            return
          }
          const session = getSession(sessionId)
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Session not found' }))
            return
          }
          linkClaudeSession(claudeSessionId, sessionId)
          session.claudeSessionId = claudeSessionId
          log(`Linked Claude session ${claudeSessionId.slice(0, 8)} to ${session.name}`)
          broadcastSessions()
          saveSessions()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, session }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }
  }

  // -------------------------------------------------------------------------
  // Objectives API (Boss System)
  // -------------------------------------------------------------------------

  // GET /objectives — list all active objectives
  if (req.method === 'GET' && req.url === '/objectives') {
    if (!objectiveManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Objective system not initialized (no Supabase)' }))
      return
    }
    objectiveManager.getObjectives().then(objectives => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, objectives }))
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(err) }))
    })
    return
  }

  // GET /objectives/:campaignId — objectives for a campaign
  const campaignMatch = req.url?.match(/^\/objectives\/([a-f0-9-]+)$/)
  if (req.method === 'GET' && campaignMatch) {
    if (!objectiveManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Objective system not initialized' }))
      return
    }
    const campaignId = campaignMatch[1]
    objectiveManager.getCampaignObjectives(campaignId).then(objectives => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, objectives }))
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(err) }))
    })
    return
  }

  // POST /objectives — create new objective
  if (req.method === 'POST' && req.url === '/objectives') {
    if (!objectiveManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Objective system not initialized' }))
      return
    }
    collectRequestBody(req).then(async body => {
      try {
        const data = JSON.parse(body)
        if (!data.name || !data.territory || !data.hp_total) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'name, territory, hp_total required' }))
          return
        }
        const objective = await objectiveManager!.createObjective(data)
        if (objective) {
          log(`[Objectives] Created boss: "${objective.name}" in ${objective.territory} (HP: ${objective.hp_total})`)
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, objective }))
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Failed to create objective' }))
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // POST /objectives/seed — create a sample campaign with 5 bosses for testing
  if (req.method === 'POST' && req.url === '/objectives/seed') {
    if (!objectiveManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Objective system not initialized' }))
      return
    }
    ;(async () => {
      try {
        const sampleBosses = [
          { name: 'Copy Generation', territory: 'fulfillment', hp_total: 15, priority: 5, description: 'Generate all copy assets for the bootcamp launch', sub_tasks: [
            { name: 'Email sequence (6 emails)', completed: false },
            { name: 'Landing page copy', completed: false },
            { name: 'Sales page long-form', completed: false },
            { name: 'Ad creatives (5 variants)', completed: false },
            { name: 'Social proof section', completed: false },
          ]},
          { name: 'Kit Email Wiring', territory: 'lead-gen', hp_total: 7, priority: 3, description: 'Wire all email sequences in Kit with proper tags and triggers' },
          { name: 'Landing Pages Live', territory: 'lead-gen', hp_total: 5, priority: 4, description: 'Deploy landing pages to Vercel with analytics' },
          { name: 'Checkout Flow', territory: 'sales', hp_total: 4, priority: 2, description: 'SamCart checkout with order bumps and upsells' },
          { name: 'Quality Gate', territory: 'hq', hp_total: 3, priority: 1, description: 'Final review: copy quality, link checks, mobile responsiveness' },
        ]

        const created: any[] = []
        const createdIds: Record<string, string> = {}

        // Create all bosses first
        for (const boss of sampleBosses) {
          const obj = await objectiveManager!.createObjective(boss)
          if (obj) {
            created.push(obj)
            createdIds[boss.name] = obj.id
            log(`[Objectives/Seed] Created boss: "${obj.name}" (HP: ${obj.hp_total})`)
          }
        }

        // Set dependencies: Kit Wiring and Landing Pages depend on Copy Generation
        // Checkout depends on Landing Pages, Quality Gate depends on Copy Generation
        const deps: Array<{ name: string; dependsOn: string }> = [
          { name: 'Kit Email Wiring', dependsOn: 'Copy Generation' },
          { name: 'Landing Pages Live', dependsOn: 'Copy Generation' },
          { name: 'Checkout Flow', dependsOn: 'Landing Pages Live' },
          { name: 'Quality Gate', dependsOn: 'Copy Generation' },
        ]

        for (const dep of deps) {
          const objId = createdIds[dep.name]
          const depId = createdIds[dep.dependsOn]
          if (objId && depId) {
            await objectiveManager!.updateStatus(objId, 'blocked')
          }
        }

        // Simulate partial progress: drain some HP on the first boss
        if (createdIds['Copy Generation']) {
          await objectiveManager!.updateHP(createdIds['Copy Generation'], -3)
        }

        log(`[Objectives/Seed] Sample campaign created: ${created.length} bosses`)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, created: created.length, objectives: created }))
      } catch (err) {
        log(`[Objectives/Seed] Error: ${err}`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    })()
    return
  }

  // POST /objectives/from-scratchpad — parse a markdown file for unchecked tasks → boss objectives
  if (req.method === 'POST' && req.url === '/objectives/from-scratchpad') {
    if (!objectiveManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Objective system not initialized' }))
      return
    }
    collectRequestBody(req).then(async body => {
      try {
        const { filePath, territory, campaign } = JSON.parse(body) as {
          filePath?: string
          territory?: string
          campaign?: string
        }

        // Default to the speakeasy-agent Scratchpad
        const targetPath = filePath || resolve(process.env.HOME || '~', 'speakeasy-agent/Scratchpad.md')
        let content: string
        try {
          content = readFileSync(targetPath, 'utf-8')
        } catch {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `File not found: ${targetPath}` }))
          return
        }

        // Parse unchecked tasks: lines matching "- [ ] **text**" or "- [ ] text"
        const lines = content.split('\n')
        const tasks: Array<{ name: string; section: string }> = []
        let currentSection = 'General'

        for (const line of lines) {
          // Track section headings
          const headingMatch = line.match(/^#{1,3}\s+(.+)/)
          if (headingMatch) currentSection = headingMatch[1].trim()

          // Match unchecked tasks
          const taskMatch = line.match(/^[-*]\s+\[ \]\s+\*\*(.+?)\*\*(.*)$/) ||
                           line.match(/^[-*]\s+\[ \]\s+(.+)$/)
          if (taskMatch) {
            const name = taskMatch[1].replace(/\*\*/g, '').trim()
            if (name.length > 3 && name !== 'STOP') {
              tasks.push({ name, section: currentSection })
            }
          }
        }

        if (tasks.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, created: 0, message: 'No unchecked tasks found' }))
          return
        }

        // Map sections to territories heuristically
        const sectionToTerritory = (section: string): string => {
          const s = section.toLowerCase()
          if (s.includes('lead') || s.includes('marketing') || s.includes('content')) return 'lead-gen'
          if (s.includes('sales') || s.includes('pipeline') || s.includes('checkout')) return 'sales'
          if (s.includes('fulfillment') || s.includes('deliver') || s.includes('bootcamp') || s.includes('product')) return 'fulfillment'
          if (s.includes('support') || s.includes('ticket')) return 'support'
          if (s.includes('retention') || s.includes('churn')) return 'retention'
          return territory || 'hq'
        }

        const created: unknown[] = []
        for (const task of tasks) {
          const obj = await objectiveManager!.createObjective({
            name: task.name,
            territory: sectionToTerritory(task.section),
            hp_total: Math.max(1, Math.ceil(task.name.length / 15)), // rough sizing: longer names = bigger tasks
            campaign_id: campaign || undefined,
            priority: 3,
            metadata: { source: 'scratchpad', section: task.section, filePath: targetPath },
          })
          if (obj) {
            created.push(obj)
            log(`[Objectives/Scratchpad] Created: "${obj.name}" in ${obj.territory} (HP: ${obj.hp_total})`)
          }
        }

        log(`[Objectives/Scratchpad] Parsed ${tasks.length} tasks, created ${created.length} objectives from ${targetPath}`)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, parsed: tasks.length, created: created.length, objectives: created }))
      } catch (err) {
        log(`[Objectives/Scratchpad] Error: ${err}`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    })
    return
  }

  // Objective-specific endpoints: /objectives/:id/(hp|status|assign)
  const objectiveActionMatch = req.url?.match(/^\/objectives\/([a-f0-9-]+)\/(hp|status|assign)$/)
  if (objectiveActionMatch && objectiveManager) {
    const objectiveId = objectiveActionMatch[1]
    const action = objectiveActionMatch[2]

    // PATCH /objectives/:id/hp — drain HP (sub-task completed)
    if (req.method === 'PATCH' && action === 'hp') {
      collectRequestBody(req).then(async body => {
        try {
          const { delta } = JSON.parse(body) as { delta: number }
          if (typeof delta !== 'number') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'delta (number) required' }))
            return
          }
          const updated = await objectiveManager!.updateHP(objectiveId, delta)
          if (updated) {
            log(`[Objectives] HP update on "${updated.name}": ${updated.hp_remaining}/${updated.hp_total}`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, objective: updated }))
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Objective not found' }))
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // PATCH /objectives/:id/status — update status
    if (req.method === 'PATCH' && action === 'status') {
      collectRequestBody(req).then(async body => {
        try {
          const { status } = JSON.parse(body) as { status: string }
          const validStatuses = ['unassaulted', 'blocked', 'under_attack', 'stalled', 'defeated', 'archived']
          if (!validStatuses.includes(status)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }))
            return
          }
          const updated = await objectiveManager!.updateStatus(objectiveId, status)
          if (updated) {
            log(`[Objectives] Status update on "${updated.name}": ${status}`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, objective: updated }))
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Objective not found' }))
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // POST /objectives/:id/assign — assign a session to an objective
    if (req.method === 'POST' && action === 'assign') {
      collectRequestBody(req).then(async body => {
        try {
          const { session_id } = JSON.parse(body) as { session_id: string }
          if (!session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'session_id required' }))
            return
          }
          const assignment = await objectiveManager!.assignAgent(objectiveId, session_id)
          if (assignment) {
            log(`[Objectives] Assigned session ${session_id.slice(0, 8)} to objective ${objectiveId.slice(0, 8)}`)

            // Transition session to 'combat' status when assigned to an objective
            const combatSession = managedSessions.get(session_id) || findManagedSession(session_id)
            if (combatSession && combatSession.status !== 'offline') {
              combatSession.status = 'combat'
              combatSession.lastActivity = Date.now()
              sessionWorkStart.set(combatSession.id, Date.now())
              broadcastSessions()
              saveSessions()
              log(`[Status] Session ${combatSession.name} → combat (assigned to objective)`)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, assignment }))
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Failed to assign agent' }))
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }
  }

  // -------------------------------------------------------------------------
  // Production Chain API (Factorio Mode)
  // -------------------------------------------------------------------------

  // GET /production/bottlenecks — all current bottlenecks across all territories
  if (req.method === 'GET' && req.url === '/production/bottlenecks') {
    if (!productionManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Production system not initialized (no Supabase)' }))
      return
    }
    const bottlenecks = productionManager.getBottlenecks()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, bottlenecks }))
    return
  }

  // GET /production/:territory — full production chain with current metrics
  const prodTerritoryMatch = req.url?.match(/^\/production\/(lead-gen|sales|fulfillment|support|retention)$/)
  if (req.method === 'GET' && prodTerritoryMatch) {
    if (!productionManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Production system not initialized (no Supabase)' }))
      return
    }
    const territory = prodTerritoryMatch[1] as any
    const chain = productionManager.getChainForTerritory(territory)
    if (!chain) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `No production chain for territory: ${territory}` }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ...chain }))
    return
  }

  // PATCH /production/:nodeId — manually update a node's metric value
  const prodNodeMatch = req.url?.match(/^\/production\/([a-z]{2}-[a-z]+)$/)
  if (req.method === 'PATCH' && prodNodeMatch) {
    if (!productionManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Production system not initialized (no Supabase)' }))
      return
    }
    const nodeId = prodNodeMatch[1]
    collectRequestBody(req).then(body => {
      try {
        const { value } = JSON.parse(body) as { value: number }
        if (typeof value !== 'number') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'value (number) is required' }))
          return
        }
        const updated = productionManager!.updateNodeMetric(nodeId, value)
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `Unknown node: ${nodeId}` }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, nodeId, value }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // -------------------------------------------------------------------------
  // Text Tiles API
  // -------------------------------------------------------------------------

  // ========================================================================
  // POST /webhooks/stripe — Stripe webhook receiver (PRD 05)
  // TODO: Add Stripe signature verification for production (stripe-webhook-secret)
  // ========================================================================
  if (req.method === 'POST' && req.url === '/webhooks/stripe') {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    collectRequestBody(req).then(body => {
      try {
        const event = JSON.parse(body)
        const eventType: string = event.type ?? 'unknown'
        const eventId: string = event.id ?? null
        const dataObject = event.data?.object ?? {}

        // Extract common fields from Stripe event
        const amountCents: number = dataObject.amount ?? dataObject.amount_paid ?? 0
        const currency: string = dataObject.currency ?? 'usd'
        const customerId: string = dataObject.customer ?? null
        const description: string = dataObject.description ?? dataObject.billing_reason ?? eventType

        log(`[Stripe] Received ${eventType} — $${(amountCents / 100).toFixed(2)} ${currency}`)

        // Fire-and-forget: persist to ae_transactions via Supabase REST
        if (supabaseUrl && supabaseKey) {
          fetch(`${supabaseUrl}/rest/v1/ae_transactions`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              stripe_event_id: eventId,
              type: eventType,
              amount_cents: amountCents,
              currency,
              customer_id: customerId,
              description,
              metadata: dataObject.metadata ?? null,
            }),
          }).then(r => {
            if (!r.ok) r.text().then(t => console.error(`[Stripe] Supabase insert failed (${r.status}): ${t}`))
          }).catch(err => console.error('[Stripe] Supabase insert error:', err))
        }

        // Broadcast to WebSocket clients based on event type
        if (eventType === 'charge.succeeded' || eventType === 'invoice.paid') {
          broadcast({
            type: 'resource_update',
            payload: {
              type: 'revenue',
              amount: amountCents / 100,
              description: `${eventType}: $${(amountCents / 100).toFixed(2)} ${currency}`,
            },
          } as ServerMessage)
        }

        if (eventType === 'customer.subscription.deleted') {
          broadcast({
            type: 'threat',
            payload: {
              id: eventId ?? randomUUID(),
              type: 'churn_risk',
              severity: 'elevated',
              territory: 'sales',
              title: 'Subscription Cancelled',
              description: `Customer ${customerId ?? 'unknown'} cancelled — $${(amountCents / 100).toFixed(2)}/mo lost`,
              sourceTable: 'ae_transactions',
              sourceId: eventId ?? '',
              timestamp: Date.now(),
            },
          } as ServerMessage)
        }

        // Always return 200 immediately (Stripe expects fast acknowledgement)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, received: eventType }))
      } catch (e) {
        console.error('[Stripe] Parse error:', e)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // ========================================================================
  // POST /webhooks/samcart — SamCart webhook receiver
  // ========================================================================
  if (req.method === 'POST' && req.url === '/webhooks/samcart') {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    collectRequestBody(req).then(body => {
      try {
        const event = JSON.parse(body)
        const eventType: string = event.type ?? 'unknown'
        const data = event.data ?? {}
        const orderId: string = data.id ?? null
        const customer = data.customer ?? {}
        const amountCents: number = data.charges?.total ?? 0
        const currency: string = data.currency ?? 'USD'
        const customerEmail: string = customer.email ?? null
        const customerName: string = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null
        const productName: string = data.product?.name ?? null
        const description: string = productName
          ? `${eventType}: ${productName} — $${(amountCents / 100).toFixed(2)} ${currency}`
          : `${eventType}: $${(amountCents / 100).toFixed(2)} ${currency}`

        log(`[SamCart] Received ${eventType} — $${(amountCents / 100).toFixed(2)} ${currency}`)

        // Fire-and-forget: persist to ae_transactions via Supabase REST
        if (supabaseUrl && supabaseKey) {
          fetch(`${supabaseUrl}/rest/v1/ae_transactions`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              stripe_event_id: orderId,
              type: `samcart.${eventType}`,
              amount_cents: amountCents,
              currency: currency.toLowerCase(),
              customer_id: customer.id ?? customerEmail,
              description,
              metadata: { customer_email: customerEmail, customer_name: customerName, product: productName },
            }),
          }).then(r => {
            if (!r.ok) r.text().then(t => console.error(`[SamCart] Supabase insert failed (${r.status}): ${t}`))
          }).catch(err => console.error('[SamCart] Supabase insert error:', err))
        }

        // Broadcast to WebSocket clients based on event type
        if (eventType === 'order.completed') {
          broadcast({
            type: 'resource_update',
            payload: {
              type: 'revenue',
              amount: amountCents / 100,
              description,
            },
          } as ServerMessage)
        }

        if (eventType === 'subscription.canceled' || eventType === 'order.refunded') {
          broadcast({
            type: 'threat',
            payload: {
              id: orderId ?? randomUUID(),
              type: 'churn_risk',
              severity: 'elevated',
              territory: 'sales',
              title: eventType === 'order.refunded' ? 'Order Refunded' : 'Subscription Cancelled',
              description: `${customerName ?? customerEmail ?? 'Unknown customer'} — ${description}`,
              sourceTable: 'ae_transactions',
              sourceId: orderId ?? '',
              timestamp: Date.now(),
            },
          } as ServerMessage)
        }

        // Always return 200 immediately (SamCart expects fast acknowledgement)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, received: eventType }))
      } catch (e) {
        console.error('[SamCart] Parse error:', e)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // GET /tiles - List all text tiles
  if (req.method === 'GET' && req.url === '/tiles') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, tiles: getTiles() }))
    return
  }

  // POST /tiles - Create a new text tile
  if (req.method === 'POST' && req.url === '/tiles') {
    collectRequestBody(req).then(body => {
      try {
        const data = JSON.parse(body) as CreateTextTileRequest

        if (!data.text || !data.position) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing text or position' }))
          return
        }

        const tile: TextTile = {
          id: crypto.randomUUID(),
          text: data.text,
          position: data.position,
          color: data.color,
          createdAt: Date.now(),
        }

        textTiles.set(tile.id, tile)
        saveTiles()
        broadcastTiles()

        log(`Created text tile: "${tile.text}" at (${tile.position.q}, ${tile.position.r})`)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, tile }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
      }
    }).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body too large' }))
    })
    return
  }

  // Handle /tiles/:id routes
  const tilesIdMatch = req.url?.match(/^\/tiles\/([^/?]+)/)
  if (tilesIdMatch) {
    const tileId = tilesIdMatch[1]
    const tile = textTiles.get(tileId)

    // PUT /tiles/:id - Update a text tile
    if (req.method === 'PUT') {
      if (!tile) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Tile not found' }))
        return
      }

      collectRequestBody(req).then(body => {
        try {
          const data = JSON.parse(body) as UpdateTextTileRequest

          if (data.text !== undefined) tile.text = data.text
          if (data.position !== undefined) tile.position = data.position
          if (data.color !== undefined) tile.color = data.color

          saveTiles()
          broadcastTiles()

          log(`Updated text tile: "${tile.text}"`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, tile }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        }
      }).catch(() => {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      })
      return
    }

    // DELETE /tiles/:id - Delete a text tile
    if (req.method === 'DELETE') {
      if (!tile) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Tile not found' }))
        return
      }

      textTiles.delete(tileId)
      saveTiles()
      broadcastTiles()

      log(`Deleted text tile: "${tile.text}"`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
  }

  // Static file serving for frontend (production mode)
  serveStaticFile(req, res)
}

/** MIME types for static files */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** Serve static files from dist/ directory */
function serveStaticFile(req: IncomingMessage, res: ServerResponse): void {
  // Determine the dist directory (relative to this file when compiled)
  // Compiled server is at: dist/server/server/index.js
  // So ../../ gets us to dist/
  const distDir = resolve(dirname(new URL(import.meta.url).pathname), '../..')

  // Parse the URL path
  let urlPath = req.url?.split('?')[0] ?? '/'
  if (urlPath === '/') urlPath = '/index.html'

  // Security: prevent directory traversal
  // 1. Decode URL-encoded characters to catch %2e%2e (encoded ..)
  // 2. Resolve to absolute path
  // 3. Verify result is within distDir
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(urlPath)
  } catch {
    // Invalid URL encoding
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  const filePath = resolve(distDir, '.' + decodedPath)

  // Check for path traversal: resolved path must start with distDir
  if (!filePath.startsWith(distDir + '/') && filePath !== distDir) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    // For SPA, serve index.html for non-API routes
    const indexPath = join(distDir, 'index.html')
    if (existsSync(indexPath) && !decodedPath.startsWith('/api')) {
      const content = readFileSync(indexPath)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(content)
      return
    }
    res.writeHead(404)
    res.end('Not found')
    return
  }

  // Serve the file
  const ext = extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  const content = readFileSync(filePath)
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(content)
}

// ============================================================================
// Main
// ============================================================================

function main() {
  log('Starting Agent Empires server...')

  // Load Deepgram API key for voice transcription
  deepgramApiKey = loadDeepgramKey()

  // Load existing events
  loadEventsFromFile()

  // Load saved sessions (for persistence across restarts)
  loadSessions()

  // Load saved text tiles
  loadTiles()

  // Start git status tracking
  gitStatusManager.setUpdateHandler(({ sessionId, status }) => {
    const session = managedSessions.get(sessionId)
    if (session) {
      debug(`Git status updated for ${session.name}: ${status.branch} +${status.linesAdded}/-${status.linesRemoved}`)
      // Broadcast updated sessions to all clients
      broadcastSessions()
    }
  })
  gitStatusManager.start()

  // Initialize Supabase persistence
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (supabaseUrl && supabaseKey) {
    persistence = new SupabasePersistence({ supabaseUrl, supabaseKey })
    persistence.loadKnownSessions().then(() => {
      log('[Persistence] Supabase persistence active')
    })
    // Initialize ObjectiveManager
    objectiveManager = new ObjectiveManager({ supabaseUrl, supabaseKey })
    objectiveManager.setBroadcast((type, payload) => {
      broadcast({ type, payload } as any)
    })
    objectiveManager.startPolling()
    log('[ObjectiveManager] Initialized and polling')

    // Initialize ProductionDataManager (Factorio Mode)
    productionManager = new ProductionDataManager({ supabaseUrl, supabaseKey })
    productionManager.setBroadcast((type, payload) => {
      broadcast({ type, payload } as any)
    })
    productionManager.startPolling()
    log('[ProductionDataManager] Initialized and polling')

    // Initialize HandoffListener (Realtime subscription for ae_handoffs → packets)
    handoffListener = new HandoffListener({ supabaseUrl, supabaseKey })
    handoffListener.setBroadcast((type, payload) => {
      broadcast({ type, payload } as any)
    })
    handoffListener.start()
    log('[HandoffListener] Initialized and listening for handoffs')

    // Queue depth polling — count pending handoffs per territory every 30s
    const pollQueueDepth = async () => {
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/ae_handoffs?select=to_territory&or=(status.is.null,status.eq.pending)`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        )
        if (!res.ok) return
        const rows = await res.json() as { to_territory: string }[]
        const queues: Record<string, number> = {}
        for (const row of rows) {
          queues[row.to_territory] = (queues[row.to_territory] ?? 0) + 1
        }
        broadcast({ type: 'queue_update', payload: { queues } } as any)
      } catch {
        // Silently skip — Supabase may not have ae_handoffs table yet
      }
    }
    pollQueueDepth()
    setInterval(pollQueueDepth, 30_000)
    log('[QueueDepth] Polling ae_handoffs every 30s')
  } else {
    log('[Persistence] Skipped — SUPABASE_URL or SUPABASE_KEY not set')
  }

  // Start threat data bridge (polls Supabase for business events)
  if (supabaseUrl && supabaseKey) {
    const threatBridge = new ThreatDataBridge({
      supabaseUrl,
      supabaseKey,
      onThreat: (event) => {
        log(`[ThreatDataBridge] New threat: ${event.title} (${event.severity})`)
        broadcast({ type: 'threat' as any, payload: event })
      },
      onThreatResolved: (id) => {
        log(`[ThreatDataBridge] Threat resolved: ${id}`)
        broadcast({ type: 'threat_resolved' as any, payload: { id } })
      },
    })
    threatBridge.start()

    // Start road aggregator (polls ae_events, writes ae_roads, broadcasts to clients)
    roadAggregator = new RoadAggregator({
      supabaseUrl,
      supabaseKey,
      onRoadsUpdated: (roads) => {
        broadcast({ type: 'roads', payload: roads } as any)
      },
    })
    roadAggregator.start()

    // Start waste detector (PRD 13, Section 6 — downstream consumer detection)
    wasteDetector = new WasteDetector({
      getRoads: () => latestRoads,
      getSessions,
      broadcast,
      intervalMs: 60_000,
    })
    wasteDetector.start()
  } else {
    log('[ThreatDataBridge] Skipped — SUPABASE_URL or SUPABASE_KEY not set')
  }

  // Watch for new events
  watchEventsFile()

  // Create HTTP server
  const httpServer = createServer(handleHttpRequest)

  // Create WebSocket server
  const wss = new WebSocketServer({ server: httpServer })

  // Initialize fleet signaling relay (PRD 07)
  fleetSignaling = new FleetSignaling(wss)

  wss.on('connection', (ws, req) => {
    // CSRF protection: validate Origin header
    const origin = req.headers.origin
    if (!isOriginAllowed(origin)) {
      log(`Rejected WebSocket connection from origin: ${origin}`)
      ws.close(1008, 'Origin not allowed')
      return
    }

    clients.add(ws)
    log(`Client connected (${clients.size} total)${origin ? ` from ${origin}` : ''}`)

    // Send connection confirmation
    const connectMsg: ServerMessage = {
      type: 'connected',
      payload: { sessionId: events[events.length - 1]?.sessionId ?? 'unknown' },
    }
    ws.send(JSON.stringify(connectMsg))

    // IMPORTANT: Send sessions BEFORE history so client can link events to sessions
    const sessionsMsg: ServerMessage = {
      type: 'sessions',
      payload: getSessions(),
    }
    ws.send(JSON.stringify(sessionsMsg))

    // Send text tiles
    const tilesMsg: ServerMessage = {
      type: 'text_tiles',
      payload: getTiles(),
    }
    ws.send(JSON.stringify(tilesMsg))

    // Send recent history - filtered to only include events from current managed sessions
    const activeClaudeSessionIds = new Set(
      Array.from(managedSessions.values())
        .map(s => s.claudeSessionId)
        .filter(Boolean)
    )
    const filteredHistory = events
      .filter(e => activeClaudeSessionIds.has(e.sessionId))
      .slice(-50)
    const historyMsg: ServerMessage = {
      type: 'history',
      payload: filteredHistory,
    }
    ws.send(JSON.stringify(historyMsg))

    ws.on('message', (data: RawData, isBinary: boolean) => {
      // Handle binary audio data for voice transcription
      if (isBinary) {
        const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        sendVoiceAudio(ws, audioBuffer)
        return
      }

      // Handle JSON messages
      try {
        const parsed = JSON.parse(data.toString())

        // Fleet signaling messages (PRD 07)
        if (parsed.type === 'fleet_register' && fleetSignaling) {
          const reg = parsed as FleetRegisterMessage
          fleetSignaling.registerPeer(ws, reg.machineId, reg.capabilities ?? [])
          return
        }
        if (typeof parsed.type === 'string' && parsed.type.startsWith('fleet_') && fleetSignaling) {
          const machineId = parsed.machineId || parsed.fromMachineId
          if (machineId) {
            fleetSignaling.handleMessage(ws, machineId, parsed as FleetMessage)
          }
          return
        }

        handleClientMessage(ws, parsed as ClientMessage)
      } catch (e) {
        debug(`Failed to parse client message: ${e}`)
      }
    })

    ws.on('close', () => {
      stopVoiceSession(ws) // Clean up any voice session
      if (fleetSignaling) fleetSignaling.handleDisconnect(ws) // Clean up fleet peer
      clients.delete(ws)
      log(`Client disconnected (${clients.size} total)`)
    })

    ws.on('error', (error) => {
      debug(`WebSocket error: ${error}`)
      stopVoiceSession(ws) // Clean up any voice session
      if (fleetSignaling) fleetSignaling.handleDisconnect(ws) // Clean up fleet peer
      clients.delete(ws)
    })
  })

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`\n  FATAL: Port ${PORT} is already in use.`)
      log(`  Fix: pkill -f "agent-empires" or lsof -ti :${PORT} | xargs kill\n`)
      process.exit(1)
    }
    throw err
  })

  httpServer.listen(PORT, DEFAULTS.HOST, () => {
    const base = `http://${DEFAULTS.HOST}:${PORT}`
    log(`Server running on ${base}`)
    log(``)
    log(`Endpoints:`)
    log(`  WebSocket: ws://${DEFAULTS.HOST}:${PORT}`)
    log(`  Sessions: ${base}/sessions`)
    log(`  Health:   ${base}/health`)
    log(``)

    // Self-test: verify we can actually reach ourselves
    fetch(`${base}/health`).then(r => {
      if (r.ok) log(`[Startup] Self-test PASSED — server reachable on ${DEFAULTS.HOST}:${PORT}`)
      else log(`[Startup] Self-test FAILED — got ${r.status} from health endpoint`)
    }).catch(err => {
      log(`[Startup] Self-test FAILED — cannot reach ${base}/health: ${err.message}`)
      log(`[Startup] Check if another process is on port ${PORT}: lsof -i :${PORT}`)
    })

    // Start token polling after server is ready
    startTokenPolling()

    // Start permission prompt polling
    startPermissionPolling()

    // Start session health checking (every 5 seconds)
    setInterval(checkSessionHealth, 5000)

    // Start working timeout checking (every 10 seconds)
    setInterval(checkWorkingTimeout, WORKING_CHECK_INTERVAL_MS)

    // Run initial health check to update session statuses
    checkSessionHealth()

    // Start monitor orchestrator (PRD 04 — autonomous monitoring)
    monitorOrchestrator = new MonitorOrchestrator({
      getSessions,
      broadcast,
      pollIntervalMs: 30_000,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
    })
    monitorOrchestrator.start()
  })
}

main()
