"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  actorIdentitySchema,
  buildActorRequestHeaders,
  defaultLocalActor,
  localActorPresets,
  type ActorIdentity
} from "@nojv/domain";
import { shellClassNames } from "@nojv/ui";

const actorStorageKey = "nojv.local-actor";

const actorPresetEntries = [
  {
    actor: localActorPresets.teacher,
    key: "teacher",
    label: "Teacher"
  },
  {
    actor: localActorPresets.ta,
    key: "ta",
    label: "TA (student)"
  },
  {
    actor: localActorPresets.student,
    key: "student",
    label: "Student"
  },
  {
    actor: localActorPresets.admin,
    key: "admin",
    label: "Admin"
  }
] as const;

interface ActorSessionValue {
  actor: ActorIdentity;
  actorHeaders: Record<string, string>;
  setActor: (actor: ActorIdentity) => void;
}

const ActorSessionContext = createContext<ActorSessionValue | null>(null);

function sameActor(left: ActorIdentity, right: ActorIdentity) {
  return (
    left.userId === right.userId &&
    left.platformRole === right.platformRole &&
    left.handle === right.handle &&
    left.email === right.email &&
    left.displayName === right.displayName
  );
}

function resolvePresetKey(actor: ActorIdentity) {
  return actorPresetEntries.find((entry) => sameActor(entry.actor, actor))?.key ?? "student";
}

export function ActorSessionProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<ActorIdentity>(() => {
    if (typeof window === "undefined") {
      return defaultLocalActor;
    }

    const stored = window.localStorage.getItem(actorStorageKey);

    if (!stored) {
      return defaultLocalActor;
    }

    try {
      const parsed = actorIdentitySchema.safeParse(JSON.parse(stored) as unknown);

      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      window.localStorage.removeItem(actorStorageKey);
    }

    return defaultLocalActor;
  });

  useEffect(() => {
    window.localStorage.setItem(actorStorageKey, JSON.stringify(actor));
  }, [actor]);

  const value = useMemo<ActorSessionValue>(
    () => ({
      actor,
      actorHeaders: buildActorRequestHeaders(actor),
      setActor
    }),
    [actor]
  );

  return <ActorSessionContext.Provider value={value}>{children}</ActorSessionContext.Provider>;
}

export function ActorSessionControl() {
  const { actor, setActor } = useActorSession();

  return (
    <section className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-3">
      <div className="flex flex-col gap-2">
        <p className={shellClassNames.eyebrow}>Local actor</p>
        <label className="text-sm text-[color:var(--color-muted)]">
          <span className="sr-only">Select local actor</span>
          <select
            className="mt-1 w-full rounded-2xl border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm text-[color:var(--color-ink)]"
            onChange={(event) => {
              const preset = actorPresetEntries.find(
                (entry) => entry.key === event.target.value
              );

              if (preset) {
                setActor(preset.actor);
              }
            }}
            value={resolvePresetKey(actor)}
          >
            {actorPresetEntries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} · {entry.actor.displayName}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[color:var(--color-muted)]">
          {actor.platformRole} · {actor.handle}
        </p>
      </div>
    </section>
  );
}

export function useActorSession() {
  const value = useContext(ActorSessionContext);

  if (!value) {
    throw new Error("useActorSession must be used within ActorSessionProvider.");
  }

  return value;
}
