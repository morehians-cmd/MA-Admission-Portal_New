/**
 * AdmissionWorkflowSchema.gs
 * Stage 2.6: isolated, staging-only schema preflight and creation.
 *
 * This file does not replace or call admissionDbSetup_(), authMigrateUsersSheet(),
 * identifier backfill, or any existing legacy setup function.
 *
 * Required staging Script Properties (manual configuration only):
 *   ADMISSION_WORKFLOW_ENVIRONMENT = STAGING
 *   ADMISSION_WORKFLOW_STAGING_SPREADSHEET_ID = <copied staging workbook ID>
 *   DB_SHEET_ID = the same copied staging workbook ID
 *
 * Both public entry points are intended for manual execution from the Apps Script
 * editor by the staging Owner. No browser endpoint invokes either function.
 */

var ADMISSION_WORKFLOW_SCHEMA = {
  VERSION: '2.4.1',
  REQUIREMENT_RULE_VERSION: 'ADMISSION_REQUIREMENTS_BASELINE_2026',
  ENV_PROPERTY: 'ADMISSION_WORKFLOW_ENVIRONMENT',
  STAGING_ID_PROPERTY: 'ADMISSION_WORKFLOW_STAGING_SPREADSHEET_ID',
  TARGET_SHEETS: [
    'AdmissionApplications',
    'ApplicationProfiles',
    'ApplicationAssignments',
    'ApplicationRequirements',
    'ApplicationReviews',
    'ApplicationApprovals',
    'ApplicationExceptions',
    'CurrentStudentRegistrations',
    'StudentRegistrationProfiles',
    'EnrollmentRecords',
    'EnrollmentDocuments',
    'AdmissionWorkflowAudit'
  ],
  HEADERS: {
    AdmissionApplications: ['ApplicationID','StudentID','UserID','SchoolYear','IntakeMethod','GradeLevelApplied','Department','Category','SHSCluster','ApplicationStatus','SubmittedAt','LastStatusChangedAt','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'],
    ApplicationProfiles: ['ProfileSnapshotID','ApplicationID','SchemaVersion','Surname','FirstName','MiddleName','Suffix','Birthdate','BirthPlace','LRN','LegalSex','GenderIdentity','SchoolYear','GradeLevelApplied','Category','Department','SHSCluster','Email','Mobile','AddressLine1','AddressLine2','Barangay','City','LivingWith','LivingWithOtherDetails','FatherName','FatherStatus','FatherOccupation','FatherEducation','FatherMobile','FatherEmail','MotherName','MotherStatus','MotherOccupation','MotherEducation','MotherMobile','MotherEmail','GuardianName','GuardianStatus','GuardianOccupation','GuardianEducation','GuardianMobile','GuardianEmail','PrimaryContactName','PrimaryContactAddress','PrimaryContactRelationship','PrimaryContactNumber','PreviousSchool','PreviousSchoolYear','PreviousGrade','PreviousCluster','PreviousSection','PreviousAdviser','PreviousSchoolID','PreviousSchoolAddress','FacebookProfileLink','PrivacyConsent','PrivacyConsentAt','SubmittedAt','SubmittedBy'],
    ApplicationAssignments: ['AssignmentID','ApplicationID','AssignmentAction','AssignedToEmail','AssignedByEmail','AssignedAt','Reason','PreviousAssigneeEmail','CreatedAt'],
    ApplicationRequirements: ['ApplicationRequirementID','SourceType','SourceRecordID','ApplicationID','RegistrationID','EnrollmentID','RequirementCode','RequirementName','RequirementGroup','RequirementRuleVersion','IsApplicable','IsMandatory','ApplicabilityReason','ReceiptStatus','ReceivedAt','ReceivedByEmail','PreliminaryStatus','PreliminaryRemarks','PreliminaryByEmail','PreliminaryAt','FinalStatus','FinalRemarks','FinalVerifiedByEmail','FinalVerifiedAt','CorrectionReason','IsPendingAtEnrollment','ConditionalEnrollmentID','PendingReason','DeadlineAt','CompletedAt','OverdueFlag','UpdatedAt'],
    ApplicationReviews: ['ReviewID','ApplicationID','ReviewStage','ReviewOutcome','Findings','RequiredAction','ReviewerEmail','ReviewerRole','ReviewedAt','CreatedAt'],
    ApplicationApprovals: ['ApprovalID','ApplicationID','Decision','DecisionLevel','DecisionReason','DecidedByEmail','DecidedByRole','DecisionAt','EscalationReference','CreatedAt'],
    ApplicationExceptions: ['ExceptionID','ApplicationID','ExceptionType','RelatedRequirementCode','ExceptionDescription','Reason','ExceptionStatus','RequestedByEmail','RequestedAt','AuthorizedByEmail','AuthorizationRole','AuthorizedAt','AuthorizationReason','EffectiveFrom','EffectiveUntil','CreatedAt','UpdatedAt'],
    CurrentStudentRegistrations: ['RegistrationID','StudentID','SchoolYear','CurrentGradeLevel','ProposedGradeLevel','VerifiedGradeLevel','PromotionResult','RegistrationStatus','SubmittedAt','ConsentDocumentStatus','ConsentReceivedAt','ConsentReceivedBy','VerifiedByEmail','VerifiedAt','VerificationRemarks','CreatedAt','UpdatedAt'],
    // Approved clarification: replace GradeLevelApplied with CurrentGradeLevel and ProposedGradeLevel.
    StudentRegistrationProfiles: ['RegistrationProfileID','RegistrationID','SchemaVersion','Surname','FirstName','MiddleName','Suffix','Birthdate','BirthPlace','LRN','LegalSex','GenderIdentity','SchoolYear','CurrentGradeLevel','ProposedGradeLevel','Category','Department','SHSCluster','Email','Mobile','AddressLine1','AddressLine2','Barangay','City','LivingWith','LivingWithOtherDetails','FatherName','FatherStatus','FatherOccupation','FatherEducation','FatherMobile','FatherEmail','MotherName','MotherStatus','MotherOccupation','MotherEducation','MotherMobile','MotherEmail','GuardianName','GuardianStatus','GuardianOccupation','GuardianEducation','GuardianMobile','GuardianEmail','PrimaryContactName','PrimaryContactAddress','PrimaryContactRelationship','PrimaryContactNumber','PreviousSchool','PreviousSchoolYear','PreviousGrade','PreviousCluster','PreviousSection','PreviousAdviser','PreviousSchoolID','PreviousSchoolAddress','FacebookProfileLink','PrivacyConsent','PrivacyConsentAt','SubmittedAt','SubmittedBy'],
    EnrollmentRecords: ['EnrollmentID','StudentID','SchoolYear','SourceType','SourceRecordID','GradeLevel','Department','Category','SHSCluster','ApprovalReferenceID','EnrollmentStatus','ConditionalEnrollment','ConditionalEnrollmentReason','ConditionalEnrollmentAuthorizedBy','ConditionalEnrollmentAuthorizedAt','ConditionalEnrollmentDeadline','EnrolledAt','EnrolledByEmail','CancelledAt','CancellationReason','CreatedAt','UpdatedAt'],
    EnrollmentDocuments: ['EnrollmentDocumentID','EnrollmentID','DocumentType','DocumentVersion','DocumentStatus','DriveFileID','FileName','MimeType','GeneratedAt','GeneratedByEmail','IssuedAt','SupersedesDocumentID','ReprintReason','CreatedAt'],
    AdmissionWorkflowAudit: ['WorkflowAuditID','EntityType','EntityID','StudentID','Action','PreviousStatus','NewStatus','ActorEmail','ActorRole','Reason','RelatedRecordID','OccurredAt','Source','CorrelationID']
  }
};

