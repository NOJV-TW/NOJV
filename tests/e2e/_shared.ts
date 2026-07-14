import path from "node:path";
import {
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

export const ORIGIN = "http://localhost:5174";

export const adminAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/admin.json",
);
export const teacherAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/teacher.json",
);
export const studentAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/student.json",
);
export const newStudentAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/new-student.json",
);

export const apiWriteHeaders = {
  origin: ORIGIN,
  "x-requested-with": "fetch",
} as const;

export const formActionHeaders = {
  origin: ORIGIN,
} as const;

export interface LiveSession {
  session?: { id?: string };
  user?: { id?: string };
}

export async function newLiveApiContext(page: Page): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: ORIGIN,
    storageState: await page.context().storageState(),
  });
}

export async function readLiveSession(page: Page): Promise<LiveSession> {
  const api = await newLiveApiContext(page);
  try {
    const response = await api.get("/api/auth/get-session");
    if (!response.ok()) {
      throw new Error(`Session lookup failed with HTTP ${String(response.status())}.`);
    }
    return (await response.json()) as LiveSession;
  } finally {
    await api.dispose();
  }
}
