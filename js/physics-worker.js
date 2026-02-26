// ==========================================
// SPH PHYSICS WEB WORKER (Coordinator)
// Multi-threaded with SharedArrayBuffer + single-threaded fallback
// ==========================================

const MAX_PARTICLES = 10000;
const MAX_FOAM = 2000;
const H = 35;
const H2 = H * H;
const PARTICLE_RADIUS = 9;
const REST_DENS = 3.0;
const DT = 0.014;
const SUBSTEPS = 2;
const WALL_STIFFNESS = 5000;
const MOUSE_RADIUS = 45;

// Dynamic physics parameters
let GAS_CONST = 3000;
let NEAR_GAS_CONST = 5000;
let SURFACE_TENSION = 1000;
let VISC = 5;
let GRAVITY_Y = 1200;
let GRAVITY_X = 0;

let width = 800, height = 600;
let cols, rows;
let particleCount = 0;
let foamCount = 0;

// ==========================================
// SHARED MEMORY LAYOUT
// ==========================================
const MAX_GRID_CELLS = 40000;
const CONTROL_INTS = 32;
const CONTROL_BYTES = CONTROL_INTS * 4;   // 128 bytes
const PARTICLE_OFFSET = CONTROL_BYTES;     // 128
const PARTICLE_ARRAYS = 10;               // x, y, vx, vy, fx, fy, density, nearDensity, pressure, nearPressure
const PARTICLE_BYTES = PARTICLE_ARRAYS * MAX_PARTICLES * 4; // 400000
const GRID_OFFSET = PARTICLE_OFFSET + PARTICLE_BYTES;       // 400128
const GRID_BYTES = (MAX_GRID_CELLS + MAX_PARTICLES) * 4;    // 200000
const PARAMS_OFFSET = GRID_OFFSET + GRID_BYTES;             // 600128
const PARAMS_FLOATS = 16;
const TOTAL_SHARED_BYTES = PARAMS_OFFSET + PARAMS_FLOATS * 4; // 600192

// Control indices
const CTRL_PHASE = 0;      // Incremented to signal sub-workers
const CTRL_DONE = 1;       // Atomic counter for barrier
const CTRL_PCOUNT = 2;     // particleCount
const CTRL_TASK = 3;       // 1=density, 2=forces
const CTRL_COLS = 4;
const CTRL_ROWS = 5;

// Params indices (Float32)
const PARAM_GAS = 0;
const PARAM_NEAR_GAS = 1;
const PARAM_SURFACE = 2;
const PARAM_VISC = 3;
const PARAM_GRAV_X = 4;
const PARAM_GRAV_Y = 5;
const PARAM_WIDTH = 6;
const PARAM_HEIGHT = 7;
const PARAM_WALL_STIFF = 8;

// ==========================================
// PARTICLE DATA (initialized in init as shared or local)
// ==========================================
let p_x, p_y, p_vx, p_vy, p_fx, p_fy;
let p_density, p_nearDensity, p_pressure, p_nearPressure;

// Foam particles (always local - not parallelized)
const foam_x = new Float32Array(MAX_FOAM);
const foam_y = new Float32Array(MAX_FOAM);
const foam_vx = new Float32Array(MAX_FOAM);
const foam_vy = new Float32Array(MAX_FOAM);
const foam_life = new Float32Array(MAX_FOAM);
const foam_size = new Float32Array(MAX_FOAM);

// Freeze state (local only)
const p_frozen = new Uint8Array(MAX_PARTICLES);

// Teleport cooldown
const p_teleportCD = new Float32Array(MAX_PARTICLES);

// Spatial hash grid
let cellHead;
let particleNext;

// Neighbor cache (single-threaded mode only)
const MAX_NEIGHBORS = MAX_PARTICLES * 40;
const neigh_i = new Int32Array(MAX_NEIGHBORS);
const neigh_j = new Int32Array(MAX_NEIGHBORS);
const neigh_r = new Float32Array(MAX_NEIGHBORS);
const neigh_q = new Float32Array(MAX_NEIGHBORS);
let neighborCount = 0;

// Pre-allocated transfer buffers
const transferPos = new Float32Array(MAX_PARTICLES * 2);
const transferDens = new Float32Array(MAX_PARTICLES);
const transferVel = new Float32Array(MAX_PARTICLES * 2);
const transferFoamPos = new Float32Array(MAX_FOAM * 2);
const transferFoamLife = new Float32Array(MAX_FOAM);
const transferFoamSize = new Float32Array(MAX_FOAM);

// Sim FPS tracking
let simFrameCount = 0;
let simFpsLastTime = performance.now();
let simFps = 0;

// Interaction state
const mouse = { x: -1000, y: -1000, active: false };
let activeTool = 'push';
let toolStrength = 500;

// Emitters, drains, walls
let emitters = [];
let drains = [];
let walls = [];
let forceFields = [];

// Explosions
let explosions = [];

// Portals
let portals = [];

// Rigid bodies
let rigidBodies = [];
const MAX_RIGID_BODIES = 20;
const RIGID_BODY_STIFFNESS = 5000;
const MAX_RB_FLOATS = 16;
const transferRigidBodies = new Float32Array(MAX_RIGID_BODIES * MAX_RB_FLOATS);

// Bateau joueur (vue dessus, 0G quand placé)
let boat = null;
let boatKeys = { up: false, left: false, down: false, right: false, throttle: 0 };
let gravityStored = null;
const BOAT_THRUST = 1150;
const BOAT_DRAG = 0.985;
const BOAT_HALF_W = 22;
const BOAT_HALF_H = 14;
const BOAT_COLLISION_STIFFNESS = 5000;
const BOAT_WATER_RESISTANCE = 0.012;      // Résistance par particule (faible car s'accumule)
const BOAT_MAX_WATER_FORCE = 600;          // Plafond de la force totale de l'eau sur le bateau
const BOAT_PROW_PUSH_FACTOR = 2.5;        // Multiplicateur de poussée à la proue (l'eau s'écarte)
const BOAT_MASS = 80;                      // Masse effective du bateau
const BOAT_MOTOR_BACK_OFFSET = 10;
const BOAT_MOTOR_DEPTH = 75;
const BOAT_MOTOR_WIDTH = 52;
const BOAT_WATER_CURRENT_FACTOR = 0.05;    // Reduced from 0.35 to minimize drift
const BOAT_WAVE_TORQUE_FACTOR = 0.00002;   // Reduced from 0.0003 to minimize unintended rotation

// Local gravity active state
let localGravityActive = false;

// Multi-worker state
let useMultiWorker = false;
let sharedBuffer = null;
let control = null;       // Int32Array on SharedArrayBuffer
let sharedParams = null;   // Float32Array on SharedArrayBuffer
let subWorkers = [];
let numSubWorkers = 0;
let subWorkersReady = 0;
let pendingSimStart = false;

// ==========================================
// FAST SQRT LOOKUP
// ==========================================
const SQRT_TABLE_SIZE = 1024;
const sqrtTable = new Float32Array(SQRT_TABLE_SIZE);
for (let i = 0; i < SQRT_TABLE_SIZE; i++) {
    sqrtTable[i] = Math.sqrt((i / SQRT_TABLE_SIZE) * H2);
}
function fastSqrt(r2) {
    if (r2 >= H2) return H;
    const idx = (r2 / H2 * SQRT_TABLE_SIZE) | 0;
    return sqrtTable[Math.min(idx, SQRT_TABLE_SIZE - 1)];
}

// Fast PRNG (xorshift32)
let rngState = 12345;
function xorshift() {
    rngState ^= rngState << 13;
    rngState ^= rngState >> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
}

