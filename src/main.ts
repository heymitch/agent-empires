/**
 * Agent Empires - Main Entry Point
 *
 * RTS command center for AI business agents.
 * Replaces Three.js with PixiJS, keeps existing WebSocket/event infrastructure.
 */

import './styles/index.css'

import { BattlefieldRenderer } from './renderer/BattlefieldRenderer'
import { ConnectionLineRenderer } from './renderer/ConnectionLineRenderer'
import type { UnitRenderer, UnitStatus, UnitClass } from './renderer/UnitRenderer'
import type { TerritoryId } from './renderer/TerrainRenderer'
import { EventClient } from './events/EventClient'
import { eventBus, type EventContext } from './events/EventBus'
import { ResourceBar } from './hud/ResourceBar'
import { IntelPanel } from './hud/IntelPanel'
import { CommandBar } from './hud/CommandBar'
import { UnitDetail } from './hud/UnitDetail'
import { FloatingUnitPanel } from './hud/FloatingUnitPanel'
import { FeedManager, formatTokens, formatTimeAgo, escapeHtml } from './ui/FeedManager'
import { toast } from './ui/Toast'
import { soundManager } from './audio/SoundManager'
import {
  setupQuestionModal,
  showQuestionModal,
  hideQuestionModal,
  type QuestionData,
  type QuestionModalContext,
} from './ui/QuestionModal'
import {
  setupPermissionModal,
  showPermissionModal,
  hidePermissionModal,
  type PermissionModalContext,
} from './ui/PermissionModal'
import { createSessionAPI, type SessionAPI } from './api'
import { GameState } from './game/GameState'
import { CombatAnimator } from './game/CombatAnimator'
import { MovementManager } from './game/MovementManager'
import { handleBattlefieldEvent, type BattlefieldHandlerDeps } from './events/handlers/battlefieldHandlers'
import type {
  ClaudeEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  ManagedSession,
  SessionStatus,
} from '../shared/types'
import { TerritoryStateManager } from './game/TerritoryStateManager'
import { ThreatRenderer, type ThreatEvent as ClientThreatEvent, type TerritoryBoundsGetter } from './renderer/ThreatRenderer'
import { ScreenEffects } from './renderer/ScreenEffects'
import { KeyboardManager } from './input/KeyboardManager'
import { ControlGroupManager } from './input/ControlGroupManager'
import { CommandRouter } from './input/CommandRouter'
import { RoadRenderer } from './renderer/RoadRenderer'
import { PacketManager, type PacketConfig } from './renderer/PacketSprite'
import { ObjectiveRenderer, type ObjectiveData } from './renderer/ObjectiveRenderer'
import { ProductionChainRenderer, type ProductionChainData } from './renderer/ProductionChainRenderer'
import { AbilityBar } from './hud/AbilityBar'
import { CooldownManager } from './game/CooldownManager'
import { HOTKEY_ORDER } from './game/SkillRegistry'

// ============================================================================
// Configuration
// ============================================================================

declare const __VIBECRAFT_DEFAULT_PORT__: number

function getAgentPort(): number {
  const params = new URLSearchParams(window.location.search)
  const urlPort = params.get('port')
  if (urlPort) return parseInt(urlPort, 10)

  const storedPort = localStorage.getItem('agent-empires-port')
  if (storedPort) return parseInt(storedPort, 10)

  return __VIBECRAFT_DEFAULT_PORT__
}

const AGENT_PORT = getAgentPort()

// In dev: proxy through Vite (same origin). In prod: direct to server.
// Always use window.location.hostname to match whatever the browser connected to.
const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.host}/ws`
  : `ws://${window.location.hostname}:${AGENT_PORT}`

const API_URL = import.meta.env.DEV
  ? '/api'
  : `http://${window.location.hostname}:${AGENT_PORT}`

const sessionAPI = createSessionAPI(API_URL)

// ============================================================================
// State
// ============================================================================

let battlefield: BattlefieldRenderer
let resourceBar: ResourceBar
let intelPanel: IntelPanel
let commandBar: CommandBar
let unitDetail: UnitDetail
let floatingPanel: FloatingUnitPanel
let feedManager: FeedManager
let eventClient: EventClient

// Game systems (Phase B+C)
let gameState: GameState
let combatAnimator: CombatAnimator
let movementManager: MovementManager
let battlefieldDeps: BattlefieldHandlerDeps
let territoryStateManager: TerritoryStateManager
let threatRenderer: ThreatRenderer
let screenEffects: ScreenEffects
let connectionLineRenderer: ConnectionLineRenderer
let roadRenderer: RoadRenderer
let packetManager: PacketManager
let objectiveRenderer: ObjectiveRenderer
let keyboardManager: KeyboardManager
let controlGroupManager: ControlGroupManager
let abilityBar: AbilityBar
let cooldownManager: CooldownManager
let productionChainRenderer: ProductionChainRenderer

// Production chain data cache — updated via WebSocket, keyed by territory
const productionChainCache: Map<string, ProductionChainData> = new Map()

// Territory cycling state
const TERRITORY_ORDER: TerritoryId[] = ['hq', 'lead-gen', 'content', 'sales', 'fulfillment', 'support', 'retention']
let territoryIndex = 0

// Session tracking
const sessions: Map<string, ManagedSession> = new Map()
let selectedUnitId: string | null = null
let focusedSessionId: string | null = null
let isConnected = false

// Map tool names to territories for unit placement
function toolToTerritory(tool: string): TerritoryId {
  const map: Record<string, TerritoryId> = {
    'Read': 'content',
    'Write': 'content',
    'Edit': 'content',
    'Bash': 'fulfillment',
    'Grep': 'fulfillment',
    'Glob': 'fulfillment',
    'WebFetch': 'lead-gen',
    'WebSearch': 'lead-gen',
    'Task': 'sales',
    'TodoWrite': 'support',
  }
  return map[tool] || 'hq'
}

function sessionStatusToUnitStatus(status: SessionStatus): UnitStatus {
  switch (status) {
    case 'idle': return 'idle'
    case 'working': return 'working'
    case 'waiting': return 'thinking'
    case 'combat': return 'combat'
    case 'exhausted': return 'exhausted'
    case 'offline': return 'offline'
    default: return 'idle'
  }
}

