/**
 * Enemy Taxonomy — 7 Threat Classes
 *
 * Each business threat has a distinct visual identity on the battlefield.
 * Colors, shapes, and labels let you instantly read what's hitting you.
 *
 * Reference: prd/02b-enemy-system-spec.md § 2.1
 */

export type ThreatClass =
  | 'churn'
  | 'support_spike'
  | 'revenue_drop'
  | 'deadline'
  | 'competitor'
  | 'tech_debt'
  | 'burnout'

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ThreatClassConfig {
  name: string
  color: number
  borderColor: number
  icon: string
  description: string
  severity: ThreatSeverity
}

export const THREAT_CLASS_CONFIGS: Record<ThreatClass, ThreatClassConfig> = {
  churn: {
    name: 'Churn',
    color: 0xCC3333,
    borderColor: 0x991111,
    icon: '💀',
    description: 'Customer leaving',
    severity: 'critical',
  },
  support_spike: {
    name: 'Support Spike',
    color: 0xE8682A,
    borderColor: 0xB84A15,
    icon: '🔥',
    description: 'Support volume surge',
    severity: 'high',
  },
  revenue_drop: {
    name: 'Revenue Drop',
    color: 0x8B0000,
    borderColor: 0x5C0000,
    icon: '📉',
    description: 'Revenue decline',
    severity: 'critical',
  },
  deadline: {
    name: 'Deadline',
    color: 0xFFB86C,
    borderColor: 0xCC8A3A,
    icon: '⏳',
    description: 'Approaching deadline',
    severity: 'medium',
  },
  competitor: {
    name: 'Competitor',
    color: 0x6A0DAD,
    borderColor: 0x48097A,
    icon: '⚔️',
    description: 'Competitive threat',
    severity: 'high',
  },
  tech_debt: {
    name: 'Tech Debt',
    color: 0x4A6B8A,
    borderColor: 0x334D66,
    icon: '🔧',
    description: 'Technical debt',
    severity: 'low',
  },
  burnout: {
    name: 'Burnout',
    color: 0x8B7355,
    borderColor: 0x6B5640,
    icon: '😤',
    description: 'Team burnout risk',
    severity: 'medium',
  },
}

/**
 * Shape drawn per severity level:
 *   low      → small circle
 *   medium   → triangle
 *   high     → diamond
 *   critical → star (skull-like 6-point)
 */
export type SeverityShape = 'circle' | 'triangle' | 'diamond' | 'star'

export const SEVERITY_SHAPE: Record<ThreatSeverity, SeverityShape> = {
  low: 'circle',
  medium: 'triangle',
  high: 'diamond',
  critical: 'star',
}
