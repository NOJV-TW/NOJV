import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { clarificationDomain, ConflictError } from "@nojv/domain";
import { createSubscriber, keys } from "@nojv/redis";

import { createTestContest, createTestUser, testPrisma } from "../../fixtures/factories";

interface ActorUser {
  id: string;
  username: string | null;
  name: string;
  email: string;
  platformRole: "student" | "teacher" | "admin";
}

function actorFor(user: ActorUser) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

async function seedContestWithParticipant() {
  const organizer = await createTestUser({ platformRole: "teacher" });
  const contestant = await createTestUser({ platformRole: "student" });
  // Default createTestContest window is 2026-01-01 → 2026-12-31, which
  // covers today (2026-04-19) so assertContextActiveForAsk passes.
  const contest = await createTestContest({ createdByUserId: organizer.id });
  await testPrisma.participation.create({
    data: {
      type: "contest",
      contestId: contest.id,
      userId: contestant.id,
      status: "active",
    },
  });
  return { organizer, contestant, contest };
}

describe("clarification — SSE round trip + notification (real DB + Redis)", () => {
  it("ask publishes a 'created' SSE event with masked asker identity", async () => {
    const { organizer: _organizer, contestant, contest } = await seedContestWithParticipant();

    const sub = createSubscriber(process.env.REDIS_URL ?? "redis://localhost:6379");
    const events: { action: string; payload: Record<string, unknown> }[] = [];
    sub.on("message", (_channel, msg) => {
      events.push(JSON.parse(msg) as { action: string; payload: Record<string, unknown> });
    });
    await sub.subscribe(keys.clarificationChannel("contest", contest.id));

    try {
      await clarificationDomain.ask(actorFor(contestant), {
        context: { type: "contest", contestId: contest.id },
        questionText: "Is this mod 1e9+7?",
      });

      const deadline = Date.now() + 1000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe("created");
      expect(event.payload.contextType).toBe("contest");
      expect(event.payload.contextId).toBe(contest.id);
      // Masked projection: the asker's identity is nulled on the wire.
      // Staff fetch identity via GET; the SSE push is fail-safe by
      // default. This is the anonymity invariant enforced in
      // `publishClarificationEvent`.
      expect(event.payload.askedByUserId).toBeNull();
      expect(event.payload.askedBy).toBeNull();
    } finally {
      await sub.quit();
    }
  });

  it("answer publishes 'updated' event and writes a clarification_answered notification", async () => {
    const { organizer, contestant, contest } = await seedContestWithParticipant();

    const asked = await clarificationDomain.ask(actorFor(contestant), {
      context: { type: "contest", contestId: contest.id },
      questionText: "Is this modular arithmetic?",
    });

    // Subscribe AFTER the ask so we only collect the answer's "updated"
    // event (prevents the initial "created" from racing our assertion).
    const sub = createSubscriber(process.env.REDIS_URL ?? "redis://localhost:6379");
    const events: { action: string; payload: Record<string, unknown> }[] = [];
    sub.on("message", (_channel, msg) => {
      events.push(JSON.parse(msg) as { action: string; payload: Record<string, unknown> });
    });
    await sub.subscribe(keys.clarificationChannel("contest", contest.id));

    try {
      await clarificationDomain.answer(actorFor(organizer), asked.id, {
        answerText: "Yes, mod 1e9+7.",
      });

      const deadline = Date.now() + 1000;
      while (!events.some((e) => e.action === "updated") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(events.some((e) => e.action === "updated")).toBe(true);
      const updated = events.find((e) => e.action === "updated")!;
      expect(updated.payload.state).toBe("answered");
      expect(updated.payload.answerText).toBe("Yes, mod 1e9+7.");

      const notifs = await notificationRepo.listRecent(contestant.id, 10);
      const row = notifs.find((n) => n.type === "clarification_answered");
      expect(row).toBeDefined();
      expect(row!.linkUrl).toBe(`/contests/${contest.id}#clarification-${asked.id}`);
      const params = row!.params as { contextType: string; questionPreview: string };
      expect(params.contextType).toBe("contest");
      expect(params.questionPreview.startsWith("Is this modular")).toBe(true);
    } finally {
      await sub.quit();
    }
  });

  it("state machine rejects answering a dismissed clarification", async () => {
    const { organizer, contestant, contest } = await seedContestWithParticipant();

    const asked = await clarificationDomain.ask(actorFor(contestant), {
      context: { type: "contest", contestId: contest.id },
      questionText: "This question will be dismissed.",
    });

    await clarificationDomain.dismiss(actorFor(organizer), asked.id);

    await expect(
      clarificationDomain.answer(actorFor(organizer), asked.id, {
        answerText: "Too late.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("state machine rejects dismissing an answered clarification", async () => {
    const { organizer, contestant, contest } = await seedContestWithParticipant();

    const asked = await clarificationDomain.ask(actorFor(contestant), {
      context: { type: "contest", contestId: contest.id },
      questionText: "This question will be answered.",
    });

    await clarificationDomain.answer(actorFor(organizer), asked.id, {
      answerText: "Here's the answer.",
    });

    await expect(
      clarificationDomain.dismiss(actorFor(organizer), asked.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rate limit rejects the 6th question within a 10-minute window", async () => {
    const { contestant, contest } = await seedContestWithParticipant();

    // First 5 asks succeed.
    for (let i = 0; i < 5; i++) {
      await clarificationDomain.ask(actorFor(contestant), {
        context: { type: "contest", contestId: contest.id },
        questionText: `Question number ${i + 1} about the problem.`,
      });
    }

    // The 6th trips the limiter.
    await expect(
      clarificationDomain.ask(actorFor(contestant), {
        context: { type: "contest", contestId: contest.id },
        questionText: "One too many questions here now.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
