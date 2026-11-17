# Stage 2.6 — Admissions Workflow Schema Setup Implementation Plan

**Status:** Implemented on the approved branch; static validation complete; staging preflight not yet run  
**Date:** November 18, 2026  
**Repository:** `morehians-cmd/MA-Admission-Portal_New`  
**Work branch:** `integration/auth-db-foundation`  
**Approved design:** Stage 2.4 schema dictionary  
**Approved safety contract:** Stage 2.5 schema setup specification

## 1. Purpose

Translate the approved Stage 2.5 safety contract into a small, isolated Apps Script implementation for the 12 admissions workflow sheets. The first deliverable is a read-only preflight/dry-run. Sheet creation is a separate function and will not be run until the user explicitly authorizes it.

The implementation is recorded in `AdmissionWorkflowSchema.gs`. No setup function has been run, no Script Properties have been changed, no spreadsheet has been edited, and no migration or deployment has occurred.

## 2. Repository inspection and compatibility findings

The current branch already contains `AdmissionDb.gs` and an existing `admissionDbSetup_()` function. That existing function is not suitable for the new workflow schema setup because it also:

- Calls `authMigrateUsersSheet()`.
- Creates/verifies the legacy `AdmissionStudents`, `AdmissionAudit`, and `StudentIdentifiers` schemas.
- Backfills official identifier records.

The new workflow setup must not call, wrap, or silently reuse `admissionDbSetup_()`. The existing function and its current behavior must remain unchanged during this work.

The repository also has existing authentication/database helpers. Their exact contracts, authorization behavior, and spreadsheet-target resolution must be inspected from current source before coding. Do not assume that an editor-only helper is equivalent to the approved Owner-only permission.

## 3. Planned code boundary

### 3.1 New isolated source file

Proposed new file: `AdmissionWorkflowSchema.gs`.

Before adding it, search the entire branch for duplicate constants and function names. The file should contain only:

- The 12 approved sheet names.
- Exact ordered header arrays copied from the approved Stage 2.4 dictionary.
- A schema version constant and separate requirement-rule version constant.
- Header validation and deterministic fingerprint helpers.
- Read-only preflight/dry-run function.
- Separately callable sheet-creation function.
- Small report-building helpers.

Do not edit `AdmissionDb.gs`, `Auth.gs`, `AuthAccount.gs`, `Router.gs`, or HTML files merely to make the new setup work. If a required integration change is discovered, stop and document it for separate review before expanding scope.

### 3.2 Proposed entry points

Names are provisional until collision checks are complete:

- `admissionWorkflowSchemaPreflight()` — read-only report; must not write to the workbook or Script Properties.
- `admissionWorkflowSchemaSetup()` — creates only missing, preflight-approved workflow sheets; never repairs or rewrites an existing sheet.

Both functions must be manually invoked by an authorized staging administrator. Neither may be called by `doGet`, page load, login, deployment, or normal portal navigation.

## 4. Staging environment verification

A code constant alone is not a sufficient production safeguard: the same code can be copied into a production Apps Script project. Before implementation, inspect the existing database configuration and agree on a positive staging identity check.

Proposed guard, subject to inspection of the existing configuration:

- The user manually configures a staging-only environment marker such as `ADMISSION_WORKFLOW_ENVIRONMENT=STAGING`.
- The user manually configures the expected copied workbook ID in a separate staging-only property such as `ADMISSION_WORKFLOW_STAGING_SPREADSHEET_ID`.
- The guard resolves the actual database through the existing approved spreadsheet helper and compares its ID with the expected staging workbook ID.
- Missing, inconsistent, or non-STAGING values cause a fail-closed error before any mutation.
- The setup code itself never creates, edits, or deletes Script Properties.
- Do not copy a production workbook ID into these values. Do not expose full spreadsheet IDs in logs or user-facing reports.

The exact property names and helper functions must be confirmed against the current branch before code is written. Setting these two properties is a separate manual staging configuration action and will be requested only when the user is ready for implementation/testing. No production property will be touched.

If the existing configuration cannot support a reliable staging identity check without changing protected components, stop and present the required minimal change for approval.

## 5. Preflight / dry-run behavior

