// ==========================================
// GLSL SHADERS pour le rendu WebGL2
// ==========================================

// ---- Vertex shader pour les particules (instanced) ----
export const particleVertexShader = `#version 300 es
precision highp float;

// Quad vertices (unit quad)
in vec2 a_position;
// Per-instance data
in vec2 a_offset;    // particle position
in float a_density;  // particle density
in vec2 a_velocity;  // particle velocity

uniform vec2 u_resolution;
uniform float u_particleSize;

out vec2 v_uv;
out float v_density;
out float v_speed;

void main() {
    // Scale quad by particle size
    vec2 pos = a_offset + a_position * u_particleSize;

    // Convert to clip space
    vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y; // flip Y

    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_uv = a_position; // already in [-1, 1] range
    v_density = a_density;
    v_speed = length(a_velocity);
}
`;

// ---- Fragment shader for density field pass ----
export const densityFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_density;
in float v_speed;

uniform vec3 u_waterColor;

out vec4 fragColor;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    // Soft gaussian falloff
    float alpha = exp(-dist * dist * 3.0);

    // Encode density info in the output
    fragColor = vec4(u_waterColor * alpha, alpha);
}
`;

// ---- Fragment shader for thickness pass ----
export const thicknessFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_density;
in float v_speed;

out vec4 fragColor;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    float alpha = exp(-dist * dist * 2.5);
    fragColor = vec4(alpha, alpha, alpha, alpha);
}
`;

// ---- MRT combined density+thickness fragment shader ----
export const densityThicknessMRTFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_density;
in float v_speed;

uniform vec3 u_waterColor;

layout(location = 0) out vec4 densityOut;
layout(location = 1) out vec4 thicknessOut;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    // Density: soft gaussian falloff
    float densityAlpha = exp(-dist * dist * 3.0);
    densityOut = vec4(u_waterColor * densityAlpha, densityAlpha);

    // Thickness: slightly wider falloff
    float thickAlpha = exp(-dist * dist * 2.5);
    thicknessOut = vec4(thickAlpha, thickAlpha, thickAlpha, thickAlpha);
}
`;

// ---- Full-screen quad vertex shader ----
export const fullscreenVertexShader = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ---- Surface extraction: threshold + normals ----
export const surfaceFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_densityTex;
uniform vec2 u_texelSize;
uniform float u_threshold;

out vec4 fragColor;

void main() {
    float center = texture(u_densityTex, v_uv).a;

    // Threshold
    float mask = smoothstep(u_threshold - 0.05, u_threshold + 0.05, center);

    if (mask < 0.01) {
        fragColor = vec4(0.0);
        return;
    }

    // Compute normals from density gradient (central differences)
    float left  = texture(u_densityTex, v_uv - vec2(u_texelSize.x, 0.0)).a;
    float right = texture(u_densityTex, v_uv + vec2(u_texelSize.x, 0.0)).a;
    float down  = texture(u_densityTex, v_uv - vec2(0.0, u_texelSize.y)).a;
    float up    = texture(u_densityTex, v_uv + vec2(0.0, u_texelSize.y)).a;

    vec2 normal = vec2(right - left, up - down);
    float normalLen = length(normal);
    if (normalLen > 0.001) {
        normal /= normalLen;
    }

    // Pack: normal.xy, thickness (from density), mask
    fragColor = vec4(normal * 0.5 + 0.5, center, mask);
}
`;

// ---- Final composition shader (optimized) ----
export const compositeFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_surfaceTex;    // normal.xy, thickness, mask
uniform sampler2D u_thicknessTex;  // accumulated thickness
uniform sampler2D u_backgroundTex; // unused
uniform sampler2D u_densityTex;    // raw density for color
uniform sampler2D u_shadowTex;     // shadow map

uniform vec3 u_waterColor;
uniform vec3 u_deepColor;
uniform vec3 u_lightDir;       
uniform float u_specularPower;
uniform float u_specularIntensity;
uniform float u_refractionStrength;
uniform float u_fresnelPower;
uniform float u_time;
uniform vec2 u_resolution;
uniform int u_causticsEnabled;
uniform int u_foamEnabled;
uniform float u_envReflectionStrength;
uniform int u_shadowEnabled;

out vec4 fragColor;

// Fast caustics using cheap sin-based pattern (replaces 3-octave simplex noise)
float caustics(vec2 uv, float time) {
    vec2 p1 = uv * 8.0 + vec2(time * 0.3, time * 0.2);
    vec2 p2 = uv * 12.0 - vec2(time * 0.2, time * 0.35);
    float c = sin(p1.x) * sin(p1.y) + sin(p2.x) * sin(p2.y);
    c = c * 0.25 + 0.5;
    return c * c;
}

