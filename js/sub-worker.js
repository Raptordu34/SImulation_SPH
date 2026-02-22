// ==========================================
// SUB-WORKER - Parallel SPH density/force computation
// Operates on shared particle data via SharedArrayBuffer
// ==========================================

const H = 35;
const H2 = H * H;
const PARTICLE_RADIUS = 9;
const REST_DENS = 3.0;

// Fast sqrt lookup
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

// xorshift PRNG (seeded per worker)
let rngState = 12345;
function xorshift() {
    rngState ^= rngState << 13;
    rngState ^= rngState >> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
}

// Shared memory views
let control;    // Int32Array - synchronization
let s_x, s_y, s_vx, s_vy, s_fx, s_fy;
let s_density, s_nearDensity, s_pressure, s_nearPressure;
let s_cellHead, s_particleNext;
let s_params;   // Float32Array - physics parameters

let startIdx = 0, endIdx = 0;

self.onmessage = function(e) {
    const msg = e.data;
    if (msg.type === 'init') {
        const sab = msg.sharedBuffer;
        const MAX_P = msg.maxParticles;
        const MAX_GRID = msg.maxGridCells;
        const P_OFF = msg.particleOffset;
        const G_OFF = msg.gridOffset;
        const PARAMS_OFF = msg.paramsOffset;

        control = new Int32Array(sab, 0, 32);

        s_x           = new Float32Array(sab, P_OFF,                MAX_P);
        s_y           = new Float32Array(sab, P_OFF + MAX_P * 4,    MAX_P);
        s_vx          = new Float32Array(sab, P_OFF + MAX_P * 8,    MAX_P);
        s_vy          = new Float32Array(sab, P_OFF + MAX_P * 12,   MAX_P);
        s_fx          = new Float32Array(sab, P_OFF + MAX_P * 16,   MAX_P);
        s_fy          = new Float32Array(sab, P_OFF + MAX_P * 20,   MAX_P);
        s_density     = new Float32Array(sab, P_OFF + MAX_P * 24,   MAX_P);
        s_nearDensity = new Float32Array(sab, P_OFF + MAX_P * 28,   MAX_P);
        s_pressure    = new Float32Array(sab, P_OFF + MAX_P * 32,   MAX_P);
        s_nearPressure= new Float32Array(sab, P_OFF + MAX_P * 36,   MAX_P);

        s_cellHead     = new Int32Array(sab, G_OFF, MAX_GRID);
        s_particleNext = new Int32Array(sab, G_OFF + MAX_GRID * 4, MAX_P);

        s_params = new Float32Array(sab, PARAMS_OFF, 16);

        startIdx = msg.startIdx;
        endIdx = msg.endIdx;
        rngState = 12345 + msg.workerId * 7919;

        // Signal coordinator that we are ready
        self.postMessage({ type: 'ready' });

        // Enter work loop (blocks via Atomics.wait)
        workLoop();
    }
};

function workLoop() {
    let lastPhase = 0;
    while (true) {
        Atomics.wait(control, 0, lastPhase);
        const currentPhase = Atomics.load(control, 0);
        lastPhase = currentPhase;

        const task = Atomics.load(control, 3);
        const pCount = Atomics.load(control, 2);
        const cols = Atomics.load(control, 4);
        const rows = Atomics.load(control, 5);

        const actualEnd = Math.min(endIdx, pCount);
        const actualStart = Math.min(startIdx, pCount);

        if (task === 1) {
            computeDensitySlice(actualStart, actualEnd, cols, rows);
        } else if (task === 2) {
            computeForcesSlice(actualStart, actualEnd, cols, rows);
        }

        Atomics.add(control, 1, 1);
        Atomics.notify(control, 1);
    }
}

function computeDensitySlice(start, end, cols, rows) {
    const GAS_CONST = s_params[0];
    const NEAR_GAS_CONST = s_params[1];

    for (let i = start; i < end; i++) {
        let d = 0, nd = 0;
        const px = s_x[i], py = s_y[i];
        const cx = Math.max(0, Math.min(cols - 1, (px / H) | 0));
        const cy = Math.max(0, Math.min(rows - 1, (py / H) | 0));

        const cxMin = cx > 0 ? cx - 1 : 0;
        const cxMax = cx < cols - 1 ? cx + 1 : cols - 1;
        const cyMin = cy > 0 ? cy - 1 : 0;
        const cyMax = cy < rows - 1 ? cy + 1 : rows - 1;

        for (let ny = cyMin; ny <= cyMax; ny++) {
            for (let nx = cxMin; nx <= cxMax; nx++) {
                let j = s_cellHead[nx + ny * cols];
                while (j !== -1) {
                    if (i !== j) {
                        const dx = s_x[j] - px;
                        const dy = s_y[j] - py;
                        const r2 = dx * dx + dy * dy;
                        if (r2 < H2) {
                            const r = r2 < 1.0 ? Math.sqrt(r2) : fastSqrt(r2);
                            const q = 1.0 - r / H;
                            d += q * q;
                            nd += q * q * q;
                        }
                    }
                    j = s_particleNext[j];
                }
            }
        }

        d += 1.0;
        nd += 1.0;
        if (d < 0.1) d = 0.1;

        s_density[i] = d;
        s_nearDensity[i] = nd;
        s_pressure[i] = Math.max(-GAS_CONST * 0.1, GAS_CONST * (d - REST_DENS));
        s_nearPressure[i] = NEAR_GAS_CONST * nd;
    }
}

