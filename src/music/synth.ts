export interface Synth {
  unlock: () => void;
  tone: (frequency: number, length?: number, wave?: OscillatorType, gain?: number, delay?: number, to?: number) => void;
  beat: (beat: number) => void;
  volume: (value: number) => void;
  pause: () => void;
  resume: () => void;
}

export const createSynth = (initialVolume: number): Synth => {
  let audio: AudioContext | undefined;
  let master: GainNode | undefined;
  const unlock = (): void => {
    if (!audio) {
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = initialVolume;
      master.connect(audio.destination);
    }
    void audio.resume();
  };
  // `delay` schedules against the AudioContext's own clock (`audio.currentTime + delay`) rather
  // than a `setTimeout`, so a multi-note jingle (`index.ts` updateStartLevelSelect) plays with
  // sample-accurate spacing regardless of the caller's own frame timing. `to`, when given, ramps
  // the oscillator's own frequency across the note's length instead of holding it flat — one real
  // sweep for the transition cue (`index.ts` advanceWave) rather than several discrete notes.
  const tone = (
    frequency: number,
    length = 0.08,
    wave: OscillatorType = "square",
    gain = 0.035,
    delay = 0,
    to?: number,
  ): void => {
    if (!audio || !master || audio.state !== "running") return;
    const t0 = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, t0 + length);
    envelope.gain.setValueAtTime(gain, t0);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    oscillator.connect(envelope).connect(master);
    oscillator.start(t0);
    oscillator.stop(t0 + length);
  };
  return {
    unlock,
    tone,
    beat: (beat: number): void => {
      // A walking bass (root, octave, fifth, octave) instead of a flat two-note click, under an
      // 8-step melodic arch twice its length so the whole sixteen-beat phrase takes 8s to repeat
      // rather than 4s.
      tone([55, 110, 82, 110][beat & 3]!, 0.09, "square", 0.025);
      tone([220, 277, 330, 415, 554, 415, 330, 277][(beat >> 1) & 7]!, 0.16, "triangle", 0.018);
    },
    volume: (value: number): void => {
      if (master) master.gain.value = value;
    },
    pause: (): void => {
      void audio?.suspend();
    },
    resume: (): void => {
      void audio?.resume();
    },
  };
};
