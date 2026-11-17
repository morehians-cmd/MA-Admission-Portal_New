# Authentication and Database Integration — Phase 1

## Scope and safety boundary

- Integration target: `morehians-cmd/MA-Admission-Portal_New`
- Source reference: `morehians-cmd/APMerge`
- Work branch: `integration/auth-db-foundation`
- Branch base: destination `main` at `2c20ced73333d9b6ea808be9c43a7253b609e1b0`
- Source snapshot inspected: `main` at `7dd9054d10bbb2d81d002d588e5d11a00d4c6535`
- No changes are to be made to either repository's `main` branch during this work.
- Do not run setup, migration, trigger, or deployment functions against a live spreadsheet as part of code integration.

## Destination components to preserve

- `Router.gs` and `Homepage.html`: current homepage and route behavior.
- `Auth.gs`: destination authentication/session authority.
- `AuthAccount.gs`: destination applicant registration, email verification, and password recovery.
- Existing `Users` and `AuthAudit` sheets: preserve their current data and column order.

The destination authentication model uses email-based accounts, PBKDF2-HMAC-SHA256 password hashes with per-user salts, versioned cache sessions, and roles `Owner`, `Encoder`, `Admissions`, `Student`, and `Applicant`. The dedicated Admissions role is granted and revoked only by the Owner for an existing active, email-verified account. Session validation reads the current account status and token version from the Users sheet.

## Source components inspected

- `Security.gs`: username-based users, legacy/v2 password formats, pepper-backed hashes, cache sessions, user roles/clearances, and session-version properties.
- `SignInGuard.gs`: additional sign-in protection.
- `Hardening.gs`: verified registration and student/user creation.
- `Code.gs`: student schema, data access helpers, student ID generation, and student CRUD.
- `Protection.gs`: audit, backup, staff OTP, and security support.

The source has a separate student record model and user model. Its student rows are represented by `COLS = ['StudentID','CreatedAt', ...FIELDS]`; its user rows use a separate `Users` schema beginning with `Username, PasswordHash, Role` and include a `StudentID` link. Source roles and password hashes are not compatible with the destination's authentication schema.

The inspected source core also contains legacy hard-coded security/configuration values (including a password salt and a Drive folder identifier), while its README describes public-link photo-folder sharing. None of those values or permissions should be copied into the destination. Before any future file/Drive integration, move secrets to Script Properties, review the target folder's access list, and confirm whether uploaded student photos must remain private.

## Integration decisions

1. **One authentication authority:** retain destination `Auth.gs` and `AuthAccount.gs`. Do not import source `Security.gs` login/session functions or create a second `doGet(e)`.
2. **Separate identity from admission data:** destination `Users` remains the authentication/account table. Create a distinct admission/student data table in a later code step. Do not store the complete admission application inside the Users row.
3. **Stable relationship:** `Users.StudentID` and `AdmissionStudents.StudentID` are immutable internal relationship keys. Official MA IDs, legacy TLC IDs, and existing SHS school IDs are separate records in `StudentIdentifiers`. Link account to admission record by the internal key, never by email alone.
4. **Applicant lifecycle:** registration creates a pending Applicant account and email verification activates it. An admission application creates or updates a separate admission record. Do not automatically promote an Applicant to Student merely because the account was verified. Role promotion must be an explicit, authorized workflow.
5. **No password-hash conversion by copying:** source v2/legacy hashes must not be placed in destination `PasswordHash`. Hash formats differ. Any future account import requires a separately reviewed password-reset/re-enrollment strategy; do not attempt a silent hash migration.
6. **No implicit spreadsheet migration:** do not point destination `DB_SHEET_ID` at a source workbook, rename sheets, rewrite headers, or run setup/migration functions on existing school data.
7. **Server-side authorization:** all admission read/write functions must resolve the destination session and enforce role/ownership checks on the server. Hiding UI controls is not authorization.
8. **Preserve existing schemas:** append new fields only; never reorder or repurpose existing Users columns. Use header-name lookups and schema validation for new admission sheets.
9. **Timezone:** use `Asia/Manila` for school records and timestamps when the destination manifest is next deliberately updated; do not change it as part of the auth/database foundation without a separate review.

## Verified destination/source differences

