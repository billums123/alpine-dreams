/**
 * Music - Dual track system for skiing
 * Inspired by minimalist, atmospheric electronic music
 * Clean plucked melodies, spacious reverb, warm bass
 */

export class Music {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.reverbGain = null;
        this.delayNode = null;
        this.delayFeedback = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.oscillators = [];
        this.intervals = [];
        this.timeouts = [];
        this.volume = 0.55;
        this.currentTrack = 1;
        this.bpm = 110;
        this.beatTime = 60 / this.bpm;
    }

    init() {
        this.tryStart();
        const startAudio = () => {
            this.tryStart();
            document.removeEventListener('click', startAudio);
            document.removeEventListener('keydown', startAudio);
        };
        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);
    }

    tryStart() {
        if (this.audioContext) return;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Spacious delay for that shimmering effect
            this.delayNode = this.audioContext.createDelay(1);
            this.delayNode.delayTime.value = this.beatTime * 0.75; // Dotted eighth

            this.delayFeedback = this.audioContext.createGain();
            this.delayFeedback.gain.value = 0.4;

            const delayFilter = this.audioContext.createBiquadFilter();
            delayFilter.type = 'lowpass';
            delayFilter.frequency.value = 3000;

            this.delayNode.connect(delayFilter);
            delayFilter.connect(this.delayFeedback);
            this.delayFeedback.connect(this.delayNode);

            // Reverb bus
            this.reverbGain = this.audioContext.createGain();
            this.reverbGain.gain.value = 0.3;

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.volume;

            this.delayNode.connect(this.masterGain);
            this.reverbGain.connect(this.masterGain);
            this.masterGain.connect(this.audioContext.destination);

            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            console.log('🎵 Music started!');
            this.play();
        } catch (e) {
            console.warn('Could not start music:', e);
        }
    }

    // Long reverb tail
    createReverbSend(input) {
        const delays = [0.1, 0.23, 0.41, 0.57, 0.79];
        delays.forEach(time => {
            const delay = this.audioContext.createDelay(1);
            delay.delayTime.value = time;
            const gain = this.audioContext.createGain();
            gain.gain.value = 0.15 * (1 - time * 0.5);
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 2000;
            input.connect(delay);
            delay.connect(filter);
            filter.connect(gain);
            gain.connect(this.reverbGain);
        });
    }

    play() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;

        if (this.currentTrack === 1) {
            this.playTrackOne();
        } else {
            this.playTrackTwo();
        }
    }

    toggleTrack() {
        this.stop();
        this.currentTrack = this.currentTrack === 1 ? 2 : 1;
        this.bpm = this.currentTrack === 1 ? 110 : 85;
        this.beatTime = 60 / this.bpm;
        if (this.delayNode) {
            this.delayNode.delayTime.value = this.beatTime * 0.75;
        }
        this.play();
        return this.currentTrack;
    }

    getTrackName() {
        return this.currentTrack === 1 ? 'Shimmer Drive' : 'Deep Ambient';
    }

    // ==========================================
    // TRACK 1: SHIMMER DRIVE
    // Minimalist, clean plucks with driving bass
    // ==========================================
    playTrackOne() {
        this.createMinimalKick();
        this.createWarmBass();
        this.createPluckedMelody();
        this.createPadLayer();
        this.createHighShimmer();
    }

    // Soft, warm kick - understated
    createMinimalKick() {
        const interval = this.beatTime * 1000;

        const playKick = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(80, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);

            gain.gain.setValueAtTime(0.45, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

            osc.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc.stop(now + 0.35);
        };

        this.intervals.push(setInterval(playKick, interval));
        playKick();
    }

    // Warm, round bass with gentle movement
    createWarmBass() {
        const interval = this.beatTime * 2000;
        // E minor / A minor progression
        const notes = [82.41, 82.41, 110, 98]; // E2, E2, A2, G2
        let noteIndex = 0;

        const playBass = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const note = notes[noteIndex % notes.length];

            const osc = this.audioContext.createOscillator();
            const osc2 = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = 'sine';
            osc.frequency.value = note;
            osc2.type = 'triangle';
            osc2.frequency.value = note * 1.001;

            filter.type = 'lowpass';
            filter.frequency.value = 300;
            filter.Q.value = 1;

            // Gentle swell
            const duration = this.beatTime * 1.8;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
            gain.gain.setValueAtTime(0.3, now + duration * 0.6);
            gain.gain.linearRampToValueAtTime(0, now + duration);

            const mix = this.audioContext.createGain();
            mix.gain.value = 0.6;

            osc.connect(mix);
            osc2.connect(mix);
            mix.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc2.start(now);
            osc.stop(now + duration + 0.1);
            osc2.stop(now + duration + 0.1);

            noteIndex++;
        };

        this.intervals.push(setInterval(playBass, interval));
        // Bass enters after 4 beats
        this.timeouts.push(setTimeout(playBass, this.beatTime * 4000));
    }

    // The iconic plucked melody with delay
    createPluckedMelody() {
        const sixteenth = this.beatTime * 250;
        // Melodic pattern inspired by minimalist guitar plucks
        const pattern = [
            { note: 659.25, vel: 1 },    // E5
            { note: null, vel: 0 },
            { note: 493.88, vel: 0.7 },  // B4
            { note: null, vel: 0 },
            { note: 587.33, vel: 0.8 },  // D5
            { note: null, vel: 0 },
            { note: 493.88, vel: 0.6 },  // B4
            { note: null, vel: 0 },
            { note: 659.25, vel: 0.9 },  // E5
            { note: null, vel: 0 },
            { note: 587.33, vel: 0.7 },  // D5
            { note: null, vel: 0 },
            { note: 493.88, vel: 0.8 },  // B4
            { note: null, vel: 0 },
            { note: 440, vel: 0.6 },     // A4
            { note: null, vel: 0 },
        ];
        let step = 0;

        const playNote = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const { note, vel } = pattern[step % pattern.length];

            if (note && vel > 0) {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                // Clean, plucky tone
                osc.type = 'triangle';
                osc.frequency.value = note;

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(4000, now);
                filter.frequency.exponentialRampToValueAtTime(1500, now + 0.3);
                filter.Q.value = 1;

                // Pluck envelope
                gain.gain.setValueAtTime(0.12 * vel, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

                osc.connect(filter);
                filter.connect(gain);

                // Send to delay for shimmer
                gain.connect(this.delayNode);
                gain.connect(this.masterGain);
                this.createReverbSend(gain);

                osc.start(now);
                osc.stop(now + 1);
            }

            step++;
        };

        this.intervals.push(setInterval(playNote, sixteenth));
        playNote();
    }

    // Soft pad underneath
    createPadLayer() {
        const changeInterval = this.beatTime * 8000;
        const chords = [
            [164.81, 246.94, 329.63], // E3, B3, E4 (Em)
            [164.81, 246.94, 329.63], // Em
            [220, 329.63, 440],       // A3, E4, A4 (Am)
            [196, 293.66, 392],       // G3, D4, G4 (G)
        ];
        let chordIndex = 0;

        const playPad = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;
            const chord = chords[chordIndex % chords.length];

            chord.forEach((freq) => {
                const osc = this.audioContext.createOscillator();
                const osc2 = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.value = freq;
                osc2.type = 'sine';
                osc2.frequency.value = freq * 1.003;

                filter.type = 'lowpass';
                filter.frequency.value = 800;

                const attack = 2;
                const hold = this.beatTime * 6;
                const release = 2;

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.04, now + attack);
                gain.gain.setValueAtTime(0.04, now + hold);
                gain.gain.linearRampToValueAtTime(0, now + hold + release);

                const mix = this.audioContext.createGain();
                mix.gain.value = 0.5;

                osc.connect(mix);
                osc2.connect(mix);
                mix.connect(filter);
                filter.connect(gain);
                gain.connect(this.reverbGain);

                osc.start(now);
                osc2.start(now);
                osc.stop(now + hold + release + 0.5);
                osc2.stop(now + hold + release + 0.5);
            });

            chordIndex++;
        };

        this.intervals.push(setInterval(playPad, changeInterval));
        // Pads enter after 8 beats
        this.timeouts.push(setTimeout(playPad, this.beatTime * 8000));
    }

    // High frequency shimmer
    createHighShimmer() {
        const interval = this.beatTime * 4000;

        const playShimmer = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const notes = [1318.51, 1567.98, 1975.53, 2349.32]; // E6, G6, B6, D7

            for (let i = 0; i < 2; i++) {
                const delay = Math.random() * 1.5;
                const freq = notes[Math.floor(Math.random() * notes.length)];

                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq;

                gain.gain.setValueAtTime(0, now + delay);
                gain.gain.linearRampToValueAtTime(0.015, now + delay + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 2.5);

                osc.connect(gain);
                gain.connect(this.delayNode);
                gain.connect(this.reverbGain);

                osc.start(now + delay);
                osc.stop(now + delay + 3);
            }
        };

        this.intervals.push(setInterval(playShimmer, interval));
        this.timeouts.push(setTimeout(playShimmer, this.beatTime * 12000));
    }

    // ==========================================
    // TRACK 2: DEEP AMBIENT
    // Slower, more atmospheric, no drums
    // ==========================================
    playTrackTwo() {
        this.createDeepDrone();
        this.createSlowPlucks();
        this.createAtmosphericPad();
        this.createBells();
        this.createSubMovement();
    }

    createDeepDrone() {
        const changeInterval = this.beatTime * 16000;
        const roots = [55, 49, 55, 41.2]; // A1, G1, A1, E1

        let rootIndex = 0;

        const playDrone = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;
            const root = roots[rootIndex % roots.length];

            for (let d = -1; d <= 1; d++) {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.value = root * (1 + d * 0.002);

                filter.type = 'lowpass';
                filter.frequency.value = 200;

                const attack = 5;
                const hold = this.beatTime * 12;
                const release = 4;

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.12, now + attack);
                gain.gain.setValueAtTime(0.12, now + hold);
                gain.gain.linearRampToValueAtTime(0, now + hold + release);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + hold + release + 1);
            }

            rootIndex++;
        };

        this.intervals.push(setInterval(playDrone, changeInterval));
        playDrone();
    }

    createSlowPlucks() {
        const interval = this.beatTime * 2000;
        const notes = [329.63, 493.88, 440, 392, 329.63, 587.33, 493.88, 440]; // E4, B4, A4, G4...
        let noteIndex = 0;

        const playPluck = () => {
            if (!this.isPlaying) return;

            // Some notes are silent for space
            if (Math.random() > 0.7) {
                noteIndex++;
                return;
            }

            const now = this.audioContext.currentTime;
            const note = notes[noteIndex % notes.length];

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.value = note;

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2500, now);
            filter.frequency.exponentialRampToValueAtTime(800, now + 0.5);

            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 2);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.delayNode);
            gain.connect(this.reverbGain);
            this.createReverbSend(gain);

            osc.start(now);
            osc.stop(now + 2.5);

            noteIndex++;
        };

        this.intervals.push(setInterval(playPluck, interval));
        this.timeouts.push(setTimeout(playPluck, 3000));
    }

    createAtmosphericPad() {
        const changeInterval = this.beatTime * 12000;
        const chords = [
            [220, 329.63, 493.88],    // A3, E4, B4
            [196, 293.66, 440],       // G3, D4, A4
            [174.61, 261.63, 392],    // F3, C4, G4
            [196, 293.66, 440],       // G3, D4, A4
        ];
        let chordIndex = 0;

        const playPad = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;
            const chord = chords[chordIndex % chords.length];

            chord.forEach((freq) => {
                for (let d = -1; d <= 1; d++) {
                    const osc = this.audioContext.createOscillator();
                    const osc2 = this.audioContext.createOscillator();
                    const gain = this.audioContext.createGain();
                    const filter = this.audioContext.createBiquadFilter();

                    osc.type = 'sine';
                    osc.frequency.value = freq * (1 + d * 0.004);
                    osc2.type = 'triangle';
                    osc2.frequency.value = freq * (1 + d * 0.004) * 1.001;

                    filter.type = 'lowpass';
                    filter.frequency.value = 1200;

                    const attack = 3;
                    const hold = this.beatTime * 8;
                    const release = 4;

                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.035, now + attack);
                    gain.gain.setValueAtTime(0.035, now + hold);
                    gain.gain.linearRampToValueAtTime(0, now + hold + release);

                    const mix = this.audioContext.createGain();
                    mix.gain.value = 0.4;

                    osc.connect(mix);
                    osc2.connect(mix);
                    mix.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.reverbGain);
                    this.createReverbSend(gain);

                    osc.start(now);
                    osc2.start(now);
                    osc.stop(now + hold + release + 1);
                    osc2.stop(now + hold + release + 1);
                }
            });

            chordIndex++;
        };

        this.intervals.push(setInterval(playPad, changeInterval));
        playPad();
    }

    createBells() {
        const interval = this.beatTime * 8000;

        const playBell = () => {
            if (!this.isPlaying) return;
            if (Math.random() > 0.6) return;

            const now = this.audioContext.currentTime;
            const notes = [659.25, 783.99, 987.77, 1174.66, 1318.51]; // E5, G5, B5, D6, E6
            const freq = notes[Math.floor(Math.random() * notes.length)];

            const harmonics = [1, 2.4, 4.1, 5.9];
            harmonics.forEach((h, i) => {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq * h;

                const vol = 0.025 / (i + 1);
                const decay = 4 - i * 0.7;

                gain.gain.setValueAtTime(vol, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

                osc.connect(gain);
                gain.connect(this.delayNode);
                gain.connect(this.reverbGain);

                osc.start(now);
                osc.stop(now + decay + 1);
            });
        };

        this.intervals.push(setInterval(playBell, interval));
        this.timeouts.push(setTimeout(playBell, 6000));
    }

    createSubMovement() {
        const cycleTime = this.beatTime * 24000;

        const playSub = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const osc = this.audioContext.createOscillator();
            const osc2 = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = 'sine';
            osc.frequency.value = 36;
            osc2.type = 'sine';
            osc2.frequency.value = 36.5;

            filter.type = 'lowpass';
            filter.frequency.value = 80;

            const duration = this.beatTime * 20;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.18, now + duration * 0.3);
            gain.gain.linearRampToValueAtTime(0.12, now + duration * 0.7);
            gain.gain.linearRampToValueAtTime(0, now + duration);

            const mix = this.audioContext.createGain();
            mix.gain.value = 0.5;

            osc.connect(mix);
            osc2.connect(mix);
            mix.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc2.start(now);
            osc.stop(now + duration + 1);
            osc2.stop(now + duration + 1);
        };

        this.intervals.push(setInterval(playSub, cycleTime));
        this.timeouts.push(setTimeout(playSub, 5000));
    }

    // ==========================================
    // CONTROLS
    // ==========================================
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
        }
    }

    mute() {
        this.isMuted = true;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.3);
        }
    }

    unmute() {
        this.isMuted = false;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.3);
        }
    }

    toggleMute() {
        if (this.isMuted) {
            this.unmute();
        } else {
            this.mute();
        }
        return this.isMuted;
    }

    stop() {
        this.isPlaying = false;
        this.intervals.forEach(i => clearInterval(i));
        this.timeouts.forEach(t => clearTimeout(t));
        this.intervals = [];
        this.timeouts = [];
    }
}
