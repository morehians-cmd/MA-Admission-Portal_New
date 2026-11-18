/**
 * AdmissionDb.gs
 *
 * Isolated admission-record store for the destination portal.
 * Authentication remains in Auth.gs / AuthAccount.gs. The Users sheet stores account identity;
 * AdmissionStudents stores student/application information. The relationship is Users.StudentID.
 *
 * IMPORTANT:
 * - Run admissionDbSetup_() manually from the Apps Script editor only after backing up the target sheet.
 * - This creates schema sheets only; it does not import or overwrite source-repository data.
 * - All browser-facing functions enforce destination sessions and ownership server-side.
 */

var ADM_DB = {
  VERSION: 3,
  STUDENTS: 'AdmissionStudents',
  AUDIT: 'AdmissionAudit',
  HEADERS: [
    'StudentID', 'CreatedAt',
    'Classification', 'SchoolYear', 'LRN', 'Surname', 'FirstName', 'MiddleName', 'Suffix', 'FullName',
    'Category', 'GradeLevel', 'Department', 'Cluster', 'Section', 'ReferredBy',
    'PrevSchool', 'PrevSY', 'PrevGrade', 'PrevCluster', 'PrevSection', 'PrevAdviser', 'PrevScholarship',
    'EscCertNo', 'VoucherCertNo', 'EscSchoolNo',
    'AddressLine1', 'AddressLine2', 'Barangay', 'City', 'Province',
    'Birthdate', 'Age', 'Mobile', 'SexualOrient', 'GenderOrient', 'Religion', 'ReligionOther', 'Email',
    'FatherName', 'FatherStatus', 'FatherOccupation', 'FatherEducation', 'FatherMobile', 'FatherReligion', 'FatherReligionOther',
    'MotherName', 'MotherStatus', 'MotherOccupation', 'MotherEducation', 'MotherMobile', 'MotherReligion', 'MotherReligionOther',
    'EmName', 'EmRelation', 'EmMobile', 'EmSameAddr', 'EmAddress',
    'GuardName', 'GuardRelation', 'GuardEmail', 'GuardMobile', 'ConsentAt',
    'ReqSF9', 'ReqF137', 'ReqBirth', 'ReqMoral', 'ReqJHS', 'ReqPhoto', 'ReqTransferee', 'ReqConsent', 'ReqRemarks',
    'EnrollStatus', 'CancelDate', 'CancelReason', 'CertNo',
    'Facebook', 'FatherEmail', 'MotherEmail', 'LivingWith',
    'RelName', 'RelRelation', 'RelBirthdate', 'RelAge', 'RelSex', 'RelGender', 'RelGenderOther', 'RelMobile',
    'RelCivil', 'RelSameAddr', 'RelAddress', 'RelSide', 'EmSource',
    'RelStatus', 'RelOccupation', 'RelEducation', 'RelEmail', 'RelReligion', 'RelReligionOther',
    'CancelReasonOther', 'DestSchool', 'DestAddress', 'DestType', 'DestGrade',
    'ProcessedBy', 'ProcessedDate', 'ProcessedTime', 'BirthPlace',
    'PrevSchoolID', 'PrevAddress',
    'ReqSF9Date', 'ReqF137Date', 'ReqBirthDate', 'ReqMoralDate', 'ReqJHSDate', 'ReqPhotoDate', 'ReqTransfereeDate', 'ReqConsentDate',
    'ReqEnvelope', 'ReqEnvelopeDate',
    'StatusChangedAt', 'TempUntil', 'TempBy', 'IDNumber', 'IDPhotoID',
    'ReqSF9Status', 'ReqF137Status', 'ReqBirthStatus', 'ReqMoralStatus', 'ReqJHSStatus', 'ReqPhotoStatus', 'ReqTransfereeStatus', 'ReqConsentStatus', 'ReqEnvelopeStatus',
    'ReqSF9InitialStatus', 'ReqSF9CompletionStatus', 'ReqBirthInitialStatus', 'ReqBirthCompletionStatus'
  ],
  AUDIT_HEADERS: ['At', 'ActorEmail', 'Action', 'StudentID', 'Detail'],
  REQUIREMENTS: [
    { key: 'ReqSF9', label: 'SF9 / Report Card', statusKey: 'ReqSF9Status' },
    { key: 'ReqF137', label: 'Form 137 / SF10', statusKey: 'ReqF137Status' },
    { key: 'ReqBirth', label: 'PSA Birth Certificate', statusKey: 'ReqBirthStatus' },
    { key: 'ReqMoral', label: 'Good Moral Certificate', statusKey: 'ReqMoralStatus' },
    { key: 'ReqJHS', label: 'JHS Completion Certificate', statusKey: 'ReqJHSStatus' },
    { key: 'ReqPhoto', label: 'Three (3) 2x2 ID photos, white background, with nametag', statusKey: 'ReqPhotoStatus' },
    { key: 'ReqTransferee', label: 'Transferee / Scholarship Certification', statusKey: 'ReqTransfereeStatus' },
    { key: 'ReqConsent', label: 'Parental Consent & Data Privacy Undertaking Form', statusKey: 'ReqConsentStatus' },
    { key: 'ReqEnvelope', label: 'Long Brown Expandable Envelope', statusKey: 'ReqEnvelopeStatus' },
    { key: 'ReqSF9Initial', label: 'Report Card — Photocopy (Initial)', statusKey: 'ReqSF9InitialStatus' },
    { key: 'ReqSF9Completion', label: 'Report Card — Original (Completion)', statusKey: 'ReqSF9CompletionStatus' },
    { key: 'ReqBirthInitial', label: 'PSA Birth Certificate — Photocopy (Initial)', statusKey: 'ReqBirthInitialStatus' },
    { key: 'ReqBirthCompletion', label: 'PSA Birth Certificate — Original (Completion)', statusKey: 'ReqBirthCompletionStatus' }
  ],
  APPLICANT_FIELDS: [
    'SchoolYear', 'LRN', 'Surname', 'FirstName', 'MiddleName', 'Suffix', 'Category', 'GradeLevel',
    'Department', 'Cluster', 'ReferredBy', 'PrevSchool', 'PrevSY', 'PrevGrade', 'PrevCluster', 'PrevSection',
    'PrevAdviser', 'PrevScholarship', 'PrevSchoolID', 'PrevAddress',
    'FatherName', 'FatherStatus', 'FatherOccupation', 'FatherEducation', 'FatherMobile', 'FatherReligion', 'FatherReligionOther',
    'MotherName', 'MotherStatus', 'MotherOccupation', 'MotherEducation', 'MotherMobile', 'MotherReligion', 'MotherReligionOther',
    'AddressLine1', 'AddressLine2', 'Barangay', 'City', 'Province',
    'Birthdate', 'Mobile', 'SexualOrient', 'GenderOrient', 'Religion', 'ReligionOther',
    'EmName', 'EmRelation', 'EmMobile', 'EmSameAddr', 'EmAddress',
    'GuardName', 'GuardRelation', 'GuardEmail', 'GuardMobile',
    'Facebook', 'FatherEmail', 'MotherEmail', 'LivingWith',
    'RelName', 'RelRelation', 'RelBirthdate', 'RelSex', 'RelGender', 'RelGenderOther', 'RelMobile',
    'RelCivil', 'RelSameAddr', 'RelAddress', 'RelSide', 'BirthPlace',
    'RelStatus', 'RelOccupation', 'RelEducation', 'RelEmail', 'RelReligion', 'RelReligionOther'
  ]
};

