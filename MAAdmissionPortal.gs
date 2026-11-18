/**
 * MAAdmissionPortal.gs
 *
 * Admission System integration layer for MA-Admission-Portal_New.
 * Uses the destination Auth/AdmissionDb foundations; it does not import the
 * Backup project's authentication or public Homepage implementation.
 */

function admissionPortalGetBootstrap(token) {
  try {
    var account = authRequireRole_(token, ['Applicant', 'Student', 'Encoder', 'Owner']);
    var data = {
      account: { email: account.email, role: account.role, studentId: account.studentId || '', fullName: account.fullName || '' },
      application: null,
      stats: null
    };
    if (['Applicant', 'Student'].indexOf(account.role) >= 0) {
      var mine = admissionGetMyApplication(token);
      if (!mine.success) return mine;
      data.application = mine.data;
    } else {
      data.stats = admissionPortalDashboard_(account.role);
    }
    return { success: true, message: 'Admission portal loaded.', data: data };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission portal.');
  }
}

function admissionPortalSearch(token, q, status, limit, grade, sy) {
  try {
    authRequireRole_(token, ['Encoder', 'Owner']);
    q = String(q == null ? '' : q).trim().toLowerCase();
    status = String(status == null ? '' : status).trim();
    grade = String(grade == null ? '' : grade).trim();
    sy = String(sy == null ? '' : sy).trim();
    limit = Math.max(1, Math.min(100, Number(limit || 25)));
    var rows = maAdmissionSpeedRecords_().filter(function (r) {
      if (status && r.EnrollStatus !== status) return false;
      if (grade && r.GradeLevel !== grade) return false;
      if (sy && r.SchoolYear !== sy) return false;
      if (!q) return true;
      return [r.StudentID, r.LRN, r.FullName, r.Surname, r.FirstName, r.Email, r.Section].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (a, b) { return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); });
    rows = rows.slice(0, limit).map(admissionPortalPublicRecord_);
    return { success: true, message: 'Students loaded.', data: rows };
  } catch (err) {
    return authFail_(err.message || 'Could not search admission records.');
  }
}

function admissionPortalGetStudent(token, studentId) {
  try {
    authRequireRole_(token, ['Encoder', 'Owner']);
    var r = admissionDbFindById_(studentId);
    if (!r) throw new Error('Admission record not found.');
    r.RequirementItems = admissionDbRequirementItems_(r);
    delete r._row;
    return { success: true, message: 'Admission record loaded.', data: r };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission record.');
  }
}

function admissionPortalSaveStudent(token, studentId, changes) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    var r = admissionDbFindById_(studentId);
    if (!r) throw new Error('Admission record not found.');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid record data.');

    var blocked = { StudentID: true, CreatedAt: true, FullName: true, Age: true, Email: true };
    ADM_DB.REQUIREMENTS.forEach(function (item) { blocked[item.statusKey] = true; blocked[item.key] = true; blocked[item.key + 'Date'] = true; });
    blocked.ReqRemarks = true;
    var update = {};
    Object.keys(changes).forEach(function (key) {
      if (blocked[key]) return;
      if (ADM_DB.HEADERS.indexOf(key) < 0) throw new Error('Unsupported admission field: ' + key);
      update[key] = admissionDbCleanText_(changes[key], 1000);
    });
    if (update.Birthdate) update.Age = admissionDbAge_(update.Birthdate);
    if (update.Surname || update.FirstName || update.MiddleName || update.Suffix) {
      var sn = update.Surname != null ? update.Surname : r.Surname;
      var fn = update.FirstName != null ? update.FirstName : r.FirstName;
      var mn = update.MiddleName != null ? update.MiddleName : r.MiddleName;
      var sx = update.Suffix != null ? update.Suffix : r.Suffix;
      if (!sn || !fn) throw new Error('Surname and first name are required.');
      update.FullName = String(sn).toUpperCase() + ', ' + String(fn).toUpperCase() + (mn ? ' ' + mn : '') + (sx ? ' ' + sx : '');
    }
    if (!Object.keys(update).length) return { success: true, message: 'No changes were supplied.', data: r };

    var sh = admissionDbSheet_();
    var row = r._row;
    Object.keys(update).forEach(function (key) {
      var col = ADM_DB.HEADERS.indexOf(key) + 1;
      sh.getRange(row, col).setNumberFormat('@').setValue(update[key]);
    });
    maAdmissionSpeedBump_();
    admissionDbAudit_(actor.email, 'student-updated', r.StudentID, Object.keys(update).join(', '));
    var fresh = admissionDbFindById_(r.StudentID); delete fresh._row;
    return { success: true, message: 'Admission record saved.', data: fresh };
  } catch (err) {
    return authFail_(err.message || 'Could not save the admission record.');
  }
}

