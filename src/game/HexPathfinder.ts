/**
 * HexPathfinder — A* pathfinding over a pointy-top hex grid
 *
 * Grid uses axial coordinates (q, r) with pointy-top orientation.
 * Hex radius = 40px as specified in PRD 02.
 * World dimensions: 4000 x 3000 logical pixels.
 *
 * Movement costs:
 *   1.0 — inside a territory (open terrain)
 *   2.5 — outside any territory (no-man's-land / border region)
 *   Infinity — out of world bounds
 *
 * Uses a binary min-heap for the open set.
 */

import { WORLD_WIDTH, WORLD_HEIGHT } from '../renderer/constants'

// ─── Hex geometry (pointy-top) ──────────────────────────────────────────────

const HEX_RADIUS = 40
const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS   // ~69.28
const HEX_HEIGHT = 2 * HEX_RADIUS              // 80
const HEX_ROW_HEIGHT = HEX_HEIGHT * 0.75       // 60 — vertical spacing

// Grid bounds (derived from world size)
const GRID_COLS = Math.ceil(WORLD_WIDTH / HEX_WIDTH) + 1    // ~59
const GRID_ROWS = Math.ceil(WORLD_HEIGHT / HEX_ROW_HEIGHT) + 1  // ~51

// ─── Axial coordinate neighbors (pointy-top hex) ───────────────────────────
//  Even-r offset:  right, bottom-right, bottom-left, left, top-left, top-right
//  Odd-r offset:   right, bottom-right, bottom-left, left, top-left, top-right

const EVEN_R_NEIGHBORS: [number, number][] = [
  [+1, 0], [0, +1], [-1, +1],
  [-1, 0], [-1, -1], [0, -1],
]

const ODD_R_NEIGHBORS: [number, number][] = [
  [+1, 0], [+1, +1], [0, +1],
  [-1, 0], [0, -1], [+1, -1],
]

// ─── Territory polygon data (for cost calculation) ──────────────────────────

interface TerritoryPoly {
  polygon: number[]
}

// ─── Coordinate conversion ──────────────────────────────────────────────────

/** Convert offset (col, row) to world-space pixel center */
function hexToWorld(col: number, row: number): { x: number; y: number } {
  const x = col * HEX_WIDTH + (row & 1 ? HEX_WIDTH / 2 : 0)
  const y = row * HEX_ROW_HEIGHT
  return { x, y }
}

/** Convert world-space pixel to nearest hex offset (col, row) */
function worldToHex(wx: number, wy: number): { col: number; row: number } {
  // Approximate row first
  const row = Math.round(wy / HEX_ROW_HEIGHT)
  const xOffset = row & 1 ? HEX_WIDTH / 2 : 0
  const col = Math.round((wx - xOffset) / HEX_WIDTH)
  return { col, row }
}

/** Unique key for a hex cell */
function hexKey(col: number, row: number): number {
  // Pack into a single integer — col in lower 16 bits, row in upper 16
  return ((row + 500) << 16) | (col + 500)
}

// ─── Point-in-polygon (ray casting) ─────────────────────────────────────────

function pointInPoly(px: number, py: number, poly: number[]): boolean {
  const n = poly.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1]
    const xj = poly[j * 2], yj = poly[j * 2 + 1]
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// ─── Binary Min-Heap ────────────────────────────────────────────────────────

interface HeapNode {
  key: number
  f: number
}

class MinHeap {
  private data: HeapNode[] = []
  private positions: Map<number, number> = new Map()

  get size(): number { return this.data.length }