| Concern | Destination | Source | Integration rule |
|---|---|---|---|
| Account key | Email | Username (often email for learners) | Destination email remains canonical login |
| Roles | Owner, Encoder, Admissions, Student, Applicant | admin/student plus clearance fields | Explicit role mapping; Admissions access is Owner-granted; never trust client role |
| Password hash | PBKDF2-HMAC-SHA256, per-user salt | pepper-backed v2 and legacy SHA-256 | Do not copy hashes |
| Session | `authResolveSession_` | `who_` / source cache session | Destination session only |
| Account table | `Users` | `Users` with different columns | Never merge or overwrite by sheet name |
| Student table | Not yet present in destination repo | `Students` using `COLS` | Create a separate destination admission schema |
| Public routing | one destination `doGet(e)` | source `doGet(e)` | Extend destination router only in a later routing phase |

## Implementation status on `integration/auth-db-foundation`

### Completed in this branch
- Appended `StudentID` to the destination Users schema without changing the existing first 15 columns.
- Updated account-row parsing, sign-in response, email-verification response, and session restoration to expose the linked StudentID and account full name.
- Added internal account-link helpers. The locked variant supports atomic linking from a trusted server-side workflow; the wrapper is not browser-callable.
- Added `AdmissionDb.gs` with separate `AdmissionStudents` and `AdmissionAudit` sheets.
- Matched all 117 source student-data fields in their original order (including generated family and requirement-date fields).
- Added an Applicant-only first-application endpoint and an Applicant/Student self-read endpoint. First submission creates an AdmissionStudents row with a generated internal StudentID key, creates a separate official MA identifier in `StudentIdentifiers`, and links `Users.StudentID` to the internal key. The server controls both identifiers, email, timestamps, name, age, classification, enrollment status, consent timestamp, and requirement statuses.
- Added an owner-only schema setup function. It creates/verifies schema only; it does not import records.
- JavaScript syntax checks passed for `Auth.gs`, `AuthAccount.gs`, and `AdmissionDb.gs`. A static comparison confirmed the destination student schema matches all 117 source fields in order.


### Automatic-linking hardening added
- Server-side validation checks name characters, real birth dates, consecutive school-year values, required LRN format, and mobile-number format.
- Applicants under 18 must provide a valid parent/legal guardian name, relationship, email, and mobile number. Guardian email must differ from the applicant account email.
- Applicant submissions cannot set Admissions-controlled requirement statuses or requirement dates; these are initialized by the server.
- Duplicate protection checks account email, required LRN, and exact surname/first-name/birth-date identity before creating a record.
- Internal StudentID keys and official MA identifiers are independently collision-checked before insertion.
- Applicant role is not automatically promoted to Student by email verification or application submission. The account remains an Applicant unless a separately reviewed authorized lifecycle workflow is implemented.
- Runtime tests are still required in the disposable staging spreadsheet. No live student records should be used for the first test.

### Initial implementation checkpoint
- At the time of the initial implementation, no Apps Script runtime tests or spreadsheet setup had been run.
- No deployment or trigger was changed.
- No source accounts, password hashes, or student records were imported.

## Next validation sequence

### A. Authentication and identity tests
- Test registration, OTP verification, login, session restore, sign-out, password reset, and password change.
- Test Applicant versus Student versus staff role boundaries.
- Test account-link uniqueness, attempted relinking, inactive accounts, and missing StudentID schema.

### B. Admission database tests
- Run `admissionDbSetup_()` only in a disposable staging spreadsheet after backing it up.
- Test first application creation, retry behavior, duplicate email, duplicate LRN, duplicate StudentID, and concurrent submissions.
- Test that applicants can read only the record linked to their own authenticated account.
- Test malformed dates, invalid grade/year values, overlong fields, and unexpected fields.
- Confirm audit entries contain no passwords, OTPs, session tokens, or full application payloads.

### C. Before any live data migration
- Confirm the staging tests and review the resulting sheet schemas.
- Back up the target spreadsheet and map source records by stable identifiers.
- Prepare a separate, reviewed migration plan for any existing users or student records. Do not copy source password hashes.
## Explicitly out of scope for this phase

- Replacing the homepage or its visual design.
- Replacing destination authentication or password hashing.
- Importing live student records or user accounts.
- Changing the production deployment, default branch, spreadsheet binding, Script Properties, triggers, or Drive permissions.
- Importing the source portal wholesale or copying its `doGet(e)`.

