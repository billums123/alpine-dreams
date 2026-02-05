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

        // Physics constants - tuned for fun skiing
        this.gravity = 15; // Gravity strength
        this.airFriction = 0.01;
        this.turnSpeed = 2.5; // How fast you can turn
        this.maxSpeed = 35; // Top speed
        this.brakeForce = 0.92; // Multiplier when braking
        this.jumpForce = 8;

        // Starting position for reset
        this.startPosition = new THREE.Vector3();
        this.startRotation = 0;

        // Collision detection
        this.collisionRaycaster = new THREE.Raycaster();
        this.lastJumpRampTime = 0;

        // State
        this.isGrounded = true;
        this.isJumping = false;
        this.verticalVelocity = 0;
        this.currentSpeed = 0;

        // Snow spray particles
        this.snowSprayParticles = null;
        this.snowSprayPositions = null;
        this.snowSprayVelocities = null;
        this.snowSprayLifetimes = null;
        this.maxSnowParticles = 100;

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

        // Arms - proper skiing stance with arms forward holding poles
        [-1, 1].forEach(side => {
            const x = side * 0.28;

            // Upper arm - angled down and slightly forward from shoulder
            const upperArmGeometry = new THREE.CapsuleGeometry(0.055, 0.18, 6, 8);
            const upperArm = new THREE.Mesh(upperArmGeometry, jacketMaterial);
            upperArm.position.set(x, 1.0, 0.08);
            upperArm.rotation.z = side * -0.8; // Angle outward
            upperArm.rotation.x = 0.5; // Angle forward
            skier.add(upperArm);

            // Forearm - bent at elbow, pointing forward/down to hold poles
            const forearmGeometry = new THREE.CapsuleGeometry(0.045, 0.15, 6, 8);
            const forearm = new THREE.Mesh(forearmGeometry, jacketMaterial);
            forearm.position.set(side * 0.38, 0.82, 0.22);
            forearm.rotation.z = side * -0.3;
            forearm.rotation.x = 1.2; // More forward angle
            skier.add(forearm);

            // Glove/hand - at end of forearm
            const gloveGeometry = new THREE.SphereGeometry(0.05, 8, 6);
            const glove = new THREE.Mesh(gloveGeometry, gloveMaterial);
            glove.position.set(side * 0.4, 0.68, 0.38);
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

        // Poles - positioned to be held by hands
        [-1, 1].forEach(side => {
            const handX = side * 0.4;
            const handY = 0.68;
            const handZ = 0.38;

            // Pole shaft - angled back from hand position
            const shaftGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8);
            const shaft = new THREE.Mesh(shaftGeometry, poleMaterial);
            shaft.position.set(handX + side * 0.05, handY - 0.4, handZ - 0.25);
            shaft.rotation.x = 0.4;
            shaft.rotation.z = side * -0.1;
            skier.add(shaft);

            // Pole basket - near bottom of pole
            const basketGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8);
            const basket = new THREE.Mesh(basketGeometry, poleMaterial);
            basket.position.set(handX + side * 0.08, 0.05, handZ - 0.55);
            skier.add(basket);

            // Pole grip - at hand position
            const gripGeometry = new THREE.CylinderGeometry(0.022, 0.018, 0.1, 8);
            const grip = new THREE.Mesh(gripGeometry, gloveMaterial);
            grip.position.set(handX, handY, handZ);
            grip.rotation.x = 0.4;
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

    createSnowSpray() {
        // Create particle geometry
        const geometry = new THREE.BufferGeometry();
        this.snowSprayPositions = new Float32Array(this.maxSnowParticles * 3);
        this.snowSprayVelocities = [];
        this.snowSprayLifetimes = new Float32Array(this.maxSnowParticles);

        // Initialize all particles as inactive (lifetime = 0)
        for (let i = 0; i < this.maxSnowParticles; i++) {
            this.snowSprayPositions[i * 3] = 0;
            this.snowSprayPositions[i * 3 + 1] = -100; // Below ground
            this.snowSprayPositions[i * 3 + 2] = 0;
            this.snowSprayVelocities.push(new THREE.Vector3());
            this.snowSprayLifetimes[i] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(this.snowSprayPositions, 3));

        // Snow particle material
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.15,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.snowSprayParticles = new THREE.Points(geometry, material);
        this.scene.add(this.snowSprayParticles);
    }

    emitSnowSpray(position, direction, intensity) {
        if (!this.snowSprayParticles) return;

        // Find inactive particles to reuse
        const particlesToEmit = Math.floor(intensity * 5);
        let emitted = 0;

        for (let i = 0; i < this.maxSnowParticles && emitted < particlesToEmit; i++) {
            if (this.snowSprayLifetimes[i] <= 0) {
                // Position at ski edge
                const offset = (Math.random() - 0.5) * 0.3;
                this.snowSprayPositions[i * 3] = position.x + offset;
                this.snowSprayPositions[i * 3 + 1] = position.y + 0.1;
                this.snowSprayPositions[i * 3 + 2] = position.z + offset;

                // Velocity - spray outward and up
                const spreadAngle = (Math.random() - 0.5) * 0.8;
                const speed = 2 + Math.random() * 3 * intensity;
                this.snowSprayVelocities[i].set(
                    direction.x * speed + Math.sin(spreadAngle) * speed * 0.5,
                    1.5 + Math.random() * 2 * intensity,
                    direction.z * speed + Math.cos(spreadAngle) * speed * 0.5
                );

                // Lifetime
                this.snowSprayLifetimes[i] = 0.5 + Math.random() * 0.5;
                emitted++;
            }
        }

        this.snowSprayParticles.geometry.attributes.position.needsUpdate = true;
    }

    updateSnowSpray(delta) {
        if (!this.snowSprayParticles) return;

        const gravity = 8;
        let anyActive = false;

        for (let i = 0; i < this.maxSnowParticles; i++) {
            if (this.snowSprayLifetimes[i] > 0) {
                anyActive = true;
                this.snowSprayLifetimes[i] -= delta;

                // Update position
                this.snowSprayPositions[i * 3] += this.snowSprayVelocities[i].x * delta;
                this.snowSprayPositions[i * 3 + 1] += this.snowSprayVelocities[i].y * delta;
                this.snowSprayPositions[i * 3 + 2] += this.snowSprayVelocities[i].z * delta;

                // Apply gravity
                this.snowSprayVelocities[i].y -= gravity * delta;

                // Fade out by moving below ground when dead
                if (this.snowSprayLifetimes[i] <= 0) {
                    this.snowSprayPositions[i * 3 + 1] = -100;
                }
            }
        }

        if (anyActive) {
            this.snowSprayParticles.geometry.attributes.position.needsUpdate = true;
        }
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
        this.rotation = Math.atan2(normal.x, normal.z);
        this.mesh.rotation.y = this.rotation;

        // Save starting position for reset (R key)
        this.startPosition.set(x, y, z);
        this.startRotation = this.rotation;

        // Reset physics
        this.velocity.set(0, 0, 0);
        this.verticalVelocity = 0;
        this.currentSpeed = 0;
        this.isGrounded = true;
        this.isJumping = false;
        this.edgeAngle = 0;

        // Add to scene
        this.scene.add(this.mesh);

        // Create snow spray particles
        if (!this.snowSprayParticles) {
            this.createSnowSpray();
        }

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

        // Remove snow spray
        if (this.snowSprayParticles) {
            this.scene.remove(this.snowSprayParticles);
            this.snowSprayParticles = null;
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
            case 'KeyR':
                this.resetToStart();
                break;
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
        }
    }

    resetToStart() {
        // Reset to starting position
        const y = this.mountain.getHeightAt(this.startPosition.x, this.startPosition.z);
        this.position.set(this.startPosition.x, y, this.startPosition.z);
        this.rotation = this.startRotation;
        this.velocity.set(0, 0, 0);
        this.verticalVelocity = 0;
        this.currentSpeed = 0;
        this.isGrounded = true;
        this.isJumping = false;
        this.edgeAngle = 0;
        this.mesh.position.copy(this.position);
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

        // Calculate slope steepness from terrain normal
        // On flat ground normal = (0,1,0), on slopes the x,z components indicate tilt
        const slopeSteepness = Math.sqrt(terrainNormal.x * terrainNormal.x + terrainNormal.z * terrainNormal.z);

        // Calculate slope direction (direction of steepest DESCENT - downhill)
        const slopeDir = new THREE.Vector3(terrainNormal.x, 0, terrainNormal.z);
        if (slopeDir.lengthSq() > 0.0001) {
            slopeDir.normalize();
        }

        // Forward direction based on skier rotation
        const forward = new THREE.Vector3(
            Math.sin(this.rotation),
            0,
            Math.cos(this.rotation)
        );

        // ============================================
        // SIMPLIFIED SKI PHYSICS - Fast and Fun
        // ============================================

        // TURNING: Edge angle controls turn rate
        const targetEdge = this.input.left ? 1.0 : (this.input.right ? -1.0 : 0);
        this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, targetEdge, 0.15);

        // Apply turning - turn rate scales with speed
        if (Math.abs(this.edgeAngle) > 0.01) {
            const speedMult = 0.5 + Math.min(this.currentSpeed / 30, 1.5);
            this.rotation += this.edgeAngle * this.turnSpeed * speedMult * delta;
        }

        if (this.isGrounded) {
            // GRAVITY: Accelerate based on slope and facing direction
            // Dot product: 1 = pointing downhill, 0 = across, -1 = uphill
            const downhillAlignment = forward.dot(slopeDir);

            // Acceleration = gravity * steepness * alignment
            // Pointing downhill on steep slope = big acceleration
            // Pointing across slope = small acceleration
            // Pointing uphill = deceleration
            const acceleration = this.gravity * slopeSteepness * downhillAlignment;

            // Always add some base acceleration if on any slope and moving slow
            // This prevents getting stuck
            const minAccel = slopeSteepness * 5;
            const effectiveAccel = this.currentSpeed < 3 ? Math.max(acceleration, minAccel) : acceleration;

            this.currentSpeed += effectiveAccel * delta;

            // FRICTION: Very low base friction, more when turning hard
            const baseFriction = 0.003; // Minimal friction when straight
            const turnFriction = Math.abs(this.edgeAngle) * 0.025; // Carving scrubs speed
            this.currentSpeed *= (1 - baseFriction - turnFriction);

            // BRAKING
            if (this.input.backward) {
                this.currentSpeed *= this.brakeForce;
            }

            // Speed limits
            this.currentSpeed = Math.max(0, Math.min(this.currentSpeed, this.maxSpeed));

            // Convert speed + direction to velocity
            this.velocity.x = forward.x * this.currentSpeed;
            this.velocity.z = forward.z * this.currentSpeed;

            // JUMP
            if (this.input.jump) {
                this.verticalVelocity = this.jumpForce;
                this.isGrounded = false;
                this.isJumping = true;
                this.input.jump = false;
            }
        } else {
            // AIR PHYSICS
            this.verticalVelocity -= this.gravity * delta;

            // Maintain horizontal velocity in air (with slight drag)
            this.velocity.x *= (1 - this.airFriction);
            this.velocity.z *= (1 - this.airFriction);

            // Update currentSpeed from velocity
            this.currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
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

        // Boundary check
        const halfWidth = this.mountain.width / 2 - 5;
        const halfDepth = this.mountain.depth / 2 - 5;
        this.position.x = THREE.MathUtils.clamp(this.position.x, -halfWidth, halfWidth);
        this.position.z = THREE.MathUtils.clamp(this.position.z, -halfDepth, halfDepth);

        // Check collisions with objects
        this.checkCollisions(delta);

        // Update mesh position
        this.mesh.position.copy(this.position);

        // Align skier to terrain surface using quaternion
        this.alignToTerrain(terrainNormal);

        // Update camera
        this.updateCamera(delta);

        // Emit snow spray when carving - subtle effect on any turn
        if (this.isGrounded && Math.abs(this.edgeAngle) > 0.1 && this.currentSpeed > 2) {
            // Calculate spray direction (perpendicular to movement, toward outside of turn)
            const sprayDir = new THREE.Vector3(
                -Math.cos(this.rotation) * Math.sign(this.edgeAngle),
                0,
                Math.sin(this.rotation) * Math.sign(this.edgeAngle)
            );
            // Subtle intensity - scales with edge angle and speed
            const intensity = Math.abs(this.edgeAngle) * 0.5 * (this.currentSpeed / 25);
            this.emitSnowSpray(this.position, sprayDir, intensity);
        }

        // Update snow spray particles
        this.updateSnowSpray(delta);

        // Update audio
        this.updateAudio();

        // Update HUD
        this.updateHUD();
    }

    // Check collisions with placed objects
    checkCollisions(delta) {
        // Get all placed objects in the scene
        const collidableObjects = [];
        this.scene.traverse(obj => {
            if (obj.userData && obj.userData.placedObject && obj !== this.mesh) {
                collidableObjects.push(obj);
            }
        });

        if (collidableObjects.length === 0) return;

        // Check distance to each object
        const skierPos = this.position.clone();
        skierPos.y += 0.5; // Check at waist height

        for (const obj of collidableObjects) {
            const objPos = obj.position.clone();
            const distance = skierPos.distanceTo(objPos);

            // Check if this is a jump ramp
            if (obj.userData.isJump && distance < 4) {
                // Check if we're moving toward the jump and on the ramp
                const toJump = objPos.clone().sub(skierPos).normalize();
                const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));
                const alignment = forward.dot(toJump);

                // If moving toward jump and close enough, launch!
                const now = performance.now();
                if (alignment > 0.3 && distance < 2.5 && this.isGrounded &&
                    now - this.lastJumpRampTime > 1000) {
                    // Launch off the jump - boost based on speed
                    const launchPower = Math.min(this.currentSpeed * 0.4, 12);
                    this.verticalVelocity = launchPower;
                    this.isGrounded = false;
                    this.isJumping = true;
                    this.lastJumpRampTime = now;
                }
                continue; // Don't collide with jumps
            }

            // Collision with other objects (trees, lodges, etc.)
            const collisionRadius = this.getCollisionRadius(obj);
            if (distance < collisionRadius + 0.5) {
                // Collision! Stop the skier and bounce back slightly
                const pushDir = skierPos.clone().sub(objPos).normalize();
                this.position.x += pushDir.x * 0.5;
                this.position.z += pushDir.z * 0.5;
                this.currentSpeed *= 0.3; // Lose most speed on collision
                this.velocity.multiplyScalar(0.3);
            }
        }
    }

    // Get collision radius for different object types
    getCollisionRadius(obj) {
        const name = obj.name || '';
        if (name.includes('lodge') || name.includes('Lodge')) return 3;
        if (name.includes('Tree') || name.includes('tree')) return 0.5;
        if (name.includes('snowman')) return 0.6;
        if (name.includes('flag')) return 0.2;
        if (name.includes('lift') || name.includes('Lift')) return 1;
        return 1; // Default radius
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
