/**
 * CommandRouter - Parses raw command input and routes to correct API endpoint
 *
 * Detects intent from natural language:
 * - Deploy: "deploy scout to lead-gen", "new unit in sales"
 * - Kill: "kill <name>", "terminate <name>"
 * - Cancel: "stop <name>", "cancel <name>", "abort <name>"
 * - Restart: "restart <name>", "revive <name>"
 * - Broadcast: "all: <prompt>" sends to every active session
 * - Direct: "@<name> <prompt>" sends to specific unit by name
 * - Default: sends to selected/focused session
 */

import type { ManagedSession } from '../../shared/types'
import type { TerritoryId } from '../renderer/TerrainRenderer'

export interface ObjectiveRouteOptions {
  name?: string
  hp?: number
  territory?: string
  campaign?: string
  depends?: string
  objectiveName?: string
  delta?: number
}

export interface RouteResult {
  type: 'prompt' | 'deploy' | 'kill' | 'cancel' | 'restart' | 'broadcast' | 'create_boss' | 'assault' | 'complete_boss'
  sessionId?: string
  sessionName?: string
  prompt?: string
  deployOptions?: {
    name?: string
    cwd?: string
    territory?: TerritoryId
  }
  objectiveOptions?: ObjectiveRouteOptions
}

const TERRITORIES: TerritoryId[] = ['lead-gen', 'content', 'sales', 'fulfillment', 'support', 'retention', 'hq']

const TERRITORY_ALIASES: Record<string, TerritoryId> = {
  'leadgen': 'lead-gen',
  'lead-gen': 'lead-gen',
  'lead gen': 'lead-gen',
  'marketing': 'lead-gen',
  'content': 'content',
  'sales': 'sales',
  'fulfillment': 'fulfillment',
  'delivery': 'fulfillment',
  'support': 'support',
  'retention': 'retention',
  'hq': 'hq',
  'home': 'hq',
  'headquarters': 'hq',
}

export class CommandRouter {
  /**
   * Parse raw input and determine routing intent.
   * Sessions list is used for name matching.
   */
  route(input: string, sessions: Map<string, ManagedSession>, selectedSessionId: string | null): RouteResult {
    const trimmed = input.trim()
    if (!trimmed) {
      return { type: 'prompt', sessionId: selectedSessionId ?? undefined, prompt: '' }
    }

    // === Create Boss ===
    // "create boss "Copy Generation" territory:fulfillment hp:15"
    // "create boss "Kit Wiring" hp:7 territory:lead-gen depends:"Copy Generation""
    const createBossMatch = trimmed.match(/^create\s+boss\s+(.+)/i)
    if (createBossMatch) {
      return this.parseCreateBoss(createBossMatch[1])
    }

    // === Assault ===
    // "assault "Copy Generation""
    const assaultMatch = trimmed.match(/^assault\s+["']?([^"']+)["']?\s*$/i)
    if (assaultMatch) {
      return {
        type: 'assault',
        objectiveOptions: { objectiveName: assaultMatch[1].trim() },
      }
    }

    // === Complete (drain 1 HP) ===
    // "complete "Copy Generation""
    // "complete "Copy Generation" task:3"
    const completeMatch = trimmed.match(/^complete\s+["']?([^"']+)["']?(?:\s+task:(\d+))?\s*$/i)
    if (completeMatch) {
      const delta = completeMatch[2] ? -parseInt(completeMatch[2], 10) : -1
      return {
        type: 'complete_boss',
        objectiveOptions: {
          objectiveName: completeMatch[1].trim(),
          delta,
        },
      }
    }

    // === Deploy ===
    const deployMatch = trimmed.match(/^(?:deploy|spawn|new|launch)\s+(.+)/i)
    if (deployMatch) {
      return this.parseDeployIntent(deployMatch[1])
    }

    // === Kill ===
    const killMatch = trimmed.match(/^(?:kill|terminate|destroy)\s+(.+)/i)
    if (killMatch) {
      const target = this.resolveSessionByName(killMatch[1].trim(), sessions)
      return {
        type: 'kill',
        sessionId: target?.id,
        sessionName: killMatch[1].trim(),
      }
    }

    // === Cancel/Stop ===
    const cancelMatch = trimmed.match(/^(?:stop|cancel|abort|halt)\s+(.+)/i)
    if (cancelMatch) {
      const target = this.resolveSessionByName(cancelMatch[1].trim(), sessions)
      return {
        type: 'cancel',
        sessionId: target?.id,
        sessionName: cancelMatch[1].trim(),
      }
    }

    // === Restart ===
    const restartMatch = trimmed.match(/^(?:restart|revive|reboot)\s+(.+)/i)
    if (restartMatch) {
      const target = this.resolveSessionByName(restartMatch[1].trim(), sessions)
      return {
        type: 'restart',
        sessionId: target?.id,
        sessionName: restartMatch[1].trim(),
      }
    }

    // === Broadcast ===
    if (trimmed.toLowerCase().startsWith('all:') || trimmed.toLowerCase().startsWith('broadcast:')) {
      const colonIdx = trimmed.indexOf(':')
      const prompt = trimmed.slice(colonIdx + 1).trim()
      return { type: 'broadcast', prompt }
    }

    // === Direct @mention ===
    const mentionMatch = trimmed.match(/^@(\S+)\s+(.+)/s)
    if (mentionMatch) {
      const target = this.resolveSessionByName(mentionMatch[1], sessions)
      return {
        type: 'prompt',
        sessionId: target?.id,
        sessionName: mentionMatch[1],
        prompt: mentionMatch[2].trim(),
      }
    }

    // === Default: prompt to selected session ===
    return {
      type: 'prompt',
      sessionId: selectedSessionId ?? undefined,
      prompt: trimmed,
    }
  }