void main() {
    vec4 surface = texture(u_surfaceTex, v_uv);
    float mask = surface.a;

    vec3 abyssColor = u_deepColor * 0.25; 

    if (mask < 0.01) {
        vec4 bg = vec4(abyssColor, 1.0);

        if (u_shadowEnabled == 1) {
            float shadow = texture(u_shadowTex, v_uv).r;
            bg.rgb *= mix(1.0, 0.4, shadow);
        }

        if (u_causticsEnabled == 1) {
            float c = caustics(v_uv, u_time) * 0.15;
            bg.rgb += vec3(0.2, 0.4, 0.6) * c;
        }

        fragColor = bg;
        return;
    }

    // Unpack normals
    vec2 normal = surface.xy * 2.0 - 1.0;
    float thickness = texture(u_thicknessTex, v_uv).r;

    // === REFRACTION ===
    vec3 background = abyssColor;

    if (u_shadowEnabled == 1) {
        vec2 refractedUV = clamp(v_uv + normal * u_refractionStrength * thickness * 0.02, 0.0, 1.0);
        float shadow = texture(u_shadowTex, refractedUV).r;
        background *= mix(1.0, 0.4, shadow);
    }

    // === BEER-LAMBERT ABSORPTION ===
    vec3 transmittance = exp(vec3(-1.2, -0.45, -0.225) * thickness);
    vec3 waterCol = mix(u_deepColor, u_waterColor, transmittance);

    // === BLEND SURFACE / BACKGROUND ===
    float opacity = 1.0 - exp(-thickness * 2.5);
    vec3 color = mix(background, waterCol, opacity * 0.95);

    // === SPECULAR (Blinn-Phong) ===
    vec3 N = normalize(vec3(normal, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0); 
    vec3 halfVec = normalize(u_lightDir + V);
    float spec = pow(max(dot(N, halfVec), 0.0), u_specularPower);
    color += spec * u_specularIntensity;

    // === FRESNEL + ENV REFLECTION (combined) ===
    float NdotV = max(dot(vec3(normal, 0.5), V), 0.0);
    float fresnel = pow(1.0 - NdotV, u_fresnelPower);
    color += vec3(0.6, 0.8, 1.0) * fresnel * 0.3;
    if (u_envReflectionStrength > 0.001) {
        vec3 skyColor = mix(vec3(0.12, 0.15, 0.25), vec3(0.5, 0.7, 1.0), N.y * 0.5 + 0.5);
        color += skyColor * fresnel * u_envReflectionStrength;
    }

    // === CAUSTICS ===
    if (u_causticsEnabled == 1) {
        float c = caustics(v_uv, u_time);
        color += vec3(0.4, 0.6, 0.8) * c * 0.15 * transmittance;
    }

    // === AMBIENT OCCLUSION ===
    color *= mix(0.7, 1.0, smoothstep(0.1, 0.6, thickness));

    fragColor = vec4(color, mask);
}
`;

// ---- Background grid shader ----
export const backgroundFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_gridSize;

out vec4 fragColor;

void main() {
    vec2 pixel = v_uv * u_resolution;

    // Grid pattern
    vec2 grid = mod(pixel, u_gridSize);
    float lineWidth = 1.0;

    float gridLine = 0.0;
    if (grid.x < lineWidth || grid.y < lineWidth) {
        gridLine = 1.0;
    }

    vec3 bgColor = vec3(0.059, 0.09, 0.165); // #0f172a
    vec3 lineColor = vec3(0.118, 0.161, 0.231); // #1e293b

    vec3 color = mix(bgColor, lineColor, gridLine);
    fragColor = vec4(color, 1.0);
}
`;

// ---- Foam vertex shader (with size variation) ----
export const foamVertexShader = `#version 300 es
precision mediump float;

in vec2 a_position;
in vec2 a_offset;
in float a_life;
in float a_size;

uniform vec2 u_resolution;
uniform float u_foamSize;

out vec2 v_uv;
out float v_life;
out float v_size;

void main() {
    float sizeMultiplier = a_size > 0.0 ? a_size : 1.0;
    float size = u_foamSize * a_life * sizeMultiplier;
    vec2 pos = a_offset + a_position * size;
    vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;

    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_uv = a_position; // [-1, 1]
    v_life = a_life;
    v_size = sizeMultiplier;
}
`;

// ---- Foam fragment shader (with type variation) ----
export const foamFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_life;
in float v_size;

out vec4 fragColor;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    float alpha;
    vec3 color;

    if (v_size > 1.3) {
        // Splash: larger, more opaque, slight blue tint
        alpha = (1.0 - dist * dist) * v_life * 0.8;
        color = vec3(0.85, 0.92, 1.0);
    } else if (v_size < 0.6) {
        // Bubble: ring shape
        float ring = smoothstep(0.6, 0.75, dist) * (1.0 - smoothstep(0.85, 1.0, dist));
        float fill = (1.0 - dist * dist) * 0.15;
        alpha = (ring * 0.6 + fill) * v_life;
        color = vec3(0.9, 0.95, 1.0);
    } else {
        // Normal spray
        alpha = (1.0 - dist * dist) * v_life * 0.7;
        color = vec3(1.0, 1.0, 1.0);
    }

    fragColor = vec4(color, alpha);
}
`;

// ---- Debug particle vertex shader (same as particle but pass-through) ----
export const debugVertexShader = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_offset;
in float a_density;

uniform vec2 u_resolution;
uniform float u_particleSize;

out vec2 v_uv;
out float v_density;

void main() {
    float size = u_particleSize * 0.5;
    vec2 pos = a_offset + a_position * size;
    vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;

    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_uv = a_position; // [-1, 1]
    v_density = a_density;
}
`;

