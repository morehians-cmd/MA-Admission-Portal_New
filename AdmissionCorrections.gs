/**
 * AdmissionCorrections.gs
 * K-12 applicant correction requests with private Drive document storage.
 *
 * Security model:
 * - Applicants can create and read only requests tied to their own linked StudentID.
 * - Applicants never receive Drive file IDs or URLs.
 * - Drive folder and files are private; no public/link sharing is enabled.
 * - Review/approval is a separate Owner-only workflow. Pending values never update AdmissionStudents.
 * - Folder creation is a manual setup action in the Apps Script editor.
 */
var ADM_CORR = {
  REQUESTS: 'CorrectionRequests',
  DOCUMENTS: 'CorrectionDocuments',
  AUDIT: 'CorrectionAudit',
  FOLDER_PROPERTY: 'ADM_CORRECTION_DRIVE_FOLDER_ID',
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_FILES: 2,
  REQUEST_HEADERS: [
    'RequestRef','CreatedAt','UpdatedAt','StudentID','ApplicantEmail',
    'FieldKey','FieldLabel','OriginalValue','ProposedValue','Reason',
    'Sensitive','VerificationMethod','Status','ReviewerEmail',
    'ReviewedAt','Decision','CompletedAt'
  ],
  DOCUMENT_HEADERS: [
    'DocumentId','RequestRef','DriveFileId','FileName','MimeType',
    'SizeBytes','UploadedAt','UploadedBy'
  ],
  AUDIT_HEADERS: ['At','ActorEmail','Action','RequestRef','StudentID','FieldKey','BeforeValue','AfterValue','VerificationMethod','Detail'],
  FIELDS: {
    Surname: { label: 'Surname', sensitive: true, type: 'name' },
    FirstName: { label: 'First Name', sensitive: true, type: 'name' },
    MiddleName: { label: 'Middle Name', sensitive: true, type: 'name', optional: true },
    Suffix: { label: 'Suffix', sensitive: true, type: 'name', optional: true },
    Birthdate: { label: 'Date of Birth', sensitive: true, type: 'date' },
    BirthPlace: { label: 'Place of Birth', sensitive: true, type: 'text' },
    LRN: { label: 'Learner Reference Number (LRN)', sensitive: true, type: 'lrn', optional: true },
    Mobile: { label: 'Applicant Mobile Number', sensitive: false, type: 'mobile' },
    AddressLine1: { label: 'House / Unit / Building / Street', sensitive: false, type: 'text' },
    AddressLine2: { label: 'Subdivision / Village / Phase', sensitive: false, type: 'text', optional: true },
    Barangay: { label: 'Barangay', sensitive: false, type: 'text' },
    City: { label: 'City / Municipality', sensitive: false, type: 'text' },
    EmName: { label: 'Emergency Contact Name', sensitive: false, type: 'name' },
    EmRelation: { label: 'Emergency Contact Relationship', sensitive: false, type: 'text' },
    EmMobile: { label: 'Emergency Contact Mobile Number', sensitive: false, type: 'mobile' },
    EmAddress: { label: 'Emergency Contact Address', sensitive: false, type: 'text', optional: true },
    FatherMobile: { label: 'Father Mobile Number', sensitive: false, type: 'mobile', optional: true },
    FatherEmail: { label: 'Father Email Address', sensitive: false, type: 'email', optional: true },
    MotherMobile: { label: 'Mother Mobile Number', sensitive: false, type: 'mobile', optional: true },
    MotherEmail: { label: 'Mother Email Address', sensitive: false, type: 'email', optional: true },
    GuardName: { label: 'Parent / Guardian Name', sensitive: false, type: 'name', optional: true },
    GuardRelation: { label: 'Parent / Guardian Relationship', sensitive: false, type: 'text', optional: true },
    GuardEmail: { label: 'Parent / Guardian Email Address', sensitive: false, type: 'email', optional: true },
    GuardMobile: { label: 'Parent / Guardian Mobile Number', sensitive: false, type: 'mobile', optional: true },
    PrevSchool: { label: 'Previous School Name', sensitive: false, type: 'text', optional: true },
    PrevSY: { label: 'Previous School Year', sensitive: false, type: 'schoolYear', optional: true },
    PrevGrade: { label: 'Previous Grade Level', sensitive: false, type: 'text', optional: true },
    PrevCluster: { label: 'Previous SHS Strand / Cluster', sensitive: false, type: 'text', optional: true },
    Cluster: { label: 'Current SHS Strand / Cluster', sensitive: false, type: 'text', optional: true }
  }
};

