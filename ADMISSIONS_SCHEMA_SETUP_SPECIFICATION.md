# Stage 2.5 — Safe Admissions Schema Setup Specification

**Status:** Prepared for review; documentation only  
**Date:** November 18, 2026  
**Repository:** `morehians-cmd/MA-Admission-Portal_New`  
**Work branch:** `integration/auth-db-foundation`  
**Approved design:** `ADMISSIONS_DATABASE_SCHEMA_DICTIONARY.md` (Stage 2.4)  
**Implementation sequence:** `ADMISSIONS_DATABASE_IMPLEMENTATION_PLAN.md` (Stage 2.3)

## 1. Purpose

Define the exact safety contract for creating and validating the 12 approved admissions workflow sheets in a disposable staging spreadsheet. This specification is the pre-implementation checkpoint between the approved data model and writing schema-setup code.

This document does not implement or run setup. It does not authorize changes to Apps Script code, any spreadsheet, production resources, deployments, triggers, Drive permissions, Script Properties, or live student data.

## 2. Governing decisions

The following are fixed inputs to the setup design:

- The approved schema contains exactly 12 new workflow sheets:
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
- Exact ordered headers, data types, controlled values, and field rules are defined by the approved Stage 2.4 schema dictionary.
- Existing sheets—including `Users`, `AdmissionStudents`, `StudentIdentifiers`, `AdmissionAudit`, and correction-request sheets—are preserved.
- Existing StudentID relationships and all legacy records remain unchanged.
- The 117-column `AdmissionStudents` structure is compatibility-sensitive. It is not a target for header replacement, column reordering, bulk rewriting, or destructive normalization.
- `ApplicationRequirements` is source-aware and serves both new applications and current-student registrations.
- No permanent StudentID or official MA identifier is created merely because a new applicant registers, verifies email, creates a draft, or submits an application.
- The setup must not create sample learners, accounts, applications, registrations, or enrollment records.

## 3. Execution boundary and preflight gate

Schema setup may only be developed and eventually executed under all of these conditions:

1. The active Git branch is exactly `integration/auth-db-foundation`.
2. The Apps Script project is the separate staging project, not the production project.
3. Its configured database is a copied staging spreadsheet, not the production workbook.
4. The user has confirmed a fresh backup/copy of that staging workbook.
5. The spreadsheet ID is read from the staging project's existing configuration; it is not hard-coded into source code or copied from production.
6. The executing account has the intended staging Owner/editor authorization.
7. No real student personal data is used in initial tests; synthetic records only.
8. The user explicitly authorizes the implementation/run step before any setup function is executed.

If any item is unconfirmed, stop before setup. Do not attempt to infer which spreadsheet is staging from its name alone.

## 4. Setup function contract

The future setup function should be an explicit, Owner-authorized administrative operation, for example `admissionWorkflowSchemaSetup_()`. The final function name must be checked against the current repository to avoid collisions before coding.

The setup operation must:

- Resolve the configured spreadsheet through the existing database configuration helper.
- Verify that the active spreadsheet target is the intended staging database using a safe, explicit environment marker; do not infer environment from a spreadsheet title.
- Verify all pre-existing protected sheets before making any changes.
- Create only missing sheets from the 12-sheet allow-list.
- Write the exact approved header row only to a newly created, empty sheet.
- Apply only minimal, non-destructive presentation settings (for example frozen header row); formatting must never alter data semantics.
- Verify the resulting sheet names and exact ordered headers.
- Return a structured report listing created sheets, already-valid sheets, and blocked/mismatched sheets.
- Write a setup audit event only if the audit mechanism is itself available and the event can be written without changing legacy audit schemas.
- Be safe to re-run without creating duplicates or rewriting existing data.

The setup function must not:

- Rename, delete, clear, or recreate any existing sheet.
- Rewrite headers in an existing sheet, even if they appear outdated.
- Insert, delete, move, or reorder columns in any existing sheet.
- Clear existing rows, formats, formulas, filters, named ranges, validations, or protections.
- Populate records, seed requirement catalogs, or generate IDs.
- Change spreadsheet bindings, Script Properties, triggers, deployments, Drive permissions, or timezone.
- Modify authentication/session code or account roles.
- Run a migration or backfill.
- Run automatically on page load, sign-in, deployment, or ordinary user requests.

## 5. Existing-sheet and header validation

Before creating any of the 12 sheets, inspect protected existing sheets and record their observed names and header rows in a read-only preflight report.

For each target workflow sheet:

| Observed state | Required behavior |
|---|---|
| Sheet does not exist | Create it and write the approved header row |
| Sheet exists, is empty, and has no header | Treat as a recoverable setup candidate only if it is explicitly identified as a workflow sheet; write approved headers |
| Sheet exists with exact approved headers | Leave it unchanged and report valid |
| Sheet exists with different headers and no data | Stop and report mismatch; do not auto-correct |
| Sheet exists with different headers and data | Stop; do not write to that sheet |
| Sheet exists with duplicate/malformed headers | Stop and report exact conflict |
| Protected legacy sheet has unexpected headers | Stop the entire setup before creating any new sheet |

A mismatch is a human-review condition, not permission for automatic repair. A future, separately approved migration plan may address a mismatch after backup and field-level review.

## 6. Atomicity and partial failure

Google Sheets does not provide a transaction spanning multiple sheet creations and writes. Therefore the setup must be designed as a guarded, resumable operation:

1. Complete all read-only preflight checks first.
2. Build and validate all expected header definitions in memory.
3. Identify every target sheet that would need creation.
4. If any protected legacy sheet or existing target sheet has a blocking mismatch, make no changes.
5. Create missing sheets one at a time, writing the header immediately after creation.
6. Verify each created sheet immediately.
7. If a later operation fails, stop; do not delete successfully created sheets automatically.
8. Return a partial-completion report with the exact successful and failed steps.
9. A re-run should recognize already-correct sheets and continue only with missing sheets.

