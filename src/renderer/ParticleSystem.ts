/**
 * ParticleSystem - Simple particle effects for the battlefield
 *
 * Uses an object pool of Graphics-based particles for:
 * - burst: explosion of particles outward
 * - trail: particles along a line
 * - sparkle: gentle ambient sparkle
 */

import { Container, Graphics } from 'pixi.js'

interface Particle {
  graphic: Graphics
  vx: number
  vy: number
  life: number
  maxLife: number
  active: boolean
}

const POOL_SIZE = 200

export class ParticleSystem {
  private layer: Container
  private pool: Particle[] = []

  constructor(layer: Container) {
    this.layer = layer

    // Pre-allocate particle pool
    for (let i = 0; i < POOL_SIZE; i++) {
      const g = new Graphics()
      g.circle(0, 0, 2)
      g.fill({ color: 0xffffff })
      g.visible = false
      this.layer.addChild(g)

      this.pool.push({
        graphic: g,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0.5,
        active: false,
      })
    }
  }

  getParticle(): Particle | null {
    for (const p of this.pool) {
      if (!p.active) return p
    }
    return null
  }

  burst(x: number, y: number, color: number, count: number = 12): void {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle()
      if (!p) break

      const angle = Math.random() * Math.PI * 2
      const speed = 80 + Math.random() * 120

      p.graphic.clear()
      const size = 2 + Math.random() * 2
      p.graphic.circle(0, 0, size)
      p.graphic.fill({ color })
      p.graphic.x = x
      p.graphic.y = y
      p.graphic.alpha = 1
      p.graphic.visible = true
      p.graphic.scale.set(1)

      p.vx = Math.cos(angle) * speed
      p.vy = Math.sin(angle) * speed
      p.life = 0.4 + Math.random() * 0.3
      p.maxLife = p.life
      p.active = true
    }
  }

  trail(fromX: number, fromY: number, toX: number, toY: number, color: number): void {
    const dx = toX - fromX
    const dy = toY - fromY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const count = Math.min(20, Math.floor(dist / 20))

    for (let i = 0; i < count; i++) {
      const p = this.getParticle()
      if (!p) break

      const t = i / count
      p.graphic.clear()
      p.graphic.circle(0, 0, 2)
      p.graphic.fill({ color })
      p.graphic.x = fromX + dx * t + (Math.random() - 0.5) * 10
      p.graphic.y = fromY + dy * t + (Math.random() - 0.5) * 10
      p.graphic.alpha = 1
      p.graphic.visible = true
      p.graphic.scale.set(1)

      p.vx = (Math.random() - 0.5) * 20
      p.vy = (Math.random() - 0.5) * 20
      p.life = 0.3 + Math.random() * 0.3
      p.maxLife = p.life
      p.active = true
    }
  }

  sparkle(x: number, y: number, color: number): void {
    for (let i = 0; i < 5; i++) {
      const p = this.getParticle()
      if (!p) break

      p.graphic.clear()
      p.graphic.circle(0, 0, 1.5 + Math.random() * 1.5)
      p.graphic.fill({ color })
      p.graphic.x = x + (Math.random() - 0.5) * 30
      p.graphic.y = y + (Math.random() - 0.5) * 30
      p.graphic.alpha = 0.8
      p.graphic.visible = true
      p.graphic.scale.set(1)

      p.vx = (Math.random() - 0.5) * 10
      p.vy = -10 - Math.random() * 20
      p.life = 0.6 + Math.random() * 0.5
      p.maxLife = p.life
      p.active = true
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue

      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        p.graphic.visible = false
        continue
      }

      p.graphic.x += p.vx * dt
      p.graphic.y += p.vy * dt
      p.graphic.alpha = p.life / p.maxLife
      p.graphic.scale.set(p.life / p.maxLife)

      // Slow down
      p.vx *= 0.98
      p.vy *= 0.98
    }
  }
}
