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

    createTower(height = 8) {
        const tower = new THREE.Group();
        tower.name = 'liftTower';

        // Main pole
        const poleGeometry = new THREE.CylinderGeometry(0.18, 0.25, height, 8);
        const pole = new THREE.Mesh(poleGeometry, this.metalMaterial);
        pole.position.y = height / 2;
        pole.castShadow = true;
        tower.add(pole);

        // Cross beam at top - perpendicular to cable direction
        const beamGeometry = new THREE.BoxGeometry(2.5, 0.25, 0.25);
        const beam = new THREE.Mesh(beamGeometry, this.metalMaterial);
        beam.position.y = height;
        beam.castShadow = true;
        tower.add(beam);

        // Cable guide wheels on each side
        [-0.9, 0.9].forEach(x => {
            // Wheel housing
            const housing = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12),
                this.metalMaterial
            );
            housing.position.set(x, height, 0);
            housing.rotation.z = Math.PI / 2;
            tower.add(housing);

            // Inner wheel (visible)
            const wheel = new THREE.Mesh(
                new THREE.TorusGeometry(0.2, 0.05, 8, 16),
                this.cableMaterial
            );
            wheel.position.set(x, height, 0);
            wheel.rotation.y = Math.PI / 2;
            tower.add(wheel);
        });

        // Support struts from pole to beam
        const strutGeometry = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6);
        [[-1, 0], [1, 0]].forEach(([x, z]) => {
            const strut = new THREE.Mesh(strutGeometry, this.metalMaterial);
            strut.position.set(x * 0.6, height - 0.8, z);
            strut.rotation.z = x > 0 ? -0.4 : 0.4;
            strut.castShadow = true;
            tower.add(strut);
        });

        // Base plate
        const baseGeometry = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 8);
        const base = new THREE.Mesh(baseGeometry, this.metalMaterial);
        base.position.y = 0.05;
        tower.add(base);

        tower.userData.placedObject = true;
        return tower;
    }

    createChair() {
        const chair = new THREE.Group();
        chair.name = 'liftChair';

        // The chair is built so that when the group faces along +Z (travel direction),
        // passengers sit facing +X (perpendicular to travel, looking outward)

        // Seat base - width along X (perpendicular to travel), depth along Z (travel direction)
        const seatGeometry = new THREE.BoxGeometry(0.6, 0.15, 1.8);
        const seat = new THREE.Mesh(seatGeometry, this.chairMaterial);
        seat.position.y = -0.5;
        chair.add(seat);

        // Seat back - on the -X side (inner side, away from view)
        const backGeometry = new THREE.BoxGeometry(0.1, 0.8, 1.8);
        const back = new THREE.Mesh(backGeometry, this.chairMaterial);
        back.position.set(-0.25, -0.1, 0);
        chair.add(back);

        // Armrests - at each end along Z
        [-0.85, 0.85].forEach(z => {
            const armGeometry = new THREE.BoxGeometry(0.5, 0.4, 0.1);
            const arm = new THREE.Mesh(armGeometry, this.chairMaterial);
            arm.position.set(0, -0.3, z);
            chair.add(arm);
        });

        // Safety bar - runs along Z (parallel to cable)
        const barGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6);
        const bar = new THREE.Mesh(barGeometry, this.metalMaterial);
        bar.position.set(0.35, -0.1, 0);
        bar.rotation.x = Math.PI / 2;
        chair.add(bar);

        // Hanger (connects to cable) - vertical rod
        const hangerGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6);
        const hanger = new THREE.Mesh(hangerGeometry, this.metalMaterial);
        hanger.position.y = 0.3;
        chair.add(hanger);

        // Cable grip - clamps onto the cable
        const gripGeometry = new THREE.BoxGeometry(0.12, 0.15, 0.25);
        const grip = new THREE.Mesh(gripGeometry, this.metalMaterial);
        grip.position.y = 0.6;
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
        lift.userData.isGondola = isGondola;

        // Calculate lift properties
        const direction = endPoint.clone().sub(startPoint);
        const distance = direction.length();
        const dirNormalized = direction.clone().normalize();

        // Get horizontal perpendicular direction for cable offset (in XZ plane)
        // This keeps cables at consistent horizontal offset regardless of slope
        const horizontalDir = new THREE.Vector3(direction.x, 0, direction.z).normalize();
        const perpendicular = new THREE.Vector3(-horizontalDir.z, 0, horizontalDir.x);
        const cableOffset = isGondola ? 0.9 : 0.9; // Match tower wheel positions at ±0.9

        // Tower heights based on terrain
        const startHeight = 8;
        const endHeight = 8;

        // Create start tower - rotate only around Y axis to face the lift direction
        const startTower = this.createTower(startHeight);
        startTower.position.copy(startPoint);
        const startAngle = Math.atan2(direction.x, direction.z);
        startTower.rotation.y = startAngle;
        lift.add(startTower);

        // Create end tower - face back toward start
        const endTower = this.createTower(endHeight);
        endTower.position.copy(endPoint);
        endTower.rotation.y = startAngle + Math.PI;
        lift.add(endTower);

        // Collect all tower positions and angles for cable routing
        const towerData = [
            { pos: startPoint.clone(), height: startHeight, angle: startAngle }
        ];

        // Add intermediate towers for long lifts
        const numIntermediateTowers = Math.floor(distance / 30);

        for (let i = 1; i <= numIntermediateTowers; i++) {
            const t = i / (numIntermediateTowers + 1);
            const pos = startPoint.clone().lerp(endPoint, t);
            pos.y = this.mountain.getHeightAt(pos.x, pos.z);

            const towerHeight = 6 + Math.random() * 3;
            const tower = this.createTower(towerHeight);
            tower.position.copy(pos);
            tower.rotation.y = startAngle;
            lift.add(tower);

            towerData.push({ pos: pos.clone(), height: towerHeight, angle: startAngle });
        }

        towerData.push({ pos: endPoint.clone(), height: endHeight, angle: startAngle + Math.PI });

        // Create cables that pass through tower wheel positions
        const cablePoints = this.calculateCablePointsThroughTowers(towerData, perpendicular, cableOffset);
        const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
        const cableGeometry = new THREE.TubeGeometry(cableCurve, 64, 0.04, 8, false);
        const cable = new THREE.Mesh(cableGeometry, this.cableMaterial);
        lift.add(cable);

        // Return cable on other side
        const returnCablePoints = this.calculateCablePointsThroughTowers(towerData, perpendicular, -cableOffset);
        const returnCurve = new THREE.CatmullRomCurve3(returnCablePoints);
        const returnCableGeometry = new THREE.TubeGeometry(returnCurve, 64, 0.04, 8, false);
        const returnCable = new THREE.Mesh(returnCableGeometry, this.cableMaterial);
        lift.add(returnCable);

        // Add chairs/gondolas along the cable
        // Gondolas: fewer cabins (larger spacing), ski lifts: more chairs
        const carrierSpacing = isGondola ? 20 : 10;
        const numCarriers = Math.max(4, Math.floor(distance / carrierSpacing));
        const carriers = [];

        // Grip height offset - the grip is above the carrier origin
        const gripHeight = isGondola ? 1.15 : 0.6;

        for (let i = 0; i < numCarriers; i++) {
            const carrier = isGondola ? this.createGondolaCabin() : this.createChair();
            const t = i / numCarriers;

            // Alternate between going up and going down
            const isReturn = i % 2 === 1;

            // Store animation data
            carrier.userData.curvePosition = t;
            carrier.userData.curve = cableCurve;
            carrier.userData.isReturn = isReturn;
            carrier.userData.returnCurve = returnCurve;
            carrier.userData.gripHeight = gripHeight;

            // Initial position - get point on cable, then offset down by grip height
            const curve = isReturn ? returnCurve : cableCurve;
            const actualT = isReturn ? 1 - t : t;
            const cablePoint = curve.getPointAt(Math.max(0.001, Math.min(0.999, actualT)));

            // Position carrier so grip is at cable level
            carrier.position.copy(cablePoint);
            carrier.position.y -= gripHeight;

            // Orient along cable direction
            const tangent = curve.getTangentAt(Math.max(0.001, Math.min(0.999, actualT)));
            if (isReturn) tangent.negate();

            // Calculate Y rotation to face along cable (only rotate around Y to stay upright)
            const angle = Math.atan2(tangent.x, tangent.z);
            carrier.rotation.set(0, angle, 0);

            lift.add(carrier);
            carriers.push(carrier);
        }

        // Store carriers for animation
        // Gondolas move faster than ski lifts
        lift.userData.carriers = carriers;
        lift.userData.speed = isGondola ? 0.025 : 0.015; // Ski lifts at 60% of gondola speed

        this.scene.add(lift);
        return lift;
    }

    // Calculate cable points that properly pass through each tower top
    calculateCablePointsThroughTowers(towerData, perpendicular, offset) {
        const points = [];

        for (let i = 0; i < towerData.length; i++) {
            const tower = towerData[i];
            const towerTop = new THREE.Vector3(
                tower.pos.x + perpendicular.x * offset,
                tower.pos.y + tower.height,
                tower.pos.z + perpendicular.z * offset
            );

            // Add point at tower top
            points.push(towerTop.clone());

            // Add sag points between this tower and next (if not last tower)
            if (i < towerData.length - 1) {
                const nextTower = towerData[i + 1];
                const nextTop = new THREE.Vector3(
                    nextTower.pos.x + perpendicular.x * offset,
                    nextTower.pos.y + nextTower.height,
                    nextTower.pos.z + perpendicular.z * offset
                );

                const segmentDist = towerTop.distanceTo(nextTop);
                const numSagPoints = Math.max(2, Math.floor(segmentDist / 8));

                for (let j = 1; j <= numSagPoints; j++) {
                    const t = j / (numSagPoints + 1);
                    const sagPoint = towerTop.clone().lerp(nextTop, t);

                    // Add catenary sag - maximum in the middle
                    const sagFactor = Math.sin(t * Math.PI);
                    const sagAmount = segmentDist * 0.03 * sagFactor; // 3% sag
                    sagPoint.y -= sagAmount;

                    points.push(sagPoint);
                }
            }
        }

        return points;
    }

    // Legacy method for compatibility
    calculateCablePoints(start, end, startHeight, endHeight, intermediateTowers) {
        const towerData = [{ pos: start.clone(), height: startHeight }];
        intermediateTowers.forEach(t => {
            towerData.push({ pos: t.position.clone(), height: 6 });
        });
        towerData.push({ pos: end.clone(), height: endHeight });

        return this.calculateCablePointsThroughTowers(towerData, new THREE.Vector3(0, 0, 1), 0);
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
                const clampedT = Math.max(0.001, Math.min(0.999, actualT));

                // Get cable point and position carrier below it
                const cablePoint = curve.getPointAt(clampedT);
                const gripHeight = carrier.userData.gripHeight || 0.6;

                carrier.position.copy(cablePoint);
                carrier.position.y -= gripHeight;

                // Orient along cable direction (Y-rotation only to stay upright)
                const tangent = curve.getTangentAt(clampedT);
                if (carrier.userData.isReturn) tangent.negate();

                const angle = Math.atan2(tangent.x, tangent.z);
                carrier.rotation.set(0, angle, 0);
            }
        });
    }
}
