/**
 * ResourceBar - Top-of-screen HUD showing key metrics
 *
 * Displays: Connection, Revenue, Context tokens, Unit count, Score
 * All values animate on change with a brief color flash.
 */

// Token cost heuristics per tool
const TOOL_TOKEN_COST: Record<string, number> = {
  Read: 500,
  Write: 1000,
  Edit: 500,
  Bash: 300,
  Grep: 200,
  Glob: 200,
  WebFetch: 800,
  WebSearch: 800,
  Task: 100,
  TodoWrite: 100,
  NotebookEdit: 1000,
  AskUserQuestion: 100,
}

const CONTEXT_WINDOW = 200_000

export class ResourceBar {
  private el: HTMLElement
  private revenueEl!: HTMLElement
  private contextEl!: HTMLElement
  private unitCountEl!: HTMLElement
  private scoreEl!: HTMLElement
  private connectionEl!: HTMLElement

  // State
  private tokensBySession: Map<string, number> = new Map()
  private totalToolCalls = 0
  private currentRevenue = 0
  private currentScore = 0
  private activeUnits = 0
  private maxUnits = 5

  constructor() {
    this.el = document.getElementById('resource-bar')!
    this.render()
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="resource-bar-inner">
        <div class="resource-item" id="res-connection">
          <span class="resource-icon">&#x25CF;</span>
          <span class="resource-label">STATUS</span>
          <span class="resource-value" id="rv-connection">OFFLINE</span>
        </div>
        <div class="resource-item">
          <span class="resource-icon">$</span>
          <span class="resource-label">REVENUE</span>
          <span class="resource-value" id="rv-revenue">$0 MTD</span>
        </div>
        <div class="resource-item">
          <span class="resource-icon">&#x26A1;</span>
          <span class="resource-label">CONTEXT</span>
          <span class="resource-value" id="rv-context">0%</span>
        </div>
        <div class="resource-item">
          <span class="resource-icon">&#x2694;</span>
          <span class="resource-label">UNITS</span>
          <span class="resource-value" id="rv-units">0 / 5</span>
        </div>
        <div class="resource-item">
          <span class="resource-icon">&#x2605;</span>
          <span class="resource-label">SCORE</span>
          <span class="resource-value resource-score" id="rv-score">0</span>
        </div>
        <div class="resource-bar-title">AGENT EMPIRES</div>
      </div>
    `

    this.revenueEl = document.getElementById('rv-revenue')!
    this.contextEl = document.getElementById('rv-context')!
    this.unitCountEl = document.getElementById('rv-units')!
    this.scoreEl = document.getElementById('rv-score')!
    this.connectionEl = document.getElementById('rv-connection')!
  }

  /** Flash an element white then return to normal */
  private flashValue(el: HTMLElement): void {
    el.classList.add('resource-flash')
    setTimeout(() => el.classList.remove('resource-flash'), 300)
  }

  /** Animate a number counting up/down */
  private animateNumber(
    el: HTMLElement,
    from: number,
    to: number,
    format: (n: number) => string,
    duration = 400
  ): void {
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = t * (2 - t) // ease-out quad
      const current = Math.round(from + (to - from) * eased)
      el.textContent = format(current)
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // === Public API ===

  setConnected(connected: boolean): void {
    this.connectionEl.textContent = connected ? 'ONLINE' : 'OFFLINE'
    this.connectionEl.className = `resource-value ${connected ? 'status-online' : 'status-offline'}`
    const dot = document.querySelector('#res-connection .resource-icon') as HTMLElement
    if (dot) {
      dot.style.color = connected ? 'var(--accent-success)' : 'var(--accent-danger)'
    }
  }

  /** Estimate tokens from a tool call and accumulate */
  updateTokens(sessionId: string, toolName: string): void {
    const cost = TOOL_TOKEN_COST[toolName] || 200
    const current = this.tokensBySession.get(sessionId) || 0
    this.tokensBySession.set(sessionId, current + cost)
    this.totalToolCalls++

    // Aggregate tokens across all sessions
    let totalTokens = 0
    for (const t of this.tokensBySession.values()) {
      totalTokens += t
    }
    const percent = Math.min((totalTokens / CONTEXT_WINDOW) * 100, 100)
    this.setContext(percent)
    this.flashValue(this.contextEl)

    // Recalculate score
    this.recalcScore()
  }

  /** Set context percentage directly (e.g. from token WebSocket messages) */
  setContext(percent: number): void {
    this.contextEl.textContent = `${Math.round(percent)}%`
    if (percent > 80) {
      this.contextEl.className = 'resource-value text-danger'
    } else if (percent > 60) {
      this.contextEl.className = 'resource-value text-warning'
    } else {
      this.contextEl.className = 'resource-value'
    }
  }

  updateUnitCount(active: number, max: number = 5): void {
    this.activeUnits = active
    this.maxUnits = max
    this.unitCountEl.textContent = `${active} / ${max}`
    this.flashValue(this.unitCountEl)
    this.recalcScore()
  }

  setUnitCount(current: number, max: number = 5): void {
    this.updateUnitCount(current, max)
  }

  updateRevenue(mtd: number): void {
    const prev = this.currentRevenue
    this.currentRevenue = mtd
    this.animateNumber(this.revenueEl, prev, mtd, (n) => `$${n.toLocaleString()} MTD`)
    this.revenueEl.classList.add('resource-flash-gold')
    setTimeout(() => this.revenueEl.classList.remove('resource-flash-gold'), 500)
  }

  setRevenue(amount: string): void {
    this.revenueEl.textContent = amount
  }

  updateScore(score: number): void {
    const prev = this.currentScore
    this.currentScore = score
    this.animateNumber(this.scoreEl, prev, score, (n) => n.toLocaleString())
    this.flashValue(this.scoreEl)
  }

  setScore(score: number): void {
    this.updateScore(score)
  }

  /** Recalculate score from formula: (active_sessions * 100) + (total_tool_calls * 10) */
  private recalcScore(): void {
    const score = (this.activeUnits * 100) + (this.totalToolCalls * 10)
    if (score !== this.currentScore) {
      this.updateScore(score)
    }
  }

  /** Reset token tracking for a session (e.g. on session end) */
  resetSession(sessionId: string): void {
    this.tokensBySession.delete(sessionId)
  }
}
