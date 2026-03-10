"use client";

import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  integrityAssessmentSchema,
  type CheatingSignal,
  type IntegrityAssessment
} from "@nojv/domain";
import { shellClassNames } from "@nojv/ui";

import { authClient } from "@/lib/auth-client";

const emptyAssessment: IntegrityAssessment = {
  level: "low",
  reasons: ["No suspicious editor telemetry has been buffered yet."],
  recommendedAction: "monitor",
  score: 0
};

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
  const [riskAssessment, setRiskAssessment] = useState<IntegrityAssessment>(emptyAssessment);
  const [signalCount, setSignalCount] = useState(0);
  const recentSignalsRef = useRef<CheatingSignal[]>([]);
  const blurCountRef = useRef(0);

  const emitSignals = useEffectEvent(async (signals: CheatingSignal[]) => {
    const response = await fetch("/api/integrity/signals", {
      body: JSON.stringify(signals),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return;
    }

    const payload = integrityAssessmentSchema.parse(await response.json());

    startTransition(() => {
      setRiskAssessment(payload);
      setSignalCount(signals.length);
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

  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>Integrity telemetry</p>
          <p className="mt-1 text-lg font-semibold">Live editor risk readout</p>
        </div>
        <span className={shellClassNames.badge}>{riskAssessment.level}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className="text-sm text-[color:var(--color-muted)]">Risk score</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">
            {riskAssessment.score}
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4">
          <p className="text-sm text-[color:var(--color-muted)]">Buffered signals</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-4xl">{signalCount}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
        {riskAssessment.reasons[0]}
      </p>
    </section>
  );
}
