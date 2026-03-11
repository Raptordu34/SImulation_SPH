import EventBus from '../core/event-bus.js'

export class Player {
  hp = 100; maxHp = 100
  xp = 0; level = 1; xpToNext = 50
  score = 0
  weapons = ['cannon']
  passiveStats = { damageMult: 1, speedMult: 1, fireRateMult: 1, maxHpBonus: 0 }

  reset() {
    this.hp = 100; this.maxHp = 100
    this.xp = 0; this.level = 1; this.xpToNext = 50
    this.score = 0
    this.weapons = ['cannon']
    this.passiveStats = { damageMult: 1, speedMult: 1, fireRateMult: 1, maxHpBonus: 0 }
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount)
    EventBus.emit('player:damaged', { hp: this.hp, maxHp: this.maxHp })
    if (this.hp <= 0) EventBus.emit('player:died')
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount)
    EventBus.emit('player:healed', { hp: this.hp })
  }

  gainXP(amount) {
    this.xp += amount
    if (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext
      this.level++
      this.xpToNext = Math.floor(this.xpToNext * 1.4)
      EventBus.emit('player:leveled-up', { level: this.level })
    }
    EventBus.emit('player:xp-gained', { xp: this.xp, xpToNext: this.xpToNext })
  }

  applyUpgrade(upgrade) {
    if (upgrade.type === 'passive') {
      const { stat, value } = upgrade.effect
      if (stat === 'maxHpBonus') {
        this.maxHp += value
        this.hp = Math.min(this.hp + value, this.maxHp)
        EventBus.emit('player:healed', { hp: this.hp })
      } else {
        this.passiveStats[stat] = (this.passiveStats[stat] || 1) * value
      }
    } else if (upgrade.type === 'weapon') {
      if (!this.weapons.includes(upgrade.id)) this.weapons.push(upgrade.id)
    }
  }
}
