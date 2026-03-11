import EventBus from '../core/event-bus.js'

export class InputManager {
  #boatKeysState = { up: false, left: false, down: false, right: false }
  #keyboardThrottle = 0
  #gamepadConnected = false
  #gamepadIndex = -1
  #GAMEPAD_DEADZONE = 0.12
  #isPaused = false  // tracks game state

  constructor(worker) {
    // Track game state
    EventBus.on('game:state-change', (state) => {
      this.#isPaused = (state !== 'PLAYING')
    })

    this.#initEventListeners()
  }

  #initEventListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.code === 'Escape') {
        EventBus.emit('input:escape')
        e.preventDefault()
        return
      }

      const k = e.key.toLowerCase()
      if (k === 'z') this.#boatKeysState.up = true
      if (k === 'q') this.#boatKeysState.left = true
      if (k === 's') this.#boatKeysState.down = true
      if (k === 'd') this.#boatKeysState.right = true
    })

    window.addEventListener('keyup', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k === 'z') this.#boatKeysState.up = false
      if (k === 'q') this.#boatKeysState.left = false
      if (k === 's') this.#boatKeysState.down = false
      if (k === 'd') this.#boatKeysState.right = false
    })

    window.addEventListener('gamepadconnected', (e) => {
      this.#gamepadConnected = true
      this.#gamepadIndex = e.gamepad.index
    })

    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.#gamepadIndex) {
        this.#gamepadConnected = false
        this.#gamepadIndex = -1
      }
    })
  }

  update(worker) {
    if (this.#isPaused) {
      this.#keyboardThrottle = 0
      return
    }

    // Throttle keyboard
    if (this.#boatKeysState.up) {
      this.#keyboardThrottle = Math.min(this.#keyboardThrottle + 0.08, 1.0)
    } else {
      this.#keyboardThrottle = Math.max(this.#keyboardThrottle - 0.20, 0)
    }

    // Gamepad
    let gpThrottle = 0, gpReverse = false, gpLeft = false, gpRight = false
    if (this.#gamepadConnected) {
      const gp = navigator.getGamepads()[this.#gamepadIndex]
      if (gp) {
        const stickX = Math.abs(gp.axes[0]) > this.#GAMEPAD_DEADZONE ? gp.axes[0] : 0
        const stickY = Math.abs(gp.axes[1]) > this.#GAMEPAD_DEADZONE ? gp.axes[1] : 0
        const rt = gp.buttons[7]?.value ?? 0
        const lt = gp.buttons[6]?.value ?? 0
        if (rt > 0.05) gpThrottle = rt
        else if (stickY < -0.05) gpThrottle = -stickY
        if (lt > 0.2) { gpReverse = true; gpThrottle = Math.max(gpThrottle, lt * 0.6) }
        else if (stickY > 0.2) { gpReverse = true; gpThrottle = Math.max(gpThrottle, stickY * 0.6) }
        gpLeft = stickX < -this.#GAMEPAD_DEADZONE
        gpRight = stickX > this.#GAMEPAD_DEADZONE
      }
    }

    const combinedThrottle = Math.min(Math.max(gpThrottle, this.#keyboardThrottle), 1.0)
    const up = this.#boatKeysState.up || gpThrottle > 0.05
    const down = this.#boatKeysState.down || gpReverse
    const left = this.#boatKeysState.left || gpLeft
    const right = this.#boatKeysState.right || gpRight

    // Only send if changed (same optimization as original boat-controls.js)
    const last = this.#last ?? {}
    if (last.up !== up || last.down !== down || last.left !== left || last.right !== right || last.throttle !== combinedThrottle) {
      this.#last = { up, down, left, right, throttle: combinedThrottle }
      worker.postMessage({ type: 'boatKeys', up, down, left, right, throttle: combinedThrottle })
    }
  }

  // Private field for change detection
  #last = null
}
