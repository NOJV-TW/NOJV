import { redirect } from "@sveltejs/kit";
import { examDomain, NotFoundError, proctoringDomain } from "@nojv/domain";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getExamDetailPage } = examDomain;

// Default C++17 starter template — matches the design's pre-filled
// editor content so the take view always has something to render even
// before the user picks a language.
const DEFAULT_CPP_STARTER = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x : a) cin >> x;

    // TODO: implement

    return 0;
}
`;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  const actor = requireAuth(event);
  const examId = event.params.examId;

  // Managers don't take exams — bounce them back to the detail page
  // with a banner instead of letting them enter a broken state.
  if (isManager) {
    redirect(303, `/exams/${examId}`);
  }

  // Re-check the proctoring gate. The layout already passed us through,
  // but the take view is stricter: it requires the exam to be live
  // (not_started / ended both bounce back to detail).
  const verdict = await proctoringDomain.checkProctoringGate({
    entityKind: "exam",
    entityId: examId,
    userId: actor.userId,
    ip: getClientIp(event),
  });

  if (!verdict.ok) {
    redirect(303, `/exams/${examId}`);
  }

  const detail = await getExamDetailPage(examId, {
    viewerUserId: actor.userId,
    isManager,
  });
  if (detail?.courseId !== examHeader.courseId) {
    throw new NotFoundError("Exam not found.");
  }

  // Hard gate: only allow entry while the exam window is open.
  const now = Date.now();
  const startsAt = new Date(detail.startsAt).getTime();
  const endsAt = new Date(detail.endsAt).getTime();
  if (now < startsAt || now >= endsAt) {
    redirect(303, `/exams/${examId}`);
  }

  return {
    detail,
    starterCode: DEFAULT_CPP_STARTER,
  };
});
