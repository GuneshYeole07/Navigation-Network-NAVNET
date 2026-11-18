/** Loud, repeating two-tone alarm for unacknowledged SOS (Web Audio, no audio files). */
let ctx = null;
let timer = null;

function beep(freq, at, dur) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function startAlarm() {
  if (timer) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
  } catch {
    return;
  }
  const cycle = () => {
    const t = ctx.currentTime;
    beep(880, t, 0.22);
    beep(660, t + 0.28, 0.22);
    beep(880, t + 0.56, 0.22);
  };
  cycle();
  timer = setInterval(cycle, 1600);
}

export function stopAlarm() {
  clearInterval(timer);
  timer = null;
}