/** Only Admission Personnel (Encoder / Owner) may update document verification statuses. */
function admissionPortalUpdateRequirementStatuses(token, studentId, changes) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid requirement status data.');
    var allowedStatuses = ['Pending Submission', 'Received', 'Verified', 'Incomplete'];
    var record = admissionDbFindById_(studentId);
    if (!record) throw new Error('Admission record not found.');
    var applicable = admissionDbRequirementItems_(record), allowedKeys = {};
    applicable.forEach(function (item) { allowedKeys[item.statusKey] = item; });
    var staged = [];
    Object.keys(changes).forEach(function (key) {
      if (!allowedKeys[key]) throw new Error('This document is not applicable to the learner.');
      var status = admissionDbCleanText_(changes[key], 40);
      if (allowedStatuses.indexOf(status) < 0) throw new Error('Invalid document status.');
      staged.push({ key: key, label: allowedKeys[key].label, status: status });
    });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    record = admissionDbFindById_(studentId);
    if (!record) throw new Error('Admission record not found.');
    var latestAllowed = {};
    admissionDbRequirementItems_(record).forEach(function (item) { latestAllowed[item.statusKey] = item; });
    staged.forEach(function (item) {
      if (!latestAllowed[item.key]) throw new Error('The learner requirements changed. Reload the record and try again.');
    });
    var updates = [];
    staged.forEach(function (item) {
      var oldStatus = String(record[item.key] || 'Pending Submission');
      if (oldStatus === item.status) return;
      var col = ADM_DB.HEADERS.indexOf(item.key) + 1;
      admissionDbSheet_().getRange(record._row, col).setNumberFormat('@').setValue(item.status);
      admissionDbAudit_(actor.email, 'requirement-status-updated', record.StudentID,
        item.label + ': ' + oldStatus + ' -> ' + item.status);
      updates.push(item.key);
    });
    if (updates.length) maAdmissionSpeedBump_();
    var fresh = admissionDbFindById_(record.StudentID);
    fresh.RequirementItems = admissionDbRequirementItems_(fresh);
    delete fresh._row;
    return { success: true, message: updates.length ? 'Document statuses updated and recorded.' : 'No document status changes were made.', data: fresh };
  } catch (err) {
    return authFail_(err.message || 'Could not update document statuses.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function admissionPortalDashboard(token) {
  try {
    var account = authRequireRole_(token, ['Encoder', 'Owner']);
    return { success: true, message: 'Dashboard loaded.', data: admissionPortalDashboard_(account.role) };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission dashboard.');
  }
}

function admissionPortalDashboard_(role) {
  var rows = maAdmissionSpeedRecords_();
  var byStatus = {}, byGrade = {}, byCategory = {};
  rows.forEach(function (r) {
    var s = r.EnrollStatus || 'Unspecified';
    var g = r.GradeLevel || 'Unspecified';
    var c = r.Category || 'Unspecified';
    byStatus[s] = (byStatus[s] || 0) + 1;
    byGrade[g] = (byGrade[g] || 0) + 1;
    byCategory[c] = (byCategory[c] || 0) + 1;
  });
  return { total: rows.length, byStatus: byStatus, byGrade: byGrade, byCategory: byCategory, role: role };
}

function admissionPortalPublicRecord_(r) {
  return {
    StudentID: r.StudentID, CreatedAt: r.CreatedAt, FullName: r.FullName,
    LRN: r.LRN, SchoolYear: r.SchoolYear, Category: r.Category,
    GradeLevel: r.GradeLevel, Department: r.Department, Cluster: r.Cluster,
    Section: r.Section, Email: r.Email, EnrollStatus: r.EnrollStatus,
    ProcessedBy: r.ProcessedBy, ProcessedDate: r.ProcessedDate,
    Requirements: {
      SF9: r.ReqSF9, F137: r.ReqF137, Birth: r.ReqBirth, Moral: r.ReqMoral,
      JHS: r.ReqJHS, Photo: r.ReqPhoto, Transferee: r.ReqTransferee,
      Consent: r.ReqConsent, Envelope: r.ReqEnvelope
    }
  };
}