## Applicant Portal — Phase 1: Dashboard

Implemented on `integration/auth-db-foundation`:

- Added `ApplicantPortal.html` as a separate applicant-facing dashboard.
- Added the `?page=applicant-portal` route in `Router.gs`.
- Updated `Homepage.html` so authenticated Applicant and linked Student accounts are redirected to the Applicant Portal after sign-in, email verification, or session restoration.
- The dashboard verifies the session through `authWhoAmI(token)` and loads only the signed-in account's linked record through `admissionGetMyApplication(token)`.
- The dashboard displays an account-created state before first application submission, and a submitted state plus the generated Student ID after a record is linked.
- The six navigation areas are shown, with Phases 2–6 marked as coming next. No other module has been implemented yet.
- The dashboard uses the existing homepage identity: navy `#062E70`, blue `#0648AD`, orange `#FF941F`, light blue `#EEF4FF`, Poppins headings, and Open Sans body text.
- Sign-out clears the browser token and calls the existing `authSignOut` endpoint.

### Phase 1 validation status

Static source review completed. The following still require execution in the user's staging Apps Script project with dummy accounts:

1. Applicant email verification redirects to `?page=applicant-portal`.
2. Applicant sign-in redirects to the dashboard.
3. Refresh restores the applicant session and dashboard.
4. A newly verified applicant with no application sees the account-created state and no Student ID.
5. A dummy account with a linked AdmissionStudents record sees the submitted state and its Student ID.
6. Owner and Encoder sign-in behavior remains unchanged.
7. Applicant sign-out invalidates the session and returns to the homepage.

No production Apps Script project, deployment, spreadsheet, trigger, or production data was changed. The dashboard does not create or modify admission records. Application submission remains Phase 2's responsibility.


## Applicant Portal — Phase 2: My Application (K–12)

Implemented on `integration/auth-db-foundation`:

- Added `ApplicantApplication.html` as a separate K–12 application page and added the `?page=applicant-application` route in the destination `Router.gs`.
- Enabled the My Application navigation link in `ApplicantPortal.html`; the dashboard and authentication implementation remain separate.
- Added a four-step applicant form: Student & Academic Information, Personal Information & Address, Parent / Guardian & Emergency Contacts, and Review & Submit.
- Used the source portal's K–12 grade, department, category, and SHS cluster values as references. Department is derived by the server from the selected grade. SHS applicants must select a valid cluster.
- LRN is now required for new-applicant submissions. Applicant mobile, birth date, address, and emergency contact details are validated. Applicants below 18 must provide a parent/legal guardian name, relationship, email, and mobile number.
- Added an explicit privacy-consent checkbox. The backend requires consent before submission and stores the server-generated consent timestamp, not a client-provided timestamp.
- Excluded optional sensitive fields such as religion and gender identity from this first form; those source-schema columns remain blank unless a separately reviewed need is established.
- The form calls the existing `admissionCreateApplication(token, input)` endpoint. The backend enforces Applicant role, server-side validation, duplicate checks, unique StudentID generation, record creation, automatic account linking, and audit logging under a script lock.
- Applicants with an existing linked record are shown a submitted state instead of a second-submission form. No edit or second-submit path is provided in this phase.
- No draft data is stored in browser storage. Draft persistence is not implemented because the current backend has no secure draft endpoint.
- Requirement uploads and status tracking remain separate future modules.

### Phase 2 validation status

Static source integration is complete. Runtime testing is still required in the user's staging Apps Script project with a newly registered dummy Applicant and dummy details. Test at minimum:

1. Open `?page=applicant-application` from the Applicant Portal navigation.
2. Verify all four form steps, responsive layout, conditional SHS cluster field, and under-18 guardian fields.
3. Confirm client-side and server-side rejection of missing required fields, invalid LRN/mobile/date/year/grade/cluster, missing privacy consent, and invalid guardian details.
4. Submit one valid dummy K–12 application. Confirm exactly one `AdmissionStudents` row is created, a StudentID is generated, `Users.StudentID` is linked, and an `application-created` audit entry is written.
5. Return to the dashboard and confirm it shows the generated Student ID and submitted application.
6. Reopen My Application and confirm it displays the existing submission rather than allowing another first submission.
7. Attempt duplicate email, duplicate LRN, and duplicate name/date submissions using separate dummy accounts as appropriate; verify server rejection.
8. Confirm a failed submission does not leave an unlinked or partial record.

