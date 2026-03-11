/**
 * EconomyPanel - Bottom-right overlay showing revenue data
 *
 * Displays MRR, today's revenue, last 5 transactions, and a 30-day sparkline.
 * Toggle with Shift+E.
 */

import { escapeHtml } from '../ui/FeedManager'

export interface Transaction {
  type: string
  amount: number
  timestamp: string
}

/** Icon map for transaction types */
const TYPE_ICONS: Record<string, string> = {
  subscription: '&#x1F504;',  // recurring
  one_time: '&#x26A1;',       // lightning
  refund: '&#x21A9;',         // return arrow
  upgrade: '&#x2B06;',        // up arrow
  downgrade: '&#x2B07;',      // down arrow
  churn: '&#x2620;',          // skull
  payment: '&#x24;',          // dollar
}

function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] || '&#x25CF;'
}

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1000) {
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Build an inline SVG sparkline from daily totals */
function buildSparkline(dailyTotals: number[]): string {
  if (dailyTotals.length === 0) return ''
  const width = 248
  const height = 40
  const barWidth = Math.max(2, Math.floor((width - dailyTotals.length) / dailyTotals.length))
  const gap = 1
  const max = Math.max(...dailyTotals, 1)

  let bars = ''
  for (let i = 0; i < dailyTotals.length; i++) {
    const val = dailyTotals[i]
    const barH = Math.max(1, (val / max) * (height - 4))
    const x = i * (barWidth + gap)
    const y = height - barH
    const opacity = val === 0 ? 0.15 : 0.6 + (val / max) * 0.4
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="1" fill="var(--accent-gold)" opacity="${opacity.toFixed(2)}" />`
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`
}

export class EconomyPanel {
  private container: HTMLElement
  private visible = false

  // Cached elements
  private mrrEl!: HTMLElement
  private todayEl!: HTMLElement
  private txListEl!: HTMLElement
  private sparklineEl!: HTMLElement

  // State (public for read access from message handlers)
  mrr = 0
  todayTotal = 0
  transactions: Transaction[] = []
  private dailyTotals: number[] = []

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'economy-panel'
    this.container.className = 'economy-panel'
    this.container.style.display = 'none'
    document.body.appendChild(this.container)
    this.render()
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="economy-header">
        <span class="economy-title">ECONOMY</span>
        <span class="economy-hotkey">Shift+E</span>
      </div>

      <div class="economy-metric economy-mrr">
        <div class="economy-metric-label">MRR</div>
        <div class="economy-metric-value" id="econ-mrr">$0</div>
      </div>

      <div class="economy-metric">
        <div class="economy-metric-label">TODAY</div>
        <div class="economy-metric-value economy-today" id="econ-today">$0</div>
      </div>

      <div class="economy-divider"></div>

      <div class="economy-section-label">LAST TRANSACTIONS</div>
      <div class="economy-tx-list" id="econ-tx-list">
        <div class="economy-empty">No transactions</div>
      </div>

      <div class="economy-divider"></div>

      <div class="economy-section-label">30-DAY REVENUE</div>
      <div class="economy-sparkline" id="econ-sparkline">
        <div class="economy-empty">No data</div>
      </div>
    `

    this.mrrEl = document.getElementById('econ-mrr')!
    this.todayEl = document.getElementById('econ-today')!
    this.txListEl = document.getElementById('econ-tx-list')!
    this.sparklineEl = document.getElementById('econ-sparkline')!
  }

  /** Main update method — call from message handlers */
  updateRevenue(
    mrr: number,
    todayTotal: number,
    transactions: Transaction[],
    dailyTotals?: number[]
  ): void {
    this.mrr = mrr
    this.todayTotal = todayTotal
    this.transactions = transactions.slice(0, 5)
    if (dailyTotals) this.dailyTotals = dailyTotals.slice(-30)

    // MRR
    this.mrrEl.textContent = formatCurrency(mrr)

    // Today
    this.todayEl.textContent = formatCurrency(todayTotal)
    this.todayEl.classList.toggle('economy-positive', todayTotal > 0)

    // Transactions list
    if (this.transactions.length === 0) {
      this.txListEl.innerHTML = '<div class="economy-empty">No transactions</div>'
    } else {
      this.txListEl.innerHTML = this.transactions
        .map(tx => {
          const icon = getTypeIcon(tx.type)
          const amountClass = tx.amount < 0 ? 'economy-negative' : 'economy-positive'
          return `
            <div class="economy-tx-item">
              <span class="economy-tx-icon">${icon}</span>
              <span class="economy-tx-type">${escapeHtml(tx.type)}</span>
              <span class="economy-tx-amount ${amountClass}">${formatCurrency(tx.amount)}</span>
              <span class="economy-tx-time">${formatTimestamp(tx.timestamp)}</span>
            </div>
          `
        })
        .join('')
    }

    // Sparkline
    if (this.dailyTotals.length > 0) {
      this.sparklineEl.innerHTML = buildSparkline(this.dailyTotals)
    }
  }

  /** Toggle panel visibility */
  toggle(): void {
    this.visible = !this.visible
    this.container.style.display = this.visible ? 'flex' : 'none'
  }

  show(): void {
    this.visible = true
    this.container.style.display = 'flex'
  }

  hide(): void {
    this.visible = false
    this.container.style.display = 'none'
  }

  isVisible(): boolean {
    return this.visible
  }

  destroy(): void {
    this.container.remove()
  }
}
