/**
 * AdmissionWorkflowDataTest.gs
 * Stage 2.8 — Owner-run synthetic runtime tests for the internal data layer.
 *
 * SAFETY:
 * - Run only in the separately copied STAGING Apps Script project.
 * - Requires the explicit STAGING marker, matching staging workbook ID, and active Owner.
 * - Writes synthetic rows to AdmissionApplications, CurrentStudentRegistrations,
 *   and AdmissionWorkflowAudit. It does not edit or delete existing records.
 * - It does not simulate audit-write failure and does not perform automatic cleanup.
 * - Keep the returned synthetic IDs for a separately approved cleanup decision.
 *
 * Run admissionWorkflowDataRunStagingTests() manually from the Apps Script editor.
 */

function admissionWorkflowDataRunStagingTests() {
  var startedAt = new Date().toISOString();
  var report = {
    success: false,
    dryRun: false,
    environment: 'STAGING_ONLY',
    testSuite: 'ADMISSION_WORKFLOW_DATA_STAGE_2_8',
    startedAt: startedAt,
    completedAt: null,
    tests: [],
    createdRecords: {
      applications: [],
      registrations: [],
      auditEvents: []
    },
    auditFailureFaultInjection: 'NOT_RUN_SAFE_NO_FAULT_INJECTION',
    cleanup: 'NOT_PERFORMED_REQUIRES_SEPARATE_APPROVAL',
    errors: []
  };

  function record(name, passed, detail) {
    report.tests.push({
      name: name,
      passed: passed === true,
      detail: String(detail || '')
    });
    if (!passed) report.errors.push(name);
  }

  function expectError(name, expectedCode, callback) {
    try {
      callback();
      record(name, false, 'Expected ' + expectedCode + ' but no error was thrown.');
    } catch (error) {
      var actual = admissionWorkflowDataErrorCode_(error);
      record(name, actual === expectedCode,
        actual === expectedCode ? 'Rejected as expected: ' + actual : 'Expected ' + expectedCode + '; received ' + actual + '.');
    }
  }

  try {
    // Reassert staging identity and Owner access before any operation.
    var context = admissionWorkflowSchemaAssertOwnerStaging_();
    var targetSheets = ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS;
    if (!Array.isArray(targetSheets) || targetSheets.length !== 12) {
      throw new Error('WORKFLOW_TARGET_SCOPE_MISMATCH');
    }
    for (var s = 0; s < targetSheets.length; s++) {
      admissionWorkflowDataSheet_(targetSheets[s]);
    }
    record('staging_guard_and_12_sheet_schema', true,
      'Active Owner, explicit staging marker, exact workbook configuration, and all 12 sheet headers validated.');

    var token = Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
    var syntheticUserId = 'STAGE28_USER_' + token;
    var syntheticStudentId = 'STAGE28_STUDENT_' + token;
    var schoolYear = '2098-2099';
    var appIds = [];

    // Validation checks are deliberately run before the first write.
    expectError('reject_missing_required_field', 'WORKFLOW_REQUIRED_FIELD_MISSING', function() {
      admissionWorkflowDataInsert_('AdmissionApplications', {
        SchoolYear: schoolYear,
        IntakeMethod: 'STAGE2_8_TEST',
        GradeLevelApplied: 'Grade 7',
        Department: 'Junior High School',
        ApplicationStatus: 'STAGE2_8_TEST'
      }, { serverValues: { UserID: syntheticUserId } });
    });

    expectError('reject_unknown_field', 'WORKFLOW_INVALID_FIELD', function() {
      admissionWorkflowDataInsert_('AdmissionApplications', {
        SchoolYear: schoolYear,
        IntakeMethod: 'STAGE2_8_TEST',
        GradeLevelApplied: 'Grade 7',
        Department: 'Junior High School',
        ApplicationStatus: 'STAGE2_8_TEST',
        UnknownTestField: 'must be rejected'
      }, { serverValues: { UserID: syntheticUserId } });
    });

    expectError('reject_client_supplied_server_field', 'WORKFLOW_SERVER_FIELD_REQUIRED', function() {
      admissionWorkflowDataInsert_('AdmissionApplications', {
        UserID: syntheticUserId,
        SchoolYear: schoolYear,
        IntakeMethod: 'STAGE2_8_TEST',
        GradeLevelApplied: 'Grade 7',
        Department: 'Junior High School',
        ApplicationStatus: 'STAGE2_8_TEST'
      });
    });

    expectError('reject_invalid_pagination', 'WORKFLOW_INVALID_PAGINATION', function() {
      admissionWorkflowDataReadAll_('AdmissionApplications', { pageSize: 0, offset: 0 });
    });

    // Two synthetic applications enable deterministic page-size-one pagination.
    var first = admissionWorkflowDataInsert_('AdmissionApplications', {
      SchoolYear: schoolYear,
      IntakeMethod: 'STAGE2_8_TEST',
      GradeLevelApplied: 'Grade 7',
      Department: 'Junior High School',
      ApplicationStatus: 'STAGE2_8_INSERTED',
      Category: '=STAGE28_LITERAL_' + token
    }, { serverValues: { UserID: syntheticUserId } });
    appIds.push(first.id);
    report.createdRecords.applications.push(first.id);

    var second = admissionWorkflowDataInsert_('AdmissionApplications', {
      SchoolYear: schoolYear,
      IntakeMethod: 'STAGE2_8_TEST',
      GradeLevelApplied: 'Grade 8',
      Department: 'Junior High School',
      ApplicationStatus: 'STAGE2_8_INSERTED'
    }, { serverValues: { UserID: syntheticUserId } });
    appIds.push(second.id);
    report.createdRecords.applications.push(second.id);
    record('insert_and_uuid_generation',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first.id) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(second.id),
      'Inserted two synthetic application rows with generated UUID keys.');

    var page1 = admissionWorkflowDataReadAll_('AdmissionApplications', {
      pageSize: 1, offset: 0, criteria: { UserID: syntheticUserId }
    });
    var page2 = admissionWorkflowDataReadAll_('AdmissionApplications', {
      pageSize: 1, offset: page1.nextOffset, criteria: { UserID: syntheticUserId }
    });
    var paginationPassed = page1.records.length === 1 && page1.hasMore === true &&
      page1.nextOffset === 1 && page2.records.length === 1 &&
      page2.hasMore === false && page2.nextOffset === null &&
      page1.records[0].ApplicationID === first.id &&
      page2.records[0].ApplicationID === second.id;
    record('filtered_pagination', paginationPassed,
      'Page size one returned both matching synthetic records in separate pages.');

    var found = admissionWorkflowDataFindById_('AdmissionApplications', first.id);
    record('exact_id_lookup', !!found && found.ApplicationID === first.id,
      'Exact UUID lookup returned the corresponding synthetic application.');

    var notFound = admissionWorkflowDataFindById_('AdmissionApplications', 'STAGE28_NO_SUCH_ID_' + token);
    record('missing_id_returns_null', notFound === null,
      'Unknown ID returned null.');

    var updated = admissionWorkflowDataUpdateById_('AdmissionApplications', first.id, {
      ApplicationStatus: 'STAGE2_8_UPDATED'
    });
    var updatedRecord = admissionWorkflowDataFindById_('AdmissionApplications', first.id);
    record('controlled_update', !!updated && updatedRecord &&
      updatedRecord.ApplicationStatus === 'STAGE2_8_UPDATED' &&
      !!updatedRecord.UpdatedAt,
      'Allowed status changed and UpdatedAt was populated.');

    expectError('reject_immutable_id_update', 'WORKFLOW_IMMUTABLE_FIELD', function() {
      admissionWorkflowDataUpdateById_('AdmissionApplications', first.id, {
        ApplicationID: 'STAGE28_FORBIDDEN_REPLACEMENT'
      });
    });

    var appSheet = admissionWorkflowDataSheet_('AdmissionApplications');
    var appHeaders = ADMISSION_WORKFLOW_SCHEMA.HEADERS.AdmissionApplications;
    var categoryColumn = appHeaders.indexOf('Category') + 1;
    var firstRow = -1;
    var appLastRow = appSheet.getLastRow();
    if (appLastRow >= 2) {
      var appIdValues = appSheet.getRange(2, 1, appLastRow - 1, 1).getDisplayValues();
      for (var a = 0; a < appIdValues.length; a++) {
        if (String(appIdValues[a][0]) === first.id) firstRow = a + 2;
      }
    }
    var formula = firstRow > 0 ? appSheet.getRange(firstRow, categoryColumn).getFormula() : 'NOT_FOUND';
    record('formula_leading_input_is_not_formula', firstRow > 0 && formula === '',
      'Formula cell check returned an empty formula expression for the synthetic formula-leading text.');

    // Active registration uniqueness: first insert should pass, duplicate should fail.
    var registration = admissionWorkflowDataInsert_('CurrentStudentRegistrations', {
      SchoolYear: schoolYear,
      CurrentGradeLevel: 'Grade 6',
      ProposedGradeLevel: 'Grade 7',
      PromotionResult: 'PROMOTED',
      RegistrationStatus: 'PENDING',
      ConsentDocumentStatus: 'PENDING'
    }, { serverValues: { StudentID: syntheticStudentId } });
    report.createdRecords.registrations.push(registration.id);
    record('registration_insert', !!registration.id,
      'Inserted one synthetic current-student registration.');

    expectError('reject_duplicate_active_registration', 'WORKFLOW_DUPLICATE_RECORD', function() {
      admissionWorkflowDataInsert_('CurrentStudentRegistrations', {
        SchoolYear: schoolYear,
        CurrentGradeLevel: 'Grade 6',
        ProposedGradeLevel: 'Grade 7',
        PromotionResult: 'PROMOTED',
        RegistrationStatus: 'PENDING',
        ConsentDocumentStatus: 'PENDING'
      }, { serverValues: { StudentID: syntheticStudentId } });
    });

    // Audit is a separate append-only write; this test checks the successful path only.
    var correlationId = 'STAGE28_CORR_' + token;
    var audit = admissionWorkflowDataAppendAudit_({
      EntityType: 'AdmissionApplication',
      EntityID: first.id,
      Action: 'STAGE2_8_TEST',
      Source: 'STAGING_TEST',
      CorrelationID: correlationId
    }, {
      ActorEmail: context.actorEmail,
      ActorRole: 'Owner',
      OccurredAt: new Date().toISOString()
    });
    report.createdRecords.auditEvents.push(audit.id);
    var auditRecord = admissionWorkflowDataFindById_('AdmissionWorkflowAudit', audit.id);
    record('append_and_read_audit', !!auditRecord &&
      auditRecord.WorkflowAuditID === audit.id &&
      auditRecord.CorrelationID === correlationId &&
      auditRecord.Action === 'STAGE2_8_TEST',
      'Appended an audit event and retrieved it by its generated UUID.');

  } catch (error) {
    report.errors.push(admissionWorkflowDataErrorCode_(error));
    report.failureCode = admissionWorkflowDataErrorCode_(error);
  }

  report.success = report.errors.length === 0 &&
    report.tests.length > 0 &&
    report.tests.every(function(test) { return test.passed; });
  report.completedAt = new Date().toISOString();
  report.message = report.success
    ? 'Stage 2.8 synthetic runtime tests passed. Synthetic records remain in staging; no cleanup was performed.'
    : 'Stage 2.8 synthetic runtime tests did not fully pass. Review completed tests and created record IDs; no automatic retry or cleanup was performed.';

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
