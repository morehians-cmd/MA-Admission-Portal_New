/**
 * AdmissionWorkflowData.gs
 * Stage 2.8 — Internal shared data access for the 12 admissions workflow sheets.
 *
 * This file is intentionally server-internal: every helper name ends in "_".
 * It does not expose generic google.script.run CRUD endpoints.
 *
 * Guardrails:
 * - ADMISSION_WORKFLOW_SCHEMA.HEADERS is the only header/schema authority.
 * - Never creates, repairs, clears, renames, or reorders sheets.
 * - Reads only allow-listed workflow sheets.
 * - All mutations use ScriptLock, explicit field policies, and UUID keys.
 * - Audit is append-only. A failed/uncertain audit must never be reported as success.
 * - Feature endpoints remain responsible for authentication, authorization, ownership,
 *   domain validation, actor derivation, and orchestration of business + audit writes.
 */

var ADMISSION_WORKFLOW_DATA = {
  VERSION: 1,
  LOCK_TIMEOUT_MS: 15000,
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
  MAX_TEXT_LENGTH: 10000,
  SHEETS: {
    AdmissionApplications: {
      key: 'ApplicationID',
      required: ['UserID', 'ApplicationStatus', 'CreationRequestID'],
      mutable: ['SchoolYear', 'IntakeMethod', 'GradeLevelApplied', 'Department', 'Category', 'SHSCluster', 'ApplicationStatus', 'SubmittedAt', 'LastStatusChangedAt', 'UpdatedAt', 'UpdatedBy'],
      unique: [['CreationRequestID']]
    },
    ApplicationProfiles: {
      key: 'ProfileSnapshotID',
      required: ['ApplicationID', 'SchemaVersion'],
      mutable: ['Surname', 'FirstName', 'MiddleName', 'Suffix', 'Birthdate', 'BirthPlace', 'LRN', 'LegalSex', 'GenderIdentity', 'SchoolYear', 'GradeLevelApplied', 'Category', 'Department', 'SHSCluster', 'Email', 'Mobile', 'AddressLine1', 'AddressLine2', 'Barangay', 'City', 'LivingWith', 'LivingWithOtherDetails', 'FatherName', 'FatherStatus', 'FatherOccupation', 'FatherEducation', 'FatherMobile', 'FatherEmail', 'MotherName', 'MotherStatus', 'MotherOccupation', 'MotherEducation', 'MotherMobile', 'MotherEmail', 'GuardianName', 'GuardianStatus', 'GuardianOccupation', 'GuardianEducation', 'GuardianMobile', 'GuardianEmail', 'PrimaryContactName', 'PrimaryContactAddress', 'PrimaryContactRelationship', 'PrimaryContactNumber', 'PreviousSchool', 'PreviousSchoolYear', 'PreviousGrade', 'PreviousCluster', 'PreviousSection', 'PreviousAdviser', 'PreviousSchoolID', 'PreviousSchoolAddress', 'FacebookProfileLink', 'PrivacyConsent', 'PrivacyConsentAt', 'SubmittedAt', 'SubmittedBy'],
      unique: [['ApplicationID']]
    },
    ApplicationAssignments: {
      key: 'AssignmentID',
      required: ['ApplicationID', 'AssignmentAction', 'AssignedByEmail', 'AssignedAt'],
      mutable: null,
      unique: []
    },
    ApplicationRequirements: {
      key: 'ApplicationRequirementID',
      required: ['SourceType', 'SourceRecordID', 'RequirementCode', 'RequirementName', 'RequirementRuleVersion', 'IsApplicable', 'IsMandatory', 'ReceiptStatus', 'PreliminaryStatus', 'FinalStatus', 'IsPendingAtEnrollment', 'OverdueFlag', 'UpdatedAt'],
      mutable: ['EnrollmentID', 'ReceiptStatus', 'ReceivedAt', 'ReceivedByEmail', 'PreliminaryStatus', 'PreliminaryRemarks', 'PreliminaryByEmail', 'PreliminaryAt', 'FinalStatus', 'FinalRemarks', 'FinalVerifiedByEmail', 'FinalVerifiedAt', 'CorrectionReason', 'IsPendingAtEnrollment', 'ConditionalEnrollmentID', 'PendingReason', 'DeadlineAt', 'CompletedAt', 'OverdueFlag', 'UpdatedAt'],
      unique: [['SourceType', 'SourceRecordID', 'RequirementCode']]
    },
    ApplicationReviews: {
      key: 'ReviewID',
      required: ['ApplicationID', 'ReviewStage', 'ReviewOutcome', 'ReviewerEmail', 'ReviewerRole', 'ReviewedAt', 'CreatedAt'],
      mutable: null,
      unique: []
    },
    ApplicationApprovals: {
      key: 'ApprovalID',
      required: ['ApplicationID', 'Decision', 'DecisionLevel', 'DecisionReason', 'DecidedByEmail', 'DecidedByRole', 'DecisionAt', 'CreatedAt'],
      mutable: null,
      unique: []
    },
    ApplicationExceptions: {
      key: 'ExceptionID',
      required: ['ApplicationID', 'ExceptionType', 'ExceptionDescription', 'Reason', 'ExceptionStatus', 'RequestedByEmail', 'RequestedAt', 'CreatedAt', 'UpdatedAt'],
      mutable: ['ExceptionStatus', 'AuthorizedByEmail', 'AuthorizationRole', 'AuthorizedAt', 'AuthorizationReason', 'EffectiveFrom', 'EffectiveUntil', 'UpdatedAt'],
      unique: []
    },
    CurrentStudentRegistrations: {
      key: 'RegistrationID',
      required: ['StudentID', 'SchoolYear', 'CurrentGradeLevel', 'ProposedGradeLevel', 'PromotionResult', 'RegistrationStatus', 'ConsentDocumentStatus', 'CreatedAt', 'UpdatedAt'],
      mutable: ['VerifiedGradeLevel', 'PromotionResult', 'RegistrationStatus', 'SubmittedAt', 'ConsentDocumentStatus', 'ConsentReceivedAt', 'ConsentReceivedBy', 'VerifiedByEmail', 'VerifiedAt', 'VerificationRemarks', 'UpdatedAt'],
      unique: [{ fields: ['StudentID', 'SchoolYear'], where: { field: 'RegistrationStatus', notIn: ['REJECTED', 'CANCELLED'] } }]
    },
    StudentRegistrationProfiles: {
      key: 'RegistrationProfileID',
      required: ['RegistrationID', 'SchemaVersion', 'Surname', 'FirstName', 'Birthdate', 'LRN', 'LegalSex', 'SchoolYear', 'CurrentGradeLevel', 'ProposedGradeLevel', 'Department', 'Email', 'Mobile', 'AddressLine1', 'Barangay', 'City', 'LivingWith', 'PrimaryContactName', 'PrimaryContactAddress', 'PrimaryContactRelationship', 'PrimaryContactNumber', 'PrivacyConsent', 'PrivacyConsentAt', 'SubmittedAt', 'SubmittedBy'],
      mutable: [],
      unique: [['RegistrationID']]
    },
    EnrollmentRecords: {
      key: 'EnrollmentID',
      required: ['StudentID', 'SchoolYear', 'SourceType', 'SourceRecordID', 'GradeLevel', 'Department', 'EnrollmentStatus', 'ConditionalEnrollment', 'CreatedAt', 'UpdatedAt'],
      mutable: ['GradeLevel', 'Department', 'Category', 'SHSCluster', 'ApprovalReferenceID', 'EnrollmentStatus', 'ConditionalEnrollment', 'ConditionalEnrollmentReason', 'ConditionalEnrollmentAuthorizedBy', 'ConditionalEnrollmentAuthorizedAt', 'ConditionalEnrollmentDeadline', 'EnrolledAt', 'EnrolledByEmail', 'CancelledAt', 'CancellationReason', 'UpdatedAt'],
      unique: [['SourceType', 'SourceRecordID']]
    },
    EnrollmentDocuments: {
      key: 'EnrollmentDocumentID',
      required: ['EnrollmentID', 'DocumentType', 'DocumentVersion', 'DocumentStatus', 'FileName', 'MimeType', 'GeneratedAt', 'GeneratedByEmail', 'CreatedAt'],
      mutable: ['DocumentStatus', 'IssuedAt'],
      unique: [['EnrollmentID', 'DocumentType', 'DocumentVersion']]
    },
    AdmissionWorkflowAudit: {
      key: 'WorkflowAuditID',
      required: ['EntityType', 'EntityID', 'Action', 'ActorEmail', 'ActorRole', 'OccurredAt', 'Source', 'CorrelationID'],
      mutable: null,
      unique: []
    }
  }
};