function computeForcesSlice(start, end, cols, rows) {
    const SURFACE_TENSION = s_params[2];
    const VISC = s_params[3];
    const GRAVITY_X = s_params[4];
    const GRAVITY_Y = s_params[5];
    const simWidth = s_params[6];
    const simHeight = s_params[7];
    const WALL_STIFFNESS = s_params[8];

    for (let i = start; i < end; i++) {
        const px = s_x[i], py = s_y[i];
        const pvx = s_vx[i], pvy = s_vy[i];
        const pPress = s_pressure[i];
        const pNearPress = s_nearPressure[i];
        const pDens = s_density[i];

        let fPressX = 0, fPressY = 0;
        let fViscX = 0, fViscY = 0;

        const cx = Math.max(0, Math.min(cols - 1, (px / H) | 0));
        const cy = Math.max(0, Math.min(rows - 1, (py / H) | 0));
        const cxMin = cx > 0 ? cx - 1 : 0;
        const cxMax = cx < cols - 1 ? cx + 1 : cols - 1;
        const cyMin = cy > 0 ? cy - 1 : 0;
        const cyMax = cy < rows - 1 ? cy + 1 : rows - 1;

        for (let ny = cyMin; ny <= cyMax; ny++) {
            for (let nx = cxMin; nx <= cxMax; nx++) {
                let j = s_cellHead[nx + ny * cols];
                while (j !== -1) {
                    if (i !== j) {
                        let dx = s_x[j] - px;
                        let dy = s_y[j] - py;
                        let r2 = dx * dx + dy * dy;
                        if (r2 < H2) {
                            if (r2 < 0.0001) {
                                dx = (xorshift() - 0.5) * 0.1;
                                dy = (xorshift() - 0.5) * 0.1;
                                r2 = dx * dx + dy * dy;
                                if (r2 < 0.0001) r2 = 0.0001;
                            }
                            const r = r2 < 1.0 ? Math.sqrt(r2) : fastSqrt(r2);
                            const q = 1.0 - r / H;
                            const avgPress = (pPress + s_pressure[j]) * 0.5;
                            const avgNearPress = (pNearPress + s_nearPressure[j]) * 0.5;
                            const cohesion = SURFACE_TENSION * q * (1.0 - q);
                            const forcePress = (avgPress * q + avgNearPress * q * q) / pDens;
                            const totalForce = forcePress - cohesion;
                            const invR = r > 0.001 ? 1.0 / r : 0;

                            fPressX -= totalForce * dx * invR;
                            fPressY -= totalForce * dy * invR;

                            const VISC_STABILITY_LIMIT = 107.0; // 0.5 / (0.014/3)
                            const forceVisc = Math.min(VISC * q / pDens, VISC_STABILITY_LIMIT);
                            fViscX += forceVisc * (s_vx[j] - pvx);
                            fViscY += forceVisc * (s_vy[j] - pvy);
                        }
                    }
                    j = s_particleNext[j];
                }
            }
        }

        // Boundary wall forces
        const wallMargin = PARTICLE_RADIUS * 2;
        let wallFx = 0, wallFy = 0;
        if (px < wallMargin) wallFx += (wallMargin - px) * WALL_STIFFNESS;
        else if (px > simWidth - wallMargin) wallFx -= (px - (simWidth - wallMargin)) * WALL_STIFFNESS;
        if (py < wallMargin) wallFy += (wallMargin - py) * WALL_STIFFNESS;
        else if (py > simHeight - wallMargin) wallFy -= (py - (simHeight - wallMargin)) * WALL_STIFFNESS;

        s_fx[i] = fPressX + fViscX + wallFx + GRAVITY_X;
        s_fy[i] = fPressY + fViscY + wallFy + GRAVITY_Y;
    }
}
