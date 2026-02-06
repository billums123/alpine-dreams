/**
 * Snow - Gentle falling snow particle system (optimized with flat arrays)
 */

import * as THREE from 'three';

export class Snow {
    constructor(scene) {
        this.scene = scene;
        this.particles = null;
        this.particleCount = 3000;
        this.positions = null;
        this.enabled = true;

        // Velocity data as flat Float32Arrays (cache-friendly, no GC pressure)
        this.fallSpeeds = null;   // per-particle fall speed
        this.driftX = null;       // per-particle X drift
        this.driftZ = null;       // per-particle Z drift
        this.wobblePhase = null;  // per-particle wobble phase offset
        this.wobbleSpeed = null;  // per-particle wobble speed

        // Snow bounds (must encompass camera at y~2000)
        this.bounds = {
            x: 2000,
            y: 2500,
            z: 2000
        };

        // Blizzard mode
        this.isBlizzard = false;
        this.blizzardWindX = 0;
        this.blizzardWindZ = 0;
        this.blizzardFallMultiplier = 1;
    }

    create() {
        const geometry = new THREE.BufferGeometry();

        this.positions = new Float32Array(this.particleCount * 3);
        const sizes = new Float32Array(this.particleCount);

        // Initialize flat velocity arrays
        this.fallSpeeds = new Float32Array(this.particleCount);
        this.driftX = new Float32Array(this.particleCount);
        this.driftZ = new Float32Array(this.particleCount);
        this.wobblePhase = new Float32Array(this.particleCount);
        this.wobbleSpeed = new Float32Array(this.particleCount);

        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;

            // Random position within bounds
            this.positions[i3] = (Math.random() - 0.5) * this.bounds.x * 2;
            this.positions[i3 + 1] = Math.random() * this.bounds.y;
            this.positions[i3 + 2] = (Math.random() - 0.5) * this.bounds.z * 2;

            // Random size variation
            sizes[i] = Math.random() * 1.5 + 0.8;

            // Velocity data (flat arrays)
            this.fallSpeeds[i] = Math.random() * 0.3 + 0.2;
            this.driftX[i] = (Math.random() - 0.5) * 0.1;
            this.driftZ[i] = (Math.random() - 0.5) * 0.1;
            this.wobblePhase[i] = Math.random() * Math.PI * 2;
            this.wobbleSpeed[i] = Math.random() * 2 + 1;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Snowflake texture (procedural)
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.6, 'rgba(240, 248, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(240, 248, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: texture },
                fogColor: { value: this.scene.fog ? this.scene.fog.color : new THREE.Color(0x9bb5ce) },
                fogDensity: { value: this.scene.fog ? this.scene.fog.density : 0.008 },
                nightMode: { value: 0.0 }
            },
            vertexShader: `
                attribute float size;
                varying float vAlpha;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    // Size attenuation
                    gl_PointSize = size * (200.0 / -mvPosition.z);

                    // Fog factor for alpha
                    float fogFactor = exp(-pow(length(mvPosition.xyz) * 0.01, 2.0));
                    vAlpha = fogFactor;

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                uniform float nightMode;
                varying float vAlpha;

                void main() {
                    vec4 texColor = texture2D(pointTexture, gl_PointCoord);
                    // Moonlit blue tint at night, brighter specks for shimmer
                    vec3 dayColor = vec3(1.0, 1.0, 1.0);
                    vec3 nightColor = vec3(0.7, 0.82, 1.0);
                    vec3 color = mix(dayColor, nightColor, nightMode);
                    float alpha = texColor.a * vAlpha * mix(0.8, 1.0, nightMode);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false;
        this.scene.add(this.particles);
    }

    update(delta) {
        if (!this.enabled || !this.particles) return;

        const time = performance.now() * 0.001;
        const dt10 = delta * 10;
        const boundsX = this.bounds.x;
        const boundsY = this.bounds.y;
        const boundsZ = this.bounds.z;
        const pos = this.positions;
        const windX = this.blizzardWindX;
        const windZ = this.blizzardWindZ;
        const fallMult = this.blizzardFallMultiplier;

        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;

            // Apply gravity and drift
            pos[i3 + 1] -= this.fallSpeeds[i] * fallMult * dt10;

            // Wobble (reduced in blizzard — wind dominates)
            const wobbleAmt = this.isBlizzard ? 0.02 : 0.05;
            const wobble = Math.sin(time * this.wobbleSpeed[i] + this.wobblePhase[i]) * wobbleAmt;
            pos[i3] += (this.driftX[i] + wobble + windX) * dt10;
            pos[i3 + 2] += (this.driftZ[i] + windZ) * dt10;

            // Reset particle when it falls below ground
            if (pos[i3 + 1] < -2) {
                pos[i3 + 1] = boundsY;
                pos[i3] = (Math.random() - 0.5) * boundsX * 2;
                pos[i3 + 2] = (Math.random() - 0.5) * boundsZ * 2;
            }

            // Wrap around horizontally
            if (pos[i3] > boundsX) {
                pos[i3] = -boundsX;
            } else if (pos[i3] < -boundsX) {
                pos[i3] = boundsX;
            }

            if (pos[i3 + 2] > boundsZ) {
                pos[i3 + 2] = -boundsZ;
            } else if (pos[i3 + 2] < -boundsZ) {
                pos[i3 + 2] = boundsZ;
            }
        }

        // Slowly shift blizzard wind direction for gusts
        if (this.isBlizzard) {
            this.blizzardWindX = Math.sin(time * 0.15) * 0.8 + 0.5;
            this.blizzardWindZ = Math.cos(time * 0.12) * 0.4;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    toggle() {
        this.enabled = !this.enabled;
        this.particles.visible = this.enabled;
        return this.enabled;
    }

    toggleBlizzard() {
        this.isBlizzard = !this.isBlizzard;

        if (this.isBlizzard) {
            this.blizzardFallMultiplier = 3.0;
            // Wind will be dynamically updated in update()
            this.blizzardWindX = 0.5;
            this.blizzardWindZ = 0.3;
        } else {
            this.blizzardFallMultiplier = 1;
            this.blizzardWindX = 0;
            this.blizzardWindZ = 0;
        }

        // Increase fog during blizzard
        if (this.scene.fog) {
            this.scene.fog.density = this.isBlizzard ? 0.00035 : 0.00018;
        }

        return this.isBlizzard;
    }

    setNightMode(enabled) {
        if (this.particles && this.particles.material.uniforms) {
            this.particles.material.uniforms.nightMode.value = enabled ? 1.0 : 0.0;
        }
    }

    setIntensity(intensity) {
        // Adjust particle visibility based on intensity (0-1)
        const visibleCount = Math.floor(this.particleCount * intensity);
    }
}
