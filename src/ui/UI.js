/**
 * UI - User interface controller
 */

export class UI {
    constructor(objectPlacer, snow, sceneManager) {
        this.objectPlacer = objectPlacer;
        this.snow = snow;
        this.sceneManager = sceneManager;

        // DOM elements
        this.modeIndicator = null;
        this.modeText = null;
        this.paletteItems = [];
        this.activeItem = null;
    }

    init() {
        // Get DOM references
        this.modeIndicator = document.getElementById('mode-indicator');
        this.modeText = this.modeIndicator.querySelector('.mode-text');

        // Set up palette items
        this.paletteItems = document.querySelectorAll('.palette-item');
        this.setupPaletteEvents();

        // Set up quick action buttons
        this.setupQuickActions();

        // Set up keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Set up cancel button
        document.getElementById('cancel-placement').addEventListener('click', () => {
            this.cancelPlacement();
        });
    }

    setupPaletteEvents() {
        this.paletteItems.forEach(item => {
            item.addEventListener('click', () => {
                const objectType = item.dataset.object;

                if (this.activeItem === item) {
                    // Clicking active item cancels placement
                    this.cancelPlacement();
                } else {
                    // Activate new item
                    this.selectPaletteItem(item);
                    const objectName = this.objectPlacer.setPlacementMode(objectType);
                    this.showModeIndicator(objectName);
                }
            });

            // Hover effects are handled by CSS
        });
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

    showModeIndicator(objectName) {
        if (this.modeIndicator && this.modeText) {
            this.modeText.textContent = `Placing: ${objectName}`;
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
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Escape to cancel
            if (e.key === 'Escape') {
                this.cancelPlacement();
            }

            // Number keys for quick object selection
            const keyMap = {
                '1': 'ski-lift',
                '2': 'gondola',
                '3': 'lodge',
                '4': 'pine-tree',
                '5': 'flag',
                '6': 'snowman'
            };

            if (keyMap[e.key] && !e.ctrlKey && !e.metaKey) {
                const item = document.querySelector(`[data-object="${keyMap[e.key]}"]`);
                if (item) {
                    this.selectPaletteItem(item);
                    const objectName = this.objectPlacer.setPlacementMode(keyMap[e.key]);
                    this.showModeIndicator(objectName);
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
