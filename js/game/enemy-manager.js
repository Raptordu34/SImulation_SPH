import EventBus from '../core/event-bus.js'
import { ENEMY_TYPES } from '../config/enemies.js'

export class EnemyManager {
  enemies = new Map()  // id → { hp, maxHp, type, config }
  #worker = null
  #nextId = 1
  #hud = null  // reference to HUD for HP bar updates

  constructor(worker, hud) {
    this.#worker = worker
    this.#hud = hud
  }

  update(dt, frameData) {
    if (!frameData?.enemyBoats || !frameData?.boat) return
    const playerPos = frameData.boat
    const commands = []
    for (const eb of frameData.enemyBoats) {
      if (!this.enemies.has(eb.id)) continue
      const dx = playerPos.x - eb.x
      const dy = playerPos.y - eb.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1) continue
      const targetAngle = Math.atan2(dy, dx)
      let angleDiff = targetAngle - eb.angle
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
      // Steering: proportional to angle difference, clamped
      const steerStrength = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff) / Math.PI, 1.0) * 0.08
      commands.push({
        id: eb.id,
        thrust: dist > 60 ? 0.7 : 0.2,  // slow down when close
        steerAngle: steerStrength
      })
    }
    if (commands.length > 0) {
      this.#worker.postMessage({ type: 'updateEnemyBoats', commands })
    }
  }

  spawnEnemy(type, x, y) {
    const id = this.#nextId++
    const config = ENEMY_TYPES[type]
    this.#worker.postMessage({ type: 'addEnemyBoat', id, x, y })
    const entry = { hp: config.hp, maxHp: config.hp, type, config }
    this.enemies.set(id, entry)
    if (this.#hud) this.#hud.updateEnemyHP(id, entry.hp, entry.maxHp)
    EventBus.emit('enemy:spawned', { id, type })
    return id
  }

  killEnemy(id) {
    const enemy = this.enemies.get(id)
    if (!enemy) return
    this.enemies.delete(id)
    this.#worker.postMessage({ type: 'removeEnemyBoat', id })
    if (this.#hud) this.#hud.removeEnemy(id)
    EventBus.emit('enemy:died', { id, xpReward: enemy.config.xpReward })
  }

  takeDamage(id, amount) {
    const enemy = this.enemies.get(id)
    if (!enemy) return
    enemy.hp -= amount
    if (this.#hud) this.#hud.updateEnemyHP(id, enemy.hp, enemy.maxHp)
    if (enemy.hp <= 0) this.killEnemy(id)
  }

  reset() {
    for (const [id] of this.enemies) {
      this.#worker.postMessage({ type: 'removeEnemyBoat', id })
    }
    this.enemies.clear()
    this.#nextId = 1
  }
}
