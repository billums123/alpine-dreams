/**
 * Music - Electronic track for fast downhill skiing
 * 135 BPM, driving bass, crisp drums, subtle synth melodies
 * Mood: adrenaline, freedom, cold mountain air
 */

export class Music {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.compressor = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.oscillators = [];
        this.intervals = [];
        this.timeouts = [];
        this.volume = 0.5;
        this.bpm = 135;
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

            // Master compressor for glue
            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = -24;
            this.compressor.knee.value = 30;
            this.compressor.ratio.value = 4;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.25;

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.volume;

            this.compressor.connect(this.masterGain);
            this.masterGain.connect(this.audioContext.destination);

            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            console.log('🎵 Alpine electronic track started!');
            this.play();
        } catch (e) {
            console.warn('Could not start music:', e);
        }
    }

    play() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;

        // Start all layers
        this.createKick();
        this.createSnare();
        this.createHiHats();
        this.createBass();
        this.createPad();
        this.createArpeggio();
        this.createLead();
    }

    // Punchy four-on-the-floor kick
    createKick() {
        const interval = this.beatTime * 1000;

        const playKick = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            // Sub layer
            const sub = this.audioContext.createOscillator();
            const subGain = this.audioContext.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(150, now);
            sub.frequency.exponentialRampToValueAtTime(35, now + 0.08);
            subGain.gain.setValueAtTime(0.8, now);
            subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            sub.connect(subGain);
            subGain.connect(this.compressor);
            sub.start(now);
            sub.stop(now + 0.4);

            // Click layer for attack
            const click = this.audioContext.createOscillator();
            const clickGain = this.audioContext.createGain();
            click.type = 'triangle';
            click.frequency.setValueAtTime(1200, now);
            click.frequency.exponentialRampToValueAtTime(60, now + 0.02);
            clickGain.gain.setValueAtTime(0.3, now);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
            click.connect(clickGain);
            clickGain.connect(this.compressor);
            click.start(now);
            click.stop(now + 0.05);
        };

        this.intervals.push(setInterval(playKick, interval));
        playKick();
    }

    // Snappy snare on 2 and 4
    createSnare() {
        const interval = this.beatTime * 2000;

        const playSnare = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            // Noise burst
            const bufferSize = this.audioContext.sampleRate * 0.15;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            const noise = this.audioContext.createBufferSource();
            noise.buffer = buffer;

            const noiseFilter = this.audioContext.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 2000;

            const noiseGain = this.audioContext.createGain();
            noiseGain.gain.setValueAtTime(0.35, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(this.compressor);
            noise.start(now);

            // Body tone
            const body = this.audioContext.createOscillator();
            const bodyGain = this.audioContext.createGain();
            body.type = 'triangle';
            body.frequency.setValueAtTime(250, now);
            body.frequency.exponentialRampToValueAtTime(120, now + 0.05);
            bodyGain.gain.setValueAtTime(0.4, now);
            bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            body.connect(bodyGain);
            bodyGain.connect(this.compressor);
            body.start(now);
            body.stop(now + 0.15);
        };

        // Offset to hit on beat 2
        this.timeouts.push(setTimeout(() => {
            this.intervals.push(setInterval(playSnare, interval));
            playSnare();
        }, this.beatTime * 1000));
    }

    // Crisp hi-hats with groove
    createHiHats() {
        const eighthNote = this.beatTime * 500;
        let step = 0;

        const playHat = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            // Vary velocity for groove
            const velocities = [1, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.6];
            const vel = velocities[step % 8];

            // Open hat on off-beats occasionally
            const isOpen = step % 8 === 2 || step % 8 === 6;
            const decay = isOpen ? 0.15 : 0.05;

            const bufferSize = this.audioContext.sampleRate * decay;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            const noise = this.audioContext.createBufferSource();
            noise.buffer = buffer;

            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 8000;

            const bandpass = this.audioContext.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.value = 10000;
            bandpass.Q.value = 1;

            const gain = this.audioContext.createGain();
            gain.gain.setValueAtTime(0.18 * vel, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

            noise.connect(filter);
            filter.connect(bandpass);
            bandpass.connect(gain);
            gain.connect(this.compressor);
            noise.start(now);

            step++;
        };

        this.intervals.push(setInterval(playHat, eighthNote));
        playHat();
    }

    // Driving bass line with sidechain feel
    createBass() {
        const interval = this.beatTime * 1000;
        const notes = [55, 55, 73.42, 65.41]; // A1, A1, D2, C2
        let noteIndex = 0;
        let beat = 0;

        const playBass = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;

            const note = notes[Math.floor(noteIndex / 4) % notes.length];

            const osc = this.audioContext.createOscillator();
            const osc2 = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = 'sawtooth';
            osc.frequency.value = note;
            osc2.type = 'square';
            osc2.frequency.value = note * 0.998; // Slight detune

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(200, now);
            filter.frequency.linearRampToValueAtTime(800, now + 0.1);
            filter.frequency.linearRampToValueAtTime(300, now + this.beatTime * 0.8);
            filter.Q.value = 4;

            // Sidechain-style envelope
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
            gain.gain.setValueAtTime(0.35, now + this.beatTime * 0.5);
            gain.gain.linearRampToValueAtTime(0.001, now + this.beatTime * 0.95);

            const mix = this.audioContext.createGain();
            mix.gain.value = 0.5;

            osc.connect(mix);
            osc2.connect(mix);
            mix.connect(filter);
            filter.connect(gain);
            gain.connect(this.compressor);

            osc.start(now);
            osc2.start(now);
            osc.stop(now + this.beatTime);
            osc2.stop(now + this.beatTime);

            noteIndex++;
            beat++;
        };

        this.intervals.push(setInterval(playBass, interval));
        playBass();
    }

    // Atmospheric pad for cold mountain air
    createPad() {
        const changeInterval = this.beatTime * 8000;
        const chords = [
            [220, 277.18, 329.63, 440],    // Am
            [196, 246.94, 293.66, 392],    // G
            [174.61, 220, 261.63, 349.23], // F
            [196, 246.94, 293.66, 392],    // G
        ];
        let chordIndex = 0;

        const playPad = () => {
            if (!this.isPlaying) return;
            const now = this.audioContext.currentTime;
            const chord = chords[chordIndex % chords.length];

            chord.forEach((freq, i) => {
                const osc = this.audioContext.createOscillator();
                const osc2 = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                osc.type = 'sine';
                osc.frequency.value = freq;
                osc2.type = 'triangle';
                osc2.frequency.value = freq * 1.002;

                filter.type = 'lowpass';
                filter.frequency.value = 2000;
                filter.Q.value = 0.5;

                // Slow swell
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.06, now + 2);
                gain.gain.setValueAtTime(0.06, now + this.beatTime * 6);
                gain.gain.linearRampToValueAtTime(0, now + this.beatTime * 8);

                const mix = this.audioContext.createGain();
                mix.gain.value = 0.5;

                osc.connect(mix);
                osc2.connect(mix);
                mix.connect(filter);
                filter.connect(gain);
                gain.connect(this.compressor);

                osc.start(now);
                osc2.start(now);
                osc.stop(now + this.beatTime * 8 + 0.1);
                osc2.stop(now + this.beatTime * 8 + 0.1);
            });

            chordIndex++;
        };

        this.intervals.push(setInterval(playPad, changeInterval));
        playPad();
    }

    // Subtle arpeggio for energy
    createArpeggio() {
        const sixteenth = this.beatTime * 250;
        const pattern = [0, 4, 7, 12, 7, 4, 0, 4]; // Octave arp pattern
        const roots = [440, 440, 587.33, 523.25]; // A4, A4, D5, C5
        let step = 0;
        let rootIndex = 0;

        const playArp = () => {
            if (!this.isPlaying) return;

            // Only play on certain bars for variation
            const barPosition = Math.floor(step / 16) % 4;
            if (barPosition === 0 || barPosition === 2) {
                const now = this.audioContext.currentTime;
                const root = roots[Math.floor(step / 32) % roots.length];
                const semitone = pattern[step % pattern.length];
                const freq = root * Math.pow(2, semitone / 12);

                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();

                osc.type = 'sawtooth';
                osc.frequency.value = freq;

                filter.type = 'lowpass';
                filter.frequency.value = 3000 + Math.sin(step * 0.1) * 1000;
                filter.Q.value = 2;

                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + sixteenth / 1000 * 0.9);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.compressor);

                osc.start(now);
                osc.stop(now + sixteenth / 1000);
            }

            step++;
        };

        this.intervals.push(setInterval(playArp, sixteenth));
    }

    // Occasional lead melody hits
    createLead() {
        const barLength = this.beatTime * 4000;
        const melodies = [
            [880, null, 783.99, null, 659.25, null, 783.99, null],
            [880, 783.99, null, 659.25, null, 587.33, 659.25, null],
            [1046.5, null, 880, null, 783.99, null, 659.25, null],
            [null, null, null, null, null, null, null, null], // Rest bar
        ];
        let bar = 0;

        const playBar = () => {
            if (!this.isPlaying) return;

            const melody = melodies[bar % melodies.length];
            const eighthNote = this.beatTime * 500;

            melody.forEach((freq, i) => {
                if (freq) {
                    this.timeouts.push(setTimeout(() => {
                        if (!this.isPlaying) return;
                        const now = this.audioContext.currentTime;

                        const osc = this.audioContext.createOscillator();
                        const osc2 = this.audioContext.createOscillator();
                        const gain = this.audioContext.createGain();
                        const filter = this.audioContext.createBiquadFilter();
                        const delay = this.audioContext.createDelay();
                        const delayGain = this.audioContext.createGain();

                        osc.type = 'square';
                        osc.frequency.value = freq;
                        osc2.type = 'sawtooth';
                        osc2.frequency.value = freq * 1.005;

                        filter.type = 'lowpass';
                        filter.frequency.value = 4000;
                        filter.Q.value = 1;

                        delay.delayTime.value = this.beatTime * 0.75;
                        delayGain.gain.value = 0.2;

                        gain.gain.setValueAtTime(0.1, now);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + eighthNote / 1000 * 1.5);

                        const mix = this.audioContext.createGain();
                        mix.gain.value = 0.5;

                        osc.connect(mix);
                        osc2.connect(mix);
                        mix.connect(filter);
                        filter.connect(gain);
                        gain.connect(this.compressor);

                        // Delay feedback
                        gain.connect(delay);
                        delay.connect(delayGain);
                        delayGain.connect(this.compressor);

                        osc.start(now);
                        osc2.start(now);
                        osc.stop(now + eighthNote / 1000 * 2);
                        osc2.stop(now + eighthNote / 1000 * 2);
                    }, i * eighthNote));
                }
            });

            bar++;
        };

        this.intervals.push(setInterval(playBar, barLength));
        this.timeouts.push(setTimeout(playBar, barLength * 2)); // Delay lead entry
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
        }
    }

    mute() {
        this.isMuted = true;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
        }
    }

    unmute() {
        this.isMuted = false;
        if (this.masterGain) {
            this.masterGain.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.1);
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
