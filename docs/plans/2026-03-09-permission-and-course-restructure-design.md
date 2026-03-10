# Permission & Course Architecture Restructure

## Goals

1. Reorganize course page routes — separate student views from management views
2. Centralize permission logic into a single authorization module
3. Break down oversized components into focused, single-responsibility pieces

## Route Structure

```
[locale]/
├── courses/
│   ├── page.tsx                          # Course list
│   └── [slug]/
│       ├── page.tsx                      # Course home (student view)
│       ├── assignments/
│       │   └── [assessmentSlug]/
│       │       └── page.tsx              # Assignment page
│       ├── exams/
│       │   └── [assessmentSlug]/
│       │       └── page.tsx              # Exam page
│       └── manage/
│           ├── layout.tsx                # Auth guard (teacher/ta/admin)
│           ├── page.tsx                  # Management dashboard
│           ├── members/
│           │   └── page.tsx              # Member management
│           ├── problems/
│           │   └── page.tsx              # Course problem management
│           └── assessments/
│               └── page.tsx              # Assessment create/publish/archive
├── problems/                             # No changes
├── contests/                             # No changes
├── submissions/                          # No changes
└── join/                                 # No changes
```

### Key changes
- New `manage/` sub-routes extracted from `course-management-console`
- `manage/layout.tsx` handles teacher/ta/admin permission check once
- Student-facing routes unchanged

## Authorization Module

```
lib/server/authorization/
├── index.ts              # Re-exports
├── roles.ts              # Role resolution (pure + DB-aware)
│   ├── resolveCoursePermissionRole(platformRole, membership) → EffectiveCourseRole | null
│   └── resolveEffectiveRole(actor, courseSlug) → EffectiveCourseRole | null
├── permissions.ts        # Pure boolean checks, no DB access
│   ├── canCreateCourse(platformRole)
│   ├── canCreateProblem(platformRole)
│   ├── canManageCourseMembership(role)
│   ├── canPublishAssessment(role)
│   ├── canManageCourseProblems(role)
│   └── canViewManagePanel(role)
└── guards.ts             # Throws/redirects on failure, used by pages and API routes
    ├── requireAuth(request?) → Actor
    ├── requirePlatformRole(actor, ...roles) → void
    └── requireCourseRole(actor, courseSlug, ...roles) → EffectiveCourseRole
```

### Migration
- `course-authorization.ts` → `permissions.ts` + `roles.ts`, then delete
- `poc-persistence.ts` role resolution → `roles.ts`
- `api-handler.ts` `withAuth` kept, internally uses `guards.ts`

## Component Restructure

### New structure
```
components/
├── course/
│   ├── course-dashboard.tsx              # Student course home
│   ├── course-assessment-board.tsx       # Keep (student assessment list)
│   ├── course-problem-shelf.tsx          # Keep (student problem list)
│   └── course-join-call-to-action.tsx    # Keep
├── course-manage/
│   ├── manage-members.tsx                # Member list + invite/remove
│   ├── manage-problems.tsx               # Problem add/remove
│   ├── manage-assessments.tsx            # Assessment create/publish/archive
│   └── manage-nav.tsx                    # Management navigation
```

### Cleanup
- Delete `course-management-console.tsx` after extraction
- Merge `course-membership-panel.tsx` into `manage-members.tsx`, then delete
- Keep `course-creation-panel.tsx` (independent flow)

### manage/layout.tsx pattern
```typescript
export default async function ManageLayout({ children, params }) {
  const actor = await requireAuth()
  const { slug } = await params
  const role = await requireCourseRole(actor, slug, 'admin', 'teacher', 'ta')

  return (
    <div>
      <ManageNav slug={slug} role={role} />
      {children}
    </div>
  )
}
```

## Implementation Order

1. Create `lib/server/authorization/` module (migrate existing logic)
2. Create `manage/` route group with layout guard
3. Extract components from `course-management-console` into `course-manage/`
4. Update course home page to use student-only components
5. Clean up deleted files and update imports
