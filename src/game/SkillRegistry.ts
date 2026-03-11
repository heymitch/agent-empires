/**
 * SkillRegistry - Defines all agent skills and unit type loadouts
 *
 * Each unit type (Writer, Scout, Engineer, Commander, Diplomat) has a default
 * skill loadout mapped to hotkeys Q/W/E/R/D/F. Skills reference real slash
 * commands from the speakeasy-agent workspace.
 *
 * Skill categories:
 *   basic   - Q/W/E: standard abilities, short cooldown
 *   combo   - D/F: utility/chain abilities
 *   ultimate - R: high-impact, long cooldown
 *   passive  - always active, no click
 */

// ============================================================================
// Types
// ============================================================================

export type SkillCategory = 'basic' | 'combo' | 'ultimate' | 'passive'

export type Hotkey = 'Q' | 'W' | 'E' | 'R' | 'D' | 'F'

export interface Skill {
  id: string
  name: string
  icon: string
  hotkey: Hotkey
  cooldownMs: number
  description: string
  slashCommand: string
  category: SkillCategory
  /** If true, a parameter input modal is shown before casting */
  needsInput?: boolean
  /** Placeholder text for the input modal */
  inputPlaceholder?: string
}

export interface PassiveSkill {
  id: string
  name: string
  icon: string
  description: string
  category: 'passive'
}

export type UnitType = 'writer' | 'scout' | 'engineer' | 'commander' | 'diplomat'

export interface UnitLoadout {
  unitType: UnitType
  label: string
  skills: Skill[]
  passive: PassiveSkill
}

// ============================================================================
// Skill Definitions
// ============================================================================

const WRITER_SKILLS: Skill[] = [
  {
    id: 'writer-q',
    name: 'LinkedIn Post',
    icon: '\u{1F4DD}',
    hotkey: 'Q',
    cooldownMs: 45_000,
    description: 'Generate a LinkedIn post on a given topic. Uses voice patterns and mentor frameworks.',
    slashCommand: '/content:generate-linkedin',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Topic or angle...',
  },
  {
    id: 'writer-w',
    name: 'Twitter Post',
    icon: '\u{1F3AF}',
    hotkey: 'W',
    cooldownMs: 30_000,
    description: 'Generate a Twitter/X post. Short-form, punchy, optimized for engagement.',
    slashCommand: '/content:generate-twitter',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Topic or hook...',
  },
  {
    id: 'writer-e',
    name: 'Quality Audit',
    icon: '\u{1F50D}',
    hotkey: 'E',
    cooldownMs: 60_000,
    description: 'Run AI detection audit on content. Grades A-F with fix suggestions.',
    slashCommand: '/quality:audit-ai-detection',
    category: 'basic',
  },
  {
    id: 'writer-r',
    name: 'Week Batch',
    icon: '\u{26A1}',
    hotkey: 'R',
    cooldownMs: 300_000,
    description: 'Plan and generate 7 days of content. High token cost. Ultimate ability.',
    slashCommand: '/content:week-batch',
    category: 'ultimate',
    needsInput: true,
    inputPlaceholder: 'Theme or campaign focus...',
  },
  {
    id: 'writer-d',
    name: 'Gen Image',
    icon: '\u{1F5BC}\u{FE0F}',
    hotkey: 'D',
    cooldownMs: 45_000,
    description: 'Generate an image for a post using AI image generation.',
    slashCommand: '/content:generate-image',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Image description...',
  },
  {
    id: 'writer-f',
    name: 'Carousel',
    icon: '\u{1F4CA}',
    hotkey: 'F',
    cooldownMs: 60_000,
    description: 'Generate a multi-slide carousel for LinkedIn or social media.',
    slashCommand: '/content:generate-carousel',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Carousel topic...',
  },
]

const WRITER_PASSIVE: PassiveSkill = {
  id: 'writer-passive',
  name: 'Auto Quality Check',
  icon: '\u{2705}',
  description: 'Automatically runs quality audit on every generated post.',
  category: 'passive',
}

