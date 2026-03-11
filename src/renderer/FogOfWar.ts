import {
  Application,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
} from 'pixi.js';

// World dimensions — mirrors constants.ts defaults; override via init()
const DEFAULT_WORLD_WIDTH = 4096;
const DEFAULT_WORLD_HEIGHT = 4096;

// Visibility circle radius in world units
const VISIBILITY_RADIUS = 300;

// Fog opacity levels
const DARK_OPACITY = 0.85;
const STALE_OPACITY = 0.40;

// Time thresholds (milliseconds)
const STALE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 min
const DARK_THRESHOLD_MS  = 5 * 60 * 1000;   // 5 min

// Regrowth durations (milliseconds)
const REGROWTH_CLEAR_TO_STALE_MS = 2 * 60 * 1000;  // 0→stale over 2 min
const REGROWTH_STALE_TO_DARK_MS  = 3 * 60 * 1000;  // stale→dark over 3 min

// Radar sweep duration (ms)
const RADAR_SWEEP_MS = 1500;

// Territory type multipliers for fog regrowth speed
const REGROWTH_MULTIPLIERS: Record<string, number> = {
  support: 1.5,
  hq: 0.5,
};

interface UnitPosition {
  x: number;
  y: number;
}

interface TerritoryState {
  fogState: string; // 'visible' | 'stale' | 'dark'
}

interface RadarSweep {
  x: number;
  y: number;
  startTime: number;
}

interface AreaRecord {
  /** Key encoding for quick lookup, e.g. "x:y" bucket */
  key: string;
  lastUnitTime: number;
  /** If null, fog has not started regrowing yet */
  regrowthStartTime: number | null;
  territoryType: string;
  /** Computed opacity 0..DARK_OPACITY */
  currentOpacity: number;
  /** Whether any unit was here in this frame */
  hasUnit: boolean;
}

/**
 * FogOfWar — PixiJS v8 fog-of-war system using RenderTexture compositing.
 *
 * Three states per zone:
 *   visible  — units present: fully clear
 *   stale    — 2–5 min since last unit: 40% dark overlay
 *   dark     — 5+ min or never visited: 85% dark overlay
 *
 * Also drives radar-sweep animations when units enter dark zones.
 */
export class FogOfWar {
  private app: Application;
  private fogLayer: Container | null = null;
  private worldW: number = DEFAULT_WORLD_WIDTH;
  private worldH: number = DEFAULT_WORLD_HEIGHT;

  /** The sprite that carries the rendered fog texture onto the stage */
  private fogSprite: Sprite | null = null;

  /** RenderTexture we composite the fog into each frame */
  private fogTexture: RenderTexture | null = null;

  /** Scratch Graphics drawn each frame to build the fog composite */
  private fogGraphics: Graphics | null = null;

  /** Active radar sweeps */
  private radarSweeps: RadarSweep[] = [];

  /** Area records keyed by grid-bucket string */
  private areaRecords: Map<string, AreaRecord> = new Map();

  /** Grid cell size in world units — we track fog per cell */
  private readonly GRID_SIZE = VISIBILITY_RADIUS;

  /** Unit positions seen in the previous frame (to detect entering dark zones) */
  private prevUnitBuckets: Set<string> = new Set();

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Must be called once before update().
   * @param fogLayer  Container on the scene graph that hosts the fog sprite
   * @param worldW    World width in pixels
   * @param worldH    World height in pixels
   */
  init(fogLayer: Container, worldW: number, worldH: number): void {
    this.fogLayer = fogLayer;
    this.worldW   = worldW;
    this.worldH   = worldH;

    // Create the RenderTexture that holds the composited fog
    this.fogTexture = RenderTexture.create({ width: worldW, height: worldH });

    // Sprite that paints the fog texture over the world
    this.fogSprite = new Sprite(this.fogTexture);
    this.fogSprite.alpha = 1;
    this.fogLayer.addChild(this.fogSprite);

    // Scratch graphics — reused every frame, never added to scene graph
    this.fogGraphics = new Graphics();
  }

