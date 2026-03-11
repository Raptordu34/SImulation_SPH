import EventBus from '../core/event-bus.js'
import { States } from '../game/game-state.js'

export class GameOver {
  #overlay = null
  #gameState = null
  #player = null

  constructor(gameState, player) {
    this.#gameState = gameState
    this.#player = player
    this.#create()

    EventBus.on('player:died', () => {
      setTimeout(() => this.#show(), 800)
      this.#gameState.gameOver()
    })

    EventBus.on('game:state-change', (state) => {
      if (state !== States.GAMEOVER) {
        this.#hide()
      }
    })
  }

  #create() {
    const el = document.createElement('div')
    el.id = 'game-over-overlay'
    el.classList.add('hidden')
    el.style.cssText = 'position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);'
    el.innerHTML = `
      <div style="text-align:center;color:#e2e8f0;padding:32px;">
        <h2 style="font-size:3.5rem;font-weight:900;color:#ef4444;margin-bottom:8px;text-shadow:0 0 30px rgba(239,68,68,0.5);">Game Over</h2>
        <p id="go-score" style="font-size:1.3rem;color:#fbbf24;margin-bottom:4px;"></p>
        <p id="go-wave" style="font-size:1rem;color:#94a3b8;margin-bottom:4px;"></p>
        <p id="go-best" style="font-size:0.9rem;color:#60a5fa;margin-bottom:28px;"></p>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="go-restart" style="background:#2563eb;color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Rejouer</button>
          <button id="go-menu" style="background:#374151;color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Menu</button>
        </div>
      </div>
    `
    document.getElementById('canvas-container').appendChild(el)
    this.#overlay = el

    el.querySelector('#go-restart').addEventListener('click', () => {
      EventBus.emit('game:restart')
    })
    el.querySelector('#go-menu').addEventListener('click', () => {
      this.#gameState.transition(States.MENU)
    })
  }

  #show() {
    const score = this.#player.score
    const wave = this.#player.level  // approximate — could use waveManager but keep simple

    // Best score from localStorage
    const bestKey = 'naval-survivors-best'
    const best = parseInt(localStorage.getItem(bestKey) || '0', 10)
    if (score > best) localStorage.setItem(bestKey, String(score))
    const displayBest = Math.max(score, best)

    document.getElementById('go-score').textContent = `Score : ${score}`
    document.getElementById('go-wave').textContent = `Niveau ${this.#player.level}`
    document.getElementById('go-best').textContent = `Meilleur score : ${displayBest}`

    this.#overlay.classList.remove('hidden')
    this.#overlay.style.display = 'flex'
  }

  #hide() {
    this.#overlay.classList.add('hidden')
    this.#overlay.style.display = 'none'
  }
}
