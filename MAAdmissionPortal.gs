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
    var rows = admissionDbRows_().filter(function (r) {
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
    admissionDbAudit_(actor.email, 'student-updated', r.StudentID, Object.keys(update).join(', '));
    var fresh = admissionDbFindById_(r.StudentID); delete fresh._row;
    return { success: true, message: 'Admission record saved.', data: fresh };
  } catch (err) {
    return authFail_(err.message || 'Could not save the admission record.');
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
  var rows = admissionDbRows_();
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
