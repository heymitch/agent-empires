import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants';

// ─── Territory ID type ────────────────────────────────────────────────────────
export type TerritoryId = 'lead-gen' | 'content' | 'sales' | 'fulfillment' | 'support' | 'retention' | 'hq';

// ─── Territory state ──────────────────────────────────────────────────────────
interface TerritoryVisualState {
  fogState: string;
  threatLevel: string;
  unitCount: number;
  activityCount: number;
}

// ─── Territory definition ─────────────────────────────────────────────────────
interface TerritoryDef {
  id: TerritoryId;
  label: string;
  polygon: number[];   // flat [x,y,x,y,...] in world coords
  center: [number, number];
  baseColor: number;
}

// ─── Magnetic Residue palette ─────────────────────────────────────────────────
const PAL = {
  deep:       0x16120E,   // background, gap between territories
  surface:    0x1A1510,   // territory base fill
  cream:      0xF0E4D0,   // labels, bright accents
  creamDim:   0xB4A690,   // secondary text / label default
  creamFaint: 0x6E604E,   // noise field lines, subtle borders
  orange:     0xE8682A,   // active borders, threat accents
  teal:       0x4A9DB8,   // operations / working indicators
  phosphor:   0x82C896,   // flow lines (healthy / online)
  amber:      0xFFB86C,   // command / gold
  border:     0x2A2118,   // default territory border
} as const;

// ─── Inline Simplex Noise (2D, no external deps) ──────────────────────────────
const _perm = new Uint8Array(512);
const _permMod12 = new Uint8Array(512);
(function initPerm() {
  const seed = new Uint8Array(256);
  for (let i = 0; i < 256; i++) seed[i] = i;
  let s = 42;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = ((s >>> 0) % (i + 1));
    const tmp = seed[i]; seed[i] = seed[j]; seed[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    _perm[i] = seed[i & 255];
    _permMod12[i] = _perm[i] % 12;
  }
})();

const _grad3: number[][] = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