// ==========================================
// INITIALIZATION
// ==========================================
function initArrays() {
    try {
        sharedBuffer = new SharedArrayBuffer(TOTAL_SHARED_BYTES);
        control = new Int32Array(sharedBuffer, 0, CONTROL_INTS);
        sharedParams = new Float32Array(sharedBuffer, PARAMS_OFFSET, PARAMS_FLOATS);

        // Particle arrays as views into SharedArrayBuffer
        p_x           = new Float32Array(sharedBuffer, PARTICLE_OFFSET,                        MAX_PARTICLES);
        p_y           = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 4,     MAX_PARTICLES);
        p_vx          = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 8,     MAX_PARTICLES);
        p_vy          = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 12,    MAX_PARTICLES);
        p_fx          = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 16,    MAX_PARTICLES);
        p_fy          = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 20,    MAX_PARTICLES);
        p_density     = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 24,    MAX_PARTICLES);
        p_nearDensity = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 28,    MAX_PARTICLES);
        p_pressure    = new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 32,    MAX_PARTICLES);
        p_nearPressure= new Float32Array(sharedBuffer, PARTICLE_OFFSET + MAX_PARTICLES * 36,    MAX_PARTICLES);

        // Grid arrays on SharedArrayBuffer
        cellHead      = new Int32Array(sharedBuffer, GRID_OFFSET, MAX_GRID_CELLS);
        particleNext  = new Int32Array(sharedBuffer, GRID_OFFSET + MAX_GRID_CELLS * 4, MAX_PARTICLES);

        useMultiWorker = true;
        initSubWorkers();
    } catch (e) {
        // SharedArrayBuffer not available (no COOP/COEP headers)
        // Fall back to local arrays
        p_x           = new Float32Array(MAX_PARTICLES);
        p_y           = new Float32Array(MAX_PARTICLES);
        p_vx          = new Float32Array(MAX_PARTICLES);
        p_vy          = new Float32Array(MAX_PARTICLES);
        p_fx          = new Float32Array(MAX_PARTICLES);
        p_fy          = new Float32Array(MAX_PARTICLES);
        p_density     = new Float32Array(MAX_PARTICLES);
        p_nearDensity = new Float32Array(MAX_PARTICLES);
        p_pressure    = new Float32Array(MAX_PARTICLES);
        p_nearPressure= new Float32Array(MAX_PARTICLES);

        cellHead      = new Int32Array(MAX_GRID_CELLS);
        particleNext  = new Int32Array(MAX_PARTICLES);

        useMultiWorker = false;
    }
}

function fallbackToSingleThread() {
    useMultiWorker = false;
    subWorkers.forEach(w => w.terminate());
    subWorkers = [];
    numSubWorkers = 0;
    subWorkersReady = 0;
    // Arrays (views into SharedArrayBuffer) still work fine for single-thread
}

function initSubWorkers() {
    // Use available cores minus 2 (main thread + this coordinator)
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    numSubWorkers = Math.max(2, Math.min(cores - 2, 10));
    subWorkersReady = 0;

    const sliceSize = Math.ceil(MAX_PARTICLES / numSubWorkers);

    for (let w = 0; w < numSubWorkers; w++) {
        const worker = new Worker('sub-worker.js');
        worker.onmessage = function(e) {
            if (e.data.type === 'ready') {
                subWorkersReady++;
                if (subWorkersReady === numSubWorkers && pendingSimStart) {
                    pendingSimStart = false;
                    simLoop();
                }
            }
        };
        worker.onerror = function(err) {
            console.error('Sub-worker failed:', err);
            fallbackToSingleThread();
            if (pendingSimStart) {
                pendingSimStart = false;
                simLoop();
            }
        };
        worker.postMessage({
            type: 'init',
            sharedBuffer: sharedBuffer,
            maxParticles: MAX_PARTICLES,
            maxGridCells: MAX_GRID_CELLS,
            particleOffset: PARTICLE_OFFSET,
            gridOffset: GRID_OFFSET,
            paramsOffset: PARAMS_OFFSET,
            startIdx: w * sliceSize,
            endIdx: Math.min((w + 1) * sliceSize, MAX_PARTICLES),
            workerId: w
        });
        subWorkers.push(worker);
    }

    // Timeout: if sub-workers not ready in 3s, fall back to single-thread
    setTimeout(() => {
        if (subWorkersReady < numSubWorkers) {
            console.warn('Sub-workers timeout, falling back to single thread');
            fallbackToSingleThread();
            if (pendingSimStart) {
                pendingSimStart = false;
                simLoop();
            }
        }
    }, 3000);
}

// ==========================================
// SHARED PARAMS SYNC
// ==========================================
function updateSharedParams() {
    sharedParams[PARAM_GAS] = GAS_CONST;
    sharedParams[PARAM_NEAR_GAS] = NEAR_GAS_CONST;
    sharedParams[PARAM_SURFACE] = SURFACE_TENSION;
    sharedParams[PARAM_VISC] = VISC;
    sharedParams[PARAM_GRAV_X] = GRAVITY_X;
    sharedParams[PARAM_GRAV_Y] = GRAVITY_Y;
    sharedParams[PARAM_WIDTH] = width;
    sharedParams[PARAM_HEIGHT] = height;
    sharedParams[PARAM_WALL_STIFF] = WALL_STIFFNESS;
}

// ==========================================
// MULTI-WORKER BARRIER
// ==========================================
function signalSubWorkers(taskType) {
    Atomics.store(control, CTRL_DONE, 0);
    Atomics.store(control, CTRL_PCOUNT, particleCount);
    Atomics.store(control, CTRL_TASK, taskType);
    Atomics.store(control, CTRL_COLS, cols);
    Atomics.store(control, CTRL_ROWS, rows);
    // Increment phase to wake all sub-workers
    Atomics.add(control, CTRL_PHASE, 1);
    Atomics.notify(control, CTRL_PHASE);
}

function waitBarrier() {
    // Spin-wait with Atomics.wait for done count to reach numSubWorkers
    while (Atomics.load(control, CTRL_DONE) < numSubWorkers) {
        Atomics.wait(control, CTRL_DONE, Atomics.load(control, CTRL_DONE), 1);
    }
}

// ==========================================
// GRID
// ==========================================
function updateGrid() {
    cellHead.fill(-1);
    for (let i = 0; i < particleCount; i++) {
        const cx = Math.max(0, Math.min(cols - 1, (p_x[i] / H) | 0));
        const cy = Math.max(0, Math.min(rows - 1, (p_y[i] / H) | 0));
        const cid = cx + cy * cols;
        particleNext[i] = cellHead[cid];
        cellHead[cid] = i;
    }
}

// ==========================================
// DENSITY & PRESSURE (single-threaded fallback)
// ==========================================
function computeDensityPressure() {
    neighborCount = 0;
    for (let i = 0; i < particleCount; i++) {
        let d = 0, nd = 0;
        const px = p_x[i], py = p_y[i];
        const cx = Math.max(0, Math.min(cols - 1, (px / H) | 0));
        const cy = Math.max(0, Math.min(rows - 1, (py / H) | 0));

        const cxMin = cx > 0 ? cx - 1 : 0;
        const cxMax = cx < cols - 1 ? cx + 1 : cols - 1;
        const cyMin = cy > 0 ? cy - 1 : 0;
        const cyMax = cy < rows - 1 ? cy + 1 : rows - 1;

        for (let ny = cyMin; ny <= cyMax; ny++) {
            for (let nx = cxMin; nx <= cxMax; nx++) {
                let j = cellHead[nx + ny * cols];
                while (j !== -1) {
                    if (i !== j) {
                        const dx = p_x[j] - px;
                        const dy = p_y[j] - py;
                        const r2 = dx * dx + dy * dy;
                        if (r2 < H2) {
                            const r = r2 < 1.0 ? Math.sqrt(r2) : fastSqrt(r2);
                            const q = 1.0 - r / H;
                            d += q * q;
                            nd += q * q * q;

                            if (neighborCount < MAX_NEIGHBORS) {
                                neigh_i[neighborCount] = i;
                                neigh_j[neighborCount] = j;
                                neigh_r[neighborCount] = r;
                                neigh_q[neighborCount] = q;
                                neighborCount++;
                            }
                        }
                    }
                    j = particleNext[j];
                }
            }
        }

        d += 1.0;
        nd += 1.0;
        if (d < 0.1) d = 0.1;

        p_density[i] = d;
        p_nearDensity[i] = nd;
        p_pressure[i] = Math.max(-GAS_CONST * 0.1, GAS_CONST * (d - REST_DENS));
        p_nearPressure[i] = NEAR_GAS_CONST * nd;
    }
}