  private parseDeployIntent(rest: string): RouteResult {
    // Patterns:
    // "deploy scout to lead-gen"
    // "deploy recon in sales"
    // "deploy new unit"
    // "deploy to content"
    // "deploy scout at ~/my-project"
    let name: string | undefined
    let territory: TerritoryId | undefined
    let cwd: string | undefined

    // Check for "to <territory>" or "in <territory>"
    const territoryMatch = rest.match(/\b(?:to|in|at)\s+(\S+)\s*$/i)
    if (territoryMatch) {
      const candidate = territoryMatch[1].toLowerCase()
      if (TERRITORY_ALIASES[candidate]) {
        territory = TERRITORY_ALIASES[candidate]
        rest = rest.slice(0, territoryMatch.index).trim()
      } else if (candidate.startsWith('~') || candidate.startsWith('/')) {
        // It's a path
        cwd = candidate
        rest = rest.slice(0, territoryMatch.index).trim()
      }
    }

    // Whatever's left is the name (if anything meaningful)
    const cleaned = rest.replace(/\b(?:unit|agent|claw|session|a|an|the|new)\b/gi, '').trim()
    if (cleaned) {
      name = cleaned
    }

    return {
      type: 'deploy',
      deployOptions: {
        name: name || undefined,
        cwd: cwd || undefined,
        territory: territory || 'hq',
      },
    }
  }

  private parseCreateBoss(rest: string): RouteResult {
    // Extract quoted name
    let name = ''
    const quotedName = rest.match(/["']([^"']+)["']/)
    if (quotedName) {
      name = quotedName[1]
      rest = rest.replace(quotedName[0], '').trim()
    }

    // Extract key:value pairs
    const opts: ObjectiveRouteOptions = { name }

    const hpMatch = rest.match(/\bhp:(\d+)/i)
    if (hpMatch) opts.hp = parseInt(hpMatch[1], 10)

    const territoryMatch = rest.match(/\bterritory:(\S+)/i)
    if (territoryMatch) opts.territory = territoryMatch[1]

    const campaignMatch = rest.match(/\bcampaign:["']?([^"']+)["']?/i)
    if (campaignMatch) opts.campaign = campaignMatch[1].trim()

    const dependsMatch = rest.match(/\bdepends:["']?([^"']+)["']?/i)
    if (dependsMatch) opts.depends = dependsMatch[1].trim()

    // If no quoted name, use whatever remains after removing key:value pairs
    if (!name) {
      const cleaned = rest
        .replace(/\b\w+:\S+/g, '')
        .replace(/\b\w+:["'][^"']*["']/g, '')
        .trim()
      if (cleaned) opts.name = cleaned
    }

    return {
      type: 'create_boss',
      objectiveOptions: opts,
    }
  }

  private resolveSessionByName(name: string, sessions: Map<string, ManagedSession>): ManagedSession | undefined {
    const lower = name.toLowerCase()

    // Exact match on id
    const byId = sessions.get(name)
    if (byId) return byId

    // Match by session name (case-insensitive, partial)
    for (const session of sessions.values()) {
      const sName = (session.name || '').toLowerCase()
      if (sName === lower) return session
    }

    // Partial match
    for (const session of sessions.values()) {
      const sName = (session.name || '').toLowerCase()
      if (sName.includes(lower) || lower.includes(sName)) return session
    }

    return undefined
  }
}
