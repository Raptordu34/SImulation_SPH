import EventBus from '../core/event-bus.js'
import { States } from '../game/game-state.js'

export class LevelUpScreen {
  #overlay = null

  constructor() {
    this.#overlay = document.getElementById('levelup-overlay')

    EventBus.on('levelup:show', ({ level, choices }) => {
      document.getElementById('levelup-title').textContent = `Niveau ${level} !`
      this.#renderChoices(choices)
      this.#overlay.classList.remove('hidden')
    })

    EventBus.on('game:state-change', (state) => {
      if (state !== States.LEVELUP) {
        this.#overlay.classList.add('hidden')
      }
    })
  }

  #renderChoices(choices) {
    const container = document.getElementById('levelup-choices')
    container.innerHTML = ''

    if (choices.length === 0) {
      // Fallback: just resume
      EventBus.emit('player:upgrade-chosen', null)
      return
    }

    for (const upgrade of choices) {
      const card = document.createElement('div')
      card.style.cssText = [
        'background:#1e3a5f',
        'border:2px solid #1d4ed8',
        'border-radius:12px',
        'padding:16px 20px',
        'min-width:140px',
        'max-width:180px',
        'cursor:pointer',
        'transition:border-color 0.15s,background 0.15s',
        'text-align:center',
        'color:#e2e8f0',
        'user-select:none'
      ].join(';')

      const icon = upgrade.type === 'weapon' ? '⚓' : '⬆'
      const desc = upgrade.description
        || (upgrade.effect ? `+${Math.round((upgrade.effect.value - 1) * 100)}%` : '')

      card.innerHTML = `
        <div style="font-size:1.5rem;margin-bottom:6px;">${icon}</div>
        <div style="font-size:0.95rem;font-weight:700;color:#fbbf24;margin-bottom:6px;">${upgrade.label}</div>
        <div style="font-size:0.75rem;color:#94a3b8;">${desc}</div>
      `

      card.addEventListener('mouseenter', () => {
        card.style.borderColor = '#60a5fa'
        card.style.background = '#1e40af'
      })
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = '#1d4ed8'
        card.style.background = '#1e3a5f'
      })
      card.addEventListener('click', () => {
        EventBus.emit('player:upgrade-chosen', upgrade)
      })

      container.appendChild(card)
    }
  }
}
