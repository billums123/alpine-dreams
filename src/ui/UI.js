/**
 * UI - User interface controller
 */

import * as THREE from 'three';

export class UI {
    constructor(objectPlacer, snow, sceneManager, mountain, skier, trees) {
        this.objectPlacer = objectPlacer;
        this.snow = snow;
        this.sceneManager = sceneManager;
        this.mountain = mountain;
        this.skier = skier;
        this.trees = trees;

        // DOM elements
        this.modeIndicator = null;
        this.modeText = null;
        this.paletteItems = [];
        this.sculptItems = [];
        this.activeItem = null;

        // Sculpting state
        this.sculptMode = null;
        this.isSculpting = false;

        // Raycaster for terrain sculpting
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Bind methods
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    init() {
        // Get DOM references
        this.modeIndicator = document.getElementById('mode-indicator');
        this.modeText = this.modeIndicator.querySelector('.mode-text');

        // Set up palette items (objects)
        this.paletteItems = document.querySelectorAll('.palette-item[data-object]');
        this.setupPaletteEvents();

        // Set up sculpt items
        this.sculptItems = document.querySelectorAll('.palette-item[data-sculpt]');
        this.setupSculptEvents();

        // Set up quick action buttons
        this.setupQuickActions();

        // Set up keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Set up cancel button
        document.getElementById('cancel-placement').addEventListener('click', () => {
            this.cancelPlacement();
        });

        // Set up sculpting mouse events
        const canvas = this.sceneManager.renderer.domElement;
        canvas.addEventListener('mousemove', this.onMouseMove);
        canvas.addEventListener('mousedown', this.onMouseDown);
        canvas.addEventListener('mouseup', this.onMouseUp);
    }

    setupPaletteEvents() {
        this.paletteItems.forEach(item => {
            item.addEventListener('click', () => {
                const objectType = item.dataset.object;

                // Cancel any sculpt mode
                this.cancelSculptMode();

                if (objectType === 'skier') {
                    // Special handling for skier
                    this.handleSkierSelection(item);
                } else if (this.activeItem === item) {
                    // Clicking active item cancels placement
                    this.cancelPlacement();
                } else {
                    // Activate new item
                    this.selectPaletteItem(item);
                    const objectName = this.objectPlacer.setPlacementMode(objectType);
                    this.showModeIndicator(`Placing: ${objectName}`);
                }
            });
        });
    }

    setupSculptEvents() {
        this.sculptItems.forEach(item => {
            item.addEventListener('click', () => {
                const sculptType = item.dataset.sculpt;

                // Cancel any object placement
                this.cancelPlacement();

                if (this.activeItem === item) {
                    // Clicking active item cancels sculpt mode
                    this.cancelSculptMode();
                } else {
                    // Activate sculpt mode
                    this.selectPaletteItem(item);
                    this.sculptMode = sculptType;
                    document.body.classList.add('sculpt-mode');

                    const modeNames = {
                        'raise': 'Raise Terrain',
                        'lower': 'Lower Terrain',
                        'smooth': 'Smooth Terrain',
                        'flatten': 'Flatten Terrain'
                    };
                    this.showModeIndicator(`Sculpting: ${modeNames[sculptType]}`);
                }
            });
        });
    }

    handleSkierSelection(item) {
        if (this.activeItem === item) {
            this.cancelPlacement();
            return;
        }

        this.selectPaletteItem(item);
        this.showModeIndicator('Click on mountain to place skier');

        // Set up one-time click handler for skier placement
        const canvas = this.sceneManager.renderer.domElement;
        const clickHandler = (e) => {
            if (e.target !== canvas) return;

            // Raycast to terrain
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

            const intersect = this.mountain.raycast(this.raycaster);
            if (intersect) {
                // Place skier and start ski mode
                this.skier.place(intersect.point.x, intersect.point.z);
                this.cancelPlacement();
            }

            canvas.removeEventListener('click', clickHandler);
        };

        canvas.addEventListener('click', clickHandler);
    }

    selectPaletteItem(item) {
        // Deselect previous
        if (this.activeItem) {
            this.activeItem.classList.remove('active');
        }

        // Select new
        this.activeItem = item;
        if (item) {
            item.classList.add('active');
        }
    }

    showModeIndicator(text) {
        if (this.modeIndicator && this.modeText) {
            this.modeText.textContent = text;
            this.modeIndicator.classList.remove('hidden');
        }
    }

    hideModeIndicator() {
        if (this.modeIndicator) {
            this.modeIndicator.classList.add('hidden');
        }
    }

    cancelPlacement() {
        this.objectPlacer.cancelPlacement();
        this.selectPaletteItem(null);
        this.hideModeIndicator();
    }

    cancelSculptMode() {
        this.sculptMode = null;
        this.isSculpting = false;
        document.body.classList.remove('sculpt-mode');
        if (!this.objectPlacer.mode || this.objectPlacer.mode === 'select') {
            this.selectPaletteItem(null);
            this.hideModeIndicator();
        }
    }

    // Mouse handlers for sculpting
    onMouseMove(e) {
        if (!this.sculptMode || !this.isSculpting) return;

        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

        const intersect = this.mountain.raycast(this.raycaster);
        if (intersect) {
            this.mountain.sculpt(intersect.point.x, intersect.point.z, this.sculptMode, 0.5);
        }
    }

    onMouseDown(e) {
        if (!this.sculptMode || e.button !== 0) return;

        // Check if clicking on UI
        if (e.target.closest('#ui-overlay')) return;

        this.isSculpting = true;

        // Initial sculpt at click point
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

        const intersect = this.mountain.raycast(this.raycaster);
        if (intersect) {
            this.mountain.sculpt(intersect.point.x, intersect.point.z, this.sculptMode, 1);
        }
    }

    onMouseUp() {
        this.isSculpting = false;
    }

    setupQuickActions() {
        // Clear all
        document.getElementById('btn-clear').addEventListener('click', () => {
            if (confirm('Clear all placed objects?')) {
                this.objectPlacer.clearAll();
                this.cancelPlacement();
            }
        });

        // Auto-generate
        document.getElementById('btn-random').addEventListener('click', () => {
            this.objectPlacer.autoGenerate();
            this.cancelPlacement();
            this.showNotification('Resort generated! ✨');
        });

        // Screenshot
        document.getElementById('btn-screenshot').addEventListener('click', () => {
            this.sceneManager.screenshot();
            this.showNotification('Screenshot saved! 📷');
        });

        // Toggle snow
        document.getElementById('btn-toggle-snow').addEventListener('click', () => {
            const enabled = this.snow.toggle();
            this.showNotification(enabled ? 'Snow enabled ❄️' : 'Snow disabled');
        });

        // New terrain
        const newTerrainBtn = document.getElementById('btn-new-terrain');
        if (newTerrainBtn) {
            newTerrainBtn.addEventListener('click', () => {
                // Clear objects
                this.objectPlacer.clearAll();

                // Clear trees
                if (this.trees) {
                    this.trees.clear();
                }

                // Regenerate terrain
                this.mountain.regenerate();

                // Repopulate trees
                if (this.trees) {
                    this.trees.populate();
                }

                this.cancelPlacement();
                this.showNotification('New terrain generated! 🏔️');
            });
        }
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Don't handle shortcuts if skier is active
            if (this.skier && this.skier.isActive) return;

            // Escape to cancel
            if (e.key === 'Escape') {
                this.cancelPlacement();
                this.cancelSculptMode();
            }

            // Number keys for quick object selection
            const keyMap = {
                '1': 'ski-lift',
                '2': 'gondola',
                '3': 'lodge',
                '4': 'pine-tree',
                '5': 'flag',
                '6': 'snowman',
                '7': 'skier'
            };

            if (keyMap[e.key] && !e.ctrlKey && !e.metaKey) {
                this.cancelSculptMode();

                if (e.key === '7') {
                    // Skier
                    const item = document.querySelector('[data-object="skier"]');
                    if (item) {
                        this.handleSkierSelection(item);
                    }
                } else {
                    const item = document.querySelector(`[data-object="${keyMap[e.key]}"]`);
                    if (item) {
                        this.selectPaletteItem(item);
                        const objectName = this.objectPlacer.setPlacementMode(keyMap[e.key]);
                        this.showModeIndicator(`Placing: ${objectName}`);
                    }
                }
            }

            // Q, W, E for sculpt modes
            const sculptKeyMap = {
                'q': 'raise',
                'w': 'lower',
                'e': 'smooth'
            };

            if (sculptKeyMap[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) {
                this.cancelPlacement();
                const sculptType = sculptKeyMap[e.key.toLowerCase()];
                const item = document.querySelector(`[data-sculpt="${sculptType}"]`);
                if (item) {
                    this.selectPaletteItem(item);
                    this.sculptMode = sculptType;
                    document.body.classList.add('sculpt-mode');

                    const modeNames = {
                        'raise': 'Raise Terrain',
                        'lower': 'Lower Terrain',
                        'smooth': 'Smooth Terrain'
                    };
                    this.showModeIndicator(`Sculpting: ${modeNames[sculptType]}`);
                }
            }
        });
    }

    showNotification(message, duration = 2000) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(20, 30, 50, 0.9);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: 'Quicksand', sans-serif;
            font-size: 0.9rem;
            z-index: 1000;
            animation: slideUp 0.3s ease;
            pointer-events: none;
        `;

        // Add animation keyframes if not already present
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Remove after duration
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, duration);
    }

    // Update UI state based on object placer state
    update() {
        // Could be used for real-time UI updates if needed
    }
}