// ==========================================
// FORCES (single-threaded fallback)
// ==========================================
function computeForces() {
    // Zero forces and apply gravity + wall forces
    for (let i = 0; i < particleCount; i++) {
        const px = p_x[i], py = p_y[i];

        const wallMargin = PARTICLE_RADIUS * 2;
        let wallFx = 0, wallFy = 0;
        if (px < wallMargin) wallFx += (wallMargin - px) * WALL_STIFFNESS;
        else if (px > width - wallMargin) wallFx -= (px - (width - wallMargin)) * WALL_STIFFNESS;
        if (py < wallMargin) wallFy += (wallMargin - py) * WALL_STIFFNESS;
        else if (py > height - wallMargin) wallFy -= (py - (height - wallMargin)) * WALL_STIFFNESS;

        // Custom wall segments
        for (let w = 0; w < walls.length; w++) {
            const wall = walls[w];
            const wdx = wall.x2 - wall.x1;
            const wdy = wall.y2 - wall.y1;
            const wLen2 = wdx * wdx + wdy * wdy;
            if (wLen2 < 0.01) continue;

            let t = ((px - wall.x1) * wdx + (py - wall.y1) * wdy) / wLen2;
            t = Math.max(0, Math.min(1, t));

            const closestX = wall.x1 + t * wdx;
            const closestY = wall.y1 + t * wdy;
            const distX = px - closestX;
            const distY = py - closestY;
            const dist2 = distX * distX + distY * distY;
            const wallThickness = wall.thickness || 8;
            const effectiveRadius = wallThickness + PARTICLE_RADIUS;

            if (dist2 < effectiveRadius * effectiveRadius && dist2 > 0.001) {
                const dist = Math.sqrt(dist2);
                const overlap = effectiveRadius - dist;
                const nx = distX / dist;
                const ny = distY / dist;
                wallFx += nx * overlap * WALL_STIFFNESS * 0.5;
                wallFy += ny * overlap * WALL_STIFFNESS * 0.5;
            }
        }

        p_fx[i] = wallFx + GRAVITY_X;
        p_fy[i] = wallFy + GRAVITY_Y;
    }

    // Iterate cached neighbor pairs
    for (let n = 0; n < neighborCount; n++) {
        const i = neigh_i[n];
        const j = neigh_j[n];
        const r = neigh_r[n];
        const q = neigh_q[n];

        let dx = p_x[j] - p_x[i];
        let dy = p_y[j] - p_y[i];

        let actualR = r;
        if (r < 0.001) {
            dx = (xorshift() - 0.5) * 0.1;
            dy = (xorshift() - 0.5) * 0.1;
            actualR = Math.sqrt(dx * dx + dy * dy);
            if (actualR < 0.001) actualR = 0.01;
        }

        const pDens = p_density[i];
        const avgPress = (p_pressure[i] + p_pressure[j]) * 0.5;
        const avgNearPress = (p_nearPressure[i] + p_nearPressure[j]) * 0.5;
        const cohesion = SURFACE_TENSION * q * (1.0 - q);
        const forcePress = (avgPress * q + avgNearPress * q * q) / pDens;
        const totalForce = forcePress - cohesion;
        const invR = 1.0 / actualR;

        p_fx[i] -= totalForce * dx * invR;
        p_fy[i] -= totalForce * dy * invR;

        const VISC_STABILITY_LIMIT = 0.5 / (DT / SUBSTEPS);
        const forceVisc = Math.min(VISC * q / pDens, VISC_STABILITY_LIMIT);
        p_fx[i] += forceVisc * (p_vx[j] - p_vx[i]);
        p_fy[i] += forceVisc * (p_vy[j] - p_vy[i]);
    }
}

// ==========================================
// CUSTOM WALL FORCES (multi-worker mode only)
// Applied after sub-workers compute particle + boundary forces
// ==========================================
function applyCustomWallForces() {
    if (walls.length === 0) return;
    for (let i = 0; i < particleCount; i++) {
        const px = p_x[i], py = p_y[i];
        for (let w = 0; w < walls.length; w++) {
            const wall = walls[w];
            const wdx = wall.x2 - wall.x1;
            const wdy = wall.y2 - wall.y1;
            const wLen2 = wdx * wdx + wdy * wdy;
            if (wLen2 < 0.01) continue;

            let t = ((px - wall.x1) * wdx + (py - wall.y1) * wdy) / wLen2;
            t = Math.max(0, Math.min(1, t));

            const closestX = wall.x1 + t * wdx;
            const closestY = wall.y1 + t * wdy;
            const distX = px - closestX;
            const distY = py - closestY;
            const dist2 = distX * distX + distY * distY;
            const wallThickness = wall.thickness || 8;
            const effectiveRadius = wallThickness + PARTICLE_RADIUS;

            if (dist2 < effectiveRadius * effectiveRadius && dist2 > 0.001) {
                const dist = Math.sqrt(dist2);
                const overlap = effectiveRadius - dist;
                const nx = distX / dist;
                const ny = distY / dist;
                p_fx[i] += nx * overlap * WALL_STIFFNESS * 0.5;
                p_fy[i] += ny * overlap * WALL_STIFFNESS * 0.5;
            }
        }
    }
}

// ==========================================
// RIGID BODY COLLISION DETECTION
// ==========================================
function collideParticleBox(px, py, body) {
    const dx = px - body.x, dy = py - body.y;
    const cosA = Math.cos(-body.angle), sinA = Math.sin(-body.angle);
    const lx = dx * cosA - dy * sinA;
    const ly = dx * sinA + dy * cosA;

    const clampX = Math.max(-body.halfW, Math.min(body.halfW, lx));
    const clampY = Math.max(-body.halfH, Math.min(body.halfH, ly));
    const distX = lx - clampX, distY = ly - clampY;
    const dist2 = distX * distX + distY * distY;

    if (dist2 < 0.001) {
        // Particle inside box
        const overlapX = body.halfW - Math.abs(lx);
        const overlapY = body.halfH - Math.abs(ly);
        let localNx, localNy, overlap;
        if (overlapX < overlapY) {
            localNx = lx > 0 ? 1 : -1; localNy = 0; overlap = overlapX + PARTICLE_RADIUS;
        } else {
            localNx = 0; localNy = ly > 0 ? 1 : -1; overlap = overlapY + PARTICLE_RADIUS;
        }
        const cosB = Math.cos(body.angle), sinB = Math.sin(body.angle);
        return { dist: overlap, nx: localNx * cosB - localNy * sinB, ny: localNx * sinB + localNy * cosB, clx: clampX, cly: clampY };
    }

    if (dist2 > PARTICLE_RADIUS * PARTICLE_RADIUS) return null;

    const dist = Math.sqrt(dist2);
    const overlap = PARTICLE_RADIUS - dist;
    const lnx = distX / dist, lny = distY / dist;
    const cosB = Math.cos(body.angle), sinB = Math.sin(body.angle);
    return { dist: overlap, nx: lnx * cosB - lny * sinB, ny: lnx * sinB + lny * cosB, clx: clampX, cly: clampY };
}

function collideParticleCircle(px, py, body) {
    const dx = px - body.x, dy = py - body.y;
    const dist2 = dx * dx + dy * dy;
    const effectiveR = body.radius + PARTICLE_RADIUS;
    if (dist2 > effectiveR * effectiveR) return null;
    if (dist2 < 0.001) return { dist: effectiveR, nx: 0, ny: -1, clx: 0, cly: -body.radius };
    const dist = Math.sqrt(dist2);
    return { dist: effectiveR - dist, nx: dx / dist, ny: dy / dist, clx: -dx / dist * body.radius, cly: -dy / dist * body.radius };
}

function collideParticleTriangle(px, py, body) {
    const dx = px - body.x, dy = py - body.y;
    const cosA = Math.cos(-body.angle), sinA = Math.sin(-body.angle);
    const lx = dx * cosA - dy * sinA;
    const ly = dx * sinA + dy * cosA;
    const verts = body.localVerts;

    let minDist2 = Infinity, closestX = 0, closestY = 0, inside = true;
    for (let i = 0; i < 3; i++) {
        const v0 = verts[i], v1 = verts[(i + 1) % 3];
        const ex = v1.x - v0.x, ey = v1.y - v0.y;
        if (ex * (ly - v0.y) - ey * (lx - v0.x) < 0) inside = false;
        const eLen2 = ex * ex + ey * ey;
        let t = eLen2 > 0.001 ? ((lx - v0.x) * ex + (ly - v0.y) * ey) / eLen2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = v0.x + t * ex, cy = v0.y + t * ey;
        const d2 = (lx - cx) * (lx - cx) + (ly - cy) * (ly - cy);
        if (d2 < minDist2) { minDist2 = d2; closestX = cx; closestY = cy; }
    }

    if (inside) {
        const dist = Math.sqrt(minDist2) || 0.001;
        const lnx = (lx - closestX) / dist, lny = (ly - closestY) / dist;
        const cosB = Math.cos(body.angle), sinB = Math.sin(body.angle);
        return { dist: dist + PARTICLE_RADIUS, nx: lnx * cosB - lny * sinB, ny: lnx * sinB + lny * cosB, clx: closestX, cly: closestY };
    }
    if (minDist2 > PARTICLE_RADIUS * PARTICLE_RADIUS) return null;
    const dist = Math.sqrt(minDist2);
    const lnx = (lx - closestX) / dist, lny = (ly - closestY) / dist;
    const cosB = Math.cos(body.angle), sinB = Math.sin(body.angle);
    return { dist: PARTICLE_RADIUS - dist, nx: lnx * cosB - lny * sinB, ny: lnx * sinB + lny * cosB, clx: closestX, cly: closestY };
}

