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
container.setAttribute('data-tool', 'boat');

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
            workerCount: msg.workerCount || 0,
            rigidBodies: msg.rigidBodies || null,
            rigidBodyCount: msg.rigidBodyCount ?? 0,
            boat: msg.boat || null
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

    // Poll manette chaque frame
    pollGamepad();

    // Render WebGL
    renderer.render(dt);

    // Pass rigid body and boat data to tool manager for overlay
    if (latestFrameData) {
        toolManager.rigidBodiesData = latestFrameData.rigidBodies;
        toolManager.rigidBodyCount = latestFrameData.rigidBodyCount ?? 0;
        toolManager.boatData = latestFrameData.boat ?? null;
    }
    // Render overlay (tools, cursors, objects)
    toolManager.renderOverlay();
}

requestAnimationFrame(renderLoop);

// ==========================================
// BATEAU — CONTRÔLE ZQSD + MANETTE
// ==========================================
const boatKeysState = { up: false, left: false, down: false, right: false, throttle: 0 };
let keyboardThrottle = 0; // Throttle progressif au clavier (0..1)

function sendBoatKeys() {
    worker.postMessage({ type: 'boatKeys', ...boatKeysState });
}
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    let changed = false;
    if (k === 'z') { changed = !boatKeysState.up; boatKeysState.up = true; }
    if (k === 'q') { changed = !boatKeysState.left; boatKeysState.left = true; }
    if (k === 's') { changed = !boatKeysState.down; boatKeysState.down = true; }
    if (k === 'd') { changed = !boatKeysState.right; boatKeysState.right = true; }
    if (changed && (k === 'z' || k === 'q' || k === 's' || k === 'd')) sendBoatKeys();
});
window.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    let changed = false;
    if (k === 'z') { changed = boatKeysState.up; boatKeysState.up = false; }
    if (k === 'q') { changed = boatKeysState.left; boatKeysState.left = false; }
    if (k === 's') { changed = boatKeysState.down; boatKeysState.down = false; }
    if (k === 'd') { changed = boatKeysState.right; boatKeysState.right = false; }
    if (changed) sendBoatKeys();
});

// ==========================================
// MANETTE (Gamepad API)
// ==========================================
// Mapping standard :
//   Stick gauche X (axes[0]) → direction gauche/droite
//   Gâchette droite (buttons[7]) → accélération (throttle variable)
//   Gâchette gauche (buttons[6]) → marche arrière
//   Stick gauche Y (axes[1]) → alternative accélération/freinage
let gamepadConnected = false;
let gamepadIndex = -1;

window.addEventListener('gamepadconnected', (e) => {
    gamepadConnected = true;
    gamepadIndex = e.gamepad.index;
    console.log(`Manette connectée : ${e.gamepad.id}`);
});
window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === gamepadIndex) {
        gamepadConnected = false;
        gamepadIndex = -1;
        console.log('Manette déconnectée');
    }
});

const GAMEPAD_DEADZONE = 0.12;

function pollGamepad() {
    if (!gamepadConnected) return;
    const gamepads = navigator.getGamepads();
    const gp = gamepads[gamepadIndex];
    if (!gp) return;

    // Stick gauche X → direction
    const stickX = Math.abs(gp.axes[0]) > GAMEPAD_DEADZONE ? gp.axes[0] : 0;
    // Stick gauche Y → alternative throttle (négatif = avant)
    const stickY = Math.abs(gp.axes[1]) > GAMEPAD_DEADZONE ? gp.axes[1] : 0;

    // Gâchettes : RT (bouton 7) = accélérer, LT (bouton 6) = reculer
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = gp.buttons[6] ? gp.buttons[6].value : 0;

    // Calcul du throttle : priorité aux gâchettes, sinon stick Y
    let gpThrottle = 0;
    let gpReverse = false;
    if (rt > 0.05) {
        gpThrottle = rt;
    } else if (stickY < -0.05) {
        gpThrottle = -stickY; // stick vers le haut = avancer
    }
    if (lt > 0.2) {
        gpReverse = true;
        gpThrottle = Math.max(gpThrottle, lt * 0.6);
    } else if (stickY > 0.2) {
        gpReverse = true;
        gpThrottle = Math.max(gpThrottle, stickY * 0.6);
    }

    // Direction gauche/droite
    const gpLeft = stickX < -GAMEPAD_DEADZONE;
    const gpRight = stickX > GAMEPAD_DEADZONE;

    // Combiner clavier + manette
    const combinedUp = boatKeysState.up || gpThrottle > 0.05;
    const combinedDown = boatKeysState.down || gpReverse;
    const combinedLeft = boatKeysState.left || gpLeft;
    const combinedRight = boatKeysState.right || gpRight;

    // Throttle clavier : montée/descente progressive
    if (boatKeysState.up) {
        keyboardThrottle = Math.min(keyboardThrottle + 0.04, 1.0);
    } else {
        keyboardThrottle = Math.max(keyboardThrottle - 0.06, 0);
    }
    const combinedThrottle = Math.min(Math.max(gpThrottle, keyboardThrottle), 1.0);

    worker.postMessage({
        type: 'boatKeys',
        up: combinedUp,
        down: combinedDown,
        left: combinedLeft,
        right: combinedRight,
        throttle: combinedThrottle
    });
}

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
