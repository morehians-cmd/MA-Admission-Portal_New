# Stage 2.3 — Admissions Database Implementation Plan

**Status:** Implementation plan prepared; documentation only  
**Date:** November 18, 2026  
**Repository:** `morehians-cmd/MA-Admission-Portal_New`  
**Work branch:** `integration/auth-db-foundation`  
**Approved design baseline:** 12-sheet Stage 2.2 schema and `ADMISSIONS_WORKFLOW_SPEC.md`

## 1. Purpose and scope

Translate the approved Stage 2.2 admissions schema into a safe, staged implementation sequence for Google Apps Script and Google Sheets.

This plan does not authorize or perform:
- Production spreadsheet, Apps Script, Drive, Script Properties, trigger, or deployment changes.
- Live student-data migration or importing APMerge records.
- Changes to the repository `main` branch.
- Destructive changes to existing sheet headers, records, account links, or authentication behavior.

All implementation and runtime validation must use the user's separate staging Apps Script project, copied staging spreadsheet, and synthetic data. Work remains on `integration/auth-db-foundation`.

## 2. Repository baseline inspected

The following existing files were inspected on the work branch:
- `INTEGRATION_AUTH_DB.md`
- `ADMISSIONS_WORKFLOW_SPEC.md`
- `AdmissionDb.gs`
- `AdmissionsPortal.html`
- `Router.gs`

Existing foundation to preserve:
- Destination authentication/session authority in `Auth.gs` and `AuthAccount.gs`.
- Existing `Users` schema and `Users.StudentID` relationship.
- Existing `AdmissionStudents`, `AdmissionAudit`, and `StudentIdentifiers` structures.
- Existing homepage and central `doGet(e)` router.
- Existing applicant correction-request foundation.
- Existing Admissions access authorization controlled by Owner.

The current `AdmissionsPortal.html` is a landing page with placeholder navigation, not an operational Admissions workspace.

## 3. Compatibility issues requiring planned remediation

### 3.1 Student identity is currently created too early

The current `admissionCreateApplication()` implementation:
- Inserts a row into `AdmissionStudents` at first application submission.
- Generates an internal StudentID.
- Generates an official MA student identifier.
- Links the Applicant account to that StudentID.

This conflicts with the approved lifecycle rule that a qualified applicant who does not proceed to enrollment must not receive a permanent student profile or MA student ID.

Planned remediation:
1. Introduce the separate `AdmissionApplications` and `ApplicationProfiles` records.
2. Keep applicant authentication and email verification independent from admission approval and student identity.
3. Generate/link the permanent internal StudentID and issue the applicable official identifier only at the approved enrollment transition.
4. Make the transition atomic under a server-side lock, with rollback/compensation for partial writes.
5. Preserve existing StudentID links and existing student records; do not re-key legacy students.

This is a controlled workflow refactor, not a bulk migration.

### 3.2 Existing applicant form still collects a separate emergency contact

The current `AdmissionDb.gs` validator requires `EmName`, `EmRelation`, `EmMobile`, and emergency-contact address details.

Planned remediation:
- Align new Applicant and Current Student Registration forms with the approved Primary Contact Person-only design.
- Collect Primary Contact Person Full Name, Address, Relationship to Student, and Contact Number.
- Remove the separate emergency-contact requirement from the new workflow.
- Retain legacy columns in `AdmissionStudents` for compatibility; do not delete or repurpose them.
- Preserve the external TLC Excel headings `EMERGENCY CONTACT` and `EMERGENCY NUMBER` and use only the separately approved mapping to Primary Contact Person Name and Mobile Number.

### 3.3 Requirements must support both applicant and returning-student paths

The approved design has one requirement tracking sheet in the 12-sheet total. To support pending requirements for both new applications and returning registrations, the implementation contract for `ApplicationRequirements` must be source-aware:
- Add `SourceType` with controlled values `NEW_APPLICATION` and `CURRENT_STUDENT_REGISTRATION`.
- Add `SourceRecordID` to reference the corresponding application or registration.
- Add `EnrollmentID` when the requirement becomes an enrollment obligation.
- Retain one row per applicable requirement and its receipt/review history.
- For every requirement still pending at enrollment, set `DeadlineAt` to the enrollment timestamp plus 60 calendar days.
- Keep requirement completion/verification separate from conditional-enrollment authorization.

