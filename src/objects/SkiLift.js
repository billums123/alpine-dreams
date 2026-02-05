/**
 * SkiLift - Ski lift and gondola creation with animated chairs
 */

import * as THREE from 'three';

export class SkiLift {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        // Materials
        this.metalMaterial = new THREE.MeshStandardMaterial({
            color: 0x607d8b,
            roughness: 0.4,
            metalness: 0.6,
            flatShading: true
        });

        this.cableMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.8,
            metalness: 0.3
        });

        this.chairMaterial = new THREE.MeshStandardMaterial({
            color: 0x1565c0,
            roughness: 0.7,
            flatShading: true
        });

        this.gondolaMaterial = new THREE.MeshStandardMaterial({
            color: 0xe53935,
            roughness: 0.5,
            flatShading: true
        });
    }

    createTower(height = 6) {
        const tower = new THREE.Group();
        tower.name = 'liftTower';

        // Main pole
        const poleGeometry = new THREE.CylinderGeometry(0.15, 0.2, height, 6);
        const pole = new THREE.Mesh(poleGeometry, this.metalMaterial);
        pole.position.y = height / 2;
        pole.castShadow = true;
        tower.add(pole);

        // Cross beam at top
        const beamGeometry = new THREE.BoxGeometry(2, 0.2, 0.2);
        const beam = new THREE.Mesh(beamGeometry, this.metalMaterial);
        beam.position.y = height - 0.1;
        beam.castShadow = true;
        tower.add(beam);

        // Wheel housings
        [-0.7, 0.7].forEach(x => {
            const housing = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.25, 0.3, 8),
                this.metalMaterial
            );
            housing.position.set(x, height - 0.1, 0);
            housing.rotation.x = Math.PI / 2;
            tower.add(housing);
        });

        // Support struts
        const strutGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2, 4);
        [[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]].forEach(([x, z]) => {
            const strut = new THREE.Mesh(strutGeometry, this.metalMaterial);
            strut.position.set(x * 0.5, height / 2, z * 0.3);
            strut.rotation.z = x > 0 ? -0.3 : 0.3;
            strut.castShadow = true;
            tower.add(strut);
        });

        tower.userData.placedObject = true;
        return tower;
    }

    createChair() {
        const chair = new THREE.Group();
        chair.name = 'liftChair';

        // Seat base
        const seatGeometry = new THREE.BoxGeometry(1.8, 0.15, 0.6);
        const seat = new THREE.Mesh(seatGeometry, this.chairMaterial);
        seat.position.y = -0.5;
        chair.add(seat);

        // Seat back
        const backGeometry = new THREE.BoxGeometry(1.8, 0.8, 0.1);
        const back = new THREE.Mesh(backGeometry, this.chairMaterial);
        back.position.set(0, -0.1, -0.25);
        chair.add(back);

        // Armrests
        [-0.85, 0.85].forEach(x => {
            const armGeometry = new THREE.BoxGeometry(0.1, 0.4, 0.5);
            const arm = new THREE.Mesh(armGeometry, this.chairMaterial);
            arm.position.set(x, -0.3, 0);
            chair.add(arm);
        });

        // Safety bar
        const barGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6);
        const bar = new THREE.Mesh(barGeometry, this.metalMaterial);
        bar.position.set(0, -0.1, 0.35);
        bar.rotation.z = Math.PI / 2;
        chair.add(bar);

        // Hanger (connects to cable)
        const hangerGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
        const hanger = new THREE.Mesh(hangerGeometry, this.metalMaterial);
        hanger.position.y = 0.4;
        chair.add(hanger);

        // Cable grip
        const gripGeometry = new THREE.BoxGeometry(0.15, 0.1, 0.15);
        const grip = new THREE.Mesh(gripGeometry, this.metalMaterial);
        grip.position.y = 0.8;
        chair.add(grip);

        chair.castShadow = true;
        return chair;
    }

    createGondolaCabin() {
        const gondola = new THREE.Group();
        gondola.name = 'gondolaCabin';

        // Main cabin body
        const bodyGeometry = new THREE.BoxGeometry(1.2, 1.5, 1.8);
        const body = new THREE.Mesh(bodyGeometry, this.gondolaMaterial);
        body.position.y = -0.75;
        gondola.add(body);

        // Roof (slightly larger)
        const roofGeometry = new THREE.BoxGeometry(1.3, 0.15, 1.9);
        const roof = new THREE.Mesh(roofGeometry, this.metalMaterial);
        roof.position.y = 0.1;
        gondola.add(roof);

        // Windows (dark)
        const windowMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a237e,
            roughness: 0.2,
            metalness: 0.5
        });

        // Side windows
        [0.61, -0.61].forEach(x => {
            const windowGeometry = new THREE.PlaneGeometry(0.01, 0.6, 1.4);
            const window = new THREE.Mesh(windowGeometry, windowMaterial);
            window.position.set(x, -0.6, 0);
            window.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
            gondola.add(window);
        });

        // Front/back windows
        [0.91, -0.91].forEach(z => {
            const windowGeometry = new THREE.PlaneGeometry(0.8, 0.6);
            const window = new THREE.Mesh(windowGeometry, windowMaterial);
            window.position.set(0, -0.6, z);
            window.rotation.y = z > 0 ? 0 : Math.PI;
            gondola.add(window);
        });

        // Hanger arm
        const hangerGeometry = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
        const hanger = new THREE.Mesh(hangerGeometry, this.metalMaterial);
        hanger.position.y = 0.6;
        gondola.add(hanger);

        // Cable grip
        const gripGeometry = new THREE.BoxGeometry(0.2, 0.15, 0.2);
        const grip = new THREE.Mesh(gripGeometry, this.metalMaterial);
        grip.position.y = 1.15;
        gondola.add(grip);

        gondola.castShadow = true;
        return gondola;
    }

    createLift(startPoint, endPoint, isGondola = false) {
        const lift = new THREE.Group();
        lift.name = isGondola ? 'gondola' : 'skiLift';
        lift.userData.placedObject = true;

        // Calculate lift properties
        const direction = endPoint.clone().sub(startPoint);
        const distance = direction.length();
        const midPoint = startPoint.clone().add(direction.clone().multiplyScalar(0.5));

        // Tower heights based on terrain
        const startHeight = 6;
        const endHeight = 6;

        // Create start tower
        const startTower = this.createTower(startHeight);
        startTower.position.copy(startPoint);
        startTower.lookAt(endPoint);
        lift.add(startTower);

        // Create end tower
        const endTower = this.createTower(endHeight);
        endTower.position.copy(endPoint);
        endTower.lookAt(startPoint);
        lift.add(endTower);

        // Add intermediate towers for long lifts
        const numIntermediateTowers = Math.floor(distance / 25);
        const intermediateTowers = [];

        for (let i = 1; i <= numIntermediateTowers; i++) {
            const t = i / (numIntermediateTowers + 1);
            const pos = startPoint.clone().lerp(endPoint, t);
            pos.y = this.mountain.getHeightAt(pos.x, pos.z);

            const tower = this.createTower(5 + Math.random() * 2);
            tower.position.copy(pos);
            tower.lookAt(endPoint);
            lift.add(tower);
            intermediateTowers.push(tower);
        }

        // Create cable
        const cablePoints = this.calculateCablePoints(startPoint, endPoint, startHeight, endHeight, intermediateTowers);
        const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
        const cableGeometry = new THREE.TubeGeometry(cableCurve, 50, 0.03, 6, false);
        const cable = new THREE.Mesh(cableGeometry, this.cableMaterial);
        lift.add(cable);

        // Second cable (return line)
        const returnCablePoints = cablePoints.map(p => p.clone().add(new THREE.Vector3(0, 0, 0.5)));
        const returnCurve = new THREE.CatmullRomCurve3(returnCablePoints);
        const returnCableGeometry = new THREE.TubeGeometry(returnCurve, 50, 0.03, 6, false);
        const returnCable = new THREE.Mesh(returnCableGeometry, this.cableMaterial);
        lift.add(returnCable);

        // Add chairs/gondolas along the cable
        const numCarriers = Math.floor(distance / 8);
        const carriers = [];

        for (let i = 0; i < numCarriers; i++) {
            const carrier = isGondola ? this.createGondolaCabin() : this.createChair();
            const t = i / numCarriers;

            // Store animation data
            carrier.userData.curvePosition = t;
            carrier.userData.curve = cableCurve;
            carrier.userData.isReturn = i % 2 === 1;
            carrier.userData.returnCurve = returnCurve;

            // Initial position
            const point = carrier.userData.isReturn
                ? returnCurve.getPointAt(1 - t)
                : cableCurve.getPointAt(t);
            carrier.position.copy(point);

            // Orient along cable
            const tangent = carrier.userData.isReturn
                ? returnCurve.getTangentAt(1 - t)
                : cableCurve.getTangentAt(t);
            carrier.lookAt(carrier.position.clone().add(tangent));

            lift.add(carrier);
            carriers.push(carrier);
        }

        // Store carriers for animation
        lift.userData.carriers = carriers;
        lift.userData.speed = 0.02;

        this.scene.add(lift);
        return lift;
    }

    calculateCablePoints(start, end, startHeight, endHeight, intermediateTowers) {
        const points = [];

        // Start point (top of tower)
        points.push(new THREE.Vector3(start.x, start.y + startHeight, start.z));

        // Intermediate points with sag
        const numSegments = 10 + intermediateTowers.length * 5;
        for (let i = 1; i < numSegments; i++) {
            const t = i / numSegments;
            const x = start.x + (end.x - start.x) * t;
            const z = start.z + (end.z - start.z) * t;
            const baseY = start.y + startHeight + (end.y + endHeight - start.y - startHeight) * t;

            // Add slight sag (catenary approximation)
            const sagAmount = Math.sin(t * Math.PI) * 1.5;
            const y = baseY - sagAmount;

            // Check against intermediate towers
            intermediateTowers.forEach(tower => {
                const dist = Math.sqrt(
                    Math.pow(x - tower.position.x, 2) +
                    Math.pow(z - tower.position.z, 2)
                );
                if (dist < 3) {
                    // Near a tower, raise the cable
                    const towerTop = tower.position.y + 5;
                    if (y < towerTop) {
                        // Smoothly raise to tower height
                    }
                }
            });

            points.push(new THREE.Vector3(x, y, z));
        }

        // End point
        points.push(new THREE.Vector3(end.x, end.y + endHeight, end.z));

        return points;
    }

    // Animate lift carriers
    update(liftGroup, delta) {
        if (!liftGroup.userData.carriers) return;

        const speed = liftGroup.userData.speed * delta;

        liftGroup.userData.carriers.forEach(carrier => {
            // Update position along curve
            carrier.userData.curvePosition += speed;
            if (carrier.userData.curvePosition > 1) {
                carrier.userData.curvePosition -= 1;
            }

            const t = carrier.userData.curvePosition;
            const curve = carrier.userData.isReturn
                ? carrier.userData.returnCurve
                : carrier.userData.curve;

            if (curve) {
                const actualT = carrier.userData.isReturn ? 1 - t : t;
                const point = curve.getPointAt(actualT);
                carrier.position.copy(point);

                // Orient along curve
                const tangent = curve.getTangentAt(actualT);
                if (carrier.userData.isReturn) tangent.negate();
                carrier.lookAt(carrier.position.clone().add(tangent));

                // Keep chairs level (rotate to be upright)
                carrier.rotation.z = 0;
                carrier.rotation.x *= 0.5; // Reduce tilt
            }
        });
    }
}
