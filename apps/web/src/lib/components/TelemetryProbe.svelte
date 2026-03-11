<script lang="ts">
  import { onMount } from "svelte";
  import type { CheatingSignal } from "@nojv/domain";
  import { authClient } from "$lib/auth-client";

  interface Props {
    assessment?: CheatingSignal["assessment"];
    contestSlug?: string;
    sessionId: string;
    signalSource: CheatingSignal["source"];
  }

  let { assessment, contestSlug, sessionId, signalSource }: Props = $props();

  onMount(() => {
    let recentSignals: CheatingSignal[] = [];
    let blurCount = 0;

    async function emitSignals(signals: CheatingSignal[]) {
      await fetch("/api/integrity/signals", {
        body: JSON.stringify(signals),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    }

    function bufferSignal(signal: Omit<CheatingSignal, "capturedAt">) {
      const snapshot: CheatingSignal = {
        ...signal,
        capturedAt: new Date().toISOString()
      };
      recentSignals = [...recentSignals, snapshot].slice(-4);
      void emitSignals(recentSignals);
    }

    function onWindowBlur() {
      blurCount += 1;
      bufferSignal({
        assessment,
        confidence: Math.min(0.9, 0.22 + blurCount * 0.14),
        contestSlug,
        payload: { blurCount },
        sessionId,
        source: signalSource,
        type: "focus_loss",
        userId: ""
      });
    }

    function onPaste(event: ClipboardEvent) {
      const pastedText = event.clipboardData?.getData("text") ?? "";
      if (pastedText.length < 24) return;

      bufferSignal({
        assessment,
        confidence: Math.min(0.96, 0.3 + pastedText.length / 600),
        contestSlug,
        payload: { pastedCharacters: pastedText.length },
        sessionId,
        source: signalSource,
        type: "paste_burst",
        userId: ""
      });
    }

    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("paste", onPaste);

    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("paste", onPaste);
    };
  });
</script>