const SCOUT_SKILLS: Skill[] = [
  {
    id: 'scout-q',
    name: 'YT Research',
    icon: '\u{1F4F9}',
    hotkey: 'Q',
    cooldownMs: 60_000,
    description: 'Research YouTube trends and competitor videos in a niche.',
    slashCommand: '/research:youtube',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Niche or keyword...',
  },
  {
    id: 'scout-w',
    name: 'Analytics',
    icon: '\u{1F4C8}',
    hotkey: 'W',
    cooldownMs: 45_000,
    description: 'Check analytics and performance metrics across platforms.',
    slashCommand: '/analytics:check',
    category: 'basic',
  },
  {
    id: 'scout-e',
    name: 'Discussions',
    icon: '\u{1F4AC}',
    hotkey: 'E',
    cooldownMs: 45_000,
    description: 'Find relevant discussions in Slack channels for intel.',
    slashCommand: '/slack:find-discussions',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Topic to search...',
  },
  {
    id: 'scout-r',
    name: 'Market Sweep',
    icon: '\u{1F30D}',
    hotkey: 'R',
    cooldownMs: 600_000,
    description: 'Full market sweep: competitors, trends, opportunities. Ultimate ability.',
    slashCommand: '/research:full-market-sweep',
    category: 'ultimate',
    needsInput: true,
    inputPlaceholder: 'Market or niche...',
  },
  {
    id: 'scout-d',
    name: 'Trend Jack',
    icon: '\u{1F525}',
    hotkey: 'D',
    cooldownMs: 45_000,
    description: 'Identify trending topics and draft trend-jacking content angles.',
    slashCommand: '/content:trend-jacking',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Platform or niche...',
  },
  {
    id: 'scout-f',
    name: 'Chan Digest',
    icon: '\u{1F4E8}',
    hotkey: 'F',
    cooldownMs: 60_000,
    description: 'Generate a digest summary of a Slack channel.',
    slashCommand: '/slack:channel-digest',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Channel name...',
  },
]

const SCOUT_PASSIVE: PassiveSkill = {
  id: 'scout-passive',
  name: 'Auto-Alert on Spikes',
  icon: '\u{1F6A8}',
  description: 'Automatically alerts when engagement spikes or competitor moves detected.',
  category: 'passive',
}

const ENGINEER_SKILLS: Skill[] = [
  {
    id: 'engineer-q',
    name: 'Create Skill',
    icon: '\u{1F527}',
    hotkey: 'Q',
    cooldownMs: 60_000,
    description: 'Create a new Claude Code skill from a description.',
    slashCommand: '/skills:create',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Skill name and purpose...',
  },
  {
    id: 'engineer-w',
    name: 'Build MCP',
    icon: '\u{2699}\u{FE0F}',
    hotkey: 'W',
    cooldownMs: 90_000,
    description: 'Scaffold and build a new MCP server connector.',
    slashCommand: '/mcp-builder',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Service to connect...',
  },
  {
    id: 'engineer-e',
    name: 'Test Skill',
    icon: '\u{1F9EA}',
    hotkey: 'E',
    cooldownMs: 45_000,
    description: 'Run tests and validation on a skill file.',
    slashCommand: '/skills:test',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Skill path or name...',
  },
  {
    id: 'engineer-r',
    name: 'Full Build',
    icon: '\u{1F3D7}\u{FE0F}',
    hotkey: 'R',
    cooldownMs: 600_000,
    description: 'Full product build pipeline: scaffold, build, test, package. Ultimate ability.',
    slashCommand: '/product:full-build',
    category: 'ultimate',
    needsInput: true,
    inputPlaceholder: 'Product name or manifest...',
  },
  {
    id: 'engineer-d',
    name: 'Package',
    icon: '\u{1F4E6}',
    hotkey: 'D',
    cooldownMs: 60_000,
    description: 'Package a skill or product into a distributable plugin ZIP.',
    slashCommand: '/skills:package',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Skill path...',
  },
  {
    id: 'engineer-f',
    name: 'Deploy',
    icon: '\u{1F680}',
    hotkey: 'F',
    cooldownMs: 90_000,
    description: 'Deploy the current project to Vercel.',
    slashCommand: '/deploy:vercel',
    category: 'combo',
  },
]

