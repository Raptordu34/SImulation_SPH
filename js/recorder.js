// ==========================================
// VIDEO RECORDER - Capture canvas to WebM
// ==========================================

export class Recorder {
    constructor(canvas) {
        this.canvas = canvas;
        this.recording = false;
        this.mediaRecorder = null;
        this.chunks = [];
    }

    toggleRecording() {
        if (this.recording) {
            this.stop();
        } else {
            this.start();
        }
        return this.recording;
    }

    start() {
        const stream = this.canvas.captureStream(60);

        // Try VP9 first, fallback to VP8, then default
        const mimeTypes = [
            'video/webm; codecs=vp9',
            'video/webm; codecs=vp8',
            'video/webm',
            'video/mp4'
        ];

        let mimeType = '';
        for (const mt of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mt)) {
                mimeType = mt;
                break;
            }
        }

        if (!mimeType) {
            console.error('No supported recording format');
            return;
        }

        this.chunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(this.chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sph-simulation-${Date.now()}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            this.chunks = [];
        };

        this.mediaRecorder.start(100); // collect data every 100ms
        this.recording = true;
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.recording = false;
    }

    screenshot() {
        const dataURL = this.canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `sph-screenshot-${Date.now()}.png`;
        a.click();
    }
}
