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
        this.gravity = 25; // Gravity for slope acceleration (increased for faster skiing)
        this.airGravity = 20; // Realistic gravity when airborne (9.8 m/s^2 scaled)
        this.airFriction = 0.005;
        this.turnSpeed = 2.5; // How fast you can turn
        this.maxSpeed = 50; // Top speed (increased)
        this.brakeForce = 0.92; // Multiplier when braking
        this.jumpForce = 6; // Slightly stronger jump

        // Starting position for reset
        this.startPosition = new THREE.Vector3();
        this.startRotation = 0;

        // Collision detection
        this.collisionRaycaster = new THREE.Raycaster();
        this.lastJumpRampTime = 0;

        // For natural launch detection - track terrain curvature
        this.lastTerrainSlope = 0;
        this.lastSlopeChangeTime = 0;

        // State
        this.isGrounded = true;
        this.isJumping = false;
        this.verticalVelocity = 0;
        this.currentSpeed = 0;

        // Flip/trick state
        this.flipRotation = 0; // Current flip angle (radians)
        this.flipVelocity = 0; // Flip angular velocity
        this.isFlipping = false;
        this.flipDirection = 0; // 1 = backflip, -1 = frontflip
        this.trickLanded = false;

        // Body part references for animation
        this.bodyParts = {
            torso: null,
            head: null,
            leftArm: null,
            rightArm: null,
            leftLeg: null,
            rightLeg: null
        };

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
            jump: false,
            tuck: false // W/Up arrow for tucking (faster speed)
        };

        // Tuck state for speed boost
        this.isTucking = false;

        // Camera settings
        this.cameraOffset = new THREE.Vector3(0, 4, 10);
        this.cameraLookAhead = 3;
        this.cameraSmoothness = 0.06; // Smoother camera (lower = smoother)

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

        // Torso (jacket) - store reference for animation
        const torsoGeometry = new THREE.CapsuleGeometry(0.22, 0.45, 8, 12);
        const torso = new THREE.Mesh(torsoGeometry, jacketMaterial);
        torso.position.set(0, 1.05, 0);
        torso.rotation.x = 0.25;
        torso.name = 'torso';
        skier.add(torso);
        this.bodyParts.torso = torso;

        // Head
        const headGeometry = new THREE.SphereGeometry(0.16, 12, 10);
        const head = new THREE.Mesh(headGeometry, skinMaterial);
        head.position.set(0, 1.52, 0.05);
        head.name = 'head';
        skier.add(head);
        this.bodyParts.head = head;

        // Helmet
        const helmetGeometry = new THREE.SphereGeometry(0.19, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.set(0, 1.56, 0.02);
        helmet.rotation.x = -0.1;
        helmet.name = 'helmet';
        skier.add(helmet);
        this.bodyParts.helmet = helmet;

        // Goggles
        const gogglesGeometry = new THREE.BoxGeometry(0.28, 0.08, 0.06);
        const goggles = new THREE.Mesh(gogglesGeometry, gogglesMaterial);
        goggles.position.set(0, 1.52, 0.16);
        goggles.name = 'goggles';
        skier.add(goggles);
        this.bodyParts.goggles = goggles;

        // Goggle strap
        const strapGeometry = new THREE.TorusGeometry(0.17, 0.015, 6, 16, Math.PI);
        const strap = new THREE.Mesh(strapGeometry, gogglesMaterial);
        strap.position.set(0, 1.54, 0.02);
        strap.rotation.x = Math.PI / 2;
        strap.rotation.z = Math.PI;
        strap.name = 'strap';
        skier.add(strap);
        this.bodyParts.strap = strap;

        // Upper legs (thighs)
        const thighs = [];
        [-0.12, 0.12].forEach((x, i) => {
            const thighGeometry = new THREE.CapsuleGeometry(0.09, 0.25, 6, 8);
            const thigh = new THREE.Mesh(thighGeometry, pantsMaterial);
            thigh.position.set(x, 0.62, 0.08);
            thigh.rotation.x = 0.8;
            thigh.name = i === 0 ? 'leftThigh' : 'rightThigh';
            skier.add(thigh);
            thighs.push(thigh);
        });
        this.bodyParts.leftThigh = thighs[0];
        this.bodyParts.rightThigh = thighs[1];

        // Lower legs (shins)
        const shins = [];
        [-0.14, 0.14].forEach((x, i) => {
            const shinGeometry = new THREE.CapsuleGeometry(0.07, 0.22, 6, 8);
            const shin = new THREE.Mesh(shinGeometry, pantsMaterial);
            shin.position.set(x, 0.32, 0.18);
            shin.rotation.x = 0.15;
            shin.name = i === 0 ? 'leftShin' : 'rightShin';
            skier.add(shin);
            shins.push(shin);
        });
        this.bodyParts.leftShin = shins[0];
        this.bodyParts.rightShin = shins[1];

        // Ski boots
        [-0.15, 0.15].forEach(x => {
            const bootGeometry = new THREE.BoxGeometry(0.12, 0.14, 0.28);
            const boot = new THREE.Mesh(bootGeometry, bootMaterial);
            boot.position.set(x, 0.1, 0.22);
            skier.add(boot);
        });

        // Arms - natural skiing stance with bent elbows, hands forward
        const arms = { left: {}, right: {} };
        [-1, 1].forEach(side => {
            const armKey = side === -1 ? 'left' : 'right';

            // Upper arm - hangs down from shoulder, slightly forward and out
            const upperArmGeometry = new THREE.CapsuleGeometry(0.055, 0.2, 6, 8);
            const upperArm = new THREE.Mesh(upperArmGeometry, jacketMaterial);
            upperArm.position.set(side * 0.24, 0.95, 0.05);
            upperArm.rotation.z = side * -0.4; // Slight angle outward
            upperArm.rotation.x = 0.3; // Slight forward angle
            upperArm.name = armKey + 'UpperArm';
            skier.add(upperArm);
            arms[armKey].upperArm = upperArm;

            // Forearm - bent at elbow ~90 degrees, pointing forward
            const forearmGeometry = new THREE.CapsuleGeometry(0.045, 0.18, 6, 8);
            const forearm = new THREE.Mesh(forearmGeometry, jacketMaterial);
            forearm.position.set(side * 0.32, 0.72, 0.22);
            forearm.rotation.z = side * -0.15;
            forearm.rotation.x = 1.1; // Pointing forward/down
            forearm.name = armKey + 'Forearm';
            skier.add(forearm);
            arms[armKey].forearm = forearm;

            // Glove/hand - in front of body at waist level
            const gloveGeometry = new THREE.SphereGeometry(0.05, 8, 6);
            const glove = new THREE.Mesh(gloveGeometry, gloveMaterial);
            glove.position.set(side * 0.28, 0.58, 0.42);
            glove.name = armKey + 'Glove';
            skier.add(glove);
            arms[armKey].glove = glove;
        });
        this.bodyParts.leftArm = arms.left;
        this.bodyParts.rightArm = arms.right;

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

        // Poles - as groups that can be animated with arms
        const poles = { left: null, right: null };
        [-1, 1].forEach(side => {
            const poleKey = side === -1 ? 'left' : 'right';

            // Create pole group anchored at grip position
            const poleGroup = new THREE.Group();
            poleGroup.name = poleKey + 'Pole';

            // Default hand position (matches glove position)
            const handX = side * 0.28;
            const handY = 0.58;
            const handZ = 0.42;
            poleGroup.position.set(handX, handY, handZ);

            // Pole grip - at origin of group (hand holds here)
            const gripGeometry = new THREE.CylinderGeometry(0.025, 0.02, 0.12, 8);
            const grip = new THREE.Mesh(gripGeometry, gloveMaterial);
            grip.position.set(0, 0, 0);
            grip.rotation.x = Math.PI / 2 + 0.3; // Angled forward
            grip.rotation.z = side * 0.1;
            poleGroup.add(grip);

            // Pole wrist strap
            const strapLoopGeo = new THREE.TorusGeometry(0.03, 0.005, 6, 12);
            const strapLoop = new THREE.Mesh(strapLoopGeo, poleMaterial);
            strapLoop.position.set(0, 0.02, 0.04);
            strapLoop.rotation.x = Math.PI / 2;
            poleGroup.add(strapLoop);

            // Pole shaft - extends down and back from grip
            const shaftGeometry = new THREE.CylinderGeometry(0.012, 0.01, 1.1, 8);
            const shaft = new THREE.Mesh(shaftGeometry, poleMaterial);
            shaft.position.set(side * 0.02, -0.45, -0.25);
            shaft.rotation.x = 0.5;
            shaft.rotation.z = side * -0.05;
            poleGroup.add(shaft);

            // Pole basket - ring near bottom
            const basketRingGeo = new THREE.TorusGeometry(0.045, 0.008, 8, 16);
            const basketRing = new THREE.Mesh(basketRingGeo, poleMaterial);
            basketRing.position.set(side * 0.03, -0.85, -0.48);
            basketRing.rotation.x = Math.PI / 2 + 0.5;
            poleGroup.add(basketRing);

            // Basket spokes
            for (let i = 0; i < 4; i++) {
                const spokeGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.08, 4);
                const spoke = new THREE.Mesh(spokeGeo, poleMaterial);
                const angle = (i / 4) * Math.PI * 2;
                spoke.position.set(
                    side * 0.03 + Math.cos(angle) * 0.022,
                    -0.85,
                    -0.48 + Math.sin(angle) * 0.022
                );
                spoke.rotation.x = Math.PI / 2 + 0.5;
                poleGroup.add(spoke);
            }

            // Pole tip - pointed end
            const tipGeometry = new THREE.ConeGeometry(0.015, 0.06, 6);
            const tipMaterial = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.3,
                metalness: 0.8
            });
            const tip = new THREE.Mesh(tipGeometry, tipMaterial);
            tip.position.set(side * 0.035, -0.95, -0.55);
            tip.rotation.x = Math.PI + 0.5;
            poleGroup.add(tip);

            skier.add(poleGroup);
            poles[poleKey] = poleGroup;
        });
        this.bodyParts.leftPole = poles.left;
        this.bodyParts.rightPole = poles.right;

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
                this.input.tuck = true;
                // Initiate backflip if airborne and not already flipping
                if (!this.isGrounded && !this.isFlipping && this.verticalVelocity > 0) {
                    this.startFlip(1); // Backflip
                }
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.input.backward = true;
                // Initiate frontflip if airborne and not already flipping
                if (!this.isGrounded && !this.isFlipping && this.verticalVelocity > 0) {
                    this.startFlip(-1); // Frontflip
                }
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
        this.flipRotation = 0;
        this.flipVelocity = 0;
        this.isFlipping = false;
        this.mesh.position.copy(this.position);
    }

    startFlip(direction) {
        this.isFlipping = true;
        this.flipDirection = direction;
        this.flipRotation = 0;
        // Flip speed based on jump height/speed
        this.flipVelocity = direction * (8 + Math.min(this.currentSpeed * 0.3, 4));
        this.trickLanded = false;
    }

    updateFlip(delta) {
        if (!this.isFlipping) return;

        // Apply flip rotation
        this.flipRotation += this.flipVelocity * delta;

        // Check if flip is complete (full 360 degrees = 2*PI)
        const fullFlip = Math.abs(this.flipRotation) >= Math.PI * 2;

        // If we've done a full flip, allow landing
        if (fullFlip && !this.trickLanded) {
            this.trickLanded = true;
        }

        // Landing detection - if grounded while flipping
        if (this.isGrounded) {
            // Check if landed cleanly (close to upright)
            const normalizedRotation = this.flipRotation % (Math.PI * 2);
            const landingAngle = Math.abs(normalizedRotation);

            // Clean landing if close to full rotation or zero
            const cleanLanding = landingAngle < 0.5 || landingAngle > Math.PI * 2 - 0.5 ||
                                 (landingAngle > Math.PI - 0.5 && landingAngle < Math.PI + 0.5);

            if (!cleanLanding) {
                // Crash! Lose most speed
                this.currentSpeed *= 0.1;
            }

            // Reset flip state
            this.isFlipping = false;
            this.flipRotation = 0;
            this.flipVelocity = 0;
        }
    }

    onKeyUp(e) {
        let handled = true;
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.input.forward = false;
                this.input.tuck = false;
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

            // TUCKING: Reduces drag for higher speed
            this.isTucking = this.input.tuck && Math.abs(this.edgeAngle) < 0.3;

            // FRICTION: Very low base friction, more when turning hard
            const baseFriction = this.isTucking ? 0.001 : 0.003; // Much less friction when tucking
            const turnFriction = Math.abs(this.edgeAngle) * 0.025; // Carving scrubs speed
            this.currentSpeed *= (1 - baseFriction - turnFriction);

            // BRAKING
            if (this.input.backward && !this.isTucking) {
                this.currentSpeed *= this.brakeForce;
            }

            // Speed limits - higher max when tucking
            const effectiveMaxSpeed = this.isTucking ? this.maxSpeed * 1.3 : this.maxSpeed;
            this.currentSpeed = Math.max(0, Math.min(this.currentSpeed, effectiveMaxSpeed));

            // Convert speed + direction to velocity
            this.velocity.x = forward.x * this.currentSpeed;
            this.velocity.z = forward.z * this.currentSpeed;

            // JUMP - manual jump adds to any natural launch for extra height
            if (this.input.jump) {
                // Check if we're about to naturally launch (for timed jump bonus)
                const nextX = this.position.x + this.velocity.x * delta;
                const nextZ = this.position.z + this.velocity.z * delta;
                const nextTerrainHeight = this.mountain.getHeightAt(nextX, nextZ);
                const upcomingDrop = terrainHeight - nextTerrainHeight;

                // Timed jump bonus - if jumping right before a drop, get extra height
                let jumpBoost = this.jumpForce;
                if (upcomingDrop > 0.2 && this.currentSpeed > 10) {
                    // Perfect timing! Add speed-based bonus
                    jumpBoost += this.currentSpeed * 0.1;
                }

                this.verticalVelocity = jumpBoost;
                this.isGrounded = false;
                this.isJumping = true;
                this.input.jump = false;
            }
        } else {
            // AIR PHYSICS - realistic gravity when airborne
            this.verticalVelocity -= this.airGravity * delta;

            // Maintain horizontal velocity in air (minimal drag)
            this.velocity.x *= (1 - this.airFriction);
            this.velocity.z *= (1 - this.airFriction);

            // Update currentSpeed from velocity
            this.currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

            // Allow slight air control for steering
            if (Math.abs(this.edgeAngle) > 0.1) {
                this.rotation += this.edgeAngle * 0.5 * delta;
            }
        }

        // Apply horizontal velocity
        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;

        // Get terrain height at new position
        const newTerrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);

        // Handle vertical movement
        if (this.isGrounded && !this.isJumping) {
            // Calculate current slope in direction of travel
            // Positive = going uphill, Negative = going downhill
            const lookAheadDist = 1.5;
            const aheadX = this.position.x + forward.x * lookAheadDist;
            const aheadZ = this.position.z + forward.z * lookAheadDist;
            const aheadHeight = this.mountain.getHeightAt(aheadX, aheadZ);
            const currentSlope = (aheadHeight - terrainHeight) / lookAheadDist;

            // Detect inflection point - slope changing from "less steep" to "more steep" downward
            // This is the lip of a jump where terrain curves away
            const slopeChange = currentSlope - this.lastTerrainSlope;
            const now = performance.now();

            // Natural launch conditions:
            // 1. Slope is getting MORE negative (terrain curving away/down)
            // 2. Going fast enough
            // 3. Significant slope change (inflection point)
            // 4. Not just triggered a launch
            const minLaunchSpeed = 12;
            const inflectionThreshold = -0.15; // Slope must change this much toward steeper downhill
            const timeSinceLastLaunch = now - this.lastSlopeChangeTime;

            if (slopeChange < inflectionThreshold &&
                this.currentSpeed > minLaunchSpeed &&
                timeSinceLastLaunch > 500) {

                // Calculate launch velocity based on speed and how sharp the inflection is
                const speedFactor = this.currentSpeed / this.maxSpeed;
                const inflectionStrength = Math.min(Math.abs(slopeChange) * 3, 1.5);

                // Natural launch - converts forward momentum to vertical at inflection
                this.verticalVelocity = this.currentSpeed * 0.12 * inflectionStrength + 1.5;

                // Cap natural launch velocity
                this.verticalVelocity = Math.min(this.verticalVelocity, 8);

                this.isGrounded = false;
                this.isJumping = true;
                this.lastSlopeChangeTime = now;

                // Keep current height momentarily
                this.position.y = terrainHeight;
            } else {
                // Normal grounded movement - stick to terrain
                this.position.y = newTerrainHeight;
                this.verticalVelocity = 0;
            }

            // Store slope for next frame
            this.lastTerrainSlope = currentSlope;
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

        // Update flip if in air
        this.updateFlip(delta);

        // Align skier to terrain surface using quaternion
        this.alignToTerrain(terrainNormal);

        // Animate body parts based on movement
        this.animateBody(delta);

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
        // Get the up vector (terrain normal when grounded, world up when airborne)
        const up = this.isGrounded ? terrainNormal.clone().normalize() : new THREE.Vector3(0, 1, 0);

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

        // Apply flip rotation when airborne
        if (this.isFlipping && !this.isGrounded) {
            const flipQuat = new THREE.Quaternion();
            flipQuat.setFromAxisAngle(right, this.flipRotation);
            this.mesh.quaternion.multiply(flipQuat);
        }
    }

    // Animate body parts for more life-like movement
    animateBody(delta) {
        if (!this.bodyParts.torso) return;

        const torso = this.bodyParts.torso;
        const speedFactor = this.currentSpeed / this.maxSpeed;

        // Base skiing crouch position
        let targetCrouch = 0.25;

        // Crouch more when going fast
        targetCrouch += speedFactor * 0.15;

        // Crouch more when turning hard
        targetCrouch += Math.abs(this.edgeAngle) * 0.1;

        // Deep tuck when holding W (speed tuck)
        if (this.isTucking && this.isGrounded) {
            targetCrouch += 0.6; // Very low tuck position
        }

        // Tuck position when airborne (if not flipping)
        if (!this.isGrounded && !this.isFlipping) {
            targetCrouch += 0.3;
        }

        // Tuck tight during flips
        if (this.isFlipping) {
            targetCrouch += 0.5;
        }

        // Smoothly interpolate torso bend
        torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, targetCrouch, 0.15);

        // Add subtle side-to-side movement when turning
        const targetSideLean = this.edgeAngle * 0.15;
        torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z || 0, targetSideLean, 0.1);

        // Animate head - duck down when tucking
        const isTuckingGrounded = this.isTucking && this.isGrounded;

        // Head position targets
        let targetHeadY = 1.52;
        let targetHeadZ = 0.05;
        let targetHeadRotX = 0;

        if (isTuckingGrounded) {
            targetHeadY = 1.15; // Lower head
            targetHeadZ = 0.25; // Move head forward
            targetHeadRotX = 0.4; // Tilt head down
        } else if (this.isFlipping) {
            targetHeadY = 1.3;
            targetHeadZ = 0.15;
            targetHeadRotX = 0.3;
        }

        if (this.bodyParts.head) {
            const head = this.bodyParts.head;
            head.position.y = THREE.MathUtils.lerp(head.position.y, targetHeadY, 0.15);
            head.position.z = THREE.MathUtils.lerp(head.position.z, targetHeadZ, 0.15);
            head.rotation.x = THREE.MathUtils.lerp(head.rotation.x || 0, targetHeadRotX, 0.15);
        }

        // Animate helmet to follow head
        if (this.bodyParts.helmet) {
            const helmet = this.bodyParts.helmet;
            const targetHelmetY = targetHeadY + 0.04;
            const targetHelmetZ = targetHeadZ - 0.03;
            helmet.position.y = THREE.MathUtils.lerp(helmet.position.y, targetHelmetY, 0.15);
            helmet.position.z = THREE.MathUtils.lerp(helmet.position.z, targetHelmetZ, 0.15);
            helmet.rotation.x = THREE.MathUtils.lerp(helmet.rotation.x, -0.1 + targetHeadRotX, 0.15);
        }

        // Animate goggles to follow head
        if (this.bodyParts.goggles) {
            const goggles = this.bodyParts.goggles;
            const targetGogglesY = targetHeadY;
            const targetGogglesZ = targetHeadZ + 0.11;
            goggles.position.y = THREE.MathUtils.lerp(goggles.position.y, targetGogglesY, 0.15);
            goggles.position.z = THREE.MathUtils.lerp(goggles.position.z, targetGogglesZ, 0.15);
        }

        // Animate goggle strap to follow head
        if (this.bodyParts.strap) {
            const strap = this.bodyParts.strap;
            const targetStrapY = targetHeadY + 0.02;
            const targetStrapZ = targetHeadZ - 0.03;
            strap.position.y = THREE.MathUtils.lerp(strap.position.y, targetStrapY, 0.15);
            strap.position.z = THREE.MathUtils.lerp(strap.position.z, targetStrapZ, 0.15);
        }

        // Animate arms - natural skiing stance or tuck
        if (this.bodyParts.leftArm && this.bodyParts.rightArm) {
            [-1, 1].forEach(side => {
                const arm = side === -1 ? this.bodyParts.leftArm : this.bodyParts.rightArm;

                // Default natural skiing stance - arms bent, hands forward at waist
                let targetUpperArmX = side * 0.24;
                let targetUpperArmY = 0.95;
                let targetUpperArmZ = 0.05;
                let targetUpperArmRotX = 0.3;
                let targetUpperArmRotZ = side * -0.4;

                let targetForearmX = side * 0.32;
                let targetForearmY = 0.72;
                let targetForearmZ = 0.22;
                let targetForearmRotX = 1.1;
                let targetForearmRotZ = side * -0.15;

                let targetGloveX = side * 0.28;
                let targetGloveY = 0.58;
                let targetGloveZ = 0.42;

                // Subtle arm movement when turning
                if (Math.abs(this.edgeAngle) > 0.1 && this.isGrounded && !isTuckingGrounded) {
                    // Arms move slightly for balance when turning
                    const turnOffset = this.edgeAngle * 0.1;
                    targetUpperArmRotZ += turnOffset;
                    targetGloveY += Math.abs(this.edgeAngle) * 0.05;
                }

                if (isTuckingGrounded) {
                    // Deep tuck - arms pulled in tight, hands together forward
                    targetUpperArmX = side * 0.18;
                    targetUpperArmY = 0.7;
                    targetUpperArmZ = 0.12;
                    targetUpperArmRotX = 1.3;
                    targetUpperArmRotZ = side * -0.2;

                    targetForearmX = side * 0.12;
                    targetForearmY = 0.5;
                    targetForearmZ = 0.38;
                    targetForearmRotX = 1.6;
                    targetForearmRotZ = side * -0.05;

                    targetGloveX = side * 0.08;
                    targetGloveY = 0.4;
                    targetGloveZ = 0.52;
                }

                // Apply upper arm animation
                if (arm.upperArm) {
                    arm.upperArm.position.x = THREE.MathUtils.lerp(arm.upperArm.position.x, targetUpperArmX, 0.12);
                    arm.upperArm.position.y = THREE.MathUtils.lerp(arm.upperArm.position.y, targetUpperArmY, 0.12);
                    arm.upperArm.position.z = THREE.MathUtils.lerp(arm.upperArm.position.z, targetUpperArmZ, 0.12);
                    arm.upperArm.rotation.x = THREE.MathUtils.lerp(arm.upperArm.rotation.x, targetUpperArmRotX, 0.12);
                    arm.upperArm.rotation.z = THREE.MathUtils.lerp(arm.upperArm.rotation.z, targetUpperArmRotZ, 0.12);
                }

                // Apply forearm animation
                if (arm.forearm) {
                    arm.forearm.position.x = THREE.MathUtils.lerp(arm.forearm.position.x, targetForearmX, 0.12);
                    arm.forearm.position.y = THREE.MathUtils.lerp(arm.forearm.position.y, targetForearmY, 0.12);
                    arm.forearm.position.z = THREE.MathUtils.lerp(arm.forearm.position.z, targetForearmZ, 0.12);
                    arm.forearm.rotation.x = THREE.MathUtils.lerp(arm.forearm.rotation.x, targetForearmRotX, 0.12);
                    arm.forearm.rotation.z = THREE.MathUtils.lerp(arm.forearm.rotation.z, targetForearmRotZ, 0.12);
                }

                // Apply glove animation
                if (arm.glove) {
                    arm.glove.position.x = THREE.MathUtils.lerp(arm.glove.position.x, targetGloveX, 0.12);
                    arm.glove.position.y = THREE.MathUtils.lerp(arm.glove.position.y, targetGloveY, 0.12);
                    arm.glove.position.z = THREE.MathUtils.lerp(arm.glove.position.z, targetGloveZ, 0.12);
                }

                // Animate pole to follow hand
                const pole = side === -1 ? this.bodyParts.leftPole : this.bodyParts.rightPole;
                if (pole) {
                    // Pole position follows glove
                    pole.position.x = THREE.MathUtils.lerp(pole.position.x, targetGloveX, 0.12);
                    pole.position.y = THREE.MathUtils.lerp(pole.position.y, targetGloveY, 0.12);
                    pole.position.z = THREE.MathUtils.lerp(pole.position.z, targetGloveZ, 0.12);

                    // Pole rotation - normal stance has poles angled back, tuck has them horizontal
                    let targetPoleRotX = -0.2; // Slight backward angle in normal stance
                    let targetPoleRotY = side * 0.3; // Angled outward
                    let targetPoleRotZ = side * 0.15;

                    if (isTuckingGrounded) {
                        // Poles tucked under arms, more horizontal and parallel
                        targetPoleRotX = 0.9;
                        targetPoleRotY = side * 0.1;
                        targetPoleRotZ = side * 0.4;
                    }

                    pole.rotation.x = THREE.MathUtils.lerp(pole.rotation.x || 0, targetPoleRotX, 0.12);
                    pole.rotation.y = THREE.MathUtils.lerp(pole.rotation.y || 0, targetPoleRotY, 0.12);
                    pole.rotation.z = THREE.MathUtils.lerp(pole.rotation.z || 0, targetPoleRotZ, 0.12);
                }
            });
        }

        // Animate legs - bend more when tucking
        if (this.bodyParts.leftThigh && this.bodyParts.rightThigh) {
            let targetThighRotX = 0.8; // Normal skiing stance
            let targetThighY = 0.62;
            let targetThighZ = 0.08;

            if (this.isTucking && this.isGrounded) {
                targetThighRotX = 1.4; // Much more bent
                targetThighY = 0.45; // Lower
                targetThighZ = 0.2; // More forward
            } else if (this.isFlipping) {
                targetThighRotX = 1.2;
                targetThighY = 0.5;
            }

            [this.bodyParts.leftThigh, this.bodyParts.rightThigh].forEach(thigh => {
                thigh.rotation.x = THREE.MathUtils.lerp(thigh.rotation.x, targetThighRotX, 0.15);
                thigh.position.y = THREE.MathUtils.lerp(thigh.position.y, targetThighY, 0.15);
                thigh.position.z = THREE.MathUtils.lerp(thigh.position.z, targetThighZ, 0.15);
            });
        }

        // Animate shins
        if (this.bodyParts.leftShin && this.bodyParts.rightShin) {
            let targetShinRotX = 0.15; // Normal stance
            let targetShinY = 0.32;
            let targetShinZ = 0.18;

            if (this.isTucking && this.isGrounded) {
                targetShinRotX = -0.3; // Angled back
                targetShinY = 0.22; // Lower
                targetShinZ = 0.3; // More forward
            }

            [this.bodyParts.leftShin, this.bodyParts.rightShin].forEach(shin => {
                shin.rotation.x = THREE.MathUtils.lerp(shin.rotation.x, targetShinRotX, 0.15);
                shin.position.y = THREE.MathUtils.lerp(shin.position.y, targetShinY, 0.15);
                shin.position.z = THREE.MathUtils.lerp(shin.position.z, targetShinZ, 0.15);
            });
        }

        // Subtle bobbing motion based on speed
        if (this.isGrounded && this.currentSpeed > 2 && !this.isTucking) {
            const bob = Math.sin(performance.now() * 0.01 * speedFactor) * 0.02 * speedFactor;
            torso.position.y = 1.05 + bob;
        } else if (this.isTucking) {
            torso.position.y = THREE.MathUtils.lerp(torso.position.y, 0.85, 0.15); // Lower torso when tucking
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
        const minCameraHeight = terrainHeightAtCamera + 3.0;
        if (targetCameraPos.y < minCameraHeight) {
            targetCameraPos.y = minCameraHeight;
        }

        // Keep camera steady relative to ground during jumps
        // Don't follow skier's Y position exactly when airborne
        if (!this.isGrounded) {
            const groundHeight = this.mountain.getHeightAt(this.position.x, this.position.z);
            targetCameraPos.y = Math.max(targetCameraPos.y, groundHeight + this.cameraOffset.y);
        }

        // Smooth camera movement (extra smooth for stability)
        const smoothness = this.isGrounded ? this.cameraSmoothness : this.cameraSmoothness * 0.5;
        this.camera.position.lerp(targetCameraPos, smoothness);

        // Look at skier (at body height, not feet)
        const lookTarget = this.position.clone();
        lookTarget.y += 1.0; // Look at skier's torso
        lookTarget.add(new THREE.Vector3(
            Math.sin(this.rotation) * this.cameraLookAhead,
            0,
            Math.cos(this.rotation) * this.cameraLookAhead
        ));

        this.camera.lookAt(lookTarget);
    }

    updateHUD() {
        // Convert speed to km/h (approximate scaling)
        const speedKmh = Math.round(this.currentSpeed * 3.6);
        document.getElementById('speed-value').textContent = speedKmh;

        // Show trick status
        const trickStatus = document.getElementById('trick-status');
        if (trickStatus) {
            if (this.isFlipping) {
                const flipProgress = Math.abs(this.flipRotation) / (Math.PI * 2) * 100;
                const trickName = this.flipDirection > 0 ? 'BACKFLIP' : 'FRONTFLIP';
                trickStatus.textContent = `${trickName} ${Math.min(100, Math.round(flipProgress))}%`;
                trickStatus.classList.remove('hidden');
            } else if (!this.isGrounded) {
                trickStatus.textContent = 'AIR! (W=backflip, S=frontflip)';
                trickStatus.classList.remove('hidden');
            } else {
                trickStatus.classList.add('hidden');
            }
        }
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