/**
 * Owner-only schema setup. Creates missing sheets and appends the Users.StudentID header
 * through the existing controlled Users migration. Existing admission data is never cleared.
 */
function admissionDbSetup_() {
  authRequireEditor_();
  authMigrateUsersSheet();
  var ss = authSpreadsheet_();
  admissionDbEnsureSchemaSheet_(ss, ADM_DB.STUDENTS, ADM_DB.HEADERS);
  admissionDbEnsureSchemaSheet_(ss, ADM_DB.AUDIT, ADM_DB.AUDIT_HEADERS);
  Logger.log('Admission database schema v' + ADM_DB.VERSION + ' is ready in ' + ss.getName() + '. No source data was imported.');
}

/** Creates an empty schema sheet or verifies an existing one without rewriting its headers. */
function admissionDbEnsureSchemaSheet_(ss, name, headers) {
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
  for (var i = 0; i < headers.length; i++) {
    if (String(actual[i] || '') !== headers[i]) {
      throw new Error('Schema mismatch in ' + name + ' at column ' + (i + 1) + '. No headers or records were changed.');
    }
  }
  return sh;
}

function admissionDbSheet_() {
  var ss = authSpreadsheet_(), sh = ss.getSheetByName(ADM_DB.STUDENTS);
  if (!sh) throw new Error('Admission database is not initialized. Ask the system owner to run admissionDbSetup_().');
  var actual = sh.getRange(1, 1, 1, ADM_DB.HEADERS.length).getDisplayValues()[0];
  for (var i = 0; i < ADM_DB.HEADERS.length; i++) {
    if (String(actual[i] || '') !== ADM_DB.HEADERS[i]) throw new Error('Admission database schema is invalid. Contact the system owner.');
  }
  return sh;
}

