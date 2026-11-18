import { useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { assetUrl } from "../services/api";
import { sharedPlayer, voiceEnabled } from "../utils/voice";

/**
 * Plays incoming push-to-talk clips one after another, hands-free (helmet earphones).
 * If the browser blocks autoplay, shows a tap-to-play toast instead.
 */
export function useVoicePlayer() {
  const queue = useRef([]);
  const playing = useRef(false);

  const playNext = useCallback(() => {
    const m = queue.current.shift();
    if (!m) {
      playing.current = false;
      return;
    }
    playing.current = true;
    // Reuse the element unlocked by the first tap (required for autoplay on iPhone).
    const audio = sharedPlayer() || new Audio();
    audio.onended = playNext;
    audio.onerror = playNext;
    audio.src = assetUrl(m.audioUrl);
    try {
      window.speechSynthesis?.cancel(); // don't talk over a friend
    } catch {
      /* ignore */
    }
    audio.play().catch(() => {
      // Autoplay blocked (no tap on the page yet): it's waiting in chat with a play button.
      toast(`🎙 Voice message from ${m.senderName} — open chat to play`, { duration: 6000 });
      playNext();
    });
  }, []);

  const enqueue = useCallback(
    (m) => {
      if (!voiceEnabled()) return;
      queue.current.push(m);
      if (!playing.current) playNext();
    },
    [playNext],
  );

  useEffect(() => () => (queue.current = []), []);
  return { enqueue };
}