function _dot2(g: number[], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

function simplex2(xin: number, yin: number): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t, Y0 = j - t;
  const x0 = xin - X0, y0 = yin - Y0;
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const gi0 = _permMod12[ii + _perm[jj]];
  const gi1 = _permMod12[ii + i1 + _perm[jj + j1]];
  const gi2 = _permMod12[ii + 1 + _perm[jj + 1]];
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0*x0 - y0*y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * _dot2(_grad3[gi0], x0, y0); }
  let t1 = 0.5 - x1*x1 - y1*y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * _dot2(_grad3[gi1], x1, y1); }
  let t2 = 0.5 - x2*x2 - y2*y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * _dot2(_grad3[gi2], x2, y2); }
  return 70 * (n0 + n1 + n2);
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function brighten(hex: number, factor: number): number {
  const r = Math.min(255, ((hex >> 16) & 0xff) * factor);
  const g = Math.min(255, ((hex >> 8) & 0xff) * factor);
  const b = Math.min(255, (hex & 0xff) * factor);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// ─── Point-in-polygon (ray casting) ──────────────────────────────────────────
function pointInPoly(px: number, py: number, poly: number[]): boolean {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1];
    const xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── Organic territory polygon definitions ────────────────────────────────────
// Hand-crafted irregular shapes that tile the full 4000x3000 world with
// minimal gaps — like a weathered military map divided into sectors.
const TERRITORY_DEFS: TerritoryDef[] = [
  {
    id: 'hq',
    label: 'HQ',
    polygon: [1600,1100, 1850,950, 2150,950, 2400,1100, 2350,1450, 2100,1550, 1900,1550, 1650,1450],
    center: [2000, 1250],
    baseColor: 0x2E2820,  // warm brown — command center
  },
  {
    id: 'lead-gen',
    label: 'LEAD GEN',
    polygon: [200,50, 1200,50, 1500,200, 1600,500, 1400,700, 800,750, 300,600, 100,350],
    center: [850, 380],
    baseColor: 0x253020,  // green-tinted — growth
  },
  {
    id: 'sales',
    label: 'SALES',
    polygon: [1500,200, 2500,50, 3200,50, 3400,300, 3300,650, 2800,750, 2150,700, 1600,500],
    center: [2500, 380],
    baseColor: 0x322518,  // orange-tinted — revenue
  },
  {
    id: 'content',
    label: 'CONTENT',
    polygon: [100,350, 300,600, 800,750, 1400,700, 1600,1100, 1650,1450, 1200,1600, 600,1500, 100,1200],
    center: [750, 1050],
    baseColor: 0x1E2A30,  // teal-tinted — creative
  },
  {
    id: 'fulfillment',
    label: 'FULFILLMENT',
    polygon: [2800,750, 3300,650, 3400,300, 3800,200, 3950,500, 3900,1100, 3600,1500, 3000,1550, 2400,1100, 2150,700],
    center: [3200, 950],
    baseColor: 0x302A1C,  // amber-tinted — delivery
  },
  {
    id: 'support',
    label: 'SUPPORT',
    polygon: [600,1500, 1200,1600, 1650,1450, 1900,1550, 2100,1550, 1900,1900, 1500,2200, 900,2300, 400,2100, 200,1800],
    center: [1100, 1850],
    baseColor: 0x301E20,  // red-tinted — urgency
  },
  {
    id: 'retention',
    label: 'RETENTION',
    polygon: [2100,1550, 2350,1450, 3000,1550, 3600,1500, 3800,1800, 3600,2200, 3000,2500, 2200,2400, 1900,1900],
    center: [2850, 1950],
    baseColor: 0x261E30,  // purple-tinted — loyalty
  },
];

// ─── Render constants ─────────────────────────────────────────────────────────
const NOISE_LINE_COUNT = 24;
const NOISE_SCALE = 0.003;   // adjusted for world-scale polygons
const FLOW_LINE_COUNT = 8;
const FLOW_DRIFT_AMP = 60;   // wider drift for bigger territories

// ─── TerrainRenderer ──────────────────────────────────────────────────────────
export class TerrainRenderer {
  private app: Application;
  private container: Container;

  private terrainContainers: Map<TerritoryId, Container> = new Map();
  private fillGraphics:    Map<TerritoryId, Graphics>   = new Map();
  private noiseGraphics:   Map<TerritoryId, Graphics>   = new Map();
  private borderGraphics:  Map<TerritoryId, Graphics>   = new Map();
  private flowGraphics:    Map<TerritoryId, Graphics>   = new Map();
  private labelTexts:      Map<TerritoryId, Text>       = new Map();

  private states: Map<TerritoryId, TerritoryVisualState> = new Map();
  private elapsed = 0;

  private pulseOffsets: Map<TerritoryId, number> = new Map();
  private flowOffsets:  Map<TerritoryId, number> = new Map();

  // Activity glow — pulsing border glow when units are working inside
  private activityLevels: Map<TerritoryId, number> = new Map();
  private glowGraphics:   Map<TerritoryId, Graphics> = new Map();

  constructor(app: Application, parent?: Container) {
    this.app = app;
    this.container = new Container();
    if (parent) {
      parent.addChild(this.container);
    } else {
      app.stage.addChild(this.container);
    }

    for (const def of TERRITORY_DEFS) {
      this.states.set(def.id, {
        fogState: 'visible',
        threatLevel: 'none',
        unitCount: 0,
        activityCount: 0,
      });
      this.pulseOffsets.set(def.id, Math.random() * Math.PI * 2);
      this.flowOffsets.set(def.id, Math.random() * 1000);
    }

    this._buildSceneGraph();
    this._bakeNoiseTextures();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Return world-space center of a territory. */
  getTerritoryCenter(id: TerritoryId): { x: number; y: number } {
    const def = TERRITORY_DEFS.find(d => d.id === id);
    if (!def) return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    return { x: def.center[0], y: def.center[1] };
  }

  /** Get base color for a territory. */
  getTerritoryColor(id: TerritoryId): number {
    const def = TERRITORY_DEFS.find(d => d.id === id);
    return def ? def.baseColor : PAL.surface;
  }

  /** Get all territory definitions. */
  getAllTerritories(): TerritoryDef[] {
    return TERRITORY_DEFS;
  }

  /** Hit-test a world-space point against territory polygons. Returns the territory ID or null. */
  hitTestTerritory(worldX: number, worldY: number): TerritoryId | null {
    for (const def of TERRITORY_DEFS) {
      if (pointInPoly(worldX, worldY, def.polygon)) {
        return def.id;
      }
    }
    return null;
  }

  /**
   * Set activity level for territory border glow.
   * 0 = no activity, 1 = low (1-2 units), 2 = medium (3-5), 3 = high (6+)
   */
  setTerritoryActivity(territory: TerritoryId, level: number): void {
    this.activityLevels.set(territory, Math.max(0, Math.min(3, level)));
  }

  /** Update reactive state for a territory. */
  updateTerritoryState(
    id: TerritoryId,
    state: { fogState: string; threatLevel: string; unitCount: number; activityCount: number }
  ): void {
    this.states.set(id, { ...state });
  }

  /** Call once per frame with delta time in seconds. */
  draw(dt: number = 0): void {
    this.elapsed += dt;

    for (const def of TERRITORY_DEFS) {
      const state = this.states.get(def.id) ?? {
        fogState: 'visible', threatLevel: 'none', unitCount: 0, activityCount: 0,
      };
      this._drawTerritory(def, state);
    }
  }

  // ── Private scene graph ─────────────────────────────────────────────────────

  private _buildSceneGraph(): void {
    for (const def of TERRITORY_DEFS) {
      const tc = new Container();
      this.container.addChild(tc);
      this.terrainContainers.set(def.id, tc);

      const fill = new Graphics();
      tc.addChild(fill);
      this.fillGraphics.set(def.id, fill);

      const noise = new Graphics();
      tc.addChild(noise);
      this.noiseGraphics.set(def.id, noise);

      const border = new Graphics();
      tc.addChild(border);
      this.borderGraphics.set(def.id, border);

      const glow = new Graphics();
      tc.addChild(glow);
      this.glowGraphics.set(def.id, glow);

      const flow = new Graphics();
      tc.addChild(flow);
      this.flowGraphics.set(def.id, flow);

      // Territory label — large, readable at any zoom
      const style = new TextStyle({
        fontFamily: '"JetBrains Mono", "Courier New", monospace',
        fontSize: 48,
        fill: PAL.creamDim,
        letterSpacing: 6,
        align: 'center',
        fontWeight: 'bold',
      });
      const label = new Text({ text: def.label.toUpperCase(), style });
      label.anchor.set(0.5, 0.5);
      label.alpha = 0.6;
      label.x = def.center[0];
      label.y = def.center[1] - 200;
      tc.addChild(label);
      this.labelTexts.set(def.id, label);
    }
  }

  // ── Noise texture (baked once — static field lines, cream-faint color) ──────

  private _bakeNoiseTextures(): void {
    for (const def of TERRITORY_DEFS) {
      const g = this.noiseGraphics.get(def.id)!;
      g.clear();

      const [minX, minY, maxX, maxY] = this._polyBounds(def.polygon);
      const width  = maxX - minX;
      const height = maxY - minY;

      for (let li = 0; li < NOISE_LINE_COUNT; li++) {
        const yBase = minY + (li / (NOISE_LINE_COUNT - 1)) * height;
        const pts: Array<[number, number]> = [];

        const steps = 50;
        for (let s = 0; s <= steps; s++) {
          const x = minX + (s / steps) * width;
          const noiseVal = simplex2(x * NOISE_SCALE, yBase * NOISE_SCALE);
          const y = yBase + noiseVal * 40;
          if (pointInPoly(x, y, def.polygon)) {
            pts.push([x, y]);
          } else if (pts.length > 0) {
            if (pts.length >= 2) {
              this._strokePath(g, pts, PAL.creamFaint, 0.12, 0.8);
            }
            pts.length = 0;
          }
        }
        if (pts.length >= 2) {
          this._strokePath(g, pts, PAL.creamFaint, 0.12, 0.8);
        }
      }
    }
  }

  // ── Per-frame territory draw ───────────────────────────────────────────────

  private _drawTerritory(def: TerritoryDef, state: TerritoryVisualState): void {
    const isActive  = state.unitCount > 0;
    const isThreat  = state.threatLevel !== 'none';
    const isDormant = state.activityCount === 0;
    const isDarkFog = state.fogState === 'dark';

    const tc = this.terrainContainers.get(def.id)!;

    // Container alpha — dormant dims slightly, dark fog dims more
    if (isDarkFog) {
      tc.alpha = 0.5;
    } else if (isDormant) {
      tc.alpha = 0.85;
    } else {
      tc.alpha = 1.0;
    }

    // ── Fill — base polygon ──────────────────────────────────────────────────
    const fillG = this.fillGraphics.get(def.id)!;
    fillG.clear();

    let fillColor = def.baseColor;
    if (isActive) {
      // Brighten subtly (15%, not 30% — this is a weathered map, not a neon display)
      fillColor = brighten(def.baseColor, 1.15);
    }
    if (isThreat) {
      // Slight red tint — mix a touch of orange into the fill
      const r = Math.min(255, ((fillColor >> 16) & 0xff) + 12);
      const g_c = Math.max(0,  ((fillColor >> 8)  & 0xff) - 4);
      const b   = Math.max(0,  (fillColor & 0xff) - 4);
      fillColor = (r << 16) | (g_c << 8) | b;
    }
    fillG.poly(def.polygon).fill({ color: fillColor, alpha: 0.9 });

    // ── Border ───────────────────────────────────────────────────────────────
    const borderG = this.borderGraphics.get(def.id)!;
    borderG.clear();

    if (isThreat) {
      // Pulsing orange border — 1.5s cycle, alpha oscillates 0.4 → 0.9
      const phase = this.pulseOffsets.get(def.id) ?? 0;
      const pulse = 0.5 + 0.5 * Math.sin((this.elapsed / 1.5) * Math.PI * 2 + phase);
      const glowAlpha = 0.4 + 0.5 * pulse;
      borderG.poly(def.polygon).stroke({ color: PAL.orange, width: 2.5, alpha: glowAlpha });
      // Outer soft glow pass
      borderG.poly(def.polygon).stroke({ color: PAL.orange, width: 7, alpha: glowAlpha * 0.12 });
    } else if (isActive) {
      // Orange border — units present, command territory active
      borderG.poly(def.polygon).stroke({ color: PAL.orange, width: 2, alpha: 0.7 });
      // Subtle glow halo
      borderG.poly(def.polygon).stroke({ color: PAL.orange, width: 5, alpha: 0.15 });
    } else if (isDormant) {
      // Dimmed — territory is quiet
      borderG.poly(def.polygon).stroke({ color: PAL.border, width: 1.5, alpha: 0.2 });
    } else {
      // Default: warm dark border — visible enough to see territory shapes
      borderG.poly(def.polygon).stroke({ color: PAL.border, width: 1.5, alpha: 0.6 });
    }

    // ── Activity glow (pulsing border glow when units are working) ───────────
    const glowG = this.glowGraphics.get(def.id)!;
    glowG.clear();

    const activityLevel = this.activityLevels.get(def.id) ?? 0;
    if (activityLevel > 0) {
      const phase = this.pulseOffsets.get(def.id) ?? 0;
      const sin = Math.sin(this.elapsed * Math.PI * 2 * 0.8 + phase); // 0.8 Hz pulse

      let alphaBase: number, alphaAmp: number, extraWidth: number;
      switch (activityLevel) {
        case 1: alphaBase = 0.20; alphaAmp = 0.05; extraWidth = 2; break;
        case 2: alphaBase = 0.30; alphaAmp = 0.10; extraWidth = 4; break;
        default: alphaBase = 0.45; alphaAmp = 0.15; extraWidth = 6; break;
      }

      const glowAlpha = alphaBase + sin * alphaAmp;
      const glowColor = def.baseColor;
      const brightGlow = brighten(glowColor, 2.5);

      glowG.poly(def.polygon).stroke({
        color: brightGlow,
        width: 1.5 + extraWidth,
        alpha: glowAlpha,
      });
      // Outer diffuse pass for softer glow
      glowG.poly(def.polygon).stroke({
        color: brightGlow,
        width: 1.5 + extraWidth * 2,
        alpha: glowAlpha * 0.3,
      });
    }

    // ── Flow lines (active territories only) ─────────────────────────────────
    // Phosphor green (#82C896), subtle — field activity, not laser beams
    const flowG = this.flowGraphics.get(def.id)!;
    flowG.clear();

    if (isActive) {
      const baseOffset = this.flowOffsets.get(def.id) ?? 0;
      const offset = baseOffset + this.elapsed * 0.04;
      const [minX, minY, maxX, maxY] = this._polyBounds(def.polygon);
      const width  = maxX - minX;
      const height = maxY - minY;

      for (let fi = 0; fi < FLOW_LINE_COUNT; fi++) {
        const xBand = minX + ((fi + 0.5) / FLOW_LINE_COUNT) * width;
        const pts: Array<[number, number]> = [];
        const steps = 35;

        for (let s = 0; s <= steps; s++) {
          const yFrac = ((s / steps) + offset * (0.6 + fi * 0.1)) % 1;
          const y = minY + yFrac * height;
          const drift = simplex2(xBand * NOISE_SCALE + fi * 3.7, y * NOISE_SCALE + offset * 0.1) * FLOW_DRIFT_AMP;
          const x = xBand + drift;

          if (pointInPoly(x, y, def.polygon)) {
            pts.push([x, y]);
          } else if (pts.length > 0) {
            if (pts.length >= 2) {
              this._strokePath(flowG, pts, PAL.phosphor, 0.3, 0.8);
            }
            pts.length = 0;
          }
        }
        if (pts.length >= 2) {
          this._strokePath(flowG, pts, PAL.phosphor, 0.3, 0.8);
        }
      }
    }

    // ── Label ─────────────────────────────────────────────────────────────────
    const label = this.labelTexts.get(def.id)!;
    const labelStyle = label.style as TextStyle;

    if (isActive) {
      // Cream, fully lit — command territory is live
      labelStyle.fill = PAL.cream;
      label.alpha = 0.9;
    } else if (isDormant) {
      labelStyle.fill = PAL.creamDim;
      label.alpha = 0.4;
    } else {
      labelStyle.fill = PAL.creamDim;
      label.alpha = 0.6;
    }

    // Keep label on top of all layers
    tc.setChildIndex(label, tc.children.length - 1);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _strokePath(
    g: Graphics,
    pts: Array<[number, number]>,
    color: number,
    alpha: number,
    width: number
  ): void {
    if (pts.length < 2) return;
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      g.lineTo(pts[i][0], pts[i][1]);
    }
    g.stroke({ color, alpha, width });
  }

  private _polyBounds(poly: number[]): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      if (poly[i]     < minX) minX = poly[i];
      if (poly[i + 1] < minY) minY = poly[i + 1];
      if (poly[i]     > maxX) maxX = poly[i];
      if (poly[i + 1] > maxY) maxY = poly[i + 1];
    }
    return [minX, minY, maxX, maxY];
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
