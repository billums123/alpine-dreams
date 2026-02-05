/**
 * Music - Upbeat background music with drums using Web Audio API
 */

export class Music {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.oscillators = [];
        this.intervals = [];
        this.volume = 0.4;
        this.bpm = 110;
    }

    init() {
        // Try to start immediately, will work after user interaction
        this.tryStart();

        // Also listen for interaction as fallback
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
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.volume;
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

    play() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;

        this.createDrumBeat();
        this.createBassLine();
        this.createChords();
        this.createMelody();
    }

    // Upbeat drum pattern
    createDrumBeat() {
        const beatInterval = 60000 / this.bpm;

        let beat = 0;
        const playBeat = () => {
            if (!this.isPlaying) return;

            const now = this.audioContext.currentTime;

            // Kick on 1 and 3
            if (beat % 4 === 0 || beat % 4 === 2) {
                this.playKick(now);
            }

            // Snare on 2 and 4
            if (beat % 4 === 1 || beat % 4 === 3) {
                this.playSnare(now);
            }

            // Hi-hat on every beat
            this.playHiHat(now);

            // Extra hi-hat on off-beats for energy
            if (beat % 2 === 0) {
                this.playHiHat(now + beatInterval / 2000, 0.5);
            }

            beat++;
        };

        const interval = setInterval(playBeat, beatInterval);
        this.intervals.push(interval);
        playBeat();
    }

    playKick(time) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);

        gain.gain.setValueAtTime(0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.3);
    }

    playSnare(time) {
        // Noise burst for snare
        const bufferSize = this.audioContext.sampleRate * 0.1;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const noiseGain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        filter.type = 'highpass';
        filter.frequency.value = 1000;

        noiseGain.gain.setValueAtTime(0.3, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(time);

        // Add tone body
        const osc = this.audioContext.createOscillator();
        const oscGain = this.audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 200;
        oscGain.gain.setValueAtTime(0.2, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(time);
        osc.stop(time + 0.1);
    }

    playHiHat(time, volume = 1) {
        const bufferSize = this.audioContext.sampleRate * 0.05;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;

        const gain = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();

        filter.type = 'highpass';
        filter.frequency.value = 7000;

        gain.gain.setValueAtTime(0.15 * volume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(time);
    }

    // Groovy bass line
    createBassLine() {
        const beatInterval = 60000 / this.bpm;
        const notes = [130.81, 130.81, 164.81, 146.83]; // C3, C3, E3, D3
        let noteIndex = 0;

        const playBass = () => {
            if (!this.isPlaying) return;

            const freq = notes[noteIndex % notes.length];
            const now = this.audioContext.currentTime;

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.type = 'sawtooth';
            osc.frequency.value = freq;

            filter.type = 'lowpass';
            filter.frequency.value = 400;
            filter.Q.value = 5;

            gain.gain.setValueAtTime(0.25, now);
            gain.gain.setValueAtTime(0.25, now + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc.stop(now + 0.5);

            noteIndex++;
        };

        const interval = setInterval(playBass, beatInterval * 2);
        this.intervals.push(interval);
        playBass();
    }

    // Chord stabs
    createChords() {
        const beatInterval = 60000 / this.bpm;
        const chords = [
            [261.63, 329.63, 392.00], // C major
            [293.66, 369.99, 440.00], // D major
            [329.63, 415.30, 493.88], // E minor
            [293.66, 369.99, 440.00], // D major
        ];
        let chordIndex = 0;

        const playChord = () => {
            if (!this.isPlaying) return;

            const chord = chords[chordIndex % chords.length];
            const now = this.audioContext.currentTime;

            chord.forEach((freq) => {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'square';
                osc.frequency.value = freq;

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
                gain.gain.setValueAtTime(0.08, now + 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

                osc.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + 0.35);
            });

            chordIndex++;
        };

        const interval = setInterval(playChord, beatInterval * 4);
        this.intervals.push(interval);
        setTimeout(playChord, beatInterval * 2);
    }

    // Fun melodic riff
    createMelody() {
        const beatInterval = 60000 / this.bpm;
        const melody = [523.25, 587.33, 659.25, 587.33, 523.25, 493.88, 440.00, 493.88]; // C5, D5, E5, D5, C5, B4, A4, B4
        let noteIndex = 0;

        const playNote = () => {
            if (!this.isPlaying) return;

            // Only play some notes for variation
            if (Math.random() > 0.3) {
                const freq = melody[noteIndex % melody.length];
                const now = this.audioContext.currentTime;

                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq;

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

                osc.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + 0.25);
            }

            noteIndex++;
        };

        const interval = setInterval(playNote, beatInterval / 2);
        this.intervals.push(interval);
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
            this.masterGain.gain.value = 0;
        }
    }

    unmute() {
        this.isMuted = false;
        if (this.masterGain) {
            this.masterGain.gain.value = this.volume;
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
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        this.oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
        });
        this.oscillators = [];
    }
}
