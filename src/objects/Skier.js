/**
 * Skier - Player-controlled skier with realistic physics
 */

import * as THREE from 'three';

export class Skier {
    constructor(scene, mountain, camera, cameraControls) {
        this.scene = scene;
        this.mountain = mountain;
        this.camera = camera;
        this.cameraControls = cameraControls;

        // Skier mesh
        this.mesh = null;
        this.isActive = false;

        // Physics state
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotation = 0; // Facing direction (radians)
        this.edgeAngle = 0; // Lean angle for turning

        // Physics constants
        this.gravity = 20;
        this.friction = 0.02;
        this.airFriction = 0.005;
        this.turnSpeed = 2.5;
        this.edgingForce = 15;
        this.maxSpeed = 50;
        this.acceleration = 8;
        this.brakeForce = 12;
        this.jumpForce = 8;

        // State
        this.isGrounded = true;
        this.isJumping = false;
        this.verticalVelocity = 0;
        this.currentSpeed = 0;

        // Input state
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false
        };

        // Camera settings
        this.cameraOffset = new THREE.Vector3(0, 3, 8);
        this.cameraLookAhead = 5;
        this.cameraSmoothness = 0.1;

        // Stored camera state for restoration
        this.savedCameraPosition = null;
        this.savedCameraTarget = null;

        // Audio (will be initialized when skier is placed)
        this.audioContext = null;
        this.skiSound = null;
        this.isAudioInitialized = false;

