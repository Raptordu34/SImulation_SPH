// ==========================================
// MAIN - Point d'entrée et orchestration
// ==========================================
import { Renderer } from './renderer.js';
import { ToolManager } from './tools.js';
import { Recorder } from './recorder.js';
import { UI } from './ui.js';

// ==========================================
// INITIALIZATION
// ==========================================
const container = document.getElementById('canvas-container');
const simCanvas = document.getElementById('simCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');

// Sizing
function getSize() {
    return {
        width: container.clientWidth,
        height: container.clientHeight
    };
}

let { width, height } = getSize();
simCanvas.width = width;
simCanvas.height = height;
overlayCanvas.width = width;
overlayCanvas.height = height;

// Set initial tool cursor
container.setAttribute('data-tool', 'push');

// ==========================================
// WEBGL2 RENDERER
// ==========================================
let renderer;
try {
    renderer = new Renderer(simCanvas);
} catch (e) {
    console.error('WebGL2 init failed:', e);
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:2rem;">
            <div>
                <h1 style="font-size:2rem;margin-bottom:1rem;">WebGL2 non disponible</h1>
                <p>Votre navigateur ne supporte pas WebGL2. Veuillez utiliser un navigateur moderne (Chrome, Firefox, Edge).</p>
            </div>
        </div>
    `;
    throw e;
}

// ==========================================
// WEB WORKER
// ==========================================
const worker = new Worker('js/physics-worker.js');

// Initialize worker
worker.postMessage({
    type: 'init',
    width,
    height
});

// ==========================================
// TOOLS, RECORDER, UI
// ==========================================
const toolManager = new ToolManager(worker, overlayCanvas);
const recorder = new Recorder(simCanvas);
const ui = new UI(worker, renderer, toolManager, recorder);

// ==========================================
// FRAME DATA RECEPTION
// ==========================================
let latestFrameData = null;
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

worker.onmessage = function(e) {
    const msg = e.data;
    if (msg.type === 'frame') {
        latestFrameData = {
            positions: msg.positions,
            densities: msg.densities,
            velocities: msg.velocities,
            foamPositions: msg.foamPositions,
            foamLife: msg.foamLife,
            foamSizes: msg.foamSizes || null,
            particleCount: msg.particleCount,
            foamCount: msg.foamCount,
            simFps: msg.simFps || 0,
            multiWorker: msg.multiWorker || false,
            workerCount: msg.workerCount || 0
        };
    } else if (msg.type === 'wallsUpdated') {
        toolManager.walls = msg.walls;
    }
};

// ==========================================
// RENDER LOOP
// ==========================================
let lastRenderTime = 0;

function renderLoop(timestamp) {
    requestAnimationFrame(renderLoop);

    const dt = Math.min((timestamp - lastRenderTime) / 1000, 0.05);
    lastRenderTime = timestamp;

    // FPS counter
    frameCount++;
    if (timestamp - lastFpsTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFpsTime = timestamp;

        const pc = latestFrameData ? latestFrameData.particleCount : 0;
        const fc = latestFrameData ? latestFrameData.foamCount : 0;
        const sf = latestFrameData ? latestFrameData.simFps : 0;
        const mw = latestFrameData ? latestFrameData.multiWorker : false;
        const wc = latestFrameData ? latestFrameData.workerCount : 0;
        ui.updateStats(currentFps, pc, fc, sf, mw, wc);
    }

    // Upload latest frame data to GPU
    if (latestFrameData) {
        renderer.updateParticleData(
            latestFrameData.positions,
            latestFrameData.densities,
            latestFrameData.velocities,
            latestFrameData.particleCount
        );
        renderer.updateFoamData(
            latestFrameData.foamPositions,
            latestFrameData.foamLife,
            latestFrameData.foamSizes,
            latestFrameData.foamCount
        );
    }

    // Render WebGL
    renderer.render(dt);

    // Render overlay (tools, cursors, objects)
    toolManager.renderOverlay();
}

requestAnimationFrame(renderLoop);

// ==========================================
// RESIZE HANDLER
// ==========================================
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const size = getSize();
        width = size.width;
        height = size.height;

        overlayCanvas.width = width;
        overlayCanvas.height = height;

        renderer.resize(width, height);
        worker.postMessage({ type: 'resize', width, height });
    }, 100);
});

// ==========================================
// GYROSCOPE (mobile)
// ==========================================
window.addEventListener('deviceorientation', (e) => {
    if (e.beta !== null && e.gamma !== null) {
        let tiltX = Math.max(-90, Math.min(90, e.gamma));
        let tiltY = Math.max(-90, Math.min(90, e.beta));

        worker.postMessage({
            type: 'params',
            gravityX: (tiltX / 90) * 2000,
            gravity: (tiltY / 90) * 2000
        });
    }
});