/** Fields which may only be supplied through the trusted internal serverValues option. */
var ADMISSION_WORKFLOW_DATA_SERVER_FIELDS_ = [
  'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
  'StudentID', 'UserID', 'Email', 'SubmittedAt', 'SubmittedBy', 'LastStatusChangedAt',
  'PrivacyConsentAt', 'AssignedByEmail', 'AssignedAt',
  'ReviewerEmail', 'ReviewerRole', 'ReviewedAt',
  'DecidedByEmail', 'DecidedByRole', 'DecisionAt',
  'RequestedByEmail', 'RequestedAt', 'AuthorizedByEmail',
  'AuthorizationRole', 'AuthorizedAt', 'ConsentReceivedAt',
  'ConsentReceivedBy', 'VerifiedByEmail', 'VerifiedAt',
  'ReceivedAt', 'ReceivedByEmail', 'PreliminaryByEmail',
  'PreliminaryAt', 'FinalVerifiedByEmail', 'FinalVerifiedAt',
  'EnrolledAt', 'EnrolledByEmail', 'CancelledAt',
  'GeneratedAt', 'GeneratedByEmail', 'IssuedAt', 'DriveFileID',
  'ConditionalEnrollmentID', 'ConditionalEnrollmentAuthorizedBy',
  'ConditionalEnrollmentAuthorizedAt', 'ConditionalEnrollmentDeadline',
  'ApprovalReferenceID',
  'ActorEmail', 'ActorRole', 'OccurredAt'
];

