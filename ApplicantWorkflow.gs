/**
 * ApplicantWorkflow.gs
 * Stage 2.9.1 — Applicant-owned draft and submission services.
 *
 * Public methods are feature endpoints only. No generic browser CRUD is exposed.
 * All identity, ownership, status, and audit values are derived server-side.
 *
 * This stage does not issue StudentID/official identifiers, update AdmissionStudents,
 * alter Users links, upload files, or change production resources.
 */

var APPLICANT_WORKFLOW = {
  VERSION: '2.9.1',
  SOURCE: 'APPLICANT_PORTAL',
  MAX_DRAFTS_PAGE: 100,
  GRADES: ['Nursery','Kinder 1','Kinder 2','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'],
  PROFILE_FIELDS: [
    'Surname','FirstName','MiddleName','Suffix','Birthdate','BirthPlace','LRN',
    'LegalSex','SchoolYear','GradeLevelApplied','Category','Department','SHSCluster',
    'Mobile','AddressLine1','AddressLine2','Barangay','City','LivingWith','LivingWithOtherDetails',
    'FatherName','FatherStatus','FatherOccupation','FatherEducation','FatherMobile','FatherEmail',
    'MotherName','MotherStatus','MotherOccupation','MotherEducation','MotherMobile','MotherEmail',
    'GuardianName','GuardianStatus','GuardianOccupation','GuardianEducation','GuardianMobile','GuardianEmail',
    'PrimaryContactName','PrimaryContactAddress','PrimaryContactRelationship','PrimaryContactNumber',
    'PreviousSchool','PreviousSchoolYear','PreviousGrade','PreviousCluster','PreviousSection',
    'PreviousAdviser','PreviousSchoolID','PreviousSchoolAddress','FacebookProfileLink'
  ],
  SUBMISSION_REQUIRED: [
    'Surname','FirstName','Birthdate','LRN','LegalSex','SchoolYear','GradeLevelApplied',
    'Department','Mobile','AddressLine1','Barangay','City','LivingWith',
    'PrimaryContactName','PrimaryContactAddress','PrimaryContactRelationship','PrimaryContactNumber'
  ]
};

/** Create or resume an applicant's persistent draft using a caller-generated UUID idempotency key. */
function applicationCreateDraft(token, creationRequestId, draft) {
  var account;
  try {
    account = authRequireRole_(token, ['Applicant']);
    if (account.studentId) throw new Error('An account already linked to a student record cannot create a new-student application.');
    var requestId = String(creationRequestId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
      throw new Error('A valid CreationRequestID is required.');
    }
    var normalized = applicantWorkflowNormalizeDraft_(draft || {});
    var existing = admissionWorkflowDataFindMany_('AdmissionApplications', {
      CreationRequestID: requestId
    }, { pageSize: 2, offset: 0 });
    if (existing.records.length) {
      var prior = existing.records[0];
      if (String(prior.UserID) !== account.email) throw new Error('This creation request is already in use.');
      var priorProfile = admissionWorkflowDataFindMany_('ApplicationProfiles', {
        ApplicationID: prior.ApplicationID
      }, { pageSize: 2, offset: 0 });
      if (!priorProfile.records.length) {
        var recoveredProfile = applicantWorkflowProfileForDraft_(prior.ApplicationID, normalized, account);
        admissionWorkflowDataInsert_('ApplicationProfiles', recoveredProfile, {
          serverValues: { Email: account.email }
        });
      }
      return applicantWorkflowSuccess_('Draft recovered.', {
        applicationId: prior.ApplicationID,
        status: prior.ApplicationStatus,
        resumed: true
      });
    }

    var now = new Date().toISOString();
    var application = {
      SchoolYear: normalized.SchoolYear || '',
      IntakeMethod: 'ONLINE',
      GradeLevelApplied: normalized.GradeLevelApplied || '',
      Department: normalized.Department || '',
      Category: normalized.Category || '',
      SHSCluster: normalized.SHSCluster || '',
      ApplicationStatus: 'DRAFT',
      CreationRequestID: requestId
    };
    var created = admissionWorkflowDataInsert_('AdmissionApplications', application, {
      serverValues: { UserID: account.email, CreatedBy: account.email, UpdatedBy: account.email }
    });
    var profile = applicantWorkflowProfileForDraft_(created.id, normalized, account);
    try {
      admissionWorkflowDataInsert_('ApplicationProfiles', profile, {
        serverValues: { Email: account.email }
      });
    } catch (profileError) {
      return applicantWorkflowFailure_('The draft record was created but its profile could not be completed. Reference: ' + created.id, 'WORKFLOW_PARTIAL_DRAFT_CREATION');
    }
    try {
      applicantWorkflowAudit_('AdmissionApplication', created.id, 'DRAFT_CREATED', '', 'DRAFT', requestId, account);
    } catch (auditError) {
      return applicantWorkflowFailure_('The draft may have been created, but its audit outcome is uncertain. Do not create another draft. Reference: ' + created.id, 'WORKFLOW_AUDIT_OUTCOME_UNCERTAIN');
    }
    return applicantWorkflowSuccess_('Draft created.', {
      applicationId: created.id,
      status: 'DRAFT',
      resumed: false
    });
  } catch (error) {
    return applicantWorkflowFailure_(applicantWorkflowSafeMessage_(error), admissionWorkflowDataErrorCode_(error));
  }
}

