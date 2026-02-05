/**
 * Trees - Low-poly pine trees with snow
 */

import * as THREE from 'three';

export class Trees {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;
        this.trees = [];
        this.treeGroup = new THREE.Group();
        this.treeGroup.name = 'treeGroup';

        // Shared geometries and materials for instancing
        this.trunkGeometry = null;
        this.foliageGeometry = null;
        this.trunkMaterial = null;
        this.foliageMaterial = null;
        this.snowMaterial = null;
    }

    populate() {
        this.createMaterials();

        // Scatter trees across the entire terrain
        const terrainSize = this.mountain.width;
        const targetTreeCount = 1000; // 50% density
        let attempts = 0;
        const maxAttempts = targetTreeCount * 5;

        while (this.trees.length < targetTreeCount && attempts < maxAttempts) {
            attempts++;

            // Random position across entire terrain
            const x = (Math.random() - 0.5) * terrainSize * 0.98;
            const z = (Math.random() - 0.5) * terrainSize * 0.98;
            const height = this.mountain.getHeightAt(x, z);

            // Place trees at any height (all parts of mountain)
            // Only skip if below terrain level
            if (height < -1) continue;

            // Don't place on very steep slopes (cliffs)
            const slope = this.mountain.getSlopeAt ? this.mountain.getSlopeAt(x, z) : 0;
            if (slope > 0.7) continue;

            // Create tree
            const variant = Math.random();
            let tree;

            if (variant < 0.4) {
                tree = this.createPineTree(0.8 + Math.random() * 0.6);
            } else if (variant < 0.7) {
                tree = this.createTallPine(0.7 + Math.random() * 0.5);
            } else {
                tree = this.createSnowyCone(0.6 + Math.random() * 0.4);
            }

            tree.position.set(x, height, z);
            tree.rotation.y = Math.random() * Math.PI * 2;

            // Slight tilt based on terrain
            const normal = this.mountain.getNormalAt(x, z);
            tree.rotation.x = -normal.z * 0.1;
            tree.rotation.z = normal.x * 0.1;

            tree.castShadow = true;
            this.treeGroup.add(tree);
            this.trees.push(tree);
        }

        console.log(`Trees populated: ${this.trees.length}`);
        this.scene.add(this.treeGroup);
    }

    createMaterials() {
        // Trunk
        this.trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
        this.trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x5d4037,
            roughness: 1.0,
            flatShading: true
        });

        // Foliage (dark green)
        this.foliageMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5a3d,
            roughness: 0.9,
            flatShading: true
        });

        // Snow on trees
        this.snowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            flatShading: true
        });
    }

    populateZone(zone) {
        const { minX, maxX, minZ, maxZ, density } = zone;
        const area = (maxX - minX) * (maxZ - minZ);
        const treeCount = Math.floor(area * density * 0.08);

        for (let i = 0; i < treeCount; i++) {
            const x = minX + Math.random() * (maxX - minX);
            const z = minZ + Math.random() * (maxZ - minZ);
            const height = this.mountain.getHeightAt(x, z);

            // Don't place trees at very low areas (valley floor) or above tree line
            if (height < 1 || height > 65) continue;

            // Don't place on very steep slopes (cliffs)
            const slope = this.mountain.getSlopeAt ? this.mountain.getSlopeAt(x, z) : 0;
            if (slope > 0.7) continue;

            // Random tree variant
            const variant = Math.random();
            let tree;

            if (variant < 0.4) {
                tree = this.createPineTree(0.8 + Math.random() * 0.6);
            } else if (variant < 0.7) {
                tree = this.createTallPine(0.7 + Math.random() * 0.5);
            } else {
                tree = this.createSnowyCone(0.6 + Math.random() * 0.4);
            }

            tree.position.set(x, height, z);
            tree.rotation.y = Math.random() * Math.PI * 2;

            // Slight tilt based on terrain
            const normal = this.mountain.getNormalAt(x, z);
            tree.rotation.x = -normal.z * 0.1;
            tree.rotation.z = normal.x * 0.1;

            tree.castShadow = true;
            this.treeGroup.add(tree);
            this.trees.push(tree);
        }
    }

    createPineTree(scale = 1) {
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        // Trunk
        const trunk = new THREE.Mesh(this.trunkGeometry, this.trunkMaterial);
        trunk.position.y = 0.75 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        // Multiple cone layers for foliage
        const layers = [
            { y: 1.8, radius: 1.2, height: 1.5 },
            { y: 2.8, radius: 0.9, height: 1.3 },
            { y: 3.6, radius: 0.6, height: 1.0 },
            { y: 4.2, radius: 0.3, height: 0.7 }
        ];

        layers.forEach(layer => {
            const coneGeo = new THREE.ConeGeometry(layer.radius, layer.height, 6);
            const cone = new THREE.Mesh(coneGeo, this.foliageMaterial);
            cone.position.y = layer.y * scale;
            cone.scale.setScalar(scale);
            cone.castShadow = true;
            tree.add(cone);

            // Snow cap on each layer
            if (Math.random() > 0.3) {
                const snowGeo = new THREE.ConeGeometry(layer.radius * 0.8, layer.height * 0.3, 6);
                const snow = new THREE.Mesh(snowGeo, this.snowMaterial);
                snow.position.y = (layer.y + layer.height * 0.35) * scale;
                snow.scale.setScalar(scale);
                tree.add(snow);
            }
        });

        return tree;
    }

    createTallPine(scale = 1) {
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        // Taller, thinner trunk
        const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 2, 5);
        const trunk = new THREE.Mesh(trunkGeo, this.trunkMaterial);
        trunk.position.y = 1 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        // Taller, narrower foliage
        const layers = [
            { y: 2.2, radius: 0.8, height: 2 },
            { y: 3.5, radius: 0.6, height: 1.8 },
            { y: 4.6, radius: 0.4, height: 1.4 },
            { y: 5.4, radius: 0.2, height: 1.0 }
        ];

        layers.forEach(layer => {
            const coneGeo = new THREE.ConeGeometry(layer.radius, layer.height, 5);
            const cone = new THREE.Mesh(coneGeo, this.foliageMaterial);
            cone.position.y = layer.y * scale;
            cone.scale.setScalar(scale);
            cone.castShadow = true;
            tree.add(cone);
        });

        // Snow on top
        const topSnow = new THREE.Mesh(
            new THREE.ConeGeometry(0.25, 0.5, 5),
            this.snowMaterial
        );
        topSnow.position.y = 5.9 * scale;
        topSnow.scale.setScalar(scale);
        tree.add(topSnow);

        return tree;
    }

    createSnowyCone(scale = 1) {
        // Simple heavily snow-covered tree (mostly white)
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        // Small trunk
        const trunkGeo = new THREE.CylinderGeometry(0.08, 0.15, 0.8, 5);
        const trunk = new THREE.Mesh(trunkGeo, this.trunkMaterial);
        trunk.position.y = 0.4 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        // Main snow-covered shape
        const mainGeo = new THREE.ConeGeometry(1, 2.5, 6);
        const main = new THREE.Mesh(mainGeo, this.snowMaterial);
        main.position.y = 2 * scale;
        main.scale.setScalar(scale);
        main.castShadow = true;
        tree.add(main);

        // Small green patches showing through
        for (let i = 0; i < 3; i++) {
            const patchGeo = new THREE.ConeGeometry(0.3, 0.5, 4);
            const patch = new THREE.Mesh(patchGeo, this.foliageMaterial);
            const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
            patch.position.x = Math.cos(angle) * 0.4 * scale;
            patch.position.z = Math.sin(angle) * 0.4 * scale;
            patch.position.y = (1.2 + Math.random() * 0.8) * scale;
            patch.scale.setScalar(scale * 0.8);
            tree.add(patch);
        }

        return tree;
    }

    // Create a single tree mesh for placement tool
    createTreeMesh(type = 'pine') {
        switch (type) {
            case 'tall':
                return this.createTallPine(1);
            case 'snowy':
                return this.createSnowyCone(1);
            default:
                return this.createPineTree(1);
        }
    }

    // Add a tree at specific position
    addTree(x, z, type = 'pine') {
        const height = this.mountain.getHeightAt(x, z);
        const tree = this.createTreeMesh(type);

        tree.position.set(x, height, z);
        tree.rotation.y = Math.random() * Math.PI * 2;
        tree.castShadow = true;

        this.treeGroup.add(tree);
        this.trees.push(tree);

        return tree;
    }

    // Remove all trees
    clear() {
        this.trees.forEach(tree => {
            this.treeGroup.remove(tree);
        });
        this.trees = [];
    }
}
