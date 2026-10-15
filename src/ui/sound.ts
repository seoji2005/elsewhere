// C095b: a short synthesised checkout 'ding' (no audio files), quiet by default, with a remembered mute.
let audio: AudioContext | undefined, muted = false;
try { muted = localStorage.getItem('vworld.mute') === '1'; } catch { /* storage blocked: sound on */ }
export const isMuted = () => muted;
export function setMuted(on: boolean) {
  muted = on;
  try { localStorage.setItem('vworld.mute', on ? '1' : '0'); } catch { /* keep in memory only */ }
}
/** A bell-like ding; high adds the coin's second note. Silently does nothing without WebAudio or before a user gesture. */
export function ding(high = false) {
  if (muted || typeof AudioContext === 'undefined') return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime;
    for (const [freq, at] of high ? [[1320, 0], [1760, 0.09]] : [[1320, 0]]) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, start + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(start + at); osc.stop(start + at + 0.5);
    }
  } catch { /* audio unavailable */ }
}