/** Save only allow-listed profile fields while the authenticated applicant owns a DRAFT. */
function applicationSaveDraft(token, applicationId, draft) {
  try {
    var account = authRequireRole_(token, ['Applicant']);
    var owned = applicantWorkflowGetOwned_(account.email, applicationId);
    if (owned.application.ApplicationStatus !== 'DRAFT') throw new Error('WORKFLOW_DRAFT_LOCKED');
    var normalized = applicantWorkflowNormalizeDraft_(draft || {});
    var appChanges = applicantWorkflowApplicationFields_(normalized);
    if (Object.keys(appChanges).length) {
      admissionWorkflowDataUpdateById_('AdmissionApplications', applicationId, appChanges, {
        serverValues: { UpdatedBy: account.email }
      });
    }
    var profile = owned.profile;
    var profileChanges = {};
    Object.keys(normalized).forEach(function(key) {
      if (APPLICANT_WORKFLOW.PROFILE_FIELDS.indexOf(key) >= 0) profileChanges[key] = normalized[key];
    });
    if (!profile) {
      admissionWorkflowDataInsert_('ApplicationProfiles', applicantWorkflowProfileForDraft_(applicationId, normalized, account), {
        serverValues: { Email: account.email }
      });
    } else if (Object.keys(profileChanges).length) {
      admissionWorkflowDataUpdateById_('ApplicationProfiles', profile.ProfileSnapshotID, profileChanges);
    }
    try {
      applicantWorkflowAudit_('AdmissionApplication', applicationId, 'DRAFT_UPDATED', 'DRAFT', 'DRAFT', Utilities.getUuid(), account);
    } catch (auditError) {
      return applicantWorkflowFailure_('Draft data was saved, but the audit outcome is uncertain. Reference: ' + applicationId, 'WORKFLOW_AUDIT_OUTCOME_UNCERTAIN');
    }
    return applicantWorkflowSuccess_('Draft saved.', { applicationId: applicationId, status: 'DRAFT' });
  } catch (error) {
    return applicantWorkflowFailure_(applicantWorkflowSafeMessage_(error), admissionWorkflowDataErrorCode_(error));
  }
}

/** Read only the authenticated applicant's own application and profile. */
function applicationGetMine(token, applicationId) {
  try {
    var account = authRequireRole_(token, ['Applicant']);
    var result = admissionWorkflowDataFindMany_('AdmissionApplications', {
      UserID: account.email
    }, { pageSize: APPLICANT_WORKFLOW.MAX_DRAFTS_PAGE, offset: 0 });
    var apps = result.records;
    if (applicationId) apps = apps.filter(function(item) { return item.ApplicationID === String(applicationId); });
    var output = apps.map(function(app) {
      var found = admissionWorkflowDataFindMany_('ApplicationProfiles', {
        ApplicationID: app.ApplicationID
      }, { pageSize: 2, offset: 0 });
      var profile = found.records.length ? found.records[0] : null;
      if (profile) delete profile.GenderIdentity;
      return { application: app, profile: profile };
    });
    return applicantWorkflowSuccess_('Application records loaded.', { records: output });
  } catch (error) {
    return applicantWorkflowFailure_(applicantWorkflowSafeMessage_(error), admissionWorkflowDataErrorCode_(error));
  }
}