function getSessionName(session: ManagedSession): string {
  return session.name || session.cwd?.split("/").pop() || session.id.slice(0, 8)
}
// ============================================================================
// Initialization
// ============================================================================

async function init() {
  // 1. Initialize PixiJS renderer
  const canvasContainer = document.getElementById('canvas-container')!
  battlefield = new BattlefieldRenderer(canvasContainer)
  await battlefield.init()

  // 2. Initialize game systems
  gameState = new GameState()
  combatAnimator = new CombatAnimator(battlefield)
  movementManager = new MovementManager(gameState, battlefield)

  // Phase 1 systems
  territoryStateManager = new TerritoryStateManager()
  screenEffects = new ScreenEffects()

  // ThreatRenderer: uses battlefield's threat layer + terrain center lookup
  const getTerritoryCenter: TerritoryBoundsGetter = (territory: string) => {
    return battlefield.terrainRenderer.getTerritoryCenter(territory as TerritoryId)
  }
  threatRenderer = new ThreatRenderer(battlefield.threatLayer, getTerritoryCenter)
  connectionLineRenderer = new ConnectionLineRenderer(battlefield.connectionLayer)
  roadRenderer = new RoadRenderer(
    battlefield.roadLayer,
    (territory) => battlefield.terrainRenderer.getTerritoryCenter(territory as TerritoryId)
  )

  // PacketManager: animated data packets traveling along roads (drawn above road dots)
  packetManager = new PacketManager(
    battlefield.roadLayer,
    (territory) => battlefield.terrainRenderer.getTerritoryCenter(territory as TerritoryId)
  )

  // ObjectiveRenderer: boss buildings on the battlefield
  objectiveRenderer = new ObjectiveRenderer(
    battlefield.roadLayer,  // share road layer (drawn below units, above terrain)
    (territory) => battlefield.terrainRenderer.getTerritoryCenter(territory as TerritoryId)
  )

  // ProductionChainRenderer: Factorio-style territory production view
  productionChainRenderer = new ProductionChainRenderer(
    battlefield.productionLayer,
    (territory) => battlefield.terrainRenderer.getTerritoryCenter(territory as TerritoryId)
  )

  // Wire territory state changes to terrain renderer
  territoryStateManager.onChange((territory, state) => {
    battlefield.terrainRenderer.updateTerritoryState(territory, {
      fogState: state.fogState,
      threatLevel: state.threatLevel,
      unitCount: state.unitCount,
      activityCount: state.activityCount,
    })
  })

  // Init screen effects overlay (CRT scanlines + vignette)
  const canvasContainer2 = document.getElementById('canvas-container')
  if (canvasContainer2) screenEffects.init(canvasContainer2)

  // 3. Hook movement/combat updates into the PixiJS animation loop
  battlefield.app.ticker.add(() => {
    const dt = battlefield.app.ticker.deltaMS / 1000
    movementManager.update(dt)
    combatAnimator.update(dt)

    // Update connection lines between parent/child units
    connectionLineRenderer.update(battlefield.getAllUnits(), dt)

    // Update road animations (marching dots)
    roadRenderer.update(dt)

    // Update packet animations (data flow along roads)
    packetManager.update(dt)

    // Update objective animations (pulses, defeat particles)
    objectiveRenderer.update(dt)

    // Update production chain particle animations
    productionChainRenderer.update(dt)

    // Update threat pulses + enemy AI movement
    const unitPositions = Array.from(gameState.getAllUnits()).map((u) => ({
      id: u.sessionId,
      x: u.position.x,
      y: u.position.y,
    }))
    threatRenderer.update(dt * 1000, unitPositions) // ThreatRenderer expects ms

    // Tick territory state manager every ~1s (using frame accumulator)
    if (Math.floor(battlefield.app.ticker.lastTime / 1000) !== Math.floor((battlefield.app.ticker.lastTime - battlefield.app.ticker.deltaMS) / 1000)) {
      territoryStateManager.tick()
    }

    // Keep floating panel anchored to unit as camera moves
    if (floatingPanel?.isVisible()) {
      const uid = floatingPanel.getUnitId()
      if (uid) {
        const pos = battlefield.getUnitScreenPosition(uid)
        if (pos) floatingPanel.updatePosition(pos.x, pos.y)
      }
    }
  })

  // 4. Initialize HUD
  resourceBar = new ResourceBar()
  intelPanel = new IntelPanel()
  commandBar = new CommandBar()
  unitDetail = new UnitDetail()
  floatingPanel = new FloatingUnitPanel()
  feedManager = new FeedManager()

  // 4b. Initialize Ability Bar system
  cooldownManager = new CooldownManager()
  abilityBar = new AbilityBar(cooldownManager)
  abilityBar.setCastHandler(async (sessionId: string, slashCommand: string) => {
    const response = await fetch(`${API_URL}/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: slashCommand, send: true }),
    })
    if (response.ok) {
      soundManager.play('command_sent')
      commandBar.setTicker(`Ability cast: "${slashCommand.slice(0, 50)}"`)
    } else {
      toast.error('Failed to cast ability')
      throw new Error('Cast failed')
    }
  })

  // Hide intel panel by default — floating panel replaces it
  const intelPanelEl = document.getElementById('intel-panel')
  if (intelPanelEl) intelPanelEl.style.display = 'none'

  // 5. Setup battlefield handler dependencies
  battlefieldDeps = {
    gameState,
    combatAnimator,
    movementManager,
    battlefield,
    findUnitBySessionId,
    findSessionByClaudeId,
  }

  // 6. Setup command submission with routing
  const commandRouter = new CommandRouter()

  commandBar.setSubmitHandler(async (rawInput, selectedId) => {
    const route = commandRouter.route(rawInput, sessions, selectedId || focusedSessionId || null)

    switch (route.type) {
      case 'deploy': {
        const opts = route.deployOptions || {}
        try {
          const response = await fetch(`${API_URL}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: opts.name, cwd: opts.cwd }),
          })
          if (response.ok) {
            soundManager.play('unit_deployed')
            const name = opts.name || 'new unit'
            commandBar.setTicker(`Deploying ${name} to ${opts.territory || 'hq'}`)
          } else {
            toast.error('Failed to deploy unit')
          }
        } catch {
          toast.error('Network error deploying unit')
        }
        break
      }

      case 'kill': {
        if (!route.sessionId) {
          toast.warning(`Unit "${route.sessionName}" not found`)
          return
        }
        try {
          const response = await fetch(`${API_URL}/sessions/${route.sessionId}/cancel`, {
            method: 'POST',
          })
          if (response.ok) {
            soundManager.play('unit_offline')
            commandBar.setTicker(`Terminated: ${route.sessionName}`)
          }
        } catch {
          toast.error('Network error')
        }
        break
      }

      case 'cancel': {
        if (!route.sessionId) {
          toast.warning(`Unit "${route.sessionName}" not found`)
          return
        }
        try {
          await fetch(`${API_URL}/sessions/${route.sessionId}/cancel`, { method: 'POST' })
          commandBar.setTicker(`Stopped: ${route.sessionName}`)
        } catch {
          toast.error('Network error')
        }
        break
      }

      case 'restart': {
        if (!route.sessionId) {
          toast.warning(`Unit "${route.sessionName}" not found`)
          return
        }
        try {
          const response = await fetch(`${API_URL}/sessions/${route.sessionId}/restart`, {
            method: 'POST',
          })
          if (response.ok) {
            commandBar.setTicker(`Restarting: ${route.sessionName}`)
          } else {
            toast.error('Failed to restart unit')
          }
        } catch {
          toast.error('Network error')
        }
        break
      }

      case 'broadcast': {
        if (!route.prompt) return
        let sent = 0
        for (const [id, session] of sessions) {
          if (session.status === 'idle' || session.status === 'waiting') {
            try {
              await fetch(`${API_URL}/sessions/${id}/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: route.prompt }),
              })
              sent++
            } catch { /* skip failed */ }
          }
        }
        soundManager.play('command_sent')
        commandBar.setTicker(`Broadcast to ${sent} units: "${route.prompt.slice(0, 40)}..."`)
        break
      }

      case 'create_boss': {
        const opts = route.objectiveOptions || {}
        if (!opts.name) {
          toast.warning('Boss needs a name: create boss "Name" hp:5 territory:fulfillment')
          return
        }
        try {
          const response = await fetch(`${API_URL}/objectives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: opts.name,
              territory: opts.territory || 'hq',
              hp_total: opts.hp || 1,
              campaign_id: opts.campaign || undefined,
            }),
          })
          if (response.ok) {
            soundManager.play('unit_deployed')
            commandBar.setTicker(`Boss created: "${opts.name}" (HP: ${opts.hp || 1})`)
          } else {
            toast.error('Failed to create boss')
          }
        } catch {
          toast.error('Network error creating boss')
        }
        break
      }

      case 'assault': {
        const bossName = route.objectiveOptions?.objectiveName
        if (!bossName) {
          toast.warning('Specify boss to assault: assault "Boss Name"')
          return
        }
        const targetSessionId = selectedUnitId || focusedSessionId
        if (!targetSessionId) {
          toast.warning('Select a unit first, then assault a boss')
          return
        }
        try {
          const listRes = await fetch(`${API_URL}/objectives`)
          if (!listRes.ok) { toast.error('Failed to fetch objectives'); return }
          const { objectives } = await listRes.json() as { objectives: { id: string; name: string }[] }
          const target = objectives.find((o: { name: string }) => o.name.toLowerCase().includes(bossName.toLowerCase()))
          if (!target) {
            toast.warning(`No boss found matching "${bossName}"`)
            return
          }
          const assignRes = await fetch(`${API_URL}/objectives/${target.id}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: targetSessionId }),
          })
          if (assignRes.ok) {
            soundManager.play('command_sent')
            commandBar.setTicker(`Assaulting: "${target.name}" with ${sessions.get(targetSessionId)?.name || targetSessionId.slice(0, 8)}`)
          } else {
            toast.error('Failed to assign agent to boss')
          }
        } catch {
          toast.error('Network error assaulting boss')
        }
        break
      }

      case 'complete_boss': {
        const bossName = route.objectiveOptions?.objectiveName
        const delta = route.objectiveOptions?.delta ?? -1
        if (!bossName) {
          toast.warning('Specify boss: complete "Boss Name"')
          return
        }
        try {
          const listRes = await fetch(`${API_URL}/objectives`)
          if (!listRes.ok) { toast.error('Failed to fetch objectives'); return }
          const { objectives } = await listRes.json() as { objectives: { id: string; name: string }[] }
          const target = objectives.find((o: { name: string }) => o.name.toLowerCase().includes(bossName.toLowerCase()))
          if (!target) {
            toast.warning(`No boss found matching "${bossName}"`)
            return
          }
          const hpRes = await fetch(`${API_URL}/objectives/${target.id}/hp`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta }),
          })
          if (hpRes.ok) {
            const { objective } = await hpRes.json() as { objective: { hp_remaining: number; hp_total: number; status: string } }
            soundManager.play('command_sent')
            if (objective.status === 'defeated') {
              commandBar.setTicker(`BOSS DEFEATED: "${target.name}"!`)
            } else {
              commandBar.setTicker(`"${target.name}" HP: ${objective.hp_remaining}/${objective.hp_total}`)
            }
          } else {
            toast.error('Failed to drain boss HP')
          }
        } catch {
          toast.error('Network error completing boss task')
        }
        break
      }

      case 'prompt': {
        const targetId = route.sessionId || focusedSessionId || sessions.keys().next().value
        if (!targetId) {
          toast.warning('No active unit to send command to')
          return
        }
        try {
          const response = await fetch(`${API_URL}/sessions/${targetId}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: route.prompt }),
          })
          if (!response.ok) {
            toast.error('Failed to send command')
          } else {
            soundManager.play('command_sent')
            const label = route.sessionName || sessions.get(targetId)?.name || targetId.slice(0, 8)
            commandBar.setTicker(`→ ${label}: "${(route.prompt || '').slice(0, 50)}"`)
          }
        } catch {
          toast.error('Network error sending command')
        }
        break
      }
    }
  })

  // Unit click -> floating panel
  battlefield.onUnitClick = (unitId, screenX, screenY) => {
    const unit = battlefield.getUnit(unitId)
    const session = sessions.get(unitId)
    if (unit) {
      floatingPanel.toggle(unitId, unit, session, screenX, screenY)
      selectUnit(floatingPanel.isVisible() ? unitId : null)
    }
  }

  // Floating panel prompt handler
  floatingPanel.setSendPromptHandler(async (sessionId, prompt) => {
    try {
      const response = await fetch(`${API_URL}/sessions/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, send: true }),
      })
      if (response.ok) {
        commandBar.setTicker(`Order sent: "${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"`)
      } else {
        toast.error('Failed to send order')
      }
    } catch (e) {
      toast.error('Network error sending order')
    }
  })

  // Floating panel cancel handler
  floatingPanel.setCancelHandler(async (sessionId) => {
    try {
      const response = await fetch(`${API_URL}/sessions/${sessionId}/cancel`, {
        method: 'POST',
      })
      if (response.ok) {
        toast.info('Cancel signal sent')
      } else {
        toast.error('Failed to cancel')
      }
    } catch (e) {
      toast.error('Network error')
    }
  })

  // UnitDetail order handler -> focus command bar (legacy, keeping for keyboard flow)
  unitDetail.setOrderHandler((unitId) => {
    commandBar.selectSession(unitId)
    commandBar.focus()
  })

  // UnitDetail cancel handler -> POST cancel
  unitDetail.setCancelHandler(async (unitId) => {
    try {
      const response = await fetch(`${API_URL}/sessions/${unitId}/cancel`, {
        method: 'POST',
      })
      if (response.ok) {
        toast.info('Cancel signal sent')
      } else {
        toast.error('Failed to cancel')
      }
    } catch (e) {
      toast.error('Network error')
    }
  })

  // 6b. Territory click -> production chain view
  setupTerritoryClick()

  // 7. Setup question & permission modals
  setupModals()

  // 8. Connect WebSocket
  setupEventClient()

  // 9. Keyboard shortcuts
  setupKeyboard()

  // 10. Not-connected overlay handlers
  setupOverlay()

  console.log('[Agent Empires] Initialized')
}

// ============================================================================
// Event Client (WebSocket)
// ============================================================================

function setupEventClient() {
  eventClient = new EventClient({
    url: WS_URL,
    debug: false,
  })

  // Connection state
  eventClient.onConnection((connected) => {
    isConnected = connected
    resourceBar.setConnected(connected)

    const overlay = document.getElementById('not-connected-overlay')
    if (connected) {
      overlay?.classList.remove('visible')
    } else {
      // Show overlay after initial failed connection
      setTimeout(() => {
        if (!isConnected) {
          overlay?.classList.add('visible')
        }
      }, 3000)
    }
  })

  // Session list
  eventClient.onSessions((sessionList) => {
    handleSessionList(sessionList)
  })

  // Session updates
  eventClient.onSessionUpdate((session) => {
    handleSessionUpdate(session)
  })

  // Events
  eventClient.onEvent((event) => {
    handleEvent(event)
  })

  // History
  eventClient.onHistory((events) => {
    for (const event of events) {
      handleEvent(event, true)
    }
  })

  // Token updates
  eventClient.onTokens((data) => {
    // Update context gauge
    // Rough estimate: 200k context window
    const percent = (data.current / 200000) * 100
    resourceBar.setContext(percent)

    // Update unit health based on context usage
    const unit = findUnitBySessionId(data.session)
    if (unit) {
      unit.setHealth(1 - percent / 100)
    }
  })

  // Permission prompts
  eventClient.onRawMessage((msg) => {
    if (msg.type === 'permission_prompt') {
      const data = msg.payload as any
      showPermissionModal(data.sessionId, data.tool, data.context, data.options)
    } else if (msg.type === 'permission_resolved') {
      hidePermissionModal()
    } else if (msg.type === 'threat') {
      const threatEvent = msg.payload as ClientThreatEvent
      threatRenderer.addThreat(threatEvent)
      territoryStateManager.addThreat(threatEvent.territory as TerritoryId, threatEvent.severity)
      if (threatEvent.severity === 'critical') {
        soundManager.play('threat_critical')
        screenEffects.triggerGlitch()
      } else {
        soundManager.play('threat_spawn')
      }
    } else if (msg.type === 'threat_resolved') {
      const { id } = msg.payload as { id: string }
      threatRenderer.removeThreat(id)
    } else if ((msg as any).type === 'roads') {
      roadRenderer.updateRoads((msg as any).payload)
      packetManager.updateRoads((msg as any).payload)
    } else if ((msg as any).type === 'packet') {
      const pktConfig = (msg as any).payload as PacketConfig
      packetManager.spawnPacket(pktConfig)
    } else if ((msg as any).type === 'queue_update') {
      const queues = (msg as any).payload.queues as Record<string, number>
      for (const [territory, count] of Object.entries(queues)) {
        roadRenderer.setQueueCount(territory, count)
      }
    } else if ((msg as any).type === 'objectives') {
      objectiveRenderer.updateObjectives((msg as any).payload as ObjectiveData[])
    } else if ((msg as any).type === 'production') {
      const data = (msg as any).payload as ProductionChainData
      productionChainCache.set(data.territory, data)
      // If this territory's production view is currently showing, update it live
      if (productionChainRenderer.getActiveTerritory() === data.territory) {
        productionChainRenderer.updateData(data)
      }
    }
  })

  eventClient.connect()
}

// ============================================================================
// Session Management
// ============================================================================

function handleSessionList(sessionList: ManagedSession[]) {
  // Update sessions map
  const currentIds = new Set(sessions.keys())
  const newIds = new Set(sessionList.map(s => s.id))

  // Remove old sessions — trigger shrink animation, then clean up
  for (const id of currentIds) {
    if (!newIds.has(id)) {
      const unit = battlefield.getUnit(id)
      if (unit && !unit.isRetiring && !unit.isCollapsing) {
        unit.retire()
        // Remove after animation completes
        setTimeout(() => {
          battlefield.removeUnit(id)
          gameState.removeUnit(id)
        }, 600)
      } else if (!unit) {
        gameState.removeUnit(id)
      }
      sessions.delete(id)
    }
  }

  // Add/update sessions
  for (const session of sessionList) {
    sessions.set(session.id, session)
    ensureUnit(session)
  }

  // Update HUD
  resourceBar.updateUnitCount(sessionList.filter(s => s.status !== 'offline').length)
  commandBar.updateSessions(sessionList)
  updateSessionsList()
}

function handleSessionUpdate(session: ManagedSession) {
  const prev = sessions.get(session.id)
  if (session.status === 'offline' && prev?.status !== 'offline') {
    soundManager.play('unit_offline')
  }
  sessions.set(session.id, session)
  ensureUnit(session)
  updateSessionsList()
  const activeCount = Array.from(sessions.values()).filter(s => s.status !== 'offline').length
  resourceBar.updateUnitCount(activeCount)
  commandBar.updateSessions(Array.from(sessions.values()))
  // Keep unit detail + floating panel + ability bar current if showing this session
  unitDetail.updateSession(session)
  floatingPanel.updateSession(session)
  abilityBar.updateSession(session)
  if (floatingPanel.isVisible() && floatingPanel.getUnitId() === session.id) {
    const unit = battlefield.getUnit(session.id)
    if (unit) floatingPanel.updateContent(unit, session)
  }
}

/** Golden angle formation: distribute sub-agents in a spiral around parent */
function getSubAgentPosition(parentX: number, parentY: number, childIndex: number): { x: number; y: number } {
  const angle = childIndex * 2.399963 // golden angle in radians
  const radius = Math.min(200, 80 + childIndex * 15)
  return {
    x: parentX + Math.cos(angle) * radius,
    y: parentY + Math.sin(angle) * radius,
  }
}

function ensureUnit(session: ManagedSession) {
  let unit = battlefield.getUnit(session.id)

  if (!unit) {
    // Create new unit in renderer
    const name = session.name || session.cwd?.split('/').pop() || session.id.slice(0, 8)
    const territory = ((session as any).territory || 'hq') as TerritoryId
    unit = battlefield.addUnit(session.id, name, territory)

    // Register in game state
    const gameUnit = gameState.addUnit(session)
    gameUnit.position.x = unit.worldX
    gameUnit.position.y = unit.worldY

    // Particle burst for new unit
    battlefield.particleSystem.burst(unit.worldX, unit.worldY, 0x00ffcc, 15)
    soundManager.play('unit_deployed')

    // Set unit class from session data
    const unitClass = (session as any).unitClass as UnitClass | undefined
    if (unitClass && unit.setUnitClass) {
      unit.setUnitClass(unitClass)
    }
  }

  // Update unit state
  const status = sessionStatusToUnitStatus(session.status)
  unit.setStatus(status)
  unit.setName(session.name || session.cwd?.split('/').pop() || session.id.slice(0, 8))

  // Keep unit class in sync
  const cls = (session as any).unitClass as UnitClass | undefined
  if (cls && unit.unitClass !== cls) {
    unit.setUnitClass(cls)
  }

  // Set parent session ID for connection lines
  unit.parentSessionId = session.parentSessionId

  // Golden angle formation: position sub-agents around their parent
  if (session.parentSessionId) {
    const parentUnit = battlefield.getUnit(session.parentSessionId)
    if (parentUnit) {
      // Count siblings to determine this child's index
      let childIndex = 0
      for (const [, s] of sessions) {
        if (s.parentSessionId === session.parentSessionId && s.id !== session.id) {
          childIndex++
        }
      }
      const pos = getSubAgentPosition(parentUnit.worldX, parentUnit.worldY, childIndex)
      unit.setPosition(pos.x, pos.y)
    }
  }

  if (session.currentTool) {
    unit.setCurrentTool(session.currentTool)
  }

  // Update context health
  if (session.tokens) {
    const health = 1 - (session.tokens.current / 200000)
    unit.setHealth(Math.max(0, Math.min(1, health)))
    gameState.updateUnitHealth(session.id, health * 100)

    // Context exhaustion: trigger collapse when health hits 0
    if (health <= 0 && !unit.isCollapsing && !unit.isRetiring) {
      unit.collapse()
      battlefield.particleSystem.burst(unit.worldX, unit.worldY, 0xE8682A, 18)
      // Remove after collapse animation completes
      setTimeout(() => {
        battlefield.removeUnit(session.id)
        gameState.removeUnit(session.id)
      }, 1600)
    }
  }
}

function findUnitBySessionId(claudeSessionId: string): UnitRenderer | undefined {
  // Sessions may have a claudeSessionId that differs from our internal id
  for (const [id, session] of sessions) {
    if (session.claudeSessionId === claudeSessionId || id === claudeSessionId) {
      return battlefield.getUnit(id)
    }
  }
  return undefined
}

function findSessionByClaudeId(claudeSessionId: string): ManagedSession | undefined {
  for (const session of sessions.values()) {
    if (session.claudeSessionId === claudeSessionId || session.id === claudeSessionId) {
      return session
    }
  }
  return undefined
}

function updateSessionsList() {
  const managedEl = document.getElementById('managed-sessions')
  const countEl = document.getElementById('all-sessions-count')
  if (!managedEl) return

  const sessionList = Array.from(sessions.values())

  // Sort: working first, idle, then offline
  sessionList.sort((a, b) => {
    const order: Record<string, number> = { working: 0, waiting: 1, idle: 2, offline: 3 }
    return (order[a.status] ?? 2) - (order[b.status] ?? 2)
  })

  if (countEl) {
    const active = sessionList.filter(s => s.status !== 'offline').length
    countEl.textContent = active > 0 ? `${active} active unit${active !== 1 ? 's' : ''}` : 'No active units'
  }

  managedEl.innerHTML = ''
  sessionList.forEach((session, index) => {
    const name = getSessionName(session)

    // Token gauge
    let tokenGauge = ''
    if (session.tokens) {
      const pct = Math.round((session.tokens.current / 200000) * 100)
      const barClass = pct > 80 ? 'gauge-critical' : pct > 60 ? 'gauge-warning' : 'gauge-ok'
      tokenGauge = `<div class="session-gauge ${barClass}" style="width: ${pct}%"></div>`
    }

    const item = document.createElement('div')
    item.className = `session-item ${session.id === focusedSessionId ? 'active' : ''}`
    item.dataset.session = session.id
    item.innerHTML = `
      <div class="session-hotkey">${index + 1}</div>
      <div class="session-status-dot status-${session.status}"></div>
      <div class="session-info">
        <div class="session-name">${escapeHtml(name)}</div>
        <div class="session-detail">${session.currentTool ? `[${session.currentTool}]` : session.status}</div>
        <div class="session-gauge-track">${tokenGauge}</div>
      </div>
    `
    item.addEventListener('click', () => {
      focusSession(session.id)
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showSessionContextMenu(e, session)
    })
    managedEl.appendChild(item)
  })
}

function showSessionContextMenu(e: MouseEvent, session: ManagedSession) {
  document.getElementById('session-ctx-menu')?.remove()
  const menu = document.createElement('div')
  menu.id = 'session-ctx-menu'
  menu.className = 'session-context-menu'
  menu.style.left = e.clientX + 'px'
  menu.style.top = e.clientY + 'px'
  const name = getSessionName(session)
  menu.innerHTML = '<div class="ctx-menu-item" data-action="rename">Rename</div><div class="ctx-menu-item ctx-menu-danger" data-action="cancel">Cancel</div><div class="ctx-menu-item ctx-menu-danger" data-action="delete">Delete</div>'
  menu.addEventListener('click', async (ev) => {
    const action = (ev.target as HTMLElement).dataset.action
    menu.remove()
    if (action === 'rename') {
      const newName = prompt('New name:', name)
      if (newName) await sessionAPI.renameSession(session.id, newName)
    } else if (action === 'cancel') {
      try { await fetch(API_URL + '/sessions/' + session.id + '/cancel', { method: 'POST' }); toast.info('Cancel sent') } catch { toast.error('Failed') }
    } else if (action === 'delete') {
      if (confirm('Delete session "' + name + '"?')) await sessionAPI.deleteSession(session.id)
    }
  })
  document.body.appendChild(menu)
  const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu) }
  setTimeout(() => document.addEventListener('click', closeMenu), 0)
}

function focusSession(sessionId: string | null) {
  focusedSessionId = sessionId

  // Update session list styling
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.session === sessionId || (!sessionId && (el as HTMLElement).dataset.session === 'all'))
  })

  // Select unit
  selectUnit(sessionId)
}

// ============================================================================
// Event Handling
// ============================================================================

function handleEvent(event: ClaudeEvent, isHistory = false) {
  const session = findSessionByClaudeId(event.sessionId)
  const unit = findUnitBySessionId(event.sessionId)

  // Feed the event to FeedManager
  feedManager.add(event)

  // For live events, use the full battlefield handler system (movement + combat animations)
  if (!isHistory) {
    handleBattlefieldEvent(event, battlefieldDeps)

    const sessionName = session ? getSessionName(session) : event.sessionId.slice(0, 8)

    // HUD updates for live events
    switch (event.type) {
      case 'pre_tool_use': {
        const e = event as PreToolUseEvent
        commandBar.setTicker(`[${sessionName}] Using ${e.tool}...`)
        // Add to intel activity feed
        const input = e.toolInput as Record<string, unknown>
        const filePath = (input.file_path as string) || (input.command as string) || (input.pattern as string) || ''
        const desc = filePath ? filePath.split('/').pop() || filePath : ''
        const activityItem = {
          timestamp: event.timestamp,
          sessionName,
          toolName: e.tool,
          description: desc || 'executing...',
          type: 'tool' as const,
        }
        intelPanel.addActivity(activityItem)
        // Feed to floating panel if showing this session
        if (floatingPanel.isVisible() && session && floatingPanel.getUnitId() === session.id) {
          floatingPanel.addActivity(activityItem)
        }
        break
      }
      case 'post_tool_use': {
        const e = event as PostToolUseEvent
        // Track tokens
        resourceBar.updateTokens(event.sessionId, e.tool)
        // Failed tool -> threat + floating panel
        if (!e.success) {
          intelPanel.addThreat(
            `Task failed: ${(event as PostToolUseEvent).tool} in ${sessionName}`,
            'medium',
            unit?.territory
          )
          if (floatingPanel.isVisible() && session && floatingPanel.getUnitId() === session.id) {
            floatingPanel.addActivity({
              timestamp: event.timestamp,
              sessionName,
              toolName: e.tool,
              description: 'FAILED',
              type: 'error',
            })
          }
        }
        break
      }
      case 'stop': {
        intelPanel.addSignal(`Task completed: ${sessionName}`, 'success')
        const stopItem = {
          timestamp: event.timestamp,
          sessionName,
          description: 'Task completed',
          type: 'completion' as const,
        }
        intelPanel.addActivity(stopItem)
        if (floatingPanel.isVisible() && session && floatingPanel.getUnitId() === session.id) {
          floatingPanel.addActivity(stopItem)
        }
        break
      }
      case 'session_start': {
        commandBar.setTicker(`Unit online: ${sessionName}`)
        intelPanel.addSignal(`New session online: ${sessionName}`, 'info')
        break
      }
    }
    return
  }

  // History events: apply state without animations
  switch (event.type) {
    case 'pre_tool_use': {
      const e = event as PreToolUseEvent
      if (unit) {
        unit.setStatus('working')
        unit.setCurrentTool(e.tool)
        const territory = toolToTerritory(e.tool)
        battlefield.moveUnit(unit.id, territory)
      }
      break
    }

    case 'post_tool_use': {
      if (unit) {
        unit.setCurrentTool('')
      }
      break
    }

    case 'stop': {
      if (unit) {
        unit.setStatus('idle')
        unit.setCurrentTool('')
        battlefield.moveUnit(unit.id, 'hq')
      }
      break
    }

    case 'user_prompt_submit': {
      if (unit) {
        unit.setStatus('thinking')
      }
      break
    }

    case 'session_end': {
      if (unit) {
        unit.setStatus('offline')
        unit.setCurrentTool('')
      }
      break
    }
  }
}

// ============================================================================
// Unit Selection
// ============================================================================

function selectUnit(unitId: string | null) {
  // Deselect previous
  if (selectedUnitId) {
    const prev = battlefield.getUnit(selectedUnitId)
    if (prev) prev.setSelected(false)
  }

  selectedUnitId = unitId

  if (unitId) {
    const unit = battlefield.getUnit(unitId)
    const session = sessions.get(unitId)
    if (unit) {
      unit.setSelected(true)
      gameState.selectUnit(unitId)
    }
    commandBar.selectSession(unitId)

    // Show ability bar for the selected unit
    if (session) {
      abilityBar.show(unitId, session)
    }
  } else {
    gameState.deselectAll()
    floatingPanel.hide()
    abilityBar.hide()
    commandBar.selectSession('')
  }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

function setupKeyboard() {
  controlGroupManager = new ControlGroupManager()

  keyboardManager = new KeyboardManager({
    // 1-9: select unit by index from the sorted sessions list
    onSelectUnit: (index: number) => {
      const sessionList = getSortedSessionList()
      if (index < sessionList.length) {
        const session = sessionList[index]
        focusSession(session.id)
        const pos = battlefield.getUnitScreenPosition(session.id)
        if (pos) {
          const unit = battlefield.getUnit(session.id)
          if (unit) floatingPanel.show(session.id, unit, session, pos.x, pos.y)
          selectUnit(session.id)
        }
        // Jump camera to unit
        const unit = battlefield.getUnit(session.id)
        if (unit) battlefield.jumpToPosition(unit.worldX, unit.worldY)
      }
    },

    // Ctrl+1-9: recall group — jump camera to first unit, select all in group
    onRecallGroup: (group: number) => {
      const ids = controlGroupManager.recallGroup(group)
      if (ids.length === 0) return
      // Select the first unit and jump to it
      const firstId = ids[0]
      focusSession(firstId)
      const unit = battlefield.getUnit(firstId)
      if (unit) battlefield.jumpToPosition(unit.worldX, unit.worldY)
      // Select all units in the group
      ids.forEach(id => {
        const u = battlefield.getUnit(id)
        if (u) u.setSelected(true)
      })
    },

    // Ctrl+Shift+1-9: save currently selected unit(s) to group
    onSaveGroup: (group: number) => {
      const ids = selectedUnitId ? [selectedUnitId] : []
      if (ids.length > 0) {
        controlGroupManager.saveGroup(group, ids)
        toast.info(`Group ${group} saved`)
      }
    },

    // Tab: cycle through territory centers
    onCycleTerritory: () => {
      territoryIndex = (territoryIndex + 1) % TERRITORY_ORDER.length
      const territory = TERRITORY_ORDER[territoryIndex]
      const center = battlefield.terrainRenderer.getTerritoryCenter(territory)
      battlefield.jumpToPosition(center.x, center.y)
    },

    // Space: jump to last alert (most recently active unit)
    onJumpToAlert: () => {
      let latestId: string | null = null
      let latestTime = 0
      for (const unit of gameState.getAllUnits()) {
        if (unit.lastActivity > latestTime && unit.status !== 'offline') {
          latestTime = unit.lastActivity
          latestId = unit.sessionId
        }
      }
      if (latestId) {
        focusSession(latestId)
        const unit = battlefield.getUnit(latestId)
        if (unit) battlefield.jumpToPosition(unit.worldX, unit.worldY)
      }
    },

    // Esc: hide production view, floating panel, deselect
    onDeselect: () => {
      if (productionChainRenderer.isVisible()) {
        productionChainRenderer.hide()
        return
      }
      floatingPanel.hide()
      focusSession(null)
    },

    // Alt+N: deploy new unit (open create session modal)
    onDeployUnit: () => {
      const modal = document.getElementById('new-session-modal')
      if (modal) modal.classList.add('visible')
    },

    // Alt+K: kill selected unit
    onKillUnit: () => {
      if (!selectedUnitId) return
      const id = selectedUnitId
      fetch(`${API_URL}/sessions/${id}`, { method: 'DELETE' }).catch(() => {
        toast.error('Failed to kill unit')
      })
    },
  })

  // Ability bar hotkeys: Q/W/E/R/D/F when unit selected and not in an input field
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const key = e.key.toUpperCase()
    if (HOTKEY_ORDER.includes(key as any) && abilityBar.isVisible()) {
      if (abilityBar.handleHotkey(key)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  })
}

/** Returns sessions sorted the same way updateSessionsList() does. */
function getSortedSessionList(): ManagedSession[] {
  const list = Array.from(sessions.values())
  list.sort((a, b) => {
    const order: Record<string, number> = { working: 0, waiting: 1, idle: 2, offline: 3 }
    return (order[a.status] ?? 2) - (order[b.status] ?? 2)
  })
  return list
}

// ============================================================================
// Modals
// ============================================================================

function setupModals() {
  // Question modal - pass context matching QuestionModalContext
  const questionCtx: QuestionModalContext = {
    scene: null,
    soundEnabled: false,
    apiUrl: API_URL,
    attentionSystem: null,
  }
  setupQuestionModal(questionCtx)

  // Permission modal - pass context matching PermissionModalContext
  const permissionCtx: PermissionModalContext = {
    scene: null,
    soundEnabled: false,
    apiUrl: API_URL,
    attentionSystem: null,
    getManagedSessions: () => Array.from(sessions.values()),
  }
  setupPermissionModal(permissionCtx)

  // New session modal
  const newSessionModal = document.getElementById('new-session-modal')
  const modalCancel = document.getElementById('modal-cancel')
  const modalCreate = document.getElementById('modal-create')

  modalCancel?.addEventListener('click', () => {
    newSessionModal?.classList.remove('visible')
  })

  modalCreate?.addEventListener('click', async () => {
    const cwdInput = document.getElementById('session-cwd-input') as HTMLInputElement
    const nameInput = document.getElementById('session-name-input') as HTMLInputElement
    const continueOpt = document.getElementById('session-opt-continue') as HTMLInputElement
    const skipPermsOpt = document.getElementById('session-opt-skip-perms') as HTMLInputElement

    try {
      const response = await fetch(`${API_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput?.value || undefined,
          cwd: cwdInput?.value || undefined,
          flags: {
            continue: continueOpt?.checked,
            skipPermissions: skipPermsOpt?.checked,
          },
        }),
      })

      if (response.ok) {
        toast.success('Agent deployed')
        newSessionModal?.classList.remove('visible')
      } else {
        const err = await response.json().catch(() => ({}))
        toast.error(`Deploy failed: ${(err as any).error || 'Unknown error'}`)
      }
    } catch (e) {
      toast.error('Network error deploying agent')
    }
  })

  // Settings modal
  const settingsBtn = document.getElementById('settings-btn')
  const settingsModal = document.getElementById('settings-modal')
  const settingsClose = document.getElementById('settings-close')

  settingsBtn?.addEventListener('click', () => {
    settingsModal?.classList.toggle('visible')
  })
  settingsClose?.addEventListener('click', () => {
    settingsModal?.classList.remove('visible')
  })

  // Port setting
  const portInput = document.getElementById('settings-port') as HTMLInputElement
  if (portInput) {
    portInput.value = String(AGENT_PORT)
    portInput.addEventListener('change', () => {
      localStorage.setItem('agent-empires-port', portInput.value)
      toast.info('Port updated. Refresh to apply.')
    })
  }

  // Volume setting
  const volumeSlider = document.getElementById('settings-volume') as HTMLInputElement
  const volumeValue = document.getElementById('settings-volume-value')
  if (volumeSlider && volumeValue) {
    volumeSlider.addEventListener('input', () => {
      volumeValue.textContent = `${volumeSlider.value}%`
    })
  }

  // Refresh sessions button
  const refreshBtn = document.getElementById('settings-refresh-sessions')
  refreshBtn?.addEventListener('click', () => {
    eventClient.disconnect()
    eventClient.connect()
    toast.info('Reconnecting...')
  })

  // Close modals on backdrop click
  ;[newSessionModal, settingsModal].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('visible')
      }
    })
  })
}