  /**
   * Call every frame from the main render loop.
   * @param unitPositions   World-space positions of all visible/known units
   * @param territoryStates Map of territory ID → { fogState } for territory-level overrides
   */
  update(
    unitPositions: UnitPosition[],
    territoryStates: Map<string, TerritoryState>,
  ): void {
    if (!this.fogTexture || !this.fogGraphics || !this.fogLayer) return;

    const now = Date.now();

    // --- 1. Determine which grid buckets have units this frame ---
    const currentBuckets = new Set<string>();
    for (const pos of unitPositions) {
      const key = this._bucketKey(pos.x, pos.y);
      currentBuckets.add(key);
    }

    // --- 2. Detect units entering previously-dark buckets → start radar sweep ---
    for (const key of currentBuckets) {
      if (!this.prevUnitBuckets.has(key)) {
        const record = this.areaRecords.get(key);
        const wasDark = !record || record.currentOpacity > STALE_OPACITY;
        if (wasDark) {
          const [bx, by] = this._bucketCenter(key);
          this.radarSweeps.push({ x: bx, y: by, startTime: now });
        }
      }
    }
    this.prevUnitBuckets = currentBuckets;

    // --- 3. Update area records ---
    // Mark units present
    for (const record of this.areaRecords.values()) {
      record.hasUnit = false;
    }
    for (const key of currentBuckets) {
      if (!this.areaRecords.has(key)) {
        // First time visiting this bucket — spawn as dark or with territory override
        this.areaRecords.set(key, {
          key,
          lastUnitTime: now,
          regrowthStartTime: null,
          territoryType: 'default',
          currentOpacity: 0,
          hasUnit: true,
        });
      } else {
        const r = this.areaRecords.get(key)!;
        r.lastUnitTime = now;
        r.regrowthStartTime = null; // reset regrowth when unit returns
        r.currentOpacity = 0;       // instantly clear
        r.hasUnit = true;
      }
    }

    // Patch territory types from territoryStates if provided
    for (const [territoryId, state] of territoryStates) {
      // territoryId may encode a bucket key or territory name
      // Apply type info where we can match
      const record = this.areaRecords.get(territoryId);
      if (record) {
        record.territoryType = state.fogState === 'visible' ? 'hq' : 'default';
      }
    }

    // Update opacity for all buckets that no longer have units
    for (const record of this.areaRecords.values()) {
      if (record.hasUnit) continue;

      const elapsed = now - record.lastUnitTime;

      if (elapsed < STALE_THRESHOLD_MS) {
        // Still in clear window — keep opacity 0
        record.regrowthStartTime = null;
        record.currentOpacity = 0;
        continue;
      }

      // Start regrowth timer on first frame after stale threshold
      if (record.regrowthStartTime === null) {
        record.regrowthStartTime = record.lastUnitTime + STALE_THRESHOLD_MS;
      }

      const multiplier = REGROWTH_MULTIPLIERS[record.territoryType] ?? 1.0;
      const regrowthElapsed = (now - record.regrowthStartTime) * multiplier;

      if (regrowthElapsed < REGROWTH_CLEAR_TO_STALE_MS) {
        // Growing from clear (0) to stale (40%)
        const t = regrowthElapsed / REGROWTH_CLEAR_TO_STALE_MS;
        record.currentOpacity = t * STALE_OPACITY;
      } else if (regrowthElapsed < REGROWTH_CLEAR_TO_STALE_MS + REGROWTH_STALE_TO_DARK_MS) {
        // Growing from stale (40%) to dark (85%)
        const t = (regrowthElapsed - REGROWTH_CLEAR_TO_STALE_MS) / REGROWTH_STALE_TO_DARK_MS;
        record.currentOpacity = STALE_OPACITY + t * (DARK_OPACITY - STALE_OPACITY);
      } else {
        record.currentOpacity = DARK_OPACITY;
      }
    }

    // --- 4. Composite the fog texture ---
    this._renderFogTexture(unitPositions, now);

    // --- 5. Prune expired radar sweeps ---
    this.radarSweeps = this.radarSweeps.filter(
      (s) => now - s.startTime < RADAR_SWEEP_MS,
    );
  }