/** Resolve only the configured database; do not add a fallback or mutate configuration. */
function admissionWorkflowDataSpreadsheet_() {
  if (typeof authSpreadsheet_ !== 'function') throw new Error('WORKFLOW_STORAGE_UNAVAILABLE');
  var spreadsheet = authSpreadsheet_();
  if (!spreadsheet) throw new Error('WORKFLOW_STORAGE_UNAVAILABLE');
  return spreadsheet;
}

/** Return the allow-listed sheet policy or fail closed. */
function admissionWorkflowDataPolicy_(sheetName) {
  var policy = ADMISSION_WORKFLOW_DATA.SHEETS[String(sheetName || '')];
  if (!policy || !ADMISSION_WORKFLOW_SCHEMA ||
      ADMISSION_WORKFLOW_SCHEMA.TARGET_SHEETS.indexOf(sheetName) < 0) {
    throw new Error('WORKFLOW_SHEET_NOT_ALLOWED');
  }
  return policy;
}

/** Validate exact header count, spelling, and order; never repair the sheet. */
function admissionWorkflowDataSheet_(sheetName) {
  admissionWorkflowDataPolicy_(sheetName);
  var expected = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  if (!expected || !expected.length) throw new Error('WORKFLOW_SCHEMA_MISMATCH');
  var sheet = admissionWorkflowDataSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('WORKFLOW_SCHEMA_MISSING');
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() !== expected.length) {
    throw new Error('WORKFLOW_SCHEMA_MISMATCH');
  }
  var actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] == null ? '' : actual[i]) !== expected[i]) {
      throw new Error('WORKFLOW_SCHEMA_MISMATCH');
    }
  }
  return sheet;
}

/** Map exact header names to zero-based indexes. */
function admissionWorkflowDataHeaderMap_(sheetName) {
  admissionWorkflowDataSheet_(sheetName);
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    if (Object.prototype.hasOwnProperty.call(map, headers[i])) {
      throw new Error('WORKFLOW_SCHEMA_MISMATCH');
    }
    map[headers[i]] = i;
  }
  return map;
}

/** Convert cell values to stable, serializable values at the server boundary. */
function admissionWorkflowDataNormalizeValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function admissionWorkflowDataNormalizeRow_(headers, row, options) {
  options = options || {};
  var record = {};
  for (var i = 0; i < headers.length; i++) {
    var field = headers[i];
    if (field === 'GenderIdentity' && options.includeSensitiveFields !== true) continue;
    if (options.fields && options.fields.indexOf(field) < 0) continue;
    record[field] = admissionWorkflowDataNormalizeValue_(row[i]);
  }
  return record;
}

