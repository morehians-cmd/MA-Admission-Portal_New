# Stage 2.8 — Shared Admissions Data Access Layer Implementation Plan

**Status:** Implemented on approved branch; static validation completed; staging validation pending separate approval  
**Date:** November 18, 2026  
**Repository:** `morehians-cmd/MA-Admission-Portal_New`  
**Work branch:** `integration/auth-db-foundation`  
**Governing workflow:** `ADMISSIONS_WORKFLOW_SPEC.md`  
**Schema contract:** `ADMISSIONS_DATABASE_SCHEMA_DICTIONARY.md`  
**Schema setup:** `AdmissionWorkflowSchema.gs` — staging setup completed and user-reported

## 1. Purpose and outcome

Create a small, shared, server-side data-access layer for the 12 approved admissions workflow sheets. It will provide consistent schema validation, record lookup, safe inserts and updates, concurrency control, identity handling, and workflow audit writing for later feature modules.

This layer is infrastructure only. It does not implement applicant submission, returning-student registration, requirements decisions, approvals, enrollment, UI pages, or migrations.

The goal is to prevent each future feature from implementing its own spreadsheet access, header mapping, locking, ID generation, and audit behavior differently.

## 2. Current repository findings

Inspected on `integration/auth-db-foundation`:

- `AdmissionDb.gs` contains the existing 117-column `AdmissionStudents` schema, `AdmissionAudit`, `StudentIdentifiers`, legacy setup/backfill routines, applicant creation/read functions, and best-effort legacy audit helper.
- `Auth.gs` is the authentication authority. Its `authResolveSession_(token)` validates a live session against the Users sheet; `authRequireRole_(token, roles)` is the feature-level server authorization helper. The existing `Users` schema includes the internal `StudentID` link.
- `AdmissionCorrections.gs` has a separate correction store (`CorrectionRequests`, `CorrectionDocuments`, `CorrectionAudit`), private Drive handling, and Owner-only correction review. It must remain independent in this stage.
- `AdmissionWorkflowSchema.gs` defines the 12 workflow sheet names and exact ordered headers, schema version `2.4.1`, and requirement-rule version `ADMISSION_REQUIREMENTS_BASELINE_2026`. The user reported that all 12 sheets were created and header-validated in the copied staging workbook.
- Existing role, homepage/page-content, authentication, correction, student, and identifier sheets are separate existing subsystems. The new data layer must not take ownership of or rewrite them.

The staging workbook currently has 26 visible tabs according to the user's report. This plan covers only the 12 workflow sheets listed in the schema dictionary.

## 3. Scope and non-goals

### In scope

1. A new isolated source file, proposed name `AdmissionWorkflowData.gs`.
2. Read-only schema/header validation against the exact header arrays in `ADMISSION_WORKFLOW_SCHEMA.HEADERS`.
3. Header-name-to-column mapping; no hard-coded numeric column positions in feature code.
4. Internal read helpers for one sheet, record-by-ID, and filtered records.
5. Validated insert and controlled update helpers.
6. Immutable server-generated record IDs and timestamps.
7. ScriptLock-based write coordination and duplicate/uniqueness checks performed inside the lock.
8. A shared append-only writer for `AdmissionWorkflowAudit`.
9. A server-side ownership/role helper contract for feature endpoints, using the existing Auth authority.
10. Structured, privacy-conscious errors and safe return objects.
11. Static validation and user-directed staging tests with synthetic records only.

### Explicitly out of scope

- Any applicant, student, Admissions, Encoder, or Owner user-interface changes.
- Public/browser-callable generic database endpoints.
- Applicant or returning-student workflow business rules beyond data integrity.
- Creating, renaming, deleting, repairing, or reordering spreadsheet tabs or columns.
- Changes to `AdmissionStudents`, `AdmissionAudit`, `StudentIdentifiers`, `Users`, `AuthAudit`, role audit, correction sheets, page/homepage sheets, or their existing code.
- Changes to `AdmissionDb.gs`, `Auth.gs`, `AdmissionCorrections.gs`, routing, or deployment.
- Migration, identifier backfill, data import, seed data, or production setup.
- Drive file storage or document generation.
- A claim that Google Sheets provides transactional multi-sheet commits.

