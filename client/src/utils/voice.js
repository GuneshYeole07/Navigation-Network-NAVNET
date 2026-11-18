/** Spoken alerts so riders keep their eyes on the road (Web Speech API, works offline). */
const KEY = "navnet-voice";

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function voiceEnabled() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setVoiceEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (!on && voiceSupported()) window.speechSynthesis.cancel();
}

let voice;
function pickVoice() {
  if (voice !== undefined) return voice;
  const voices = window.speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang?.startsWith("en")) || null;
  return voice;
}

/** @param {boolean} urgent  interrupt whatever is being said (SOS, off-route) */
export function speak(text, { urgent = false } = {}) {
  if (!voiceSupported() || !voiceEnabled() || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1;
  if (urgent) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/**
 * iPhone Safari only allows speech and audio playback after a user tap, and only on
 * an <audio> element that was started inside that tap. On the first tap anywhere we
 * speak a silent utterance and "prime" one shared <audio> element; voice notes then
 * reuse that element so they can auto-play hands-free later.
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let sharedAudio;
export function sharedPlayer() {
  if (!sharedAudio && typeof Audio !== "undefined") {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
  }
  return sharedAudio;
}

export function installAudioUnlock() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    try {
      if (voiceSupported()) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
      const a = sharedPlayer();
      if (a && !a.dataset.unlocked) {
        a.src = SILENT_WAV;
        a.play().then(() => (a.dataset.unlocked = "1")).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    window.removeEventListener("touchend", unlock, true);
    window.removeEventListener("click", unlock, true);
  };
  window.addEventListener("touchend", unlock, true);
  window.addEventListener("click", unlock, true);
}
