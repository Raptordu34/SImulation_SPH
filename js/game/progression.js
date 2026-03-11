import EventBus from '../core/event-bus.js'
import { UPGRADES } from '../config/upgrades.js'

export class Progression {
  #player = null
  #gameState = null

  constructor(player, gameState) {
    this.#player = player
    this.#gameState = gameState

    EventBus.on('player:leveled-up', ({ level }) => {
      const choices = this.#pickUpgrades(3)
      EventBus.emit('levelup:show', { level, choices })
      this.#gameState.levelUp()
    })

    EventBus.on('player:upgrade-chosen', (upgrade) => {
      if (upgrade) this.#player.applyUpgrade(upgrade)
      this.#gameState.resume()
    })
  }

  #pickUpgrades(n) {
    // Filter out weapons the player already owns
    const available = UPGRADES.filter(u => {
      if (u.type === 'weapon') return !this.#player.weapons.includes(u.id)
      return true  // passives can repeat
    })
    if (available.length === 0) return []
    const shuffled = [...available].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(n, shuffled.length))
  }

  reset() {
    // Nothing to reset — player state is reset elsewhere
  }
}
