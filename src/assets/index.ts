// SVG Asset Imports (Vite ?url pattern)
import territoryShieldsUrl from './territory-shields.svg?url';
import statusIndicatorsUrl from './status-indicators.svg?url';
import unitBadgesUrl from './unit-badges.svg?url';
import resourceIconsUrl from './resource-icons.svg?url';

export {
  territoryShieldsUrl,
  statusIndicatorsUrl,
  unitBadgesUrl,
  resourceIconsUrl,
};

// Territory shield IDs for sprite lookup
export const TERRITORY_SHIELD_IDS = {
  'lead-gen': 'shield-lead-gen',
  content: 'shield-content',
  sales: 'shield-sales',
  fulfillment: 'shield-fulfillment',
  support: 'shield-support',
  retention: 'shield-retention',
  hq: 'shield-hq',
} as const;

// Status indicator IDs
export const STATUS_INDICATOR_IDS = {
  idle: 'status-idle',
  working: 'status-working',
  thinking: 'status-thinking',
  offline: 'status-offline',
} as const;

// Unit badge IDs
export const UNIT_BADGE_IDS = {
  command: 'badge-command',
  operations: 'badge-operations',
  recon: 'badge-recon',
} as const;

// Resource icon IDs
export const RESOURCE_ICON_IDS = {
  tokens: 'icon-tokens',
  compute: 'icon-compute',
  intel: 'icon-intel',
  morale: 'icon-morale',
  bandwidth: 'icon-bandwidth',
  storage: 'icon-storage',
} as const;

// Sprite positions (for programmatic access to sprite sheet regions)
export const TERRITORY_SHIELD_OFFSETS: Record<string, { x: number; y: number; w: number; h: number }> = {
  'lead-gen': { x: 0, y: 0, w: 64, h: 64 },
  content: { x: 64, y: 0, w: 64, h: 64 },
  sales: { x: 128, y: 0, w: 64, h: 64 },
  fulfillment: { x: 192, y: 0, w: 64, h: 64 },
  support: { x: 256, y: 0, w: 64, h: 64 },
  retention: { x: 320, y: 0, w: 64, h: 64 },
  hq: { x: 384, y: 0, w: 64, h: 64 },
};

export const STATUS_INDICATOR_OFFSETS: Record<string, { x: number; y: number; w: number; h: number }> = {
  idle: { x: 0, y: 0, w: 32, h: 32 },
  working: { x: 32, y: 0, w: 32, h: 32 },
  thinking: { x: 64, y: 0, w: 32, h: 32 },
  offline: { x: 96, y: 0, w: 32, h: 32 },
};

export const UNIT_BADGE_OFFSETS: Record<string, { x: number; y: number; w: number; h: number }> = {
  command: { x: 0, y: 0, w: 32, h: 32 },
  operations: { x: 32, y: 0, w: 32, h: 32 },
  recon: { x: 64, y: 0, w: 32, h: 32 },
};

export const RESOURCE_ICON_OFFSETS: Record<string, { x: number; y: number; w: number; h: number }> = {
  tokens: { x: 0, y: 0, w: 32, h: 32 },
  compute: { x: 32, y: 0, w: 32, h: 32 },
  intel: { x: 64, y: 0, w: 32, h: 32 },
  morale: { x: 96, y: 0, w: 32, h: 32 },
  bandwidth: { x: 128, y: 0, w: 32, h: 32 },
  storage: { x: 160, y: 0, w: 32, h: 32 },
};
