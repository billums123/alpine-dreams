/**
 * Music - Smooth ambient background music using Web Audio API
 */

export class Music {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.isPlaying = false;
        this.oscillators = [];
        this.volume = 0.5; // Increased volume
    }

    init() {
        // Wait for user interaction to start audio
        const startAudio = () => {
            if (!this.audioContext) {
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    this.masterGain = this.audioContext.createGain();
                    this.masterGain.gain.value = this.volume;
                    this.masterGain.connect(this.audioContext.destination);

                    // Resume context if suspended (required by some browsers)
                    if (this.audioContext.state === 'suspended') {
                        this.audioContext.resume();
                    }

                    console.log('🎵 Music initialized');
                    this.play();
                } catch (e) {
                    console.warn('Could not initialize music:', e);
                }
            }
            document.removeEventListener('click', startAudio);
            document.removeEventListener('keydown', startAudio);
        };

        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);
    }

    play() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;

        // Create ambient pads - smooth evolving chords
        this.createAmbientPad();
        this.createBassDrone();
        this.createSparkles();
    }

    createAmbientPad() {
        // Smooth pad using multiple detuned oscillators
        const chords = [
            [261.63, 329.63, 392.00], // C major
            [293.66, 369.99, 440.00], // D major
            [246.94, 311.13, 369.99], // B minor
            [261.63, 329.63, 392.00], // C major
        ];

        let chordIndex = 0;

        const playChord = () => {
            if (!this.isPlaying) return;

            const chord = chords[chordIndex % chords.length];
            chordIndex++;

            chord.forEach((freq, i) => {
                // Create 2 detuned oscillators per note for richness
                for (let d = 0; d < 2; d++) {
                    const osc = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    const filter = this.audioContext.createBiquadFilter();

                    osc.type = 'sine';
                    osc.frequency.value = freq * (1 + (d - 0.5) * 0.01); // Slight detune

                    filter.type = 'lowpass';
                    filter.frequency.value = 800;
                    filter.Q.value = 1;

                    // Slow attack and release for smooth pad
                    const now = this.audioContext.currentTime;
                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.15, now + 2);
                    gain.gain.setValueAtTime(0.15, now + 6);
                    gain.gain.linearRampToValueAtTime(0, now + 8);

                    osc.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.masterGain);

                    osc.start(now);
                    osc.stop(now + 8);
                }
            });

            // Schedule next chord
            setTimeout(playChord, 8000);
        };

        playChord();
    }

    createBassDrone() {
        // Deep bass drone
        const bassFreq = 65.41; // C2

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.value = bassFreq;

        filter.type = 'lowpass';
        filter.frequency.value = 200;

        gain.gain.value = 0.25;

        // Slow LFO for movement
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.1;
        lfoGain.gain.value = 10;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        this.oscillators.push(osc, lfo);
    }

    createSparkles() {
        // Occasional high sparkle notes
        const sparkleNotes = [1046.50, 1174.66, 1318.51, 1567.98, 1760.00]; // High C, D, E, G, A

        const playSparkle = () => {
            if (!this.isPlaying) return;

            // Random chance to play
            if (Math.random() > 0.3) {
                const freq = sparkleNotes[Math.floor(Math.random() * sparkleNotes.length)];
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq * (0.98 + Math.random() * 0.04);

                const now = this.audioContext.currentTime;
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.06, now + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 2);

                osc.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + 2);
            }

            // Random timing for next sparkle
            setTimeout(playSparkle, 2000 + Math.random() * 4000);
        };

        setTimeout(playSparkle, 3000);
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain) {
            this.masterGain.gain.value = this.volume;
        }
    }

    stop() {
        this.isPlaying = false;
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        this.oscillators = [];
    }

    toggle() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
        return this.isPlaying;
    }
}