No Apps Script deployment, spreadsheet, trigger, production data, or `main` branch was changed. Do not test with real applicant/student information.


## My Application form refinements — November 17, 2026

The applicant form now includes these conditional and validation rules:

- If Father Status or Mother Status is set to **Deceased**, the corresponding occupation, educational attainment, mobile number, and email fields are disabled, greyed out, and cleared. The server independently clears those values before saving.
- Province is no longer displayed or requested in the applicant address. The existing database column is retained for schema compatibility and the server stores an empty value for new applications.
- Previous SHS Strand / Cluster is enabled only when Previous Grade is Grade 11 or Grade 12. It is cleared in the browser when not applicable, and the server enforces the same rule.
- LRN is required and must contain exactly 12 digits, beginning with 1, 2, 3, 4, or 5. The browser limits input to digits and 12 characters; the server independently enforces the same rule.

### Additional staging checks

1. Set Father Status to Deceased and confirm the four following fields become greyed out, disabled, and cleared. Repeat for Mother.
2. Change either status back to Alive and confirm the fields become editable again.
3. Confirm Province is absent from the form and review summary.
4. Select Previous Grade 10 and confirm Previous SHS Strand / Cluster is disabled and empty.
5. Select Previous Grade 11 or Grade 12 and confirm the previous cluster field becomes editable.
6. Try LRN values beginning with 0 or 6, values shorter or longer than 12 digits, and nonnumeric characters. Confirm invalid values are rejected or sanitized; test valid 12-digit values beginning with 1 through 5.
7. Confirm backend validation still rejects invalid LRN and clears inapplicable parent and previous-cluster values even if a browser request is manipulated.


## Future Phase — Application Correction Requests (policy agreed November 17, 2026)

This phase is planned separately from the initial application submission flow. It must not be implemented or runtime-tested against live school data.

### Applicant-facing policy

- After initial submission, applicants cannot directly edit or overwrite their submitted application.
- Applicants may submit a correction request for eligible information. The original submitted record remains unchanged while the request is pending.
- Ordinary contact and address corrections may be requested online and are subject to Admissions review.
- Sensitive identity-related corrections — including legal name, date of birth, place of birth, and legal sex — require verification before approval. The applicant must either:
  1. submit valid supporting documents through an approved, private document-handling process; or
  2. personally visit the Moreh Academy Admissions Office and present a valid government-issued ID or other identification accepted by the school.
- A sensitive correction must not be applied merely because the applicant typed a new value or uploaded an unverified file.
- Applicants cannot change their StudentID, account email identity link, system-generated fields, enrollment status, or Admissions-controlled requirement statuses through a correction request.

### Proposed correction lifecycle

1. Applicant submits a correction request identifying the field(s), proposed value(s), and reason.
2. The system creates a unique request reference and records the request as **Submitted**.
3. Authorized Admissions personnel review the request. The existing AdmissionStudents values remain unchanged.
4. If clarification or verification is needed, the request may move to **For Verification** or **For Additional Information**.
5. Authorized personnel approve or reject the request and record the decision and verification method.
6. Only after approval does the server apply permitted changes to AdmissionStudents and record the action in the audit history.
7. The applicant can view the request status and decision from the portal.

Suggested statuses: Submitted, Under Review, For Verification, For Additional Information, Approved, Rejected, and Completed.

### Data and security requirements before implementation

- Create a separate correction-request data store; do not place pending proposed values directly into AdmissionStudents.
- Preserve the original values until an authorized approval is completed.
- Apply approved updates server-side, with ownership checks, role/permission checks, locking, field allowlists, and validation.
- Record the request reference, StudentID, requesting account, requested fields, reason, status, timestamps, reviewer, verification method, decision, and completion outcome.
- Keep a traceable before/after history for approved changes. Do not place identity documents, passwords, OTPs, session tokens, or complete application payloads in ordinary audit details.
- Supporting documents, if enabled, must use a private restricted storage location and an explicit retention/access policy. Do not use public-link Drive folders or expose document URLs to other applicants.
- The existing roles are Owner, Encoder, Student, and Applicant. Do not assume every Encoder is authorized to approve corrections. Approval permissions must be explicitly configured and enforced server-side; until then, Owner-only approval is the safe default.
- No applicant-facing direct-edit endpoint is permitted. No admin-assisted account-to-student linking is part of this workflow.