/** Validate, freeze the existing draft snapshot, and transition DRAFT -> SUBMITTED. */
function applicationSubmit(token, applicationId) {
  try {
    var account = authRequireRole_(token, ['Applicant']);
    var owned = applicantWorkflowGetOwned_(account.email, applicationId);
    if (owned.application.ApplicationStatus !== 'DRAFT') throw new Error('WORKFLOW_INVALID_STATUS_TRANSITION');
    if (!owned.profile) throw new Error('WORKFLOW_PROFILE_MISSING');
    var errors = applicantWorkflowValidateSubmission_(owned.profile);
    if (errors.length) return applicantWorkflowFailure_('Please complete the required application information: ' + errors.join(', '), 'WORKFLOW_SUBMISSION_VALIDATION_FAILED');

    var now = new Date().toISOString();
    admissionWorkflowDataUpdateById_('ApplicationProfiles', owned.profile.ProfileSnapshotID, {}, {
      serverValues: { SubmittedAt: now, SubmittedBy: account.email }
    });
    admissionWorkflowDataUpdateById_('AdmissionApplications', applicationId, {
      ApplicationStatus: 'SUBMITTED'
    }, {
      serverValues: {
        SubmittedAt: now,
        LastStatusChangedAt: now,
        UpdatedBy: account.email
      }
    });
    try {
      applicantWorkflowAudit_('AdmissionApplication', applicationId, 'APPLICATION_SUBMITTED', 'DRAFT', 'SUBMITTED', Utilities.getUuid(), account);
    } catch (auditError) {
      return applicantWorkflowFailure_('The application was submitted, but the audit outcome is uncertain. Do not submit again. Reference: ' + applicationId, 'WORKFLOW_AUDIT_OUTCOME_UNCERTAIN');
    }
    return applicantWorkflowSuccess_('Application submitted. Your permanent StudentID and official identifier will be assigned only at the authorized enrollment stage.', {
      applicationId: applicationId,
      status: 'SUBMITTED',
      submittedAt: now
    });
  } catch (error) {
    return applicantWorkflowFailure_(applicantWorkflowSafeMessage_(error), admissionWorkflowDataErrorCode_(error));
  }
}

/** Load an owned application and its unique profile; fail closed on duplicate profile rows. */
function applicantWorkflowGetOwned_(email, applicationId) {
  var id = String(applicationId || '').trim();
  if (!id) throw new Error('WORKFLOW_INVALID_FIELD');
  var app = admissionWorkflowDataFindById_('AdmissionApplications', id);
  if (!app || String(app.UserID || '').toLowerCase() !== String(email || '').toLowerCase()) {
    throw new Error('WORKFLOW_RECORD_NOT_FOUND');
  }
  var profiles = admissionWorkflowDataFindMany_('ApplicationProfiles', {
    ApplicationID: id
  }, { pageSize: 2, offset: 0 });
  if (profiles.records.length > 1) throw new Error('WORKFLOW_DUPLICATE_RECORD');
  return { application: app, profile: profiles.records.length ? profiles.records[0] : null };
}

/** Normalize draft input to canonical ApplicationProfiles fields; unknown fields are rejected. */
function applicantWorkflowNormalizeDraft_(input) {
  if (!input || Object.prototype.toString.call(input) !== '[object Object]') throw new Error('WORKFLOW_INVALID_RECORD');
  var out = {};
  Object.keys(input).forEach(function(key) {
    if (key === 'GenderIdentity' || key === 'Email' || key === 'ApplicationID' || key === 'ProfileSnapshotID' ||
        key === 'SchemaVersion' || key === 'SubmittedAt' || key === 'SubmittedBy') {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    if (APPLICANT_WORKFLOW.PROFILE_FIELDS.indexOf(key) < 0 &&
        ['PrivacyConsent','PrivacyConsentAt','SchoolYear','GradeLevelApplied','Department','Category','SHSCluster'].indexOf(key) < 0) {
      throw new Error('WORKFLOW_INVALID_FIELD');
    }
    var value = input[key];
    if (value === null || value === undefined) value = '';
    if (typeof value === 'boolean') value = value ? 'TRUE' : 'FALSE';
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('WORKFLOW_INVALID_FIELD');
    value = String(value).trim();
    if (value.length > 1000) throw new Error('WORKFLOW_INVALID_FIELD');
    out[key] = value;
  });
  if (out.GradeLevelApplied) {
    if (APPLICANT_WORKFLOW.GRADES.indexOf(out.GradeLevelApplied) < 0) throw new Error('Invalid grade level.');
    var index = APPLICANT_WORKFLOW.GRADES.indexOf(out.GradeLevelApplied);
    var department = index < 2 ? 'Preschool' : index < 9 ? 'Elementary' : index < 13 ? 'Junior High School' : 'Senior High School';
    out.Department = department;
    if (index < 13) out.SHSCluster = '';
  }
  if (out.LegalSex && ['Male','Female'].indexOf(out.LegalSex) < 0) throw new Error('Legal Sex must be Male or Female.');
  if (out.LRN && !/^[1-5][0-9]{11}$/.test(out.LRN)) throw new Error('LRN must contain exactly 12 digits and begin with 1–5.');
  if (out.Mobile && !/^09[0-9]{9}$/.test(out.Mobile)) throw new Error('Enter a valid 11-digit Philippine mobile number.');
  if (out.SchoolYear && !/^20[0-9]{2}-20[0-9]{2}$/.test(out.SchoolYear)) throw new Error('Enter a valid school year.');
  if (out.Birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(out.Birthdate)) throw new Error('Enter a valid birth date.');
  return out;
}

/** Build a new immutable-key profile snapshot row; email is supplied only by the server. */
function applicantWorkflowProfileForDraft_(applicationId, values, account) {
  var profile = { ApplicationID: applicationId, SchemaVersion: ADMISSION_WORKFLOW_SCHEMA.VERSION };
  Object.keys(values).forEach(function(key) {
    if (APPLICANT_WORKFLOW.PROFILE_FIELDS.indexOf(key) >= 0 || key === 'PrivacyConsent') profile[key] = values[key];
  });
  return profile;
}

function applicantWorkflowApplicationFields_(values) {
  var out = {};
  ['SchoolYear','GradeLevelApplied','Department','Category','SHSCluster'].forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key];
  });
  return out;
}

