// ==========================================
// UI - Options Overlay (Échap)
// ==========================================

export class UI {
    constructor(worker, renderer, toolManager, recorder) {
        this.worker = worker;
        this.renderer = renderer;
        this.tools = toolManager;
        this.recorder = recorder;

        // Current params
        this.params = {
            // Physics
            gravity: 0,
            gasConst: 6000,
            nearGasConst: 15000,
            viscosity: 5,
            surfaceTension: 1500,
            // Render
            waterColor: [6/255, 182/255, 212/255],
            deepColor: [5/255, 38/255, 89/255],
            specularPower: 40,
            specularIntensity: 0.8,
            refractionStrength: 1.5,
            fresnelPower: 3.0,
            threshold: 0.2,
            particleSize: 28,
            causticsEnabled: true,
            foamEnabled: true,
            envReflectionStrength: 0.25,
            shadowEnabled: true,
            bloomEnabled: true,
            bloomIntensity: 0.4,
        };

        this._initOverlay();
        this._initButtons();
        this._syncPhysics();
        this._syncRender();
    }

    _hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
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
        s.waterColor = this.params.waterColor;
        s.deepColor = this.params.deepColor;
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

    _initOverlay() {
        // Physics sliders
        const physicsSliders = [
            { id: 'opt-gravity',      valId: 'opt-gravity-val',      param: 'gravity'        },
            { id: 'opt-viscosity',    valId: 'opt-viscosity-val',    param: 'viscosity'      },
            { id: 'opt-surface',      valId: 'opt-surface-val',      param: 'surfaceTension' },
            { id: 'opt-gasconst',     valId: 'opt-gasconst-val',     param: 'gasConst'       },
            { id: 'opt-neargasconst', valId: 'opt-neargasconst-val', param: 'nearGasConst'   },
        ];
        physicsSliders.forEach(({ id, valId, param }) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            el.addEventListener('input', () => {
                this.params[param] = parseFloat(el.value);
                valEl.textContent = el.value;
                this._syncPhysics();
            });
        });

        // Render sliders
        const renderSliders = [
            { id: 'opt-particlesize',      valId: 'opt-particlesize-val',      param: 'particleSize'   },
            { id: 'opt-bloom-intensity',   valId: 'opt-bloom-intensity-val',   param: 'bloomIntensity' },
        ];
        renderSliders.forEach(({ id, valId, param }) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            el.addEventListener('input', () => {
                this.params[param] = parseFloat(el.value);
                valEl.textContent = el.value;
                this._syncRender();
            });
        });

        // Color pickers
        document.getElementById('opt-watercolor').addEventListener('input', (e) => {
            this.params.waterColor = this._hexToRgb(e.target.value);
            this._syncRender();
        });
        document.getElementById('opt-deepcolor').addEventListener('input', (e) => {
            this.params.deepColor = this._hexToRgb(e.target.value);
            this._syncRender();
        });

        // Bloom toggle — show/hide intensity row
        document.getElementById('opt-bloom').addEventListener('change', (e) => {
            this.params.bloomEnabled = e.target.checked;
            document.getElementById('opt-bloom-intensity-row').style.display =
                e.target.checked ? 'flex' : 'none';
            this._syncRender();
        });

        // Caustics toggle
        document.getElementById('opt-caustics').addEventListener('change', (e) => {
            this.params.causticsEnabled = e.target.checked;
            this._syncRender();
        });

        // Foam toggle
        document.getElementById('opt-foam').addEventListener('change', (e) => {
            this.params.foamEnabled = e.target.checked;
            this._syncRender();
        });

        // Close: backdrop click or ✕ button
        const overlay = document.getElementById('options-overlay');
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
        document.getElementById('options-close').addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
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
        const threadLabel = multiWorker ? `${workerCount}W` : '1T';
        document.getElementById('fps-counter').textContent =
            `Rendu: ${fps} FPS | Sim: ${simFps} FPS | ${threadLabel} | Particules: ${particleCount}`;
    }
}