Do not claim the operation is atomic. Do not roll back by deleting sheets or clearing data.

## 7. Schema versioning

The 12-sheet count must remain unchanged. Schema version metadata should therefore live in code constants and/or a carefully reviewed configuration mechanism, not in an unapproved thirteenth sheet.

The implementation should define:

- A single schema version constant for the initial approved dictionary.
- A version identifier for the requirement rules/catalog separately from the physical sheet schema.
- Exact ordered header arrays copied from the approved dictionary.
- A deterministic header fingerprint for diagnostics.
- A setup report containing expected schema version and observed header fingerprints.

A future schema change must be additive where possible and must have a reviewed migration plan. Never silently change a released header array and let setup rewrite an existing sheet.

## 8. Data-access and security requirements

Creating sheets does not make them safe to use. Before any endpoint reads or writes the new sheets:

- Resolve the authenticated session using the existing destination authentication authority.
- Derive the actor's account and role on the server.
- Enforce record ownership for Applicant and Student self-service.
- Enforce Encoder preliminary-check permissions separately from Admissions final-verification and approval permissions.
- Enforce Owner-only operations server-side.
- Apply Owner-only authorization to Gender Identity reads and writes; do not rely on hiding the field in the browser.
- Reject browser-supplied actor email, StudentID, official identifiers, role, approval authority, verification result, or audit actor as trusted values.
- Validate all source IDs and logical foreign-key relationships before writes.
- Use locks for duplicate prevention, identifier issuance, account linking, and multi-sheet lifecycle transitions.
- Avoid logging passwords, OTPs, session tokens, full profiles, Gender Identity values, or unnecessary personal information.

No endpoint should be considered ready merely because the sheet exists.

## 9. Required static tests before a staging run

The schema setup code, once separately authorized for implementation, must pass these checks before the user is asked to run it:

1. JavaScript syntax validation.
2. All 12 sheet names are unique and match the approved allow-list exactly.
3. Every header array is non-empty and contains no duplicate header names.
4. Header order matches the Stage 2.4 dictionary exactly.
5. No legacy sheet header array is changed.
6. No production spreadsheet ID, folder ID, credential, token, or secret is hard-coded.
7. The setup entry point is not called from `doGet`, page initialization, login, or ordinary request handlers.
8. Setup code contains no delete/clear/recreate behavior.
9. A static scan confirms no data-seeding or migration behavior.
10. A static scan confirms no change to deployment, triggers, Drive access, or Script Properties.

## 10. Staging validation matrix

The user will execute and report results from the separate staging Apps Script project. Do not represent any of these tests as passed until the user supplies the observed result.

| Test | Expected result |
|---|---|
| First setup on a fresh copied workbook | Exactly 12 workflow sheets created with exact headers |
| Second setup on the same workbook | No duplicates; all 12 reported as already valid |
| Existing exact-header target sheet | Preserved without rewriting |
| Existing mismatched empty target sheet | Setup stops safely and reports mismatch |
| Existing mismatched populated target sheet | Setup stops safely; data remains unchanged |
| Protected legacy sheet mismatch | No workflow sheets created; preflight blocks setup |
| Missing database configuration | Clear failure before any sheet mutation |
| Wrong environment marker | Clear failure before any sheet mutation |
| Non-Owner execution | Denied server-side |
| Partial failure during creation | Stops and reports partial state; no automatic deletion |
| Post-setup legacy comparison | Existing Users, AdmissionStudents, StudentIdentifiers, AdmissionAudit, and correction sheets remain unchanged |

The user should capture the setup result and, where practical, the staging sheet tabs/header rows. Only the user's reported observations can establish runtime validation status.

## 11. Required setup report

The future setup function should return a structured result with fields equivalent to:

- `success`: true only if all 12 target sheets are valid.
- `schemaVersion`: expected schema version.
- `spreadsheetId`: masked or omitted in user-facing output; never log production identifiers.
- `createdSheets`: names created during this run.
- `validatedSheets`: names already valid or verified after creation.
- `blockedSheets`: names that failed validation.
- `errors`: concise error codes/messages without sensitive values.
- `startedAt` and `completedAt`: server-generated timestamps.
- `dryRun`: whether the operation performed no writes.

A dry-run/preflight mode should be implemented before the write mode. It should report what would be created and any mismatches without changing the workbook.

## 12. Exit criteria for Stage 2.5

Stage 2.5 documentation is complete when this specification is reviewed and the following are clear:

- The exact 12-sheet allow-list and header contract are fixed by Stage 2.4.
- The setup function's permissions and staging-only boundary are explicit.
- Existing-sheet mismatch behavior is fail-closed and non-destructive.
- Partial failure and rerun behavior are defined.
- Static and user-run staging validation responsibilities are separated.
- No production or live-data action is implied.

The next stage, after user review and approval, may implement the setup code on `integration/auth-db-foundation`. That implementation must still be separately authorized before any setup function is run in staging. Production deployment and live data migration require separate explicit approval.

## 13. Related documents

- `ADMISSIONS_WORKFLOW_SPEC.md` — governing workflow requirements.
- `ADMISSIONS_DATABASE_IMPLEMENTATION_PLAN.md` — staged implementation sequence.
- `ADMISSIONS_DATABASE_SCHEMA_DICTIONARY.md` — approved 12-sheet schema and field definitions.
- `INTEGRATION_AUTH_DB.md` — authentication/database integration baseline and known implementation state.