// ==========================================
// RIGID BODY FORCES (two-way coupling)
// ==========================================
function applyRigidBodyForces() {
    if (rigidBodies.length === 0) return;

    // Reset forces, apply gravity
    for (let b = 0; b < rigidBodies.length; b++) {
        const body = rigidBodies[b];
        body.fx = GRAVITY_X * body.mass;
        body.fy = GRAVITY_Y * body.mass;
        body.torque = 0;
    }

    // Particle-body collisions
    for (let i = 0; i < particleCount; i++) {
        if (p_frozen[i]) continue;
        const px = p_x[i], py = p_y[i];

        for (let b = 0; b < rigidBodies.length; b++) {
            const body = rigidBodies[b];

            // AABB early out
            let bRadius;
            if (body.type === 'circle') bRadius = body.radius;
            else if (body.type === 'box') bRadius = Math.sqrt(body.halfW * body.halfW + body.halfH * body.halfH);
            else {
                let maxR2 = 0;
                for (let v = 0; v < 3; v++) maxR2 = Math.max(maxR2, body.localVerts[v].x * body.localVerts[v].x + body.localVerts[v].y * body.localVerts[v].y);
                bRadius = Math.sqrt(maxR2);
            }
            const ddx = px - body.x, ddy = py - body.y;
            const quickR = bRadius + PARTICLE_RADIUS + 5;
            if (ddx * ddx + ddy * ddy > quickR * quickR) continue;

            let col;
            if (body.type === 'box') col = collideParticleBox(px, py, body);
            else if (body.type === 'circle') col = collideParticleCircle(px, py, body);
            else col = collideParticleTriangle(px, py, body);
            if (!col) continue;

            // Spring force on particle
            const forceMag = col.dist * RIGID_BODY_STIFFNESS;
            p_fx[i] += col.nx * forceMag;
            p_fy[i] += col.ny * forceMag;

            // Contact point in world space
            const cosB = Math.cos(body.angle), sinB = Math.sin(body.angle);
            const rx = col.clx * cosB - col.cly * sinB;
            const ry = col.clx * sinB + col.cly * cosB;

            // Velocity damping
            const bodyVxC = body.vx - body.omega * ry;
            const bodyVyC = body.vy + body.omega * rx;
            const relVn = (p_vx[i] - bodyVxC) * col.nx + (p_vy[i] - bodyVyC) * col.ny;

            let totalFx = col.nx * forceMag;
            let totalFy = col.ny * forceMag;
            if (relVn < 0) {
                const dampF = -relVn * RIGID_BODY_STIFFNESS * 0.02;
                p_fx[i] += col.nx * dampF;
                p_fy[i] += col.ny * dampF;
                totalFx += col.nx * dampF;
                totalFy += col.ny * dampF;
            }

            // Reaction on body (Newton's 3rd law)
            body.fx -= totalFx;
            body.fy -= totalFy;
            body.torque -= rx * totalFy - ry * totalFx;
        }
    }

    // Buoyancy: count nearby particles
    for (let b = 0; b < rigidBodies.length; b++) {
        const body = rigidBodies[b];
        let bRadius;
        if (body.type === 'circle') bRadius = body.radius;
        else if (body.type === 'box') bRadius = Math.max(body.halfW, body.halfH);
        else {
            let maxR2 = 0;
            for (let v = 0; v < 3; v++) maxR2 = Math.max(maxR2, body.localVerts[v].x * body.localVerts[v].x + body.localVerts[v].y * body.localVerts[v].y);
            bRadius = Math.sqrt(maxR2);
        }
        const checkR = bRadius + H;
        const checkR2 = checkR * checkR;
        let submerged = 0;
        for (let i = 0; i < particleCount; i++) {
            const ddx = p_x[i] - body.x, ddy = p_y[i] - body.y;
            if (ddx * ddx + ddy * ddy < checkR2) submerged++;
        }
        body.fy -= submerged * 0.8 * GRAVITY_Y * (body.mass / 60.0);
    }
}

// ==========================================
// RIGID BODY INTEGRATION
// ==========================================
function integrateRigidBodies() {
    const dt = DT / SUBSTEPS;

    for (let b = 0; b < rigidBodies.length; b++) {
        const body = rigidBodies[b];

        body.vx += (body.fx / body.mass) * dt;
        body.vy += (body.fy / body.mass) * dt;
        body.omega += (body.torque / body.inertia) * dt;

        body.vx *= 0.999;
        body.vy *= 0.999;
        body.omega *= 0.995;

        const v2 = body.vx * body.vx + body.vy * body.vy;
        if (v2 > 1500 * 1500) { const r = 1500 / Math.sqrt(v2); body.vx *= r; body.vy *= r; }
        if (Math.abs(body.omega) > 20) body.omega = Math.sign(body.omega) * 20;

        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.angle += body.omega * dt;

        // Container wall collision via AABB
        let minX, maxX, minY, maxY;
        if (body.type === 'circle') {
            minX = body.x - body.radius; maxX = body.x + body.radius;
            minY = body.y - body.radius; maxY = body.y + body.radius;
        } else if (body.type === 'box') {
            const ca = Math.abs(Math.cos(body.angle)), sa = Math.abs(Math.sin(body.angle));
            const hw = body.halfW * ca + body.halfH * sa, hh = body.halfW * sa + body.halfH * ca;
            minX = body.x - hw; maxX = body.x + hw;
            minY = body.y - hh; maxY = body.y + hh;
        } else {
            const ca = Math.cos(body.angle), sa = Math.sin(body.angle);
            minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
            for (const v of body.localVerts) {
                const wx = body.x + v.x * ca - v.y * sa, wy = body.y + v.x * sa + v.y * ca;
                if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
                if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
            }
        }
        const margin = 5;
        if (minX < margin) { body.x += margin - minX; body.vx *= -0.3; body.omega *= 0.8; }
        if (maxX > width - margin) { body.x -= maxX - (width - margin); body.vx *= -0.3; body.omega *= 0.8; }
        if (minY < margin) { body.y += margin - minY; body.vy *= -0.3; body.omega *= 0.8; }
        if (maxY > height - margin) { body.y -= maxY - (height - margin); body.vy *= -0.3; body.omega *= 0.8; }

        body.angle = body.angle % (Math.PI * 2);
    }

    // Body-body collisions (bounding sphere)
    for (let i = 0; i < rigidBodies.length; i++) {
        for (let j = i + 1; j < rigidBodies.length; j++) {
            const a = rigidBodies[i], b = rigidBodies[j];
            const ddx = b.x - a.x, ddy = b.y - a.y;
            const dist2 = ddx * ddx + ddy * ddy;
            function bR(bd) {
                if (bd.type === 'circle') return bd.radius;
                if (bd.type === 'box') return Math.sqrt(bd.halfW * bd.halfW + bd.halfH * bd.halfH);
                let m = 0; for (const v of bd.localVerts) m = Math.max(m, v.x * v.x + v.y * v.y); return Math.sqrt(m);
            }
            const minDist = bR(a) + bR(b);
            if (dist2 > minDist * minDist || dist2 < 0.001) continue;
            const dist = Math.sqrt(dist2);
            const overlap = minDist - dist;
            const nx = ddx / dist, ny = ddy / dist;
            const tm = a.mass + b.mass;
            a.x -= nx * overlap * (b.mass / tm);
            a.y -= ny * overlap * (b.mass / tm);
            b.x += nx * overlap * (a.mass / tm);
            b.y += ny * overlap * (a.mass / tm);
            const relVn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (relVn > 0) continue;
            const imp = -(1.3) * relVn / (1 / a.mass + 1 / b.mass);
            a.vx += imp * nx / a.mass;
            a.vy += imp * ny / a.mass;
            b.vx -= imp * nx / b.mass;
            b.vy -= imp * ny / b.mass;
        }
    }
}