  push(key: number, f: number): void {
    const node: HeapNode = { key, f }
    this.data.push(node)
    const idx = this.data.length - 1
    this.positions.set(key, idx)
    this._bubbleUp(idx)
  }

  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    this.positions.delete(top.key)
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.positions.set(last.key, 0)
      this._sinkDown(0)
    }
    return top
  }

  has(key: number): boolean {
    return this.positions.has(key)
  }

  decreaseKey(key: number, f: number): void {
    const idx = this.positions.get(key)
    if (idx === undefined) return
    this.data[idx].f = f
    this._bubbleUp(idx)
  }

  private _bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1
      if (this.data[idx].f >= this.data[parent].f) break
      this._swap(idx, parent)
      idx = parent
    }
  }

  private _sinkDown(idx: number): void {
    const len = this.data.length
    while (true) {
      let smallest = idx
      const left = 2 * idx + 1
      const right = 2 * idx + 2
      if (left < len && this.data[left].f < this.data[smallest].f) smallest = left
      if (right < len && this.data[right].f < this.data[smallest].f) smallest = right
      if (smallest === idx) break
      this._swap(idx, smallest)
      idx = smallest
    }
  }

  private _swap(a: number, b: number): void {
    const tmp = this.data[a]
    this.data[a] = this.data[b]
    this.data[b] = tmp
    this.positions.set(this.data[a].key, a)
    this.positions.set(this.data[b].key, b)
  }
}

// ─── HexPathfinder ──────────────────────────────────────────────────────────

export class HexPathfinder {
  private territoryPolygons: TerritoryPoly[] = []

  // Cached cost grid — lazily built
  private costCache: Map<number, number> = new Map()
  private costCacheBuilt = false

  /**
   * Initialize with territory polygons from TerrainRenderer.
   * Call once after the terrain is set up.
   */
  setTerritories(territories: { polygon: number[] }[]): void {
    this.territoryPolygons = territories
    this.costCache.clear()
    this.costCacheBuilt = false
  }

  /**
   * Get movement cost for a hex cell.
   * 1.0 inside any territory, 2.5 in no-man's-land, Infinity out of bounds.
   */
  private getCost(col: number, row: number): number {
    const key = hexKey(col, row)
    const cached = this.costCache.get(key)
    if (cached !== undefined) return cached

    const { x, y } = hexToWorld(col, row)

    // Out of world bounds
    if (x < -HEX_RADIUS || x > WORLD_WIDTH + HEX_RADIUS ||
        y < -HEX_RADIUS || y > WORLD_HEIGHT + HEX_RADIUS) {
      this.costCache.set(key, Infinity)
      return Infinity
    }

    // Check if inside any territory
    for (const t of this.territoryPolygons) {
      if (pointInPoly(x, y, t.polygon)) {
        this.costCache.set(key, 1.0)
        return 1.0
      }
    }

    // No-man's-land between territories
    this.costCache.set(key, 2.5)
    return 2.5
  }

  /**
   * Get the 6 hex neighbors for a cell (offset coordinates, even-r layout).
   */
  private getNeighbors(col: number, row: number): [number, number][] {
    const offsets = row & 1 ? ODD_R_NEIGHBORS : EVEN_R_NEIGHBORS
    const result: [number, number][] = []
    for (const [dc, dr] of offsets) {
      result.push([col + dc, row + dr])
    }
    return result
  }

  /**
   * Hex distance heuristic (axial distance approximation via offset coords).
   * Convert to cube coordinates and use cube distance.
   */
  private heuristic(c1: number, r1: number, c2: number, r2: number): number {
    // Offset to cube conversion (even-r)
    const x1 = c1 - (r1 - (r1 & 1)) / 2
    const z1 = r1
    const y1 = -x1 - z1

    const x2 = c2 - (r2 - (r2 & 1)) / 2
    const z2 = r2
    const y2 = -x2 - z2

    return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2
  }

