const STORAGE_KEY = "nojv:submission-feedback";

function playTone(success: boolean): void {
  try {
    const w: { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } =
      window;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const notes = success ? [523.25, 783.99] : [220, 164.81];
    for (const [i, freq] of notes.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Web Audio may be unavailable / blocked; ignore.
  }
}

function vibrate(success: boolean): void {
  try {
    const nav: { vibrate?: (pattern: number | number[]) => boolean } = navigator;
    if (nav.vibrate) nav.vibrate(success ? 30 : [40, 40, 40]);
  } catch {
    // Vibration unsupported; ignore.
  }
}

class SubmissionFeedback {
  enabled = $state(false);
  #hydrated = false;

  hydrate() {
    if (this.#hydrated) return;
    this.#hydrated = true;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage unavailable; keep default.
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? "1" : "0");
    } catch {
      // Quota / disabled storage — silently no-op.
    }
  }

  play(verdict: string) {
    if (!this.enabled) return;
    const success = verdict === "accepted";
    playTone(success);
    vibrate(success);
  }
}

export const submissionFeedback = new SubmissionFeedback();