// ==========================================
// BATEAU — COUPLAGE FLUIDE (collision + moteur)
// ==========================================
function applyBoatForces() {
    if (!boat) return;
    boat.fx = 0;
    boat.fy = 0;
    boat.torqueFromWater = 0;

    const pseudoBody = { x: boat.x, y: boat.y, angle: boat.angle, halfW: BOAT_HALF_W, halfH: BOAT_HALF_H };
    const cosA = Math.cos(boat.angle), sinA = Math.sin(boat.angle);
    const boatR = Math.sqrt(BOAT_HALF_W * BOAT_HALF_W + BOAT_HALF_H * BOAT_HALF_H) + PARTICLE_RADIUS + 5;

    // --- 1. Calcul de la vitesse du bateau ---
    const boatSpeed = Math.sqrt(boat.vx * boat.vx + boat.vy * boat.vy);
    const speedFactor = Math.min(boatSpeed / 850, 1.0);

    // --- 2. Configuration de la force du "Vent" (Moteur/Sillage) ---
    const baseMotorForce = 15000;
    const dynamicMotorForce = baseMotorForce + (baseMotorForce * 2.5 * speedFactor);
    const stern = -BOAT_HALF_W - BOAT_MOTOR_BACK_OFFSET;

    // Accumulateurs pour courant environnant (vagues/courants)
    let waterVxSum = 0, waterVySum = 0;
    let waterWeightSum = 0;
    const currentDetectRadius = boatR + 60;
    const currentDetectR2 = currentDetectRadius * currentDetectRadius;

    // Accumulateur de résistance (sera plafonné)
    let resistFx = 0, resistFy = 0;

    for (let i = 0; i < particleCount; i++) {
        if (p_frozen[i]) continue;
        const px = p_x[i], py = p_y[i];
        const ddx = px - boat.x, ddy = py - boat.y;
        const dist2 = ddx * ddx + ddy * ddy;

        // Optimisation : on ignore les particules très lointaines
        if (dist2 > (boatR + 150) * (boatR + 150)) continue;

        // --- 3. Détection du courant environnant (vagues, courants) ---
        if (dist2 < currentDetectR2) {
            const w = 1.0 - Math.sqrt(dist2) / currentDetectRadius;
            waterVxSum += p_vx[i] * w;
            waterVySum += p_vy[i] * w;
            waterWeightSum += w;

            // Couple de rotation : les particules latérales font tourner le bateau
            const clx = ddx * Math.cos(-boat.angle) - ddy * Math.sin(-boat.angle);
            const cly = ddx * Math.sin(-boat.angle) + ddy * Math.cos(-boat.angle);
            const pLocalVy = -p_vx[i] * sinA + p_vy[i] * cosA;
            boat.torqueFromWater += cly * pLocalVy * BOAT_WAVE_TORQUE_FACTOR * w;
        }

        // --- 4. Collisions physiques avec la coque ---
        if (dist2 <= boatR * boatR) {
            const col = collideParticleBox(px, py, pseudoBody);
            if (col) {
                // Déterminer si la particule est devant le bateau (proue)
                const localX = ddx * cosA + ddy * sinA;
                const prowFactor = localX > 0 ? BOAT_PROW_PUSH_FACTOR : 1.0;

                // Pousser les particules : plus fort à la proue pour que l'eau s'écarte
                const forceMag = col.dist * BOAT_COLLISION_STIFFNESS * prowFactor;
                p_fx[i] += col.nx * forceMag;
                p_fy[i] += col.ny * forceMag;

                // Donner aux particules une vitesse d'écartement dans la direction du bateau
                // Cela simule le déplacement de l'eau par la coque
                if (boatSpeed > 30) {
                    const pushStrength = boatSpeed * 0.3 * prowFactor;
                    p_vx[i] += col.nx * pushStrength;
                    p_vy[i] += col.ny * pushStrength;
                }

                // Feedback sur le bateau (accumulation plafonnée)
                resistFx -= col.nx * col.dist * BOAT_COLLISION_STIFFNESS * BOAT_WATER_RESISTANCE;
                resistFy -= col.ny * col.dist * BOAT_COLLISION_STIFFNESS * BOAT_WATER_RESISTANCE;
            }
        }

        // --- 5. Effet "Vent" : Propulsion du moteur et remous ---
        const lx = ddx * Math.cos(-boat.angle) - ddy * Math.sin(-boat.angle);
        const ly = ddx * Math.sin(-boat.angle) + ddy * Math.cos(-boat.angle);

        const wakeLength = BOAT_MOTOR_DEPTH + (120 * speedFactor);
        const wakeWidth = BOAT_MOTOR_WIDTH + (30 * speedFactor);
        const behind = lx < stern && lx > stern - wakeLength && Math.abs(ly) < wakeWidth;

        if (behind && (boatKeys.throttle > 0 || boatKeys.down || boatSpeed > 50)) {
            const dir = boatKeys.down ? -1 : 1;
            const throttleScale = boatKeys.throttle > 0 ? boatKeys.throttle : (boatSpeed > 50 ? speedFactor * 0.5 : 0);

            p_fx[i] -= cosA * dynamicMotorForce * dir * throttleScale;
            p_fy[i] -= sinA * dynamicMotorForce * dir * throttleScale;

            // --- 6. Feedback Visuel : Mousse ---
            const effectiveSpeedFactor = Math.max(speedFactor, boatKeys.throttle);
            const foamThreshold = 0.96 - (0.45 * effectiveSpeedFactor);
            if (xorshift() > foamThreshold && foamCount < MAX_FOAM) {
                foam_x[foamCount] = px;
                foam_y[foamCount] = py;

                const ejectSpeed = 250 + 450 * effectiveSpeedFactor;
                foam_vx[foamCount] = p_vx[i] * 0.2 - cosA * ejectSpeed * dir + (xorshift() - 0.5) * 150;
                foam_vy[foamCount] = p_vy[i] * 0.2 - sinA * ejectSpeed * dir + (xorshift() - 0.5) * 150;

                foam_life[foamCount] = 0.5 + xorshift() * (0.3 + effectiveSpeedFactor * 0.6);
                foam_size[foamCount] = 0.8 + xorshift() * (0.8 + effectiveSpeedFactor * 1.5);

                foamCount++;
            }
        }
    }

    // --- 7. Plafonner et appliquer la résistance de l'eau ---
    const resistMag = Math.sqrt(resistFx * resistFx + resistFy * resistFy);
    if (resistMag > BOAT_MAX_WATER_FORCE) {
        const scale = BOAT_MAX_WATER_FORCE / resistMag;
        resistFx *= scale;
        resistFy *= scale;
    }
    boat.fx += resistFx;
    boat.fy += resistFy;

    // --- 8. Appliquer la force des courants/vagues sur le bateau ---
    // Utilise la moyenne pondérée (pas linéaire en nb de particules)
    if (waterWeightSum > 0.1) {
        const avgWaterVx = waterVxSum / waterWeightSum;
        const avgWaterVy = waterVySum / waterWeightSum;
        // Force proportionnelle à la vitesse relative, échelle sous-linéaire
        const currentScale = BOAT_WATER_CURRENT_FACTOR * Math.sqrt(waterWeightSum);
        boat.fx += (avgWaterVx - boat.vx) * currentScale / BOAT_MASS;
        boat.fy += (avgWaterVy - boat.vy) * currentScale / BOAT_MASS;
    }
}

// ==========================================
// BATEAU JOUEUR (ZQSD, vue dessus, 0G)
// ==========================================
function integrateBoat() {
    if (!boat) return;
    const dt = DT / SUBSTEPS;

    // Logique de gouvernail et de moteur avec puissance variable
    let thrust = 0;
    let turnSpeed = 0;
    const throttle = boatKeys.throttle || 0; // 0..1 puissance variable

    if (throttle > 0) thrust += BOAT_THRUST * throttle;
    if (boatKeys.down) thrust -= BOAT_THRUST * 0.4 * Math.max(throttle, 0.5);
    if (boatKeys.left) turnSpeed -= 3.5;
    if (boatKeys.right) turnSpeed += 3.5;

    // Le bateau ne peut tourner efficacement que s'il a de la vitesse
    const speed = Math.sqrt(boat.vx * boat.vx + boat.vy * boat.vy);
    const speedFactor = Math.min(speed / 200, 1.0);

    // Rotation : gouvernail + couple des vagues
    const actualTurn = turnSpeed * (0.3 + 0.7 * speedFactor);
    boat.angle += actualTurn * dt;
    // Les vagues/courants appliquent un couple sur le bateau
    boat.angle += (boat.torqueFromWater || 0) * dt;

    // Vecteur de direction
    const cosA = Math.cos(boat.angle);
    const sinA = Math.sin(boat.angle);

    // Accélération dans la direction du bateau (thrust = accélération directe)
    // Forces de l'eau (boat.fx) = forces, divisées par la masse pour obtenir l'accélération
    const ax = cosA * thrust + (boat.fx || 0) / BOAT_MASS;
    const ay = sinA * thrust + (boat.fy || 0) / BOAT_MASS;

    boat.vx += ax * dt;
    boat.vy += ay * dt;

    // Friction latérale (pour éviter que le bateau "glisse" de côté)
    const forwardVel = boat.vx * cosA + boat.vy * sinA;
    const lateralVel = boat.vx * -sinA + boat.vy * cosA;

    const dampedLateral = lateralVel * 0.92;
    const dampedForward = forwardVel * BOAT_DRAG;

    boat.vx = dampedForward * cosA - dampedLateral * sinA;
    boat.vy = dampedForward * sinA + dampedLateral * cosA;

    const maxSpeed = 850;
    const v2 = boat.vx * boat.vx + boat.vy * boat.vy;
    if (v2 > maxSpeed * maxSpeed) {
        const r = maxSpeed / Math.sqrt(v2);
        boat.vx *= r;
        boat.vy *= r;
    }

    boat.x += boat.vx * dt;
    boat.y += boat.vy * dt;

    // Rebond sur les bords
    const margin = 2;
    if (boat.x - BOAT_HALF_W < margin) { boat.x = margin + BOAT_HALF_W; boat.vx *= -0.4; }
    if (boat.x + BOAT_HALF_W > width - margin) { boat.x = width - margin - BOAT_HALF_W; boat.vx *= -0.4; }
    if (boat.y - BOAT_HALF_H < margin) { boat.y = margin + BOAT_HALF_H; boat.vy *= -0.4; }
    if (boat.y + BOAT_HALF_H > height - margin) { boat.y = height - margin - BOAT_HALF_H; boat.vy *= -0.4; }
}