/**
 * Read-only preflight. It never creates sheets, changes properties, or writes data.
 * Run manually from the Apps Script editor in the copied staging project.
 */
function admissionWorkflowSchemaPreflight() {
  var startedAt = new Date().toISOString();
  try {
    var context = admissionWorkflowSchemaAssertOwnerStaging_();
    var report = admissionWorkflowSchemaInspect_(context.spreadsheet);
    report.success = report.blockedSheets.length === 0;
    report.dryRun = true;
    report.schemaVersion = ADMISSION_WORKFLOW_SCHEMA.VERSION;
    report.requirementRuleVersion = ADMISSION_WORKFLOW_SCHEMA.REQUIREMENT_RULE_VERSION;
    report.startedAt = startedAt;
    report.completedAt = new Date().toISOString();
    report.message = report.success
      ? 'Preflight passed. Review planned creations before separately authorizing setup.'
      : 'Preflight blocked. No spreadsheet changes were made.';
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    var failed = {
      success: false,
      dryRun: true,
      schemaVersion: ADMISSION_WORKFLOW_SCHEMA.VERSION,
      startedAt: startedAt,
      completedAt: new Date().toISOString(),
      blockedSheets: [],
      createdSheets: [],
      validatedSheets: [],
      errors: [admissionWorkflowSchemaSafeError_(error)]
    };
    Logger.log(JSON.stringify(failed, null, 2));
    return failed;
  }
}