/** Read one sheet with bounded pagination and exact-match criteria. */
function admissionWorkflowDataReadAll_(sheetName, options) {
  options = options || {};
  var sheet = admissionWorkflowDataSheet_(sheetName);
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  var pageSize = Number(options.pageSize === undefined ? ADMISSION_WORKFLOW_DATA.DEFAULT_PAGE_SIZE : options.pageSize);
  var offset = Number(options.offset === undefined ? 0 : options.offset);
  if (!isFinite(pageSize) || Math.floor(pageSize) !== pageSize ||
      pageSize < 1 || pageSize > ADMISSION_WORKFLOW_DATA.MAX_PAGE_SIZE ||
      !isFinite(offset) || Math.floor(offset) !== offset || offset < 0) {
    throw new Error('WORKFLOW_INVALID_PAGINATION');
  }
  var criteria = options.criteria || {};
  if (!criteria || Object.prototype.toString.call(criteria) !== '[object Object]') {
    throw new Error('WORKFLOW_INVALID_FILTER');
  }
  var criteriaKeys = Object.keys(criteria);
  for (var c = 0; c < criteriaKeys.length; c++) {
    if (headers.indexOf(criteriaKeys[c]) < 0) throw new Error('WORKFLOW_INVALID_FIELD');
    var cv = criteria[criteriaKeys[c]];
    if (cv !== null && typeof cv === 'object') throw new Error('WORKFLOW_INVALID_FILTER');
  }
  var lastRow = sheet.getLastRow();
  var matches = [];
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < rows.length; r++) {
      var match = true;
      for (var k = 0; k < criteriaKeys.length; k++) {
        var idx = headers.indexOf(criteriaKeys[k]);
        var actual = admissionWorkflowDataNormalizeValue_(rows[r][idx]);
        var expected = criteria[criteriaKeys[k]];
        if (String(actual == null ? '' : actual) !== String(expected == null ? '' : expected)) {
          match = false;
          break;
        }
      }
      if (match) matches.push(rows[r]);
    }
  }
  var selected = matches.slice(offset, offset + pageSize);
  var records = selected.map(function(row) {
    return admissionWorkflowDataNormalizeRow_(headers, row, options);
  });
  var nextOffset = offset + selected.length;
  return {
    records: records,
    pageSize: pageSize,
    offset: offset,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
    hasMore: nextOffset < matches.length
  };
}

/** Exact ID lookup; returns null when no matching row exists. */
function admissionWorkflowDataFindById_(sheetName, id, options) {
  options = options || {};
  var policy = admissionWorkflowDataPolicy_(sheetName);
  if (id === null || id === undefined || String(id).trim() === '') {
    throw new Error('WORKFLOW_INVALID_FIELD');
  }
  var sheet = admissionWorkflowDataSheet_(sheetName);
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  var keyCol = headers.indexOf(policy.key) + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, keyCol, lastRow - 1, 1).getDisplayValues();
  var found = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      if (found >= 0) throw new Error('WORKFLOW_DUPLICATE_RECORD');
      found = i + 2;
    }
  }
  if (found < 0) return null;
  var row = sheet.getRange(found, 1, 1, headers.length).getValues()[0];
  return admissionWorkflowDataNormalizeRow_(headers, row, options);
}

/** Exact-match multi-field lookup with bounded pagination. */
function admissionWorkflowDataFindMany_(sheetName, criteria, options) {
  options = options || {};
  options.criteria = criteria || {};
  return admissionWorkflowDataReadAll_(sheetName, options);
}

