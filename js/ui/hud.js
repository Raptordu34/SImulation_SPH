import EventBus from '../core/event-bus.js'
import { States } from '../game/game-state.js'

export class HUD {
  #ctx
  #canvas
  #gameState

  // Shared game data (updated by game systems via EventBus or direct reference)
  data = {
    hp: 100, maxHp: 100,
    xp: 0, xpToNext: 50,
    level: 1,
    score: 0,
    wave: 0,
    gameTime: 0,       // seconds since game start
    enemyBoats: [],    // [{id, x, y}] from frameData for HP bars
    enemyHPs: new Map() // id → { hp, maxHp }
  }

  constructor(canvas, gameState) {
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    this.#gameState = gameState

    // Listen to player events to update data
    EventBus.on('player:damaged', ({ hp, maxHp }) => {
      this.data.hp = hp; this.data.maxHp = maxHp
    })
    EventBus.on('player:healed', ({ hp }) => { this.data.hp = hp })
    EventBus.on('player:xp-gained', ({ xp, xpToNext }) => {
      this.data.xp = xp; this.data.xpToNext = xpToNext
    })
    EventBus.on('player:leveled-up', ({ level }) => { this.data.level = level })
    EventBus.on('wave:started', ({ wave }) => { this.data.wave = wave; this.data.gameTime = 0 })
    EventBus.on('enemy:spawned', ({ id }) => {
      // HP data populated later by EnemyManager
    })
  }

  // Called directly by GameLoop after toolManager.renderOverlay()
  render(dt) {
    if (this.#gameState.current !== States.PLAYING && this.#gameState.current !== States.LEVELUP) return
    if (this.#gameState.current === States.PLAYING) {
      this.data.gameTime += dt
    }
    this.#drawHUD(this.#ctx, this.#canvas.width, this.#canvas.height)
  }

  #drawHUD(ctx, w, h) {
    // HP Bar (top-left)
    this.#drawBar(ctx, 16, 16, 200, 14, this.data.hp / this.data.maxHp, '#ef4444', '#22c55e', 'HP')

    // XP Bar (below HP)
    this.#drawBar(ctx, 16, 38, 200, 10, this.data.xp / this.data.xpToNext, '#1d4ed8', '#06b6d4', `Niv. ${this.data.level}`)

    // Score (top-right)
    ctx.save()
    ctx.font = 'bold 14px monospace'
    ctx.fillStyle = '#fbbf24'
    ctx.textAlign = 'right'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    ctx.fillText(`Score: ${this.data.score}`, w - 16, 30)

    // Wave indicator
    if (this.data.wave > 0) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px monospace'
      ctx.fillText(`Vague ${this.data.wave}`, w - 16, 50)
    }
    ctx.restore()

    // Enemy HP bars (above each enemy boat)
    if (this.data.enemyBoats.length > 0) {
      this.#drawEnemyBars(ctx)
    }
  }

  #drawBar(ctx, x, y, width, height, ratio, bgColor, fgColor, label) {
    ctx.save()
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.beginPath()
    ctx.roundRect(x - 1, y - 1, width + 2, height + 2, 3)
    ctx.fill()
    // Track
    ctx.fillStyle = bgColor + '40'  // 25% opacity
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 2)
    ctx.fill()
    // Fill
    const fillW = Math.max(0, Math.min(1, ratio)) * width
    if (fillW > 0) {
      ctx.fillStyle = fgColor
      ctx.beginPath()
      ctx.roundRect(x, y, fillW, height, 2)
      ctx.fill()
    }
    // Label
    if (label) {
      ctx.font = `bold ${height - 2}px monospace`
      ctx.fillStyle = '#fff'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 3
      ctx.textAlign = 'left'
      ctx.fillText(label, x + 4, y + height - 1)
    }
    ctx.restore()
  }

  #drawEnemyBars(ctx) {
    ctx.save()
    for (const eb of this.data.enemyBoats) {
      const hpData = this.data.enemyHPs.get(eb.id)
      if (!hpData) continue
      const ratio = hpData.hp / hpData.maxHp
      const barW = 40, barH = 5
      const bx = eb.x - barW / 2
      const by = eb.y - 30  // above the boat
      this.#drawBar(ctx, bx, by, barW, barH, ratio, '#7f1d1d', '#ef4444', null)
    }
    ctx.restore()
  }

  updateEnemyHP(id, hp, maxHp) {
    this.data.enemyHPs.set(id, { hp, maxHp })
  }

  removeEnemy(id) {
    this.data.enemyHPs.delete(id)
  }

  updateScore(score) { this.data.score = score }

  reset() {
    this.data.hp = 100; this.data.maxHp = 100
    this.data.xp = 0; this.data.xpToNext = 50
    this.data.level = 1
    this.data.score = 0
    this.data.wave = 0
    this.data.gameTime = 0
    this.data.enemyBoats = []
    this.data.enemyHPs.clear()
  }
}
