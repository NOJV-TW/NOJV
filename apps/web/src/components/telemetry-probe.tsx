"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import type { CheatingSignal } from "@nojv/domain";

import { authClient } from "@/lib/auth-client";

interface TelemetryProbeProps {
  assessment?: CheatingSignal["assessment"];
  contestSlug?: string | undefined;
  sessionId: string;
  signalSource: CheatingSignal["source"];
}

export function TelemetryProbe({
  assessment,
  contestSlug,
  sessionId,
  signalSource
}: TelemetryProbeProps) {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "";
  const recentSignalsRef = useRef<CheatingSignal[]>([]);
  const blurCountRef = useRef(0);

  const emitSignals = useEffectEvent(async (signals: CheatingSignal[]) => {
    await fetch("/api/integrity/signals", {
      body: JSON.stringify(signals),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  });

  const bufferSignal = useEffectEvent((signal: Omit<CheatingSignal, "capturedAt">) => {
    const snapshot: CheatingSignal = {
      ...signal,
      capturedAt: new Date().toISOString()
    };

    recentSignalsRef.current = [...recentSignalsRef.current, snapshot].slice(-4);
    void emitSignals(recentSignalsRef.current);
  });

  useEffect(() => {
    const onWindowBlur = () => {
      blurCountRef.current += 1;

      bufferSignal({
        assessment,
        confidence: Math.min(0.9, 0.22 + blurCountRef.current * 0.14),
        contestSlug,
        payload: {
          blurCount: blurCountRef.current
        },
        sessionId,
        source: signalSource,
        type: "focus_loss",
        userId
      });
    };

    const onPaste = (event: ClipboardEvent) => {
      const pastedText = event.clipboardData?.getData("text") ?? "";

      if (pastedText.length < 24) {
        return;
      }

      bufferSignal({
        assessment,
        confidence: Math.min(0.96, 0.3 + pastedText.length / 600),
        contestSlug,
        payload: {
          pastedCharacters: pastedText.length
        },
        sessionId,
        source: signalSource,
        type: "paste_burst",
        userId
      });
    };

    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("paste", onPaste);

    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("paste", onPaste);
    };
  }, [userId, assessment, contestSlug, sessionId, signalSource]);

  return null;
}
