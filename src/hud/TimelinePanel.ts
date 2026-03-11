/**
 * TimelinePanel - Horizontal timeline showing per-unit session activity
 *
 * Displays tool uses, status changes, and territory movements as colored
 * markers on a 30-minute scrolling timeline. Appears at the bottom of the
 * screen when a unit is selected.
 */

export interface SessionEvent {
  type: 'tool' | 'status' | 'territory'
  name: string
  timestamp: number
  territory?: string
}

/** Color map for tool types */
const TOOL_COLORS: Record<string, string> = {
  Bash: '#ffaa00',     // orange (--accent-warning)
  Read: '#00ccaa',     // teal
  Write: '#ffd700',    // amber (--accent-gold)
  Edit: '#ffd700',     // amber
  Grep: '#33ff77',     // green (--accent-success)
  Glob: '#33ff77',     // green
  WebFetch: '#7b68ee', // purple (--accent-secondary)
  WebSearch: '#7b68ee',
  Task: '#00ffcc',     // cyan (--accent-primary)
}

/** Color map for status changes */
const STATUS_COLORS: Record<string, string> = {
  idle: '#33ff77',
  working: '#ffaa00',
  combat: '#ff3366',
  thinking: '#7b68ee',
  exhausted: '#808090',
  offline: '#505060',
}

const TIMELINE_WINDOW_MS = 30 * 60 * 1000  // 30 minutes
const TICK_INTERVAL_MS = 5 * 60 * 1000     // 5-minute ticks

