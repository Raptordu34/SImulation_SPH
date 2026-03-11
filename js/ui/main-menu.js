import EventBus from '../core/event-bus.js'
import { States } from '../game/game-state.js'

export class MainMenu {
  #el = null
  #gameState = null

  constructor(gameState) {
    this.#gameState = gameState
    this.#create()

    EventBus.on('game:state-change', (state) => {
      if (state === States.MENU) {
        this.#show()
      } else {
        this.#hide()
      }
    })

    // Show initially since we start in MENU state
    this.#show()
  }

  #create() {
    const el = document.createElement('div')
    el.id = 'main-menu'
    el.style.cssText = 'position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);'
    el.innerHTML = `
      <div style="text-align:center;color:#e2e8f0;">
        <h1 style="font-size:3.5rem;font-weight:900;color:#06b6d4;margin-bottom:8px;text-shadow:0 0 40px rgba(6,182,212,0.5);">Naval Survivors</h1>
        <p style="font-size:1rem;color:#94a3b8;margin-bottom:48px;">SPH Fluid Combat</p>
        <button id="btn-play" style="background:#0891b2;color:#fff;border:none;padding:16px 48px;border-radius:12px;font-size:1.25rem;font-weight:700;cursor:pointer;transition:background 0.15s;letter-spacing:0.05em;">
          ▶  Jouer
        </button>
      </div>
    `
    const btn = el.querySelector('#btn-play')
    btn.addEventListener('mouseenter', () => btn.style.background = '#0e7490')
    btn.addEventListener('mouseleave', () => btn.style.background = '#0891b2')
    btn.addEventListener('click', () => EventBus.emit('game:start'))
    document.getElementById('canvas-container').appendChild(el)
    this.#el = el
  }

  #show() { this.#el.style.display = 'flex' }
  #hide() { this.#el.style.display = 'none' }
}
