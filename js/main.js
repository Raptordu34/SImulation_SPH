import { Renderer } from './core/renderer.js'
import { ToolManager } from './tools.js'
import { Recorder } from './engine/recorder.js'
import { UI } from './ui.js'
import { GameLoop } from './engine/game-loop.js'
import { InputManager } from './engine/input-manager.js'
import EventBus from './core/event-bus.js'

const container = document.getElementById('canvas-container')
const simCanvas = document.getElementById('simCanvas')
const overlayCanvas = document.getElementById('overlayCanvas')

function getSize() {
  return { width: container.clientWidth, height: container.clientHeight }
}

let { width, height } = getSize()
simCanvas.width = width; simCanvas.height = height
overlayCanvas.width = width; overlayCanvas.height = height
container.setAttribute('data-tool', 'boat')

let renderer
try {
  renderer = new Renderer(simCanvas)
} catch (e) {
  document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:2rem;"><div><h1 style="font-size:2rem;margin-bottom:1rem;">WebGL2 non disponible</h1><p>Votre navigateur ne supporte pas WebGL2.</p></div></div>`
  throw e
}

const worker = new Worker('js/core/physics-worker.js')
worker.postMessage({ type: 'init', width, height })

const toolManager = new ToolManager(worker, overlayCanvas)
const recorder = new Recorder(simCanvas)
const ui = new UI(worker, renderer, toolManager, recorder)
const inputManager = new InputManager(worker)
const gameLoop = new GameLoop(worker, renderer, toolManager, ui, inputManager)

// Escape key: toggle options overlay (wired to input:escape event)
EventBus.on('input:escape', () => {
  const overlay = document.getElementById('options-overlay')
  overlay.classList.toggle('hidden')
})

// Resize
let resizeTimeout
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout)
  resizeTimeout = setTimeout(() => {
    const size = getSize()
    width = size.width; height = size.height
    overlayCanvas.width = width; overlayCanvas.height = height
    renderer.resize(width, height)
    worker.postMessage({ type: 'resize', width, height })
  }, 100)
})

// Gyroscope
window.addEventListener('deviceorientation', (e) => {
  if (e.beta !== null && e.gamma !== null) {
    worker.postMessage({
      type: 'params',
      gravityX: (Math.max(-90, Math.min(90, e.gamma)) / 90) * 2000,
      gravity: (Math.max(-90, Math.min(90, e.beta)) / 90) * 2000
    })
  }
})

gameLoop.start()