/** Acquire the script lock for one complete critical section. */
function admissionWorkflowDataWithLock_(callback) {
  if (typeof callback !== 'function') throw new Error('WORKFLOW_INVALID_OPERATION');
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(ADMISSION_WORKFLOW_DATA.LOCK_TIMEOUT_MS);
  } catch (error) {
    throw new Error('WORKFLOW_LOCK_TIMEOUT');
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/** Validate primitive cell values and exact field names. */
function admissionWorkflowDataValidateRecord_(sheetName, record, mode) {
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  if (!record || Object.prototype.toString.call(record) !== '[object Object]') {
    throw new Error('WORKFLOW_INVALID_RECORD');
  }
  var keys = Object.keys(record);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i], value = record[key];
    if (headers.indexOf(key) < 0) throw new Error('WORKFLOW_INVALID_FIELD');
    if (value !== null && value !== undefined &&
        typeof value === 'object' && !(value instanceof Date)) {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    if (typeof value === 'string' && value.length > ADMISSION_WORKFLOW_DATA.MAX_TEXT_LENGTH) {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    if (mode === 'insert' && ADMISSION_WORKFLOW_DATA_SERVER_FIELDS_.indexOf(key) >= 0) {
      throw new Error('WORKFLOW_SERVER_FIELD_REQUIRED');
    }
  }
}

/** Return server values after checking that every key is a declared server-managed field. */
function admissionWorkflowDataServerValues_(sheetName, values) {
  values = values || {};
  if (Object.prototype.toString.call(values) !== '[object Object]') {
    throw new Error('WORKFLOW_INVALID_RECORD');
  }
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  var out = {};
  Object.keys(values).forEach(function(key) {
    if (headers.indexOf(key) < 0 || ADMISSION_WORKFLOW_DATA_SERVER_FIELDS_.indexOf(key) < 0) {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    var value = values[key];
    if (value !== null && value !== undefined &&
        typeof value === 'object' && !(value instanceof Date)) {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    out[key] = value;
  });
  return out;
}

/** Read all existing rows only for in-lock uniqueness checks on one target sheet. */
function admissionWorkflowDataAssertUnique_(sheetName, candidate, ignoreId) {
  var policy = admissionWorkflowDataPolicy_(sheetName);
  if (!policy.unique || !policy.unique.length) return;
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  var sheet = admissionWorkflowDataSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var u = 0; u < policy.unique.length; u++) {
    var rule = policy.unique[u];
    var fields = Array.isArray(rule) ? rule : rule.fields;
    var where = Array.isArray(rule) ? null : rule.where;
    if (where && where.notIn.indexOf(String(candidate[where.field] || '')) >= 0) continue;
    var valuesPresent = fields.every(function(field) {
      return candidate[field] !== undefined && candidate[field] !== null &&
        String(candidate[field]).trim() !== '';
    });
    if (!valuesPresent) continue;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (ignoreId && String(row[headers.indexOf(policy.key)]) === String(ignoreId)) continue;
      if (where) {
        var status = String(row[headers.indexOf(where.field)] || '');
        if (where.notIn.indexOf(status) >= 0) continue;
      }
      var same = fields.every(function(field) {
        var existing = row[headers.indexOf(field)];
        return String(existing == null ? '' : existing) === String(candidate[field]);
      });
      if (same) throw new Error('WORKFLOW_DUPLICATE_RECORD');
    }
  }
}

/** Convert untrusted formula-leading strings into literal text before setValues(). */
function admissionWorkflowDataSafeCellValue_(value) {
  if (typeof value === 'string' && /^[=+@\\-]/.test(value)) return "'" + value;
  return value;
}

/** Build a row in canonical schema order; all unspecified fields remain blank. */
function admissionWorkflowDataBuildRow_(sheetName, record) {
  var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
  return headers.map(function(field) {
    var value = record[field];
    if (value === null || value === undefined) return '';
    if (value instanceof Date) value = value.toISOString();
    return admissionWorkflowDataSafeCellValue_(value);
  });
}

/**
 * Insert one record. Caller supplies domain data and trusted serverValues.
 * The helper generates the primary key and CreatedAt/UpdatedAt when those
 * columns exist. Feature endpoint must append the corresponding audit event.
 */
function admissionWorkflowDataInsert_(sheetName, record, options) {
  options = options || {};
  var policy = admissionWorkflowDataPolicy_(sheetName);
  if (policy.mutable === null && sheetName !== 'AdmissionWorkflowAudit') {
    // Append-only history sheets are insertable; this marker only prevents updates.
  }
  admissionWorkflowDataValidateRecord_(sheetName, record, 'insert');
  var serverValues = admissionWorkflowDataServerValues_(sheetName, options.serverValues || {});
  var input = {};
  Object.keys(record).forEach(function(key) { input[key] = record[key]; });
  Object.keys(serverValues).forEach(function(key) { input[key] = serverValues[key]; });
  if (Object.prototype.hasOwnProperty.call(input, policy.key)) throw new Error('WORKFLOW_IMMUTABLE_FIELD');

  return admissionWorkflowDataWithLock_(function() {
    var sheet = admissionWorkflowDataSheet_(sheetName);
    var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
    var now = new Date().toISOString();
    input[policy.key] = Utilities.getUuid();
    if (headers.indexOf('CreatedAt') >= 0 && !input.CreatedAt) input.CreatedAt = now;
    if (headers.indexOf('UpdatedAt') >= 0 && !input.UpdatedAt) input.UpdatedAt = now;
    admissionWorkflowDataAssertRequired_(sheetName, input);
    admissionWorkflowDataAssertUnique_(sheetName, input, null);
    var row = admissionWorkflowDataBuildRow_(sheetName, input);
    var targetRow = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(targetRow, 1, 1, headers.length).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
    return { id: input[policy.key], createdAt: input.CreatedAt || null };
  });
}

/** Required structural fields only; business/domain rules stay in feature endpoints. */
function admissionWorkflowDataAssertRequired_(sheetName, record) {
  var required = ADMISSION_WORKFLOW_DATA.SHEETS[sheetName].required || [];
  for (var i = 0; i < required.length; i++) {
    var value = record[required[i]];
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new Error('WORKFLOW_REQUIRED_FIELD_MISSING');
    }
  }
}