// ==========================================
// INTEGRATION
// ==========================================
function integrate() {
    const BOUNDARY_DAMPING = -0.3;
    const dt = DT / SUBSTEPS;
    const vitesseMax = 1500;
    const vitesseMax2 = vitesseMax * vitesseMax;

    // Update explosions
    for (let e = explosions.length - 1; e >= 0; e--) {
        explosions[e].age += dt;
        if (explosions[e].age > explosions[e].maxAge) {
            explosions.splice(e, 1);
        }
    }

    // Decrease teleport cooldowns
    for (let i = 0; i < particleCount; i++) {
        if (p_teleportCD[i] > 0) p_teleportCD[i] -= dt;
    }

    for (let i = 0; i < particleCount; i++) {
        // Frozen particles: zero velocity, skip movement
        if (p_frozen[i]) {
            p_vx[i] = 0;
            p_vy[i] = 0;
            continue;
        }

        p_vx[i] += p_fx[i] * dt;
        p_vy[i] += p_fy[i] * dt;
        p_vx[i] *= 0.999;
        p_vy[i] *= 0.999;

        const v2 = p_vx[i] * p_vx[i] + p_vy[i] * p_vy[i];
        if (v2 > vitesseMax2) {
            const ratio = vitesseMax / Math.sqrt(v2);
            p_vx[i] *= ratio;
            p_vy[i] *= ratio;
        }

        // Explosion forces
        for (let e = 0; e < explosions.length; e++) {
            const exp = explosions[e];
            const edx = p_x[i] - exp.x;
            const edy = p_y[i] - exp.y;
            const eDist2 = edx * edx + edy * edy;
            if (eDist2 < exp.radius * exp.radius && eDist2 > 1) {
                const eDist = Math.sqrt(eDist2);
                const falloff = 1.0 - eDist / exp.radius;
                const ageRatio = 1.0 - exp.age / exp.maxAge;
                const force = exp.strength * falloff * falloff * ageRatio;
                p_vx[i] += (edx / eDist) * force * dt;
                p_vy[i] += (edy / eDist) * force * dt;
            }
        }

        // Local gravity tool
        if (mouse.active && activeTool === 'localGravity') {
            const mdx = mouse.x - p_x[i];
            const mdy = mouse.y - p_y[i];
            const mDist2 = mdx * mdx + mdy * mdy;
            const wellRadius = 180;
            if (mDist2 < wellRadius * wellRadius && mDist2 > 100) {
                const mDist = Math.sqrt(mDist2);
                const force = toolStrength * 3.0 / (mDist * 0.5);
                p_vx[i] += (mdx / mDist) * force * dt;
                p_vy[i] += (mdy / mDist) * force * dt;
            }
        }

        p_x[i] += p_vx[i] * dt;
        p_y[i] += p_vy[i] * dt;

        // Mouse obstacle
        if (mouse.active && activeTool === 'push') {
            const mdx = p_x[i] - mouse.x;
            const mdy = p_y[i] - mouse.y;
            const mDist2 = mdx * mdx + mdy * mdy;
            if (mDist2 < MOUSE_RADIUS * MOUSE_RADIUS) {
                let mDist = Math.sqrt(mDist2);
                if (mDist === 0) mDist = 1;
                const nx = mdx / mDist;
                const ny = mdy / mDist;
                p_x[i] = mouse.x + nx * MOUSE_RADIUS;
                p_y[i] = mouse.y + ny * MOUSE_RADIUS;
                p_vx[i] += nx * 300;
                p_vy[i] += ny * 300;

                if (v2 > 100000 && foamCount < MAX_FOAM) {
                    foam_x[foamCount] = p_x[i];
                    foam_y[foamCount] = p_y[i];
                    foam_vx[foamCount] = p_vx[i] * 0.5 + (xorshift() - 0.5) * 200;
                    foam_vy[foamCount] = p_vy[i] * 0.5 - xorshift() * 300;
                    foam_life[foamCount] = 1.0;
                    foam_size[foamCount] = 0.8 + xorshift() * 0.8;
                    foamCount++;
                }
            }
        }

        // Vortex tool
        if (mouse.active && activeTool === 'vortex') {
            const mdx = p_x[i] - mouse.x;
            const mdy = p_y[i] - mouse.y;
            const mDist2 = mdx * mdx + mdy * mdy;
            const vortexRadius = 120;
            if (mDist2 < vortexRadius * vortexRadius && mDist2 > 1) {
                const mDist = Math.sqrt(mDist2);
                const strength = toolStrength * (1.0 - mDist / vortexRadius);
                p_vx[i] += (-mdy / mDist) * strength * dt;
                p_vy[i] += (mdx / mDist) * strength * dt;
            }
        }

        // Wind tool
        if (mouse.active && activeTool === 'wind') {
            const mdx = p_x[i] - mouse.x;
            const mdy = p_y[i] - mouse.y;
            const mDist2 = mdx * mdx + mdy * mdy;
            const windRadius = 150;
            if (mDist2 < windRadius * windRadius) {
                p_vx[i] += toolStrength * dt;
            }
        }

        // Attractor tool
        if (mouse.active && activeTool === 'attractor') {
            const mdx = mouse.x - p_x[i];
            const mdy = mouse.y - p_y[i];
            const mDist2 = mdx * mdx + mdy * mdy;
            const attractRadius = 200;
            if (mDist2 < attractRadius * attractRadius && mDist2 > 1) {
                const mDist = Math.sqrt(mDist2);
                const strength = toolStrength * 2;
                p_vx[i] += (mdx / mDist) * strength * dt;
                p_vy[i] += (mdy / mDist) * strength * dt;
            }
        }

        // Boundary clamping
        if (p_x[i] - PARTICLE_RADIUS < 0) {
            p_x[i] = PARTICLE_RADIUS;
            p_vx[i] *= BOUNDARY_DAMPING;
        } else if (p_x[i] + PARTICLE_RADIUS > width) {
            p_x[i] = width - PARTICLE_RADIUS;
            p_vx[i] *= BOUNDARY_DAMPING;
        }
        if (p_y[i] - PARTICLE_RADIUS < 0) {
            p_y[i] = PARTICLE_RADIUS;
            p_vy[i] *= BOUNDARY_DAMPING;
        } else if (p_y[i] + PARTICLE_RADIUS > height) {
            p_y[i] = height - PARTICLE_RADIUS;
            p_vy[i] *= BOUNDARY_DAMPING;

            if (Math.abs(p_vy[i]) > 100 && foamCount < MAX_FOAM) {
                foam_x[foamCount] = p_x[i];
                foam_y[foamCount] = p_y[i] - PARTICLE_RADIUS;
                foam_vx[foamCount] = (xorshift() - 0.5) * 150;
                foam_vy[foamCount] = -xorshift() * 200;
                foam_life[foamCount] = 0.8;
                foam_size[foamCount] = 0.5 + xorshift() * 0.5;
                foamCount++;
            }
        }

        // Foam from high acceleration (splashing)
        const accel2 = p_fx[i] * p_fx[i] + p_fy[i] * p_fy[i];
        if (accel2 > 800000 && foamCount < MAX_FOAM && xorshift() > 0.85) {
            foam_x[foamCount] = p_x[i];
            foam_y[foamCount] = p_y[i];
            foam_vx[foamCount] = p_vx[i] * 0.3 + (xorshift() - 0.5) * 150;
            foam_vy[foamCount] = p_vy[i] * 0.3 - xorshift() * 200;
            foam_life[foamCount] = 0.5 + xorshift() * 0.5;
            // Size variation: small = bubble, medium = spray, large = splash
            const sizeRand = xorshift();
            if (sizeRand < 0.3) foam_size[foamCount] = 0.3 + xorshift() * 0.3; // bubble
            else if (sizeRand < 0.7) foam_size[foamCount] = 0.7 + xorshift() * 0.5; // spray
            else foam_size[foamCount] = 1.3 + xorshift() * 0.7; // splash
            foamCount++;
        }

        // Teleporter portals
        if (p_teleportCD[i] <= 0) {
            for (let pp = 0; pp < portals.length; pp++) {
                const pair = portals[pp];
                const dx1 = p_x[i] - pair.p1x;
                const dy1 = p_y[i] - pair.p1y;
                if (dx1 * dx1 + dy1 * dy1 < pair.r2) {
                    p_x[i] = pair.p2x + dx1;
                    p_y[i] = pair.p2y + dy1;
                    p_teleportCD[i] = 0.15;
                    break;
                }
                const dx2 = p_x[i] - pair.p2x;
                const dy2 = p_y[i] - pair.p2y;
                if (dx2 * dx2 + dy2 * dy2 < pair.r2) {
                    p_x[i] = pair.p1x + dx2;
                    p_y[i] = pair.p1y + dy2;
                    p_teleportCD[i] = 0.15;
                    break;
                }
            }
        }
    }

    // Drain processing
    for (let d = 0; d < drains.length; d++) {
        const drain = drains[d];
        const r2 = drain.radius * drain.radius;
        for (let i = particleCount - 1; i >= 0; i--) {
            const dx = p_x[i] - drain.x;
            const dy = p_y[i] - drain.y;
            if (dx * dx + dy * dy < r2) {
                particleCount--;
                if (i < particleCount) {
                    p_x[i] = p_x[particleCount];
                    p_y[i] = p_y[particleCount];
                    p_vx[i] = p_vx[particleCount];
                    p_vy[i] = p_vy[particleCount];
                    p_frozen[i] = p_frozen[particleCount];
                    p_teleportCD[i] = p_teleportCD[particleCount];
                }
            }
        }
    }
}