function getToolColor(name: string): string {
  return TOOL_COLORS[name] || '#808090'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export class TimelinePanel {
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private tooltip: HTMLElement
  private ctx: CanvasRenderingContext2D
  private visible = false
  private currentUnitId: string | null = null
  private events: SessionEvent[] = []
  private animFrame: number | null = null

  constructor() {
    // Container
    this.container = document.createElement('div')
    this.container.className = 'timeline-panel'
    this.container.style.display = 'none'

    // Header
    const header = document.createElement('div')
    header.className = 'timeline-header'
    header.innerHTML = `<span class="timeline-title">SESSION TIMELINE</span><span class="timeline-unit-name" id="timeline-unit-name"></span>`
    this.container.appendChild(header)

    // Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'timeline-canvas'
    this.canvas.height = 80
    this.container.appendChild(this.canvas)

    // Tooltip
    this.tooltip = document.createElement('div')
    this.tooltip.className = 'timeline-tooltip'
    this.tooltip.style.display = 'none'
    this.container.appendChild(this.tooltip)

    document.body.appendChild(this.container)

    this.ctx = this.canvas.getContext('2d')!

    // Hover listener
    this.canvas.addEventListener('mousemove', (e) => this.handleHover(e))
    this.canvas.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none'
    })

    // Resize observer
    const ro = new ResizeObserver(() => this.resizeCanvas())
    ro.observe(this.container)
  }

  private resizeCanvas(): void {
    const rect = this.container.getBoundingClientRect()
    const w = Math.floor(rect.width - 16) // padding
    if (w > 0 && this.canvas.width !== w) {
      this.canvas.width = w
      this.draw()
    }
  }

  /** Show timeline for a specific unit */
  show(unitId: string, unitName?: string): void {
    this.currentUnitId = unitId
    this.visible = true
    this.container.style.display = 'flex'
    const nameEl = document.getElementById('timeline-unit-name')
    if (nameEl) nameEl.textContent = unitName || unitId.slice(0, 8)
    this.resizeCanvas()
    this.startAutoRedraw()
  }

  /** Hide the timeline */
  hide(): void {
    this.visible = false
    this.currentUnitId = null
    this.events = []
    this.container.style.display = 'none'
    this.stopAutoRedraw()
  }

  /** Set the events array for the currently shown unit (replaces all) */
  setEvents(events: SessionEvent[]): void {
    this.events = events
    if (this.visible) this.draw()
  }

  /** Add a single event (call from main.ts on live events) */
  addEvent(unitId: string, event: SessionEvent): void {
    // Only draw if this unit is currently shown
    if (unitId === this.currentUnitId) {
      this.events.push(event)
      // Trim to keep last 100
      if (this.events.length > 100) {
        this.events = this.events.slice(-100)
      }
      if (this.visible) this.draw()
    }
  }

  isVisible(): boolean {
    return this.visible
  }

  getUnitId(): string | null {
    return this.currentUnitId
  }

  // ========== Drawing ==========

  private draw(): void {
    const { ctx, canvas } = this
    const w = canvas.width
    const h = canvas.height
    if (w === 0) return

    ctx.clearRect(0, 0, w, h)

    const now = Date.now()
    const windowStart = now - TIMELINE_WINDOW_MS
    const padding = { left: 40, right: 16, top: 10, bottom: 20 }
    const trackW = w - padding.left - padding.right
    const trackY = padding.top
    const trackH = h - padding.top - padding.bottom

    // Draw axis line
    ctx.strokeStyle = '#1e1e30'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padding.left, trackY + trackH / 2)
    ctx.lineTo(padding.left + trackW, trackY + trackH / 2)
    ctx.stroke()

    // Draw tick marks (every 5 minutes)
    ctx.fillStyle = '#505060'
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'
    for (let t = 0; t <= 6; t++) {
      const tickTime = windowStart + t * TICK_INTERVAL_MS
      const x = padding.left + (t / 6) * trackW
      // Tick line
      ctx.strokeStyle = '#1e1e30'
      ctx.beginPath()
      ctx.moveTo(x, trackY)
      ctx.lineTo(x, trackY + trackH)
      ctx.stroke()
      // Label
      ctx.fillStyle = '#505060'
      ctx.fillText(formatTime(tickTime), x, trackY + trackH + 12)
    }

    // "NOW" label at right edge
    ctx.fillStyle = '#00ffcc'
    ctx.textAlign = 'right'
    ctx.fillText('NOW', padding.left + trackW, trackY - 2)

    // Helper: timestamp -> x position
    const tsToX = (ts: number): number => {
      const ratio = (ts - windowStart) / TIMELINE_WINDOW_MS
      return padding.left + ratio * trackW
    }

    // Draw events
    for (const ev of this.events) {
      if (ev.timestamp < windowStart || ev.timestamp > now) continue
      const x = tsToX(ev.timestamp)

      switch (ev.type) {
        case 'tool': {
          // Colored dot
          const color = getToolColor(ev.name)
          ctx.beginPath()
          ctx.arc(x, trackY + trackH / 2 - 8, 4, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
          // Glow
          ctx.beginPath()
          ctx.arc(x, trackY + trackH / 2 - 8, 7, 0, Math.PI * 2)
          ctx.fillStyle = color.replace(')', ', 0.15)').replace('rgb', 'rgba')
          ctx.fill()
          break
        }
        case 'status': {
          // Vertical marker line
          const color = STATUS_COLORS[ev.name] || '#808090'
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, trackY + 2)
          ctx.lineTo(x, trackY + trackH - 2)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.lineWidth = 1
          break
        }
        case 'territory': {
          // Labeled triangle marker
          ctx.fillStyle = '#7b68ee'
          ctx.beginPath()
          ctx.moveTo(x, trackY + trackH / 2 + 6)
          ctx.lineTo(x - 4, trackY + trackH / 2 + 14)
          ctx.lineTo(x + 4, trackY + trackH / 2 + 14)
          ctx.closePath()
          ctx.fill()
          // Label
          if (ev.territory) {
            ctx.fillStyle = '#808090'
            ctx.font = '8px "JetBrains Mono", monospace'
            ctx.textAlign = 'center'
            ctx.fillText(ev.territory, x, trackY + trackH / 2 + 24)
            ctx.font = '9px "JetBrains Mono", monospace'
          }
          break
        }
      }
    }

    // Draw legend
    this.drawLegend(ctx, padding.left, trackY - 2)
  }

  private drawLegend(ctx: CanvasRenderingContext2D, startX: number, y: number): void {
    const items = [
      { label: 'Bash', color: TOOL_COLORS.Bash },
      { label: 'Read', color: TOOL_COLORS.Read },
      { label: 'Write', color: TOOL_COLORS.Write },
      { label: 'Grep', color: TOOL_COLORS.Grep },
    ]
    ctx.font = '8px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'
    let x = startX
    for (const item of items) {
      ctx.beginPath()
      ctx.arc(x, y - 3, 3, 0, Math.PI * 2)
      ctx.fillStyle = item.color
      ctx.fill()
      ctx.fillStyle = '#808090'
      ctx.fillText(item.label, x + 6, y)
      x += ctx.measureText(item.label).width + 18
    }
  }

  // ========== Hover / Tooltip ==========

  private handleHover(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const now = Date.now()
    const windowStart = now - TIMELINE_WINDOW_MS
    const padding = { left: 40, right: 16 }
    const trackW = this.canvas.width - padding.left - padding.right

    // Find nearest event within 8px
    let closest: SessionEvent | null = null
    let closestDist = 8

    for (const ev of this.events) {
      if (ev.timestamp < windowStart || ev.timestamp > now) continue
      const ratio = (ev.timestamp - windowStart) / TIMELINE_WINDOW_MS
      const ex = padding.left + ratio * trackW
      const dist = Math.abs(mx - ex)
      if (dist < closestDist) {
        closest = ev
        closestDist = dist
      }
    }

    if (closest) {
      const label = closest.type === 'territory'
        ? `Move → ${closest.territory || closest.name}`
        : closest.type === 'status'
          ? `Status: ${closest.name}`
          : closest.name
      const time = formatTime(closest.timestamp)
      this.tooltip.textContent = `${label}  ${time}`
      this.tooltip.style.display = 'block'
      this.tooltip.style.left = `${e.clientX - rect.left}px`
      this.tooltip.style.top = `${rect.top - 28}px`
    } else {
      this.tooltip.style.display = 'none'
    }
  }

  // ========== Auto-redraw (keeps "now" at right edge) ==========

  private startAutoRedraw(): void {
    this.stopAutoRedraw()
    const tick = () => {
      if (this.visible) {
        this.draw()
        this.animFrame = requestAnimationFrame(tick)
      }
    }
    // Redraw every ~2 seconds via rAF throttling
    const throttledTick = () => {
      if (!this.visible) return
      this.draw()
      setTimeout(() => {
        this.animFrame = requestAnimationFrame(throttledTick)
      }, 2000)
    }
    this.animFrame = requestAnimationFrame(throttledTick)
  }

  private stopAutoRedraw(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame)
      this.animFrame = null
    }
  }

  destroy(): void {
    this.stopAutoRedraw()
    this.container.remove()
  }
}