const ENGINEER_PASSIVE: PassiveSkill = {
  id: 'engineer-passive',
  name: 'Auto-Validate on Save',
  icon: '\u{1F6E1}\u{FE0F}',
  description: 'Automatically validates skill files and plugin structure on save.',
  category: 'passive',
}

const COMMANDER_SKILLS: Skill[] = [
  {
    id: 'commander-q',
    name: 'Briefing',
    icon: '\u{1F4CB}',
    hotkey: 'Q',
    cooldownMs: 60_000,
    description: 'Generate morning briefing: priorities, calendar, pending items.',
    slashCommand: '/morning-briefing',
    category: 'basic',
  },
  {
    id: 'commander-w',
    name: 'Queue',
    icon: '\u{1F4E5}',
    hotkey: 'W',
    cooldownMs: 45_000,
    description: 'Process the task queue: triage, assign, and prioritize.',
    slashCommand: '/queue:process',
    category: 'basic',
  },
  {
    id: 'commander-e',
    name: 'EOD Report',
    icon: '\u{1F4CA}',
    hotkey: 'E',
    cooldownMs: 60_000,
    description: 'Generate end-of-day report: completed, in-progress, blocked.',
    slashCommand: '/eod-report',
    category: 'basic',
  },
  {
    id: 'commander-r',
    name: 'Campaign',
    icon: '\u{1F451}',
    hotkey: 'R',
    cooldownMs: 600_000,
    description: 'Plan a full campaign: objectives, timelines, resource allocation. Ultimate ability.',
    slashCommand: '/campaign:plan',
    category: 'ultimate',
    needsInput: true,
    inputPlaceholder: 'Campaign name or goal...',
  },
  {
    id: 'commander-d',
    name: 'Broadcast',
    icon: '\u{1F4E2}',
    hotkey: 'D',
    cooldownMs: 30_000,
    description: 'Broadcast an order to all active units.',
    slashCommand: '/broadcast',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Order to broadcast...',
  },
  {
    id: 'commander-f',
    name: 'Assign Task',
    icon: '\u{1F4CC}',
    hotkey: 'F',
    cooldownMs: 30_000,
    description: 'Assign a specific task to a specific unit.',
    slashCommand: '/task:assign',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Task description...',
  },
]

const COMMANDER_PASSIVE: PassiveSkill = {
  id: 'commander-passive',
  name: 'Strategic Overview',
  icon: '\u{1F9ED}',
  description: 'Automatically tracks all unit progress and flags stalled tasks.',
  category: 'passive',
}

const DIPLOMAT_SKILLS: Skill[] = [
  {
    id: 'diplomat-q',
    name: 'Prep Call',
    icon: '\u{1F4DE}',
    hotkey: 'Q',
    cooldownMs: 60_000,
    description: 'Generate a call prep brief: prospect info, talking points, objections.',
    slashCommand: '/sales:prep-call',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Prospect name or company...',
  },
  {
    id: 'diplomat-w',
    name: 'Analyze Calls',
    icon: '\u{1F50E}',
    hotkey: 'W',
    cooldownMs: 90_000,
    description: 'Analyze recent call transcripts for patterns and follow-ups.',
    slashCommand: '/sales:analyze-calls',
    category: 'basic',
  },
  {
    id: 'diplomat-e',
    name: 'Response',
    icon: '\u{1F4AC}',
    hotkey: 'E',
    cooldownMs: 30_000,
    description: 'Draft a customer response email or message.',
    slashCommand: '/support:customer-response',
    category: 'basic',
    needsInput: true,
    inputPlaceholder: 'Context or customer name...',
  },
  {
    id: 'diplomat-r',
    name: 'Pipeline',
    icon: '\u{1F4B0}',
    hotkey: 'R',
    cooldownMs: 600_000,
    description: 'Full pipeline review: stages, blockers, revenue forecast. Ultimate ability.',
    slashCommand: '/sales:pipeline-review',
    category: 'ultimate',
  },
  {
    id: 'diplomat-d',
    name: 'Meeting Prep',
    icon: '\u{1F4C5}',
    hotkey: 'D',
    cooldownMs: 60_000,
    description: 'Prepare meeting agenda, context docs, and pre-read summaries.',
    slashCommand: '/meeting:prep',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Meeting name or participants...',
  },
  {
    id: 'diplomat-f',
    name: 'Proposal',
    icon: '\u{1F4C4}',
    hotkey: 'F',
    cooldownMs: 90_000,
    description: 'Draft a client proposal with scope, pricing, and timeline.',
    slashCommand: '/sales:draft-proposal',
    category: 'combo',
    needsInput: true,
    inputPlaceholder: 'Client name or scope...',
  },
]