// ==========================================
// FOAM PHYSICS
// ==========================================
function updateFoam() {
    const dt = DT;
    for (let i = foamCount - 1; i >= 0; i--) {
        foam_vy[i] += GRAVITY_Y * 0.3 * dt;
        foam_vx[i] *= 0.98;
        foam_vy[i] *= 0.98;
        foam_x[i] += foam_vx[i] * dt;
        foam_y[i] += foam_vy[i] * dt;
        foam_life[i] -= dt * 0.8;

        if (foam_life[i] <= 0 || foam_x[i] < 0 || foam_x[i] > width || foam_y[i] < 0 || foam_y[i] > height) {
            foamCount--;
            if (i < foamCount) {
                foam_x[i] = foam_x[foamCount];
                foam_y[i] = foam_y[foamCount];
                foam_vx[i] = foam_vx[foamCount];
                foam_vy[i] = foam_vy[foamCount];
                foam_life[i] = foam_life[foamCount];
                foam_size[i] = foam_size[foamCount];
            }
        }
    }
}

// ==========================================
// EMITTER PROCESSING
// ==========================================
function processEmitters(dt) {
    for (let e = 0; e < emitters.length; e++) {
        const em = emitters[e];
        em.timer = (em.timer || 0) + dt;
        const interval = 1.0 / em.rate;
        while (em.timer >= interval && particleCount < MAX_PARTICLES) {
            em.timer -= interval;
            const id = particleCount;
            const spread = (xorshift() - 0.5) * 0.5;
            const angle = em.angle + spread;
            p_x[id] = em.x + (xorshift() - 0.5) * 8;
            p_y[id] = em.y + (xorshift() - 0.5) * 8;
            p_vx[id] = Math.cos(angle) * em.speed;
            p_vy[id] = Math.sin(angle) * em.speed;
            p_fx[id] = 0;
            p_fy[id] = 0;
            p_frozen[id] = 0;
            p_teleportCD[id] = 0;
            particleCount++;
        }
    }
}

// ==========================================
// ADD PARTICLES
// ==========================================
function addParticles(count, startX, startY) {
    const pCols = Math.floor(Math.sqrt(count));
    const spacing = PARTICLE_RADIUS * 2.1;
    const safeX = Math.max(H, Math.min(width - H - pCols * spacing, startX));
    const safeY = Math.max(H, Math.min(height - H - pCols * spacing, startY));

    for (let i = 0; i < count; i++) {
        if (particleCount >= MAX_PARTICLES) break;
        const id = particleCount;
        p_x[id] = safeX + (i % pCols) * spacing + (xorshift() - 0.5);
        p_y[id] = safeY + Math.floor(i / pCols) * spacing + (xorshift() - 0.5);
        p_vx[id] = (xorshift() - 0.5) * 50;
        p_vy[id] = (xorshift() - 0.5) * 50;
        p_fx[id] = 0;
        p_fy[id] = 0;
        p_frozen[id] = 0;
        p_teleportCD[id] = 0;
        particleCount++;
    }
}

// ==========================================
// PHYSICS STEP
// ==========================================
function step() {
    updateGrid();

    if (useMultiWorker) {
        // Update shared parameters for sub-workers
        updateSharedParams();

        // Density pass (parallel)
        signalSubWorkers(1);
        waitBarrier();

        // Force pass (parallel)
        signalSubWorkers(2);
        waitBarrier();

        // Custom wall forces (not handled by sub-workers)
        applyCustomWallForces();
    } else {
        // Single-threaded path with neighbor cache
        computeDensityPressure();
        computeForces();
    }

    applyRigidBodyForces();
    applyBoatForces();
    integrate();
    integrateRigidBodies();
    integrateBoat();
    updateFoam();
    processEmitters(DT);
}

// ==========================================
// SIMULATION LOOP
// ==========================================
let running = true;

function simLoop() {
    if (!running) return;

    for (let i = 0; i < SUBSTEPS; i++) {
        step();
    }

    // Sim FPS tracking
    simFrameCount++;
    const now = performance.now();
    if (now - simFpsLastTime >= 1000) {
        simFps = simFrameCount;
        simFrameCount = 0;
        simFpsLastTime = now;
    }

    // Fill pre-allocated transfer buffers
    for (let i = 0; i < particleCount; i++) {
        transferPos[i * 2] = p_x[i];
        transferPos[i * 2 + 1] = p_y[i];
        transferDens[i] = p_density[i];
        transferVel[i * 2] = p_vx[i];
        transferVel[i * 2 + 1] = p_vy[i];
    }
    for (let i = 0; i < foamCount; i++) {
        transferFoamPos[i * 2] = foam_x[i];
        transferFoamPos[i * 2 + 1] = foam_y[i];
        transferFoamLife[i] = foam_life[i];
        transferFoamSize[i] = foam_size[i];
    }

    // Fill rigid body transfer buffer
    const rbCount = rigidBodies.length;
    for (let b = 0; b < rbCount; b++) {
        const body = rigidBodies[b];
        const off = b * MAX_RB_FLOATS;
        transferRigidBodies[off] = body.id;
        transferRigidBodies[off + 1] = body.type === 'box' ? 0 : body.type === 'circle' ? 1 : 2;
        transferRigidBodies[off + 2] = body.x;
        transferRigidBodies[off + 3] = body.y;
        transferRigidBodies[off + 4] = body.angle;
        transferRigidBodies[off + 5] = body.halfW || body.radius || 0;
        transferRigidBodies[off + 6] = body.halfH || 0;
        if (body.type === 'triangle') {
            for (let v = 0; v < 3; v++) {
                transferRigidBodies[off + 7 + v * 2] = body.localVerts[v].x;
                transferRigidBodies[off + 8 + v * 2] = body.localVerts[v].y;
            }
        }
        transferRigidBodies[off + 13] = body.colorR;
        transferRigidBodies[off + 14] = body.colorG;
        transferRigidBodies[off + 15] = body.colorB;
    }

    self.postMessage({
        type: 'frame',
        positions: transferPos.subarray(0, particleCount * 2),
        densities: transferDens.subarray(0, particleCount),
        velocities: transferVel.subarray(0, particleCount * 2),
        foamPositions: transferFoamPos.subarray(0, foamCount * 2),
        foamLife: transferFoamLife.subarray(0, foamCount),
        foamSizes: transferFoamSize.subarray(0, foamCount),
        particleCount,
        foamCount,
        simFps,
        multiWorker: useMultiWorker,
        workerCount: numSubWorkers,
        rigidBodies: transferRigidBodies.subarray(0, rbCount * MAX_RB_FLOATS),
        rigidBodyCount: rbCount,
        boat: boat ? { x: boat.x, y: boat.y, angle: boat.angle } : null
    });

    setTimeout(simLoop, 4);
}

// ==========================================
// EXPLOSION HELPER
// ==========================================
function createExplosion(x, y) {
    explosions.push({
        x, y,
        age: 0,
        maxAge: 0.4,
        strength: toolStrength * 8,
        radius: 200
    });
    // Burst of foam
    for (let i = 0; i < 15 && foamCount < MAX_FOAM; i++) {
        const angle = xorshift() * Math.PI * 2;
        const speed = 200 + xorshift() * 400;
        foam_x[foamCount] = x + (xorshift() - 0.5) * 20;
        foam_y[foamCount] = y + (xorshift() - 0.5) * 20;
        foam_vx[foamCount] = Math.cos(angle) * speed;
        foam_vy[foamCount] = Math.sin(angle) * speed;
        foam_life[foamCount] = 0.6 + xorshift() * 0.4;
        foam_size[foamCount] = 1.0 + xorshift() * 1.0;
        foamCount++;
    }
}

// ==========================================
// FREEZE/THAW HELPER
// ==========================================
function freezeAt(x, y, radius) {
    const r2 = radius * radius;
    for (let i = 0; i < particleCount; i++) {
        const dx = p_x[i] - x;
        const dy = p_y[i] - y;
        if (dx * dx + dy * dy < r2) {
            p_frozen[i] = 1;
        }
    }
}

