/**
 * FleetSignaling — WebRTC signaling relay for remote fleet coordination
 *
 * PRD 07: Remote Forces
 *
 * This is the signaling layer only. It relays SDP offers/answers and ICE
 * candidates between peers identified by machineId. Actual WebRTC data
 * channels are established client-side.
 *
 * Message flow:
 *   fleet_discover  → broadcast to all peers, each responds with capabilities
 *   fleet_offer     → forwarded to target peer by machineId
 *   fleet_answer    → forwarded to target peer by machineId
 *   fleet_ice_candidate → forwarded to target peer by machineId
 *   fleet_peer_joined   → broadcast when a new machine registers
 *   fleet_peer_left     → broadcast when a machine disconnects
 */

import { WebSocket, WebSocketServer } from 'ws'
import type {
  FleetMessage,
  FleetPeerInfo,
  FleetDiscoverMessage,
  FleetOfferMessage,
  FleetAnswerMessage,
  FleetIceCandidateMessage,
} from '../shared/types.js'

export interface FleetPeerEntry {
  ws: WebSocket
  machineId: string
  capabilities: string[]
  connectedAt: number
}

export class FleetSignaling {
  private wss: WebSocketServer
  private peers: Map<string, FleetPeerEntry> = new Map()
  private wsToPeer: Map<WebSocket, string> = new Map()

  constructor(wss: WebSocketServer) {
    this.wss = wss
  }

  /**
   * Register a peer connection. Called when a client sends its first
   * fleet message or an explicit registration message.
   */
  registerPeer(ws: WebSocket, machineId: string, capabilities: string[] = []): void {
    // If this machineId was already registered with a different socket, clean up
    const existing = this.peers.get(machineId)
    if (existing && existing.ws !== ws) {
      this.wsToPeer.delete(existing.ws)
    }

    const entry: FleetPeerEntry = {
      ws,
      machineId,
      capabilities,
      connectedAt: Date.now(),
    }

    this.peers.set(machineId, entry)
    this.wsToPeer.set(ws, machineId)

    // Broadcast peer_joined to all OTHER peers
    this.broadcastToPeers(
      {
        type: 'fleet_peer_joined',
        machineId,
        capabilities,
        timestamp: Date.now(),
      },
      machineId,
    )

    console.log(`[Fleet] Peer registered: ${machineId} (${this.peers.size} total)`)
  }

  /**
   * Handle a fleet_* message from a registered peer.
   */
  handleMessage(ws: WebSocket, machineId: string, message: FleetMessage): void {
    // Auto-register if not yet known
    if (!this.peers.has(machineId)) {
      this.registerPeer(ws, machineId)
    }

    switch (message.type) {
      case 'fleet_discover':
        this.handleDiscover(machineId, message as FleetDiscoverMessage)
        break

      case 'fleet_offer':
        this.relayToTarget(machineId, message as FleetOfferMessage)
        break

      case 'fleet_answer':
        this.relayToTarget(machineId, message as FleetAnswerMessage)
        break

      case 'fleet_ice_candidate':
        this.relayToTarget(machineId, message as FleetIceCandidateMessage)
        break

      default:
        console.log(`[Fleet] Unknown fleet message type: ${(message as any).type}`)
    }
  }

  /**
   * Handle peer disconnect. Called when a WebSocket closes.
   */
  handleDisconnect(ws: WebSocket): void {
    const machineId = this.wsToPeer.get(ws)
    if (!machineId) return

    this.peers.delete(machineId)
    this.wsToPeer.delete(ws)

    // Broadcast peer_left to remaining peers
    this.broadcastToPeers(
      {
        type: 'fleet_peer_left',
        machineId,
        timestamp: Date.now(),
      },
      machineId, // exclude (already gone, but for consistency)
    )

    console.log(`[Fleet] Peer disconnected: ${machineId} (${this.peers.size} remaining)`)
  }

  /**
   * Returns list of connected peers with metadata.
   */
  getPeers(): FleetPeerInfo[] {
    return Array.from(this.peers.values()).map((entry) => ({
      machineId: entry.machineId,
      capabilities: entry.capabilities,
      connectedAt: entry.connectedAt,
    }))
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * fleet_discover: respond with all connected peers' info.
   * Each peer sends back its own info to the requester.
   */
  private handleDiscover(fromMachineId: string, _message: FleetDiscoverMessage): void {
    const requester = this.peers.get(fromMachineId)
    if (!requester) return

    // Send the full peer list back to the requester
    const peerList = this.getPeers()
    this.sendTo(requester.ws, {
      type: 'fleet_discover',
      peers: peerList,
      timestamp: Date.now(),
    })
  }

  /**
   * Relay a message (offer/answer/ice_candidate) to a specific target peer.
   */
  private relayToTarget(fromMachineId: string, message: FleetOfferMessage | FleetAnswerMessage | FleetIceCandidateMessage): void {
    const targetId = message.targetMachineId
    const target = this.peers.get(targetId)

    if (!target || target.ws.readyState !== WebSocket.OPEN) {
      // Target not connected — notify sender
      const sender = this.peers.get(fromMachineId)
      if (sender && sender.ws.readyState === WebSocket.OPEN) {
        this.sendTo(sender.ws, {
          type: 'fleet_error' as any,
          error: `Peer not found: ${targetId}`,
          targetMachineId: targetId,
          timestamp: Date.now(),
        })
      }
      return
    }

    // Forward the message to the target, attaching the sender's machineId
    this.sendTo(target.ws, {
      ...message,
      fromMachineId,
    })
  }

  /**
   * Send a JSON message to a single WebSocket.
   */
  private sendTo(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Broadcast a message to all connected peers, optionally excluding one.
   */
  private broadcastToPeers(message: Record<string, unknown>, excludeMachineId?: string): void {
    const data = JSON.stringify(message)
    this.peers.forEach((entry, id) => {
      if (id === excludeMachineId) return
      if (entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(data)
      }
    })
  }
}