## 4. Proposed architecture

### 4.1 Single schema authority

Use `ADMISSION_WORKFLOW_SCHEMA.HEADERS` from `AdmissionWorkflowSchema.gs` as the exact ordered header contract. Do not copy a second independent header dictionary into the new file.

At initialization of each data operation (or through a carefully invalidated in-execution context), validate:
- The target sheet exists.
- The actual header row has exactly the expected number of columns.
- Every header matches the expected spelling and order.
- No duplicate expected header exists.

If a sheet is missing or mismatched, fail closed with a stable schema error. The data layer must never auto-create, repair, append columns, freeze rows, or modify headers.

### 4.2 Internal-only helper boundary

All generic storage helpers end with an underscore and are not browser-callable through Apps Script's `google.script.run` convention. Proposed helper family:

- `admissionWorkflowDataSpreadsheet_()` — resolve the existing configured spreadsheet through `authSpreadsheet_()`; do not add fallback configuration.
- `admissionWorkflowDataSheet_(sheetName)` — allow-list sheet name and validate exact schema.
- `admissionWorkflowDataHeaderMap_(sheetName)` — map exact header names to zero-based indexes.
- `admissionWorkflowDataReadAll_(sheetName, options)` — return normalized objects, excluding internal row metadata from public responses.
- `admissionWorkflowDataFindById_(sheetName, idField, id)` — exact ID lookup.
- `admissionWorkflowDataFindMany_(sheetName, criteria, options)` — bounded, allow-listed criteria only; no arbitrary client query language.
- `admissionWorkflowDataInsert_(sheetName, record, options)` — validate allowed fields, generate required ID/timestamps server-side, append under lock, and return the inserted identifier.
- `admissionWorkflowDataUpdateById_(sheetName, idField, id, changes, options)` — update an allow-listed set of mutable columns only; preserve primary keys and immutable creation fields.
- `admissionWorkflowDataAppendAudit_(event)` — append one event to `AdmissionWorkflowAudit`; never update or delete old events.
- `admissionWorkflowDataWithLock_(callback)` — acquire/release ScriptLock safely around a complete critical section.
- `admissionWorkflowDataValidateRecord_(sheetName, record, mode)` — generic structural validation only; domain rules remain in feature modules.

These are proposed internal names, subject to collision search before implementation. Do not expose a generic public read/write function to the browser.

### 4.3 Feature endpoint boundary

Future public functions (for example, applicant or Admissions endpoints) must:
1. Accept a session token and narrowly scoped business input.
2. Resolve the session using `authRequireRole_` or `authResolveSession_`.
3. Derive actor email, role, StudentID, and ownership from the authenticated server session, never from client-supplied identity fields.
4. Apply the feature-specific field allowlist and business validation.
5. Call internal data helpers.
6. Append an audit event with a correlation/reference ID.
7. Return only the fields the caller is authorized to see.

The generic data layer itself does not decide whether an Applicant, Student, Encoder, Admissions user, or Owner may perform a business action. That policy belongs to the feature endpoint and must be documented per action.

## 5. Data contracts and integrity rules

### 5.1 Record representation

- Read records as objects keyed by exact header names.
- Convert spreadsheet Date objects to a documented ISO representation at the boundary; do not silently mix Date objects, locale-formatted strings, and ISO timestamps.
- Preserve identifiers and LRN as text.
- Keep internal row numbers private to the server helper and never return them to a browser.
- Do not serialize complete records or nested structures into arbitrary JSON cells.

### 5.2 IDs and timestamps

- Generate IDs on the server only, using the agreed UUID-based text convention from the schema dictionary.
- Never accept a client-provided primary key, actor, creation timestamp, or authoritative status timestamp.
- Use ISO 8601 UTC timestamps for DATETIME fields; school-date calculations remain governed by the approved Asia/Manila policy in the relevant feature.
- Do not generate StudentID or official identifiers in this data layer. Those belong to the separately approved identity/enrollment lifecycle.

### 5.3 Insert and update safeguards

