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
      eyebrow: "Online Judge Platform",
      subtitle:
        "Practice, assignments, contests, and integrity workflows live on the same execution backbone.",
      title:
        "A modern OJ that treats judging, workspace isolation, and anti-cheat as first-class systems."
    },
    integrity: {
      heading: "Integrity pipeline",
      subtitle: "Signals are stored as evidence so reviewers can trace why a case was opened."
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
      eyebrow: "線上評測平台",
      subtitle: "練習、作業、競賽與誠信稽核共用同一條執行骨幹，不再是互相拼湊的子系統。",
      title: "把評測、獨立作業區與反作弊視為一等公民的現代 OJ。"
    },
    integrity: {
      heading: "誠信偵測管線",
      subtitle: "所有可疑訊號都保存成證據，而不是只留下模糊的作弊布林值。"
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
