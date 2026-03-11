/**
 * FogRenderer - Placeholder (fog disabled)
 *
 * Fog of war is disabled until we implement proper RenderTexture-based
 * fog with visible/stale/dark states per the Phase 1 PRD.
 * This stub satisfies the interface so nothing breaks.
 */

import { Container } from 'pixi.js'

export class FogRenderer {
  constructor(_layer: Container, _worldWidth: number, _worldHeight: number) {}
  update(_unitPositions: { x: number; y: number }[]): void {}
}
