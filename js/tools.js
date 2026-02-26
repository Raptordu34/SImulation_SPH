// ==========================================
// TOOLS - Système d'outils d'interaction
// ==========================================

export class ToolManager {
    constructor(worker, overlayCanvas) {
        this.worker = worker;
        this.overlay = overlayCanvas;
        this.ctx = overlayCanvas.getContext('2d');
        this.activeTool = 'push';
        this.container = document.getElementById('canvas-container');

        // Tool state
        this.mouseDown = false;
        this.mouseOver = false;
        this.mouseX = -1000;
        this.mouseY = -1000;
        this.shiftHeld = false;

        // Wall drawing
        this.wallStartX = 0;
        this.wallStartY = 0;
        this.isDrawingWall = false;

        // Teleporter: pending first portal
        this.pendingPortal = null;

        // Placed objects for overlay rendering
        this.emitters = [];
        this.drains = [];
        this.walls = [];
        this.portalPairs = [];

        // Rigid bodies: placement state
        this.rigidBodies = [];
        this.activeShape = 'box';
        this.isDrawingRigidBody = false;
        this.rigidBodyStartX = 0;
        this.rigidBodyStartY = 0;
        this.nextRigidBodyId = 1;
        this.rigidBodiesData = null;
        this.rigidBodyCount = 0;
        this.boatData = null;
        this.missileData = null;

        // Enemy / combat state (fed from main.js each frame)
        this.enemiesData = [];
        this.enemyMissilesData = [];
        this.playerHP = 100;
        this.playerMaxHP = 100;
        this.playerScore = 0;
        this.playerAlive = true;
        this._gameOverShown = false;

        // VFX : explosions visuelles (overlay)
        this.vfxExplosions = [];  // { x, y, age, maxAge, radius }
        this.vfxDebris = [];      // { x, y, vx, vy, life, maxLife, size, r, g, b }
        this.vfxSmoke = [];       // traînée de fumée du missile
        this._lastMissilePos = null;

        // Active tool info element
        this.toolInfoEl = document.getElementById('active-tool-info');

        this._initEvents();
    }

    setTool(tool) {
        this.activeTool = tool;
        this.container.setAttribute('data-tool', tool);
        this.worker.postMessage({ type: 'tool', tool });

        // Cancel pending portal if switching away
        if (tool !== 'teleporter') {
            this.pendingPortal = null;
        }

        // Update toolbar UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Update active tool label
        const toolNames = {
            push: 'Pousser',
            emitter: 'Emetteur',
            drain: 'Drain',
            wall: 'Mur',
            rigidBody: 'Objet',
            boat: 'Bateau',
            eraser: 'Gomme',
            vortex: 'Vortex',
            wind: 'Vent',
            attractor: 'Attracteur',
            explosion: 'Explosion',
            localGravity: 'Gravite',
            freeze: 'Geler',
            teleporter: 'Teleporteur'
        };
        if (this.toolInfoEl) {
            this.toolInfoEl.textContent = toolNames[tool] || tool;
        }
    }

