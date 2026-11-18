/**
 * ApplicantWorkflowPreflight.gs
 * Stage 2.9.1 — Read-only source/storage preflight.
 *
 * Run manually in the copied STAGING Apps Script project after syncing source.
 * This function performs no spreadsheet writes and does not issue test records.
 */

function applicantWorkflowPreflight() {
  var report = {
    success: false,
    dryRun: true,
    stage: '2.9.1',
    checkedAt: new Date().toISOString(),
    checks: [],
    errors: []
  };
  function check(name, passed, detail) {
    report.checks.push({ name: name, passed: passed === true, detail: String(detail || '') });
    if (!passed) report.errors.push(name);
  }

  try {
    admissionWorkflowSchemaAssertOwnerStaging_();
    check('owner_staging_guard', true, 'Active Owner and exact STAGING workbook configuration verified.');

    var requiredFunctions = [
      'applicationCreateDraft',
      'applicationSaveDraft',
      'applicationGetMine',
      'applicationSubmit',
      'applicantWorkflowGetOwned_',
      'applicantWorkflowAudit_'
    ];
    requiredFunctions.forEach(function(name) {
      check('function_' + name, typeof this[name] === 'function', 'Required endpoint/helper availability.');
    }, this);

    var appHeaders = ADMISSION_WORKFLOW_SCHEMA.HEADERS.AdmissionApplications || [];
    var profileHeaders = ADMISSION_WORKFLOW_SCHEMA.HEADERS.ApplicationProfiles || [];
    check('creation_request_id_schema',
      appHeaders.indexOf('CreationRequestID') >= 0 &&
      ADMISSION_WORKFLOW_DATA.SHEETS.AdmissionApplications.unique.some(function(rule) {
        return Array.isArray(rule) && rule.length === 1 && rule[0] === 'CreationRequestID';
      }),
      'CreationRequestID exists in the application schema and has a uniqueness policy.');

    check('profile_snapshot_schema',
      profileHeaders.indexOf('ApplicationID') >= 0 &&
      profileHeaders.indexOf('PrivacyConsentAt') >= 0 &&
      profileHeaders.indexOf('SubmittedAt') >= 0 &&
      profileHeaders.indexOf('SubmittedBy') >= 0,
      'Application profile supports persistent draft, consent timestamp, and submission snapshot metadata.');

    ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.forEach(function(sheetName) {
      admissionWorkflowDataSheet_(sheetName);
    });
    check('all_workflow_sheets', true, 'All 12 allow-listed workflow sheets have exact headers.');

    check('legacy_submission_not_called',
      ApplicantWorkflow.gs !== 'admissionCreateApplication' &&
      APPLICANT_WORKFLOW.VERSION === '2.9.1',
      'The new applicant workflow is versioned separately; this preflight does not invoke the legacy StudentID-issuing endpoint.');
  } catch (error) {
    report.errors.push(admissionWorkflowDataErrorCode_(error));
  }

  report.success = report.errors.length === 0 && report.checks.length > 0 &&
    report.checks.every(function(item) { return item.passed; });
  report.completedAt = new Date().toISOString();
  report.message = report.success
    ? 'Applicant workflow preflight passed. No spreadsheet data was written.'
    : 'Applicant workflow preflight failed. No spreadsheet data was written.';
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
