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

        // Materials
        const jacketMaterial = new THREE.MeshStandardMaterial({
            color: 0x1565c0, // Blue jacket
            roughness: 0.7
        });
        const pantsMaterial = new THREE.MeshStandardMaterial({
            color: 0x212121, // Dark pants
            roughness: 0.8
        });
        const skinMaterial = new THREE.MeshStandardMaterial({
            color: 0xffcc99,
            roughness: 0.9
        });
        const helmetMaterial = new THREE.MeshStandardMaterial({
            color: 0xd32f2f, // Red helmet
            roughness: 0.4,
            metalness: 0.1
        });
        const gogglesMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.1,
            metalness: 0.8
        });
        const bootMaterial = new THREE.MeshStandardMaterial({
            color: 0x37474f,
            roughness: 0.5,
            metalness: 0.3
        });
        const skiMaterial = new THREE.MeshStandardMaterial({
            color: 0xf4511e,
            roughness: 0.3,
            metalness: 0.4
        });
        const poleMaterial = new THREE.MeshStandardMaterial({
            color: 0x263238,
            roughness: 0.3,
            metalness: 0.7
        });
        const gloveMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.8
        });

        // Torso (jacket)
        const torsoGeometry = new THREE.CapsuleGeometry(0.22, 0.45, 8, 12);
        const torso = new THREE.Mesh(torsoGeometry, jacketMaterial);
        torso.position.set(0, 1.05, 0);
        torso.rotation.x = 0.25;
        skier.add(torso);

        // Head
        const headGeometry = new THREE.SphereGeometry(0.16, 12, 10);
        const head = new THREE.Mesh(headGeometry, skinMaterial);
        head.position.set(0, 1.52, 0.05);
        skier.add(head);

        // Helmet
        const helmetGeometry = new THREE.SphereGeometry(0.19, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.set(0, 1.56, 0.02);
        helmet.rotation.x = -0.1;
        skier.add(helmet);

        // Goggles
        const gogglesGeometry = new THREE.BoxGeometry(0.28, 0.08, 0.06);
        const goggles = new THREE.Mesh(gogglesGeometry, gogglesMaterial);
        goggles.position.set(0, 1.52, 0.16);
        skier.add(goggles);

        // Goggle strap
        const strapGeometry = new THREE.TorusGeometry(0.17, 0.015, 6, 16, Math.PI);
        const strap = new THREE.Mesh(strapGeometry, gogglesMaterial);
        strap.position.set(0, 1.54, 0.02);
        strap.rotation.x = Math.PI / 2;
        strap.rotation.z = Math.PI;
        skier.add(strap);

        // Upper legs (thighs)
        [-0.12, 0.12].forEach(x => {
            const thighGeometry = new THREE.CapsuleGeometry(0.09, 0.25, 6, 8);
            const thigh = new THREE.Mesh(thighGeometry, pantsMaterial);
            thigh.position.set(x, 0.62, 0.08);
            thigh.rotation.x = 0.8;
            skier.add(thigh);
        });

        // Lower legs (shins)
        [-0.14, 0.14].forEach(x => {
            const shinGeometry = new THREE.CapsuleGeometry(0.07, 0.22, 6, 8);
            const shin = new THREE.Mesh(shinGeometry, pantsMaterial);
            shin.position.set(x, 0.32, 0.18);
            shin.rotation.x = 0.15;
            skier.add(shin);
        });

        // Ski boots
        [-0.15, 0.15].forEach(x => {
            const bootGeometry = new THREE.BoxGeometry(0.12, 0.14, 0.28);
            const boot = new THREE.Mesh(bootGeometry, bootMaterial);
            boot.position.set(x, 0.1, 0.22);
            skier.add(boot);
        });

        // Arms (upper)
        [-0.32, 0.32].forEach(x => {
            const upperArmGeometry = new THREE.CapsuleGeometry(0.06, 0.2, 6, 8);
            const upperArm = new THREE.Mesh(upperArmGeometry, jacketMaterial);
            upperArm.position.set(x, 1.1, 0);
            upperArm.rotation.z = x > 0 ? -0.5 : 0.5;
            upperArm.rotation.x = 0.4;
            skier.add(upperArm);
        });

        // Arms (lower/forearms)
        [-0.42, 0.42].forEach(x => {
            const forearmGeometry = new THREE.CapsuleGeometry(0.05, 0.18, 6, 8);
            const forearm = new THREE.Mesh(forearmGeometry, jacketMaterial);
            forearm.position.set(x, 0.9, 0.15);
            forearm.rotation.z = x > 0 ? -0.3 : 0.3;
            forearm.rotation.x = 0.8;
            skier.add(forearm);
        });

        // Gloves/hands
        [-0.48, 0.48].forEach(x => {
            const gloveGeometry = new THREE.SphereGeometry(0.055, 8, 6);
            const glove = new THREE.Mesh(gloveGeometry, gloveMaterial);
            glove.position.set(x, 0.72, 0.28);
            skier.add(glove);
        });

        // Skis
        [-0.15, 0.15].forEach(x => {
            // Main ski body
            const skiGeometry = new THREE.BoxGeometry(0.1, 0.02, 1.9);
            const ski = new THREE.Mesh(skiGeometry, skiMaterial);
            ski.position.set(x, 0.015, 0.25);
            skier.add(ski);

            // Ski tip (curved up)
            const tipGeometry = new THREE.BoxGeometry(0.1, 0.02, 0.2);
            const tip = new THREE.Mesh(tipGeometry, skiMaterial);
            tip.position.set(x, 0.04, 1.15);
            tip.rotation.x = -0.5;
            skier.add(tip);

            // Ski tail (slightly curved up)
            const tailGeometry = new THREE.BoxGeometry(0.1, 0.02, 0.12);
            const tail = new THREE.Mesh(tailGeometry, skiMaterial);
            tail.position.set(x, 0.03, -0.72);
            tail.rotation.x = 0.3;
            skier.add(tail);

            // Binding
            const bindingGeometry = new THREE.BoxGeometry(0.08, 0.06, 0.18);
            const binding = new THREE.Mesh(bindingGeometry, bootMaterial);
            binding.position.set(x, 0.05, 0.22);
            skier.add(binding);
        });

        // Poles
        [-0.52, 0.52].forEach(x => {
            // Pole shaft
            const shaftGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8);
            const shaft = new THREE.Mesh(shaftGeometry, poleMaterial);
            shaft.position.set(x, 0.35, 0.1);
            shaft.rotation.x = 0.6;
            shaft.rotation.z = x > 0 ? -0.15 : 0.15;
            skier.add(shaft);

            // Pole basket
            const basketGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.01, 8);
            const basket = new THREE.Mesh(basketGeometry, poleMaterial);
            basket.position.set(x * 0.9, -0.1, -0.35);
            basket.rotation.x = 0.6;
            skier.add(basket);

            // Pole grip
            const gripGeometry = new THREE.CylinderGeometry(0.025, 0.02, 0.12, 8);
            const grip = new THREE.Mesh(gripGeometry, gloveMaterial);
            grip.position.set(x, 0.78, 0.52);
            grip.rotation.x = 0.6;
            skier.add(grip);
        });

        skier.castShadow = true;
        skier.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
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
        // The normal's x,z point in the downhill direction
        const normal = this.mountain.getNormalAt(x, z);
        // Face the direction the slope goes down (same as slope direction in physics)
        this.rotation = Math.atan2(normal.x, normal.z);
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
        let handled = true;
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
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
        }
    }

    onKeyUp(e) {
        let handled = true;
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
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
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

        // Handle turning with edge control - carving style
        let turnAmount = 0;
        const targetEdge = this.input.left ? -0.7 : (this.input.right ? 0.7 : 0);
        const edgeLerpSpeed = targetEdge !== 0 ? 0.08 : 0.12;
        this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, targetEdge, edgeLerpSpeed);

        if (this.input.left) {
            turnAmount = 1;
        } else if (this.input.right) {
            turnAmount = -1;
        }

        // Carving turn rate - faster at higher speeds, smoother feel
        const speedFactor = Math.min(1, this.currentSpeed / 12);
        const carvingIntensity = Math.abs(this.edgeAngle) * speedFactor;

        // Apply rotation based on edge angle (like real carving)
        this.rotation += turnAmount * this.turnSpeed * carvingIntensity * delta;

        // Gravity along slope
        if (this.isGrounded) {
            // Calculate gravity force based on slope steepness
            const slopeMagnitude = Math.sqrt(terrainNormal.x * terrainNormal.x + terrainNormal.z * terrainNormal.z);
            const gravityForce = this.gravity * slopeMagnitude;

            // Apply gravity in downhill direction
            this.velocity.x += slopeDir.x * gravityForce * delta;
            this.velocity.z += slopeDir.z * gravityForce * delta;

            // CARVING PHYSICS: Redirect velocity toward facing direction
            // This is the key to making it feel like carving - the skis grip and redirect momentum
            if (this.currentSpeed > 0.5) {
                const currentVelDir = this.velocity.clone().normalize();
                const facingDotVel = forward.dot(currentVelDir);

                // Calculate how much to redirect velocity toward facing direction
                // More edge angle = more grip = more redirection
                const gripStrength = Math.abs(this.edgeAngle) * 0.15 * speedFactor;

                // Blend current velocity direction toward facing direction
                const newVelDir = new THREE.Vector3(
                    currentVelDir.x + (forward.x - currentVelDir.x) * gripStrength,
                    0,
                    currentVelDir.z + (forward.z - currentVelDir.z) * gripStrength
                ).normalize();

                // Apply redirected velocity while preserving speed (with slight loss from carving)
                const speedLoss = 1 - (Math.abs(this.edgeAngle) * 0.02);
                this.velocity.x = newVelDir.x * this.currentSpeed * speedLoss;
                this.velocity.z = newVelDir.z * this.currentSpeed * speedLoss;
            }

            // Forward/backward control
            if (this.input.forward) {
                // Tuck position - reduce drag, accelerate slightly
                const moveDir = this.velocity.lengthSq() > 0.1 ? this.velocity.clone().normalize() : forward;
                this.velocity.x += moveDir.x * this.acceleration * 0.4 * delta;
                this.velocity.z += moveDir.z * this.acceleration * 0.4 * delta;
            }
            if (this.input.backward) {
                // Snow plow - braking / slowing down
                if (this.currentSpeed > 0.5) {
                    const brakeDir = this.velocity.clone().normalize();
                    this.velocity.x -= brakeDir.x * this.brakeForce * delta;
                    this.velocity.z -= brakeDir.z * this.brakeForce * delta;
                } else {
                    this.velocity.multiplyScalar(0.9);
                }
            }

            // Friction - less friction when going straight, more when carving hard
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

        // Apply horizontal velocity
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;

        // Get terrain height at new position
        const newTerrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);

        // Handle vertical movement
        if (this.isGrounded && !this.isJumping) {
            // When grounded, always stick to terrain
            this.position.y = newTerrainHeight;
            this.verticalVelocity = 0;
        } else {
            // In the air - apply vertical velocity
            this.position.y += this.verticalVelocity * delta;

            // Ground collision check
            if (this.position.y <= newTerrainHeight) {
                this.position.y = newTerrainHeight;
                this.verticalVelocity = 0;
                this.isGrounded = true;
                this.isJumping = false;
            }
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
        // Calculate desired camera position behind skier
        const backDir = new THREE.Vector3(
            -Math.sin(this.rotation),
            0,
            -Math.cos(this.rotation)
        );

        // Camera behind and above skier
        let targetCameraPos = this.position.clone()
            .add(backDir.multiplyScalar(this.cameraOffset.z))
            .add(new THREE.Vector3(0, this.cameraOffset.y, 0));

        // Ensure camera doesn't go below terrain
        const terrainHeightAtCamera = this.mountain.getHeightAt(targetCameraPos.x, targetCameraPos.z);
        const minCameraHeight = terrainHeightAtCamera + 2.0; // Keep at least 2 units above terrain
        if (targetCameraPos.y < minCameraHeight) {
            targetCameraPos.y = minCameraHeight;
        }

        // Also ensure camera is always above skier
        const minAboveSkier = this.position.y + 1.5;
        if (targetCameraPos.y < minAboveSkier) {
            targetCameraPos.y = minAboveSkier;
        }

        // Smooth camera movement
        this.camera.position.lerp(targetCameraPos, this.cameraSmoothness);

        // Look at skier (slightly ahead)
        const lookTarget = this.position.clone().add(
            new THREE.Vector3(
                Math.sin(this.rotation) * this.cameraLookAhead,
                1.0,
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
