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
let frameDataDirty = false;
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
            boat: msg.boat || null,
            enemies: msg.enemies || [],
            playerBullets: msg.playerBullets || null,
            playerBulletCount: msg.playerBulletCount || 0,
            playerHP: msg.playerHP ?? 100,
            playerMaxHP: msg.playerMaxHP ?? 100,
            playerScore: msg.playerScore ?? 0,
            playerAlive: msg.playerAlive ?? true,
            playerLevel: msg.playerLevel ?? 1,
            playerXP: msg.playerXP ?? 0,
            playerXPToNext: msg.playerXPToNext ?? 50,
            gamePaused: msg.gamePaused ?? false,
            gameTime: msg.gameTime ?? 0
        };
        frameDataDirty = true;
    } else if (msg.type === 'wallsUpdated') {
        toolManager.walls = msg.walls;
    } else if (msg.type === 'enemyDestroyed') {
        toolManager.triggerExplosionVFX(msg.x, msg.y, 160);
    } else if (msg.type === 'playerHit') {
        toolManager.triggerExplosionVFX(msg.x, msg.y, 80);
    } else if (msg.type === 'playerDied') {
        toolManager.triggerExplosionVFX(msg.x, msg.y, 250);
    } else if (msg.type === 'levelUp') {
        showLevelUpUI(msg.level, msg.choices);
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

    // Upload latest frame data to GPU (skip if unchanged)
    if (latestFrameData && frameDataDirty) {
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
        frameDataDirty = false;
    }

    // Mise à jour des contrôles bateau (clavier + manette) chaque frame
    updateBoatControls();

    // Render WebGL
    renderer.render(dt);

    // Pass rigid body and boat data to tool manager for overlay
    if (latestFrameData) {
        toolManager.rigidBodiesData = latestFrameData.rigidBodies;
        toolManager.rigidBodyCount = latestFrameData.rigidBodyCount ?? 0;
        toolManager.boatData = latestFrameData.boat ?? null;
        toolManager.enemiesData = latestFrameData.enemies;
        toolManager.playerBulletsData = latestFrameData.playerBullets;
        toolManager.playerBulletCount = latestFrameData.playerBulletCount;
        toolManager.playerHP = latestFrameData.playerHP;
        toolManager.playerMaxHP = latestFrameData.playerMaxHP;
        toolManager.playerScore = latestFrameData.playerScore;
        toolManager.playerAlive = latestFrameData.playerAlive;
        toolManager.playerLevel = latestFrameData.playerLevel;
        toolManager.playerXP = latestFrameData.playerXP;
        toolManager.playerXPToNext = latestFrameData.playerXPToNext;
        toolManager.gamePaused = latestFrameData.gamePaused;
        toolManager.gameTime = latestFrameData.gameTime;
    }
    // Render overlay (tools, cursors, objects)
    toolManager.renderOverlay();
}

requestAnimationFrame(renderLoop);

// ==========================================
// LEVEL-UP UI
// ==========================================
const UPGRADE_INFO = {
    fireRate:    { name: 'Cadence +',      desc: 'Tir plus rapide',         icon: '⚡' },
    damage:      { name: 'Dégâts +',       desc: 'Balles plus puissantes',  icon: '💥' },
    bulletSpeed: { name: 'Vélocité +',     desc: 'Balles plus rapides',     icon: '🚀' },
    multishot:   { name: 'Multishot',      desc: '+1 balle par salve',      icon: '🔫' },
    piercing:    { name: 'Perçant',        desc: 'Traverse +1 ennemi',      icon: '🗡️' },
    maxHP:       { name: 'Vitalité +',     desc: '+25 HP max',              icon: '❤️' },
    regen:       { name: 'Régénération',   desc: 'Récupère des HP/sec',     icon: '💚' },
    bulletSize:  { name: 'Calibre +',      desc: 'Balles plus grosses',     icon: '⭕' }
};

function showLevelUpUI(level, choices) {
    const overlay = document.getElementById('levelup-overlay');
    const title = document.getElementById('levelup-title');
    const choicesContainer = document.getElementById('levelup-choices');

    title.textContent = `Niveau ${level} !`;
    choicesContainer.innerHTML = '';

    for (const choice of choices) {
        const info = UPGRADE_INFO[choice.id];
        if (!info) continue;
        const btn = document.createElement('button');
        btn.className = 'levelup-choice';
        btn.innerHTML = `
            <div class="levelup-icon">${info.icon}</div>
            <div class="levelup-name">${info.name}</div>
            <div class="levelup-desc">${info.desc}</div>
            <div class="levelup-level">Niv. ${choice.currentLevel} → ${choice.currentLevel + 1}</div>
        `;
        btn.addEventListener('click', () => {
            worker.postMessage({ type: 'applyUpgrade', upgradeId: choice.id });
            overlay.classList.add('hidden');
        });
        choicesContainer.appendChild(btn);
    }

    overlay.classList.remove('hidden');
}

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

function updateBoatControls() {
    // 1. Throttle clavier : montée/descente progressive (toujours actif)
    if (boatKeysState.up) {
        keyboardThrottle = Math.min(keyboardThrottle + 0.04, 1.0);
    } else {
        keyboardThrottle = Math.max(keyboardThrottle - 0.06, 0);
    }

    // 2. Lire la manette si connectée
    let gpThrottle = 0;
    let gpReverse = false;
    let gpLeft = false;
    let gpRight = false;

    if (gamepadConnected) {
        const gamepads = navigator.getGamepads();
        const gp = gamepads[gamepadIndex];
        if (gp) {
            // Stick gauche X → direction
            const stickX = Math.abs(gp.axes[0]) > GAMEPAD_DEADZONE ? gp.axes[0] : 0;
            // Stick gauche Y → alternative throttle (négatif = avant)
            const stickY = Math.abs(gp.axes[1]) > GAMEPAD_DEADZONE ? gp.axes[1] : 0;

            // Gâchettes : RT (bouton 7) = accélérer, LT (bouton 6) = reculer
            const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
            const lt = gp.buttons[6] ? gp.buttons[6].value : 0;

            if (rt > 0.05) {
                gpThrottle = rt;
            } else if (stickY < -0.05) {
                gpThrottle = -stickY;
            }
            if (lt > 0.2) {
                gpReverse = true;
                gpThrottle = Math.max(gpThrottle, lt * 0.6);
            } else if (stickY > 0.2) {
                gpReverse = true;
                gpThrottle = Math.max(gpThrottle, stickY * 0.6);
            }

            gpLeft = stickX < -GAMEPAD_DEADZONE;
            gpRight = stickX > GAMEPAD_DEADZONE;
        }
    }

    // 3. Combiner clavier + manette
    const combinedThrottle = Math.min(Math.max(gpThrottle, keyboardThrottle), 1.0);

    worker.postMessage({
        type: 'boatKeys',
        up: boatKeysState.up || gpThrottle > 0.05,
        down: boatKeysState.down || gpReverse,
        left: boatKeysState.left || gpLeft,
        right: boatKeysState.right || gpRight,
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