The preflight function must be read-only. It should:

1. Verify the authenticated executing account and Owner-level permission using the existing server-side authentication authority.
2. Verify the explicit staging marker and expected staging workbook ID.
3. Resolve the workbook using the existing database configuration helper.
4. Inspect all protected legacy sheets and compare their required existing headers against the current repository contract, without writing.
5. Inspect each of the 12 workflow target sheet names.
6. For a missing workflow sheet, report that it would be created.
7. For an existing workflow sheet with exact approved headers, report it as valid and unchanged.
8. For any existing target with unexpected, duplicate, missing, or malformed headers, report a blocking mismatch.
9. If a protected legacy sheet has an unexpected schema, block the whole setup.
10. Return a structured report with `dryRun: true`, schema version, planned creations, validated sheets, blocked sheets, and concise error codes.

The preflight function must not:

- Create sheets or header rows.
- Format sheets or freeze rows.
- Change Script Properties, triggers, deployment settings, or permissions.
- Append audit rows or modify any cell.
- Run legacy setup, migration, or identifier backfill functions.

A preflight that detects a blocking mismatch must return a blocked report and must not offer a bypass flag.

## 6. Sheet creation behavior

The creation function is a distinct operation and must repeat all authorization, environment, workbook-ID, legacy-schema, and target-header checks immediately before writing. It must not trust a prior dry-run report as authorization because the workbook may have changed after the report.

It may:

- Create only missing sheets from the exact 12-name allow-list.
- Write exact approved headers to the newly created sheet.
- Freeze the first row as a minimal presentation setting.
- Verify the created sheet's exact ordered headers.
- Return created, validated, blocked, and error arrays.

It must not:

- Write to an existing sheet.
- Repair an empty but mismatched target.
- Insert or delete columns.
- Change any protected legacy sheet.
- Seed requirement catalog rows or sample records.
- Create IDs or application/student/enrollment records.
- Call `admissionDbSetup_()` or any legacy migration/backfill function.
- Delete sheets automatically after a partial failure.

If one creation step fails, stop and report partial completion. A later rerun may continue only after re-validating the current workbook and confirming that every already-created sheet has exact headers.

## 7. Exact schema source and validation

The header arrays must be transcribed from the approved `ADMISSIONS_DATABASE_SCHEMA_DICTIONARY.md`, not reconstructed from memory or legacy column positions.

Static checks must verify:

- Exactly 12 unique sheet names.
- Every sheet has a non-empty header array.
- No duplicate headers within a sheet.
- Header order and spelling match Stage 2.4 exactly.
- Header counts match the dictionary.
- All controlled values and field names remain aligned with the approved dictionary.
- No legacy schema arrays or existing functions are modified.
- No new thirteenth sheet is introduced for metadata.
- Schema version and requirement-rule version are distinct constants.

If a discrepancy is found between the approved dictionary and the earlier implementation plan, the approved Stage 2.4 dictionary governs unless the user approves a revision.

## 8. Security and error handling

- Enforce Owner permission server-side for both functions.
- Do not accept a browser-supplied role, actor email, spreadsheet ID, or authorization decision.
- Do not expose personal data, full spreadsheet IDs, tokens, or secret values in reports/logs.
- Use clear error codes for missing environment marker, wrong workbook, unauthorized actor, legacy schema mismatch, target schema mismatch, and partial creation.
- Fail closed on unexpected errors.
- Do not log full exception payloads if they could contain sensitive values.
- Do not represent sheet existence as proof that any application endpoint is secure or operational.

## 9. Static validation before user sync

Before asking the user to copy the new file into Apps Script:

1. Confirm branch remains `integration/auth-db-foundation`.
2. Search for duplicate function and constant names.
3. Run JavaScript syntax checks.
4. Compare all 12 header arrays against the Stage 2.4 dictionary.
5. Confirm preflight contains no spreadsheet mutation methods.
6. Confirm the creation function writes only to newly inserted workflow sheets.
7. Confirm no delete/clear/rewrite/column insertion behavior exists.
8. Confirm no call to `admissionDbSetup_()`, `authMigrateUsersSheet()`, or identifier backfill exists.
9. Confirm no setup invocation is wired into routing, page load, login, or deployment.
10. Confirm no hard-coded spreadsheet ID, credential, token, or secret exists.
11. Review all environment and Owner authorization guards.
12. Record the exact file(s) the user needs to sync; do not ask them to sync unrelated files.

