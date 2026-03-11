// ==========================================
// UI - Tweakpane + Presets
// ==========================================
import { Pane } from 'tweakpane';
import { PRESETS } from './presets.js';

export class UI {
    constructor(worker, renderer, toolManager, recorder) {
        this.worker = worker;
        this.renderer = renderer;
        this.tools = toolManager;
        this.recorder = recorder;

        // Current params (mutable, bound to Tweakpane)
        this.params = {
            // Physics
            gravity: 0,            // 0G par défaut
            gasConst: 4000,        // Forte pression pour éviter que les particules s'agglomèrent
            nearGasConst: 6000,
            viscosity: 5,          // Viscosité basse pour un fluide réaliste
            surfaceTension: 1500,
            // Render
            mode: 'water',
            waterColor: { r: 6, g: 182, b: 212 },
            deepColor: { r: 5, g: 38, b: 89 },
            specularPower: 40,
            specularIntensity: 0.8,
            refractionStrength: 1.5,
            fresnelPower: 3.0,
            threshold: 0.2,
            particleSize: 28,
            causticsEnabled: true,
            foamEnabled: true,
            // New visual settings
            envReflectionStrength: 0.25,
            shadowEnabled: true,
            bloomEnabled: true,
            bloomIntensity: 0.4,
            // Performance
            fps: 0,
            simFps: 0,
            particleCount: 0,
            foamCount: 0,
            threading: 'single',
            // Tool strength
            toolStrength: 500
        };

        this._initTweakpane();
        this._initPresets();
        this._initButtons();
    }

    _rgbToArray(c) {
        return [c.r / 255, c.g / 255, c.b / 255];
    }

    _arrayToRgb(arr) {
        return { r: Math.round(arr[0] * 255), g: Math.round(arr[1] * 255), b: Math.round(arr[2] * 255) };
    }

