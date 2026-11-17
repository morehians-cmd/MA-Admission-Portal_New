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
  VERSION: 1,
  STUDENTS: 'AdmissionStudents',
  AUDIT: 'AdmissionAudit',
  IDENTIFIERS: 'StudentIdentifiers',
  IDENTIFIER_HEADERS: ['IdentifierID','StudentID','IdentifierType','IdentifierValue','IssuedAt','EffectiveFrom','EffectiveTo','IsCurrent','IdentifierStatus','IssuanceReason','SourceRecordID','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'],
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
    'CancelReasonOther', 'DestSchool', 'DestAddress', 'DestType', 'DestGrade',
    'ProcessedBy', 'ProcessedDate', 'ProcessedTime', 'BirthPlace',
    'PrevSchoolID', 'PrevAddress',
    'ReqSF9Date', 'ReqF137Date', 'ReqBirthDate', 'ReqMoralDate', 'ReqJHSDate', 'ReqPhotoDate', 'ReqTransfereeDate', 'ReqConsentDate',
    'ReqEnvelope', 'ReqEnvelopeDate',
    'StatusChangedAt', 'TempUntil', 'TempBy', 'IDNumber', 'IDPhotoID'
  ],
  AUDIT_HEADERS: ['At', 'ActorEmail', 'Action', 'StudentID', 'Detail'],
  APPLICANT_FIELDS: [
    'SchoolYear', 'LRN', 'Surname', 'FirstName', 'MiddleName', 'Suffix', 'Category', 'GradeLevel',
    'Department', 'Cluster', 'PrevSchool', 'PrevSY', 'PrevGrade', 'PrevCluster', 'PrevSection',
    'PrevAdviser', 'PrevScholarship', 'PrevSchoolID', 'PrevAddress',
    'FatherName', 'FatherStatus', 'FatherOccupation', 'FatherEducation', 'FatherMobile', 'FatherReligion', 'FatherReligionOther',
    'MotherName', 'MotherStatus', 'MotherOccupation', 'MotherEducation', 'MotherMobile', 'MotherReligion', 'MotherReligionOther',
    'AddressLine1', 'AddressLine2', 'Barangay', 'City', 'Province',
    'Birthdate', 'Mobile', 'SexualOrient', 'GenderOrient', 'Religion', 'ReligionOther',
    'EmName', 'EmRelation', 'EmMobile', 'EmSameAddr', 'EmAddress',
    'GuardName', 'GuardRelation', 'GuardEmail', 'GuardMobile',
    'EmSource',
    'Facebook', 'FatherEmail', 'MotherEmail', 'LivingWith',
    'RelName', 'RelRelation', 'RelBirthdate', 'RelSex', 'RelGender', 'RelGenderOther', 'RelMobile',
    'RelCivil', 'RelSameAddr', 'RelAddress', 'RelSide', 'BirthPlace', 'PrivacyConsent'
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
  admissionDbEnsureSchemaSheet_(ss, ADM_DB.IDENTIFIERS, ADM_DB.IDENTIFIER_HEADERS);
  var identifiersBackfilled = admissionDbBackfillIdentifiers_();
  Logger.log('Admission database schema v' + ADM_DB.VERSION + ' is ready in ' + ss.getName() + '. Existing StudentID links were preserved; identifier rows backfilled: ' + identifiersBackfilled + '. No source data was imported.');
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

function admissionDbIdentifierSheet_() {
  var sh = authSpreadsheet_().getSheetByName(ADM_DB.IDENTIFIERS);
  if (!sh) throw new Error('Student identifier schema is not initialized. Ask the system owner to run runAdmissionDbSetup().');
  var actual = sh.getRange(1, 1, 1, ADM_DB.IDENTIFIER_HEADERS.length).getDisplayValues()[0];
  ADM_DB.IDENTIFIER_HEADERS.forEach(function (h, i) {
    if (String(actual[i] || '') !== h) throw new Error('Student identifier schema is invalid. Contact the system owner.');
  });
  return sh;
}

function admissionDbIdentifierRows_() {
  var sh = admissionDbIdentifierSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, ADM_DB.IDENTIFIER_HEADERS.length).getValues(), out = [];
  values.forEach(function (row, index) {
    if (!row[0]) return;
    var o = { _row: index + 2 };
    ADM_DB.IDENTIFIER_HEADERS.forEach(function (h, i) { o[h] = row[i] == null ? '' : String(row[i]); });
    out.push(o);
  });
  return out;
}

