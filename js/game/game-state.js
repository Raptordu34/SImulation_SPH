import EventBus from '../core/event-bus.js'

export const States = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  LEVELUP: 'LEVELUP',
  GAMEOVER: 'GAMEOVER',
}

export class GameState {
  #current = States.MENU

  transition(newState) {
    this.#current = newState
    EventBus.emit('game:state-change', newState)
  }

  get current() { return this.#current }

  start()    { this.transition(States.PLAYING) }
  pause()    { this.transition(States.PAUSED) }
  resume()   { this.transition(States.PLAYING) }
  levelUp()  { this.transition(States.LEVELUP) }
  gameOver() { this.transition(States.GAMEOVER) }
}
