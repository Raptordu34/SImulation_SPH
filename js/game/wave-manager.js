import EventBus from '../core/event-bus.js'
import { getWaveConfig } from './wave-config.js'

export class WaveManager {
  currentWave = 0
  #spawnTimers = []
  #enemyManager = null
  #canvasWidth = 800
  #canvasHeight = 600
  #waveComplete = false

  constructor(enemyManager) {
    this.#enemyManager = enemyManager
  }

  setCanvasSize(w, h) {
    this.#canvasWidth = w
    this.#canvasHeight = h
  }

  start() {
    this.currentWave = 0
    this.#nextWave()
  }

  reset() {
    this.currentWave = 0
    this.#spawnTimers = []
    this.#waveComplete = false
  }

  #nextWave() {
    this.currentWave++
    const config = getWaveConfig(this.currentWave)
    EventBus.emit('wave:started', { wave: this.currentWave })

    this.#spawnTimers = []
    if (config.enemies) {
      for (const group of config.enemies) {
        this.#spawnTimers.push({
          type: group.type,
          remaining: group.count,
          interval: group.interval,
          nextSpawn: 1000  // 1s initial delay
        })
      }
    }
    if (config.boss) {
      // Spawn boss immediately at random edge
      this.#spawnAtEdge(config.boss.type)
    }
    this.#waveComplete = false
  }

  update(dt) {
    const dtMs = dt * 1000

    // Update spawn timers
    let allSpawned = true
    for (const timer of this.#spawnTimers) {
      if (timer.remaining > 0) {
        allSpawned = false
        timer.nextSpawn -= dtMs
        if (timer.nextSpawn <= 0) {
          this.#spawnAtEdge(timer.type)
          timer.remaining--
          timer.nextSpawn = timer.interval
        }
      }
    }

    // Advance to next wave when all spawned and all enemies dead
    if (allSpawned && this.#enemyManager.enemies.size === 0 && !this.#waveComplete) {
      this.#waveComplete = true
      // Short delay before next wave
      setTimeout(() => this.#nextWave(), 3000)
    }
  }

  #spawnAtEdge(type) {
    const w = this.#canvasWidth
    const h = this.#canvasHeight
    const margin = 60
    const side = Math.floor(Math.random() * 4)
    let x, y
    if (side === 0) { x = margin + Math.random() * (w - 2 * margin); y = margin }
    else if (side === 1) { x = w - margin; y = margin + Math.random() * (h - 2 * margin) }
    else if (side === 2) { x = margin + Math.random() * (w - 2 * margin); y = h - margin }
    else { x = margin; y = margin + Math.random() * (h - 2 * margin) }
    this.#enemyManager.spawnEnemy(type, x, y)
  }
}