/** Idempotently preserves existing AdmissionStudents.StudentID values without rewriting links. */
function admissionDbBackfillIdentifiers_() {
  var sh = admissionDbIdentifierSheet_(), identifiers = admissionDbIdentifierRows_();
  var pairMap = {}, valueOwner = {};
  identifiers.forEach(function (r) {
    pairMap[r.StudentID + '|' + r.IdentifierValue] = true;
    if (r.IdentifierValue) {
      if (valueOwner[r.IdentifierValue] && valueOwner[r.IdentifierValue] !== r.StudentID) {
        throw new Error('Student identifier collision detected. No records were changed.');
      }
      valueOwner[r.IdentifierValue] = r.StudentID;
    }
  });
  var students = admissionDbRows_(), added = 0, now = new Date().toISOString();
  students.forEach(function (student) {
    var key = String(student.StudentID || '').trim();
    if (!key || /^STU-[A-F0-9]{24}$/.test(key) || pairMap[key + '|' + key]) return;
    if (valueOwner[key] && valueOwner[key] !== key) {
      throw new Error('Existing StudentID conflicts with another student identifier. No records were changed.');
    }
    var isMa = /^MA-20\d{2}-[A-Z0-9]{10}$/.test(key);
    var isTlc = /^TLC\d{4}-\d{4}$/i.test(key);
    var created = student.CreatedAt || now;
    var item = {
      IdentifierID: Utilities.getUuid(), StudentID: key,
      IdentifierType: isMa ? 'MA_STUDENT_ID' : (isTlc ? 'TLC_LEGACY_ID' : 'LEGACY_STUDENT_ID'),
      IdentifierValue: key, IssuedAt: created, EffectiveFrom: created, EffectiveTo: '',
      IsCurrent: 'TRUE', IdentifierStatus: 'ACTIVE',
      IssuanceReason: 'Backfilled from existing AdmissionStudents.StudentID; original value preserved',
      SourceRecordID: key, CreatedAt: now, CreatedBy: 'SYSTEM_MIGRATION', UpdatedAt: '', UpdatedBy: ''
    };
    var target = sh.getLastRow() + 1;
    sh.getRange(target, 1, 1, ADM_DB.IDENTIFIER_HEADERS.length).setNumberFormat('@')
      .setValues([ADM_DB.IDENTIFIER_HEADERS.map(function (h) { return item[h] == null ? '' : String(item[h]); })]);
    pairMap[key + '|' + key] = true;
    valueOwner[key] = key;
    added++;
  });
  return added;
}

function admissionDbDisplayIdentifier_(studentId) {
  var rows = admissionDbIdentifierRows_().filter(function (r) {
    return r.StudentID === String(studentId || '') &&
      String(r.IsCurrent).toUpperCase() === 'TRUE' &&
      String(r.IdentifierStatus).toUpperCase() === 'ACTIVE';
  });
  var priorities = ['MA_STUDENT_ID','SHS_SCHOOL_ID','TLC_LEGACY_ID','LEGACY_STUDENT_ID'];
  for (var i = 0; i < priorities.length; i++) {
    var matches = rows.filter(function (r) { return r.IdentifierType === priorities[i]; });
    if (matches.length > 1) throw new Error('Multiple current identifiers of the same type exist for this student. Contact the system owner.');
    if (matches.length === 1) return matches[0].IdentifierValue;
  }
  return '';
}

function admissionDbAppendIdentifierLocked_(studentId, value, type, reason, actorEmail) {
  var sh = admissionDbIdentifierSheet_(), rows = admissionDbIdentifierRows_();
  if (rows.some(function (r) { return r.IdentifierValue === value; })) throw new Error('This official student identifier is already assigned.');
  var now = new Date().toISOString();
  var item = {
    IdentifierID: Utilities.getUuid(), StudentID: studentId, IdentifierType: type,
    IdentifierValue: value, IssuedAt: now, EffectiveFrom: now, EffectiveTo: '',
    IsCurrent: 'TRUE', IdentifierStatus: 'ACTIVE', IssuanceReason: reason,
    SourceRecordID: studentId, CreatedAt: now, CreatedBy: actorEmail || 'SYSTEM',
    UpdatedAt: '', UpdatedBy: ''
  };
  var target = sh.getLastRow() + 1;
  sh.getRange(target, 1, 1, ADM_DB.IDENTIFIER_HEADERS.length).setNumberFormat('@')
    .setValues([ADM_DB.IDENTIFIER_HEADERS.map(function (h) { return item[h] == null ? '' : String(item[h]); })]);
  return target;
}

