import type {
  CourseAssessmentType,
  CourseJoinMethod,
  CourseRole,
  LocaleCode,
  PlatformRole
} from "@nojv/domain";

import { getProblemDetail } from "./demo-data";

export interface CoursePocMember {
  courseRole: CourseRole;
  displayName: string;
  email: string;
  handle: string;
  joinedVia: CourseJoinMethod;
  platformRole: PlatformRole;
  userId: string;
}

export interface CoursePocAssessment {
  closesAt: string;
  dueAt: string;
  opensAt: string;
  problemSlugs: string[];
  scoreboardMode: "frozen" | "hidden" | "live";
  slug: string;
  summary: string;
  title: string;
  type: CourseAssessmentType;
}

export interface CoursePocDetail {
  description: string;
  joinChannels: {
    label: string;
    method: CourseJoinMethod;
    token: string;
  }[];
  locale: LocaleCode;
  members: CoursePocMember[];
  problemSlugs: string[];
  slug: string;
  title: string;
}

export interface CourseProblemCatalogEntry {
  authorHandle: string;
  slug: string;
  summary: string;
  title: string;
  visibility: "private" | "public";
}

function requireCourseProblem(slug: string) {
  const problem = getProblemDetail(slug);

  if (!problem) {
    throw new Error(`Unknown course POC problem slug: ${slug}`);
  }

  return problem;
}

export const coursePocDetails: (CoursePocDetail & { assessments: CoursePocAssessment[] })[] = [
  {
    assessments: [
      {
        closesAt: "2026-03-25T15:00:00.000Z",
        dueAt: "2026-03-23T15:00:00.000Z",
        opensAt: "2026-03-17T09:00:00.000Z",
        problemSlugs: ["warmup-sum", "process-log-parser"],
        scoreboardMode: "hidden",
        slug: "hw1-process-trace",
        summary:
          "Coursework-oriented assignment with a visible deadline and a private systems problem.",
        title: "Homework 1: Process Trace",
        type: "assignment"
      },
      {
        closesAt: "2026-04-02T12:00:00.000Z",
        dueAt: "2026-04-02T12:00:00.000Z",
        opensAt: "2026-04-02T09:00:00.000Z",
        problemSlugs: ["graph-docking", "fork-bomb-safeguard"],
        scoreboardMode: "live",
        slug: "midterm-systems-lab",
        summary:
          "Exam-style assessment with contest-grade pacing, live ranking, and tighter shell policy.",
        title: "Midterm Systems Lab",
        type: "exam"
      }
    ],
    description:
      "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
    joinChannels: [
      {
        label: "Course QR",
        method: "qr_code",
        token: "oslab-qr-2026"
      },
      {
        label: "Course code",
        method: "join_code",
        token: "OSLAB2026"
      },
      {
        label: "Manual roster sync",
        method: "manual_invite",
        token: "teacher-managed"
      }
    ],
    locale: "zh-TW",
    members: [
      {
        courseRole: "teacher",
        displayName: "Amelia Chen",
        email: "amelia.chen@nojv.local",
        handle: "teacher_amelia",
        joinedVia: "manual_invite",
        platformRole: "teacher",
        userId: "usr_teacher_amelia"
      },
      {
        courseRole: "ta",
        displayName: "Ren Wu",
        email: "ren.wu@nojv.local",
        handle: "ta_ren",
        joinedVia: "manual_invite",
        platformRole: "ta",
        userId: "usr_ta_ren"
      },
      {
        courseRole: "student",
        displayName: "Alice Huang",
        email: "alice.huang@nojv.local",
        handle: "stu_alice",
        joinedVia: "join_code",
        platformRole: "student",
        userId: "usr_student_alice"
      },
      {
        courseRole: "student",
        displayName: "Bob Lin",
        email: "bob.lin@nojv.local",
        handle: "stu_bob",
        joinedVia: "qr_code",
        platformRole: "student",
        userId: "usr_student_bob"
      }
    ],
    problemSlugs: ["warmup-sum", "graph-docking", "process-log-parser", "fork-bomb-safeguard"],
    slug: "os-lab-spring-2026",
    title: "Operating Systems Lab"
  },
  {
    assessments: [
      {
        closesAt: "2026-04-12T15:00:00.000Z",
        dueAt: "2026-04-10T15:00:00.000Z",
        opensAt: "2026-04-01T09:00:00.000Z",
        problemSlugs: ["warmup-sum", "distributed-labyrinth"],
        scoreboardMode: "hidden",
        slug: "hw2-graph-state",
        summary: "Algorithm homework with a longer open window and no live ranking pressure.",
        title: "Homework 2: Graph State Compression",
        type: "assignment"
      }
    ],
    description:
      "An algorithm design studio where the teacher curates a mixed shelf of public catalog problems and course-private derivatives.",
    joinChannels: [
      {
        label: "Studio QR",
        method: "qr_code",
        token: "algo-studio-qr"
      },
      {
        label: "Studio code",
        method: "join_code",
        token: "ALGOSTUDIO"
      },
      {
        label: "Manual roster sync",
        method: "manual_invite",
        token: "teacher-managed"
      }
    ],
    locale: "en",
    members: [
      {
        courseRole: "teacher",
        displayName: "Lin Carter",
        email: "lin.carter@nojv.local",
        handle: "teacher_lin",
        joinedVia: "manual_invite",
        platformRole: "teacher",
        userId: "usr_teacher_lin"
      },
      {
        courseRole: "student",
        displayName: "Maya Su",
        email: "maya.su@nojv.local",
        handle: "stu_maya",
        joinedVia: "qr_code",
        platformRole: "student",
        userId: "usr_student_maya"
      }
    ],
    problemSlugs: ["warmup-sum", "distributed-labyrinth"],
    slug: "algorithm-studio-2026",
    title: "Algorithm Studio"
  }
];

export const courseCards = coursePocDetails.map((course) => ({
  assessmentCount: course.assessments.length,
  memberCount: course.members.length,
  slug: course.slug,
  title: course.title
}));

export function getCourseDetail(slug: string) {
  return coursePocDetails.find((course) => course.slug === slug);
}

export function getCourseAssessment(courseSlug: string, assessmentSlug: string) {
  return getCourseDetail(courseSlug)?.assessments.find(
    (assessment) => assessment.slug === assessmentSlug
  );
}

export function getCourseProblemCatalog(courseSlug: string): CourseProblemCatalogEntry[] {
  const course = getCourseDetail(courseSlug);

  if (!course) {
    return [];
  }

  return course.problemSlugs.map((slug) => {
    const problem = requireCourseProblem(slug);

    return {
      authorHandle: problem.authorHandle,
      slug: problem.slug,
      summary: problem.summary,
      title: problem.title,
      visibility: problem.visibility
    };
  });
}