const DIPLOMAT_PASSIVE: PassiveSkill = {
  id: 'diplomat-passive',
  name: 'Auto-Flag Stale Leads',
  icon: '\u{1F6A9}',
  description: 'Automatically flags leads that have gone cold for 7+ days.',
  category: 'passive',
}

// ============================================================================
// Loadout Registry
// ============================================================================

const LOADOUTS: Record<UnitType, UnitLoadout> = {
  writer: {
    unitType: 'writer',
    label: 'Writer',
    skills: WRITER_SKILLS,
    passive: WRITER_PASSIVE,
  },
  scout: {
    unitType: 'scout',
    label: 'Scout',
    skills: SCOUT_SKILLS,
    passive: SCOUT_PASSIVE,
  },
  engineer: {
    unitType: 'engineer',
    label: 'Engineer',
    skills: ENGINEER_SKILLS,
    passive: ENGINEER_PASSIVE,
  },
  commander: {
    unitType: 'commander',
    label: 'Commander',
    skills: COMMANDER_SKILLS,
    passive: COMMANDER_PASSIVE,
  },
  diplomat: {
    unitType: 'diplomat',
    label: 'Diplomat',
    skills: DIPLOMAT_SKILLS,
    passive: DIPLOMAT_PASSIVE,
  },
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the full loadout (skills + passive) for a unit type.
 */
export function getLoadoutForUnit(unitType: UnitType): UnitLoadout {
  return LOADOUTS[unitType] || LOADOUTS.writer
}

/**
 * Get just the active skills (Q/W/E/R/D/F) for a unit type.
 */
export function getSkillsForUnit(unitType: UnitType): Skill[] {
  return (LOADOUTS[unitType] || LOADOUTS.writer).skills
}

/**
 * Get a specific skill by its ID.
 */
export function getSkillById(skillId: string): Skill | undefined {
  for (const loadout of Object.values(LOADOUTS)) {
    const found = loadout.skills.find(s => s.id === skillId)
    if (found) return found
  }
  return undefined
}

/**
 * Get the skill bound to a specific hotkey for a unit type.
 */
export function getSkillByHotkey(unitType: UnitType, hotkey: Hotkey): Skill | undefined {
  const skills = getSkillsForUnit(unitType)
  return skills.find(s => s.hotkey === hotkey)
}

/**
 * Infer unit type from session name heuristics.
 * Falls back to 'commander' if no match.
 */
export function inferUnitType(sessionName: string): UnitType {
  const lower = sessionName.toLowerCase()

  if (/writer|content|copy|blog|post|newsletter/.test(lower)) return 'writer'
  if (/scout|research|recon|intel|analytics|trend/.test(lower)) return 'scout'
  if (/engineer|build|dev|code|deploy|skill|mcp/.test(lower)) return 'engineer'
  if (/diplomat|sales|proposal|call|client|deal/.test(lower)) return 'diplomat'
  if (/commander|command|ceo|ops|lead|manager|boss/.test(lower)) return 'commander'

  // Default: commander (CEO agent is the most common)
  return 'commander'
}

/** All valid hotkeys in order */
export const HOTKEY_ORDER: Hotkey[] = ['Q', 'W', 'E', 'R', 'D', 'F']

/** All unit types */
export const ALL_UNIT_TYPES: UnitType[] = ['writer', 'scout', 'engineer', 'commander', 'diplomat']
