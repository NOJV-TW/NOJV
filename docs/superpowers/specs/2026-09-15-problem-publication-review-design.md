# Problem Public Publication Review Design

## Goal

Require course TAs, including TAs who own a problem, to submit a public-publication request for administrator review instead of publishing a public copy directly. Preserve every request decision, allow at most one pending request per problem, and allow a rejected request to be submitted again.

## Scope and policy

- Platform admins and platform teachers retain the existing direct-publication flow.
- A user whose platform role is `student` but who is an active TA in a non-archived course may edit shared private problems and publish them as private problems, but may not create a public fork directly.
- A TA may submit a request only for a private problem they own. A course co-editor who is not the owner cannot submit on the owner's behalf.
- The existing `adminMayPublish` consent is not used by the TA request flow. It remains the separate owner consent that lets an admin publish another owner's private problem through the existing admin action.
- A request is immutable history after review. The same problem may have many rejected requests over time, but only one request with `pending` status at a time.
- Approval uses the current private source. The approval transaction locks the request and source, checks that the source is still private and owned by the requester, reruns the existing publication validation, and then creates an admin-owned published public fork. If validation fails, the request remains pending and the admin receives the validation error.
- Rejection records an optional administrator reason and does not mutate the private source. Once rejected, the owner may submit a new request.

## Data model

Add `ProblemPublicationRequestStatus` with `pending`, `approved`, and `rejected` values.

Add `ProblemPublicationRequest`:

- `id` (cuid primary key)
- `problemId` (required source problem foreign key)
- `requestedByUserId` (required requester foreign key)
- `status` (default `pending`)
- `reviewedByUserId` (nullable administrator foreign key)
- `reviewNote` (nullable text; required for neither outcome, but exposed on rejection)
- `publishedProblemId` (nullable foreign key to the created public fork, unique when present)
- `createdAt`, `updatedAt`, and `reviewedAt` (nullable)

Relations use explicit names for the three user roles and the source/public problem links. Add indexes for `(status, createdAt)` and `(problemId, createdAt)`. Add a database partial unique index on `problemId` where `status = 'pending'` so concurrent submissions cannot create two pending requests.

Extend `AdminAuditAction` with publication-request approval and rejection actions. Approval and rejection both write an audit entry containing the request ID, source problem ID, and reviewer decision.

## Application flow

### TA request

`requestPublicProblemPublication(actor, problemId)` runs in a transaction:

1. Lock the source problem and verify the actor is its owner.
2. Verify the source is private, the actor has an active TA membership in a non-archived course, and no pending request exists.
3. Create a pending request. Do not change visibility/status and do not create a fork.

The action is exposed by the problem editor after the normal edit-access check. Duplicate pending requests return a conflict that includes the existing pending state. A rejected request can be submitted again.

### Admin review

Add application queries for a paged list of requests (pending first, then newest history) and a request detail containing requester, source owner, source problem summary, status, timestamps, review note, and published fork ID.

`approvePublicProblemPublication(actor, requestId)` is admin-only and transactional:

1. Lock the request and source problem.
2. Require `pending`, source visibility `private`, source owner equal to the requester, and source still present.
3. Run the existing publication validation against the current source.
4. Create a published public fork owned by the reviewing admin.
5. Mark the request `approved`, set reviewer/time, and store the fork ID.
6. Record an admin audit event.

`rejectPublicProblemPublication(actor, requestId, reviewNote)` is admin-only and transactional. It locks the request, requires `pending`, sets `rejected`, stores the optional note and reviewer/time, and records an admin audit event. It never changes the source problem.

## Web experience

- On the problem editor, a teacher/admin owner keeps the current direct public-copy action.
- A TA owner sees `Submit for public review` instead. While a request is pending, the action is disabled and the pending status/timestamp is shown. After rejection, the previous reason is shown and the action becomes available again.
- A non-owner TA continues to see the editor in co-edit mode but no public-publication action.
- Add an admin-only `/admin/problem-publications` page and an admin navigation tab. The page shows pending requests with requester, source title/ID, submitted time, and actions to inspect, approve, or reject. It also provides a history view for approved/rejected requests.
- Approval and rejection use confirmation dialogs. Rejection accepts an optional reason. The source editor and private course copy remain unchanged until approval creates the separate public fork.
- Add translated labels, status text, validation errors, and confirmation copy for English and Traditional Chinese.

## Error handling and concurrency

- All permission checks are enforced in application transactions; hiding or disabling a button is not security enforcement.
- The partial unique index and a request row lock protect against duplicate pending requests and double approval.
- If the source changed since submission, approval evaluates the latest source. Failed publication validation leaves the request pending and displays the validation error so the admin can reject it or the owner can make another request after resolution.
- If the source is no longer private or no longer owned by the requester, approval fails without creating a fork; the admin can reject the stale request.

## Testing

- Unit tests cover direct publication denial for TA owners, request eligibility, duplicate-pending rejection, retry after rejection, non-owner co-editor denial, admin-only review, and review state transitions.
- Integration tests cover the partial-unique/concurrency boundary, approval creating an admin-owned public fork while preserving the private source and course links, rejection history, and approval failure when the reference solution is stale.
- Web tests cover the role-specific editor actions, pending/rejected states, admin review list, confirmation flows, and translated labels.
- Run focused tests first, then the repository formatting, lint, typecheck, and component/unit suites before claiming completion.
