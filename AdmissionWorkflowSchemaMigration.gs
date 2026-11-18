/**
 * AdmissionWorkflowSchemaMigration.gs
 * Stage 2.9 foundation migration: append CreationRequestID to AdmissionApplications.
 *
 * This migration is deliberately separate from the normal schema setup.
 * It is staging-only, preserves all existing columns and rows, and never
 * rewrites or reorders existing data.
 *
 * Run only after the branch files have been synced to the disposable staging
 * Apps Script project and the user has explicitly approved this exact migration.
 */
function admissionWorkflowAddCreationRequestIdPreflight() {
  return admissionWorkflowCreationRequestMigration_(true);
}

function admissionWorkflowAddCreationRequestId() {
  return admissionWorkflowCreationRequestMigration_(false);
}

function admissionWorkflowCreationRequestMigration_(dryRun) {
  var startedAt = new Date().toISOString();
  var createdColumn = false;
  try {
    var context = admissionWorkflowSchemaAssertOwnerStaging_();
    var report = admissionWorkflowCreationRequestInspect_(context.spreadsheet);
    if (!report.success) throw new Error('WORKFLOW_SCHEMA_MIGRATION_BLOCKED');

    if (!dryRun && report.migrationRequired) {
      var lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try {
        context = admissionWorkflowSchemaAssertOwnerStaging_();
        report = admissionWorkflowCreationRequestInspect_(context.spreadsheet);
        if (!report.success) throw new Error('WORKFLOW_SCHEMA_MIGRATION_BLOCKED');
        if (report.migrationRequired) {
          var sheet = context.spreadsheet.getSheetByName('AdmissionApplications');
          var oldCount = ADMISSION_WORKFLOW_SCHEMA.HEADERS.AdmissionApplications.length - 1;
          if (sheet.getLastColumn() !== oldCount) throw new Error('WORKFLOW_SCHEMA_MIGRATION_BLOCKED');
          sheet.getRange(1, oldCount + 1).setValue('CreationRequestID');
          sheet.getRange(2, oldCount + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
          createdColumn = true;
        }
      } finally {
        lock.releaseLock();
      }
    }

    var finalReport = admissionWorkflowCreationRequestInspect_(context.spreadsheet);
    finalReport.success = finalReport.success && (!finalReport.migrationRequired || dryRun);
    finalReport.dryRun = !!dryRun;
    finalReport.createdColumn = createdColumn;
    finalReport.startedAt = startedAt;
    finalReport.completedAt = new Date().toISOString();
    finalReport.message = dryRun
      ? (finalReport.migrationRequired ? 'Preflight passed. One column will be appended; no data was changed.' : 'CreationRequestID is already present. No changes are needed.')
      : (finalReport.migrationRequired ? 'Migration did not complete.' : 'CreationRequestID schema migration completed; existing rows and columns were preserved.');
    Logger.log(JSON.stringify(finalReport, null, 2));
    return finalReport;
  } catch (error) {
    var failed = {
      success: false,
      dryRun: !!dryRun,
      createdColumn: createdColumn,
      startedAt: startedAt,
      completedAt: new Date().toISOString(),
      errors: [String(error && error.message || 'WORKFLOW_SCHEMA_MIGRATION_FAILED').split(':')[0]]
    };
    Logger.log(JSON.stringify(failed, null, 2));
    return failed;
  }
}

function admissionWorkflowCreationRequestInspect_(spreadsheet) {
  var blocked = [];
  var appSheet = spreadsheet.getSheetByName('AdmissionApplications');
  if (!appSheet) return { success: false, migrationRequired: false, blocked: ['AdmissionApplications missing'] };

  var newHeaders = ADMISSION_WORKFLOW_SCHEMA.HEADERS.AdmissionApplications;
  var oldHeaders = newHeaders.slice(0, newHeaders.length - 1);
  var actualCount = appSheet.getLastColumn();
  var actual = actualCount
    ? appSheet.getRange(1, 1, 1, actualCount).getDisplayValues()[0]
    : [];
  var alreadyMigrated = actualCount === newHeaders.length &&
    admissionWorkflowSchemaHeadersEqual_(newHeaders, actual);
  var needsMigration = actualCount === oldHeaders.length &&
    admissionWorkflowSchemaHeadersEqual_(oldHeaders, actual);
  if (!alreadyMigrated && !needsMigration) blocked.push('AdmissionApplications header mismatch');

  ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.forEach(function(name) {
    if (name === 'AdmissionApplications') return;
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet || admissionWorkflowSchemaHeaderProblem_(sheet, ADMISSION_WORKFLOW_SCHEMA.HEADERS[name])) {
      blocked.push(name + ' schema mismatch');
    }
  });
  return {
    success: blocked.length === 0,
    migrationRequired: needsMigration,
    alreadyMigrated: alreadyMigrated,
    blocked: blocked
  };
}