// ============================================================================
// Territory Click → Production Chain View
// ============================================================================

function setupTerritoryClick() {
  const canvas = battlefield.app.canvas as HTMLCanvasElement
  let mouseDownPos: { x: number; y: number } | null = null

  // Track mousedown position to distinguish click from pan
  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 0) {
      mouseDownPos = { x: e.clientX, y: e.clientY }
    }
  })

  canvas.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button !== 0 || !mouseDownPos) return

    // Only count as a click if mouse didn't move much (not a pan)
    const dx = e.clientX - mouseDownPos.x
    const dy = e.clientY - mouseDownPos.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    mouseDownPos = null

    if (dist > 5) return  // was a pan, not a click

    // Convert screen position to world position
    const worldPos = battlefield.getWorldPosition(e.clientX, e.clientY)

    // Hit-test against territory polygons
    const territory = battlefield.terrainRenderer.hitTestTerritory(worldPos.x, worldPos.y)

    if (!territory) {
      // Clicked outside all territories — dismiss production view
      if (productionChainRenderer.isVisible()) {
        productionChainRenderer.hide()
      }
      return
    }

    // If production view is already showing for this territory, dismiss it
    if (productionChainRenderer.getActiveTerritory() === territory) {
      productionChainRenderer.hide()
      return
    }

    // If we have cached production data for this territory, show it
    const data = productionChainCache.get(territory)
    if (data) {
      productionChainRenderer.show(territory, data)
    } else {
      // Generate mock data for demonstration
      const mockData = generateMockProductionData(territory)
      if (mockData) {
        productionChainCache.set(territory, mockData)
        productionChainRenderer.show(territory, mockData)
      }
    }
  })
}

