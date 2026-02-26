// ==========================================
// WEBGL2 RENDERER - Pipeline multi-pass
// ==========================================
import {
    particleVertexShader, densityFragmentShader, thicknessFragmentShader,
    densityThicknessMRTFragmentShader,
    fullscreenVertexShader, surfaceFragmentShader, compositeFragmentShader,
    backgroundFragmentShader, foamVertexShader, foamFragmentShader,
    debugVertexShader, debugFragmentShader,
    shadowVertexShader, shadowFragmentShader, shadowBlurFragmentShader,
    bloomExtractFragmentShader, bloomBlurFragmentShader, bloomCompositeFragmentShader
} from './shaders.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true, // for screenshots/recording
            powerPreference: 'high-performance'
        });

        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }

        this.gl.getExtension('EXT_color_buffer_float');

        this.width = canvas.width;
        this.height = canvas.height;
        this.renderScale = 0.5;
        this.scaledWidth = Math.max(1, Math.floor(this.width * this.renderScale));
        this.scaledHeight = Math.max(1, Math.floor(this.height * this.renderScale));
        this.time = 0;

        // Render settings
        this.settings = {
            mode: 'water', // 'water' or 'debug'
            waterColor: [0.024, 0.714, 0.831],  // cyan
            deepColor: [0.02, 0.15, 0.35],       // deep blue
            lightDir: [0.5, 0.7, 0.5],
            specularPower: 40.0,
            specularIntensity: 0.8,
            refractionStrength: 1.5,
            fresnelPower: 3.0,
            threshold: 0.2,
            particleSize: 28.0,
            foamSize: 6.0,
            causticsEnabled: true,
            foamEnabled: true,
            gridSize: 40.0,
            // New settings
            envReflectionStrength: 0.25,
            shadowEnabled: true,
            shadowOpacity: 0.35,
            shadowSoftness: 3.0,
            bloomEnabled: true,
            bloomThreshold: 0.7,
            bloomIntensity: 0.4
        };

        this.particleCount = 0;
        this.foamCount = 0;

        this._initShaders();
        this._initBuffers();
        this._initFramebuffers();
        this._renderBackground();
    }

    // ==========================================
    // SHADER COMPILATION
    // ==========================================
    _compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    _createProgram(vsSource, fsSource, attribs) {
        const gl = this.gl;
        const vs = this._compileShader(vsSource, gl.VERTEX_SHADER);
        const fs = this._compileShader(fsSource, gl.FRAGMENT_SHADER);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);

        // Bind attribute locations before linking
        if (attribs) {
            attribs.forEach((name, idx) => gl.bindAttribLocation(program, idx, name));
        }

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        // Cache uniform locations
        const uniforms = {};
        const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < numUniforms; i++) {
            const info = gl.getActiveUniform(program, i);
            uniforms[info.name] = gl.getUniformLocation(program, info.name);
        }

        return { program, uniforms };
    }

    _initShaders() {
        // Density pass
        this.densityShader = this._createProgram(
            particleVertexShader, densityFragmentShader,
            ['a_position', 'a_offset', 'a_density', 'a_velocity']
        );

        // Thickness pass (kept for fallback)
        this.thicknessShader = this._createProgram(
            particleVertexShader, thicknessFragmentShader,
            ['a_position', 'a_offset', 'a_density', 'a_velocity']
        );

        // MRT combined density+thickness pass
        this.mrtShader = this._createProgram(
            particleVertexShader, densityThicknessMRTFragmentShader,
            ['a_position', 'a_offset', 'a_density', 'a_velocity']
        );

        // Surface extraction
        this.surfaceShader = this._createProgram(
            fullscreenVertexShader, surfaceFragmentShader,
            ['a_position']
        );

        // Final composite
        this.compositeShader = this._createProgram(
            fullscreenVertexShader, compositeFragmentShader,
            ['a_position']
        );

        // Background
        this.backgroundShader = this._createProgram(
            fullscreenVertexShader, backgroundFragmentShader,
            ['a_position']
        );

        // Foam
        this.foamShader = this._createProgram(
            foamVertexShader, foamFragmentShader,
            ['a_position', 'a_offset', 'a_life', 'a_size']
        );

        // Debug
        this.debugShader = this._createProgram(
            debugVertexShader, debugFragmentShader,
            ['a_position', 'a_offset', 'a_density']
        );

        // Shadow
        this.shadowShader = this._createProgram(
            shadowVertexShader, shadowFragmentShader,
            ['a_position', 'a_offset']
        );

        // Shadow blur
        this.shadowBlurShader = this._createProgram(
            fullscreenVertexShader, shadowBlurFragmentShader,
            ['a_position']
        );

        // Bloom extract
        this.bloomExtractShader = this._createProgram(
            fullscreenVertexShader, bloomExtractFragmentShader,
            ['a_position']
        );

        // Bloom blur
        this.bloomBlurShader = this._createProgram(
            fullscreenVertexShader, bloomBlurFragmentShader,
            ['a_position']
        );

        // Bloom composite
        this.bloomCompositeShader = this._createProgram(
            fullscreenVertexShader, bloomCompositeFragmentShader,
            ['a_position']
        );
    }

    // ==========================================
    // BUFFERS
    // ==========================================
    _initBuffers() {
        const gl = this.gl;

        // Unit quad (centered, size 1)
        const quadVerts = new Float32Array([
            -1, -1,  1, -1,  -1, 1,
             1, -1,  1,  1,  -1, 1
        ]);
        this.quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

        // Fullscreen quad
        this.fsQuadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

        // Instance buffers (dynamic) - pre-allocate at max size
        const MAX_PARTICLES = 10000;
        const MAX_FOAM = 2000;

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * 2 * 4, gl.STREAM_DRAW);

        this.densityBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.densityBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * 4, gl.STREAM_DRAW);

        this.velocityBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * 2 * 4, gl.STREAM_DRAW);

        // Foam buffers - pre-allocate at max size
        this.foamPosBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamPosBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_FOAM * 2 * 4, gl.STREAM_DRAW);

        this.foamLifeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamLifeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_FOAM * 4, gl.STREAM_DRAW);

        this.foamSizeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_FOAM * 4, gl.STREAM_DRAW);

        // VAO for particle rendering
        this.particleVAO = this._createParticleVAO(this.densityShader.program);
        this.thicknessVAO = this._createParticleVAO(this.thicknessShader.program);
        this.mrtVAO = this._createParticleVAO(this.mrtShader.program);
        this.debugVAO = this._createDebugVAO();
        this.shadowVAO = this._createShadowVAO();

        // VAO for fullscreen passes
        this.fsVAO = this._createFullscreenVAO();

        // VAO for foam
        this.foamVAO = this._createFoamVAO();
    }

    _createParticleVAO(program) {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // Quad geometry (attribute 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // Instance position (attribute 1)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        // Instance density (attribute 2)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.densityBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);

        // Instance velocity (attribute 3)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);

        gl.bindVertexArray(null);
        return vao;
    }

    _createDebugVAO() {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.densityBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);

        gl.bindVertexArray(null);
        return vao;
    }

    _createShadowVAO() {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        gl.bindVertexArray(null);
        return vao;
    }

    _createFullscreenVAO() {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadVBO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        return vao;
    }

    _createFoamVAO() {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamPosBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamLifeBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamSizeBuffer);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);

        gl.bindVertexArray(null);
        return vao;
    }

    // ==========================================
    // FRAMEBUFFERS
    // ==========================================
    _createFBO(w, h, internalFormat, format, type) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, texture: tex };
    }

    _createMRTFBO(w, h) {
        const gl = this.gl;

        const densityTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, densityTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const thicknessTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, thicknessTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, densityTex, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, thicknessTex, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, densityTexture: densityTex, thicknessTexture: thicknessTex };
    }

    _initFramebuffers() {
        const gl = this.gl;
        const w = this.width;
        const h = this.height;
        const sw = this.scaledWidth;
        const sh = this.scaledHeight;

        // MRT density+thickness FBO at half resolution
        this.mrtFBO = this._createMRTFBO(sw, sh);
        // Backward-compatible references for composite pass
        this.densityFBO = { texture: this.mrtFBO.densityTexture };
        this.thicknessFBO = { texture: this.mrtFBO.thicknessTexture };

        // Surface normals + mask FBO at half resolution
        this.surfaceFBO = this._createFBO(sw, sh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

        // Background FBO at full resolution
        this.backgroundFBO = this._createFBO(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);

        // Shadow FBOs at half resolution (ping-pong for blur)
        this.shadowFBO = this._createFBO(sw, sh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
        this.shadowBlurFBO = this._createFBO(sw, sh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

        // Composite FBO (for bloom extract input) at full resolution
        this.compositeFBO = this._createFBO(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

        // Bloom FBOs (quarter resolution)
        const bw = Math.max(1, w >> 1);
        const bh = Math.max(1, h >> 1);
        this.bloomExtractFBO = this._createFBO(bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
        this.bloomBlurFBO = this._createFBO(bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    }

    // ==========================================
    // BACKGROUND RENDERING
    // ==========================================
    _renderBackground() {
        const gl = this.gl;
        const shader = this.backgroundShader;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.backgroundFBO.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_gridSize, this.settings.gridSize);

        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ==========================================
    // RESIZE
    // ==========================================
    resize(w, h) {
        this.width = w;
        this.height = h;
        this.scaledWidth = Math.max(1, Math.floor(w * this.renderScale));
        this.scaledHeight = Math.max(1, Math.floor(h * this.renderScale));
        this.canvas.width = w;
        this.canvas.height = h;

        // Recreate framebuffers
        this._deleteFBOs();
        this._initFramebuffers();
        this._renderBackground();
    }

    _deleteFBOs() {
        const gl = this.gl;
        // Delete MRT FBO
        if (this.mrtFBO) {
            gl.deleteFramebuffer(this.mrtFBO.fbo);
            gl.deleteTexture(this.mrtFBO.densityTexture);
            gl.deleteTexture(this.mrtFBO.thicknessTexture);
        }
        const fbos = [
            this.surfaceFBO,
            this.backgroundFBO, this.shadowFBO, this.shadowBlurFBO,
            this.compositeFBO, this.bloomExtractFBO, this.bloomBlurFBO
        ];
        for (const f of fbos) {
            if (f) {
                gl.deleteFramebuffer(f.fbo);
                gl.deleteTexture(f.texture);
            }
        }
    }

    // ==========================================
    // UPDATE DATA FROM WORKER
    // ==========================================
    updateParticleData(positions, densities, velocities, count) {
        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.densityBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, densities);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, velocities);

        this.particleCount = count;
    }

    updateFoamData(positions, life, sizes, count) {
        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamPosBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.foamLifeBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, life);

        if (sizes) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.foamSizeBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizes);
        }

        this.foamCount = count;
    }

    // ==========================================
    // RENDER FRAME
    // ==========================================
    render(dt) {
        this.time += dt;
        const gl = this.gl;

        if (!this.particleCount) {
            // Just show background
            gl.viewport(0, 0, this.width, this.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this._renderComposite(null); // render to screen
            return;
        }

        if (this.settings.mode === 'debug') {
            this._renderDebug();
            return;
        }

        // Pass 1: Shadow map
        if (this.settings.shadowEnabled) {
            this._renderShadowMap();
        }

        // Pass 2+3: Combined density+thickness (MRT, half-res)
        this._renderDensityThicknessMRT();

        // Pass 4: Surface extraction
        this._renderSurface();

        // Pass 5: Final composition
        if (this.settings.bloomEnabled) {
            // Render composite to FBO for bloom
            this._renderComposite(this.compositeFBO);
            // Pass 6: Bloom
            this._renderBloom();
        } else {
            // Render composite directly to screen
            this._renderComposite(null);
        }

        // Pass 7: Foam overlay
        if (this.settings.foamEnabled && this.foamCount > 0) {
            this._renderFoam();
        }
    }

    _renderShadowMap() {
        const gl = this.gl;
        const shader = this.shadowShader;
        const sw = this.scaledWidth;
        const sh = this.scaledHeight;

        // Render shadow splats at half resolution
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO.fbo);
        gl.viewport(0, 0, sw, sh);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_particleSize, this.settings.particleSize);
        gl.uniform1f(shader.uniforms.u_shadowOpacity, this.settings.shadowOpacity);

        // Shadow offset based on light direction
        const ld = this.settings.lightDir;
        const shadowDist = 25.0;
        gl.uniform2f(shader.uniforms.u_shadowOffset,
            ld[0] * shadowDist / (ld[2] + 0.1),
            -ld[1] * shadowDist / (ld[2] + 0.1)
        );

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindVertexArray(this.shadowVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);

        // Blur shadow (2 passes) at half resolution
        const softness = this.settings.shadowSoftness;
        this._blurPass(this.shadowFBO, this.shadowBlurFBO,
            this.shadowBlurShader, softness / sw, 0, sw, sh);
        this._blurPass(this.shadowBlurFBO, this.shadowFBO,
            this.shadowBlurShader, 0, softness / sh, sw, sh);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _blurPass(srcFBO, dstFBO, shader, dirX, dirY, w, h) {
        const gl = this.gl;
        w = w || this.width;
        h = h || this.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO.fbo);
        gl.viewport(0, 0, w, h);

        gl.useProgram(shader.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcFBO.texture);
        gl.uniform1i(shader.uniforms.u_tex, 0);
        gl.uniform2f(shader.uniforms.u_direction, dirX, dirY);

        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }

    // ---- Optimized MRT combined density+thickness pass ----
    _renderDensityThicknessMRT() {
        const gl = this.gl;
        const shader = this.mrtShader;
        const sw = this.scaledWidth;
        const sh = this.scaledHeight;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrtFBO.fbo);
        gl.viewport(0, 0, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_particleSize, this.settings.particleSize);
        gl.uniform3fv(shader.uniforms.u_waterColor, this.settings.waterColor);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindVertexArray(this.mrtVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- Legacy density pass (kept for fallback) ----
    _renderDensityField() {
        const gl = this.gl;
        const shader = this.densityShader;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFBO.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_particleSize, this.settings.particleSize);
        gl.uniform3fv(shader.uniforms.u_waterColor, this.settings.waterColor);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindVertexArray(this.particleVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _renderThickness() {
        const gl = this.gl;
        const shader = this.thicknessShader;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.thicknessFBO.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_particleSize, this.settings.particleSize);
        gl.uniform3fv(shader.uniforms.u_waterColor, this.settings.waterColor);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindVertexArray(this.thicknessVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _renderSurface() {
        const gl = this.gl;
        const shader = this.surfaceShader;
        const sw = this.scaledWidth;
        const sh = this.scaledHeight;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfaceFBO.fbo);
        gl.viewport(0, 0, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.densityFBO.texture);
        gl.uniform1i(shader.uniforms.u_densityTex, 0);

        gl.uniform2f(shader.uniforms.u_texelSize, 1.0 / sw, 1.0 / sh);
        gl.uniform1f(shader.uniforms.u_threshold, this.settings.threshold);

        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _renderComposite(targetFBO) {
        const gl = this.gl;
        const shader = this.compositeShader;

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO ? targetFBO.fbo : null);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader.program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.surfaceFBO.texture);
        gl.uniform1i(shader.uniforms.u_surfaceTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.thicknessFBO.texture);
        gl.uniform1i(shader.uniforms.u_thicknessTex, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.backgroundFBO.texture);
        gl.uniform1i(shader.uniforms.u_backgroundTex, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.densityFBO.texture);
        gl.uniform1i(shader.uniforms.u_densityTex, 3);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowFBO.texture);
        gl.uniform1i(shader.uniforms.u_shadowTex, 4);

        gl.uniform3fv(shader.uniforms.u_waterColor, this.settings.waterColor);
        gl.uniform3fv(shader.uniforms.u_deepColor, this.settings.deepColor);

        const ld = this.settings.lightDir;
        const len = Math.sqrt(ld[0]*ld[0] + ld[1]*ld[1] + ld[2]*ld[2]);
        gl.uniform3f(shader.uniforms.u_lightDir, ld[0]/len, ld[1]/len, ld[2]/len);

        gl.uniform1f(shader.uniforms.u_specularPower, this.settings.specularPower);
        gl.uniform1f(shader.uniforms.u_specularIntensity, this.settings.specularIntensity);
        gl.uniform1f(shader.uniforms.u_refractionStrength, this.settings.refractionStrength);
        gl.uniform1f(shader.uniforms.u_fresnelPower, this.settings.fresnelPower);
        gl.uniform1f(shader.uniforms.u_time, this.time);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1i(shader.uniforms.u_causticsEnabled, this.settings.causticsEnabled ? 1 : 0);
        gl.uniform1i(shader.uniforms.u_foamEnabled, this.settings.foamEnabled ? 1 : 0);
        gl.uniform1f(shader.uniforms.u_envReflectionStrength, this.settings.envReflectionStrength);
        gl.uniform1i(shader.uniforms.u_shadowEnabled, this.settings.shadowEnabled ? 1 : 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
    }

    _renderBloom() {
        const gl = this.gl;
        const bw = Math.max(1, this.width >> 1);
        const bh = Math.max(1, this.height >> 1);

        // Extract bright pixels
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtractFBO.fbo);
        gl.viewport(0, 0, bw, bh);
        gl.useProgram(this.bloomExtractShader.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.compositeFBO.texture);
        gl.uniform1i(this.bloomExtractShader.uniforms.u_sceneTex, 0);
        gl.uniform1f(this.bloomExtractShader.uniforms.u_bloomThreshold, this.settings.bloomThreshold);
        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Blur horizontal
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomBlurFBO.fbo);
        gl.viewport(0, 0, bw, bh);
        gl.useProgram(this.bloomBlurShader.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomExtractFBO.texture);
        gl.uniform1i(this.bloomBlurShader.uniforms.u_tex, 0);
        gl.uniform2f(this.bloomBlurShader.uniforms.u_direction, 2.0 / bw, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Blur vertical
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtractFBO.fbo);
        gl.viewport(0, 0, bw, bh);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomBlurFBO.texture);
        gl.uniform2f(this.bloomBlurShader.uniforms.u_direction, 0, 2.0 / bh);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Composite bloom onto screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.bloomCompositeShader.program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.compositeFBO.texture);
        gl.uniform1i(this.bloomCompositeShader.uniforms.u_sceneTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomExtractFBO.texture);
        gl.uniform1i(this.bloomCompositeShader.uniforms.u_bloomTex, 1);

        gl.uniform1f(this.bloomCompositeShader.uniforms.u_bloomIntensity, this.settings.bloomIntensity);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }

    _renderFoam() {
        const gl = this.gl;
        const shader = this.foamShader;

        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_foamSize, this.settings.foamSize);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindVertexArray(this.foamVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.foamCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
    }

    _renderDebug() {
        const gl = this.gl;
        const shader = this.debugShader;

        // Render background first
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0.059, 0.09, 0.165, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Draw background
        gl.useProgram(this.backgroundShader.program);
        gl.uniform2f(this.backgroundShader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(this.backgroundShader.uniforms.u_gridSize, this.settings.gridSize);
        gl.bindVertexArray(this.fsVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Draw debug particles
        gl.useProgram(shader.program);
        gl.uniform2f(shader.uniforms.u_resolution, this.width, this.height);
        gl.uniform1f(shader.uniforms.u_particleSize, this.settings.particleSize);
        gl.uniform1f(shader.uniforms.u_restDensity, 3.0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindVertexArray(this.debugVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
    }
}
