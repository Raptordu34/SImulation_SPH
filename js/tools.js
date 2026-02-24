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
                this.worker.postMessage({ type: 'placeBoat', x: pos.x, y: pos.y });
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
    // OVERLAY RENDERING
    // ==========================================
    renderOverlay() {
        const ctx = this.ctx;
        const w = this.overlay.width;
        const h = this.overlay.height;
        ctx.clearRect(0, 0, w, h);

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
            const hw = 22, hh = 14;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(a);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
            ctx.strokeStyle = 'rgba(147, 197, 253, 0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hw, 0);
            ctx.lineTo(-hw * 0.7, hh);
            ctx.lineTo(-hw * 0.5, 0);
            ctx.lineTo(-hw * 0.7, -hh);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
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
                ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x + 14, y);
                ctx.lineTo(x - 10, y + 8);
                ctx.lineTo(x - 6, y);
                ctx.lineTo(x - 10, y - 8);
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
        this.worker.postMessage({ type: 'clearPortals' });
        this.worker.postMessage({ type: 'clearRigidBodies' });
        this.worker.postMessage({ type: 'removeBoat' });
    }
}
