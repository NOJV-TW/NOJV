import { randomBytes } from "node:crypto";

import { notificationPreferenceRepo, userRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";
import { z } from "zod";

import { ForbiddenError, ValidationError } from "../shared/errors";

const TOKEN_TTL_SECONDS = 30 * 60;

const pendingSchema = z.object({ userId: z.string(), email: z.email() });

export interface NotificationEmailState {
  email: string | null;
  verified: boolean;
}

export async function getNotificationEmail(userId: string): Promise<NotificationEmailState> {
  const row = await notificationPreferenceRepo.get(userId);
  return { email: row?.email ?? null, verified: Boolean(row?.email && row.emailVerifiedAt) };
}

export async function requestNotificationEmail(userId: string, input: string): Promise<string> {
  const email = z.email().safeParse(input.trim().toLowerCase());
  if (!email.success) throw new ValidationError("INVALID_EMAIL");
  const user = await userRepo.findById(userId);
  if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
  const token = randomBytes(32).toString("hex");
  await getRedis().set(
    keys.notificationEmailVerify(token),
    JSON.stringify({ userId, email: email.data }),
    "EX",
    TOKEN_TTL_SECONDS,
  );
  return token;
}

export type VerifyNotificationEmailResult =
  { status: "error"; detail: string } | { status: "success"; email: string };

export async function peekNotificationEmail(
  token: string,
): Promise<VerifyNotificationEmailResult> {
  const raw = await getRedis().get(keys.notificationEmailVerify(token));
  const parsed = pendingSchema.safeParse(raw ? JSON.parse(raw) : null);
  if (!parsed.success) return { status: "error", detail: "驗證連結已過期或無效" };
  return { status: "success", email: parsed.data.email };
}

export async function verifyNotificationEmail(
  token: string,
): Promise<VerifyNotificationEmailResult> {
  const key = keys.notificationEmailVerify(token);
  const raw = await getRedis().getdel(key);
  const parsed = pendingSchema.safeParse(raw ? JSON.parse(raw) : null);
  if (!parsed.success) return { status: "error", detail: "驗證連結已過期或無效" };
  const user = await userRepo.findById(parsed.data.userId);
  if (!user || user.disabled) return { status: "error", detail: "驗證連結已過期或無效" };
  await notificationPreferenceRepo.setEmail(parsed.data.userId, parsed.data.email, new Date());
  return { status: "success", email: parsed.data.email };
}

export async function clearNotificationEmail(userId: string): Promise<void> {
  await notificationPreferenceRepo.setEmail(userId, null, null);
}
