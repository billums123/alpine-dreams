/**
 * Decorations - Ski resort decorative objects (flags, snowmen, trees, etc.)
 */

import * as THREE from 'three';

export class Decorations {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        // Common materials
        this.woodMaterial = new THREE.MeshStandardMaterial({
            color: 0x5d4037,
            roughness: 0.9,
            flatShading: true
        });

        this.snowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            flatShading: true
        });

        this.foliageMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5a3d,
            roughness: 0.9,
            flatShading: true
        });
    }

    createFlag(color = 'red') {
        const flag = new THREE.Group();
        flag.name = 'markerFlag';

        // Pole
        const poleGeometry = new THREE.CylinderGeometry(0.05, 0.07, 2.5, 6);
        const pole = new THREE.Mesh(poleGeometry, this.woodMaterial);
        pole.position.y = 1.25;
        pole.castShadow = true;
        flag.add(pole);

        // Flag fabric
        const flagColors = {
            red: 0xe53935,
            blue: 0x1e88e5,
            green: 0x43a047,
            orange: 0xfb8c00,
            yellow: 0xfdd835
        };

        const flagMaterial = new THREE.MeshStandardMaterial({
            color: flagColors[color] || flagColors.red,
            roughness: 0.7,
            side: THREE.DoubleSide,
            flatShading: true
        });

        // Simple triangular flag
        const flagShape = new THREE.Shape();
        flagShape.moveTo(0, 0);
        flagShape.lineTo(0.8, 0.25);
        flagShape.lineTo(0, 0.5);
        flagShape.lineTo(0, 0);

        const flagGeometry = new THREE.ShapeGeometry(flagShape);
        const flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
        flagMesh.position.set(0.05, 2.1, 0);
        flagMesh.rotation.y = -Math.PI / 2;
        flag.add(flagMesh);

        // Snow on top of pole
        const snowCap = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 6, 4),
            this.snowMaterial
        );
        snowCap.position.y = 2.55;
        snowCap.scale.y = 0.5;
        flag.add(snowCap);

        flag.userData.placedObject = true;
        return flag;
    }

    createSnowman() {
        const snowman = new THREE.Group();
        snowman.name = 'snowman';

        // Bottom ball
        const bottomGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const bottom = new THREE.Mesh(bottomGeometry, this.snowMaterial);
        bottom.position.y = 0.6;
        bottom.castShadow = true;
        snowman.add(bottom);

        // Middle ball
        const middleGeometry = new THREE.SphereGeometry(0.45, 8, 6);
        const middle = new THREE.Mesh(middleGeometry, this.snowMaterial);
        middle.position.y = 1.4;
        middle.castShadow = true;
        snowman.add(middle);

        // Head
        const headGeometry = new THREE.SphereGeometry(0.35, 8, 6);
        const head = new THREE.Mesh(headGeometry, this.snowMaterial);
        head.position.y = 2.1;
        head.castShadow = true;
        snowman.add(head);

        // Eyes (coal)
        const eyeMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.5
        });

        [-0.12, 0.12].forEach(x => {
            const eyeGeometry = new THREE.SphereGeometry(0.05, 6, 4);
            const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
            eye.position.set(x, 2.2, 0.3);
            snowman.add(eye);
        });

        // Carrot nose
        const noseGeometry = new THREE.ConeGeometry(0.05, 0.3, 6);
        const noseMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6f00,
            roughness: 0.7,
            flatShading: true
        });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0, 2.1, 0.38);
        nose.rotation.x = -Math.PI / 2;
        snowman.add(nose);

        // Buttons
        [1.2, 1.4, 1.6].forEach(y => {
            const buttonGeometry = new THREE.SphereGeometry(0.06, 6, 4);
            const button = new THREE.Mesh(buttonGeometry, eyeMaterial);
            button.position.set(0, y, 0.42);
            snowman.add(button);
        });

        // Stick arms
        const armMaterial = new THREE.MeshStandardMaterial({
            color: 0x5d4037,
            roughness: 0.9
        });

        [-1, 1].forEach(side => {
            const armGeometry = new THREE.CylinderGeometry(0.03, 0.02, 0.8, 5);
            const arm = new THREE.Mesh(armGeometry, armMaterial);
            arm.position.set(side * 0.6, 1.5, 0);
            arm.rotation.z = side * 1.2;
            snowman.add(arm);

            // Twig fingers
            const twigGeometry = new THREE.CylinderGeometry(0.015, 0.01, 0.2, 4);
            const twig = new THREE.Mesh(twigGeometry, armMaterial);
            twig.position.set(side * 0.9, 1.7, 0);
            twig.rotation.z = side * 0.8;
            snowman.add(twig);
        });

        // Top hat
        const hatBrimGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 8);
        const hatMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.6
        });
        const hatBrim = new THREE.Mesh(hatBrimGeometry, hatMaterial);
        hatBrim.position.y = 2.45;
        snowman.add(hatBrim);

        const hatTopGeometry = new THREE.CylinderGeometry(0.2, 0.22, 0.35, 8);
        const hatTop = new THREE.Mesh(hatTopGeometry, hatMaterial);
        hatTop.position.y = 2.65;
        snowman.add(hatTop);

        // Snow on hat
        const hatSnow = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.2, 0.1, 6),
            this.snowMaterial
        );
        hatSnow.position.y = 2.85;
        snowman.add(hatSnow);

        // Scarf
        const scarfMaterial = new THREE.MeshStandardMaterial({
            color: 0xe53935,
            roughness: 0.8,
            flatShading: true
        });

        const scarfGeometry = new THREE.TorusGeometry(0.38, 0.08, 6, 12);
        const scarf = new THREE.Mesh(scarfGeometry, scarfMaterial);
        scarf.position.y = 1.78;
        scarf.rotation.x = Math.PI / 2;
        snowman.add(scarf);

        // Scarf tail
        const scarfTailGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.08);
        const scarfTail = new THREE.Mesh(scarfTailGeometry, scarfMaterial);
        scarfTail.position.set(0.35, 1.6, 0.1);
        scarfTail.rotation.z = -0.3;
        snowman.add(scarfTail);

        snowman.userData.placedObject = true;
        return snowman;
    }

    createTree(variant = 'default') {
        const tree = new THREE.Group();
        tree.name = 'pineTree';

        // Trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
        const trunk = new THREE.Mesh(trunkGeometry, this.woodMaterial);
        trunk.position.y = 0.75;
        trunk.castShadow = true;
        tree.add(trunk);

        // Foliage layers
        const layers = [
            { y: 1.8, radius: 1.2, height: 1.5 },
            { y: 2.8, radius: 0.9, height: 1.3 },
            { y: 3.6, radius: 0.6, height: 1.0 },
            { y: 4.2, radius: 0.3, height: 0.7 }
        ];

        layers.forEach(layer => {
            const coneGeo = new THREE.ConeGeometry(layer.radius, layer.height, 6);
            const cone = new THREE.Mesh(coneGeo, this.foliageMaterial);
            cone.position.y = layer.y;
            cone.castShadow = true;
            tree.add(cone);

            // Snow on branches
            if (Math.random() > 0.3) {
                const snowGeo = new THREE.ConeGeometry(layer.radius * 0.8, layer.height * 0.3, 6);
                const snow = new THREE.Mesh(snowGeo, this.snowMaterial);
                snow.position.y = layer.y + layer.height * 0.35;
                tree.add(snow);
            }
        });

        tree.userData.placedObject = true;
        return tree;
    }

    createBench() {
        const bench = new THREE.Group();
        bench.name = 'bench';

        // Seat
        const seatGeometry = new THREE.BoxGeometry(1.5, 0.1, 0.5);
        const seat = new THREE.Mesh(seatGeometry, this.woodMaterial);
        seat.position.y = 0.5;
        seat.castShadow = true;
        bench.add(seat);

        // Backrest
        const backGeometry = new THREE.BoxGeometry(1.5, 0.6, 0.1);
        const back = new THREE.Mesh(backGeometry, this.woodMaterial);
        back.position.set(0, 0.8, -0.2);
        back.rotation.x = -0.1;
        bench.add(back);

        // Legs
        [[-0.6, 0], [0.6, 0]].forEach(([x, z]) => {
            const legGeometry = new THREE.BoxGeometry(0.1, 0.5, 0.4);
            const leg = new THREE.Mesh(legGeometry, this.woodMaterial);
            leg.position.set(x, 0.25, z);
            bench.add(leg);
        });

        // Snow on bench
        const snowGeometry = new THREE.BoxGeometry(1.4, 0.15, 0.45);
        const snow = new THREE.Mesh(snowGeometry, this.snowMaterial);
        snow.position.y = 0.62;
        bench.add(snow);

        bench.userData.placedObject = true;
        return bench;
    }

    createSkiRack() {
        const rack = new THREE.Group();
        rack.name = 'skiRack';

        // Base frame
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x607d8b,
            roughness: 0.4,
            metalness: 0.5,
            flatShading: true
        });

        // Vertical posts
        [-0.8, 0.8].forEach(x => {
            const postGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
            const post = new THREE.Mesh(postGeometry, frameMaterial);
            post.position.set(x, 0.75, 0);
            rack.add(post);
        });

        // Horizontal bars
        [0.3, 0.9].forEach(y => {
            const barGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6);
            const bar = new THREE.Mesh(barGeometry, frameMaterial);
            bar.position.y = y;
            bar.rotation.z = Math.PI / 2;
            rack.add(bar);
        });

        // Add some skis
        const skiMaterial = new THREE.MeshStandardMaterial({
            color: 0x1565c0,
            roughness: 0.3,
            flatShading: true
        });

        for (let i = 0; i < 4; i++) {
            const skiGeometry = new THREE.BoxGeometry(0.08, 1.8, 0.02);
            const ski = new THREE.Mesh(skiGeometry, skiMaterial);
            ski.position.set(-0.5 + i * 0.35, 0.5, 0.05);
            ski.rotation.z = 0.1 - Math.random() * 0.05;
            rack.add(ski);
        }

        rack.userData.placedObject = true;
        return rack;
    }

    createSnowPile() {
        const pile = new THREE.Group();
        pile.name = 'snowPile';

        // Main pile
        const mainGeometry = new THREE.SphereGeometry(1.5, 8, 6);
        const main = new THREE.Mesh(mainGeometry, this.snowMaterial);
        main.position.y = 0.5;
        main.scale.y = 0.5;
        main.castShadow = true;
        pile.add(main);

        // Smaller mounds
        [[-0.8, 0.3], [0.7, 0.4], [0.2, -0.6]].forEach(([x, z]) => {
            const moundGeometry = new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 6, 5);
            const mound = new THREE.Mesh(moundGeometry, this.snowMaterial);
            mound.position.set(x, 0.2, z);
            mound.scale.y = 0.5;
            pile.add(mound);
        });

        pile.userData.placedObject = true;
        return pile;
    }
}