function thawAt(x, y, radius) {
    const r2 = radius * radius;
    for (let i = 0; i < particleCount; i++) {
        const dx = p_x[i] - x;
        const dy = p_y[i] - y;
        if (dx * dx + dy * dy < r2) {
            p_frozen[i] = 0;
        }
    }
}

// ==========================================
// MESSAGE HANDLER
// ==========================================
self.onmessage = function(e) {
    const msg = e.data;
    switch (msg.type) {
        case 'init':
            width = msg.width;
            height = msg.height;
            cols = Math.ceil(width / H);
            rows = Math.ceil(height / H);
            initArrays();
            
            // 1. Remplir l'écran de particules (Océan)
            const spacing = PARTICLE_RADIUS * 2.1;
            const columns = Math.floor(width / spacing);
            const rowsCount = Math.floor(height / spacing);
            const totalParticles = Math.min(columns * rowsCount, MAX_PARTICLES - 500);
            
            // Désactiver la gravité pour la vue de dessus avant de spawner
            GRAVITY_Y = 0;
            GRAVITY_X = 0;
            
            for (let i = 0; i < totalParticles; i++) {
                p_x[i] = (i % columns) * spacing + spacing;
                p_y[i] = Math.floor(i / columns) * spacing + spacing;
                p_vx[i] = 0; p_vy[i] = 0;
                particleCount++;
            }

            // 2. Placer le bateau au centre
            boat = {
                x: width / 2,
                y: height / 2,
                vx: 0, vy: 0,
                angle: -Math.PI / 2, // Pointer vers le haut
                fx: 0, fy: 0
            };

            if (useMultiWorker) {
                pendingSimStart = true;
                if (subWorkersReady === numSubWorkers) {
                    pendingSimStart = false;
                    simLoop();
                }
            } else {
                simLoop();
            }
            break;

        case 'resize':
            width = msg.width;
            height = msg.height;
            cols = Math.ceil(width / H);
            rows = Math.ceil(height / H);
            break;

        case 'mouse':
            mouse.x = msg.x;
            mouse.y = msg.y;
            mouse.active = msg.active;
            break;

        case 'tool':
            activeTool = msg.tool;
            if (msg.strength !== undefined) toolStrength = msg.strength;
            break;

        case 'params':
            if (msg.gravity !== undefined) GRAVITY_Y = msg.gravity;
            if (msg.gravityX !== undefined) GRAVITY_X = msg.gravityX;
            if (msg.gasConst !== undefined) GAS_CONST = msg.gasConst;
            if (msg.nearGasConst !== undefined) NEAR_GAS_CONST = msg.nearGasConst;
            if (msg.viscosity !== undefined) VISC = msg.viscosity;
            if (msg.surfaceTension !== undefined) SURFACE_TENSION = msg.surfaceTension;
            break;

        case 'addParticles':
            addParticles(msg.count || 400, msg.x || width / 2 - 100, msg.y || 50);
            break;

        case 'reset':
            particleCount = 0;
            foamCount = 0;
            emitters = [];
            drains = [];
            walls = [];
            forceFields = [];
            explosions = [];
            portals = [];
            rigidBodies = [];
            if (boat) {
                boat = null;
                if (gravityStored != null) {
                    GRAVITY_Y = gravityStored.y;
                    GRAVITY_X = gravityStored.x;
                    gravityStored = null;
                }
            }
            p_frozen.fill(0);
            p_teleportCD.fill(0);
            addParticles(1800, width / 2 - 200, height / 4);
            break;

        case 'addEmitter':
            emitters.push({
                x: msg.x,
                y: msg.y,
                angle: msg.angle || Math.PI / 2,
                rate: msg.rate || 60,
                speed: msg.speed || 300,
                timer: 0
            });
            break;

        case 'removeEmitter': {
            const idx = msg.index;
            if (idx >= 0 && idx < emitters.length) emitters.splice(idx, 1);
            break;
        }

        case 'addDrain':
            drains.push({
                x: msg.x,
                y: msg.y,
                radius: msg.radius || 30
            });
            break;

        case 'removeDrain': {
            const idx = msg.index;
            if (idx >= 0 && idx < drains.length) drains.splice(idx, 1);
            break;
        }

        case 'addWall':
            walls.push({
                x1: msg.x1,
                y1: msg.y1,
                x2: msg.x2,
                y2: msg.y2,
                thickness: msg.thickness || 8
            });
            break;

        case 'clearWalls':
            walls = [];
            break;

        case 'eraseWallNear': {
            const ex = msg.x, ey = msg.y, er = 30;
            walls = walls.filter(w => {
                const mx = (w.x1 + w.x2) / 2;
                const my = (w.y1 + w.y2) / 2;
                const dx = mx - ex, dy = my - ey;
                return dx * dx + dy * dy > er * er;
            });
            self.postMessage({ type: 'wallsUpdated', walls: walls.slice() });
            break;
        }

        // New tools
        case 'explosion':
            createExplosion(msg.x, msg.y);
            break;

        case 'freezeAt':
            freezeAt(msg.x, msg.y, msg.radius || 50);
            break;

        case 'thawAt':
            thawAt(msg.x, msg.y, msg.radius || 50);
            break;

        case 'addPortalPair':
            portals.push({
                p1x: msg.p1x, p1y: msg.p1y,
                p2x: msg.p2x, p2y: msg.p2y,
                radius: msg.radius || 25,
                r2: (msg.radius || 25) * (msg.radius || 25)
            });
            break;

        case 'clearPortals':
            portals = [];
            break;

        case 'addRigidBody': {
            if (rigidBodies.length >= MAX_RIGID_BODIES) break;
            const rb = {
                id: msg.id,
                type: msg.shapeType,
                x: msg.x, y: msg.y,
                vx: 0, vy: 0,
                angle: 0, omega: 0,
                fx: 0, fy: 0, torque: 0,
                density: msg.density || 2.0,
                colorR: msg.colorR || 0.58,
                colorG: msg.colorG || 0.64,
                colorB: msg.colorB || 0.72
            };
            if (msg.shapeType === 'box') {
                rb.halfW = msg.halfW;
                rb.halfH = msg.halfH;
                rb.mass = rb.density * 4 * rb.halfW * rb.halfH;
                rb.inertia = rb.mass * (rb.halfW * rb.halfW + rb.halfH * rb.halfH) / 3.0;
            } else if (msg.shapeType === 'circle') {
                rb.radius = msg.radius;
                rb.mass = rb.density * Math.PI * rb.radius * rb.radius;
                rb.inertia = rb.mass * rb.radius * rb.radius / 2.0;
            } else if (msg.shapeType === 'triangle') {
                rb.localVerts = msg.localVerts;
                const v = rb.localVerts;
                const area = Math.abs((v[1].x - v[0].x) * (v[2].y - v[0].y) - (v[2].x - v[0].x) * (v[1].y - v[0].y)) / 2;
                rb.mass = rb.density * area;
                rb.inertia = rb.mass * (v[0].x * v[0].x + v[0].y * v[0].y + v[1].x * v[1].x + v[1].y * v[1].y + v[2].x * v[2].x + v[2].y * v[2].y) / 6.0;
            }
            rb.mass = Math.max(rb.mass, 10);
            rb.inertia = Math.max(rb.inertia, 100);
            rigidBodies.push(rb);
            break;
        }

        case 'removeRigidBody':
            rigidBodies = rigidBodies.filter(rb => rb.id !== msg.id);
            break;

        case 'clearRigidBodies':
            rigidBodies = [];
            break;

        case 'placeBoat':
            if (!boat) {
                gravityStored = { x: GRAVITY_X, y: GRAVITY_Y };
                GRAVITY_X = 0;
                GRAVITY_Y = 0;
            }
            boat = {
                x: msg.x ?? width / 2,
                y: msg.y ?? height / 2,
                vx: 0,
                vy: 0,
                angle: 0,
                fx: 0,
                fy: 0
            };
            break;

        case 'removeBoat':
            boat = null;
            if (gravityStored != null) {
                GRAVITY_Y = gravityStored.y;
                GRAVITY_X = gravityStored.x;
                gravityStored = null;
            }
            break;

        case 'boatKeys':
            boatKeys.up = !!msg.up;
            boatKeys.left = !!msg.left;
            boatKeys.down = !!msg.down;
            boatKeys.right = !!msg.right;
            boatKeys.throttle = msg.throttle !== undefined ? msg.throttle : (msg.up ? 1 : 0);
            break;

        case 'getState':
            self.postMessage({
                type: 'state',
                emitters: emitters.slice(),
                drains: drains.slice(),
                walls: walls.slice(),
                particleCount,
                foamCount
            });
            break;
    }
};