  /**
   * Find a path from world-space start to end coordinates.
   * Returns an array of world-space waypoints, or empty array if no path found.
   */
  findPath(
    startX: number, startY: number,
    endX: number, endY: number,
    maxIterations: number = 2000
  ): { x: number; y: number }[] {
    const start = worldToHex(startX, startY)
    const end = worldToHex(endX, endY)

    // Same cell — just return the endpoint
    if (start.col === end.col && start.row === end.row) {
      return [{ x: endX, y: endY }]
    }

    // If destination is impassable, find nearest passable cell
    if (this.getCost(end.col, end.row) === Infinity) {
      return [{ x: endX, y: endY }] // fallback: direct move
    }

    const startKey = hexKey(start.col, start.row)
    const endKey = hexKey(end.col, end.row)

    const openSet = new MinHeap()
    const gScore: Map<number, number> = new Map()
    const cameFrom: Map<number, number> = new Map()
    const cellCoords: Map<number, [number, number]> = new Map()

    // Track coords by key
    cellCoords.set(startKey, [start.col, start.row])
    cellCoords.set(endKey, [end.col, end.row])

    gScore.set(startKey, 0)
    const h = this.heuristic(start.col, start.row, end.col, end.row)
    openSet.push(startKey, h)

    const closedSet = new Set<number>()
    let iterations = 0

    while (openSet.size > 0 && iterations < maxIterations) {
      iterations++
      const current = openSet.pop()!
      const currentKey = current.key

      if (currentKey === endKey) {
        // Reconstruct path
        return this._reconstructPath(cameFrom, cellCoords, currentKey, startX, startY, endX, endY)
      }

      closedSet.add(currentKey)
      const [cc, cr] = cellCoords.get(currentKey)!

      for (const [nc, nr] of this.getNeighbors(cc, cr)) {
        const neighborKey = hexKey(nc, nr)
        if (closedSet.has(neighborKey)) continue

        const cost = this.getCost(nc, nr)
        if (cost === Infinity) continue

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + cost

        if (!cellCoords.has(neighborKey)) {
          cellCoords.set(neighborKey, [nc, nr])
        }

        const prevG = gScore.get(neighborKey) ?? Infinity
        if (tentativeG < prevG) {
          cameFrom.set(neighborKey, currentKey)
          gScore.set(neighborKey, tentativeG)
          const f = tentativeG + this.heuristic(nc, nr, end.col, end.row)

          if (openSet.has(neighborKey)) {
            openSet.decreaseKey(neighborKey, f)
          } else {
            openSet.push(neighborKey, f)
          }
        }
      }
    }

    // No path found — fallback to direct line
    return [{ x: endX, y: endY }]
  }

  /**
   * Reconstruct the path from A* result, converting back to world coordinates.
   * Simplifies the path by removing collinear waypoints.
   */
  private _reconstructPath(
    cameFrom: Map<number, number>,
    cellCoords: Map<number, [number, number]>,
    endKey: number,
    startX: number, startY: number,
    endX: number, endY: number
  ): { x: number; y: number }[] {
    // Build raw path in reverse
    const rawKeys: number[] = []
    let current = endKey
    while (current !== undefined) {
      rawKeys.push(current)
      current = cameFrom.get(current)!
    }
    rawKeys.reverse()

    // Convert to world-space points
    const worldPoints: { x: number; y: number }[] = []

    // Start with exact start position
    worldPoints.push({ x: startX, y: startY })

    // Add intermediate hex centers (skip first and last — we use exact positions)
    for (let i = 1; i < rawKeys.length - 1; i++) {
      const [c, r] = cellCoords.get(rawKeys[i])!
      const pos = hexToWorld(c, r)
      worldPoints.push(pos)
    }

    // End with exact target position
    worldPoints.push({ x: endX, y: endY })

    // Simplify — remove points that are roughly collinear
    return this._simplifyPath(worldPoints)
  }

  /**
   * Douglas-Peucker-style simplification.
   * Removes waypoints that don't deviate much from a straight line.
   */
  private _simplifyPath(
    points: { x: number; y: number }[],
    tolerance: number = 15
  ): { x: number; y: number }[] {
    if (points.length <= 2) return points

    // Find the point with maximum distance from the line between first and last
    let maxDist = 0
    let maxIdx = 0
    const first = points[0]
    const last = points[points.length - 1]

    for (let i = 1; i < points.length - 1; i++) {
      const d = this._pointToLineDistance(points[i], first, last)
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }

    if (maxDist > tolerance) {
      const left = this._simplifyPath(points.slice(0, maxIdx + 1), tolerance)
      const right = this._simplifyPath(points.slice(maxIdx), tolerance)
      return [...left.slice(0, -1), ...right]
    }

    return [first, last]
  }

  private _pointToLineDistance(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
    const projX = a.x + t * dx
    const projY = a.y + t * dy
    return Math.hypot(p.x - projX, p.y - projY)
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { hexToWorld, worldToHex, HEX_RADIUS, HEX_WIDTH, HEX_ROW_HEIGHT }
