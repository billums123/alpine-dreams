/**
 * ObjectPlacer - Handles placing, selecting, and manipulating objects
 */

import * as THREE from 'three';
import { SkiLift } from '../objects/SkiLift.js';
import { Lodge } from '../objects/Lodge.js';
import { Decorations } from '../objects/Decorations.js';

export class ObjectPlacer {
    constructor(scene, camera, domElement, mountain) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.mountain = mountain;

        // Raycaster for picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // State
        this.mode = 'select'; // 'select', 'place'
        this.currentObjectType = null;
        this.previewObject = null;
        this.selectedObject = null;
        this.placedObjects = [];

        // Object factories
        this.skiLift = new SkiLift(scene, mountain);
        this.lodge = new Lodge(scene, mountain);
        this.decorations = new Decorations(scene, mountain);

        // Lift placement state
        this.liftStartPoint = null;
        this.liftPreviewLine = null;

        // Bind event handlers
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);

        this.setupEvents();
    }

    setupEvents() {
        this.domElement.addEventListener('mousemove', this.onMouseMove);
        this.domElement.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('keydown', this.onKeyDown);
    }

    // Set placement mode with object type
    setPlacementMode(objectType) {
        this.clearSelection();
        this.removePreview();

        this.mode = 'place';
        this.currentObjectType = objectType;
        this.liftStartPoint = null;

        // Create preview object
        this.createPreview(objectType);

        document.body.classList.add('placing-mode');

        // Return object name for UI
        const names = {
            'ski-lift': 'Ski Lift',
            'gondola': 'Gondola',
            'lodge': 'Lodge',
            'pine-tree': 'Pine Tree',
            'flag': 'Marker Flag',
            'snowman': 'Snowman',
            'jump': 'Snow Jump'
        };
        return names[objectType] || objectType;
    }

    cancelPlacement() {
        this.mode = 'select';
        this.currentObjectType = null;
        this.liftStartPoint = null;
        this.removePreview();
        this.removeLiftPreviewLine();
        document.body.classList.remove('placing-mode');
    }

    createPreview(objectType) {
        this.removePreview();

        switch (objectType) {
            case 'ski-lift':
            case 'gondola':
                this.previewObject = this.skiLift.createTower();
                break;
            case 'lodge':
                this.previewObject = this.lodge.create();
                break;
            case 'pine-tree':
                this.previewObject = this.decorations.createTree();
                break;
            case 'flag':
                this.previewObject = this.decorations.createFlag();
                break;
            case 'snowman':
                this.previewObject = this.decorations.createSnowman();
                break;
            case 'jump':
                this.previewObject = this.decorations.createJump();
                break;
        }

        if (this.previewObject) {
            // Make preview semi-transparent
            this.setObjectOpacity(this.previewObject, 0.6);
            this.previewObject.userData.isPreview = true;
            this.scene.add(this.previewObject);
        }
    }

    removePreview() {
        if (this.previewObject) {
            this.scene.remove(this.previewObject);
            this.previewObject = null;
        }
    }

    removeLiftPreviewLine() {
        if (this.liftPreviewLine) {
            this.scene.remove(this.liftPreviewLine);
            this.liftPreviewLine = null;
        }
    }

    setObjectOpacity(object, opacity) {
        object.traverse(child => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }

    onMouseMove(event) {
        // Update mouse coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.mode === 'place' && this.previewObject) {
            // Raycast to terrain
            const intersect = this.mountain.raycast(this.raycaster);

            if (intersect) {
                const point = intersect.point;
                this.previewObject.position.copy(point);

                // Align to terrain normal for certain objects
                if (['pine-tree', 'flag', 'snowman', 'jump'].includes(this.currentObjectType)) {
                    const normal = this.mountain.getNormalAt(point.x, point.z);
                    // Subtle tilt (more for jump to align with slope)
                    const tiltFactor = this.currentObjectType === 'jump' ? 0.5 : 0.2;
                    this.previewObject.rotation.x = -normal.z * tiltFactor;
                    this.previewObject.rotation.z = normal.x * tiltFactor;
                }

                // Update lift preview line
                if (this.liftStartPoint && (this.currentObjectType === 'ski-lift' || this.currentObjectType === 'gondola')) {
                    this.updateLiftPreviewLine(this.liftStartPoint, point);
                }
            }
        } else if (this.mode === 'select') {
            // Check for hovering over selectable objects
            const intersects = this.raycaster.intersectObjects(
                this.placedObjects.map(o => o.object),
                true
            );

            if (intersects.length > 0) {
                document.body.classList.add('hovering-object');
            } else {
                document.body.classList.remove('hovering-object');
            }
        }
    }

    onMouseDown(event) {
        if (event.button !== 0) return; // Only left click

        // Don't handle if clicking on UI
        if (event.target.closest('#ui-overlay')) return;

        if (this.mode === 'place') {
            this.placeObject();
        } else if (this.mode === 'select') {
            this.trySelect();
        }
    }

    placeObject() {
        if (!this.previewObject) return;

        const position = this.previewObject.position.clone();

        // Special handling for ski lifts (need start and end points)
        if (this.currentObjectType === 'ski-lift' || this.currentObjectType === 'gondola') {
            if (!this.liftStartPoint) {
                // First click - set start point
                this.liftStartPoint = position.clone();

                // Place start tower
                const startTower = this.skiLift.createTower();
                startTower.position.copy(position);
                startTower.userData.type = 'lift-tower';
                startTower.userData.isStart = true;
                this.scene.add(startTower);

                // Create new preview for end point
                this.createPreview(this.currentObjectType);

                // Show connecting line
                this.createLiftPreviewLine(position);

                return; // Wait for second click
            } else {
                // Second click - complete the lift
                const isGondola = this.currentObjectType === 'gondola';
                const lift = this.skiLift.createLift(this.liftStartPoint, position, isGondola);

                this.placedObjects.push({
                    type: this.currentObjectType,
                    object: lift,
                    data: {
                        start: this.liftStartPoint.clone(),
                        end: position.clone()
                    }
                });

                // Remove the temporary start tower
                const tempTowers = this.scene.children.filter(
                    c => c.userData.type === 'lift-tower' && c.userData.isStart
                );
                tempTowers.forEach(t => this.scene.remove(t));

                this.liftStartPoint = null;
                this.removeLiftPreviewLine();
                this.cancelPlacement();
                return;
            }
        }

        // Standard object placement
        let newObject;

        switch (this.currentObjectType) {
            case 'lodge':
                newObject = this.lodge.create();
                break;
            case 'pine-tree':
                newObject = this.decorations.createTree();
                break;
            case 'flag':
                newObject = this.decorations.createFlag();
                break;
            case 'snowman':
                newObject = this.decorations.createSnowman();
                break;
            case 'jump':
                newObject = this.decorations.createJump();
                break;
        }

        if (newObject) {
            newObject.position.copy(position);
            newObject.rotation.copy(this.previewObject.rotation);
            newObject.userData.type = this.currentObjectType;
            newObject.userData.placedObject = true;

            this.scene.add(newObject);
            this.placedObjects.push({
                type: this.currentObjectType,
                object: newObject,
                data: { position: position.clone() }
            });

            // Stay in placement mode for rapid placement
            this.createPreview(this.currentObjectType);
        }
    }

    createLiftPreviewLine(startPoint) {
        const material = new THREE.LineDashedMaterial({
            color: 0x4a90d9,
            dashSize: 1,
            gapSize: 0.5,
            linewidth: 2
        });

        const geometry = new THREE.BufferGeometry().setFromPoints([
            startPoint,
            startPoint.clone()
        ]);

        this.liftPreviewLine = new THREE.Line(geometry, material);
        this.liftPreviewLine.computeLineDistances();
        this.scene.add(this.liftPreviewLine);
    }

    updateLiftPreviewLine(start, end) {
        if (!this.liftPreviewLine) return;

        const positions = this.liftPreviewLine.geometry.attributes.position.array;
        positions[3] = end.x;
        positions[4] = end.y + 5; // Raised to tower height
        positions[5] = end.z;

        positions[0] = start.x;
        positions[1] = start.y + 5;
        positions[2] = start.z;

        this.liftPreviewLine.geometry.attributes.position.needsUpdate = true;
        this.liftPreviewLine.computeLineDistances();
    }

    trySelect() {
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const selectableObjects = this.placedObjects.map(o => o.object);
        const intersects = this.raycaster.intersectObjects(selectableObjects, true);

        if (intersects.length > 0) {
            // Find the root placed object
            let target = intersects[0].object;
            while (target.parent && !target.userData.placedObject && target.parent.type !== 'Scene') {
                target = target.parent;
            }

            // Find in placed objects
            const found = this.placedObjects.find(o => {
                if (o.object === target) return true;
                let parent = target.parent;
                while (parent) {
                    if (parent === o.object) return true;
                    parent = parent.parent;
                }
                return false;
            });

            if (found) {
                this.selectObject(found);
            }
        } else {
            this.clearSelection();
        }
    }

    selectObject(placedObj) {
        this.clearSelection();

        this.selectedObject = placedObj;

        // Visual feedback - add outline effect
        this.highlightObject(placedObj.object, true);
    }

    clearSelection() {
        if (this.selectedObject) {
            this.highlightObject(this.selectedObject.object, false);
            this.selectedObject = null;
        }
    }

    highlightObject(object, highlight) {
        object.traverse(child => {
            if (child.isMesh) {
                if (highlight) {
                    child.userData.originalMaterial = child.material;
                    child.material = child.material.clone();
                    child.material.emissive = new THREE.Color(0x4a90d9);
                    child.material.emissiveIntensity = 0.3;
                } else if (child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
            }
        });
    }

    onKeyDown(event) {
        // Cancel placement
        if (event.key === 'Escape') {
            if (this.mode === 'place') {
                this.cancelPlacement();
            } else {
                this.clearSelection();
            }
        }

        // Get target for rotation (preview or selected object)
        const target = this.previewObject || (this.selectedObject && this.selectedObject.object);

        if (target) {
            const rotationStep = Math.PI / 18; // 10 degrees - finer control

            // R key = Quick 45 degree yaw rotation
            if (event.key === 'r' || event.key === 'R') {
                target.rotation.y += Math.PI / 4;
                event.preventDefault();
            }

            // T key = Reset rotation to default
            if (event.key === 't' || event.key === 'T') {
                target.rotation.set(0, 0, 0);
                event.preventDefault();
            }

            // Left/Right arrows = Yaw (spin left/right)
            if (event.key === 'ArrowLeft') {
                target.rotation.y += rotationStep;
                event.preventDefault();
            } else if (event.key === 'ArrowRight') {
                target.rotation.y -= rotationStep;
                event.preventDefault();
            }

            // Up/Down arrows = Pitch (tilt forward/back)
            if (event.key === 'ArrowUp') {
                target.rotation.x -= rotationStep;
                event.preventDefault();
            } else if (event.key === 'ArrowDown') {
                target.rotation.x += rotationStep;
                event.preventDefault();
            }
        }

        // Delete selected object
        if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedObject) {
            this.deleteSelected();
        }
    }

    deleteSelected() {
        if (!this.selectedObject) return;

        // Remove from scene
        this.scene.remove(this.selectedObject.object);

        // Remove from array
        const index = this.placedObjects.indexOf(this.selectedObject);
        if (index > -1) {
            this.placedObjects.splice(index, 1);
        }

        this.selectedObject = null;
    }

    // Clear all placed objects
    clearAll() {
        this.placedObjects.forEach(obj => {
            this.scene.remove(obj.object);
        });
        this.placedObjects = [];
        this.clearSelection();
        this.cancelPlacement();
    }

    // Auto-generate a sample resort
    autoGenerate() {
        this.clearAll();

        // Scale for 600x600 terrain
        const scale = 5;

        // Add some ski lifts
        const lift1 = this.skiLift.createLift(
            new THREE.Vector3(-80, this.mountain.getHeightAt(-80, 100), 100),
            new THREE.Vector3(-40, this.mountain.getHeightAt(-40, -100), -100),
            false
        );
        this.placedObjects.push({ type: 'ski-lift', object: lift1 });

        const gondola = this.skiLift.createLift(
            new THREE.Vector3(100, this.mountain.getHeightAt(100, 80), 80),
            new THREE.Vector3(120, this.mountain.getHeightAt(120, -80), -80),
            true
        );
        this.placedObjects.push({ type: 'gondola', object: gondola });

        // Add lodges at base area
        const lodgePositions = [
            { x: 0, z: 150 },
            { x: -100, z: 130 },
            { x: 120, z: 140 }
        ];

        lodgePositions.forEach(pos => {
            const lodge = this.lodge.create();
            lodge.position.set(pos.x, this.mountain.getHeightAt(pos.x, pos.z), pos.z);
            lodge.rotation.y = Math.random() * Math.PI * 2;
            lodge.userData.type = 'lodge';
            lodge.userData.placedObject = true;
            this.scene.add(lodge);
            this.placedObjects.push({ type: 'lodge', object: lodge });
        });

        // Add flags along ski runs
        const flagPositions = [
            { x: -30, z: -80 },
            { x: -15, z: 0 },
            { x: 25, z: 80 },
            { x: 110, z: -30 },
            { x: 90, z: 50 }
        ];

        flagPositions.forEach(pos => {
            const flag = this.decorations.createFlag(Math.random() > 0.5 ? 'red' : 'blue');
            flag.position.set(pos.x, this.mountain.getHeightAt(pos.x, pos.z), pos.z);
            flag.userData.type = 'flag';
            flag.userData.placedObject = true;
            this.scene.add(flag);
            this.placedObjects.push({ type: 'flag', object: flag });
        });

        // Add snowmen near lodges
        const snowmanPositions = [
            { x: 25, z: 140 },
            { x: -120, z: 120 }
        ];

        snowmanPositions.forEach(pos => {
            const snowman = this.decorations.createSnowman();
            snowman.position.set(pos.x, this.mountain.getHeightAt(pos.x, pos.z), pos.z);
            snowman.userData.type = 'snowman';
            snowman.userData.placedObject = true;
            this.scene.add(snowman);
            this.placedObjects.push({ type: 'snowman', object: snowman });
        });

        // Add jump ramps for tricks - placed on slopes for natural runs
        const jumpPositions = [
            { x: -50, z: -40, rot: 0 },
            { x: -20, z: 30, rot: 0.2 },
            { x: 40, z: -20, rot: -0.3 },
            { x: 80, z: 20, rot: 0.1 },
            { x: -70, z: 60, rot: 0.4 },
            { x: 10, z: -60, rot: -0.1 },
            { x: 60, z: 70, rot: 0.2 },
            { x: -30, z: -100, rot: 0 }
        ];

        jumpPositions.forEach(pos => {
            const jump = this.decorations.createJump();
            const height = this.mountain.getHeightAt(pos.x, pos.z);
            jump.position.set(pos.x, height, pos.z);

            // Align jump to face downhill
            const normal = this.mountain.getNormalAt(pos.x, pos.z);
            const downhillAngle = Math.atan2(normal.x, normal.z);
            jump.rotation.y = downhillAngle + pos.rot;

            // Tilt to match slope
            jump.rotation.x = -normal.z * 0.3;
            jump.rotation.z = normal.x * 0.3;

            jump.userData.type = 'jump';
            jump.userData.placedObject = true;
            jump.userData.isJump = true;
            this.scene.add(jump);
            this.placedObjects.push({ type: 'jump', object: jump });
        });
    }

    // Generate a trick park with lots of jumps
    generateTrickPark() {
        this.clearAll();

        console.log('Generating trick park...');

        // Create a series of jumps going down the mountain
        // Place jumps on the actual mountain slopes (centered area)
        const mainRunJumps = [];
        for (let i = 0; i < 10; i++) {
            const z = -150 + i * 35; // Spread from back to front of mountain
            const x = Math.sin(i * 0.6) * 40; // Slight weave
            mainRunJumps.push({ x, z, rot: 0, size: 1.2 + Math.random() * 0.5 });
        }

        // Left run - on left slope
        const leftRunJumps = [];
        for (let i = 0; i < 6; i++) {
            const z = -120 + i * 40;
            const x = -60 - Math.sin(i * 0.5) * 30;
            leftRunJumps.push({ x, z, rot: 0.4, size: 1.0 + Math.random() * 0.4 });
        }

        // Right run - on right slope
        const rightRunJumps = [];
        for (let i = 0; i < 6; i++) {
            const z = -120 + i * 40;
            const x = 60 + Math.sin(i * 0.5) * 30;
            rightRunJumps.push({ x, z, rot: -0.4, size: 1.0 + Math.random() * 0.4 });
        }

        // Big air jumps (larger, on steeper sections)
        const bigAirJumps = [
            { x: 0, z: -100, rot: 0, size: 1.8 },
            { x: -40, z: -50, rot: 0.3, size: 1.6 },
            { x: 40, z: -20, rot: -0.3, size: 1.6 },
            { x: 0, z: 30, rot: 0, size: 1.8 },
        ];

        const allJumps = [...mainRunJumps, ...leftRunJumps, ...rightRunJumps, ...bigAirJumps];
        let placedCount = 0;

        allJumps.forEach(pos => {
            const jump = this.decorations.createJump();
            const height = this.mountain.getHeightAt(pos.x, pos.z);

            // Place jump at terrain height (no minimum height filter)
            jump.position.set(pos.x, height, pos.z);

            // Scale the jump
            jump.scale.setScalar(pos.size || 1);

            // Align jump to face downhill
            const normal = this.mountain.getNormalAt(pos.x, pos.z);
            const downhillAngle = Math.atan2(normal.x, normal.z);
            jump.rotation.y = downhillAngle + (pos.rot || 0);

            // Tilt to match slope
            jump.rotation.x = -normal.z * 0.3;
            jump.rotation.z = normal.x * 0.3;

            jump.userData.type = 'jump';
            jump.userData.placedObject = true;
            jump.userData.isJump = true;
            this.scene.add(jump);
            this.placedObjects.push({ type: 'jump', object: jump });
        });

        // Add some flags to mark the runs
        const flagPositions = [
            { x: 0, z: -130 },
            { x: -80, z: -110 },
            { x: 80, z: -110 },
            { x: 0, z: 120 },
        ];

        flagPositions.forEach(pos => {
            const flag = this.decorations.createFlag('blue');
            flag.position.set(pos.x, this.mountain.getHeightAt(pos.x, pos.z), pos.z);
            flag.userData.type = 'flag';
            flag.userData.placedObject = true;
            this.scene.add(flag);
            this.placedObjects.push({ type: 'flag', object: flag });
        });

        // Add a lodge at the base
        const lodge = this.lodge.create();
        lodge.position.set(0, this.mountain.getHeightAt(0, 160), 160);
        lodge.userData.type = 'lodge';
        lodge.userData.placedObject = true;
        this.scene.add(lodge);
        this.placedObjects.push({ type: 'lodge', object: lodge });
    }

    // Update animated objects
    update(delta) {
        // Update ski lifts (chair movement)
        this.placedObjects.forEach(obj => {
            if (obj.type === 'ski-lift' || obj.type === 'gondola') {
                this.skiLift.update(obj.object, delta);
            }
        });
    }
}