/**
 * Explicit write operation. Repeats all guards and all preflight checks immediately
 * before writing. Creates only absent allow-listed workflow sheets.
 */
function admissionWorkflowSchemaSetup() {
  var startedAt = new Date().toISOString();
  var created = [];
  try {
    var context = admissionWorkflowSchemaAssertOwnerStaging_();
    var report = admissionWorkflowSchemaInspect_(context.spreadsheet);
    if (report.blockedSheets.length) {
      report.success = false;
      report.dryRun = false;
      report.createdSheets = created;
      report.schemaVersion = ADMISSION_WORKFLOW_SCHEMA.VERSION;
      report.startedAt = startedAt;
      report.completedAt = new Date().toISOString();
      report.message = 'Setup stopped before writing because preflight found blocking mismatches.';
      Logger.log(JSON.stringify(report, null, 2));
      return report;
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      // Recheck the workbook while holding the script lock; do not rely on a prior dry run.
      context = admissionWorkflowSchemaAssertOwnerStaging_();
      report = admissionWorkflowSchemaInspect_(context.spreadsheet);
      if (report.blockedSheets.length) {
        report.success = false;
        report.dryRun = false;
        report.createdSheets = created;
        report.schemaVersion = ADMISSION_WORKFLOW_SCHEMA.VERSION;
        report.startedAt = startedAt;
        report.completedAt = new Date().toISOString();
        report.message = 'Setup stopped before writing because the workbook changed or a mismatch was found.';
        Logger.log(JSON.stringify(report, null, 2));
        return report;
      }

      for (var i = 0; i < ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.length; i++) {
        var name = ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS[i];
        var existing = context.spreadsheet.getSheetByName(name);
        if (existing) continue;

        var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[name];
        var sheet = context.spreadsheet.insertSheet(name);
        created.push(name);
        if (sheet.getMaxColumns() < headers.length) {
          sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
        }
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        var observed = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
        if (!admissionWorkflowSchemaHeadersEqual_(headers, observed)) {
          throw new Error('POST_CREATE_HEADER_VERIFICATION_FAILED:' + name);
        }
      }
    } finally {
      lock.releaseLock();
    }

    var finalReport = admissionWorkflowSchemaInspect_(context.spreadsheet);
    finalReport.success = finalReport.blockedSheets.length === 0 &&
      finalReport.validatedSheets.length === ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.length;
    finalReport.dryRun = false;
    finalReport.createdSheets = created;
    finalReport.schemaVersion = ADMISSION_WORKFLOW_SCHEMA.VERSION;
    finalReport.requirementRuleVersion = ADMISSION_WORKFLOW_SCHEMA.REQUIREMENT_RULE_VERSION;
    finalReport.startedAt = startedAt;
    finalReport.completedAt = new Date().toISOString();
    finalReport.message = finalReport.success
      ? 'All 12 workflow sheets have exact approved headers.'
      : 'Setup ended with a partial or blocked result. No automatic rollback was attempted.';
    Logger.log(JSON.stringify(finalReport, null, 2));
    return finalReport;
  } catch (error) {
    var failure = {
      success: false,
      dryRun: false,
      schemaVersion: ADMISSION_WORKFLOW_SCHEMA.VERSION,
      startedAt: startedAt,
      completedAt: new Date().toISOString(),
      createdSheets: created,
      validatedSheets: [],
      blockedSheets: [],
      errors: [admissionWorkflowSchemaSafeError_(error)],
      message: 'Setup stopped. Successfully created sheets, if any, were left in place; no automatic rollback was attempted.'
    };
    Logger.log(JSON.stringify(failure, null, 2));
    return failure;
  }
}