    _initTweakpane() {
        const container = document.getElementById('tweakpane-container');

        this.pane = new Pane({
            container,
            title: 'Parametres'
        });

        // === Physics folder ===
        const physics = this.pane.addFolder({ title: 'Physique', expanded: true });

        physics.addBinding(this.params, 'gravity', {
            min: -2000, max: 3000, step: 10,
            label: 'Gravite'
        }).on('change', () => this._syncPhysics());

        physics.addBinding(this.params, 'viscosity', {
            min: 0, max: 1000, step: 5,
            label: 'Viscosite'
        }).on('change', () => this._syncPhysics());

        physics.addBinding(this.params, 'surfaceTension', {
            min: 0, max: 3000, step: 50,
            label: 'Tension surf.'
        }).on('change', () => this._syncPhysics());

        physics.addBinding(this.params, 'gasConst', {
            min: 500, max: 20000, step: 100,
            label: 'Rigidite'
        }).on('change', () => this._syncPhysics());

        physics.addBinding(this.params, 'nearGasConst', {
            min: 1000, max: 30000, step: 100,
            label: 'Anti-compression'
        }).on('change', () => this._syncPhysics());

        // === Rendering folder ===
        const rendering = this.pane.addFolder({ title: 'Rendu', expanded: false });

        rendering.addBinding(this.params, 'mode', {
            options: { 'Eau realiste': 'water', 'Particules': 'debug' },
            label: 'Mode'
        }).on('change', () => {
            this.renderer.settings.mode = this.params.mode;
        });

        rendering.addBinding(this.params, 'waterColor', { label: 'Couleur' })
            .on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'deepColor', { label: 'Profondeur' })
            .on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'specularPower', {
            min: 5, max: 120, step: 1, label: 'Brillance'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'specularIntensity', {
            min: 0, max: 3, step: 0.05, label: 'Reflets'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'refractionStrength', {
            min: 0, max: 5, step: 0.1, label: 'Refraction'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'fresnelPower', {
            min: 0.5, max: 8, step: 0.1, label: 'Bords lumineux'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'threshold', {
            min: 0.05, max: 0.5, step: 0.01, label: 'Seuil surface'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'particleSize', {
            min: 10, max: 50, step: 1, label: 'Taille'
        }).on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'causticsEnabled', { label: 'Caustiques' })
            .on('change', () => this._syncRender());
        rendering.addBinding(this.params, 'foamEnabled', { label: 'Mousse' })
            .on('change', () => this._syncRender());

        // === Effects folder ===
        const effects = this.pane.addFolder({ title: 'Effets', expanded: false });

        effects.addBinding(this.params, 'envReflectionStrength', {
            min: 0, max: 1, step: 0.05, label: 'Reflets env.'
        }).on('change', () => this._syncRender());

        effects.addBinding(this.params, 'shadowEnabled', { label: 'Ombres' })
            .on('change', () => this._syncRender());

        effects.addBinding(this.params, 'bloomEnabled', { label: 'Bloom' })
            .on('change', () => this._syncRender());

        effects.addBinding(this.params, 'bloomIntensity', {
            min: 0, max: 2, step: 0.05, label: 'Intensite bloom'
        }).on('change', () => this._syncRender());

        // === Tools folder ===
        const tools = this.pane.addFolder({ title: 'Force des outils', expanded: false });
        tools.addBinding(this.params, 'toolStrength', {
            min: 100, max: 2000, step: 50, label: 'Intensite'
        }).on('change', () => {
            this.worker.postMessage({ type: 'tool', tool: this.tools.activeTool, strength: this.params.toolStrength });
        });

        // === Performance folder ===
        const perf = this.pane.addFolder({ title: 'Performance', expanded: false });
        perf.addBinding(this.params, 'fps', {
            readonly: true, label: 'Rendu FPS',
            view: 'graph', min: 0, max: 120
        });
        perf.addBinding(this.params, 'simFps', {
            readonly: true, label: 'Sim FPS',
            view: 'graph', min: 0, max: 300
        });
        perf.addBinding(this.params, 'particleCount', { readonly: true, label: 'Particules' });
        perf.addBinding(this.params, 'foamCount', { readonly: true, label: 'Mousse' });
        perf.addBinding(this.params, 'threading', { readonly: true, label: 'Threading' });
    }

    _syncPhysics() {
        this.worker.postMessage({
            type: 'params',
            gravity: this.params.gravity,
            gasConst: this.params.gasConst,
            nearGasConst: this.params.nearGasConst,
            viscosity: this.params.viscosity,
            surfaceTension: this.params.surfaceTension
        });
    }

    _syncRender() {
        const s = this.renderer.settings;
        s.waterColor = this._rgbToArray(this.params.waterColor);
        s.deepColor = this._rgbToArray(this.params.deepColor);
        s.specularPower = this.params.specularPower;
        s.specularIntensity = this.params.specularIntensity;
        s.refractionStrength = this.params.refractionStrength;
        s.fresnelPower = this.params.fresnelPower;
        s.threshold = this.params.threshold;
        s.particleSize = this.params.particleSize;
        s.causticsEnabled = this.params.causticsEnabled;
        s.foamEnabled = this.params.foamEnabled;
        s.envReflectionStrength = this.params.envReflectionStrength;
        s.shadowEnabled = this.params.shadowEnabled;
        s.bloomEnabled = this.params.bloomEnabled;
        s.bloomIntensity = this.params.bloomIntensity;
    }

    _initPresets() {
        const grid = document.getElementById('presets-grid');
        if (!grid) return;
        
        grid.innerHTML = '';
        const presetKeys = Object.keys(PRESETS);
        
        presetKeys.forEach((key, index) => {
            const preset = PRESETS[key];
            const btn = document.createElement('button');
            btn.className = 'preset-btn' + (index === 0 ? ' active' : '');
            btn.dataset.preset = key;
            btn.textContent = preset.name;
            grid.appendChild(btn);
        });

        const buttons = document.querySelectorAll('.preset-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = PRESETS[btn.dataset.preset];
                if (!preset) return;

                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this.applyPreset(preset);
            });
        });
    }

    applyPreset(preset) {
        // Apply physics
        const p = preset.physics;
        this.params.gravity = p.gravity;
        this.params.gasConst = p.gasConst;
        this.params.nearGasConst = p.nearGasConst;
        this.params.viscosity = p.viscosity;
        this.params.surfaceTension = p.surfaceTension;
        this._syncPhysics();

        // Apply rendering
        const r = preset.render;
        this.params.waterColor = this._arrayToRgb(r.waterColor);
        this.params.deepColor = this._arrayToRgb(r.deepColor);
        this.params.specularPower = r.specularPower;
        this.params.specularIntensity = r.specularIntensity;
        this.params.refractionStrength = r.refractionStrength;
        this.params.fresnelPower = r.fresnelPower;
        this.params.threshold = r.threshold;
        this.params.particleSize = r.particleSize;
        this.params.causticsEnabled = r.causticsEnabled;
        this.params.foamEnabled = r.foamEnabled;
        this._syncRender();

        // Refresh Tweakpane
        this.pane.refresh();
    }

    _initButtons() {
        document.getElementById('btn-add').addEventListener('click', () => {
            this.worker.postMessage({ type: 'addParticles', count: 400 });
        });

        document.getElementById('btn-reset').addEventListener('click', () => {
            this.tools.reset();
            this.worker.postMessage({ type: 'reset' });
        });

        document.getElementById('btn-record').addEventListener('click', () => {
            const isRecording = this.recorder.toggleRecording();
            const btn = document.getElementById('btn-record');
            if (isRecording) {
                btn.textContent = 'Stop';
                btn.classList.add('recording');
            } else {
                btn.textContent = 'Enregistrer';
                btn.classList.remove('recording');
            }
        });

        document.getElementById('btn-screenshot').addEventListener('click', () => {
            this.recorder.screenshot();
        });
    }

    updateStats(fps, particleCount, foamCount, simFps, multiWorker, workerCount, simTime, renderTime) {
        this.params.fps = fps;
        this.params.simFps = simFps;
        this.params.particleCount = particleCount;
        this.params.foamCount = foamCount;
        this.params.threading = multiWorker ? `${workerCount} workers` : 'single';
        this.pane.refresh();

        const threadLabel = multiWorker ? `${workerCount}W` : '1T';
        document.getElementById('fps-counter').textContent =
            `Rendu: ${fps} FPS | Sim: ${simFps} FPS | ${threadLabel} | Particules: ${particleCount}`;
    }
}