/** Manual owner/editor setup. Creates empty schema sheets and a private Drive folder only. */
function admissionCorrectionSetup_() {
  authRequireEditor_();
  var ss = authSpreadsheet_();
  admissionCorrectionEnsureSheet_(ss, ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
  admissionCorrectionEnsureSheet_(ss, ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS);
  admissionCorrectionEnsureSheet_(ss, ADM_CORR.AUDIT, ADM_CORR.AUDIT_HEADERS);

  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(ADM_CORR.FOLDER_PROPERTY);
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder('Moreh Academy - Private Application Correction Documents');
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    props.setProperty(ADM_CORR.FOLDER_PROPERTY, folder.getId());
  } else {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  }
  Logger.log('Correction request schemas are ready. Private Drive folder ID: ' + folder.getId());
  Logger.log('No staff members were granted Drive access. Folder sharing is PRIVATE.');
}

function admissionCorrectionEnsureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getLastRow() === 0) {
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var actual = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function (h, i) {
    if (String(actual[i] || '') !== h) throw new Error('Schema mismatch in ' + name + ' at column ' + (i + 1) + '. No data was changed.');
  });
  return sh;
}

function admissionCorrectionSheet_(name, headers) {
  var sh = authSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Correction module is not initialized. Ask the system owner to run admissionCorrectionSetup_().');
  var actual = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function (h, i) {
    if (String(actual[i] || '') !== h) throw new Error('Correction module schema is invalid. Contact the system owner.');
  });
  return sh;
}

function admissionCorrectionRows_(name, headers) {
  var sh = admissionCorrectionSheet_(name, headers), last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues(), out = [];
  values.forEach(function (row, index) {
    if (!row[0]) return;
    var o = { _row: index + 2 };
    headers.forEach(function (h, i) { o[h] = row[i] == null ? '' : String(row[i]); });
    out.push(o);
  });
  return out;
}

function admissionCorrectionClean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (s.length > max) throw new Error('One of the correction fields is too long.');
  return s;
}

function admissionCorrectionValidateValue_(key, raw) {
  var rule = ADM_CORR.FIELDS[key];
  if (!rule) throw new Error('This application field cannot be corrected through the portal.');
  var value = admissionCorrectionClean_(raw, 300);
  if (!value && !rule.optional) throw new Error(rule.label + ' cannot be blank.');
  if (rule.type === 'name' && value && !/^[A-Z\u00C0-\u00DD][A-Z\u00C0-\u00DD .'-]{0,79}$/i.test(value)) {
    throw new Error(rule.label + ' contains unsupported characters.');
  }
  if (rule.type === 'mobile' && value && !/^09\d{9}$/.test(value)) throw new Error(rule.label + ' must be an 11-digit Philippine mobile number beginning with 09.');
  if (rule.type === 'email' && value && !admissionDbValidEmail_(value)) throw new Error('Enter a valid email address.');
  if (rule.type === 'lrn' && value && !/^[1-5]\d{11}$/.test(value)) throw new Error('LRN must contain 12 digits and start with 1, 2, 3, 4 or 5.');
  if (rule.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || admissionDbAge_(value) === '')) throw new Error('Enter a valid date of birth.');
  if (rule.type === 'schoolYear' && value) {
    var m = value.match(/^(20\d{2})-(20\d{2})$/);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new Error('Enter a valid consecutive school year, such as 2026-2027.');
  }
  return value;
}

