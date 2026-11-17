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

The destination authentication model uses email-based accounts, PBKDF2-HMAC-SHA256 password hashes with per-user salts, versioned cache sessions, and roles `Owner`, `Encoder`, `Student`, and `Applicant`. Session validation reads the current account status and token version from the Users sheet.

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
3. **Stable relationship:** add a nullable `StudentID` account-link field only as an appended column in a controlled schema migration. Link account to admission record by `StudentID`, never by email alone.
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
| Roles | Owner, Encoder, Student, Applicant | admin/student plus clearance fields | Explicit role mapping; never trust client role |
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
- Added an Applicant-only first-application endpoint and an Applicant/Student self-read endpoint. The server controls StudentID, email, timestamps, name, age, classification, and enrollment status.
- Added an owner-only schema setup function. It creates/verifies schema only; it does not import records.
- JavaScript syntax checks passed for `Auth.gs`, `AuthAccount.gs`, and `AdmissionDb.gs`. A static comparison confirmed the destination student schema matches all 117 source fields in order.

### Not yet performed
- No Apps Script runtime tests have been run.
- No spreadsheet schema setup or data migration has been run.
- No deployment or trigger has been changed.
- No source accounts, password hashes, or student records have been imported.

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
