/**
 * Snow - Gentle falling snow particle system
 */

import * as THREE from 'three';

export class Snow {
    constructor(scene) {
        this.scene = scene;
        this.particles = null;
        this.particleCount = 3000;
        this.positions = null;
        this.velocities = [];
        this.enabled = true;

        // Snow bounds
        this.bounds = {
            x: 150,
            y: 80,
            z: 150
        };
    }

    create() {
        // Create particle geometry
        const geometry = new THREE.BufferGeometry();

        this.positions = new Float32Array(this.particleCount * 3);
        const sizes = new Float32Array(this.particleCount);

        // Initialize particle positions
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;

            // Random position within bounds
            this.positions[i3] = (Math.random() - 0.5) * this.bounds.x * 2;
            this.positions[i3 + 1] = Math.random() * this.bounds.y;
            this.positions[i3 + 2] = (Math.random() - 0.5) * this.bounds.z * 2;

            // Random size variation
            sizes[i] = Math.random() * 0.5 + 0.3;

            // Store velocity for each particle
            this.velocities.push({
                y: Math.random() * 0.3 + 0.2, // Fall speed
                x: (Math.random() - 0.5) * 0.1, // Drift
                z: (Math.random() - 0.5) * 0.1,
                wobble: Math.random() * Math.PI * 2, // Phase for wobble
                wobbleSpeed: Math.random() * 2 + 1
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Snowflake texture (procedural)
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        // Draw soft circular snowflake
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.6, 'rgba(240, 248, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(240, 248, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);

        // Custom shader material for snow
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: texture },
                fogColor: { value: this.scene.fog ? this.scene.fog.color : new THREE.Color(0x9bb5ce) },
                fogDensity: { value: this.scene.fog ? this.scene.fog.density : 0.008 }
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
                varying float vAlpha;

                void main() {
                    vec4 texColor = texture2D(pointTexture, gl_PointCoord);
                    gl_FragColor = vec4(1.0, 1.0, 1.0, texColor.a * vAlpha * 0.8);
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

        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            const vel = this.velocities[i];

            // Apply gravity and drift
            this.positions[i3 + 1] -= vel.y * delta * 10;

            // Gentle wobble
            const wobble = Math.sin(time * vel.wobbleSpeed + vel.wobble) * 0.05;
            this.positions[i3] += (vel.x + wobble) * delta * 10;
            this.positions[i3 + 2] += vel.z * delta * 10;

            // Reset particle when it falls below ground
            if (this.positions[i3 + 1] < -2) {
                this.positions[i3 + 1] = this.bounds.y;
                this.positions[i3] = (Math.random() - 0.5) * this.bounds.x * 2;
                this.positions[i3 + 2] = (Math.random() - 0.5) * this.bounds.z * 2;
            }

            // Wrap around horizontally
            if (this.positions[i3] > this.bounds.x) {
                this.positions[i3] = -this.bounds.x;
            } else if (this.positions[i3] < -this.bounds.x) {
                this.positions[i3] = this.bounds.x;
            }

            if (this.positions[i3 + 2] > this.bounds.z) {
                this.positions[i3 + 2] = -this.bounds.z;
            } else if (this.positions[i3 + 2] < -this.bounds.z) {
                this.positions[i3 + 2] = this.bounds.z;
            }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    toggle() {
        this.enabled = !this.enabled;
        this.particles.visible = this.enabled;
        return this.enabled;
    }

    setIntensity(intensity) {
        // Adjust particle visibility based on intensity (0-1)
        const visibleCount = Math.floor(this.particleCount * intensity);
        // This would require more complex handling; for now just toggle
    }
}