/** Update only fields explicitly marked mutable for the target sheet. */
function admissionWorkflowDataUpdateById_(sheetName, id, changes, options) {
  options = options || {};
  var policy = admissionWorkflowDataPolicy_(sheetName);
  if (!Array.isArray(policy.mutable)) throw new Error('WORKFLOW_IMMUTABLE_RECORD');
  if (id === null || id === undefined || String(id).trim() === '') throw new Error('WORKFLOW_INVALID_FIELD');
  admissionWorkflowDataValidateRecord_(sheetName, changes, 'update');
  var keys = Object.keys(changes || {});
  for (var s = 0; s < keys.length; s++) {
    if (ADMISSION_WORKFLOW_DATA_SERVER_FIELDS_.indexOf(keys[s]) >= 0) throw new Error('WORKFLOW_SERVER_FIELD_REQUIRED');
  }
  if (!keys.length) throw new Error('WORKFLOW_INVALID_RECORD');
  for (var i = 0; i < keys.length; i++) {
    if (policy.mutable.indexOf(keys[i]) < 0) throw new Error('WORKFLOW_IMMUTABLE_FIELD');
  }
  var serverValues = admissionWorkflowDataServerValues_(sheetName, options.serverValues || {});
  Object.keys(serverValues).forEach(function(key) {
    if (policy.mutable.indexOf(key) < 0) throw new Error('WORKFLOW_IMMUTABLE_FIELD');
  });

  return admissionWorkflowDataWithLock_(function() {
    var sheet = admissionWorkflowDataSheet_(sheetName);
    var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
    var keyCol = headers.indexOf(policy.key) + 1;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('WORKFLOW_RECORD_NOT_FOUND');
    var idValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getDisplayValues();
    var foundRow = -1;
    for (var r = 0; r < idValues.length; r++) {
      if (String(idValues[r][0]) === String(id)) {
        if (foundRow >= 0) throw new Error('WORKFLOW_DUPLICATE_RECORD');
        foundRow = r + 2;
      }
    }
    if (foundRow < 0) throw new Error('WORKFLOW_RECORD_NOT_FOUND');
    var current = sheet.getRange(foundRow, 1, 1, headers.length).getValues()[0];
    if (sheetName === 'ApplicationProfiles') {
      var parentApplicationId = current[headers.indexOf('ApplicationID')];
      var parentApplication = admissionWorkflowDataFindById_('AdmissionApplications', parentApplicationId);
      if (!parentApplication || parentApplication.ApplicationStatus !== 'DRAFT') {
        throw new Error('WORKFLOW_DRAFT_LOCKED');
      }
    }
    var candidate = {};
    for (var c = 0; c < headers.length; c++) candidate[headers[c]] = current[c];
    Object.keys(changes).forEach(function(key) { candidate[key] = changes[key]; });
    Object.keys(serverValues).forEach(function(key) { candidate[key] = serverValues[key]; });
    if (headers.indexOf('UpdatedAt') >= 0) candidate.UpdatedAt = new Date().toISOString();
    admissionWorkflowDataAssertRequired_(sheetName, candidate);
    admissionWorkflowDataAssertUnique_(sheetName, candidate, id);
    var updated = headers.map(function(field) {
      var value = candidate[field];
      if (value === null || value === undefined) return '';
      if (value instanceof Date) value = value.toISOString();
      return admissionWorkflowDataSafeCellValue_(value);
    });
    sheet.getRange(foundRow, 1, 1, headers.length).setNumberFormat('@');
    sheet.getRange(foundRow, 1, 1, headers.length).setValues([updated]);
    return { id: String(id), updatedAt: candidate.UpdatedAt || null };
  });
}

