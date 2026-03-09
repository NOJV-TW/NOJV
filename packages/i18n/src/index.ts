import { localeCodes, localeCodeSchema, type LocaleCode } from "@nojv/domain";

export const locales = [...localeCodes];
export const defaultLocale: LocaleCode = "zh-TW";

export interface SharedCopy {
  hero: {
    eyebrow: string;
    subtitle: string;
    title: string;
  };
  integrity: {
    heading: string;
    subtitle: string;
  };
  navigation: {
    contests: string;
    courses: string;
    dashboard: string;
    integrity: string;
    problems: string;
    submissions: string;
    workspace: string;
  };
  submissions: {
    date: string;
    empty: string;
    heading: string;
    language: string;
    problem: string;
    runtime: string;
    score: string;
    signInRequired: string;
    status: string;
  };
  workspace: {
    commandLabel: string;
    policyLabel: string;
    runLabel: string;
    subtitle: string;
    title: string;
  };
}

export const copy: Record<LocaleCode, SharedCopy> = {
  en: {
    hero: {
      eyebrow: "Online Judge",
      subtitle: "Solve problems, join contests, and track your progress.",
      title: "Practice, Compete, Learn"
    },
    integrity: {
      heading: "Integrity",
      subtitle: "Review flagged cases and cheating signals."
    },
    navigation: {
      contests: "Contests",
      courses: "Courses",
      dashboard: "Overview",
      integrity: "Integrity",
      problems: "Problems",
      submissions: "Submissions",
      workspace: "Workspace"
    },
    submissions: {
      date: "Date",
      empty: "No submissions yet.",
      heading: "Your Submissions",
      language: "Language",
      problem: "Problem",
      runtime: "Runtime",
      score: "Score",
      signInRequired: "Please sign in to view submissions.",
      status: "Status"
    },
    workspace: {
      commandLabel: "Command policy",
      policyLabel: "Isolation mode",
      runLabel: "Run workspace",
      subtitle:
        "Execute makefiles, shell commands, and assignment workflows inside isolated sandboxes.",
      title: "Workspace"
    }
  },
  "zh-TW": {
    hero: {
      eyebrow: "線上評測",
      subtitle: "解題、參加競賽、追蹤你的學習進度。",
      title: "練習、競賽、學習"
    },
    integrity: {
      heading: "誠信中心",
      subtitle: "檢視標記案件與可疑訊號。"
    },
    navigation: {
      contests: "競賽區",
      courses: "課程",
      dashboard: "總覽",
      integrity: "誠信中心",
      problems: "題庫",
      submissions: "提交紀錄",
      workspace: "作業區"
    },
    submissions: {
      date: "提交時間",
      empty: "尚無提交紀錄。",
      heading: "你的提交紀錄",
      language: "語言",
      problem: "題目",
      runtime: "執行時間",
      score: "分數",
      signInRequired: "請先登入以查看提交紀錄。",
      status: "狀態"
    },
    workspace: {
      commandLabel: "指令政策",
      policyLabel: "隔離模式",
      runLabel: "執行作業區",
      subtitle: "在獨立沙盒內執行 makefile、shell 指令與課程作業流程。",
      title: "Workspace"
    }
  }
};

export function isLocale(value: string): value is LocaleCode {
  return localeCodeSchema.safeParse(value).success;
}

export function resolveLocale(value?: string): LocaleCode {
  if (!value) {
    return defaultLocale;
  }

  return isLocale(value) ? value : defaultLocale;
}

export function getCopy(locale?: string): SharedCopy {
  return copy[resolveLocale(locale)];
}

export type { LocaleCode };
