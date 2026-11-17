# Admissions Workflow Specification

**Status:** Approved design baseline — documentation only  
**Date:** November 18, 2026  
**Repository:** `morehians-cmd/MA-Admission-Portal_New`  
**Work branch:** `integration/auth-db-foundation`

This document records the approved Admissions and Encoder workflow and the applicant/student information rules confirmed before Stage 2 implementation. It does not mean the workflows described here have been implemented or runtime-tested.

## 1. Scope and implementation boundary

- Stage 1 — Foundation and Compatibility is complete in the disposable staging environment based on user-reported tests.
- Stage 2 Admissions operations are approved at the workflow-design level but are not yet implemented.
- This document is the design baseline for subsequent specification, schema design, implementation, and staging validation.
- Preserve the existing authentication, homepage/login design, role management, StudentID links, identifier separation, LRN validation, and correction-request foundation.
- Continue development only on `integration/auth-db-foundation`.
- Do not modify `main`, merge/rebase the diverged branch, deploy to production, or alter production Apps Script projects, spreadsheets, triggers, Script Properties, or Drive permissions without explicit authorization.
- Use dummy applicant/student data in a separate staging Apps Script project and copied staging spreadsheet.
- Do not migrate old APMerge student data.

## 2. Approved staff responsibilities

The approved Encoder model is **Option B: data entry and preliminary requirements checking**. Admissions performs final verification and routine approval. Owner handles exceptional and protected decisions.

| Activity | Encoder | Admissions | Owner |
|---|---|---|---|
| Create/encode walk-in applications | Yes | Yes | Yes |
| Encode applicant information | Yes | Yes | Yes |
| Preliminary information review | Yes | Yes | Yes |
| Record document receipt | Yes | Yes | Yes |
| Preliminary requirements checking | Yes | Yes | Yes |
| Final requirements verification | No | Yes | Yes |
| Prepare/flag completion needs | Yes | Yes | Yes |
| Return application for completion | No; flag/recommend | Yes | Yes |
| Review corrected information | Preliminary | Final | Oversight |
| Mark ready for approval | Recommend | Yes | Yes |
| Approve routine applications | No | Yes | Yes |
| Decide exceptional/disputed/fraud cases | No | Escalate | Yes |
| Confirm official enrollment completion | No | Yes, after required steps | Yes |
| Override protected records/statuses | No | No | Yes |
| Configure admission rules and protected settings | No | No | Yes |

Recording a document as received is not the same as verifying it. Encoder preliminary review does not make an application complete, approved, or enrolled. All permissions must be enforced server-side, not only by hiding interface controls.

## 3. Application queue and assignment

Use a shared application queue with assignment controls:

- Admissions can view the general queue, review all applications, assign work, and reassign applications.
- Encoders can see limited queue information and work on applications assigned to them. They must not receive unrestricted access to all applicant records merely because they are Encoders.
- Owner retains oversight and exceptional-case access.
- Assignment, reassignment, and changes in responsibility must be audited.
- The queue and assignment interface/database records remain to be implemented.

## 4. Application-to-enrollment process

Keep application, requirements, approval, and enrollment as separate concepts and records/status dimensions.

1. **Intake:** Applicant submits online, or staff creates an assisted walk-in application. Record intake method as `ONLINE` or `WALK-IN`.
2. **Queue:** The application enters the shared Admissions queue. Admissions may assign it to an Encoder.
3. **Preliminary review:** Encoder checks entered information and document receipt, records preliminary findings, and flags missing or inconsistent items.
4. **Final verification:** Admissions reviews the application and verifies mandatory information and documents, including physical documents where required.
5. **Completion:** If information or requirements are missing, Admissions returns the application for completion with documented reasons. The applicant submits the missing information/correction; the application returns for review.
6. **Readiness:** An application is ready for approval only when all mandatory requirements have been received and finally verified.
7. **Approval:** Admissions handles routine decisions. Exceptional, disputed, suspected fraudulent, or protected-override cases are escalated to Owner.
8. **Enrollment:** An approved applicant proceeds through the separate enrollment steps. Admissions confirms enrollment only after those steps are completed.
9. **Documents:** Generate a Student Enrollment Form and an Enrollment Confirmation Slip as separate documents from the same enrollment record. The confirmation slip confirms completed enrollment; approval alone is not proof of enrollment.
10. **Student linking:** Link the completed enrollment to the permanent internal StudentID and the applicable official identifier under the approved identity rules.

An approved applicant is not automatically an enrolled student.

### 4.1 Suggested application status

- Submitted
- Under Review
- For Completion
- Ready for Approval
- Approved
- Rejected
- Withdrawn

### 4.2 Separate requirements status

Requirement-level status should distinguish receipt and review, for example:

- Not Submitted
- Received
- Preliminary Checked
- For Final Verification
- Verified
- Needs Correction / Rejected

### 4.3 Separate approval and enrollment status

Approval: Pending, Approved, Rejected, Escalated to Owner.

Enrollment: Not Started, In Progress, Enrolled, Cancelled.

Do not collapse these into one status field. For example, an application can be Approved while enrollment remains In Progress.

## 5. Requirement verification and correction controls

Each requirement record should support:

- Requirement name/type.
- Submission/receipt status.
- Preliminary review result and remarks.
- Final verification result and remarks.
- Reviewer account and role.
- Review date/time.
- Reason for rejection, return, or exception.

The existing applicant correction-request foundation should be reused and integrated, not replaced. Verified information must not be silently overwritten. Changes to verified data require an approved workflow, a documented reason, and an audit record. Disputed documents, suspected fraud, exceptional cases, and protected overrides are escalated to Owner.

