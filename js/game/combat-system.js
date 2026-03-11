import EventBus from '../core/event-bus.js'

export class CombatSystem {
  projectiles = []  // { x, y, vx, vy, damage, radius, age, maxAge }
  #weaponCooldowns = {}
  #player = null
  #enemyManager = null
  #ramTimer = 0
  #RAM_RATE = 0.5  // seconds between ram damage ticks
  #RAM_DIST = 45   // pixels — contact distance for ramming

  constructor(player, enemyManager) {
    this.#player = player
    this.#enemyManager = enemyManager
  }

  update(dt, frameData) {
    if (!frameData?.boat) return

    // Auto-fire
    this.#autoFire(dt, frameData)

    // Move projectiles
    for (const p of this.projectiles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.age += dt
    }

    // Check projectile → enemy collisions
    this.#checkProjectileHits(frameData)

    // Remove expired projectiles
    this.projectiles = this.projectiles.filter(p => p.age < p.maxAge)

    // Ram damage: enemy touching player
    this.#ramTimer -= dt
    if (this.#ramTimer <= 0) {
      this.#checkRamDamage(frameData)
      this.#ramTimer = this.#RAM_RATE
    }
  }

  #autoFire(dt, frameData) {
    for (const weaponId of this.#player.weapons) {
      if (this.#weaponCooldowns[weaponId] === undefined) this.#weaponCooldowns[weaponId] = 0
      this.#weaponCooldowns[weaponId] -= dt

      if (this.#weaponCooldowns[weaponId] <= 0) {
        const target = this.#nearestEnemy(frameData)
        if (target) {
          this.#fire(weaponId, frameData.boat, target)
          const baseRate = weaponId === 'cannon' ? 1.5 : (weaponId === 'dualgun' ? 0.8 : 2.0)
          this.#weaponCooldowns[weaponId] = baseRate / this.#player.passiveStats.fireRateMult
        }
      }
    }
  }

  #fire(weaponId, boat, target) {
    const dx = target.x - boat.x
    const dy = target.y - boat.y
    const dist = Math.hypot(dx, dy)
    if (dist < 1) return
    const speed = 350
    const vx = (dx / dist) * speed
    const vy = (dy / dist) * speed
    const damage = 15 * this.#player.passiveStats.damageMult

    if (weaponId === 'dualgun') {
      // Two projectiles with slight spread
      const spread = 0.12
      this.projectiles.push({ x: boat.x, y: boat.y, vx: vx * Math.cos(spread) - vy * Math.sin(spread), vy: vx * Math.sin(spread) + vy * Math.cos(spread), damage, radius: 5, age: 0, maxAge: 3 })
      this.projectiles.push({ x: boat.x, y: boat.y, vx: vx * Math.cos(-spread) - vy * Math.sin(-spread), vy: vx * Math.sin(-spread) + vy * Math.cos(-spread), damage, radius: 5, age: 0, maxAge: 3 })
    } else {
      this.projectiles.push({ x: boat.x, y: boat.y, vx, vy, damage, radius: 5, age: 0, maxAge: 3 })
    }
  }

  #nearestEnemy(frameData) {
    if (!frameData.enemyBoats?.length) return null
    const { x, y } = frameData.boat
    let nearest = null, minDist = Infinity
    for (const eb of frameData.enemyBoats) {
      const d = Math.hypot(eb.x - x, eb.y - y)
      if (d < minDist) { minDist = d; nearest = eb }
    }
    return nearest
  }

  #checkProjectileHits(frameData) {
    if (!frameData.enemyBoats) return
    for (const p of this.projectiles) {
      if (p.age >= p.maxAge) continue
      for (const eb of frameData.enemyBoats) {
        const d = Math.hypot(eb.x - p.x, eb.y - p.y)
        if (d < p.radius + 22) {  // 22 = enemy hitbox approx radius
          this.#enemyManager.takeDamage(eb.id, p.damage)
          p.age = p.maxAge  // consume projectile
          break
        }
      }
    }
  }

  #checkRamDamage(frameData) {
    if (!frameData.enemyBoats) return
    for (const eb of frameData.enemyBoats) {
      const d = Math.hypot(eb.x - frameData.boat.x, eb.y - frameData.boat.y)
      if (d < this.#RAM_DIST) {
        const enemy = this.#enemyManager.enemies.get(eb.id)
        if (enemy) this.#player.takeDamage(enemy.config.damage * this.#RAM_RATE)
      }
    }
  }

  renderProjectiles(ctx) {
    if (!this.projectiles.length) return
    ctx.save()
    for (const p of this.projectiles) {
      if (p.age >= p.maxAge) continue
      // Glow
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(251, 191, 36, 0.25)'
      ctx.fill()
      // Core
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.fillStyle = '#fbbf24'
      ctx.fill()
    }
    ctx.restore()
  }

  reset() {
    this.projectiles = []
    this.#weaponCooldowns = {}
    this.#ramTimer = 0
  }
}
