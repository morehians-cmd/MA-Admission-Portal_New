/**
 * ApplicantWorkflowUnitTest.gs
 * Stage 2.9.1 — Pure validation tests. No spreadsheet writes, auth mutation, or cleanup.
 * Run applicantWorkflowRunUnitTests() from the Apps Script editor.
 */

function applicantWorkflowRunUnitTests() {
  var report = { success: false, dryRun: true, testSuite: 'APPLICANT_WORKFLOW_STAGE_2_9_1_UNIT', tests: [], errors: [] };
  function test(name, callback) {
    try {
      var result = callback();
      var passed = result === true;
      report.tests.push({ name: name, passed: passed });
      if (!passed) report.errors.push(name);
    } catch (error) {
      report.tests.push({ name: name, passed: false, detail: String(error && error.message || error) });
      report.errors.push(name);
    }
  }
  function rejects(name, expected, callback) {
    test(name, function() {
      try { callback(); return false; }
      catch (error) { return String(error && error.message || error) === expected; }
    });
  }

  test('empty_partial_draft_is_allowed', function() {
    return Object.keys(applicantWorkflowNormalizeDraft_({})).length === 0;
  });
  test('grade_department_is_server_derived', function() {
    var d = applicantWorkflowNormalizeDraft_({ GradeLevelApplied: 'Kinder 2', Department: 'Forged Department' });
    return d.Department === 'Elementary';
  });
  test('shs_cluster_is_preserved_for_shs', function() {
    var d = applicantWorkflowNormalizeDraft_({
      GradeLevelApplied: 'Grade 11',
      SHSCluster: 'Science, Technology, Engineering, and Mathematics'
    });
    return d.Department === 'Senior High School' && !!d.SHSCluster;
  });
  test('non_shs_cluster_is_cleared', function() {
    var d = applicantWorkflowNormalizeDraft_({ GradeLevelApplied: 'Grade 6', SHSCluster: 'Invalid for this level' });
    return d.SHSCluster === '';
  });
  test('legal_sex_accepts_male', function() {
    return applicantWorkflowNormalizeDraft_({ LegalSex: 'Male' }).LegalSex === 'Male';
  });
  test('legal_sex_accepts_female', function() {
    return applicantWorkflowNormalizeDraft_({ LegalSex: 'Female' }).LegalSex === 'Female';
  });
  rejects('legal_sex_rejects_other_value', 'Legal Sex must be Male or Female.',
    function() { applicantWorkflowNormalizeDraft_({ LegalSex: 'Other' }); });
  rejects('client_cannot_supply_gender_identity', 'WORKFLOW_INVALID_FIELD',
    function() { applicantWorkflowNormalizeDraft_({ GenderIdentity: 'private' }); });
  rejects('client_cannot_supply_email', 'WORKFLOW_INVALID_FIELD',
    function() { applicantWorkflowNormalizeDraft_({ Email: 'forged@example.test' }); });
  rejects('client_cannot_supply_submission_timestamp', 'WORKFLOW_INVALID_FIELD',
    function() { applicantWorkflowNormalizeDraft_({ SubmittedAt: '2099-01-01T00:00:00Z' }); });
  rejects('invalid_lrn_is_rejected', 'LRN must contain exactly 12 digits and begin with 1–5.',
    function() { applicantWorkflowNormalizeDraft_({ LRN: '12345' }); });
  rejects('invalid_grade_is_rejected', 'Invalid grade level.',
    function() { applicantWorkflowNormalizeDraft_({ GradeLevelApplied: 'Grade 13' }); });

  test('submission_requires_legal_sex_and_consent', function() {
    var missing = applicantWorkflowValidateSubmission_({});
    return missing.indexOf('LegalSex') >= 0 && missing.indexOf('PrivacyConsent') >= 0;
  });
  test('submission_requires_shs_cluster', function() {
    var profile = {
      Surname: 'TEST', FirstName: 'STUDENT', Birthdate: '2010-01-01', LRN: '123456789012',
      LegalSex: 'Female', SchoolYear: '2026-2027', GradeLevelApplied: 'Grade 11',
      Department: 'Senior High School', Mobile: '09123456789', AddressLine1: 'Test Street',
      Barangay: 'Test Barangay', City: 'Test City', LivingWith: 'Parents',
      PrimaryContactName: 'TEST PARENT', PrimaryContactAddress: 'Test Address',
      PrimaryContactRelationship: 'Parent', PrimaryContactNumber: '09123456789',
      PrivacyConsent: 'TRUE'
    };
    return applicantWorkflowValidateSubmission_(profile).indexOf('SHSCluster') >= 0;
  });
  test('profile_builder_does_not_accept_sensitive_or_account_fields', function() {
    var profile = applicantWorkflowProfileForDraft_('APP-TEST', {
      Surname: 'TEST', PrivacyConsent: 'TRUE'
    }, { email: 'applicant@example.test' });
    return !Object.prototype.hasOwnProperty.call(profile, 'GenderIdentity') &&
      !Object.prototype.hasOwnProperty.call(profile, 'Email') &&
      profile.ApplicationID === 'APP-TEST';
  });

  report.success = report.errors.length === 0 && report.tests.length > 0;
  report.completedAt = new Date().toISOString();
  report.message = report.success
    ? 'Pure applicant workflow unit tests passed. No spreadsheet data was written.'
    : 'Applicant workflow unit tests failed. No spreadsheet data was written.';
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
