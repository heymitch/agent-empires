/**
 * FleetDashboard — Bottom-left overlay showing connected fleet machines
 *
 * Toggle with F key. Displays peer list with status indicators,
 * capabilities, and fleet health bar.
 */

import type { FleetPeerInfo } from '../../shared/types'

export interface FleetPeer extends FleetPeerInfo {
  /** Whether peer is currently healthy/responsive */
  healthy: boolean
}

function truncateId(id: string, len = 10): string {
  if (id.length <= len) return id
  return id.slice(0, len) + '\u2026'
}

function formatLastSeen(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export class FleetDashboard {
  private container: HTMLElement
  private visible = false
  private peers: Map<string, FleetPeer> = new Map()

  // Cached elements
  private headerCountEl!: HTMLElement
  private peerListEl!: HTMLElement
  private healthBarFillEl!: HTMLElement
  private healthPercentEl!: HTMLElement

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'fleet-dashboard'
    this.container.className = 'fleet-dashboard'
    this.container.style.display = 'none'
    document.body.appendChild(this.container)
    this.render()
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="fleet-header">
        <span class="fleet-title">FLEET</span>
        <span class="fleet-hotkey">F</span>
      </div>

      <div class="fleet-status">
        <span class="fleet-count" id="fleet-count">0 machines connected</span>
      </div>

      <div class="fleet-divider"></div>

      <div class="fleet-section-label">PEERS</div>
      <div class="fleet-peer-list" id="fleet-peer-list">
        <div class="fleet-empty">No peers detected</div>
      </div>

      <div class="fleet-divider"></div>

      <div class="fleet-section-label">FLEET HEALTH</div>
      <div class="fleet-health">
        <div class="fleet-health-bar">
          <div class="fleet-health-fill" id="fleet-health-fill" style="width: 0%"></div>
        </div>
        <span class="fleet-health-percent" id="fleet-health-percent">0%</span>
      </div>
    `

    this.headerCountEl = document.getElementById('fleet-count')!
    this.peerListEl = document.getElementById('fleet-peer-list')!
    this.healthBarFillEl = document.getElementById('fleet-health-fill')!
    this.healthPercentEl = document.getElementById('fleet-health-percent')!
  }

  /** Replace entire peer list (e.g., from fleet_discover response) */
  updatePeers(peers: FleetPeerInfo[]): void {
    this.peers.clear()
    for (const p of peers) {
      this.peers.set(p.machineId, { ...p, healthy: true })
    }
    this.refreshUI()
  }

  /** Add a single peer (fleet_peer_joined) */
  addPeer(peer: FleetPeerInfo): void {
    this.peers.set(peer.machineId, { ...peer, healthy: true })
    this.refreshUI()
  }

  /** Remove a single peer (fleet_peer_left) */
  removePeer(machineId: string): void {
    this.peers.delete(machineId)
    this.refreshUI()
  }

  private refreshUI(): void {
    const peerList = Array.from(this.peers.values())
    const count = peerList.length

    // Header count
    this.headerCountEl.textContent = `${count} machine${count !== 1 ? 's' : ''} connected`

    // Peer list
    if (count === 0) {
      this.peerListEl.innerHTML = '<div class="fleet-empty">No peers detected</div>'
    } else {
      this.peerListEl.innerHTML = peerList
        .map(peer => {
          const statusClass = peer.healthy ? 'fleet-peer-online' : 'fleet-peer-offline'
          const caps = peer.capabilities.length > 0
            ? `<span class="fleet-peer-caps">${peer.capabilities.join(', ')}</span>`
            : ''
          return `
            <div class="fleet-peer-item">
              <span class="fleet-peer-dot ${statusClass}"></span>
              <span class="fleet-peer-id">${truncateId(peer.machineId)}</span>
              ${caps}
              <span class="fleet-peer-time">${formatLastSeen(peer.connectedAt)}</span>
            </div>
          `
        })
        .join('')
    }

    // Health bar
    const healthyCount = peerList.filter(p => p.healthy).length
    const percent = count > 0 ? Math.round((healthyCount / count) * 100) : 0
    this.healthBarFillEl.style.width = `${percent}%`
    this.healthPercentEl.textContent = `${percent}%`

    // Color the health bar based on percentage
    if (percent >= 80) {
      this.healthBarFillEl.className = 'fleet-health-fill fleet-health-good'
    } else if (percent >= 50) {
      this.healthBarFillEl.className = 'fleet-health-fill fleet-health-warn'
    } else {
      this.healthBarFillEl.className = 'fleet-health-fill fleet-health-bad'
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