- Each sheet has an explicit primary-key field and an explicit mutable-field policy. Do not assume every non-key field is mutable.
- Reject unknown columns, duplicate keys in the input object, missing required fields, invalid field types, and attempts to overwrite immutable values.
- Use exact header names rather than positional assumptions.
- Format text fields as text when writing identifiers and values that could be interpreted as formulas; reject or safely encode formula-leading user text according to a documented policy.
- No hard delete helper is included.
- No general-purpose upsert is included. Idempotent create/retry behavior must be designed by each workflow using its own stable request key and uniqueness rules.
- For a multi-row business operation, prevalidate all writes under one lock and document the write order and compensation behavior. Google Sheets does not provide a true transaction; do not promise atomic rollback across sheets.

### 5.4 Uniqueness and concurrency

- Acquire `LockService.getScriptLock()` before checking uniqueness and writing.
- Re-read relevant rows after acquiring the lock; do not rely on a prior UI or pre-lock lookup.
- Enforce the schema dictionary's uniqueness constraints, including primary keys and explicitly approved logical unique keys.
- Do not invent new unique constraints. In particular, requirement-row attempt/version semantics and registration recovery behavior remain subject to the governing policy and later feature specification.
- Return a controlled duplicate/conflict error rather than silently overwriting a record.

### 5.5 Audit contract

For each successful business mutation, the feature endpoint should append an `AdmissionWorkflowAudit` event with:
- EntityType and EntityID.
- StudentID only when legitimately linked and applicable.
- Action and previous/new status where relevant.
- Server-derived ActorEmail and ActorRole.
- Reason when required by the workflow.
- RelatedRecordID, OccurredAt, Source, and CorrelationID.

Audit rows are append-only. Do not store passwords, OTPs, session tokens, private Drive URLs, identity-document contents, full profile snapshots, or unnecessary sensitive values in audit details. Audit failure handling must be explicit: for high-impact actions, the business operation must not report success if the required audit event was not persisted. The feature specification must decide whether to fail the operation or use a durable retry/outbox pattern; do not silently swallow audit failures.

## 6. Privacy and authorization safeguards

- All authorization is server-side and feature-specific.
- Applicant/Student ownership is derived from the authenticated account's `StudentID` or `UserID` relationship; never accept a target StudentID from the browser as proof of ownership.
- Owner-only `GenderIdentity` access must be enforced before the field is read into a response, not merely hidden in the UI. The generic data layer should support field projection/redaction but must not itself grant access.
- Sensitive fields and private correction documents are not included in generic list responses by default.
- Do not return row numbers, raw sheet objects, Drive IDs, spreadsheet IDs, or internal error details.
- Spreadsheet editor access is not a per-sheet confidentiality boundary. Preserve the current restricted-sharing requirement for the database workbook.
- The generic layer does not change sharing, protected ranges, Drive permissions, Script Properties, or triggers.

## 7. Error and response model

Use a consistent internal error vocabulary, for example:
- `WORKFLOW_SCHEMA_MISSING`
- `WORKFLOW_SCHEMA_MISMATCH`
- `WORKFLOW_RECORD_NOT_FOUND`
- `WORKFLOW_DUPLICATE_RECORD`
- `WORKFLOW_INVALID_FIELD`
- `WORKFLOW_IMMUTABLE_FIELD`
- `WORKFLOW_CONFLICT`
- `WORKFLOW_LOCK_TIMEOUT`
- `WORKFLOW_STORAGE_FAILURE`
- `WORKFLOW_UNAUTHORIZED`

Public feature endpoints translate internal errors into safe user-facing messages. Do not expose stack traces, spreadsheet IDs, raw exception payloads, or other users' data.

## 8. Performance and scalability guardrails

- Avoid repeated full-workbook reads; read only the required sheet and required columns.
- Batch range reads and writes where safe.
- Bound list queries and pagination; do not return entire application/profile datasets to the browser.
- Use a server-side header map within a single execution to avoid repeated scans, but do not rely on a persistent cache that can become stale after schema changes.
- Do not add hidden sheets, metadata tabs, or undocumented indexes in this stage.
- Establish a documented row-count/performance review threshold before considering indexes, caching, or moving to a different datastore.