    _getCanvasPos(e) {
        const rect = this.container.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.overlay.width / rect.width),
            y: (e.clientY - rect.top) * (this.overlay.height / rect.height)
        };
    }

    _initEvents() {
        const container = this.container;

        // Toolbar buttons — STOP propagation so clicks don't trigger canvas actions
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setTool(btn.dataset.tool);
            });
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('mouseup', (e) => e.stopPropagation());
        });

        // Prevent toolbar area from triggering canvas events
        const toolbar = document.getElementById('toolbar');
        if (toolbar) {
            toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
            toolbar.addEventListener('mouseup', (e) => e.stopPropagation());
        }

        // Track shift key for freeze/thaw toggle
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') this.shiftHeld = true;
            // Don't capture if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const toolMap = {
                '1': 'push', '2': 'emitter', '3': 'drain', '4': 'wall',
                '5': 'eraser', '6': 'vortex', '7': 'wind', '8': 'attractor',
                '9': 'explosion', '0': 'localGravity', '-': 'freeze', '=': 'teleporter'
            };
            if (toolMap[e.key]) {
                this.setTool(toolMap[e.key]);
            }
            // B: cycle rigid body shape (box → circle → triangle)
            if ((e.key === 'b' || e.key === 'B') && this.activeTool === 'rigidBody') {
                const shapes = ['box', 'circle', 'triangle'];
                const idx = shapes.indexOf(this.activeShape);
                this.activeShape = shapes[(idx + 1) % shapes.length];
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') this.shiftHeld = false;
        });

        // Mouse enter/leave for cursor display
        container.addEventListener('mouseenter', () => { this.mouseOver = true; });
        container.addEventListener('mouseleave', () => { this.mouseOver = false; });

        // Mouse events
        container.addEventListener('mousedown', (e) => {
            this.mouseDown = true;
            const pos = this._getCanvasPos(e);
            this.mouseX = pos.x;
            this.mouseY = pos.y;
            this._onDown(pos);
            this.worker.postMessage({ type: 'mouse', x: pos.x, y: pos.y, active: true });
        });

        container.addEventListener('mousemove', (e) => {
            const pos = this._getCanvasPos(e);
            this.mouseX = pos.x;
            this.mouseY = pos.y;
            if (this.mouseDown) {
                this._onMove(pos);
            }
            this.worker.postMessage({
                type: 'mouse',
                x: pos.x,
                y: pos.y,
                active: this.mouseDown
            });
        });

        window.addEventListener('mouseup', () => {
            if (this.mouseDown) {
                this._onUp({ x: this.mouseX, y: this.mouseY });
            }
            this.mouseDown = false;
            this.worker.postMessage({
                type: 'mouse',
                x: this.mouseX,
                y: this.mouseY,
                active: false
            });
        });

        // Touch events
        container.addEventListener('touchstart', (e) => {
            this.mouseDown = true;
            this.mouseOver = true;
            const touch = e.touches[0];
            const pos = this._getCanvasPos(touch);
            this.mouseX = pos.x;
            this.mouseY = pos.y;
            this._onDown(pos);
            this.worker.postMessage({ type: 'mouse', x: pos.x, y: pos.y, active: true });
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const pos = this._getCanvasPos(touch);
            this.mouseX = pos.x;
            this.mouseY = pos.y;
            this._onMove(pos);
            this.worker.postMessage({ type: 'mouse', x: pos.x, y: pos.y, active: true });
        }, { passive: true });

        window.addEventListener('touchend', () => {
            this._onUp({ x: this.mouseX, y: this.mouseY });
            this.mouseDown = false;
            this.mouseOver = false;
            this.worker.postMessage({ type: 'mouse', x: this.mouseX, y: this.mouseY, active: false });
        });

        // Listen for wall updates from worker
        this.worker.addEventListener('message', (e) => {
            if (e.data.type === 'wallsUpdated') {
                this.walls = e.data.walls;
            }
        });
    }

    _onDown(pos) {
        switch (this.activeTool) {
            case 'emitter':
                this.emitters.push({ x: pos.x, y: pos.y, angle: Math.PI / 2 });
                this.worker.postMessage({
                    type: 'addEmitter',
                    x: pos.x, y: pos.y,
                    angle: Math.PI / 2,
                    rate: 60, speed: 300
                });
                break;

            case 'drain':
                this.drains.push({ x: pos.x, y: pos.y, radius: 30 });
                this.worker.postMessage({
                    type: 'addDrain',
                    x: pos.x, y: pos.y, radius: 30
                });
                break;

            case 'wall':
                this.isDrawingWall = true;
                this.wallStartX = pos.x;
                this.wallStartY = pos.y;
                break;

            case 'boat':
                if (this.boatData) {
                    // Bateau déjà placé → logique missile
                    if (this.missileData) {
                        // Missile en vol → le faire exploser
                        this.triggerExplosionVFX(this.missileData.x, this.missileData.y, 180);
                        this.worker.postMessage({ type: 'detonateMissile' });
                    } else {
                        // Pas de missile → en tirer un perpendiculairement
                        const bx = this.boatData.x, by = this.boatData.y, ba = this.boatData.angle;
                        const dx = pos.x - bx, dy = pos.y - by;
                        // Produit vectoriel pour déterminer le côté de la souris
                        const cross = Math.cos(ba) * dy - Math.sin(ba) * dx;
                        const side = cross > 0 ? 1 : -1;
                        this.worker.postMessage({ type: 'fireMissile', side });
                    }
                } else {
                    // Pas encore de bateau → le placer
                    this.worker.postMessage({ type: 'placeBoat', x: pos.x, y: pos.y });
                }
                break;

            case 'rigidBody':
                if (this.activeShape === 'circle') {
                    const id = this.nextRigidBodyId++;
                    this.worker.postMessage({
                        type: 'addRigidBody',
                        id,
                        shapeType: 'circle',
                        x: pos.x,
                        y: pos.y,
                        radius: 25,
                        density: 2.0
                    });
                } else {
                    this.isDrawingRigidBody = true;
                    this.rigidBodyStartX = pos.x;
                    this.rigidBodyStartY = pos.y;
                }
                break;

            case 'eraser':
                this._eraseNear(pos);
                break;

            case 'explosion':
                this.triggerExplosionVFX(pos.x, pos.y, 200);
                this.worker.postMessage({ type: 'explosion', x: pos.x, y: pos.y });
                break;

            case 'freeze':
                if (this.shiftHeld) {
                    this.worker.postMessage({ type: 'thawAt', x: pos.x, y: pos.y, radius: 50 });
                } else {
                    this.worker.postMessage({ type: 'freezeAt', x: pos.x, y: pos.y, radius: 50 });
                }
                break;

            case 'teleporter':
                if (!this.pendingPortal) {
                    // First click: place portal 1
                    this.pendingPortal = { x: pos.x, y: pos.y };
                } else {
                    // Second click: place portal 2 and create pair
                    const pair = {
                        p1: { x: this.pendingPortal.x, y: this.pendingPortal.y },
                        p2: { x: pos.x, y: pos.y }
                    };
                    this.portalPairs.push(pair);
                    this.worker.postMessage({
                        type: 'addPortalPair',
                        p1x: pair.p1.x, p1y: pair.p1.y,
                        p2x: pair.p2.x, p2y: pair.p2.y,
                        radius: 25
                    });
                    this.pendingPortal = null;
                }
                break;

            // push, vortex, wind, attractor, localGravity are handled continuously in the worker
        }
    }

    _onMove(pos) {
        if (this.activeTool === 'eraser') {
            this._eraseNear(pos);
        }
        if (this.activeTool === 'freeze') {
            if (this.shiftHeld) {
                this.worker.postMessage({ type: 'thawAt', x: pos.x, y: pos.y, radius: 50 });
            } else {
                this.worker.postMessage({ type: 'freezeAt', x: pos.x, y: pos.y, radius: 50 });
            }
        }
    }

    _onUp(pos) {
        if (this.activeTool === 'wall' && this.isDrawingWall) {
            this.isDrawingWall = false;
            const dx = pos.x - this.wallStartX;
            const dy = pos.y - this.wallStartY;
            if (dx * dx + dy * dy > 100) {
                const wall = {
                    x1: this.wallStartX, y1: this.wallStartY,
                    x2: pos.x, y2: pos.y,
                    thickness: 8
                };
                this.walls.push(wall);
                this.worker.postMessage({ type: 'addWall', ...wall });
            }
        }
        if (this.activeTool === 'rigidBody' && this.isDrawingRigidBody) {
            this.isDrawingRigidBody = false;
            const x1 = this.rigidBodyStartX, y1 = this.rigidBodyStartY;
            const x2 = pos.x, y2 = pos.y;
            const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
            const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
            // Clic sans glisser → taille par défaut (sinon rien ne s'affiche)
            const halfW = (w < 10 && h < 10) ? 25 : Math.max(w / 2, 5);
            const halfH = (w < 10 && h < 10) ? 25 : Math.max(h / 2, 5);
            const id = this.nextRigidBodyId++;
            if (this.activeShape === 'box') {
                this.worker.postMessage({
                    type: 'addRigidBody',
                    id,
                    shapeType: 'box',
                    x: cx,
                    y: cy,
                    halfW,
                    halfH,
                    density: 2.0
                });
            } else if (this.activeShape === 'triangle') {
                const localVerts = [
                    { x: 0, y: -halfH },
                    { x: -halfW, y: halfH },
                    { x: halfW, y: halfH }
                ];
                this.worker.postMessage({
                    type: 'addRigidBody',
                    id,
                    shapeType: 'triangle',
                    x: cx,
                    y: cy,
                    localVerts,
                    density: 2.0
                });
            }
        }
    }

    _eraseNear(pos) {
        // Erase emitters
        for (let i = this.emitters.length - 1; i >= 0; i--) {
            const dx = this.emitters[i].x - pos.x;
            const dy = this.emitters[i].y - pos.y;
            if (dx * dx + dy * dy < 900) {
                this.emitters.splice(i, 1);
                this.worker.postMessage({ type: 'removeEmitter', index: i });
            }
        }
        // Erase drains
        for (let i = this.drains.length - 1; i >= 0; i--) {
            const dx = this.drains[i].x - pos.x;
            const dy = this.drains[i].y - pos.y;
            if (dx * dx + dy * dy < 900) {
                this.drains.splice(i, 1);
                this.worker.postMessage({ type: 'removeDrain', index: i });
            }
        }
        // Erase walls (check each segment, not just midpoint)
        const eraseR = 30;
        const eraseR2 = eraseR * eraseR;
        this.walls = this.walls.filter(w => {
            // Check distance to segment, not just midpoint
            const wdx = w.x2 - w.x1, wdy = w.y2 - w.y1;
            const len2 = wdx * wdx + wdy * wdy;
            let t = len2 > 0.01 ? ((pos.x - w.x1) * wdx + (pos.y - w.y1) * wdy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const cx = w.x1 + t * wdx, cy = w.y1 + t * wdy;
            const dx = pos.x - cx, dy = pos.y - cy;
            return dx * dx + dy * dy > eraseR2;
        });
        // Erase portals near cursor
        this.portalPairs = this.portalPairs.filter(pair => {
            const d1x = pair.p1.x - pos.x, d1y = pair.p1.y - pos.y;
            const d2x = pair.p2.x - pos.x, d2y = pair.p2.y - pos.y;
            return (d1x*d1x + d1y*d1y > eraseR2) && (d2x*d2x + d2y*d2y > eraseR2);
        });
        // Erase rigid bodies near cursor (by center from frame data)
        if (this.rigidBodiesData && this.rigidBodyCount > 0) {
            const F = 16;
            for (let b = 0; b < this.rigidBodyCount; b++) {
                const off = b * F;
                const bx = this.rigidBodiesData[off + 2];
                const by = this.rigidBodiesData[off + 3];
                const dx = pos.x - bx, dy = pos.y - by;
                if (dx * dx + dy * dy < eraseR2) {
                    this.worker.postMessage({ type: 'removeRigidBody', id: this.rigidBodiesData[off] });
                    break;
                }
            }
        }
        // Erase boat near cursor
        if (this.boatData) {
            const dx = pos.x - this.boatData.x, dy = pos.y - this.boatData.y;
            if (dx * dx + dy * dy < eraseR2) {
                this.worker.postMessage({ type: 'removeBoat' });
            }
        }
        this.worker.postMessage({ type: 'eraseWallNear', x: pos.x, y: pos.y });
    }

    // ==========================================
    // VFX — Explosion visuelle
    // ==========================================
    triggerExplosionVFX(x, y, radius) {
        radius = radius || 180;
        this.vfxExplosions.push({ x, y, age: 0, maxAge: 0.8, radius });

        // Débris (éclats)
        for (let i = 0; i < 28; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 380;
            const bright = Math.random();
            this.vfxDebris.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0,
                maxLife: 0.4 + Math.random() * 0.5,
                size: 1.5 + Math.random() * 3,
                r: 255,
                g: Math.floor(100 + bright * 155),
                b: Math.floor(bright * 60)
            });
        }
    }

    _updateVFX(dt) {
        // Explosions
        for (let i = this.vfxExplosions.length - 1; i >= 0; i--) {
            this.vfxExplosions[i].age += dt;
            if (this.vfxExplosions[i].age >= this.vfxExplosions[i].maxAge) {
                this.vfxExplosions.splice(i, 1);
            }
        }
        // Débris
        for (let i = this.vfxDebris.length - 1; i >= 0; i--) {
            const d = this.vfxDebris[i];
            d.life += dt;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.vx *= 0.96;
            d.vy *= 0.96;
            if (d.life >= d.maxLife) {
                this.vfxDebris.splice(i, 1);
            }
        }
        // Fumée missile
        for (let i = this.vfxSmoke.length - 1; i >= 0; i--) {
            const s = this.vfxSmoke[i];
            s.life += dt;
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.size += dt * 12;
            if (s.life >= s.maxLife) {
                this.vfxSmoke.splice(i, 1);
            }
        }
        // Ajouter de la fumée derrière le missile
        if (this.missileData) {
            const mx = this.missileData.x, my = this.missileData.y;
            if (this._lastMissilePos) {
                // Plusieurs puffs entre les deux positions pour un trail continu
                const puffs = 2;
                for (let p = 0; p < puffs; p++) {
                    const t = p / puffs;
                    this.vfxSmoke.push({
                        x: this._lastMissilePos.x + (mx - this._lastMissilePos.x) * t + (Math.random() - 0.5) * 3,
                        y: this._lastMissilePos.y + (my - this._lastMissilePos.y) * t + (Math.random() - 0.5) * 3,
                        vx: (Math.random() - 0.5) * 20,
                        vy: (Math.random() - 0.5) * 20,
                        life: 0,
                        maxLife: 0.4 + Math.random() * 0.3,
                        size: 2 + Math.random() * 2
                    });
                }
            }
            this._lastMissilePos = { x: mx, y: my };
        } else {
            this._lastMissilePos = null;
        }
    }

    _renderVFX(ctx) {
        const now = performance.now() / 1000;

        // 1. Fumée du missile (dessinée en premier, derrière le missile)
        for (const s of this.vfxSmoke) {
            const t = s.life / s.maxLife;
            const alpha = (1 - t) * 0.35;
            ctx.fillStyle = `rgba(180, 180, 190, ${alpha})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Explosions : flash initial + ondes de choc concentriques
        for (const exp of this.vfxExplosions) {
            const t = exp.age / exp.maxAge; // 0→1
            const r = exp.radius;

            ctx.save();

            // --- Flash blanc initial (très court) ---
            if (t < 0.15) {
                const flashT = t / 0.15;
                const flashAlpha = (1 - flashT) * 0.65;
                const flashR = r * 0.3 * flashT;
                const flashGrad = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, flashR + 20);
                flashGrad.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha})`);
                flashGrad.addColorStop(0.5, `rgba(255, 240, 180, ${flashAlpha * 0.6})`);
                flashGrad.addColorStop(1, `rgba(255, 200, 50, 0)`);
                ctx.fillStyle = flashGrad;
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, flashR + 20, 0, Math.PI * 2);
                ctx.fill();
            }

            // --- Boule de feu ---
            if (t < 0.5) {
                const fireT = t / 0.5;
                const fireR = r * 0.4 * fireT;
                const fireAlpha = (1 - fireT) * 0.5;
                const fireGrad = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, fireR);
                fireGrad.addColorStop(0, `rgba(255, 200, 50, ${fireAlpha})`);
                fireGrad.addColorStop(0.4, `rgba(255, 100, 20, ${fireAlpha * 0.7})`);
                fireGrad.addColorStop(1, `rgba(180, 30, 0, 0)`);
                ctx.fillStyle = fireGrad;
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, fireR, 0, Math.PI * 2);
                ctx.fill();
            }

            // --- Onde de choc 1 (rapide) ---
            {
                const waveT = Math.min(t * 1.8, 1.0);
                const waveR = r * waveT;
                const waveAlpha = (1 - waveT) * 0.6;
                ctx.strokeStyle = `rgba(255, 220, 120, ${waveAlpha})`;
                ctx.lineWidth = 3 * (1 - waveT) + 0.5;
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, waveR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // --- Onde de choc 2 (retardée) ---
            if (t > 0.08) {
                const waveT2 = Math.min((t - 0.08) * 1.5, 1.0);
                const waveR2 = r * 0.8 * waveT2;
                const waveAlpha2 = (1 - waveT2) * 0.35;
                ctx.strokeStyle = `rgba(255, 160, 60, ${waveAlpha2})`;
                ctx.lineWidth = 2 * (1 - waveT2) + 0.5;
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, waveR2, 0, Math.PI * 2);
                ctx.stroke();
            }

            // --- Fumée résiduelle (apparait tard) ---
            if (t > 0.3) {
                const smokeT = (t - 0.3) / 0.7;
                const smokeAlpha = Math.min(smokeT * 0.8, 0.25) * (1 - smokeT);
                const smokeR = r * 0.3 + r * 0.3 * smokeT;
                const smokeGrad = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, smokeR);
                smokeGrad.addColorStop(0, `rgba(60, 60, 70, ${smokeAlpha})`);
                smokeGrad.addColorStop(1, `rgba(40, 40, 50, 0)`);
                ctx.fillStyle = smokeGrad;
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, smokeR, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }

        // 3. Débris (éclats incandescents)
        for (const d of this.vfxDebris) {
            const t = d.life / d.maxLife;
            const alpha = (1 - t);
            ctx.shadowColor = `rgba(${d.r}, ${d.g}, ${d.b}, ${alpha * 0.6})`;
            ctx.shadowBlur = 6;
            ctx.fillStyle = `rgba(${d.r}, ${d.g}, ${d.b}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size * (1 - t * 0.5), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }

    // ==========================================
    // OVERLAY RENDERING
    // ==========================================
    renderOverlay() {
        const ctx = this.ctx;
        const w = this.overlay.width;
        const h = this.overlay.height;
        ctx.clearRect(0, 0, w, h);

        // Mettre à jour et dessiner les VFX (dt estimé ~16ms)
        this._updateVFX(1 / 60);
        this._renderVFX(ctx);

        // Draw walls
        if (this.walls.length > 0) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            for (const wall of this.walls) {
                ctx.beginPath();
                ctx.moveTo(wall.x1, wall.y1);
                ctx.lineTo(wall.x2, wall.y2);
                ctx.stroke();
            }
        }

        // Wall preview while drawing
        if (this.isDrawingWall && this.mouseDown) {
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.setLineDash([10, 5]);
            ctx.beginPath();
            ctx.moveTo(this.wallStartX, this.wallStartY);
            ctx.lineTo(this.mouseX, this.mouseY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw emitters
        for (const em of this.emitters) {
            ctx.save();
            ctx.translate(em.x, em.y);

            // Glow
            ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
            ctx.shadowBlur = 10;

            // Body
            ctx.fillStyle = 'rgba(6, 182, 212, 0.5)';
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Direction arrow
            const ax = Math.cos(em.angle) * 20;
            const ay = Math.sin(em.angle) * 20;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(ax, ay);
            ctx.stroke();

            // Arrow head
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - Math.cos(em.angle - 0.4) * 7, ay - Math.sin(em.angle - 0.4) * 7);
            ctx.lineTo(ax - Math.cos(em.angle + 0.4) * 7, ay - Math.sin(em.angle + 0.4) * 7);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        // Draw drains
        for (const drain of this.drains) {
            ctx.save();
            ctx.translate(drain.x, drain.y);

            // Glow
            ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
            ctx.shadowBlur = 8;

            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, drain.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.shadowBlur = 0;

            // Animated spiral
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const t = performance.now() / 1000;
            for (let a = 0; a < Math.PI * 4; a += 0.15) {
                const r = (drain.radius * 0.8) * (1 - a / (Math.PI * 4));
                const x = Math.cos(a + t * 3) * r;
                const y = Math.sin(a + t * 3) * r;
                if (a === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.restore();
        }

        // Draw portal pairs
        const pt = performance.now() / 1000;
        for (const pair of this.portalPairs) {
            // Portal 1 (blue)
            this._drawPortal(ctx, pair.p1.x, pair.p1.y, 'rgba(59, 130, 246, ', pt);
            // Portal 2 (orange)
            this._drawPortal(ctx, pair.p2.x, pair.p2.y, 'rgba(249, 115, 22, ', pt + Math.PI);
        }

        // Draw pending portal (pulsing)
        if (this.pendingPortal) {
            const pulse = 0.5 + Math.sin(pt * 4) * 0.3;
            ctx.save();
            ctx.strokeStyle = `rgba(59, 130, 246, ${pulse})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.pendingPortal.x, this.pendingPortal.y, 25, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = `rgba(59, 130, 246, ${pulse * 0.3})`;
            ctx.fill();
            ctx.restore();
        }

        // Rigid body drag preview
        if (this.activeTool === 'rigidBody' && this.isDrawingRigidBody && this.mouseDown) {
            const x1 = this.rigidBodyStartX, y1 = this.rigidBodyStartY;
            const x2 = this.mouseX, y2 = this.mouseY;
            const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
            const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
            const halfW = Math.max(w / 2, 5), halfH = Math.max(h / 2, 5);
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            if (this.activeShape === 'box') {
                ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
            } else if (this.activeShape === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(cx, cy - halfH);
                ctx.lineTo(cx - halfW, cy + halfH);
                ctx.lineTo(cx + halfW, cy + halfH);
                ctx.closePath();
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // Draw rigid bodies from frame data
        if (this.rigidBodiesData && this.rigidBodyCount > 0) {
            const F = 16;
            for (let b = 0; b < this.rigidBodyCount; b++) {
                const off = b * F;
                const type = this.rigidBodiesData[off + 1];
                const x = this.rigidBodiesData[off + 2];
                const y = this.rigidBodiesData[off + 3];
                const angle = this.rigidBodiesData[off + 4];
                const dim1 = this.rigidBodiesData[off + 5];
                const dim2 = this.rigidBodiesData[off + 6];
                const r = (this.rigidBodiesData[off + 13] || 0.58) * 255;
                const g = (this.rigidBodiesData[off + 14] || 0.64) * 255;
                const bl = (this.rigidBodiesData[off + 15] || 0.72) * 255;
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.fillStyle = `rgba(${r},${g},${bl},0.5)`;
                ctx.strokeStyle = `rgba(${r},${g},${bl},0.9)`;
                ctx.lineWidth = 2;
                if (type === 0) {
                    ctx.fillRect(-dim1, -dim2, dim1 * 2, dim2 * 2);
                    ctx.strokeRect(-dim1, -dim2, dim1 * 2, dim2 * 2);
                } else if (type === 1) {
                    ctx.beginPath();
                    ctx.arc(0, 0, dim1, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(dim1, 0);
                    ctx.lineTo(-dim1, 0);
                    ctx.stroke();
                } else if (type === 2) {
                    const v0x = this.rigidBodiesData[off + 7], v0y = this.rigidBodiesData[off + 8];
                    const v1x = this.rigidBodiesData[off + 9], v1y = this.rigidBodiesData[off + 10];
                    const v2x = this.rigidBodiesData[off + 11], v2y = this.rigidBodiesData[off + 12];
                    ctx.beginPath();
                    ctx.moveTo(v0x, v0y);
                    ctx.lineTo(v1x, v1y);
                    ctx.lineTo(v2x, v2y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // Bateau (vue dessus)
        if (this.boatData) {
            const x = this.boatData.x, y = this.boatData.y, a = this.boatData.angle;
            const length = 24; // Demi-longueur
            const width = 14;  // Demi-largeur
            
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(a);
            
            // Ombre portée sous le bateau
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;
            
            // Coque principale profilée
            ctx.fillStyle = '#f8fafc'; // Blanc éclatant
            ctx.strokeStyle = '#94a3b8'; // Contour gris
            ctx.lineWidth = 1.5;
            
            ctx.beginPath();
            ctx.moveTo(length, 0); // Pointe avant
            ctx.bezierCurveTo(length * 0.5, width * 1.1, -length * 0.8, width * 1.0, -length, width * 0.8); // Bord droit
            ctx.lineTo(-length, -width * 0.8); // Ligne arrière
            ctx.bezierCurveTo(-length * 0.8, -width * 1.0, length * 0.5, -width * 1.1, length, 0); // Bord gauche
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Désactiver l'ombre pour peindre l'intérieur
            ctx.shadowColor = 'transparent';
            
            // Pont intérieur (finition bois)
            ctx.fillStyle = '#b45309'; 
            ctx.beginPath();
            ctx.moveTo(length * 0.4, 0);
            ctx.bezierCurveTo(length * 0.2, width * 0.6, -length * 0.8, width * 0.6, -length * 0.8, width * 0.5);
            ctx.lineTo(-length * 0.8, -width * 0.5);
            ctx.bezierCurveTo(-length * 0.8, -width * 0.6, length * 0.2, -width * 0.6, length * 0.4, 0);
            ctx.fill();
            
            // Pare-brise (Verre teinté courbe)
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.beginPath();
            ctx.moveTo(length * 0.2, 0);
            ctx.quadraticCurveTo(0, width * 0.8, -length * 0.2, width * 0.65);
            ctx.lineTo(-length * 0.2, -width * 0.65);
            ctx.quadraticCurveTo(0, -width * 0.8, length * 0.2, 0);
            ctx.fill();

            // Moteur hors-bord (Bloc noir à l'arrière)
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.roundRect(-length - 6, -5, 10, 10, 2);
            ctx.fill();
            
            // Ligne de flottaison centrale (Déco sportive)
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(length * 0.7, 0);
            ctx.lineTo(-length * 0.6, 0);
            ctx.stroke();
            
            ctx.restore();
        }

        // Missile en vol
        if (this.missileData) {
            const mx = this.missileData.x, my = this.missileData.y;
            const mvx = this.missileData.vx, mvy = this.missileData.vy;
            const mAngle = Math.atan2(mvy, mvx);
            const t = performance.now() / 1000;

            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(mAngle);

            // Halo lumineux autour du missile
            const haloGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
            haloGrad.addColorStop(0, 'rgba(255, 150, 50, 0.25)');
            haloGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
            ctx.fillStyle = haloGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 20, 0, Math.PI * 2);
            ctx.fill();

            // Lueur de la traînée
            ctx.shadowColor = 'rgba(255, 80, 0, 0.8)';
            ctx.shadowBlur = 16;

            // Corps du missile (métal sombre)
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.ellipse(0, 0, 9, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();

            // Bande dorée
            ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.ellipse(2, 0, 2, 3.5, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Ogive (rouge vif)
            ctx.fillStyle = '#dc2626';
            ctx.beginPath();
            ctx.moveTo(9, 0);
            ctx.quadraticCurveTo(12, -2, 14, 0);
            ctx.quadraticCurveTo(12, 2, 9, 0);
            ctx.fill();

            // Ailerons arrière
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(-8, -3);
            ctx.lineTo(-12, -6);
            ctx.lineTo(-10, -3);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-8, 3);
            ctx.lineTo(-12, 6);
            ctx.lineTo(-10, 3);
            ctx.fill();

            // Flamme d'échappement principale (animée)
            ctx.shadowBlur = 0;
            const flicker = 0.8 + Math.sin(t * 40) * 0.2;
            const flameLen = 16 * flicker;
            const grad = ctx.createLinearGradient(-9, 0, -9 - flameLen, 0);
            grad.addColorStop(0, 'rgba(255, 255, 200, 0.9)');
            grad.addColorStop(0.3, 'rgba(255, 180, 50, 0.8)');
            grad.addColorStop(0.7, 'rgba(255, 80, 0, 0.4)');
            grad.addColorStop(1, 'rgba(200, 30, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(-9, -2.5);
            ctx.quadraticCurveTo(-9 - flameLen * 0.6, -4 * flicker, -9 - flameLen, 0);
            ctx.quadraticCurveTo(-9 - flameLen * 0.6, 4 * flicker, -9, 2.5);
            ctx.fill();

            // Flamme intérieure (coeur blanc)
            ctx.fillStyle = 'rgba(255, 255, 230, 0.6)';
            ctx.beginPath();
            ctx.moveTo(-9, -1.2);
            ctx.quadraticCurveTo(-9 - flameLen * 0.3, -1.5, -9 - flameLen * 0.5, 0);
            ctx.quadraticCurveTo(-9 - flameLen * 0.3, 1.5, -9, 1.2);
            ctx.fill();

            ctx.restore();
        }

        // ==========================================
        // ENEMY BOATS
        // ==========================================
        if (this.enemiesData && this.enemiesData.length > 0) {
            for (const en of this.enemiesData) {
                if (!en.alive) continue;
                const ex = en.x, ey = en.y, ea = en.angle;
                const eLen = 16, eWid = 10;

                ctx.save();
                ctx.translate(ex, ey);
                ctx.rotate(ea);

                // Shadow
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetY = 2;

                // Hull - dark red
                ctx.fillStyle = '#1e1e1e';
                ctx.strokeStyle = '#dc2626';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(eLen, 0);
                ctx.bezierCurveTo(eLen * 0.5, eWid * 1.1, -eLen * 0.8, eWid, -eLen, eWid * 0.8);
                ctx.lineTo(-eLen, -eWid * 0.8);
                ctx.bezierCurveTo(-eLen * 0.8, -eWid, eLen * 0.5, -eWid * 1.1, eLen, 0);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.shadowColor = 'transparent';

                // Danger stripe
                ctx.strokeStyle = 'rgba(255,60,60,0.7)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(eLen * 0.6, 0);
                ctx.lineTo(-eLen * 0.5, 0);
                ctx.stroke();

                // Windshield
                ctx.fillStyle = 'rgba(220,40,40,0.6)';
                ctx.beginPath();
                ctx.moveTo(eLen * 0.15, 0);
                ctx.quadraticCurveTo(0, eWid * 0.65, -eLen * 0.15, eWid * 0.5);
                ctx.lineTo(-eLen * 0.15, -eWid * 0.5);
                ctx.quadraticCurveTo(0, -eWid * 0.65, eLen * 0.15, 0);
                ctx.fill();

                // Engine block
                ctx.fillStyle = '#991b1b';
                ctx.beginPath();
                ctx.roundRect(-eLen - 4, -3.5, 7, 7, 1.5);
                ctx.fill();

                ctx.restore();

                // HP bar above enemy
                const hpFrac = en.hp / 3;
                const barW = 24, barH = 3;
                const barX = ex - barW / 2, barY = ey - eWid - 10;
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
                ctx.fillStyle = hpFrac > 0.5 ? '#22c55e' : hpFrac > 0.25 ? '#eab308' : '#ef4444';
                ctx.fillRect(barX, barY, barW * hpFrac, barH);
            }
        }

        // ==========================================
        // ENEMY MISSILES
        // ==========================================
        if (this.enemyMissilesData && this.enemyMissilesData.length > 0) {
            for (const em of this.enemyMissilesData) {
                const emAngle = Math.atan2(em.vy, em.vx);
                ctx.save();
                ctx.translate(em.x, em.y);
                ctx.rotate(emAngle);

                // Red glow
                const eGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 12);
                eGrad.addColorStop(0, 'rgba(255,60,60,0.3)');
                eGrad.addColorStop(1, 'rgba(255,0,0,0)');
                ctx.fillStyle = eGrad;
                ctx.beginPath();
                ctx.arc(0, 0, 12, 0, Math.PI * 2);
                ctx.fill();

                // Body
                ctx.fillStyle = '#7f1d1d';
                ctx.beginPath();
                ctx.ellipse(0, 0, 6, 2.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // Tip
                ctx.fillStyle = '#fbbf24';
                ctx.beginPath();
                ctx.moveTo(6, 0);
                ctx.quadraticCurveTo(9, -1.5, 10, 0);
                ctx.quadraticCurveTo(9, 1.5, 6, 0);
                ctx.fill();

                // Flame
                const fl = 0.8 + Math.sin(performance.now() / 25) * 0.2;
                const fLen = 8 * fl;
                const fGrad = ctx.createLinearGradient(-6, 0, -6 - fLen, 0);
                fGrad.addColorStop(0, 'rgba(255,200,100,0.8)');
                fGrad.addColorStop(0.5, 'rgba(255,80,20,0.5)');
                fGrad.addColorStop(1, 'rgba(200,20,0,0)');
                ctx.fillStyle = fGrad;
                ctx.beginPath();
                ctx.moveTo(-6, -1.8);
                ctx.quadraticCurveTo(-6 - fLen * 0.6, -2.5 * fl, -6 - fLen, 0);
                ctx.quadraticCurveTo(-6 - fLen * 0.6, 2.5 * fl, -6, 1.8);
                ctx.fill();

                ctx.restore();
            }
        }

        // ==========================================
        // HUD: HP BAR + SCORE (only when boat active)
        // ==========================================
        if (this.boatData) {
            const hudY = h - 40;
            const hpBarW = 200, hpBarH = 14;
            const hpBarX = (w - hpBarW) / 2;
            const hpFrac = Math.max(0, this.playerHP / this.playerMaxHP);

            // Background
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.roundRect(hpBarX - 4, hudY - 4, hpBarW + 8, hpBarH + 8, 6);
            ctx.fill();

            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(hpBarX - 4, hudY - 4, hpBarW + 8, hpBarH + 8, 6);
            ctx.stroke();

            // HP fill
            const hpGrad = ctx.createLinearGradient(hpBarX, hudY, hpBarX + hpBarW * hpFrac, hudY);
            if (hpFrac > 0.5) {
                hpGrad.addColorStop(0, '#22c55e');
                hpGrad.addColorStop(1, '#16a34a');
            } else if (hpFrac > 0.25) {
                hpGrad.addColorStop(0, '#eab308');
                hpGrad.addColorStop(1, '#ca8a04');
            } else {
                hpGrad.addColorStop(0, '#ef4444');
                hpGrad.addColorStop(1, '#dc2626');
            }
            if (hpFrac > 0) {
                ctx.fillStyle = hpGrad;
                ctx.beginPath();
                ctx.roundRect(hpBarX, hudY, hpBarW * hpFrac, hpBarH, 3);
                ctx.fill();
            }

            // HP text
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.ceil(this.playerHP)} / ${this.playerMaxHP}`, w / 2, hudY + hpBarH / 2);

            // HP label
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '9px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('HP', hpBarX - 8, hudY + hpBarH / 2);

            // ---- Score (top-right) ----
            const scoreStr = `SCORE  ${this.playerScore}`;
            ctx.font = 'bold 16px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';

            // Score background pill
            const scoreW = ctx.measureText(scoreStr).width + 20;
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath();
            ctx.roundRect(w - scoreW - 16, 12, scoreW + 8, 28, 8);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.fillText(scoreStr, w - 16, 17);
        }

        // ==========================================
        // GAME OVER OVERLAY
        // ==========================================
        if (this.boatData && !this.playerAlive) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, 0, w, h);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // GAME OVER title
            ctx.font = 'bold 48px system-ui, sans-serif';
            ctx.fillStyle = '#ef4444';
            ctx.shadowColor = 'rgba(239,68,68,0.6)';
            ctx.shadowBlur = 20;
            ctx.fillText('GAME OVER', w / 2, h / 2 - 30);
            ctx.shadowBlur = 0;

            // Score
            ctx.font = 'bold 22px system-ui, sans-serif';
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(`Score final : ${this.playerScore}`, w / 2, h / 2 + 20);

            // Hint
            ctx.font = '14px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillText('Cliquez sur Reset pour recommencer', w / 2, h / 2 + 55);
        }

        // Draw tool cursor when mouse is over canvas
        if (this.mouseOver) {
            this._drawToolCursor(ctx);
        }
    }

    _drawPortal(ctx, x, y, colorBase, phase) {
        ctx.save();
        ctx.translate(x, y);

        // Outer ring
        ctx.strokeStyle = colorBase + '0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glow
        const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 25);
        grad.addColorStop(0, colorBase + '0.4)');
        grad.addColorStop(1, colorBase + '0.0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Spinning particles
        for (let i = 0; i < 4; i++) {
            const angle = phase + (Math.PI / 2) * i;
            const px = Math.cos(angle) * 18;
            const py = Math.sin(angle) * 18;
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = colorBase + '0.8)';
            ctx.fill();
        }

        ctx.restore();
    }

    _drawToolCursor(ctx) {
        const x = this.mouseX;
        const y = this.mouseY;
        if (x < -100 || y < -100) return; // not initialized yet

        ctx.save();
        switch (this.activeTool) {
            case 'push': {
                ctx.beginPath();
                ctx.arc(x, y, 45, 0, Math.PI * 2);
                const grad = ctx.createRadialGradient(x - 8, y - 8, 3, x, y, 45);
                grad.addColorStop(0, 'rgba(255,255,255,0.35)');
                grad.addColorStop(1, 'rgba(255,255,255,0.03)');
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                break;
            }

            case 'emitter': {
                // Crosshair
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y);
                ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y);
                ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5);
                ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(6, 182, 212, 0.8)';
                ctx.fill();
                break;
            }

            case 'drain': {
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(x, y, 30, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
                ctx.fill();
                break;
            }

            case 'wall': {
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y);
                ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
                ctx.stroke();
                break;
            }

            case 'rigidBody': {
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y);
                ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12);
                ctx.stroke();
                ctx.strokeRect(x - 8, y - 6, 16, 12);
                break;
            }

            case 'boat': {
                ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                // Coque
                ctx.moveTo(x + 16, y);
                ctx.quadraticCurveTo(x + 8, y + 10, x - 16, y + 8);
                ctx.lineTo(x - 16, y - 8);
                ctx.quadraticCurveTo(x + 8, y - 10, x + 16, y);
                ctx.stroke();
                // Pare-brise simplifié
                ctx.beginPath();
                ctx.moveTo(x + 4, y);
                ctx.lineTo(x - 4, y + 6);
                ctx.lineTo(x - 4, y - 6);
                ctx.closePath();
                ctx.stroke();
                break;
            }

            case 'vortex': {
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
                ctx.lineWidth = 1.5;
                const t = performance.now() / 500;
                for (let ring = 0; ring < 3; ring++) {
                    ctx.beginPath();
                    ctx.arc(x, y, 30 + ring * 20, t + ring * 0.8, t + ring * 0.8 + Math.PI * 1.2);
                    ctx.stroke();
                }
                break;
            }

            case 'wind': {
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1.5;
                const phase = performance.now() / 300;
                for (let i = 0; i < 3; i++) {
                    const offset = ((phase + i * 5) % 30) - 15;
                    const yOff = -12 + i * 12;
                    ctx.beginPath();
                    ctx.moveTo(x - 15 + offset, y + yOff);
                    ctx.lineTo(x + 15 + offset, y + yOff);
                    // Arrow tip
                    ctx.lineTo(x + 10 + offset, y + yOff - 3);
                    ctx.moveTo(x + 15 + offset, y + yOff);
                    ctx.lineTo(x + 10 + offset, y + yOff + 3);
                    ctx.stroke();
                }
                break;
            }

            case 'attractor': {
                ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
                ctx.lineWidth = 1;
                const t2 = performance.now() / 800;
                // Center dot
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
                ctx.fill();
                // Converging arrows
                for (let i = 0; i < 4; i++) {
                    const angle = (Math.PI / 2) * i + t2;
                    const r1 = 35, r2 = 18;
                    ctx.beginPath();
                    ctx.moveTo(x + Math.cos(angle) * r1, y + Math.sin(angle) * r1);
                    ctx.lineTo(x + Math.cos(angle) * r2, y + Math.sin(angle) * r2);
                    ctx.stroke();
                }
                break;
            }

            case 'eraser': {
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(x, y, 30, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                // X in center
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
                ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
                ctx.stroke();
                break;
            }

            case 'explosion': {
                const t3 = performance.now() / 400;
                // Expanding rings
                for (let ring = 0; ring < 3; ring++) {
                    const phase = (t3 + ring * 0.7) % 2.0;
                    const radius = 10 + phase * 30;
                    const alpha = Math.max(0, 0.6 - phase * 0.3);
                    ctx.strokeStyle = `rgba(255, ${120 - ring * 30}, 30, ${alpha})`;
                    ctx.lineWidth = 2 - ring * 0.5;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.stroke();
                }
                // Center spark
                ctx.fillStyle = 'rgba(255, 200, 50, 0.7)';
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'localGravity': {
                const t4 = performance.now() / 600;
                // Concentric rings pulsing inward
                for (let ring = 0; ring < 3; ring++) {
                    const phase = (t4 + ring * 0.5) % 1.5;
                    const radius = 50 - phase * 25;
                    const alpha = 0.15 + phase * 0.2;
                    ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(x, y, Math.max(5, radius), 0, Math.PI * 2);
                    ctx.stroke();
                }
                // Center dot
                ctx.fillStyle = 'rgba(168, 85, 247, 0.6)';
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'freeze': {
                const isFreezing = !this.shiftHeld;
                const color = isFreezing ? '100, 200, 255' : '255, 180, 50';
                const label = isFreezing ? 'GEL' : 'DEGELER';
                ctx.strokeStyle = `rgba(${color}, 0.5)`;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.arc(x, y, 50, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                if (isFreezing) {
                    // Snowflake pattern
                    ctx.strokeStyle = `rgba(${color}, 0.6)`;
                    ctx.lineWidth = 1.5;
                    for (let i = 0; i < 6; i++) {
                        const angle = (Math.PI / 3) * i;
                        ctx.beginPath();
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
                        ctx.stroke();
                    }
                } else {
                    // Sun pattern
                    ctx.strokeStyle = `rgba(${color}, 0.6)`;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(x, y, 6, 0, Math.PI * 2);
                    ctx.stroke();
                    for (let i = 0; i < 8; i++) {
                        const angle = (Math.PI / 4) * i;
                        ctx.beginPath();
                        ctx.moveTo(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8);
                        ctx.lineTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
                        ctx.stroke();
                    }
                }

                // Label
                ctx.fillStyle = `rgba(${color}, 0.5)`;
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(label, x, y + 65);
                break;
            }

            case 'teleporter': {
                const isFirst = !this.pendingPortal;
                const color = isFirst ? '59, 130, 246' : '249, 115, 22';
                const label = isFirst ? 'PORTAIL 1' : 'PORTAIL 2';
                ctx.strokeStyle = `rgba(${color}, 0.5)`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 25, 0, Math.PI * 2);
                ctx.stroke();

                // Center dot
                ctx.fillStyle = `rgba(${color}, 0.5)`;
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();

                // Label
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(label, x, y + 40);

                // Line from pending portal to cursor
                if (this.pendingPortal) {
                    ctx.strokeStyle = 'rgba(200, 200, 200, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 6]);
                    ctx.beginPath();
                    ctx.moveTo(this.pendingPortal.x, this.pendingPortal.y);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                break;
            }
        }
        ctx.restore();
    }

    reset() {
        this.emitters = [];
        this.drains = [];
        this.walls = [];
        this.portalPairs = [];
        this.rigidBodies = [];
        this.pendingPortal = null;
        this.boatData = null;
        this.missileData = null;
        this.enemiesData = [];
        this.enemyMissilesData = [];
        this.playerHP = 100;
        this.playerMaxHP = 100;
        this.playerScore = 0;
        this.playerAlive = true;
        this._gameOverShown = false;
        this.vfxExplosions = [];
        this.vfxDebris = [];
        this.vfxSmoke = [];
        this._lastMissilePos = null;
        this.worker.postMessage({ type: 'clearPortals' });
        this.worker.postMessage({ type: 'clearRigidBodies' });
        this.worker.postMessage({ type: 'removeBoat' });
    }
}