function admissionDbRows_() {
  var sh = admissionDbSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, ADM_DB.HEADERS.length).getValues(), out = [];
  values.forEach(function (row, index) {
    var id = String(row[0] || '').trim();
    if (!id) return;
    var obj = { _row: index + 2 };
    ADM_DB.HEADERS.forEach(function (h, i) { obj[h] = row[i] == null ? '' : String(row[i]); });
    out.push(obj);
  });
  return out;
}

function admissionDbFindById_(studentId) {
  var fast = maAdmissionSpeedFindStudent_(studentId);
  if (fast) return fast;

  var found = admissionDbRows_().filter(function (r) { return r.StudentID === String(studentId || ''); });
  if (found.length > 1) throw new Error('Admission database integrity error: duplicate StudentID.');
  return found.length ? found[0] : null;
}

function admissionDbAge_(isoDate) {
  var d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime()) || Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd') !== isoDate) return '';
  var now = new Date(), age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 0 && age <= 120 ? String(age) : '';
}

function admissionDbCleanText_(value, max) {
  var s = String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (s.length > max) throw new Error('One of the submitted fields is too long.');
  return s;
}

function admissionDbNormalizeApplicant_(input, account) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application data.');
  var out = {};
  if (input.PrivacyConsent !== true) throw new Error('You must accept the Data Privacy consent before submitting.');
  Object.keys(input).forEach(function (key) {
    if (key === 'PrivacyConsent') return;
    if (ADM_DB.APPLICANT_FIELDS.indexOf(key) < 0) throw new Error('Unsupported application field: ' + key);
    var v = input[key];
    if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
    out[key] = admissionDbCleanText_(v, 1000);
  });
  out.ConsentAt = new Date().toISOString();
  out.Surname = admissionDbCleanText_(out.Surname, 80).toUpperCase();
  out.FirstName = admissionDbCleanText_(out.FirstName, 80).toUpperCase();
  if (!out.Surname || !out.FirstName) throw new Error('Surname and first name are required.');
  if (!out.Birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(out.Birthdate) || !admissionDbAge_(out.Birthdate)) throw new Error('Enter a valid birth date.');
  if (!out.SchoolYear || !/^20\d{2}-20\d{2}$/.test(out.SchoolYear)) throw new Error('Select a valid school year.');
  if (!out.GradeLevel) throw new Error('Select an intended grade level.');
  if (out.LRN && !/^\d{12}$/.test(out.LRN)) throw new Error('LRN must contain exactly 12 digits.');
  if (out.Mobile && !/^09\d{9}$/.test(out.Mobile)) throw new Error('Enter a valid 11-digit mobile number.');
  out.FullName = out.Surname + ', ' + out.FirstName + (out.MiddleName ? ' ' + out.MiddleName : '') + (out.Suffix ? ' ' + out.Suffix : '');
  out.Email = account.email;
  out.Classification = 'New';
  out.Age = admissionDbAge_(out.Birthdate);
  out.EnrollStatus = 'Not Enrolled';
  ADM_DB.REQUIREMENTS.forEach(function (item) { out[item.statusKey] = 'Not Applicable'; });
  admissionDbRequirementItems_(out).forEach(function (item) { out[item.statusKey] = 'Pending Submission'; });
  return out;
}