## 9. Static review and staging validation plan

### Static checks before user sync

1. Confirm branch is still `integration/auth-db-foundation`.
2. Search for collisions across all `.gs` files for proposed helper names and constants.
3. Confirm the new file only references the approved 12 workflow sheets.
4. Confirm it reads header definitions from `ADMISSION_WORKFLOW_SCHEMA.HEADERS` rather than duplicating them.
5. Confirm no sheet creation, header repair, deletion, clear, migration, identifier backfill, or Drive operation exists.
6. Confirm no public generic CRUD endpoint is exported.
7. Confirm every write uses the shared lock and field allowlist.
8. Confirm audit writes are append-only and errors are not silently swallowed for critical mutations.
9. Confirm all actor and ownership fields are server-derived.
10. Run JavaScript syntax checks and inspect all write call paths.
11. Confirm existing `AdmissionDb.gs`, `Auth.gs`, `AdmissionCorrections.gs`, router, and HTML files are unchanged.
12. Commit only the new source file after the implementation plan is approved.

### Staging tests (synthetic data only; separate user approval before each write test)

1. Read-only schema validation succeeds for all 12 workflow sheets.
2. Read-only lookup handles an empty sheet and a sheet containing synthetic records.
3. Unknown sheet names and mismatched headers fail closed without mutation.
4. Insert rejects unknown fields, client-supplied IDs, invalid required fields, and formula injection attempts.
5. Valid insert creates one row with server-generated ID and timestamps.
6. Duplicate logical keys are rejected under concurrent test attempts.
7. Update changes only explicitly mutable fields; immutable ID and CreatedAt remain unchanged.
8. Wrong-role, expired-session, and cross-user ownership tests fail closed at the feature endpoint layer.
9. Owner-only GenderIdentity projection is tested at the endpoint boundary.
10. Audit events record the server actor and correlation ID without secrets or unnecessary sensitive values.
11. Simulated audit failure does not result in a false success for critical actions.
12. Re-run read-only checks and verify existing legacy sheets and records remain unchanged.

The user must provide execution logs/results. Static checks do not count as Apps Script runtime validation. No real student or applicant information is to be used.

## 10. Approval gates and execution sequence

| Step | Action | Approval boundary |
|---|---|---|
| 1 | Review this Stage 2.8 plan | User approval required |
| 2 | Search helper-name collisions and finalize field/mutation contracts | Within approved planning; report any scope change |
| 3 | Implement isolated `AdmissionWorkflowData.gs` on the approved branch | Requires plan approval |
| 4 | Static validation and GitHub commit | Within approved implementation scope |
| 5 | User syncs only the new source file to staging | User action |
| 6 | Run read-only schema validation in staging | Separate explicit approval |
| 7 | Run synthetic write/read/update/audit tests | Separate explicit approval before writes |
| 8 | Review test results and update integration documentation | User-reported evidence |
| 9 | Proceed to the first workflow feature only after a separate specification and approval | Separate stage |

Approval of this plan does not authorize staging writes, production configuration, production deployment, or data migration.

## 11. User decisions and final design constraints

The user reviewed the Stage 2.8 plan and confirmed all five design decisions:

1. **Primary key format:** UUID-based IDs generated server-side. The client must not supply primary keys.
2. **Audit failure policy:** fail critical operations rather than report success when required audit persistence fails.
3. **Helper accessibility:** internal server-side helpers only; no generic browser-callable CRUD endpoint.
4. **Read model:** bounded filtering and pagination; do not return full workflow sheets to the browser.
5. **Scope:** only the 12 approved admissions workflow sheets. The other 14 tabs remain outside this layer.

### 11.1 Required audit-failure refinement

Google Sheets does not provide an atomic transaction across multiple sheets. A business record may be written successfully while its subsequent audit append fails. Returning an ordinary failure in that situation can cause a retry to duplicate an operation; returning success would violate the user's audit policy.

Therefore, feature-level mutation flows must distinguish at least these outcomes:

