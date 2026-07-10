import { submissionRepo, userRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";
import { getSubmissionActivity, type SubmissionActivityEvent } from "./activity";

const ACTIVITY_WINDOW_DAYS = 371;

export interface ProfileViewer {
  userId: string;
  isAdmin: boolean;
}

export function canViewProfile(
  viewer: ProfileViewer | null,
  target: { id: string; profilePublic: boolean },
): boolean {
  if (target.profilePublic) return true;
  if (!viewer) return false;
  return viewer.userId === target.id || viewer.isAdmin;
}

export interface PublicProfile {
  user: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    profilePublic: boolean;
    createdAt: Date;
  };
  solvedProblems: {
    id: string;
    displayId: number | null;
    title: string;
    difficulty: string;
    tags: string[];
  }[];
  byDifficulty: { difficulty: string; acCount: number }[];
  byLanguage: { language: string; count: number }[];
  activity: SubmissionActivityEvent[];
}

export async function getPublicProfile(
  userId: string,
  now: Date = new Date(),
): Promise<PublicProfile> {
  const user = await userRepo.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [publicAc, languageGroups, activity] = await Promise.all([
    submissionRepo.findDistinctPublicAcByUser(userId),
    submissionRepo.groupByLanguageForUser(userId),
    getSubmissionActivity(userId, since),
  ]);

  const difficultyCounts = new Map<string, number>();
  for (const row of publicAc) {
    difficultyCounts.set(
      row.problem.difficulty,
      (difficultyCounts.get(row.problem.difficulty) ?? 0) + 1,
    );
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
      profilePublic: user.profilePublic,
      createdAt: user.createdAt,
    },
    solvedProblems: publicAc.map((row) => ({
      id: row.problem.id,
      displayId: row.problem.displayId,
      title: row.problem.title,
      difficulty: row.problem.difficulty,
      tags: row.problem.tags,
    })),
    byDifficulty: [...difficultyCounts.entries()]
      .map(([difficulty, acCount]) => ({ difficulty, acCount }))
      .sort((a, b) => b.acCount - a.acCount),
    byLanguage: languageGroups
      .map((g) => ({ language: g.language, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    activity,
  };
}

export async function updateProfileVisibility(userId: string, profilePublic: boolean) {
  await userRepo.update(userId, { profilePublic });
}
