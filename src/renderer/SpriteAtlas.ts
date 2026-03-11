/**
 * SpriteAtlas - Loads SVG sprite sheets as PixiJS textures and provides
 * sub-texture accessors for territory shields, status indicators, unit badges,
 * and resource icons.
 *
 * Usage:
 *   await SpriteAtlas.init()
 *   const tex = SpriteAtlas.getUnitBadge('command')
 */

import { Assets, Texture, Rectangle } from 'pixi.js'
import {
  territoryShieldsUrl,
  statusIndicatorsUrl,
  unitBadgesUrl,
  resourceIconsUrl,
  TERRITORY_SHIELD_OFFSETS,
  STATUS_INDICATOR_OFFSETS,
  UNIT_BADGE_OFFSETS,
  RESOURCE_ICON_OFFSETS,
} from '../assets/index'
import type { TerritoryId } from './TerrainRenderer'
import type { UnitStatus, UnitClass } from './UnitRenderer'

type FrameRect = { x: number; y: number; w: number; h: number }

let territorySheetTexture: Texture | null = null
let statusSheetTexture: Texture | null = null
let badgeSheetTexture: Texture | null = null
let resourceSheetTexture: Texture | null = null

let initialized = false

// Cached sub-textures
const territoryCache = new Map<string, Texture>()
const statusCache = new Map<string, Texture>()
const badgeCache = new Map<string, Texture>()
const resourceCache = new Map<string, Texture>()

function subTexture(sheet: Texture, frame: FrameRect): Texture {
  return new Texture({
    source: sheet.source,
    frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
  })
}

export const SpriteAtlas = {
  async init(): Promise<void> {
    if (initialized) return

    const [tShields, sIndicators, uBadges, rIcons] = await Promise.all([
      Assets.load(territoryShieldsUrl),
      Assets.load(statusIndicatorsUrl),
      Assets.load(unitBadgesUrl),
      Assets.load(resourceIconsUrl),
    ])

    territorySheetTexture = tShields as Texture
    statusSheetTexture = sIndicators as Texture
    badgeSheetTexture = uBadges as Texture
    resourceSheetTexture = rIcons as Texture

    initialized = true
  },

  get isReady(): boolean {
    return initialized
  },

  getTerritoryShield(territory: TerritoryId): Texture {
    if (!territorySheetTexture) return Texture.EMPTY
    const cached = territoryCache.get(territory)
    if (cached) return cached

    const frame = TERRITORY_SHIELD_OFFSETS[territory]
    if (!frame) return Texture.EMPTY

    const tex = subTexture(territorySheetTexture, frame)
    territoryCache.set(territory, tex)
    return tex
  },

  getStatusIndicator(status: UnitStatus): Texture {
    if (!statusSheetTexture) return Texture.EMPTY
    const cached = statusCache.get(status)
    if (cached) return cached

    const frame = STATUS_INDICATOR_OFFSETS[status]
    if (!frame) return Texture.EMPTY

    const tex = subTexture(statusSheetTexture, frame)
    statusCache.set(status, tex)
    return tex
  },

  getUnitBadge(unitClass: UnitClass): Texture {
    if (!badgeSheetTexture) return Texture.EMPTY
    const cached = badgeCache.get(unitClass)
    if (cached) return cached

    const frame = UNIT_BADGE_OFFSETS[unitClass]
    if (!frame) return Texture.EMPTY

    const tex = subTexture(badgeSheetTexture, frame)
    badgeCache.set(unitClass, tex)
    return tex
  },

  getResourceIcon(type: string): Texture {
    if (!resourceSheetTexture) return Texture.EMPTY
    const cached = resourceCache.get(type)
    if (cached) return cached

    const frame = RESOURCE_ICON_OFFSETS[type]
    if (!frame) return Texture.EMPTY

    const tex = subTexture(resourceSheetTexture, frame)
    resourceCache.set(type, tex)
    return tex
  },
}