        // Bind methods
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
    }

    createMesh() {
        const skier = new THREE.Group();
        skier.name = 'skier';

        // Body (torso)
        const bodyGeometry = new THREE.CapsuleGeometry(0.25, 0.6, 4, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x2196f3,
            roughness: 0.6,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 1.0;
        body.rotation.x = 0.2; // Slight forward lean
        skier.add(body);

        // Head
        const headGeometry = new THREE.SphereGeometry(0.2, 8, 6);
        const headMaterial = new THREE.MeshStandardMaterial({
            color: 0xffdbac,
            roughness: 0.8
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.y = 1.55;
        skier.add(head);

        // Helmet
        const helmetGeometry = new THREE.SphereGeometry(0.22, 8, 6);
        const helmetMaterial = new THREE.MeshStandardMaterial({
            color: 0xe53935,
            roughness: 0.5
        });
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.y = 1.6;
        helmet.scale.y = 0.9;
        skier.add(helmet);

        // Legs
        const legMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.7
        });
        [-0.15, 0.15].forEach(x => {
            const legGeometry = new THREE.CapsuleGeometry(0.1, 0.5, 4, 8);
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(x, 0.4, 0.05);
            leg.rotation.x = 0.3;
            skier.add(leg);
        });

        // Skis
        const skiMaterial = new THREE.MeshStandardMaterial({
            color: 0xff5722,
            roughness: 0.3,
            metalness: 0.2
        });
        [-0.2, 0.2].forEach(x => {
            const skiGeometry = new THREE.BoxGeometry(0.12, 0.03, 1.8);
            const ski = new THREE.Mesh(skiGeometry, skiMaterial);
            ski.position.set(x, 0.02, 0.2);
            skier.add(ski);

            // Ski tips (curved up)
            const tipGeometry = new THREE.BoxGeometry(0.12, 0.03, 0.15);
            const tip = new THREE.Mesh(tipGeometry, skiMaterial);
            tip.position.set(x, 0.06, 1.05);
            tip.rotation.x = -0.4;
            skier.add(tip);
        });

        // Poles
        const poleMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            metalness: 0.5
        });
        [-0.4, 0.4].forEach((x, i) => {
            const poleGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6);
            const pole = new THREE.Mesh(poleGeometry, poleMaterial);
            pole.position.set(x, 0.7, -0.1);
            pole.rotation.x = 0.3;
            pole.rotation.z = x > 0 ? -0.2 : 0.2;
            skier.add(pole);
        });

        skier.castShadow = true;
        skier.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
            }
        });

        return skier;
    }

    // Place skier at position and start ski mode
    place(x, z) {
        // Create mesh if needed
        if (!this.mesh) {
            this.mesh = this.createMesh();
        }

        // Get terrain height at position
        const y = this.mountain.getHeightAt(x, z);

        // Set position
        this.position.set(x, y, z);
        this.mesh.position.copy(this.position);

        // Calculate initial facing direction (downhill)
        const normal = this.mountain.getNormalAt(x, z);
        this.rotation = Math.atan2(-normal.x, -normal.z);
        this.mesh.rotation.y = this.rotation;

        // Reset physics
        this.velocity.set(0, 0, 0);
        this.verticalVelocity = 0;
        this.currentSpeed = 0;
        this.isGrounded = true;
        this.isJumping = false;
        this.edgeAngle = 0;

        // Add to scene
        this.scene.add(this.mesh);

        // Save camera state
        this.savedCameraPosition = this.camera.position.clone();
        this.savedCameraTarget = this.cameraControls.controls.target.clone();

        // Disable orbit controls
        this.cameraControls.setEnabled(false);

        // Set up input listeners
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);

        // Initialize audio
        this.initAudio();

        this.isActive = true;

        // Show HUD
        document.getElementById('skier-hud').classList.remove('hidden');
        document.getElementById('object-palette').style.display = 'none';
        document.getElementById('quick-actions').style.display = 'none';
        document.getElementById('controls-hint').style.display = 'none';

        return this.mesh;
    }

    // Remove skier and restore editor mode
    remove() {
        if (!this.isActive) return;

        this.isActive = false;

        // Remove input listeners
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);

        // Remove from scene
        if (this.mesh) {
            this.scene.remove(this.mesh);
        }

        // Stop audio
        this.stopAudio();

        // Restore camera
        if (this.savedCameraPosition && this.savedCameraTarget) {
            this.camera.position.copy(this.savedCameraPosition);
            this.cameraControls.controls.target.copy(this.savedCameraTarget);
        }

        // Re-enable orbit controls
        this.cameraControls.setEnabled(true);

        // Hide HUD, show palette
        document.getElementById('skier-hud').classList.add('hidden');
        document.getElementById('object-palette').style.display = '';
        document.getElementById('quick-actions').style.display = '';
        document.getElementById('controls-hint').style.display = '';
    }

    onKeyDown(e) {
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.input.forward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.input.backward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.input.left = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.input.right = true;
                break;
            case 'Space':
                if (this.isGrounded && !this.isJumping) {
                    this.input.jump = true;
                }
                break;
            case 'Escape':
                this.remove();
                break;
        }
    }

    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.input.forward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.input.backward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.input.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.input.right = false;
                break;
            case 'Space':
                this.input.jump = false;
                break;
        }
    }

    update(delta) {
        if (!this.isActive || !this.mesh) return;

        // Clamp delta to prevent physics explosions
        delta = Math.min(delta, 0.05);

        // Get terrain data at current position
        const terrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);
        const terrainNormal = this.mountain.getNormalAt(this.position.x, this.position.z);
        const slope = this.mountain.getSlopeAt(this.position.x, this.position.z);

        // Calculate slope direction (direction of steepest DESCENT - downhill)
        // The normal's x,z components point in the uphill direction when positive
        // So we use them directly (not negated) for downhill
        const slopeDir = new THREE.Vector3(
            terrainNormal.x,
            0,
            terrainNormal.z
        );
        if (slopeDir.lengthSq() > 0.0001) {
            slopeDir.normalize();
        }

        // Forward direction based on skier rotation
        const forward = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        );

        // Handle turning with edge control
        let turnAmount = 0;
        if (this.input.left) {
            turnAmount = 1;
            this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, -0.5, 0.12);
        } else if (this.input.right) {
            turnAmount = -1;
            this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, 0.5, 0.12);
        } else {
            this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, 0, 0.15);
        }

        // Turn rate depends on speed (harder to turn at low speed)
        const speedFactor = Math.min(1, this.currentSpeed / 8);
        this.rotation += turnAmount * this.turnSpeed * speedFactor * delta;

        // Gravity along slope
        if (this.isGrounded) {
            // Calculate gravity force based on slope steepness
            // steeper slope = more gravity force
            const slopeMagnitude = Math.sqrt(terrainNormal.x * terrainNormal.x + terrainNormal.z * terrainNormal.z);
            const gravityForce = this.gravity * slopeMagnitude;

            // Apply gravity in downhill direction
            this.velocity.x += slopeDir.x * gravityForce * delta;
            this.velocity.z += slopeDir.z * gravityForce * delta;

            // Edge carving force (perpendicular to forward direction)
            // This creates the turning force when carving
            if (Math.abs(this.edgeAngle) > 0.05 && this.currentSpeed > 1) {
                const perpendicular = new THREE.Vector3(-forward.z, 0, forward.x);
                const edgeForce = this.edgeAngle * this.edgingForce * speedFactor;
                this.velocity.x += perpendicular.x * edgeForce * delta;
                this.velocity.z += perpendicular.z * edgeForce * delta;
            }

            // Forward/backward control
            if (this.input.forward) {
                // Tuck position - reduce drag, slight push in current direction
                const moveDir = this.velocity.lengthSq() > 0.1 ? this.velocity.clone().normalize() : forward;
                this.velocity.x += moveDir.x * this.acceleration * 0.3 * delta;
                this.velocity.z += moveDir.z * this.acceleration * 0.3 * delta;
            }
            if (this.input.backward) {
                // Snow plow - braking
                if (this.currentSpeed > 0.5) {
                    const brakeDir = this.velocity.clone().normalize();
                    this.velocity.x -= brakeDir.x * this.brakeForce * delta;
                    this.velocity.z -= brakeDir.z * this.brakeForce * delta;
                } else {
                    this.velocity.multiplyScalar(0.9);
                }
            }

            // Friction (higher when edging hard)
            const frictionMultiplier = 1 + Math.abs(this.edgeAngle) * 3;
            const frictionForce = this.friction * frictionMultiplier;
            this.velocity.x *= (1 - frictionForce);
            this.velocity.z *= (1 - frictionForce);

            // Jump
            if (this.input.jump) {
                this.verticalVelocity = this.jumpForce;
                this.isGrounded = false;
                this.isJumping = true;
                this.input.jump = false;
            }
        } else {
            // Air physics
            this.verticalVelocity -= this.gravity * delta;
            this.velocity.x *= (1 - this.airFriction);
            this.velocity.z *= (1 - this.airFriction);
        }

        // Apply velocity
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;
        this.position.y += this.verticalVelocity * delta;

        // Ground collision
        const newTerrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);
        if (this.position.y <= newTerrainHeight) {
            this.position.y = newTerrainHeight;
            this.verticalVelocity = 0;
            this.isGrounded = true;
            this.isJumping = false;
        }

        // Calculate current speed
        this.currentSpeed = Math.sqrt(
            this.velocity.x * this.velocity.x +
            this.velocity.z * this.velocity.z
        );

        // Clamp max speed
        if (this.currentSpeed > this.maxSpeed) {
            const scale = this.maxSpeed / this.currentSpeed;
            this.velocity.x *= scale;
            this.velocity.z *= scale;
            this.currentSpeed = this.maxSpeed;
        }

        // Boundary check
        const halfWidth = this.mountain.width / 2 - 5;
        const halfDepth = this.mountain.depth / 2 - 5;
        this.position.x = THREE.MathUtils.clamp(this.position.x, -halfWidth, halfWidth);
        this.position.z = THREE.MathUtils.clamp(this.position.z, -halfDepth, halfDepth);

        // Update mesh position
        this.mesh.position.copy(this.position);

        // Align skier to terrain surface using quaternion
        this.alignToTerrain(terrainNormal);

        // Update camera
        this.updateCamera(delta);

        // Update audio
        this.updateAudio();

        // Update HUD
        this.updateHUD();
    }

    // Properly align skier mesh to terrain surface
    alignToTerrain(terrainNormal) {
        // Get the up vector (terrain normal)
        const up = terrainNormal.clone().normalize();

        // Forward direction based on skier's facing rotation
        let forward = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        );

        // Project forward onto the terrain plane (perpendicular to normal)
        forward.sub(up.clone().multiplyScalar(forward.dot(up)));
        forward.normalize();

        // Right vector (cross product of up and forward)
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        // Recalculate forward to ensure orthogonality
        forward.crossVectors(right, up).normalize();

        // Build rotation matrix from these vectors
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.makeBasis(right, up, forward);

        // Apply rotation to mesh
        this.mesh.quaternion.setFromRotationMatrix(rotationMatrix);

        // Apply edge lean (rotate around forward axis)
        if (Math.abs(this.edgeAngle) > 0.01) {
            const leanQuat = new THREE.Quaternion();
            leanQuat.setFromAxisAngle(forward, -this.edgeAngle * 0.6);
            this.mesh.quaternion.multiply(leanQuat);
        }
    }

    updateCamera(delta) {
        // Calculate desired camera position
        const backDir = new THREE.Vector3(
            -Math.sin(this.rotation),
            0,
            -Math.cos(this.rotation)
        );

        // Camera behind and above skier
        const targetCameraPos = this.position.clone()
            .add(backDir.multiplyScalar(this.cameraOffset.z))
            .add(new THREE.Vector3(0, this.cameraOffset.y, 0));

        // Smooth camera movement
        this.camera.position.lerp(targetCameraPos, this.cameraSmoothness);

        // Look ahead of skier
        const lookTarget = this.position.clone().add(
            new THREE.Vector3(
                Math.sin(this.rotation) * this.cameraLookAhead,
                1.5,
                Math.cos(this.rotation) * this.cameraLookAhead
            )
        );

        this.camera.lookAt(lookTarget);
    }

    updateHUD() {
        // Convert speed to km/h (approximate scaling)
        const speedKmh = Math.round(this.currentSpeed * 3.6);
        document.getElementById('speed-value').textContent = speedKmh;
    }

    // Audio system
    initAudio() {
        if (this.isAudioInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.isAudioInitialized = true;

            // Create ski sound (filtered noise)
            this.createSkiSound();
        } catch (e) {
            console.warn('Audio not available:', e);
        }
    }

    createSkiSound() {
        if (!this.audioContext) return;

        // Create nodes
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        // Fill with noise
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        // Create source
        this.noiseSource = this.audioContext.createBufferSource();
        this.noiseSource.buffer = noiseBuffer;
        this.noiseSource.loop = true;

        // Create filters for ski sound
        this.lowpass = this.audioContext.createBiquadFilter();
        this.lowpass.type = 'lowpass';
        this.lowpass.frequency.value = 500;

        this.highpass = this.audioContext.createBiquadFilter();
        this.highpass.type = 'highpass';
        this.highpass.frequency.value = 100;

        // Gain control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0;

        // Connect nodes
        this.noiseSource.connect(this.lowpass);
        this.lowpass.connect(this.highpass);
        this.highpass.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);

        // Start
        this.noiseSource.start();
    }

    updateAudio() {
        if (!this.audioContext || !this.gainNode) return;

        // Modulate based on speed
        const speedNormalized = this.currentSpeed / this.maxSpeed;

        // Volume based on speed
        const targetVolume = this.isGrounded ? speedNormalized * 0.15 : 0;
        this.gainNode.gain.value = THREE.MathUtils.lerp(
            this.gainNode.gain.value,
            targetVolume,
            0.1
        );

        // Filter frequency based on speed and turning
        const baseFreq = 300 + speedNormalized * 800;
        const turnModulation = Math.abs(this.edgeAngle) * 400;
        this.lowpass.frequency.value = baseFreq + turnModulation;

        // Higher frequencies when edging hard
        this.highpass.frequency.value = 80 + Math.abs(this.edgeAngle) * 150;
    }

    stopAudio() {
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
        if (this.noiseSource) {
            try {
                this.noiseSource.stop();
            } catch (e) {}
        }
        this.isAudioInitialized = false;
    }
}