  /** Build and render the fog composite into fogTexture each frame */
  private _renderFogTexture(unitPositions: UnitPosition[], now: number): void {
    const g = this.fogGraphics!;
    g.clear();

    // ── Strategy: draw dark base, then .cut() circles at unit positions ──
    // PixiJS v8 Graphics .cut() punches transparent holes in all previous
    // geometry on the same Graphics object — this is the correct way to
    // create "erase" regions without blend-mode hacks.

    // Step 1: Draw per-bucket fog rects at their computed opacity.
    // We tile the world in buckets. Buckets with area records use their
    // computed opacity; unknown regions get full darkness.
    const cols = Math.ceil(this.worldW / this.GRID_SIZE);
    const rows = Math.ceil(this.worldH / this.GRID_SIZE);

    for (let bx = 0; bx < cols; bx++) {
      for (let by = 0; by < rows; by++) {
        const key = `${bx}:${by}`;
        const record = this.areaRecords.get(key);
        const opacity = record ? record.currentOpacity : DARK_OPACITY;

        if (opacity > 0.01) {
          const x = bx * this.GRID_SIZE;
          const y = by * this.GRID_SIZE;
          g.rect(x, y, this.GRID_SIZE, this.GRID_SIZE)
            .fill({ color: 0x000000, alpha: opacity });
        }
      }
    }

    // Step 2: Cut clear circles at unit positions using .cut()
    // .cut() removes the shape from all previously drawn geometry
    for (const pos of unitPositions) {
      g.circle(pos.x, pos.y, VISIBILITY_RADIUS).cut();
    }

    // Step 3: Radar sweep arcs (drawn as additive green rings — on top of fog)
    // These are separate Graphics since they should render ON TOP of the fog,
    // not get cut. We draw them into a separate pass.
    // For simplicity, draw them into the same graphics — they'll appear
    // over the fogged areas which is the desired effect.
    for (const sweep of this.radarSweeps) {
      const elapsed = now - sweep.startTime;
      const t = elapsed / RADAR_SWEEP_MS; // 0..1
      const radius = t * VISIBILITY_RADIUS;
      const sweepAlpha = (1 - t) * 0.6; // fades out as it expands

      g.circle(sweep.x, sweep.y, radius).stroke({
        color: 0x00ff88,
        alpha: sweepAlpha,
        width: 3,
      });
    }

    // Render the scratch graphics into the fog RenderTexture
    this.app.renderer.render({
      container: g,
      target: this.fogTexture!,
      clear: true,
    });
  }

  /** Convert world position to a bucket key string */
  private _bucketKey(x: number, y: number): string {
    const bx = Math.floor(x / this.GRID_SIZE);
    const by = Math.floor(y / this.GRID_SIZE);
    return `${bx}:${by}`;
  }

  /** Compute the world-center of a bucket from its key */
  private _bucketCenter(key: string): [number, number] {
    const [bxStr, byStr] = key.split(':');
    const bx = parseInt(bxStr, 10);
    const by = parseInt(byStr, 10);
    return [
      (bx + 0.5) * this.GRID_SIZE,
      (by + 0.5) * this.GRID_SIZE,
    ];
  }

  /** Clean up all PixiJS resources */
  destroy(): void {
    if (this.fogSprite) {
      this.fogSprite.destroy();
      this.fogSprite = null;
    }
    if (this.fogTexture) {
      this.fogTexture.destroy(true);
      this.fogTexture = null;
    }
    if (this.fogGraphics) {
      this.fogGraphics.destroy();
      this.fogGraphics = null;
    }
    this.fogLayer = null;
    this.areaRecords.clear();
    this.radarSweeps = [];
    this.prevUnitBuckets.clear();
  }
}
