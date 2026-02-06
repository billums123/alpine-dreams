/**
 * Trees - Instanced low-poly pine trees with snow (InstancedMesh for performance)
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class Trees {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;
        this.treeGroup = new THREE.Group();
        this.treeGroup.name = 'treeGroup';

        // Instanced meshes (one per variant)
        this.instancedMeshes = [];

        // Tree data for collision detection and knockdown
        this.treeData = [];

        // Materials
        this.instancedMaterial = null;

        // Materials for manually placed trees (ObjectPlacer)
        this.trunkMaterial = null;
        this.foliageMaterial = null;
        this.snowMaterial = null;
    }

    populate() {
        this.createMaterials();

        // Collect tree transforms grouped by variant
        const treePositions = { pine: [], tall: [], snowy: [] };

        const terrainW = this.mountain.width;
        const terrainD = this.mountain.depth;
        const targetTreeCount = 4000;
        let attempts = 0;
        const maxAttempts = targetTreeCount * 5;
        let treeCount = 0;

        const treeLineHeight = this.mountain.maxHeight * 0.7;

        while (treeCount < targetTreeCount && attempts < maxAttempts) {
            attempts++;

            const x = (Math.random() - 0.5) * terrainW * 0.95;
            const z = (Math.random() - 0.5) * terrainD * 0.95;
            const height = this.mountain.getHeightAt(x, z);

            if (height < -1) continue;
            if (height > treeLineHeight) continue;

            const slope = this.mountain.getSlopeAt ? this.mountain.getSlopeAt(x, z) : 0;
            if (slope > 0.7) continue;

            const variant = Math.random();
            const treeScale = 1.5 + Math.random() * 1.5;

            const normal = this.mountain.getNormalAt(x, z);
            const rotX = -normal.z * 0.1;
            const rotY = Math.random() * Math.PI * 2;
            const rotZ = normal.x * 0.1;

            let variantKey, scale;
            if (variant < 0.4) {
                variantKey = 'pine';
                scale = treeScale;
            } else if (variant < 0.7) {
                variantKey = 'tall';
                scale = treeScale * 0.9;
            } else {
                variantKey = 'snowy';
                scale = treeScale * 0.8;
            }

            treePositions[variantKey].push({
                x, y: height, z,
                rotX, rotY, rotZ,
                scale
            });

            treeCount++;
        }

        // Build template geometries (merged with vertex colors)
        const pineGeo = this.buildPineTemplate();
        const tallGeo = this.buildTallPineTemplate();
        const snowyGeo = this.buildSnowyConeTemplate();

        // Create instanced meshes
        this.createInstancedMesh('pine', pineGeo, treePositions.pine);
        this.createInstancedMesh('tall', tallGeo, treePositions.tall);
        this.createInstancedMesh('snowy', snowyGeo, treePositions.snowy);

        // Dispose template geometries (instanced meshes hold copies)
        pineGeo.dispose();
        tallGeo.dispose();
        snowyGeo.dispose();

        console.log(`Trees populated: ${treeCount} (instanced: ${this.instancedMeshes.length} draw calls)`);
        this.scene.add(this.treeGroup);
    }

    createMaterials() {
        // Material for instanced trees (vertex colors for trunk/foliage/snow)
        this.instancedMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            flatShading: true
        });

        // Materials for manually placed trees (ObjectPlacer)
        this.trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x5d4037, roughness: 1.0, flatShading: true
        });
        this.foliageMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5a3d, roughness: 0.9, flatShading: true
        });
        this.snowMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.8, flatShading: true
        });
    }

    // Add vertex color attribute to a geometry
    addVertexColors(geometry, color) {
        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geometry;
    }

    buildPineTemplate() {
        const trunkColor = new THREE.Color(0x5d4037);
        const foliageColor = new THREE.Color(0x2d5a3d);
        const snowColor = new THREE.Color(0xffffff);

        const geos = [];

        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
        trunkGeo.translate(0, 0.75, 0);
        this.addVertexColors(trunkGeo, trunkColor);
        geos.push(trunkGeo);

        // Foliage layers + snow caps
        const layers = [
            { y: 1.8, radius: 1.2, height: 1.5 },
            { y: 2.8, radius: 0.9, height: 1.3 },
            { y: 3.6, radius: 0.6, height: 1.0 },
            { y: 4.2, radius: 0.3, height: 0.7 }
        ];

        layers.forEach(layer => {
            const cone = new THREE.ConeGeometry(layer.radius, layer.height, 6);
            cone.translate(0, layer.y, 0);
            this.addVertexColors(cone, foliageColor);
            geos.push(cone);

            // Snow cap on each layer
            const snowGeo = new THREE.ConeGeometry(layer.radius * 0.8, layer.height * 0.3, 6);
            snowGeo.translate(0, layer.y + layer.height * 0.35, 0);
            this.addVertexColors(snowGeo, snowColor);
            geos.push(snowGeo);
        });

        return mergeGeometries(geos);
    }

    buildTallPineTemplate() {
        const trunkColor = new THREE.Color(0x5d4037);
        const foliageColor = new THREE.Color(0x2d5a3d);
        const snowColor = new THREE.Color(0xffffff);

        const geos = [];

        // Taller, thinner trunk
        const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 2, 5);
        trunkGeo.translate(0, 1, 0);
        this.addVertexColors(trunkGeo, trunkColor);
        geos.push(trunkGeo);

        // Foliage
        const layers = [
            { y: 2.2, radius: 0.8, height: 2 },
            { y: 3.5, radius: 0.6, height: 1.8 },
            { y: 4.6, radius: 0.4, height: 1.4 },
            { y: 5.4, radius: 0.2, height: 1.0 }
        ];

        layers.forEach(layer => {
            const cone = new THREE.ConeGeometry(layer.radius, layer.height, 5);
            cone.translate(0, layer.y, 0);
            this.addVertexColors(cone, foliageColor);
            geos.push(cone);
        });

        // Top snow
        const snowGeo = new THREE.ConeGeometry(0.25, 0.5, 5);
        snowGeo.translate(0, 5.9, 0);
        this.addVertexColors(snowGeo, snowColor);
        geos.push(snowGeo);

        return mergeGeometries(geos);
    }

    buildSnowyConeTemplate() {
        const trunkColor = new THREE.Color(0x5d4037);
        const foliageColor = new THREE.Color(0x2d5a3d);
        const snowColor = new THREE.Color(0xffffff);

        const geos = [];

        // Small trunk
        const trunkGeo = new THREE.CylinderGeometry(0.08, 0.15, 0.8, 5);
        trunkGeo.translate(0, 0.4, 0);
        this.addVertexColors(trunkGeo, trunkColor);
        geos.push(trunkGeo);

        // Main snow-covered shape
        const mainGeo = new THREE.ConeGeometry(1, 2.5, 6);
        mainGeo.translate(0, 2, 0);
        this.addVertexColors(mainGeo, snowColor);
        geos.push(mainGeo);

        // Green patches showing through
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const patchGeo = new THREE.ConeGeometry(0.3, 0.5, 4);
            patchGeo.scale(0.8, 0.8, 0.8);
            patchGeo.translate(
                Math.cos(angle) * 0.4,
                1.2 + i * 0.3,
                Math.sin(angle) * 0.4
            );
            this.addVertexColors(patchGeo, foliageColor);
            geos.push(patchGeo);
        }

        return mergeGeometries(geos);
    }

    createInstancedMesh(variant, geometry, positions) {
        const count = positions.length;
        if (count === 0) return;

        const mesh = new THREE.InstancedMesh(geometry.clone(), this.instancedMaterial, count);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.name = `trees_${variant}`;

        const matrix = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        const euler = new THREE.Euler();

        for (let i = 0; i < count; i++) {
            const data = positions[i];

            pos.set(data.x, data.y, data.z);
            euler.set(data.rotX, data.rotY, data.rotZ);
            quat.setFromEuler(euler);
            scl.setScalar(data.scale);

            matrix.compose(pos, quat, scl);
            mesh.setMatrixAt(i, matrix);

            // Store data for collision detection
            this.treeData.push({
                variant,
                instanceIndex: i,
                mesh,
                position: new THREE.Vector3(data.x, data.y, data.z),
                scale: data.scale,
                knockedDown: false
            });
        }

        mesh.instanceMatrix.needsUpdate = true;
        this.instancedMeshes.push(mesh);
        this.treeGroup.add(mesh);
    }

    // Hide an instanced tree (set scale to 0)
    hideInstance(treeEntry) {
        const matrix = new THREE.Matrix4();
        matrix.makeScale(0, 0, 0);
        treeEntry.mesh.setMatrixAt(treeEntry.instanceIndex, matrix);
        treeEntry.mesh.instanceMatrix.needsUpdate = true;
    }

    // Create a standalone tree Group for knockdown animation
    createFallbackTree(treeEntry) {
        let tree;
        switch (treeEntry.variant) {
            case 'tall':
                tree = this.createTallPine(treeEntry.scale);
                break;
            case 'snowy':
                tree = this.createSnowyCone(treeEntry.scale);
                break;
            default:
                tree = this.createPineTree(treeEntry.scale);
        }
        tree.position.copy(treeEntry.position);
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;
        this.scene.add(tree);
        return tree;
    }

    // Create a single tree mesh for placement tool (non-instanced)
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

    // Add a tree at specific position (non-instanced, for ObjectPlacer)
    addTree(x, z, type = 'pine') {
        const height = this.mountain.getHeightAt(x, z);
        const tree = this.createTreeMesh(type);

        tree.position.set(x, height, z);
        tree.rotation.y = Math.random() * Math.PI * 2;
        tree.castShadow = true;

        this.scene.add(tree);
        return tree;
    }

    // Remove all instanced trees
    clear() {
        // Remove instanced meshes
        this.instancedMeshes.forEach(mesh => {
            this.treeGroup.remove(mesh);
            mesh.geometry.dispose();
        });
        this.instancedMeshes = [];
        this.treeData = [];
    }

    // --- Standalone tree builders (for ObjectPlacer and knockdown animation) ---

    createPineTree(scale = 1) {
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6),
            this.trunkMaterial
        );
        trunk.position.y = 0.75 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        const layers = [
            { y: 1.8, radius: 1.2, height: 1.5 },
            { y: 2.8, radius: 0.9, height: 1.3 },
            { y: 3.6, radius: 0.6, height: 1.0 },
            { y: 4.2, radius: 0.3, height: 0.7 }
        ];

        layers.forEach(layer => {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(layer.radius, layer.height, 6),
                this.foliageMaterial
            );
            cone.position.y = layer.y * scale;
            cone.scale.setScalar(scale);
            cone.castShadow = true;
            tree.add(cone);

            const snowGeo = new THREE.ConeGeometry(layer.radius * 0.8, layer.height * 0.3, 6);
            const snow = new THREE.Mesh(snowGeo, this.snowMaterial);
            snow.position.y = (layer.y + layer.height * 0.35) * scale;
            snow.scale.setScalar(scale);
            tree.add(snow);
        });

        return tree;
    }

    createTallPine(scale = 1) {
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.2, 2, 5),
            this.trunkMaterial
        );
        trunk.position.y = 1 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        const layers = [
            { y: 2.2, radius: 0.8, height: 2 },
            { y: 3.5, radius: 0.6, height: 1.8 },
            { y: 4.6, radius: 0.4, height: 1.4 },
            { y: 5.4, radius: 0.2, height: 1.0 }
        ];

        layers.forEach(layer => {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(layer.radius, layer.height, 5),
                this.foliageMaterial
            );
            cone.position.y = layer.y * scale;
            cone.scale.setScalar(scale);
            cone.castShadow = true;
            tree.add(cone);
        });

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
        const tree = new THREE.Group();
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;

        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.15, 0.8, 5),
            this.trunkMaterial
        );
        trunk.position.y = 0.4 * scale;
        trunk.scale.setScalar(scale);
        tree.add(trunk);

        const main = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2.5, 6),
            this.snowMaterial
        );
        main.position.y = 2 * scale;
        main.scale.setScalar(scale);
        main.castShadow = true;
        tree.add(main);

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
            const patch = new THREE.Mesh(
                new THREE.ConeGeometry(0.3, 0.5, 4),
                this.foliageMaterial
            );
            patch.position.x = Math.cos(angle) * 0.4 * scale;
            patch.position.z = Math.sin(angle) * 0.4 * scale;
            patch.position.y = (1.2 + Math.random() * 0.8) * scale;
            patch.scale.setScalar(scale * 0.8);
            tree.add(patch);
        }

        return tree;
    }

    populateZone(zone) {
        // Zone population still creates individual trees (used rarely)
        const { minX, maxX, minZ, maxZ, density } = zone;
        const area = (maxX - minX) * (maxZ - minZ);
        const treeCount = Math.floor(area * density * 0.08);

        for (let i = 0; i < treeCount; i++) {
            const x = minX + Math.random() * (maxX - minX);
            const z = minZ + Math.random() * (maxZ - minZ);
            const height = this.mountain.getHeightAt(x, z);

            if (height < 1 || height > this.mountain.maxHeight * 0.7) continue;

            const slope = this.mountain.getSlopeAt ? this.mountain.getSlopeAt(x, z) : 0;
            if (slope > 0.7) continue;

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

            const normal = this.mountain.getNormalAt(x, z);
            tree.rotation.x = -normal.z * 0.1;
            tree.rotation.z = normal.x * 0.1;

            tree.castShadow = true;
            this.treeGroup.add(tree);
        }
    }
}
