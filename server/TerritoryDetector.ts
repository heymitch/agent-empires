/**
 * TerritoryDetector - Server-side territory classification for Claude events
 *
 * Analyzes file paths, tool inputs, and tool types to determine
 * which business territory an event belongs to.
 */

import type { ClaudeEvent, PreToolUseEvent, PostToolUseEvent } from '../shared/types.js'

export type TerritoryId = 'lead-gen' | 'content' | 'sales' | 'fulfillment' | 'support' | 'retention' | 'hq'

// Priority 1: File path patterns
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

// Priority 2: Tool input patterns (skill/command invocations)
const INPUT_RULES: Array<{ pattern: RegExp; territory: TerritoryId }> = [
  { pattern: /content:/i,    territory: 'content' },
  { pattern: /sales:/i,      territory: 'sales' },
  { pattern: /quality:/i,    territory: 'content' },
  { pattern: /analytics:/i,  territory: 'lead-gen' },
  { pattern: /slack:/i,      territory: 'support' },
  { pattern: /publish:/i,    territory: 'lead-gen' },
]

// Priority 3: Tool type fallback
const TOOL_FALLBACK: Record<string, TerritoryId> = {
  'WebFetch': 'lead-gen',
  'WebSearch': 'lead-gen',
}

/**
 * Extract file paths from a tool event's input
 */
function extractFilePaths(event: ClaudeEvent): string[] {
  if (event.type !== 'pre_tool_use' && event.type !== 'post_tool_use') return []

  const toolEvent = event as PreToolUseEvent | PostToolUseEvent
  const input = toolEvent.toolInput
  if (!input || typeof input !== 'object') return []

  const paths: string[] = []

  // Common field names that contain file paths
  const pathFields = ['file_path', 'path', 'command', 'pattern', 'content']
  for (const field of pathFields) {
    const val = (input as Record<string, unknown>)[field]
    if (typeof val === 'string') {
      paths.push(val)
    }
  }

  return paths
}

/**
 * Extract text content from tool input for pattern matching
 */
function extractInputText(event: ClaudeEvent): string {
  if (event.type !== 'pre_tool_use' && event.type !== 'post_tool_use') return ''

  const toolEvent = event as PreToolUseEvent | PostToolUseEvent
  const input = toolEvent.toolInput
  if (!input || typeof input !== 'object') return ''

  return Object.values(input)
    .filter(v => typeof v === 'string')
    .join(' ')
}

/**
 * Detect the territory for a given Claude event.
 * Uses priority ordering: file paths > input patterns > tool type > 'hq' fallback
 */
export function detectTerritory(event: ClaudeEvent): TerritoryId {
  // Priority 1: Check file paths in tool input
  const filePaths = extractFilePaths(event)
  for (const fp of filePaths) {
    for (const rule of PATH_RULES) {
      if (rule.pattern.test(fp)) {
        return rule.territory
      }
    }
  }

  // Also check cwd for path-based hints
  if (event.cwd) {
    for (const rule of PATH_RULES) {
      if (rule.pattern.test(event.cwd)) {
        return rule.territory
      }
    }
  }

  // Priority 2: Check tool input text for skill/command patterns
  const inputText = extractInputText(event)
  if (inputText) {
    for (const rule of INPUT_RULES) {
      if (rule.pattern.test(inputText)) {
        return rule.territory
      }
    }
  }

  // Priority 3: Tool type fallback
  if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
    const toolEvent = event as PreToolUseEvent | PostToolUseEvent
    const fallback = TOOL_FALLBACK[toolEvent.tool]
    if (fallback) return fallback
  }

  // Default
  return 'hq'
}