/** Generate mock production chain data for a territory (used when no real data). */
function generateMockProductionData(territory: string): ProductionChainData | null {
  const chains: Record<string, { names: string[]; metrics: number[]; targets: number[]; units: string[] }> = {
    'lead-gen': {
      names: ['Content Published', 'Impressions', 'Visitors', 'Subscribers', 'Waitlist'],
      metrics: [12, 3200, 890, 67, 41],
      targets: [15, 4000, 1000, 100, 60],
      units: ['/week', '/week', '/week', '/week', '/week'],
    },
    'sales': {
      names: ['Leads In', 'Call Booked', 'Proposal Sent', 'Negotiation', 'Closed Won'],
      metrics: [41, 12, 8, 3, 2],
      targets: [50, 15, 12, 5, 3],
      units: ['/week', '/week', '/week', '/week', '/week'],
    },
    'fulfillment': {
      names: ['New Students', 'Onboarded', 'Attendance', 'Completion', 'NPS Score'],
      metrics: [8, 8, 85, 72, 4.3],
      targets: [10, 10, 90, 80, 4.5],
      units: ['/cohort', '/cohort', '%', '%', '/5.0'],
    },
    'support': {
      names: ['Tickets In', 'First Response', 'Resolution', 'Satisfaction'],
      metrics: [14, 2.4, 18, 4.1],
      targets: [20, 2, 12, 4.5],
      units: ['/week', ' avg h', ' avg h', '/5.0'],
    },
    'retention': {
      names: ['Active Clients', 'Renewal Pipeline', 'Upsell Candidates', 'Churn Risk'],
      metrics: [34, 12, 5, 2],
      targets: [40, 15, 8, 0],
      units: ['', ' due 30d', ' identified', ' flagged'],
    },
    'content': {
      names: ['Ideas', 'Drafts', 'Published', 'Engagement'],
      metrics: [20, 8, 5, 3200],
      targets: [25, 12, 10, 5000],
      units: ['/week', '/week', '/week', '/week'],
    },
    'hq': {
      names: ['Tasks Created', 'In Progress', 'Completed', 'Velocity'],
      metrics: [15, 8, 12, 85],
      targets: [20, 10, 18, 100],
      units: ['/week', '', '/week', '%'],
    },
  }

  const chain = chains[territory]
  if (!chain) return null

  const nodeCount = chain.names.length
  const nodes = chain.names.map((name, i) => ({
    id: `${territory}-${i}`,
    territory,
    name,
    metric: chain.metrics[i],
    target: chain.targets[i],
    capacity: chain.targets[i] * 1.5,
    unit: chain.units[i],
    inputNodes: i > 0 ? [`${territory}-${i - 1}`] : [],
    outputNodes: i < nodeCount - 1 ? [`${territory}-${i + 1}`] : [],
    position: {
      x: nodeCount > 1 ? i / (nodeCount - 1) : 0.5,
      y: 0.5 + (i % 2 === 0 ? -0.15 : 0.15),
    },
  }))

  return { territory, nodes }
}

// ============================================================================
// Not-Connected Overlay
// ============================================================================

function setupOverlay() {
  const retryBtn = document.getElementById('retry-connection')
  const exploreBtn = document.getElementById('explore-offline')
  const overlay = document.getElementById('not-connected-overlay')

  retryBtn?.addEventListener('click', () => {
    eventClient.disconnect()
    eventClient.connect()
    overlay?.classList.remove('visible')
  })

  exploreBtn?.addEventListener('click', () => {
    overlay?.classList.remove('visible')
  })

  // Show overlay initially
  overlay?.classList.add('visible')
}

// ============================================================================
// Boot
// ============================================================================

init().catch((err) => {
  console.error('[Agent Empires] Failed to initialize:', err)
})