Only after these checks pass should the user be asked to sync the new source file to the separate staging Apps Script project for the read-only preflight test.

## 10. User-run staging sequence and authorization gates

| Step | Action | User authorization required |
|---|---|---|
| 1 | Review and approve this implementation plan | Yes |
| 2 | Implement isolated schema source file on integration branch | Covered by approval of plan; no staging execution |
| 3 | Static validation and GitHub commit | No additional staging permission |
| 4 | User manually configures staging-only environment marker and expected copied workbook ID | Explicit confirmation before configuration |
| 5 | User syncs the specified new file into staging Apps Script | User action |
| 6 | Run read-only preflight | Explicit user approval to execute preflight |
| 7 | Review preflight output and resolve any mismatch | User review |
| 8 | Run sheet-creation function | Separate explicit user approval immediately before execution |
| 9 | User confirms actual created tabs and headers | User-reported validation |

No production configuration, production spreadsheet, or deployment is included in this sequence.

## 11. Acceptance criteria

The implementation is ready for the staging preflight only when:

- The isolated source file passes all static checks.
- The preflight is demonstrably read-only by source inspection.
- The staging identity guard checks both the explicit marker and actual workbook ID.
- Owner authorization is server-enforced.
- All 12 headers match Stage 2.4 exactly.
- Existing legacy setup functions remain unchanged.
- No data migration, ID issuance, or record creation is present.

The sheet-creation operation is ready for a staging run only after the user reviews a clean preflight report and separately authorizes the run.

## 12. Out of scope

- Applicant or returning-student workflow endpoints.
- Shared data-access layer beyond what schema setup strictly needs.
- New student identity or official ID issuance logic.
- Requirement catalog seeding.
- Application/registration/enrollment records.
- User interface or Admissions dashboard changes.
- Production setup, migration, deployment, or live data work.

These belong to later implementation phases and require their own specifications and approval gates.

## 13. Related documents

- `ADMISSIONS_WORKFLOW_SPEC.md` — governing admissions workflow.
- `ADMISSIONS_DATABASE_IMPLEMENTATION_PLAN.md` — overall phased implementation plan.
- `ADMISSIONS_DATABASE_SCHEMA_DICTIONARY.md` — approved 12-sheet names and exact field definitions.
- `ADMISSIONS_SCHEMA_SETUP_SPECIFICATION.md` — approved safety contract.
- `INTEGRATION_AUTH_DB.md` — current authentication and database integration state.


## 14. Implementation and static validation result

Implementation file: `AdmissionWorkflowSchema.gs`

The approved implementation contains two manually invoked functions:
- `admissionWorkflowSchemaPreflight()` — read-only inspection.
- `admissionWorkflowSchemaSetup()` — creates only missing sheets after repeating the authorization, staging identity, and schema checks.

The staging guard requires all three Script Properties to agree:
- `ADMISSION_WORKFLOW_ENVIRONMENT=STAGING`
- `ADMISSION_WORKFLOW_STAGING_SPREADSHEET_ID` set to the copied staging workbook ID
- `DB_SHEET_ID` set to that same copied staging workbook ID

The guard also requires editor execution and an active `Owner` account in the configured `Users` sheet. The setup code does not set or modify these properties.

Static checks completed against the integration branch:
- JavaScript source parses successfully.
- Exactly 12 unique target sheet names are defined.
- All 12 ordered header arrays match the Stage 2.4 dictionary, including the explicit Sheet 9 clarification.
- Preflight contains no spreadsheet/property mutation operation.
- No call to legacy setup, user migration, or identifier backfill functions exists.
- No duplicate function-name collision was found across the branch's Apps Script source files.
- Existing setup and authentication source files were not modified.
- No setup call was added to routing, page load, sign-in, or deployment.

**Not yet tested:** Apps Script runtime behavior, staging property configuration, read-only preflight against the copied workbook, and sheet creation. These remain separate user-authorized staging steps.