function admissionDbRequirementItems_(record) {
  var grades = ['Nursery','Kinder 1','Kinder 2','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
  var index = grades.indexOf(String(record.GradeLevel || ''));
  if (index < 0) return [];
  var level = index < 2 ? 'PRE' : index < 9 ? 'ELEM' : index < 13 ? 'JHS' : 'SHS';
  var applicable = [];
  if (level !== 'PRE') applicable.push('ReqSF9Initial', 'ReqSF9Completion');
  applicable.push('ReqBirthInitial', 'ReqPhoto', 'ReqEnvelope');
  if (level !== 'PRE') applicable.push('ReqF137', 'ReqMoral');
  if (level === 'SHS') applicable.push('ReqBirthCompletion');
  if (String(record.GradeLevel) === 'Grade 11') applicable.push('ReqJHS');
  var eligible = (level === 'JHS' || level === 'SHS') &&
    ['TLC','ESC','PUB-QVR','QVA PASSER'].indexOf(String(record.Category || '').toUpperCase()) >= 0;
  if (eligible) applicable.push('ReqTransferee');
  applicable.push('ReqConsent');
  var items = [];
  ADM_DB.REQUIREMENTS.forEach(function (item) {
    if (applicable.indexOf(item.key) < 0) return;
    items.push({
      key: item.key,
      statusKey: item.statusKey,
      label: item.label,
      required: true,
      status: String(record[item.statusKey] || 'Pending Submission')
    });
  });
  return items;
}

function admissionDbNewStudentId_() {
  var year = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy');
  return 'MA-' + year + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

/**
 * Browser-facing first application submission.
 * Only an active Applicant may create their own record. The server supplies email, StudentID,
 * timestamps, FullName, Age, Classification, and EnrollStatus; client-supplied system fields are rejected.
 */
function admissionCreateApplication(token, input) {
  var account;
  try {
    account = authRequireRole_(token, ['Applicant']);
    if (account.studentId) throw new Error('An admission record is already linked to this account.');
    var record = admissionDbNormalizeApplicant_(input, account);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    var insertedRow = 0, sh = null, studentId = '';
    try {
      var current = authResolveSession_(token);
      if (!current || current.email !== account.email || current.role !== 'Applicant' || current.studentId) throw new Error('Your session or account status changed. Please sign in again.');
      sh = admissionDbSheet_();
      var existing = admissionDbRows_();
      if (existing.some(function (r) { return r.Email.toLowerCase() === account.email.toLowerCase(); })) throw new Error('An admission record already exists for this account.');
      if (record.LRN && existing.some(function (r) { return r.LRN === record.LRN; })) throw new Error('An application with this LRN already exists. Please contact the Admissions Office if you believe this is an error.');
      studentId = admissionDbNewStudentId_();
      var row = {};
      ADM_DB.HEADERS.forEach(function (h) { row[h] = ''; });
      row.StudentID = studentId;
      row.CreatedAt = new Date().toISOString();
      Object.keys(record).forEach(function (k) { row[k] = record[k]; });
      var values = [ADM_DB.HEADERS.map(function (h) { return row[h] == null ? '' : String(row[h]); })];
      insertedRow = sh.getLastRow() + 1;
      sh.getRange(insertedRow, 1, 1, ADM_DB.HEADERS.length).setNumberFormat('@').setValues(values);
      authLinkStudentLocked_(account.email, studentId);
      maAdmissionSpeedBump_();
      admissionDbAudit_(account.email, 'application-created', studentId, 'Initial application record created');
    } catch (err) {
      if (insertedRow && sh) sh.deleteRow(insertedRow);
      throw err;
    } finally {
      lock.releaseLock();
    }
    return { success: true, message: 'Your application record has been created.', data: { studentId: studentId } };
  } catch (err) {
    return authFail_(err.message || 'Could not save the application. Please try again.');
  }
}

/** Applicant/Student can read only the record linked to their own authenticated account. */
function admissionGetMyApplication(token) {
  try {
    var account = authRequireRole_(token, ['Applicant', 'Student']);
    if (!account.studentId) return { success: true, message: 'No application has been submitted yet.', data: null };
    var record = admissionDbFindById_(account.studentId);
    if (!record) throw new Error('Your account link could not be verified. Contact the Admissions Office.');
    record.RequirementItems = admissionDbRequirementItems_(record);
    delete record._row;
    return { success: true, message: 'Application loaded.', data: record };
  } catch (err) {
    return authFail_(err.message || 'Could not load your application.');
  }
}

/** Best-effort audit. Never logs passwords, OTPs, tokens, or full application payloads. */
function admissionDbAudit_(actorEmail, action, studentId, detail) {
  try {
    var ss = authSpreadsheet_(), sh = ss.getSheetByName(ADM_DB.AUDIT);
    if (!sh) return;
    var clean = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').slice(0, n); };
    var row = [new Date().toISOString(), clean(actorEmail, 254), clean(action, 80), clean(studentId, 40), clean(detail, 300)];
    var target = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat('@').setValues([row]);
  } catch (e) { console.error('Admission audit failed: ' + e.message); }
}

function runAdmissionDbSetup() {
  admissionDbSetup_();
}