/** Submission-only validation. Drafts may remain incomplete. */
function applicantWorkflowValidateSubmission_(profile) {
  var missing = [];
  APPLICANT_WORKFLOW.SUBMISSION_REQUIRED.forEach(function(key) {
    if (profile[key] === null || profile[key] === undefined || String(profile[key]).trim() === '') missing.push(key);
  });
  if (!profile.PrivacyConsent || String(profile.PrivacyConsent).toUpperCase() !== 'TRUE') missing.push('PrivacyConsent');
  if (!profile.Birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(String(profile.Birthdate))) missing.push('ValidBirthdate');
  if (!profile.LRN || !/^[1-5][0-9]{11}$/.test(String(profile.LRN))) missing.push('ValidLRN');
  if (!profile.Mobile || !/^09[0-9]{9}$/.test(String(profile.Mobile))) missing.push('ValidMobile');
  if (profile.Department === 'Senior High School' && !profile.SHSCluster) missing.push('SHSCluster');
  return missing;
}

/** Append a correlated immutable audit event using only server-derived actor identity. */
function applicantWorkflowAudit_(entityType, entityId, action, previousStatus, newStatus, correlationId, account) {
  return admissionWorkflowDataAppendAudit_({
    EntityType: entityType,
    EntityID: entityId,
    Action: action,
    PreviousStatus: previousStatus || '',
    NewStatus: newStatus || '',
    Source: APPLICANT_WORKFLOW.SOURCE,
    CorrelationID: correlationId
  }, {
    ActorEmail: account.email,
    ActorRole: account.role,
    OccurredAt: new Date().toISOString()
  });
}

function applicantWorkflowSuccess_(message, data) {
  return { success: true, message: message, data: data || null };
}
function applicantWorkflowFailure_(message, code) {
  return { success: false, message: message, code: code || 'WORKFLOW_REQUEST_FAILED' };
}
function applicantWorkflowSafeMessage_(error) {
  var message = String(error && error.message ? error.message : '');
  if (message === 'Not authorized.') return 'Your session is not authorized for this action. Please sign in again.';
  if (message === 'WORKFLOW_RECORD_NOT_FOUND') return 'The requested application was not found or is not accessible.';
  if (message === 'WORKFLOW_DRAFT_LOCKED') return 'This application can no longer be edited.';
  if (message === 'WORKFLOW_INVALID_STATUS_TRANSITION') return 'This application is no longer in a state that can be submitted.';
  if (message === 'WORKFLOW_DUPLICATE_RECORD') return 'A conflicting application record already exists. Contact Admissions before retrying.';
  if (message === 'WORKFLOW_LOCK_TIMEOUT') return 'The service is busy. Please try again shortly.';
  if (message === 'WORKFLOW_SCHEMA_MISMATCH' || message === 'WORKFLOW_SCHEMA_MISSING') return 'The admissions workflow storage is not ready. Contact the system administrator.';
  if (message.indexOf('WORKFLOW_') === 0) return 'The request could not be completed (' + message + ').';
  return message || 'The request could not be completed.';
}
