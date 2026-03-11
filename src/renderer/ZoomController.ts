/**
 * ZoomController - Semantic zoom tier system
 *
 * Three zoom tiers control what information is visible at each altitude:
 * - strategic (zoom < 0.3): Territory overview — labels + aggregate counts, no unit chrome
 * - tactical (0.3 <= zoom < 0.8): Units with names and status rings, no tool text
 * - detail (zoom >= 0.8): Full unit chrome — health bars, tool text, model labels
 */

export type ZoomTier = 'strategic' | 'tactical' | 'detail'

export interface ZoomVisibility {
  showUnitDetails: boolean
  showHealthBars: boolean
  showToolText: boolean
  showModelLabels: boolean
  showTerritoryLabels: boolean
  showUnitCounts: boolean
}

const STRATEGIC_BREAKPOINT = 0.3
const TACTICAL_BREAKPOINT = 0.8

export function getZoomTier(zoom: number): ZoomTier {
  if (zoom < STRATEGIC_BREAKPOINT) return 'strategic'
  if (zoom < TACTICAL_BREAKPOINT) return 'tactical'
  return 'detail'
}

export function getZoomVisibility(zoom: number): ZoomVisibility {
  const tier = getZoomTier(zoom)

  switch (tier) {
    case 'strategic':
      return {
        showUnitDetails: false,
        showHealthBars: false,
        showToolText: false,
        showModelLabels: false,
        showTerritoryLabels: true,
        showUnitCounts: true,
      }
    case 'tactical':
      return {
        showUnitDetails: true,
        showHealthBars: true,
        showToolText: false,
        showModelLabels: false,
        showTerritoryLabels: true,
        showUnitCounts: false,
      }
    case 'detail':
      return {
        showUnitDetails: true,
        showHealthBars: true,
        showToolText: true,
        showModelLabels: true,
        showTerritoryLabels: false,
        showUnitCounts: false,
      }
  }
}
