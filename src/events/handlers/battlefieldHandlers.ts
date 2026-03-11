/**
 * Battlefield Event Handlers
 *
 * Wires Claude events to game state updates, movement, and combat animations.
 * Called from main.ts after all systems are initialized.
 */

import type { GameState } from '../../game/GameState'
import type { CombatAnimator } from '../../game/CombatAnimator'
import type { ComboTracker } from '../../game/ComboTracker'
import type { MovementManager } from '../../game/MovementManager'
import type { BattlefieldRenderer } from '../../renderer/BattlefieldRenderer'
import type { TerritoryId } from '../../renderer/TerritoryRenderer'
import type {
  ClaudeEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  ManagedSession,
} from '../../../shared/types'
import { soundManager } from '../../audio'

// Territory detection: file path rules (mirrors server-side TerritoryDetector)
const PATH_RULES: Array<{ pattern: RegExp; territory: TerritoryId }> = [
  { pattern: /\/domains\/sales\//,        territory: 'sales' },
  { pattern: /\/domains\/fulfillment\//,   territory: 'fulfillment' },
  { pattern: /\/domains\/lead-gen\//,      territory: 'lead-gen' },
  { pattern: /\/domains\/support\//,       territory: 'support' },
  { pattern: /\/domains\/retention\//,     territory: 'retention' },
  { pattern: /\/domains\/home\//,          territory: 'hq' },
  { pattern: /\/clients\//,               territory: 'content' },
  { pattern: /\/prompts\//,               territory: 'content' },
  { pattern: /\/funnels\//,               territory: 'lead-gen' },
  { pattern: /\/skills\//,                territory: 'fulfillment' },
  { pattern: /\/agent-runner\//,           territory: 'hq' },
  { pattern: /\/scripts\//,               territory: 'hq' },
]

const TOOL_TERRITORY_FALLBACK: Record<string, TerritoryId> = {
  'WebFetch': 'lead-gen',
  'WebSearch': 'lead-gen',
}

/**
 * Client-side territory detection from event data.
 * If server provides a territory field, use it. Otherwise detect locally.
 */
function detectTerritoryFromEvent(event: ClaudeEvent): TerritoryId {
  // Check if server already detected territory
  if ((event as any).territory) {
    return (event as any).territory as TerritoryId
  }

  // Client-side detection from tool input paths
  if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
    const toolEvent = event as PreToolUseEvent | PostToolUseEvent
    const input = toolEvent.toolInput

    if (input && typeof input === 'object') {
      const pathFields = ['file_path', 'path', 'command']
      for (const field of pathFields) {
        const val = (input as Record<string, unknown>)[field]
        if (typeof val === 'string') {
          for (const rule of PATH_RULES) {
            if (rule.pattern.test(val)) {
              return rule.territory
            }
          }
        }
      }
    }

    // Tool type fallback
    const fallback = TOOL_TERRITORY_FALLBACK[toolEvent.tool]
    if (fallback) return fallback
  }

  // CWD-based detection
  if (event.cwd) {
    for (const rule of PATH_RULES) {
      if (rule.pattern.test(event.cwd)) {
        return rule.territory
      }
    }
  }

  return 'hq'
}

export interface BattlefieldHandlerDeps {
  gameState: GameState
  combatAnimator: CombatAnimator
  comboTracker: ComboTracker
  movementManager: MovementManager
  battlefield: BattlefieldRenderer
  findUnitBySessionId: (claudeSessionId: string) => any
  findSessionByClaudeId: (claudeSessionId: string) => ManagedSession | undefined
}

/**
 * Handle a Claude event: update game state, trigger movement, play animations.
 * Called for each live event (not history).
 */
export function handleBattlefieldEvent(event: ClaudeEvent, deps: BattlefieldHandlerDeps): void {
  const {
    gameState,
    combatAnimator,
    comboTracker,
    movementManager,
    battlefield,
    findUnitBySessionId,
    findSessionByClaudeId,
  } = deps

  const unit = findUnitBySessionId(event.sessionId)
  const session = findSessionByClaudeId(event.sessionId)
  const gameUnit = session ? gameState.getUnit(session.id) : undefined

  switch (event.type) {
    case 'pre_tool_use': {
      const e = event as PreToolUseEvent
      if (!unit || !session || !gameUnit) break

      // Update status
      gameState.updateUnitStatus(session.id, 'working', e.tool)
      unit.setStatus('working')
      unit.setCurrentTool(e.tool)

      // Activate sustained-tool animation based on tool type
      const sustainedMap: Record<string, 'bash' | 'read' | 'write' | 'search'> = {
        'Bash': 'bash',
        'Read': 'read',
        'Write': 'write',
        'Edit': 'write',
        'Grep': 'search',
        'Glob': 'search',
      }
      const sustainedType = sustainedMap[e.tool] || null
      unit.setSustainedTool(sustainedType)

      // Detect territory and move if needed
      const territory = detectTerritoryFromEvent(event)
      if (territory !== gameUnit.territory) {
        movementManager.moveToTerritory(session.id, territory)
      }

      // Play combat animation at unit position
      combatAnimator.playToolAnimation(session.id, e.tool, unit.worldX, unit.worldY)
      break
    }

    case 'post_tool_use': {
      const e = event as PostToolUseEvent
      if (!unit || !session) break

      unit.setCurrentTool('')
      unit.setSustainedTool(null) // Clear sustained animation
      gameState.updateUnitStatus(session.id, 'working')

      // Play result animation
      combatAnimator.playResultAnimation(unit.worldX, unit.worldY, e.success)

      // Combo tracking
      if (e.success) {
        const result = comboTracker.recordToolComplete(event.sessionId)
        if (result) {
          const { count, tierInfo } = result
          // Build label: "COMBO x3", "STREAK x6", "RAMPAGE x10!"
          const suffix = tierInfo.tier === 'rampage' ? '!' : ''
          const label = `${tierInfo.label} x${count}${suffix}`
          unit.showCombo(label, tierInfo.color)
          // Napoleon-era combo sound — pitch scales with tier
          const tierNum = tierInfo.tier === 'combo' ? 1 : tierInfo.tier === 'streak' ? 2 : 3
          soundManager.playCombo(tierNum)
          // Particle burst scaled to tier
          battlefield.particleSystem.burst(
            unit.worldX, unit.worldY,
            tierInfo.color,
            tierInfo.particleCount
          )
        }
      } else {
        // Error resets combo
        comboTracker.resetCombo(event.sessionId)
      }
      break
    }

    case 'stop': {
      if (!unit || !session) break

      gameState.updateUnitStatus(session.id, 'idle')
      unit.setStatus('idle')
      unit.setCurrentTool('')
      unit.setSustainedTool(null)

      // Return to HQ
      movementManager.moveToTerritory(session.id, 'hq')

      // Completion effect
      combatAnimator.playCompletionEffect(unit.worldX, unit.worldY)

      // Reset combo on session stop
      comboTracker.resetCombo(event.sessionId)
      break
    }

    case 'user_prompt_submit': {
      if (!unit || !session) break

      gameState.updateUnitStatus(session.id, 'thinking')
      unit.setStatus('thinking')

      // Command flash
      combatAnimator.playCommandFlash(unit.worldX, unit.worldY)
      break
    }

    case 'session_start': {
      // Unit creation is handled by session management, not here
      break
    }

    case 'session_end': {
      if (!unit || !session) break

      gameState.updateUnitStatus(session.id, 'offline')
      unit.setStatus('offline')
      unit.setCurrentTool('')
      unit.setSustainedTool(null)

      // Napoleon-era collapse sound — descending saw wave
      soundManager.play('collapse')

      // Dissolve effect
      combatAnimator.playDissolve(unit.worldX, unit.worldY)

      // Clean up combo state
      comboTracker.resetCombo(event.sessionId)
      break
    }
  }
}