### Implementation gate

The initial My Application submission flow and the November 17 form refinements must first pass staging runtime tests using dummy accounts and a copied staging spreadsheet. Only then should this correction-request phase be implemented. K–12 remains the scope; College workflows are deferred.


## Application Correction Requests — initial implementation

Implemented on `integration/auth-db-foundation` as the next K–12 applicant module:

- Added `AdmissionCorrections.gs` with separate `CorrectionRequests`, `CorrectionDocuments`, and `CorrectionAudit` schemas. The initial application row is not overwritten when a correction is requested.
- Added `ApplicantCorrections.html` and the `?page=applicant-corrections` route. Applicants and linked Students can submit one field correction at a time and see only requests associated with their own linked StudentID and account email.
- Added a field allowlist. Applicants cannot request changes to StudentID, account email, system fields, enrollment status, or Admissions-controlled requirement statuses.
- Sensitive identity fields (legal name components, birth date, place of birth, and LRN) require either supporting-document upload or an in-person verification request. A typed value or uploaded file alone does not change the official record.
- Supporting documents accept PDF/JPG/PNG only, up to two files at 5 MB each. The server checks file signatures and MIME type, stores files in a request-specific subfolder, and does not return Drive file IDs or URLs to applicants.
- The setup function `runAdmissionCorrectionSetup()` creates/verifies the three correction sheets and creates a private Drive folder. It uses Script Property `ADM_CORRECTION_DRIVE_FOLDER_ID`. The folder, request subfolders, and files are set to PRIVATE with no link sharing.
- Added `CorrectionAdmin.html` at `?page=admin-corrections`, with Owner-only queue/detail/download/review endpoints. Encoders are not implicitly authorized.
- Owner approval revalidates the proposed value, confirms the original value has not changed since submission, applies only the allowlisted field, recalculates FullName/Age where applicable, and records before/after values in CorrectionAudit.
- Applicant request history shows the status and Admissions note. Applicants never receive private Drive URLs or document IDs.

### Important access boundary

The Drive folder is private and initially grants no staff access beyond the script owner's account. Do not add staff permissions until the school identifies the exact authorized Admissions email addresses. The current portal review queue is Owner-only.

The correction sheets contain proposed and original personal information. Google Sheets does not provide per-sheet read restrictions for spreadsheet editors. Therefore, the database spreadsheet itself must remain shared only with the system owner and specifically authorized data handlers; sheet protection alone is not a confidentiality boundary. Do not give general Encoders or other staff editor access to the database spreadsheet.

### Staging setup and tests still required

This code has passed static JavaScript syntax checks only. It has not been executed in Apps Script, and no Drive folder or correction sheet has been created by this implementation. Before enabling the module in staging:

1. Sync the branch files into the disposable staging Apps Script project.
2. Confirm its Script Property `DB_SHEET_ID` points only to the copied staging spreadsheet.
3. Confirm the staging spreadsheet is not broadly shared.
4. In the Apps Script editor, run `runAdmissionCorrectionSetup()` manually as the system owner. Verify the three empty sheets and private Drive folder are created; inspect folder sharing and confirm no link access or staff access was granted.
5. Test a normal contact/address correction with dummy data; confirm the original AdmissionStudents value stays unchanged and the request appears in the applicant history and Owner queue.
6. Test a sensitive correction using dummy data with a dummy PDF/JPG/PNG; confirm the uploaded file is private and applicants cannot retrieve its Drive URL or file ID.
7. Test the in-person verification path without an upload.
8. As Owner, download the dummy document through the Owner review page, verify it, approve the request, and confirm only the requested allowlisted field changes. For a name correction, verify FullName; for a birth-date correction, verify Age.
9. Test rejection, For Additional Information, duplicate active requests for the same field, unauthorized Applicant access to another StudentID, and non-Owner access to the review endpoints.
10. Confirm CorrectionAudit records the reviewer, request reference, field, before/after values, verification method, and action.

Do not run setup or tests against production. Do not upload real identity documents during initial staging validation. No public deployment, production spreadsheet, production Drive folder, trigger, or `main` branch has been changed.

