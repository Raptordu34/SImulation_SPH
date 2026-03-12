import EventBus from '../core/event-bus.js'

export class GameLoop {
  #worker
  #renderer
  #overlayCtx = null
  #toolManager
  #ui
  #inputManager
  #hud = null
  #enemyManager = null
  #combatSystem = null
  #waveManager = null
  #currentState = 'MENU'
  #paused = false
  #lastRenderTime = 0
  #frameCount = 0
  #lastFpsTime = 0
  #currentFps = 0

  // Latest frame data from worker — exposed so other systems can read it
  latestFrameData = null

  constructor(worker, renderer, overlayCanvas, toolManager, ui, inputManager) {
    this.#worker = worker
    this.#renderer = renderer
    this.#overlayCtx = overlayCanvas.getContext('2d')
    this.#toolManager = toolManager
    this.#ui = ui
    this.#inputManager = inputManager

    // Listen to worker messages
    worker.onmessage = (e) => this.#onWorkerMessage(e)

    // Listen for game state changes to pause/resume
    EventBus.on('game:state-change', (state) => {
      // The SPH simulation always runs. GameLoop only pauses game logic.
      // Rendering always continues (water visible behind menu).
      // We only gate inputManager calls on state.
      this.#currentState = state
    })
  }

  #onWorkerMessage(e) {
    const msg = e.data
    if (msg.type === 'frame') {
      this.latestFrameData = {
        positions: msg.positions,
        densities: msg.densities,
        velocities: msg.velocities,
        foamPositions: msg.foamPositions,
        foamLife: msg.foamLife,
        foamSizes: msg.foamSizes || null,
        particleCount: msg.particleCount,
        foamCount: msg.foamCount,
        simFps: msg.simFps || 0,
        simTime: msg.simTime || 0,
        multiWorker: msg.multiWorker || false,
        workerCount: msg.workerCount || 0,
        rigidBodies: msg.rigidBodies || null,
        rigidBodyCount: msg.rigidBodyCount ?? 0,
        boat: msg.boat || null,
        enemyBoats: msg.enemyBoats || []
      }
    } else if (msg.type === 'wallsUpdated') {
      this.#toolManager.walls = msg.walls
    }
  }

  #renderFrame(timestamp) {
    requestAnimationFrame((ts) => this.#renderFrame(ts))

    const dt = Math.min((timestamp - this.#lastRenderTime) / 1000, 0.05)
    this.#lastRenderTime = timestamp

    const fd = this.latestFrameData

    // Upload latest frame data to GPU
    if (fd) {
      this.#renderer.updateParticleData(fd.positions, fd.densities, fd.velocities, fd.particleCount)
      this.#renderer.updateFoamData(fd.foamPositions, fd.foamLife, fd.foamSizes, fd.foamCount)
    }

    // Input (boat controls) — inputManager handles paused state internally
    this.#inputManager.update(this.#worker)

    // Render WebGL
    const renderStart = performance.now()
    this.#renderer.render(dt)
    const renderTime = performance.now() - renderStart

    // FPS counter
    this.#frameCount++
    if (timestamp - this.#lastFpsTime >= 1000) {
      this.#currentFps = this.#frameCount
      this.#frameCount = 0
      this.#lastFpsTime = timestamp

      const pc = fd ? fd.particleCount : 0
      const fc = fd ? fd.foamCount : 0
      const sf = fd ? fd.simFps : 0
      const st = fd ? fd.simTime : 0
      const mw = fd ? fd.multiWorker : false
      const wc = fd ? fd.workerCount : 0
      this.#ui.updateStats(this.#currentFps, pc, fc, sf, mw, wc, st, renderTime)
    }

    // Tool manager overlay (pass rigid body + boat data)
    if (fd) {
      this.#toolManager.rigidBodiesData = fd.rigidBodies
      this.#toolManager.rigidBodyCount = fd.rigidBodyCount ?? 0
      this.#toolManager.boatData = this.#currentState === 'MENU' ? null : (fd.boat ?? null)
      this.#toolManager.enemyBoats = fd.enemyBoats ?? []
    }
    this.#toolManager.renderOverlay(dt)
    if (this.#hud) this.#hud.render(dt)

    // Update enemy manager, combat, and wave systems when playing
    if (this.#currentState === 'PLAYING') {
      this.#combatSystem?.renderProjectiles(this.#overlayCtx)
      this.#enemyManager?.update(dt, fd)
      this.#combatSystem?.update(dt, fd)
      this.#waveManager?.update(dt)
    }

    // Emit update event for game systems (enemies, combat, etc.)
    EventBus.emit('engine:update', { dt, frameData: fd })
  }

  setHUD(hud) { this.#hud = hud }
  setEnemyManager(em) { this.#enemyManager = em }
  setCombatSystem(cs) { this.#combatSystem = cs }
  setWaveManager(wm) { this.#waveManager = wm }

  start() {
    this.#lastFpsTime = performance.now()
    requestAnimationFrame((ts) => this.#renderFrame(ts))
  }
}