This is a field-level refinement within the approved 12-sheet architecture; it does not add a thirteenth sheet. The existing sheet name is retained for compatibility with the approved schema baseline, even though the records will serve both admission sources.

## 4. Implementation principles

1. **Header-driven schemas:** Validate headers by name and schema version. Never assume column positions in existing sheets.
2. **Additive setup:** Create only missing approved sheets. Do not rewrite existing data or reorder existing headers.
3. **Idempotency:** Re-running setup must not duplicate sheets, records, identifiers, or configuration.
4. **Fail closed:** A missing or mismatched schema must stop the operation with a clear error; never auto-repair a populated sheet by overwriting headers.
5. **Server-side authorization:** Resolve the authenticated destination session and verify role, ownership, record state, and authorization for every read/write endpoint.
6. **Immutable history:** Submitted profile snapshots, assignments, reviews, approval decisions, and workflow audit events are preserved.
7. **No client-trusted authority:** StudentID, official identifiers, status transitions, requirement verification, deadlines, authorizer identity, and audit actor are generated/validated server-side.
8. **Lock critical writes:** Use Apps Script locks for duplicate prevention, ID issuance, account linking, enrollment finalization, and multi-sheet transitions.
9. **Safe dates:** Use ISO 8601 timestamps and `Asia/Manila` school-date interpretation; calculate the 60-day requirement deadline as 60 calendar days after enrollment.
10. **No secret or payload logging:** Never log passwords, OTPs, session tokens, full profiles, or unnecessary sensitive values.

## 5. Implementation sequence

### Phase 0 — Preflight and staging safeguards

Tasks:
- Confirm the active Git branch is exactly `integration/auth-db-foundation`.
- Record the branch head and inspect the current staging workbook binding without exposing or changing production identifiers.
- Have the user create/confirm a fresh copy of the staging spreadsheet and a backup of that copy.
- Confirm the Apps Script project is the separate staging project.
- Inventory existing sheet names, headers, row counts, named ranges, formulas, and relevant Script Properties in staging.
- Identify existing code callers of `admissionCreateApplication()`, `admissionGetMyApplication()`, `admissionDbSetup_()`, and account-link helpers.

Exit criteria:
- Staging project and copied workbook are confirmed.
- A rollback copy exists.
- No production target is selected.
- Existing schemas and endpoint dependencies are documented.

### Phase 1 — Schema contract and safe setup

Tasks:
- Define versioned header constants for the 12 approved sheets:
  1. `AdmissionApplications`
  2. `ApplicationProfiles`
  3. `ApplicationAssignments`
  4. `ApplicationRequirements`
  5. `ApplicationReviews`
  6. `ApplicationApprovals`
  7. `ApplicationExceptions`
  8. `CurrentStudentRegistrations`
  9. `StudentRegistrationProfiles`
  10. `EnrollmentRecords`
  11. `EnrollmentDocuments`
  12. `AdmissionWorkflowAudit`
- Define required/optional columns, controlled values, primary keys, logical foreign keys, and uniqueness rules.
- Add schema version metadata in code or a dedicated configuration mechanism that does not change the approved sheet count.
- Implement an Owner/editor-only staging setup function that creates missing sheets and verifies existing headers.
- Keep existing `AdmissionStudents`, `Users`, `StudentIdentifiers`, audit, and correction sheets untouched.

Exit criteria:
- All 12 sheets are created in the copied staging workbook with exact headers.
- Re-running setup is idempotent.
- A deliberately mismatched test header causes a safe failure without modifying existing records.
- Existing sheet headers and StudentID links remain unchanged.

### Phase 2 — Shared validation and data-access layer

Tasks:
- Implement reusable header-to-column mapping and schema validation.
- Implement server-generated immutable IDs for each new record type.
- Implement controlled status/value validation and ISO timestamp handling.
- Implement foreign-key existence checks and source-record validation.
- Implement source-aware requirement records for both applications and current-student registrations.
- Implement safe append/update helpers and audit-event helpers.
- Add lock-protected duplicate checks:
  - ApplicationID is unique.
  - ApplicationProfiles has one snapshot per ApplicationID.
  - RegistrationProfiles has one snapshot per RegistrationID.
  - One active CurrentStudentRegistration per StudentID + SchoolYear.
  - Enrollment source is exactly one of NEW_APPLICATION or CURRENT_STUDENT_REGISTRATION.
  - Official identifiers are unique and retain issuance history.
- Do not impose an unapproved same-year application uniqueness rule.

