# App Restructure Design

## Platform Identity (3 types)

| Identity | Capabilities |
|----------|-------------|
| Admin | Superuser. Can set accounts to Teacher. Can access any course. |
| Teacher | Can create courses. In own courses, can promote students to TA. |
| Student | Default identity. Join courses, submit answers, create own problems. |

Note: "TA" is NOT a platform identity — it's a course-level role.

## Course Roles (3 types)

| Role | Source | In-course capabilities |
|------|--------|----------------------|
| Teacher | Created the course, or invited by another teacher | Full management. Can promote students to TA. Can invite other teachers. |
| TA | Promoted by course teacher | Manage assignments/exams, add problems, view grades. Cannot promote others. |
| Student | Joined via QR/join code/manual invite | View assignments/exams, submit answers, view own grades. |

### Course role rules:
- All teachers in a course have equal permissions
- Teachers can invite other teachers into the course
- No one can remove others — members can only leave voluntarily or be removed by platform Admin
- A person can be TA in course A and Student in course B

### Permission granting chain:
- Admin → can set platform identity to Teacher
- Teacher → can promote Student to TA within own course
- Course join methods: QR code, join code, manual invite

## Problem System

### Problem as independent entity:
- Owner (creator)
- Visibility: private / public
- Edit permission list (which users can edit)

### Problem permissions:
- **Everyone**: create problems, make own problems public, edit problems they have permission for
- **Course teacher/TA**: add problems to course assignments/exams

### Problem lifecycle:
1. Anyone creates a problem → private, only creator can see and edit
2. Creator can manually set to "public" → appears in public problem library
3. Problem added to course assignment/exam → all course teachers and TAs automatically get edit permission
4. Assignment/exam starts → course students can see and submit
5. Problem removed from assignment/exam → revoke course-granted edit permissions

### `/problems` page — two tabs:
- **Public Library**: all public problems, everyone can browse and submit
- **My Problems**: all problems I have edit permission for (created by me + granted via courses), can create new / edit / set public

## Navigation

Unified for all identities:

```
Homepage / Problems / Courses / Assignments / Exams
```

Right side: user menu (settings, sign out)

Differences are in page content, not routes:
- Admin: sees admin actions in context (e.g. set user as Teacher)
- Teacher: sees "Create Course" button on `/courses`
- Everyone: sees "Create Problem" button on `/problems` My Problems tab

## Page Routes

| Route | Purpose |
|-------|---------|
| `/` | Homepage |
| `/problems` | Two tabs: Public Library / My Problems |
| `/problems/[slug]` | Problem detail / workspace |
| `/courses` | Course list (students: enrolled, teachers: own courses) |
| `/courses/[slug]` | Course home (info, members, assignment/exam lists) |
| `/courses/[slug]/assignments/[slug]` | Assignment detail / submit |
| `/courses/[slug]/exams/[slug]` | Exam detail / submit |
| `/courses/[slug]/manage` | Course management overview (teacher/TA) |
| `/courses/[slug]/manage/members` | Member management |
| `/courses/[slug]/manage/assignments` | Assignment management |
| `/courses/[slug]/manage/exams` | Exam management |
| `/courses/[slug]/join/[token]` | Join course via token |
| `/assignments` | Cross-course assignment aggregation (all identities) |
| `/exams` | Cross-course exam aggregation (all identities) |
| `/auth/signin` | Sign in |
| `/auth/signup` | Sign up |

## Assignments vs Exams

### Shared:
- Created by teacher/TA in course manage page
- Can add problems (adding grants edit permission to all course teachers/TAs)
- Time window (start time, due time)
- Students can enter from two places: top-level aggregation page or course-level list

### Exam-only optional restrictions:

| Feature | Assignment | Exam |
|---------|-----------|------|
| Page lock (cannot switch tabs/windows) | No | Optional |
| IP lock (must use same IP as entry) | No | Optional |

Both restrictions are opt-in when creating an exam.

## Seed Accounts

| Account | Platform Identity | Password |
|---------|------------------|----------|
| admin | Admin | password123 |
| teacher | Teacher | password123 |
| ta-student | Student (to be promoted to TA in course) | password123 |
| student | Student | password123 |