function admissionDbValidateLrn_(value, required) {
  var lrn = String(value == null ? '' : value).trim();
  if (!lrn && required !== false) throw new Error('Learner Reference Number (LRN) is required.');
  if (lrn && !/^[1-5][0-9]{11}$/.test(lrn)) {
    throw new Error('LRN must contain exactly 12 digits and start with 1, 2, 3, 4 or 5.');
  }
  return lrn;
}
function admissionDbFindById_(studentId) {
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

function admissionDbValidName_(value) {
  return /^[A-Z\u00C0-\u00DD][A-Z\u00C0-\u00DD .'-]{0,59}$/.test(String(value || ''));
}

function admissionDbValidRelation_(value) {
  return /^[A-Z\u00C0-\u00DD][A-Z\u00C0-\u00DD ./'&-]{0,59}$/.test(String(value || ''));
}

function admissionDbValidEmail_(value) {
  var e = String(value || '').trim();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

function admissionDbNormalizeApplicant_(input, account) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application data.');
  var out = {};
  Object.keys(input).forEach(function (key) {
    if (ADM_DB.APPLICANT_FIELDS.indexOf(key) < 0) throw new Error('Unsupported application field: ' + key);
    var v = input[key];
    if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
    out[key] = admissionDbCleanText_(v, 1000);
  });

  ['Surname', 'FirstName', 'MiddleName', 'Suffix'].forEach(function (key) {
    out[key] = admissionDbCleanText_(out[key], 80).toUpperCase();
    if (out[key] && !admissionDbValidName_(out[key])) {
      throw new Error(key + ' may contain letters, spaces, periods, apostrophes and hyphens only.');
    }
  });
  if (!out.Surname || !out.FirstName) throw new Error('Surname and first name are required.');

  var age = admissionDbAge_(out.Birthdate);
  if (!out.Birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(out.Birthdate) || age === '') {
    throw new Error('Enter a valid birth date.');
  }
  if (!out.SchoolYear || !/^20\d{2}-20\d{2}$/.test(out.SchoolYear)) throw new Error('Select a valid school year.');
  var sy = out.SchoolYear.split('-');
  if (Number(sy[1]) !== Number(sy[0]) + 1) throw new Error('Select a valid consecutive school year.');
  var allowedGrades = ['Nursery','Kinder 1','Kinder 2','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
  var gradeIndex = allowedGrades.indexOf(out.GradeLevel);
  if (gradeIndex < 0) throw new Error('Select a valid K–12 grade level.');
  var department = gradeIndex < 3 ? 'Preschool' : gradeIndex < 9 ? 'Elementary' : gradeIndex < 13 ? 'Junior High School' : 'Senior High School';
  out.Department = department;
  out.LRN = admissionDbValidateLrn_(out.LRN, true);
  if (!/^09\d{9}$/.test(out.Mobile)) throw new Error('Enter a valid 11-digit applicant mobile number.');
  out.Province = ''; // Province is intentionally not collected in the K–12 applicant form.
  if (!out.AddressLine1 || !out.Barangay || !out.City) throw new Error('Complete the applicant street address, barangay, and city / municipality.');
  if (!out.EmName || !out.EmRelation || !/^09\d{9}$/.test(out.EmMobile)) throw new Error('Complete the emergency contact name, relationship, and valid 11-digit mobile number.');
  if (out.EmSameAddr !== 'Yes' && !out.EmAddress) throw new Error('Provide the emergency contact address or confirm that it is the same as the applicant address.');
  ['FatherStatus','MotherStatus'].forEach(function (key) { if (out[key] && out[key] !== 'Alive' && out[key] !== 'Deceased') throw new Error('Select a valid parent status.'); });
  ['Father','Mother'].forEach(function (parent) {
    if (out[parent + 'Status'] === 'Deceased') {
      out[parent + 'Occupation'] = '';
      out[parent + 'Education'] = '';
      out[parent + 'Mobile'] = '';
      out[parent + 'Email'] = '';
    }
  });
  ['FatherMobile','MotherMobile'].forEach(function (key) { if (out[key] && !/^09\d{9}$/.test(out[key])) throw new Error('Enter a valid 11-digit ' + key.replace('Mobile','').toLowerCase() + ' mobile number.'); });
  ['FatherEmail','MotherEmail'].forEach(function (key) { if (out[key]) { out[key] = out[key].toLowerCase(); if (!admissionDbValidEmail_(out[key])) throw new Error('Enter a valid ' + key.replace('Email','').toLowerCase() + ' email address.'); } });
  var categories = ['PUB-QVR','TLC','REGULAR','ESC','TLC-OVAP','QVA PASSER','IS'];
  if (out.Category && categories.indexOf(out.Category) < 0) throw new Error('Select a valid admission category.');
  var shs = gradeIndex >= 13;
  var clusters = ['Science, Technology, Engineering, and Mathematics','Arts, Social Sciences, and Humanities','Business and Entrepreneurship','ICT Support and Computer Programming Technologies','Hospitality and Tourism'];
  if (shs && clusters.indexOf(out.Cluster) < 0) throw new Error('Select a Senior High School strand / cluster.');
  if (!shs) out.Cluster = '';
  if (out.PrevGrade && allowedGrades.indexOf(out.PrevGrade) < 0) throw new Error('Select a valid previous grade level.');
  if (out.PrevCluster && clusters.indexOf(out.PrevCluster) < 0) throw new Error('Select a valid previous SHS strand / cluster.');
  if (out.PrevGrade !== 'Grade 11' && out.PrevGrade !== 'Grade 12') out.PrevCluster = '';
  if (out.PrevSY && !/^20\d{2}-20\d{2}$/.test(out.PrevSY)) throw new Error('Enter a valid previous school year.');
  if (out.PrevSY) { var psy = out.PrevSY.split('-'); if (Number(psy[1]) !== Number(psy[0]) + 1) throw new Error('Select a valid consecutive previous school year.'); }
  if (out.PrivacyConsent !== 'Yes') throw new Error('You must agree to the Privacy Notice before submitting.');
  delete out.PrivacyConsent;

  // Applicants below 18 must provide a parent/legal guardian contact.
  var guardianValues = [out.GuardName, out.GuardRelation, out.GuardEmail, out.GuardMobile];
  var hasGuardianData = guardianValues.some(function (v) { return !!String(v || '').trim(); });
  if (Number(age) < 18) {
    out.GuardName = admissionDbCleanText_(out.GuardName, 80).toUpperCase();
    out.GuardRelation = admissionDbCleanText_(out.GuardRelation, 60).toUpperCase();
    out.GuardEmail = admissionDbCleanText_(out.GuardEmail, 254).toLowerCase();
    out.GuardMobile = admissionDbCleanText_(out.GuardMobile, 20);
    if (!out.GuardName || !out.GuardRelation) throw new Error('Parent / legal guardian name and relationship are required for applicants below 18.');
    if (!admissionDbValidName_(out.GuardName) || !admissionDbValidRelation_(out.GuardRelation)) {
      throw new Error('Guardian name and relationship may contain letters, spaces, periods, apostrophes and hyphens only.');
    }
    if (!admissionDbValidEmail_(out.GuardEmail)) throw new Error('Enter a valid parent / guardian email address.');
    if (out.GuardEmail === account.email.toLowerCase()) throw new Error('The parent / guardian email must be different from the applicant email.');
    if (!/^09\d{9}$/.test(out.GuardMobile)) throw new Error('Parent / guardian mobile number must be 11 digits.');
  } else if (hasGuardianData) {
    out.GuardName = admissionDbCleanText_(out.GuardName, 80).toUpperCase();
    out.GuardRelation = admissionDbCleanText_(out.GuardRelation, 60).toUpperCase();
    out.GuardEmail = admissionDbCleanText_(out.GuardEmail, 254).toLowerCase();
    out.GuardMobile = admissionDbCleanText_(out.GuardMobile, 20);
    if (!out.GuardName || !out.GuardRelation || !admissionDbValidName_(out.GuardName) ||
        !admissionDbValidRelation_(out.GuardRelation) || !admissionDbValidEmail_(out.GuardEmail) ||
        !/^09\d{9}$/.test(out.GuardMobile)) {
      throw new Error('Please complete all parent / guardian contact fields or leave them blank.');
    }
  }

  out.FullName = out.Surname + ', ' + out.FirstName + (out.MiddleName ? ' ' + out.MiddleName : '') + (out.Suffix ? ' ' + out.Suffix : '');
  out.Email = account.email;
  out.Classification = 'New';
  out.Age = age;
  out.EnrollStatus = 'Not Enrolled';
  out.ConsentAt = new Date().toISOString();

  // Requirement statuses are controlled by Admissions staff, never by browser-submitted values.
  ['ReqSF9', 'ReqF137', 'ReqBirth', 'ReqMoral', 'ReqJHS', 'ReqPhoto', 'ReqTransferee', 'ReqConsent', 'ReqEnvelope']
    .forEach(function (key) { out[key] = 'None'; });
  out.ReqRemarks = '';
  return out;
}

function admissionDbNewInternalStudentKey_(existingStudents) {
  var used = {};
  (existingStudents || []).forEach(function (r) { if (r.StudentID) used[r.StudentID] = true; });
  authAllUsers_().forEach(function (u) { if (u.studentId) used[u.studentId] = true; });
  admissionDbIdentifierRows_().forEach(function (r) { if (r.IdentifierValue) used[r.IdentifierValue] = true; });
  var key;
  do { key = 'STU-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24).toUpperCase(); }
  while (used[key]);
  return key;
}

function admissionDbNewOfficialStudentId_() {
  var year = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy');
  var identifiers = admissionDbIdentifierRows_(), students = admissionDbRows_(), candidate;
  do {
    candidate = 'MA-' + year + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  } while (identifiers.some(function (r) { return r.IdentifierValue === candidate; }) ||
           students.some(function (r) { return r.StudentID === candidate; }) ||
           authAllUsers_().some(function (u) { return u.studentId === candidate; }));
  return candidate;
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
    var insertedRow = 0, insertedIdentifierRow = 0, sh = null, studentId = '', officialStudentId = '';
    try {
      var current = authResolveSession_(token);
      if (!current || current.email !== account.email || current.role !== 'Applicant' || current.studentId) throw new Error('Your session or account status changed. Please sign in again.');
      sh = admissionDbSheet_();
      var existing = admissionDbRows_();
      if (existing.some(function (r) { return String(r.Email || '').toLowerCase() === account.email.toLowerCase(); })) throw new Error('An admission record already exists for this account.');
      if (existing.some(function (r) { return String(r.LRN || '') === record.LRN; })) throw new Error('An application with this LRN already exists. Please contact the Admissions Office if you believe this is an error.');
      var sameIdentity = existing.some(function (r) {
        return String(r.Surname || '').toUpperCase() === record.Surname &&
          String(r.FirstName || '').toUpperCase() === record.FirstName &&
          String(r.Birthdate || '') === record.Birthdate;
      });
      if (sameIdentity) throw new Error('A student record with the same name and birth date may already exist. Please contact the Admissions Office before submitting again.');
      studentId = admissionDbNewInternalStudentKey_(existing);
      officialStudentId = admissionDbNewOfficialStudentId_();
      var row = {};
      ADM_DB.HEADERS.forEach(function (h) { row[h] = ''; });
      row.StudentID = studentId;
      row.CreatedAt = new Date().toISOString();
      Object.keys(record).forEach(function (k) { row[k] = record[k]; });
      var values = [ADM_DB.HEADERS.map(function (h) { return row[h] == null ? '' : String(row[h]); })];
      insertedRow = sh.getLastRow() + 1;
      sh.getRange(insertedRow, 1, 1, ADM_DB.HEADERS.length).setNumberFormat('@').setValues(values);
      insertedIdentifierRow = admissionDbAppendIdentifierLocked_(studentId, officialStudentId, 'MA_STUDENT_ID', 'Initial official Moreh student identifier', account.email);
      authLinkStudentLocked_(account.email, studentId);
      admissionDbAudit_(account.email, 'application-created', studentId, 'Initial application record created');
    } catch (err) {
      if (insertedIdentifierRow) {
        var identifierSheet = authSpreadsheet_().getSheetByName(ADM_DB.IDENTIFIERS);
        if (identifierSheet) identifierSheet.deleteRow(insertedIdentifierRow);
      }
      if (insertedRow && sh) sh.deleteRow(insertedRow);
      throw err;
    } finally {
      lock.releaseLock();
    }
    return { success: true, message: 'Your application record has been created.', data: { studentId: officialStudentId, officialStudentId: officialStudentId } };
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
    record.OfficialStudentID = admissionDbDisplayIdentifier_(account.studentId);
    delete record.StudentID;
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