export class BoatControls {
    constructor() {
        this.boatKeysState = { up: false, left: false, down: false, right: false, throttle: 0 };
        this.keyboardThrottle = 0;
        this.gamepadConnected = false;
        this.gamepadIndex = -1;
        this.GAMEPAD_DEADZONE = 0.12;

        this.initEventListeners();
    }

    initEventListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const k = e.key.toLowerCase();
            if (k === 'z') { this.boatKeysState.up = true; }
            if (k === 'q') { this.boatKeysState.left = true; }
            if (k === 's') { this.boatKeysState.down = true; }
            if (k === 'd') { this.boatKeysState.right = true; }
        });

        window.addEventListener('keyup', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const k = e.key.toLowerCase();
            if (k === 'z') { this.boatKeysState.up = false; }
            if (k === 'q') { this.boatKeysState.left = false; }
            if (k === 's') { this.boatKeysState.down = false; }
            if (k === 'd') { this.boatKeysState.right = false; }
        });

        window.addEventListener('gamepadconnected', (e) => {
            this.gamepadConnected = true;
            this.gamepadIndex = e.gamepad.index;
            console.log(`Manette connectée : ${e.gamepad.id}`);
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            if (e.gamepad.index === this.gamepadIndex) {
                this.gamepadConnected = false;
                this.gamepadIndex = -1;
                console.log('Manette déconnectée');
            }
        });
    }

    update(worker, isPaused) {
        if (isPaused) {
            this.keyboardThrottle = 0;
            return;
        }

        // 1. Throttle clavier : montée/descente progressive (toujours actif)
        if (this.boatKeysState.up) {
            this.keyboardThrottle = Math.min(this.keyboardThrottle + 0.08, 1.0); // Accélération plus vive
        } else {
            this.keyboardThrottle = Math.max(this.keyboardThrottle - 0.20, 0); // Freinage beaucoup plus rapide
        }

        // 2. Lire la manette si connectée
        let gpThrottle = 0;
        let gpReverse = false;
        let gpLeft = false;
        let gpRight = false;

        if (this.gamepadConnected) {
            const gamepads = navigator.getGamepads();
            const gp = gamepads[this.gamepadIndex];
            if (gp) {
                // Stick gauche X → direction
                const stickX = Math.abs(gp.axes[0]) > this.GAMEPAD_DEADZONE ? gp.axes[0] : 0;
                // Stick gauche Y → alternative throttle (négatif = avant)
                const stickY = Math.abs(gp.axes[1]) > this.GAMEPAD_DEADZONE ? gp.axes[1] : 0;

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

                gpLeft = stickX < -this.GAMEPAD_DEADZONE;
                gpRight = stickX > this.GAMEPAD_DEADZONE;
            }
        }

        // 3. Combiner clavier + manette
        const combinedThrottle = Math.min(Math.max(gpThrottle, this.keyboardThrottle), 1.0);

        const up = this.boatKeysState.up || gpThrottle > 0.05;
        const down = this.boatKeysState.down || gpReverse;
        const left = this.boatKeysState.left || gpLeft;
        const right = this.boatKeysState.right || gpRight;

        if (
            this.boatKeysState.lastUp !== up ||
            this.boatKeysState.lastDown !== down ||
            this.boatKeysState.lastLeft !== left ||
            this.boatKeysState.lastRight !== right ||
            this.boatKeysState.lastThrottle !== combinedThrottle
        ) {
            this.boatKeysState.lastUp = up;
            this.boatKeysState.lastDown = down;
            this.boatKeysState.lastLeft = left;
            this.boatKeysState.lastRight = right;
            this.boatKeysState.lastThrottle = combinedThrottle;
            
            worker.postMessage({
                type: 'boatKeys',
                up: up,
                down: down,
                left: left,
                right: right,
                throttle: combinedThrottle
            });
        }
    }
}