- **Not committed:** the business mutation did not occur; return a safe failure.
- **Committed and audited:** both the business mutation and its required audit event were persisted; return success.
- **Committed, audit uncertain/failed:** the business mutation may have persisted but its required completion audit did not; do not return success. Return a distinct safe `WORKFLOW_AUDIT_OUTCOME_UNCERTAIN` result with a server-generated correlation/reference ID and require reconciliation before retrying.

For critical multi-step operations, the feature implementation must define the write order, pre-write audit/intent strategy where appropriate, post-write audit event, reconciliation procedure, and idempotency mechanism. A pre-write intent event is not proof that the business mutation completed. A post-write audit event is required to confirm completion.

The generic layer must not claim transactional rollback. It must not add an outbox sheet, new columns, or hidden metadata store in this stage. If a durable idempotency/outbox design requires schema changes or a new sheet, stop and obtain separate approval before changing the approved 12-sheet schema. Until a feature-specific idempotency strategy is documented, do not automatically retry an operation whose commit outcome is uncertain.

Any new unique constraint, mutable-field policy, or domain validation rule discovered during implementation must be documented and brought back for approval rather than assumed.

## 12. Acceptance criteria

Stage 2.8 implementation is ready for staging only when:
- The implementation is isolated in the new data-access file.
- The exact Stage 2.6 header contract is reused without duplication.
- All writes are guarded by lock, field allowlists, uniqueness checks, and server-generated identity/timestamps.
- Authorization and ownership remain in server-side feature endpoints.
- Audit events are append-only; critical audit failure is surfaced distinctly, never silently ignored, and an uncertain commit outcome is not retried blindly.
- No legacy sheet, schema, auth implementation, correction module, UI, property, trigger, or production resource is changed.
- Static checks pass and staging tests are separately authorized and user-reported.

**Implementation status:** The isolated `AdmissionWorkflowData.gs` source file has now been added on the approved branch. No Apps Script sync, staging execution, staging write test, production operation, or deployment has been performed as part of this implementation.


## 13. Decision review outcome

All five user decisions are consistent with the architecture in this plan. The audit-failure refinement above is mandatory because a spreadsheet write and a separate audit append cannot be treated as one atomic transaction.

### Implementation result

- Added `AdmissionWorkflowData.gs` as the only new source file for this stage.
- Reuses `ADMISSION_WORKFLOW_SCHEMA.HEADERS`; it does not duplicate the 12 header arrays.
- Provides internal-only schema validation, header mapping, paginated reads, exact-ID lookup, filtered reads, controlled insert/update helpers, UUID generation, uniqueness checks, ScriptLock coordination, and append-only workflow audit writing.
- Uses per-sheet primary-key, required-field, uniqueness, and mutable-field policies for all 12 approved workflow sheets.
- Generic reads redact `GenderIdentity` by default. Any future Owner-only retrieval must first be authorized by its feature endpoint before the internal helper is called with sensitive-field inclusion.
- Insert/update/audit helpers are lock-protected. Update rejects immutable and server-managed fields from the ordinary changes object; trusted server values are supplied separately by internal feature code.
- The data layer does not create/repair sheets, expose browser CRUD, perform Drive operations, change Script Properties, or modify legacy modules.
- Audit append is a separate write. Feature endpoints must handle a post-mutation audit failure as an uncertain outcome and must not blindly retry.

### Static validation performed

- JavaScript syntax parse: passed.
- Schema version read: `2.4.1`.
- Schema target count and data-layer policy count: 12 and 12.
- Every policy primary key, required field, mutable field, and declared uniqueness field exists in the authoritative header array: passed.
- Confirmed no public generic CRUD function, sheet-creation/deletion/clear call, Drive operation, or Script Property mutation in the new file.
- Confirmed the three write paths (insert, update, audit append) use the shared ScriptLock helper.
- Helper-name searches returned no matches in the code-search results available; branch-wide collision certainty is limited because GitHub code search indexes the default branch, not this feature branch.

Static validation is not Apps Script runtime validation. The user must separately authorize syncing the new file and running the read-only staging check. Synthetic write tests require another explicit approval. No staging or production operation has been performed.
