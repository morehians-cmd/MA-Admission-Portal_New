/**
 * AdmissionWorkflowDataPreflight.gs
 * Stage 2.8 — Read-only staging preflight for the workflow data layer.
 *
 * Run manually from the Apps Script editor as the active staging Owner.
 * This function validates the existing 12 workflow sheet headers only.
 * It does not read business records, write data, append audit rows, or repair sheets.
 */

function admissionWorkflowDataPreflight() {
  var startedAt = new Date().toISOString();
  var validatedSheets = [];
  var blockedSheets = [];
  var errors = [];

  try {
    // Reuse the exact staging workbook, Script Properties, and active Owner guard.
    admissionWorkflowSchemaAssertOwnerStaging_();

    var targets = ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS;
    if (!Array.isArray(targets) || targets.length !== 12) {
      throw new Error('WORKFLOW_TARGET_SCOPE_MISMATCH');
    }

    for (var i = 0; i < targets.length; i++) {
      var sheetName = targets[i];
      try {
        // Checks allowlist membership, existence, and exact header count/order.
        // It does not read business rows or mutate the sheet.
        admissionWorkflowDataSheet_(sheetName);
        validatedSheets.push(sheetName);
      } catch (sheetError) {
        blockedSheets.push({
          sheet: sheetName,
          error: admissionWorkflowDataPreflightSafeError_(sheetError)
        });
      }
    }
  } catch (error) {
    errors.push(admissionWorkflowDataPreflightSafeError_(error));
  }

  var report = {
    success: errors.length === 0 && blockedSheets.length === 0 &&
      validatedSheets.length === 12,
    dryRun: true,
    schemaVersion: ADMISSION_WORKFLOW_SCHEMA.VERSION,
    requirementRuleVersion: ADMISSION_WORKFLOW_SCHEMA.REQUIREMENT_RULE_VERSION,
    expectedSheetCount: 12,
    validatedSheets: validatedSheets,
    blockedSheets: blockedSheets,
    errors: errors,
    startedAt: startedAt,
    completedAt: new Date().toISOString()
  };

  report.message = report.success
    ? 'Read-only preflight passed. All 12 workflow sheet headers match the approved schema. No data was changed.'
    : 'Read-only preflight did not pass. Review blocked sheets/errors. No data was changed.';

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Return a stable error code without exposing stack traces or internal details. */
function admissionWorkflowDataPreflightSafeError_(error) {
  var message = String(error && error.message ? error.message : error || '');
  var allowed = [
    'STAGING_ENVIRONMENT_MARKER_REQUIRED',
    'STAGING_DATABASE_CONFIGURATION_MISMATCH',
    'STAGING_WORKBOOK_ID_MISMATCH',
    'EXECUTING_ACCOUNT_EMAIL_UNAVAILABLE',
    'ACTIVE_OWNER_ACCOUNT_REQUIRED',
    'USERS_SHEET_MISSING',
    'WORKFLOW_TARGET_SCOPE_MISMATCH',
    'WORKFLOW_SHEET_NOT_ALLOWED',
    'WORKFLOW_SCHEMA_MISSING',
    'WORKFLOW_SCHEMA_MISMATCH',
    'WORKFLOW_STORAGE_UNAVAILABLE'
  ];
  return allowed.indexOf(message) >= 0 ? message : 'WORKFLOW_PREFLIGHT_FAILED';
}