Exit criteria:
- Unit/static tests cover valid and invalid IDs, statuses, foreign keys, duplicate registration, and malformed dates.
- Duplicate or invalid writes fail without partial records.
- No existing student or account identifier is changed.

### Phase 3 — New applicant admission lifecycle

Tasks:
- Separate applicant account creation/email verification from application submission.
- Implement application draft/submission and immutable `ApplicationProfiles` snapshot.
- Preserve multiple applications across different school years.
- Store `IntakeMethod` as ONLINE or WALK-IN.
- Implement application queue and append-only assignment history.
- Implement Encoder preliminary review and Admissions final verification.
- Implement versioned requirement generation from the temporary `AdmissionPortal-Backup` matrix.
- Reuse the existing correction-request workflow for correction/completion.
- Implement approval decisions and Owner escalation.
- Prevent application submission from creating an `AdmissionStudents` row, permanent StudentID, or official MA identifier.

Exit criteria:
- Applicant sees only their own application and status.
- Encoder cannot perform final verification or approval.
- Admissions can perform permitted routine actions.
- Owner-only actions are server-enforced.
- A non-enrolling applicant retains application history without a permanent student profile or MA ID.

### Phase 4 — Returning student annual registration

Tasks:
- Locate an existing student using the authenticated account's immutable StudentID link.
- Create or resume the one active registration for StudentID + SchoolYear.
- Block duplicate active registrations and return the existing record to the student.
- Calculate proposed grade from the existing verified grade; do not accept a student-selected promotion grade.
- Capture the annual registration profile snapshot.
- Apply the approved editable-field allow-list.
- Route protected/verified field corrections through the existing correction process.
- Track the approved status sequence:
  `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `FOR_CORRECTION`, `AWAITING_CONSENT`, `AWAITING_PROMOTION_VERIFICATION`, `READY_FOR_ENROLLMENT`, `ENROLLED`, `REJECTED`, `CANCELLED`.
- Record physical signed-consent receipt.
- Require Admissions to verify promotion and record PROMOTED, REPEATER, or OTHER_EXCEPTION.

Exit criteria:
- Existing StudentID and official identifiers remain unchanged.
- Student cannot select or approve their own promoted grade.
- Submission alone does not mark the student enrolled.
- Duplicate submissions resume the existing registration.

### Phase 5 — Enrollment and conditional requirements

Tasks:
- Create an EnrollmentRecord only after the correct source workflow is ready.
- Require an approved application for new applicants.
- Require Admissions-verified registration/promotion for returning students.
- Create/link permanent StudentID and issue the applicable official identifier at the approved enrollment transition for new applicants.
- Preserve existing identifiers for returning students.
- Require exactly one source type and source record.
- Record conditional-enrollment reason, authorizer, authorization role, and timestamp.
- Enforce Admissions authorization for routine conditional enrollment and Owner authorization for exceptional cases.
- For every outstanding requirement, create/retain a separate requirement row with its own deadline at 60 calendar days after enrollment.
- Track completion, final verification, and overdue status per requirement.
- Do not silently mark any pending requirement as verified.

Exit criteria:
- No enrollment can be finalized from an unapproved application or unverified returning registration.
- Exactly one EnrollmentRecord is created per valid enrollment transaction.
- Each pending requirement has a deadline and can be tracked independently.
- Routine and exceptional authorizations are correctly separated and audited.

### Phase 6 — Enrollment documents

Tasks:
- Generate the Student Enrollment Form and Enrollment Confirmation Slip separately from the same EnrollmentRecord.
- Use the user's supplied layouts and dynamic record data.
- Support print and PDF download.
- Store Drive file references, version, status, generator, timestamps, supersession, and reprint reason in `EnrollmentDocuments`.
- Keep signed consent as a separately tracked document type until the user confirms final adoption/adaptation of the APMerge form.
- Do not claim that application approval is proof of enrollment.

Exit criteria:
- Both documents show the correct student, school year, grade, enrollment, and applicable scholarship information.
- Reprints preserve document history.
- Unauthorized users cannot retrieve another student's documents.

### Phase 7 — Admissions workspace and reports

Tasks:
- Replace placeholder navigation with role-appropriate operational modules only as each module's backend is complete.
- Implement Application Overview, Application Queue, My Assigned Applications, Walk-in Registration, Requirements Monitoring, Correction/Completion Requests, Approval Monitoring, Enrollment Monitoring, and Reports/Activity Logs.
- Enforce Encoder, Admissions, and Owner visibility and action boundaries server-side.
- Restrict Gender Identity to Owner at the data-access layer, not only in the interface.
- Avoid exposing Facebook Profile Link or other restricted fields to unauthorized roles.

Exit criteria:
- Every visible operational control has a working server endpoint.
- Direct calls that bypass the UI are still rejected when unauthorized.
- Dashboard counts reconcile with the underlying records.

### Phase 8 — Staging validation, documentation, and release readiness

Tasks:
- Run static syntax checks and schema tests.
- Use only synthetic accounts and student records.
- Test all lifecycle paths, error paths, concurrency, duplicate handling, authorization, and rollback behavior.
- Ask the user to run the staging Apps Script tests and report observed results.
- Record only actual test outcomes; do not mark unrun tests as passed.
- Update `INTEGRATION_AUTH_DB.md`, this plan, and relevant workflow documentation with actual implementation details and confirmed staging outcomes.
- Commit each coherent phase to the integration branch with clear messages.
- Do not merge, deploy, or modify production without separate explicit approval.

Exit criteria:
- Required staging acceptance tests pass and are user-confirmed.
- Existing homepage, authentication, account recovery, corrections, and student links remain functional.
- No production resources were changed.
- A separate release/migration proposal is prepared before any production work.

## 6. Staging acceptance test matrix

| Area | Required test cases |
|---|---|
| Setup | Fresh setup, repeated setup, missing sheet, mismatched header, existing data preservation |
| Applicant identity | Verified Applicant with no application; multiple school-year applications; duplicate LRN; possible duplicate identity; no premature StudentID/MA ID |
| Application workflow | Online and walk-in intake; assignment/reassignment; Encoder preliminary review; Admissions final verification; completion/correction; approval/rejection/escalation |
| Requirements | Grade-specific applicability; preliminary/final status separation; requirement matrix version; correction reason; no silent verification |
| Returning registration | First registration; resume existing registration; duplicate block; profile snapshot; automatic proposed grade; repeater; other exception; physical consent receipt |
| Enrollment | Approved new applicant; verified returning student; invalid source; duplicate enrollment; atomic StudentID/identifier linking; cancellation |
| Conditional enrollment | Routine Admissions authorization; exceptional Owner authorization; unauthorized attempt; one 60-day deadline per pending requirement; overdue and completion |
| Documents | Enrollment Form; Confirmation Slip; PDF output; print; reprint; superseded/voided versions; ownership checks |
| Security | Applicant self-only access; Encoder limitations; Admissions permissions; Owner-only protected access; direct endpoint authorization; audit hygiene |
| Regression | Homepage, login, email verification, session restore, sign-out, password reset/change, account management, corrections, existing student links |

## 7. Explicit pending decisions retained

The following must not be guessed during implementation:
- Final adoption/content of the APMerge Parental Consent & Data Privacy Undertaking Form.
- Exact six Applicant Portal module names and scope.
- Final field-by-field profile mapping where the legacy 117-field student schema differs from the approved profile schema.
- Reopening/replacement rules for rejected or cancelled returning registrations.
- Any requirement matrix changes beyond the temporary AdmissionPortal-Backup baseline.
- Current-year validation of age/assessment rules before production admissions.
- Final document layout/signatories where the supplied document does not establish them.

## 8. Delivery checkpoints

| Checkpoint | Deliverable | Gate |
|---|---|---|
| 2.3 | This implementation plan | Prepared |
| 2.4 | Detailed schema dictionary and field mapping | Before code implementation |
| 2.5 | Safe schema setup and shared data layer | Staging validation |
| 2.6 | Applicant and returning registration workflows | Role and lifecycle validation |
| 2.7 | Enrollment, conditional requirements, documents | End-to-end staging validation |
| 2.8 | Admissions workspace and reports | Regression and user acceptance |
| Release readiness | Final review and separate deployment proposal | Explicit user approval required |

## 9. Non-negotiable safeguards

- Work only on `integration/auth-db-foundation`.
- Never modify `main` or use APMerge as a development target.
- Preserve current homepage, authentication, account recovery, and correction functionality.
- Preserve existing student IDs and historical records.
- Use synthetic data only.
- Do not deploy to production or modify production Apps Script, spreadsheets, triggers, Script Properties, or Drive permissions without explicit user approval.
- Do not claim runtime success without actual staging execution and user confirmation.