function admissionCorrectionRequestRef_() {
  var year = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy');
  return 'CR-' + year + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function admissionCorrectionPrivateFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(ADM_CORR.FOLDER_PROPERTY);
  if (!id) throw new Error('Private document storage is not configured. Contact the system owner.');
  var folder = DriveApp.getFolderById(id);
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  }
  return folder;
}

function admissionCorrectionDecodeFile_(item) {
  if (!item || typeof item !== 'object') throw new Error('Invalid supporting document.');
  var name = admissionCorrectionClean_(item.name, 120).replace(/[\\\/:*?"<>|#%{}~&]/g, '_');
  var mime = String(item.mimeType || '').toLowerCase();
  var data = String(item.data || '');
  var allowed = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
  if (!allowed[mime] || !name || !/\.(pdf|jpe?g|png)$/i.test(name)) throw new Error('Only PDF, JPG, and PNG documents are accepted.');
  var base64 = data.replace(/^data:[^,]*;base64,/, '');
  if (!base64 || base64.length > Math.ceil(ADM_CORR.MAX_FILE_BYTES * 4 / 3) + 16) throw new Error('Each supporting document must be 5 MB or smaller.');
  var bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (e) { throw new Error('The supporting document could not be read.'); }
  if (!bytes.length || bytes.length > ADM_CORR.MAX_FILE_BYTES) throw new Error('Each supporting document must be 5 MB or smaller.');
  var signatureOk = mime === 'application/pdf'
    ? String.fromCharCode.apply(null, bytes.slice(0, 4)) === '%PDF'
    : mime === 'image/jpeg'
      ? (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255
      : (bytes[0] & 255) === 137 && String.fromCharCode.apply(null, bytes.slice(1, 4)) === 'PNG';
  if (!signatureOk) throw new Error('The document content does not match its file type.');
  return { name: name, mimeType: mime, bytes: bytes };
}

function admissionCorrectionSaveFiles_(requestRef, applicantEmail, files) {
  var stored = [];
  if (!files || !files.length) return stored;
  if (!Array.isArray(files) || files.length > ADM_CORR.MAX_FILES) throw new Error('You may attach up to two supporting documents.');
  var root = admissionCorrectionPrivateFolder_();
  var requestFolder = root.createFolder(requestRef);
  requestFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  try {
    files.forEach(function (item) {
      var decoded = admissionCorrectionDecodeFile_(item);
      var safeName = requestRef + '_' + Utilities.getUuid().slice(0, 8) + '_' + decoded.name;
      var blob = Utilities.newBlob(decoded.bytes, decoded.mimeType, safeName);
      var file = requestFolder.createFile(blob);
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      stored.push({
        DocumentId: Utilities.getUuid(),
        RequestRef: requestRef,
        DriveFileId: file.getId(),
        FileName: decoded.name,
        MimeType: decoded.mimeType,
        SizeBytes: decoded.bytes.length,
        UploadedAt: new Date().toISOString(),
        UploadedBy: applicantEmail
      });
    });
    var sh = admissionCorrectionSheet_(ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS);
    stored.forEach(function (d) {
      sh.appendRow(ADM_CORR.DOCUMENT_HEADERS.map(function (h) { return d[h] || ''; }));
    });
    return stored;
  } catch (err) {
    // If any file fails, remove the request folder and its contents before returning an error.
    var it = requestFolder.getFiles();
    while (it.hasNext()) it.next().setTrashed(true);
    requestFolder.setTrashed(true);
    throw err;
  }
}

function admissionCorrectionAudit_(actorEmail, action, requestRef, studentId, detail, fieldKey, beforeValue, afterValue, verificationMethod) {
  try {
    var sh = admissionCorrectionSheet_(ADM_CORR.AUDIT, ADM_CORR.AUDIT_HEADERS);
    var clean = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').slice(0, n); };
    sh.appendRow([
      new Date().toISOString(), clean(actorEmail, 254), clean(action, 80),
      clean(requestRef, 40), clean(studentId, 40), clean(fieldKey, 80),
      clean(beforeValue, 300), clean(afterValue, 300), clean(verificationMethod, 80),
      clean(detail, 300)
    ]);
  } catch (e) { console.error('Correction audit failed: ' + e.message); }
}

/**
 * Applicant/Student submits one field correction. Sensitive identity corrections require
 * either private supporting document(s) or an in-person verification request.
 */
function admissionSubmitCorrectionRequest(token, input) {
  var account, requestRef = '', insertedRow = 0, sh = null, filesStored = [];
  try {
    account = authRequireRole_(token, ['Applicant', 'Student']);
    if (!account.studentId) throw new Error('Submit your initial application before requesting a correction.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid correction request.');
    var current = authResolveSession_(token);
    if (!current || current.email !== account.email || current.studentId !== account.studentId) throw new Error('Your session could not be verified. Please sign in again.');
    var record = admissionDbFindById_(account.studentId);
    if (!record || String(record.Email || '').toLowerCase() !== String(account.email || '').toLowerCase()) throw new Error('Your linked application could not be verified.');
    var key = String(input.fieldKey || '');
    var rule = ADM_CORR.FIELDS[key];
    if (!rule) throw new Error('This application field cannot be corrected through the portal.');
    var proposed = admissionCorrectionValidateValue_(key, input.proposedValue);
    var original = String(record[key] == null ? '' : record[key]);
    if (proposed === original) throw new Error('The proposed value is the same as the current application value.');
    var reason = admissionCorrectionClean_(input.reason, 1000);
    if (reason.length < 10) throw new Error('Please explain the reason for this correction in at least 10 characters.');
    var method = rule.sensitive ? String(input.verificationMethod || '') : (input.files && input.files.length ? 'DOCUMENT_UPLOAD' : 'NOT_REQUIRED');
    if (rule.sensitive && ['DOCUMENT_UPLOAD','IN_PERSON'].indexOf(method) < 0) throw new Error('Choose document upload or in-person identity verification.');
    if (rule.sensitive && method === 'DOCUMENT_UPLOAD' && (!input.files || !input.files.length)) throw new Error('Attach at least one supporting document, or choose in-person verification.');
    if (method === 'IN_PERSON' && input.files && input.files.length) throw new Error('Do not attach identity documents when choosing in-person verification.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    try {
      var duplicate = admissionCorrectionRows_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS).some(function (r) {
        return r.StudentID === account.studentId && r.FieldKey === key &&
          ['Submitted','Under Review','For Verification','For Additional Information','Approved'].indexOf(r.Status) >= 0;
      });
      if (duplicate) throw new Error('There is already an active correction request for this field. Check its status before submitting another.');
      requestRef = admissionCorrectionRequestRef_();
      if (input.files && input.files.length) filesStored = admissionCorrectionSaveFiles_(requestRef, account.email, input.files);
      sh = admissionCorrectionSheet_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
      var status = rule.sensitive ? 'For Verification' : 'Submitted';
      var row = [
        requestRef, new Date().toISOString(), new Date().toISOString(),
        account.studentId, account.email, key, rule.label, original, proposed,
        reason, rule.sensitive ? 'Yes' : 'No', method, status, '', '', '', ''
      ];
      insertedRow = sh.getLastRow() + 1;
      sh.getRange(insertedRow, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      admissionCorrectionAudit_(account.email, 'correction-request-submitted', requestRef, account.studentId,
        'Field=' + key + '; Sensitive=' + (rule.sensitive ? 'Yes' : 'No') + '; Verification=' + method + '; Documents=' + filesStored.length);
    } catch (err) {
      if (insertedRow && sh) sh.deleteRow(insertedRow);
      if (requestRef && filesStored.length) admissionCorrectionTrashRequestFiles_(requestRef);
      throw err;
    } finally {
      lock.releaseLock();
    }
    return { success: true, message: 'Your correction request has been submitted.', data: { requestRef: requestRef, status: rule.sensitive ? 'For Verification' : 'Submitted' } };
  } catch (err) {
    return authFail_(err.message || 'Could not submit the correction request.');
  }
}

function admissionCorrectionTrashRequestFiles_(requestRef) {
  try {
    var root = admissionCorrectionPrivateFolder_(), folders = root.getFoldersByName(requestRef);
    while (folders.hasNext()) {
      var folder = folders.next(), files = folder.getFiles();
      while (files.hasNext()) files.next().setTrashed(true);
      folder.setTrashed(true);
    }
    var sh = admissionCorrectionSheet_(ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS);
    var rows = admissionCorrectionRows_(ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS);
    rows.filter(function (r) { return r.RequestRef === requestRef; }).reverse().forEach(function (r) { sh.deleteRow(r._row); });
  } catch (e) { console.error('Could not clean up failed correction upload: ' + e.message); }
}

/** Applicant/Student can see only correction requests tied to their own linked StudentID. */
function admissionGetMyCorrectionRequests(token) {
  try {
    var account = authRequireRole_(token, ['Applicant', 'Student']);
    if (!account.studentId) return { success: true, data: [] };
    var rows = admissionCorrectionRows_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS)
      .filter(function (r) { return r.StudentID === account.studentId && String(r.ApplicantEmail).toLowerCase() === String(account.email).toLowerCase(); })
      .sort(function (a, b) { return b.CreatedAt.localeCompare(a.CreatedAt); })
      .map(function (r) {
        return {
          requestRef: r.RequestRef, fieldLabel: r.FieldLabel, status: r.Status,
          createdAt: r.CreatedAt, decision: r.Decision || '',
          verificationMethod: r.VerificationMethod
        };
      });
    return { success: true, data: rows };
  } catch (err) {
    return authFail_(err.message || 'Could not load correction requests.');
  }
}


/** Owner-only correction queue. Encoders are not implicitly authorized to review identity records. */
function admissionGetCorrectionQueue(token) {
  try {
    authRequireRole_(token, ['Owner']);
    var rows = admissionCorrectionRows_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
    return {
      success: true,
      data: rows.sort(function (a, b) { return b.CreatedAt.localeCompare(a.CreatedAt); }).map(function (r) {
        return {
          requestRef: r.RequestRef, studentId: r.StudentID, applicantEmail: r.ApplicantEmail,
          fieldKey: r.FieldKey, fieldLabel: r.FieldLabel, status: r.Status,
          sensitive: r.Sensitive === 'Yes', verificationMethod: r.VerificationMethod,
          createdAt: r.CreatedAt, reason: r.Reason
        };
      })
    };
  } catch (err) { return authFail_(err.message || 'Could not load correction requests.'); }
}

/** Owner-only detail endpoint. Returns document metadata, never a Drive URL or file ID. */
function admissionGetCorrectionDetail(token, requestRef) {
  try {
    authRequireRole_(token, ['Owner']);
    var ref = admissionCorrectionClean_(requestRef, 40);
    var rows = admissionCorrectionRows_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
    var request = rows.filter(function (r) { return r.RequestRef === ref; })[0];
    if (!request) throw new Error('Correction request was not found.');
    var docs = admissionCorrectionRows_(ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS)
      .filter(function (d) { return d.RequestRef === ref; })
      .map(function (d) {
        return { documentId: d.DocumentId, fileName: d.FileName, mimeType: d.MimeType, sizeBytes: Number(d.SizeBytes || 0), uploadedAt: d.UploadedAt };
      });
    return {
      success: true,
      data: {
        requestRef: request.RequestRef, studentId: request.StudentID,
        applicantEmail: request.ApplicantEmail, fieldKey: request.FieldKey,
        fieldLabel: request.FieldLabel, originalValue: request.OriginalValue,
        proposedValue: request.ProposedValue, reason: request.Reason,
        sensitive: request.Sensitive === 'Yes', verificationMethod: request.VerificationMethod,
        status: request.Status, decision: request.Decision,
        createdAt: request.CreatedAt, documents: docs
      }
    };
  } catch (err) { return authFail_(err.message || 'Could not load correction request.'); }
}

/** Owner-only private document download. The file ID is resolved server-side from the request document table. */
function admissionDownloadCorrectionDocument(token, documentId) {
  try {
    authRequireRole_(token, ['Owner']);
    var id = admissionCorrectionClean_(documentId, 80);
    var docs = admissionCorrectionRows_(ADM_CORR.DOCUMENTS, ADM_CORR.DOCUMENT_HEADERS);
    var doc = docs.filter(function (d) { return d.DocumentId === id; })[0];
    if (!doc) throw new Error('Supporting document was not found.');
    var file = DriveApp.getFileById(doc.DriveFileId);
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    var blob = file.getBlob();
    var mime = String(blob.getContentType() || '');
    if (['application/pdf','image/jpeg','image/png'].indexOf(mime) < 0) throw new Error('This document type is not permitted.');
    var bytes = blob.getBytes();
    if (bytes.length > ADM_CORR.MAX_FILE_BYTES) throw new Error('The supporting document exceeds the download limit.');
    return {
      success: true,
      data: {
        fileName: doc.FileName, mimeType: mime,
        base64: Utilities.base64Encode(bytes)
      }
    };
  } catch (err) { return authFail_(err.message || 'Could not retrieve the supporting document.'); }
}

function admissionCorrectionUpdateRequestRow_(sh, rowNumber, updates) {
  var headers = ADM_CORR.REQUEST_HEADERS;
  Object.keys(updates).forEach(function (key) {
    var index = headers.indexOf(key);
    if (index < 0) throw new Error('Invalid correction request update.');
    sh.getRange(rowNumber, index + 1).setNumberFormat('@').setValue(String(updates[key] == null ? '' : updates[key]));
  });
}

/**
 * Owner-only review action. APPROVE applies the one allowlisted field change atomically
 * with the request completion status and records before/after values in CorrectionAudit.
 */
function admissionReviewCorrectionRequest(token, requestRef, action, notes, verificationMethod) {
  var owner;
  try {
    owner = authRequireRole_(token, ['Owner']);
    var ref = admissionCorrectionClean_(requestRef, 40);
    var act = String(action || '');
    var allowedActions = ['UNDER_REVIEW','FOR_VERIFICATION','FOR_ADDITIONAL_INFORMATION','APPROVE','REJECT'];
    if (allowedActions.indexOf(act) < 0) throw new Error('Select a valid review action.');
    var note = admissionCorrectionClean_(notes, 1000);
    if ((act === 'REJECT' || act === 'FOR_ADDITIONAL_INFORMATION') && note.length < 5) {
      throw new Error('Add a short explanation for this decision.');
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    try {
      var requestSheet = admissionCorrectionSheet_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
      var requests = admissionCorrectionRows_(ADM_CORR.REQUESTS, ADM_CORR.REQUEST_HEADERS);
      var request = requests.filter(function (r) { return r.RequestRef === ref; })[0];
      if (!request) throw new Error('Correction request was not found.');
      if (['Completed','Rejected'].indexOf(request.Status) >= 0) throw new Error('This correction request is already closed.');
      var rule = ADM_CORR.FIELDS[request.FieldKey];
      if (!rule) throw new Error('The requested field is not in the correction allowlist.');
      var now = new Date().toISOString();
      var updates = { UpdatedAt: now, ReviewerEmail: owner, ReviewedAt: now };
      if (act === 'UNDER_REVIEW') {
        updates.Status = 'Under Review'; updates.Decision = note || 'Request is under review.';
      } else if (act === 'FOR_VERIFICATION') {
        updates.Status = 'For Verification'; updates.Decision = note || 'Identity verification is required.';
      } else if (act === 'FOR_ADDITIONAL_INFORMATION') {
        updates.Status = 'For Additional Information'; updates.Decision = note;
      } else if (act === 'REJECT') {
        updates.Status = 'Rejected'; updates.Decision = note; 
      } else if (act === 'APPROVE') {
        var verified = rule.sensitive ? String(verificationMethod || '') : 'NOT_REQUIRED';
        if (rule.sensitive && ['DOCUMENTS_VERIFIED','IN_PERSON_VERIFIED'].indexOf(verified) < 0) {
          throw new Error('Confirm that the supporting documents or in-person identity check have been verified.');
        }
        var student = admissionDbFindById_(request.StudentID);
        if (!student || String(student.Email || '').toLowerCase() !== String(request.ApplicantEmail || '').toLowerCase()) {
          throw new Error('The linked admission record could not be verified.');
        }
        var before = String(student[request.FieldKey] == null ? '' : student[request.FieldKey]);
        if (before !== request.OriginalValue) throw new Error('The application field has changed since this request was submitted. Do not overwrite it; review the record manually.');
        var after = admissionCorrectionValidateValue_(request.FieldKey, request.ProposedValue);
        if (rule.type === 'name') after = after.toUpperCase();
        if (request.FieldKey === 'LRN' && after) {
          var allStudents = admissionDbRows_();
          if (allStudents.some(function (s) { return s.StudentID !== request.StudentID && String(s.LRN || '') === after; })) {
            throw new Error('This LRN is already assigned to another admission record.');
          }
        }
        var studentSheet = admissionDbSheet_();
        var fieldCol = ADM_DB.HEADERS.indexOf(request.FieldKey) + 1;
        if (fieldCol < 1) throw new Error('The requested application field is not writable.');
        studentSheet.getRange(student._row, fieldCol).setNumberFormat('@').setValue(after);
        if (['Surname','FirstName','MiddleName','Suffix'].indexOf(request.FieldKey) >= 0) {
          var fullName = String(student.Surname || ''), first = String(student.FirstName || ''),
            middle = String(student.MiddleName || ''), suffix = String(student.Suffix || '');
          if (request.FieldKey === 'Surname') fullName = after;
          if (request.FieldKey === 'FirstName') first = after;
          if (request.FieldKey === 'MiddleName') middle = after;
          if (request.FieldKey === 'Suffix') suffix = after;
          var composed = fullName + ', ' + first + (middle ? ' ' + middle : '') + (suffix ? ' ' + suffix : '');
          studentSheet.getRange(student._row, ADM_DB.HEADERS.indexOf('FullName') + 1).setNumberFormat('@').setValue(composed);
        }
        if (request.FieldKey === 'Birthdate') {
          var age = admissionDbAge_(after);
          if (age === '') throw new Error('The approved date of birth is invalid.');
          studentSheet.getRange(student._row, ADM_DB.HEADERS.indexOf('Age') + 1).setNumberFormat('@').setValue(age);
        }
        updates.Status = 'Completed';
        updates.Decision = 'Approved';
        updates.VerificationMethod = verified;
        updates.CompletedAt = now;
        admissionCorrectionAudit_(owner, 'correction-approved-and-applied', ref, request.StudentID,
          'Approved correction applied to AdmissionStudents.', request.FieldKey, before, after, verified);
      }
      admissionCorrectionUpdateRequestRow_(requestSheet, request._row, updates);
      if (act !== 'APPROVE') {
        admissionCorrectionAudit_(owner, 'correction-review-' + act.toLowerCase(), ref, request.StudentID,
          note || updates.Status, request.FieldKey, '', '', verificationMethod || request.VerificationMethod);
      }
    } finally { lock.releaseLock(); }
    return { success: true, message: act === 'APPROVE' ? 'Correction approved and applied to the admission record.' : 'Correction request updated.' };
  } catch (err) { return authFail_(err.message || 'Could not update the correction request.'); }
}
