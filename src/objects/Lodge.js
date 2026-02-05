/**
 * Lodge - Cozy ski lodge buildings
 */

import * as THREE from 'three';

export class Lodge {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        // Materials
        this.woodMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b5a2b,
            roughness: 0.9,
            flatShading: true
        });

        this.roofMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a3728,
            roughness: 0.8,
            flatShading: true
        });

        this.snowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.7,
            flatShading: true
        });

        this.windowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffd54f,
            emissive: 0xffa000,
            emissiveIntensity: 0.3,
            roughness: 0.3
        });

        this.stoneMaterial = new THREE.MeshStandardMaterial({
            color: 0x6b6b6b,
            roughness: 0.95,
            flatShading: true
        });
    }

    create(type = 'main') {
        switch (type) {
            case 'small':
                return this.createSmallCabin();
            case 'large':
                return this.createLargeLodge();
            default:
                return this.createMainLodge();
        }
    }

    createMainLodge() {
        const lodge = new THREE.Group();
        lodge.name = 'lodge';

        // Main building body
        const bodyGeometry = new THREE.BoxGeometry(6, 3, 5);
        const body = new THREE.Mesh(bodyGeometry, this.woodMaterial);
        body.position.y = 1.5;
        body.castShadow = true;
        body.receiveShadow = true;
        lodge.add(body);

        // A-frame roof using two angled box planes
        const roofWidth = 3.8;
        const roofLength = 5.8;
        const roofThickness = 0.15;
        const roofAngle = Math.atan2(2.5, 3.5); // angle of roof slope

        // Left roof panel
        const roofPanelGeo = new THREE.BoxGeometry(roofWidth, roofThickness, roofLength);
        const leftRoof = new THREE.Mesh(roofPanelGeo, this.roofMaterial);
        leftRoof.position.set(-1.7, 4.2, 0);
        leftRoof.rotation.z = roofAngle;
        leftRoof.castShadow = true;
        lodge.add(leftRoof);

        // Right roof panel
        const rightRoof = new THREE.Mesh(roofPanelGeo, this.roofMaterial);
        rightRoof.position.set(1.7, 4.2, 0);
        rightRoof.rotation.z = -roofAngle;
        rightRoof.castShadow = true;
        lodge.add(rightRoof);

        // Front gable (triangular wall piece)
        const gableShape = new THREE.Shape();
        gableShape.moveTo(-3, 0);
        gableShape.lineTo(0, 2.5);
        gableShape.lineTo(3, 0);
        gableShape.closePath();

        const gableGeo = new THREE.ShapeGeometry(gableShape);
        const frontGable = new THREE.Mesh(gableGeo, this.woodMaterial);
        frontGable.position.set(0, 3, 2.51);
        lodge.add(frontGable);

        const backGable = new THREE.Mesh(gableGeo, this.woodMaterial);
        backGable.position.set(0, 3, -2.51);
        backGable.rotation.y = Math.PI;
        lodge.add(backGable);

        // Snow on roof
        const snowPanelGeo = new THREE.BoxGeometry(roofWidth - 0.2, 0.12, roofLength - 0.2);
        const leftSnow = new THREE.Mesh(snowPanelGeo, this.snowMaterial);
        leftSnow.position.set(-1.65, 4.35, 0);
        leftSnow.rotation.z = roofAngle;
        lodge.add(leftSnow);

        const rightSnow = new THREE.Mesh(snowPanelGeo, this.snowMaterial);
        rightSnow.position.set(1.65, 4.35, 0);
        rightSnow.rotation.z = -roofAngle;
        lodge.add(rightSnow);

        // Windows (front)
        const windowPositions = [
            { x: -1.5, y: 1.8, z: 2.51 },
            { x: 1.5, y: 1.8, z: 2.51 }
        ];

        windowPositions.forEach(pos => {
            const windowGeometry = new THREE.PlaneGeometry(1, 1.2);
            const window = new THREE.Mesh(windowGeometry, this.windowMaterial);
            window.position.set(pos.x, pos.y, pos.z);
            lodge.add(window);

            // Window frame
            const frameGeometry = new THREE.BoxGeometry(1.15, 1.35, 0.1);
            const frame = new THREE.Mesh(frameGeometry, this.woodMaterial);
            frame.position.set(pos.x, pos.y, pos.z + 0.02);
            lodge.add(frame);
        });

        // Door
        const doorGeometry = new THREE.BoxGeometry(1.2, 2, 0.1);
        const door = new THREE.Mesh(doorGeometry, this.roofMaterial);
        door.position.set(0, 1, 2.52);
        lodge.add(door);

        // Chimney
        const chimneyGeometry = new THREE.BoxGeometry(0.8, 2, 0.8);
        const chimney = new THREE.Mesh(chimneyGeometry, this.stoneMaterial);
        chimney.position.set(2, 4.5, 0);
        chimney.castShadow = true;
        lodge.add(chimney);

        // Snow on chimney top
        const chimneySnow = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.2, 0.9),
            this.snowMaterial
        );
        chimneySnow.position.set(2, 5.6, 0);
        lodge.add(chimneySnow);

        // Deck/porch
        const deckGeometry = new THREE.BoxGeometry(4, 0.2, 1.5);
        const deck = new THREE.Mesh(deckGeometry, this.woodMaterial);
        deck.position.set(0, 0.1, 3.25);
        deck.receiveShadow = true;
        lodge.add(deck);

        // Deck railing
        const railGeometry = new THREE.BoxGeometry(4, 0.8, 0.1);
        const rail = new THREE.Mesh(railGeometry, this.woodMaterial);
        rail.position.set(0, 0.5, 4);
        lodge.add(rail);

        // Porch posts
        [[-1.8, 3.9], [1.8, 3.9]].forEach(([x, z]) => {
            const postGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 6);
            const post = new THREE.Mesh(postGeometry, this.woodMaterial);
            post.position.set(x, 0.75, z);
            lodge.add(post);
        });

        lodge.userData.placedObject = true;
        return lodge;
    }

    createSmallCabin() {
        const cabin = new THREE.Group();
        cabin.name = 'smallCabin';

        // Body
        const bodyGeometry = new THREE.BoxGeometry(3, 2.5, 3);
        const body = new THREE.Mesh(bodyGeometry, this.woodMaterial);
        body.position.y = 1.25;
        body.castShadow = true;
        body.receiveShadow = true;
        cabin.add(body);

        // Simple peaked roof
        const roofGeometry = new THREE.ConeGeometry(2.5, 2, 4);
        const roof = new THREE.Mesh(roofGeometry, this.roofMaterial);
        roof.position.y = 3.5;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        cabin.add(roof);

        // Snow on roof
        const snowGeometry = new THREE.ConeGeometry(2.3, 0.5, 4);
        const snow = new THREE.Mesh(snowGeometry, this.snowMaterial);
        snow.position.y = 4.3;
        snow.rotation.y = Math.PI / 4;
        cabin.add(snow);

        // Window
        const windowGeometry = new THREE.PlaneGeometry(0.8, 0.8);
        const window = new THREE.Mesh(windowGeometry, this.windowMaterial);
        window.position.set(0, 1.5, 1.51);
        cabin.add(window);

        // Door
        const doorGeometry = new THREE.BoxGeometry(0.8, 1.6, 0.1);
        const door = new THREE.Mesh(doorGeometry, this.roofMaterial);
        door.position.set(0, 0.8, 1.52);
        cabin.add(door);

        cabin.userData.placedObject = true;
        return cabin;
    }

    createLargeLodge() {
        const lodge = new THREE.Group();
        lodge.name = 'largeLodge';

        // Main section
        const mainBody = new THREE.BoxGeometry(10, 4, 7);
        const main = new THREE.Mesh(mainBody, this.woodMaterial);
        main.position.y = 2;
        main.castShadow = true;
        main.receiveShadow = true;
        lodge.add(main);

        // A-frame roof using two angled box panels
        const largeRoofWidth = 6.5;
        const largeRoofLength = 7.8;
        const largeRoofThickness = 0.18;
        const largeRoofAngle = Math.atan2(3.5, 5.5);

        // Left roof panel
        const largeRoofPanelGeo = new THREE.BoxGeometry(largeRoofWidth, largeRoofThickness, largeRoofLength);
        const leftLargeRoof = new THREE.Mesh(largeRoofPanelGeo, this.roofMaterial);
        leftLargeRoof.position.set(-2.8, 5.6, 0);
        leftLargeRoof.rotation.z = largeRoofAngle;
        leftLargeRoof.castShadow = true;
        lodge.add(leftLargeRoof);

        // Right roof panel
        const rightLargeRoof = new THREE.Mesh(largeRoofPanelGeo, this.roofMaterial);
        rightLargeRoof.position.set(2.8, 5.6, 0);
        rightLargeRoof.rotation.z = -largeRoofAngle;
        rightLargeRoof.castShadow = true;
        lodge.add(rightLargeRoof);

        // Front gable (triangular wall piece)
        const largeGableShape = new THREE.Shape();
        largeGableShape.moveTo(-5, 0);
        largeGableShape.lineTo(0, 3.5);
        largeGableShape.lineTo(5, 0);
        largeGableShape.closePath();

        const largeGableGeo = new THREE.ShapeGeometry(largeGableShape);
        const frontLargeGable = new THREE.Mesh(largeGableGeo, this.woodMaterial);
        frontLargeGable.position.set(0, 4, 3.51);
        lodge.add(frontLargeGable);

        const backLargeGable = new THREE.Mesh(largeGableGeo, this.woodMaterial);
        backLargeGable.position.set(0, 4, -3.51);
        backLargeGable.rotation.y = Math.PI;
        lodge.add(backLargeGable);

        // Snow on roof
        const largeSnowPanelGeo = new THREE.BoxGeometry(largeRoofWidth - 0.3, 0.15, largeRoofLength - 0.3);
        const leftLargeSnow = new THREE.Mesh(largeSnowPanelGeo, this.snowMaterial);
        leftLargeSnow.position.set(-2.75, 5.75, 0);
        leftLargeSnow.rotation.z = largeRoofAngle;
        lodge.add(leftLargeSnow);

        const rightLargeSnow = new THREE.Mesh(largeSnowPanelGeo, this.snowMaterial);
        rightLargeSnow.position.set(2.75, 5.75, 0);
        rightLargeSnow.rotation.z = -largeRoofAngle;
        lodge.add(rightLargeSnow);

        // Large windows
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue; // Door space
            const windowGeometry = new THREE.PlaneGeometry(1.2, 1.8);
            const window = new THREE.Mesh(windowGeometry, this.windowMaterial);
            window.position.set(i * 1.8, 2.2, 3.51);
            lodge.add(window);
        }

        // Large door
        const doorGeometry = new THREE.BoxGeometry(1.8, 2.8, 0.1);
        const door = new THREE.Mesh(doorGeometry, this.roofMaterial);
        door.position.set(0, 1.4, 3.52);
        lodge.add(door);

        // Stone chimney
        const chimneyGeometry = new THREE.BoxGeometry(1.2, 4, 1.2);
        const chimney = new THREE.Mesh(chimneyGeometry, this.stoneMaterial);
        chimney.position.set(3.5, 5.5, 0);
        chimney.castShadow = true;
        lodge.add(chimney);

        // Second chimney
        const chimney2 = new THREE.Mesh(chimneyGeometry, this.stoneMaterial);
        chimney2.position.set(-3.5, 5.5, 0);
        chimney2.castShadow = true;
        lodge.add(chimney2);

        // Balcony
        const balconyGeometry = new THREE.BoxGeometry(6, 0.15, 2);
        const balcony = new THREE.Mesh(balconyGeometry, this.woodMaterial);
        balcony.position.set(0, 3.5, 4.5);
        balcony.receiveShadow = true;
        lodge.add(balcony);

        // Balcony railing
        const railGeometry = new THREE.BoxGeometry(6, 1, 0.1);
        const rail = new THREE.Mesh(railGeometry, this.woodMaterial);
        rail.position.set(0, 4, 5.4);
        lodge.add(rail);

        lodge.userData.placedObject = true;
        return lodge;
    }
}