### Current implementation boundary

The applicant submission, private upload, status tracking, and Owner review/approval code are present in the branch. Runtime behavior and Drive permissions remain unverified until the user completes the staging setup and tests above. Automated applicant follow-up uploads for requests marked For Additional Information, configurable staff reviewer permissions, and a formal document-retention/deletion schedule remain future enhancements.

## Stage 1 — Foundation and Compatibility (November 17, 2026)

### Implemented on `integration/auth-db-foundation`

- Added the explicit `Admissions` authentication role. Applicant registration continues to create only `Applicant` accounts; no existing Encoder is automatically upgraded.
- Added Owner-only Admissions access management at `?page=admin-admissions-access`, linked from Homepage Management. Only active, email-verified Applicant or Encoder accounts that are not already linked to a student profile are eligible. The Owner must independently verify employee identity before granting access.
- Added `AdmissionRoleAudit` and the editor-only setup function `runAdmissionRoleSetup()`. Grant/revoke actions record previous role, new role, reason, actor, and timestamp. Role changes increment `TokenVersion`, invalidating existing sessions.
- Added `StudentIdentifiers` with the approved 15-column schema. Existing `AdmissionStudents.StudentID` values and `Users.StudentID` links are not rewritten. The `runAdmissionDbSetup()` migration backfills existing MA-format IDs as `MA_STUDENT_ID`, recognized legacy TLC IDs as `TLC_LEGACY_ID`, non-MA Grade 11–12 identifiers as `SHS_SCHOOL_ID`, and other existing identifiers as `LEGACY_STUDENT_ID`. It skips new opaque `STU-...` internal keys and is idempotent.
- New admission records use an opaque internal `STU-...` key for the relationship between Users and AdmissionStudents, and a separate `MA-YYYY-XXXXXXXXXX` official identifier in StudentIdentifiers. Applicant-facing screens display the official identifier, not the internal key.
- New-applicant LRN is now required in both the browser form and backend. The reusable `admissionDbValidateLrn_()` helper is intended for the future Currently Enrolled Student Profile Registration endpoint as well. That separate registration pathway is not yet implemented.
- LRN correction requests cannot clear the required LRN field.
- Existing AdmissionStudents columns and the Users column order are preserved. No old APMerge data is imported.

### Stage 1 staging setup — manual, staging only

After manually syncing the branch files to the disposable staging Apps Script project:

1. Confirm `DB_SHEET_ID` points to the copied staging spreadsheet, not a production workbook.
2. Back up the staging spreadsheet.
3. Run `runAdmissionDbSetup()` from the Apps Script editor as the script owner. It verifies the existing Users and AdmissionStudents schemas, creates/verifies StudentIdentifiers, and backfills existing identifiers without changing StudentID values or account links.
4. Run `runAdmissionRoleSetup()` from the Apps Script editor as the script owner. It creates/verifies AdmissionRoleAudit.
5. Open Homepage Management and use **Admissions access** to grant/revoke a dummy verified account. Do not grant real employee accounts during initial staging tests.

### Stage 1 validation still required

- Confirm existing dummy account links still resolve to their original AdmissionStudents rows after identifier backfill.
- Confirm old MA identifiers display unchanged, while newly created dummy applications receive an internal STU key and a separate MA identifier.
- Confirm the internal STU key is not displayed in applicant-facing pages.
- Confirm a missing LRN is rejected by both browser validation and direct backend invocation; confirm invalid length/prefix is rejected.
- Confirm valid LRN is stored as text and duplicate LRN is rejected.
- Confirm an LRN correction cannot be submitted with a blank proposed value and duplicate LRN correction is rejected at approval.
- Confirm Owner can grant Admissions to an active verified dummy Applicant/Encoder account, and the account must sign in again.
- Confirm a non-Owner cannot list accounts or grant/revoke Admissions access.
- Confirm an Admissions account cannot access Owner-only homepage, pages, or correction administration.
- Confirm revocation restores the account's previous role and invalidates existing sessions.
- Confirm role audit records every successful grant/revoke with the documented reason and actor.
- Re-run `runAdmissionDbSetup()` to confirm the identifier backfill is idempotent and does not create duplicate identifier rows.

No Apps Script runtime validation is claimed for this Stage 1 change until these staging tests are completed. Do not run either setup function against production.