## 6. Applicant and student information fields

### 6.1 Legal Sex and Gender Identity

- Include both Legal Sex and Gender Identity as distinct fields.
- The user specified that these are collected for institutional/reportorial purposes.
- Do not derive one field from the other.
- Do not use Gender Identity as an admission qualification or rejection criterion.
- Restrict access to authorized personnel and use aggregated reporting where practical.
- The mandatory/optional status and exact permitted choices for Gender Identity still require final specification; do not infer them from this document.

### 6.2 Facebook Profile Link

- Include Facebook Profile Link as an optional field, reflecting the latest user decision on November 18, 2026.
- It is not required for application submission and must not be used as an admission qualification or automated screening factor.
- Restrict access to authorized staff; do not display it in public applicant/student profiles.

### 6.3 Living arrangement and parent/guardian information

Add a **Living With** section to the applicant and applicable student-registration form. Its purpose is to identify the parent/guardian or arrangement with whom the student currently lives.

The approved conditional form behavior is:

- **Mother:** Show the Mother's Information fields.
- **Father:** Show the Father's Information fields.
- **Guardian:** Show Guardian Information using the same applicable field structure as the Mother and Father sections.
- **Both Mother and Father:** Show both parent information sections and allow the applicant to identify which parent is the Primary Contact Person.
- **Other living arrangement:** Show a field to specify the arrangement and allow the Primary Contact Person to be entered separately.

The parent/guardian sections should use the corresponding existing parent-information fields in the application data model (including applicable name, status, occupation, educational attainment, mobile number, and email fields). Guardian fields should follow the same applicable structure. Do not invent a reduced guardian-only field set.

When the applicant selects:
- **Mother:** Populate the Primary Contact Person fields from the Mother's Information.
- **Father:** Populate the Primary Contact Person fields from the Father's Information.
- **Guardian:** Populate the Primary Contact Person fields from the Guardian Information.
- **Both Mother and Father:** Ask which parent should be the Primary Contact Person, then populate from that parent's information.
- **Other:** Permit separate entry of the Primary Contact Person.

Auto-population should copy the selected person's applicable values into the Primary Contact Person fields. If required contact details are missing, prompt the applicant/staff to complete them; do not fabricate values. Admissions can review and verify the information. Changes to already verified records must follow the correction/audit process.

The exact option labels and handling of unusual living arrangements can be refined in the form specification, but the conditional behavior above is approved.

### 6.4 Primary Contact Person only — no separate Emergency Contact Person

- Remove the separate Emergency Contact Person and Emergency Contact Number fields from the applicant/student registration form.
- Retain one **Primary Contact Person** record.
- The Primary Contact Person fields are: Full Name, Address, Relationship to Student, and Contact Number.
- Do not create duplicate Primary and Emergency contact records in the admission/student profile.
- Do not display a second emergency contact block on the applicant/student registration form or enrollment documents.

**External reporting exception:** The previously reviewed TLC Office Excel template contains columns named `EMERGENCY CONTACT` and `EMERGENCY NUMBER`. Those are external report-layout fields, not permission to collect a second emergency contact in the portal. Preserve the required external template headings until the mapping/submission rule is separately confirmed. Do not invent or silently substitute data in those columns.

## 7. Audit requirements

Audit significant workflow actions, including:

- Application creation and intake method.
- Assignment and reassignment.
- Requirement receipt and preliminary/final review.
- Correction/completion requests and responses.
- Final verification.
- Approval, rejection, and Owner escalation.
- Enrollment completion.
- Enrollment document generation and reprinting.
- Exceptional decisions and overrides.

Record actor, timestamp, affected record, action, and reason where applicable. Do not place passwords, OTPs, session tokens, or unnecessary full application payloads in audit details.

## 8. Planned Admissions workspace

The current `AdmissionsPortal.html` is an initial landing dashboard with informational placeholders. It is not an operational module yet.

The planned workspace includes:

1. Application Overview.
2. Application Queue.
3. My Assigned Applications.
4. Walk-in Registration.
5. Requirements Monitoring.
6. Correction and Completion Requests.
7. Approval Monitoring.
8. Enrollment Monitoring.
9. Reports and Activity Logs.

All cards and controls must be backed by implemented server-side functions and role checks before being presented as operational.

## 9. Pending specification decisions

Do not assume these are resolved:

- Legal Sex and Gender Identity choice lists.
- Whether Gender Identity is required or optional.
- Exact current-student registration initiation and account activation process.
- Student-editable profile field allow-list.
- Annual enrollment confirmation/access rules.
- Grade-specific admission requirement matrix and configurable rules.
- Detailed Primary Contact Person field mapping to the existing schema.
- Mapping policy for the TLC Office template's external `EMERGENCY CONTACT` and `EMERGENCY NUMBER` columns, since the portal will not collect a separate emergency contact.
- Final enrollment document layouts and required signatories.

## 10. Implementation sequence

1. Complete Stage 2.1 specification, including remaining fields and current-student registration decisions.
2. Design and approve the database schema for application assignment, requirement tracking, review history, approval, and enrollment.
3. Implement the shared queue, assignments, Encoder preliminary review, Admissions final verification, and walk-in intake.
4. Implement correction/completion handling, routine approval, and Owner escalation.
5. Implement separate enrollment records and the two enrollment documents.
6. Validate all paths in staging with dummy records and test every role boundary.
7. Update `INTEGRATION_AUTH_DB.md` with actual implementation changes and user-reported staging outcomes as work progresses.

No implementation code, schema migration, deployment, or production data change is authorized by this specification alone.