/**
 * Append an immutable workflow audit event. ActorEmail, ActorRole, and optional
 * StudentID must be passed in trustedServerValues derived by the authenticated
 * feature endpoint; event contains only non-actor event details.
 * This is a separate spreadsheet write, not a transaction with a business write.
 * Caller must treat failure after a successful business mutation as an uncertain
 * outcome, return WORKFLOW_AUDIT_OUTCOME_UNCERTAIN, and reconcile before retrying.
 */
function admissionWorkflowDataAppendAudit_(event, trustedServerValues) {
  var sheetName = 'AdmissionWorkflowAudit';
  var policy = admissionWorkflowDataPolicy_(sheetName);
  admissionWorkflowDataValidateRecord_(sheetName, event, 'insert');
  var serverValues = admissionWorkflowDataServerValues_(sheetName, trustedServerValues || {});
  if (!serverValues.OccurredAt) serverValues.OccurredAt = new Date().toISOString();
  var input = {};
  Object.keys(event || {}).forEach(function(key) { input[key] = event[key]; });
  Object.keys(serverValues).forEach(function(key) { input[key] = serverValues[key]; });
  if (Object.prototype.hasOwnProperty.call(input, policy.key)) throw new Error('WORKFLOW_IMMUTABLE_FIELD');
  admissionWorkflowDataAssertRequired_(sheetName, input);

  return admissionWorkflowDataWithLock_(function() {
    var sheet = admissionWorkflowDataSheet_(sheetName);
    var headers = ADMISSION_WORKFLOW_SCHEMA.HEADERS[sheetName];
    var id = Utilities.getUuid();
    input[policy.key] = id;
    var row = admissionWorkflowDataBuildRow_(sheetName, input);
    var targetRow = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(targetRow, 1, 1, headers.length).setNumberFormat('@');
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
    return { id: id, occurredAt: input.OccurredAt };
  });
}

/** Convert internal errors to stable, non-sensitive codes for feature endpoints. */
function admissionWorkflowDataErrorCode_(error) {
  var message = String(error && error.message ? error.message : '');
  var allowed = [
    'WORKFLOW_SHEET_NOT_ALLOWED',
    'WORKFLOW_SCHEMA_MISSING',
    'WORKFLOW_SCHEMA_MISMATCH',
    'WORKFLOW_STORAGE_UNAVAILABLE',
    'WORKFLOW_INVALID_PAGINATION',
    'WORKFLOW_INVALID_FILTER',
    'WORKFLOW_INVALID_FIELD',
    'WORKFLOW_INVALID_RECORD',
    'WORKFLOW_INVALID_OPERATION',
    'WORKFLOW_SERVER_FIELD_REQUIRED',
    'WORKFLOW_REQUIRED_FIELD_MISSING',
    'WORKFLOW_IMMUTABLE_FIELD',
    'WORKFLOW_IMMUTABLE_RECORD',
    'WORKFLOW_RECORD_NOT_FOUND',
    'WORKFLOW_DUPLICATE_RECORD',
    'WORKFLOW_DRAFT_LOCKED',
    'WORKFLOW_LOCK_TIMEOUT',
    'WORKFLOW_AUDIT_OUTCOME_UNCERTAIN'
  ];
  return allowed.indexOf(message) >= 0 ? message : 'WORKFLOW_STORAGE_FAILURE';
}