// ---- Debug particle fragment shader ----
export const debugFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_density;

uniform float u_restDensity;

out vec4 fragColor;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    // Color by density
    float densRatio = clamp((v_density - u_restDensity) * 0.5, 0.0, 1.0);

    vec3 lowColor = vec3(0.1, 0.6, 0.9);  // cyan for low density
    vec3 highColor = vec3(0.9, 0.3, 0.1); // orange for high density
    vec3 color = mix(lowColor, highColor, densRatio);

    float alpha = 1.0 - dist * dist * 0.3;

    // Border
    float border = smoothstep(0.85, 0.95, dist);
    color = mix(color, color * 0.3, border);

    fragColor = vec4(color, alpha);
}
`;

// ---- Shadow vertex shader ----
export const shadowVertexShader = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_offset;

uniform vec2 u_resolution;
uniform float u_particleSize;
uniform vec2 u_shadowOffset;

out vec2 v_uv;

void main() {
    vec2 pos = (a_offset + u_shadowOffset) + a_position * u_particleSize * 0.9;
    vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;
    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_uv = a_position;
}
`;

// ---- Shadow fragment shader ----
export const shadowFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform float u_shadowOpacity;

out vec4 fragColor;

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;
    float alpha = exp(-dist * dist * 2.0) * u_shadowOpacity;
    fragColor = vec4(alpha, 0.0, 0.0, 1.0);
}
`;

// ---- Shadow blur shader ----
export const shadowBlurFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
out vec4 fragColor;

void main() {
    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    float result = texture(u_tex, v_uv).r * weights[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = u_direction * float(i);
        result += texture(u_tex, v_uv + off).r * weights[i];
        result += texture(u_tex, v_uv - off).r * weights[i];
    }
    fragColor = vec4(result, 0.0, 0.0, 1.0);
}
`;

// ---- Bloom extract shader ----
export const bloomExtractFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_sceneTex;
uniform float u_bloomThreshold;
out vec4 fragColor;

void main() {
    vec3 color = texture(u_sceneTex, v_uv).rgb;
    float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
    if (brightness > u_bloomThreshold) {
        fragColor = vec4((color - u_bloomThreshold) * 1.5, 1.0);
    } else {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
}
`;

// ---- Bloom blur shader ----
export const bloomBlurFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
out vec4 fragColor;

void main() {
    float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    vec3 result = texture(u_tex, v_uv).rgb * weights[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = u_direction * float(i);
        result += texture(u_tex, v_uv + off).rgb * weights[i];
        result += texture(u_tex, v_uv - off).rgb * weights[i];
    }
    fragColor = vec4(result, 1.0);
}
`;

// ---- Bloom composite shader ----
export const bloomCompositeFragmentShader = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform float u_bloomIntensity;
out vec4 fragColor;

void main() {
    vec3 scene = texture(u_sceneTex, v_uv).rgb;
    vec3 bloom = texture(u_bloomTex, v_uv).rgb;
    fragColor = vec4(scene + bloom * u_bloomIntensity, 1.0);
}
`;