/** Verifies editor execution, Owner account, explicit STAGING marker, and exact workbook ID. */
function admissionWorkflowSchemaAssertOwnerStaging_() {
  authRequireEditor_();

  var props = PropertiesService.getScriptProperties();
  var environment = String(props.getProperty(ADMISSION_WORKFLOW_SCHEMA.ENV_PROPERTY) || '').trim();
  var expectedId = String(props.getProperty(ADMISSION_WORKFLOW_SCHEMA.STAGING_ID_PROPERTY) || '').trim();
  var configuredId = String(props.getProperty('DB_SHEET_ID') || '').trim();

  if (environment !== 'STAGING') throw new Error('STAGING_ENVIRONMENT_MARKER_REQUIRED');
  if (!expectedId || !configuredId || expectedId !== configuredId) throw new Error('STAGING_DATABASE_CONFIGURATION_MISMATCH');

  var spreadsheet = authSpreadsheet_();
  if (!spreadsheet || spreadsheet.getId() !== expectedId) throw new Error('STAGING_WORKBOOK_ID_MISMATCH');

  var activeEmail = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!activeEmail) throw new Error('EXECUTING_ACCOUNT_EMAIL_UNAVAILABLE');

  var users = spreadsheet.getSheetByName(AUTH.USERS);
  if (!users) throw new Error('USERS_SHEET_MISSING');
  admissionWorkflowSchemaAssertHeaders_(users, AUTH.HEADERS, 'Users');

  var lastRow = users.getLastRow();
  var ownerFound = false;
  if (lastRow >= 2) {
    var rows = users.getRange(2, 1, lastRow - 1, AUTH.HEADERS.length).getValues();
    var emailCol = AUTH.HEADERS.indexOf('Email');
    var roleCol = AUTH.HEADERS.indexOf('Role');
    var statusCol = AUTH.HEADERS.indexOf('Status');
    for (var i = 0; i < rows.length; i++) {
      var email = String(rows[i][emailCol] || '').trim().toLowerCase();
      var role = String(rows[i][roleCol] || '').trim();
      var status = String(rows[i][statusCol] || '').trim();
      if (email === activeEmail && role === 'Owner' && status === 'Active') {
        ownerFound = true;
        break;
      }
    }
  }
  if (!ownerFound) throw new Error('ACTIVE_OWNER_ACCOUNT_REQUIRED');

  return { spreadsheet: spreadsheet, actorEmail: activeEmail };
}

/** Inspects protected legacy sheets and all 12 workflow targets without modifying them. */
function admissionWorkflowSchemaInspect_(spreadsheet) {
  var blocked = [];
  var validated = [];
  var planned = [];
  var protectedSchemas = [
    { name: ADM_DB.STUDENTS, headers: ADM_DB.HEADERS, required: true },
    { name: ADM_DB.AUDIT, headers: ADM_DB.AUDIT_HEADERS, required: true },
    { name: ADM_DB.IDENTIFIERS, headers: ADM_DB.IDENTIFIER_HEADERS, required: true },
    { name: AUTH.USERS, headers: AUTH.HEADERS, required: true },
    { name: AUTH.AUDIT, headers: ['At','Email','Action','Detail'], required: false },
    { name: ADM_CORR.REQUESTS, headers: ADM_CORR.REQUEST_HEADERS, required: false },
    { name: ADM_CORR.DOCUMENTS, headers: ADM_CORR.DOCUMENT_HEADERS, required: false },
    { name: ADM_CORR.AUDIT, headers: ADM_CORR.AUDIT_HEADERS, required: false },
    { name: ADM_ROLE.SHEET, headers: ADM_ROLE.HEADERS, required: false }
  ];

  for (var p = 0; p < protectedSchemas.length; p++) {
    var item = protectedSchemas[p];
    var sheet = spreadsheet.getSheetByName(item.name);
    if (!sheet && !item.required) continue;
    if (!sheet) {
      blocked.push({ name: item.name, reason: 'REQUIRED_PROTECTED_SHEET_MISSING' });
      continue;
    }
    var mismatch = admissionWorkflowSchemaHeaderProblem_(sheet, item.headers);
    if (mismatch) blocked.push({ name: item.name, reason: mismatch });
  }

  for (var t = 0; t < ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.length; t++) {
    var targetName = ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS[t];
    var target = spreadsheet.getSheetByName(targetName);
    if (!target) {
      planned.push(targetName);
      continue;
    }
    var targetProblem = admissionWorkflowSchemaHeaderProblem_(target, ADMISSION_WORKFLOW_SCHEMA.HEADERS[targetName]);
    if (targetProblem) blocked.push({ name: targetName, reason: targetProblem });
    else validated.push(targetName);
  }

  return {
    createdSheets: [],
    validatedSheets: validated,
    plannedCreationSheets: planned,
    blockedSheets: blocked,
    errors: []
  };
}

/** Returns a safe mismatch code, or an empty string when exact ordered headers match. */
function admissionWorkflowSchemaHeaderProblem_(sheet, expected) {
  if (!expected || !expected.length) return 'EXPECTED_HEADER_DEFINITION_MISSING';
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return 'EXISTING_SHEET_HAS_NO_HEADER';
  var width = sheet.getLastColumn();
  var actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  if (actual.length !== expected.length) return 'HEADER_COUNT_MISMATCH';
  return admissionWorkflowSchemaHeadersEqual_(expected, actual) ? '' : 'HEADER_ORDER_OR_NAME_MISMATCH';
}

function admissionWorkflowSchemaAssertHeaders_(sheet, expected, name) {
  var problem = admissionWorkflowSchemaHeaderProblem_(sheet, expected);
  if (problem) throw new Error('PROTECTED_SCHEMA_INVALID:' + name + ':' + problem);
}

function admissionWorkflowSchemaHeadersEqual_(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) return false;
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] == null ? '' : actual[i]) !== expected[i]) return false;
  }
  return true;
}

function admissionWorkflowSchemaSafeError_(error) {
  var message = String(error && error.message ? error.message : 'UNEXPECTED_SETUP_ERROR');
  // Return only stable error codes; never include IDs, email addresses, or exception payloads.
  var allowed = [
    'STAGING_ENVIRONMENT_MARKER_REQUIRED',
    'STAGING_DATABASE_CONFIGURATION_MISMATCH',
    'STAGING_WORKBOOK_ID_MISMATCH',
    'EXECUTING_ACCOUNT_EMAIL_UNAVAILABLE',
    'USERS_SHEET_MISSING',
    'ACTIVE_OWNER_ACCOUNT_REQUIRED',
    'PROTECTED_SCHEMA_INVALID',
    'POST_CREATE_HEADER_VERIFICATION_FAILED',
    'Service invoked too many times',
    'Lock timeout'
  ];
  for (var i = 0; i < allowed.length; i++) {
    if (message.indexOf(allowed[i]) === 0) return allowed[i];
  }
  return 'UNEXPECTED_SETUP_ERROR';
}
