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
      try {
        data.stats = admissionPortalDashboard_(account.role);
        data.stats.holdsCount = admissionHoldsRows_().filter(function (h) { return h.Status === 'Active'; }).length;
      } catch (dashboardErr) {
        // Keep the Admissions workspace available with empty analytics if a dashboard
        // calculation fails; do not maintain a second, divergent dashboard implementation.
        console.error('Admission dashboard analytics failed: ' + (dashboardErr.message || dashboardErr));
        data.stats = {
          total: 0, byStatus: {}, byApplicationStatus: {}, byGrade: {}, byCategory: {},
          enrolledByGrade: {}, enrolledByCluster: {}, pipeline: {}, trend: [], trendSummary: {},
          recent: [], needsAction: [], needsActionTotal: 0, bySex: {}, byGender: {},
          byPreviousSchoolTop: [], byScholarship: {}, role: account.role,
          grades: ADM_DB.GRADES.slice(), activeSchoolYear: admissionDbActiveYear_(), holdsCount: 0,
          dashboardWarning: 'Detailed dashboard analytics are temporarily unavailable.'
        };
      }
    }
    return { success: true, message: 'Admission portal loaded.', data: data };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission portal.');
  }
}

function admissionPortalSearch(token, q, status, applicationStatus, limit, grade, sy) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    q = String(q == null ? '' : q).trim().toLowerCase();
    status = String(status == null ? '' : status).trim();
    applicationStatus = String(applicationStatus == null ? '' : applicationStatus).trim();
    grade = String(grade == null ? '' : grade).trim();
    sy = String(sy == null ? '' : sy).trim();
    limit = Number(limit); if (!isFinite(limit) || limit < 1) limit = 25; limit = Math.min(100, Math.floor(limit));
    var rows = maAdmissionSpeedRecords_().filter(function (r) {
      if (status && r.EnrollStatus !== status) return false;
      if (applicationStatus && String(r.ApplicationStatus || 'Submitted') !== applicationStatus) return false;
      if (grade && r.GradeLevel !== grade) return false;
      if (sy && r.SchoolYear !== sy) return false;
      if (!q) return true;
      return [r.StudentID, r.LRN, r.FullName, r.Surname, r.FirstName, r.Email, r.Section].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (a, b) { return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); });
    rows = rows.slice(0, limit).map(function (r) { return admissionPortalPublicRecord_(r, actor.role); });
    return { success: true, message: 'Students loaded.', data: rows };
  } catch (err) {
    return authFail_(err.message || 'Could not search admission records.');
  }
}

function admissionPortalGetStudent(token, studentId) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    var r = admissionDbFindById_(studentId);
    if (!r) throw new Error('Admission record not found.');
    r.RequirementItems = admissionDbRequirementItems_(r);
    if (actor.role === 'Encoder') admissionPortalRestrictEncoderRecord_(r);
    delete r._row;
    return { success: true, message: 'Admission record loaded.', data: r };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission record.');
  }
}

function admissionPortalSaveStudent(token, studentId, changes) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid record data.');

    var blocked = { StudentID: true, CreatedAt: true, FullName: true, Age: true, Email: true, ConsentAt: true, ApplicationStatus: true, EnrollStatus: true,
      StatusChangedAt: true, TempUntil: true, TempBy: true, TempReason: true, CancelDate: true, CancelReason: true, CancelReasonOther: true };
    ADM_DB.REQUIREMENTS.forEach(function (item) { blocked[item.statusKey] = true; blocked[item.key] = true; blocked[item.key + 'Date'] = true; });
    blocked.ReqRemarks = true;
    // ID number / photo / claimed ID have their own validated workflow (AdmissionIdCard.gs); IDPhotoID is a Drive file id and must never be staff-editable.
    blocked.IDNumber = true; blocked.IDPhotoID = true; blocked.ClaimedIDNumber = true;
    if (actor.role === 'Encoder') {
      ['Category','PrevScholarship','EscCertNo','VoucherCertNo','EscSchoolNo','CertNo',
       'SexualOrient','GenderOrient','Religion','ReligionOther','Birthdate','BirthPlace','Age',
       'FatherReligion','FatherReligionOther','MotherReligion','MotherReligionOther',
       'RelBirthdate','RelAge','RelSex','RelGender','RelGenderOther','RelReligion','RelReligionOther',
       'ReqConsent','ReqConsentStatus','ReqConsentDate','ConsentAt'].forEach(function (key) { blocked[key] = true; });
    }
    var update = {};
    Object.keys(changes).forEach(function (key) {
      if (blocked[key]) return;
      if (ADM_DB.HEADERS.indexOf(key) < 0) throw new Error('Unsupported admission field: ' + key);
      update[key] = admissionDbCleanText_(changes[key], 1000);
    });
    if (update.GradeLevel != null && ADM_DB.GRADES.indexOf(update.GradeLevel) < 0) throw new Error('Unsupported grade level: ' + update.GradeLevel);
    if (update.EnrollStatus != null) update.EnrollStatus = admissionDbOneOf_(update.EnrollStatus, ADM_DB.ENROLL_STATUSES, 'enrollment status');
    if (update.ApplicationStatus != null) update.ApplicationStatus = admissionDbOneOf_(update.ApplicationStatus, ADM_DB.APPLICATION_STATUSES, 'application status');
    if (update.Surname != null) update.Surname = String(update.Surname).toUpperCase();
    if (update.FirstName != null) update.FirstName = String(update.FirstName).toUpperCase();
    if (update.MiddleName != null) update.MiddleName = String(update.MiddleName).toUpperCase();
    if (update.Suffix != null) update.Suffix = String(update.Suffix).toUpperCase();
    if (update.LRN && !/^[1-5]\d{11}$/.test(update.LRN)) throw new Error('LRN must be 12 digits and start with 1, 2, 3, 4 or 5.');
    if (update.Mobile && !/^09\d{9}$/.test(update.Mobile)) throw new Error('Enter a valid 11-digit mobile number.');
    if (update.Birthdate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(update.Birthdate) || !admissionDbAge_(update.Birthdate)) throw new Error('Enter a valid birth date.');
      update.Age = admissionDbAge_(update.Birthdate);
    }

    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    var r = admissionDbFindById_(studentId);
    if (!r) throw new Error('Admission record not found.');
    // Identity fields are locked once the learner is enrolled. Unchanged values are tolerated (the form may resend the whole record).
    if (r.EnrollStatus === 'Enrolled') {
      ['LRN','Surname','FirstName','MiddleName','Suffix','Birthdate','SexualOrient','GenderOrient'].forEach(function (k) {
        if (update[k] != null && String(update[k]) !== String(r[k] || '')) throw new Error('Identity fields are locked after enrollment.');
      });
    }
    // A category that is being changed must be one of the official names; an unchanged legacy value is tolerated.
    if (update.PrevScholarship != null) update.PrevScholarship = (update.PrevScholarship === r.PrevScholarship) ? admissionDbCategoryLoose_(update.PrevScholarship) : admissionDbCategory_(update.PrevScholarship);
    if (update.Category != null) update.Category = (update.Category === r.Category) ? admissionDbCategoryLoose_(update.Category) : admissionDbCategory_(update.Category);
    if (update.LRN && admissionDbRows_().some(function (x) { return x.LRN === update.LRN && x.StudentID !== r.StudentID; })) {
      throw new Error('Another admission record already uses this LRN.');
    }
    if (update.Surname || update.FirstName || update.MiddleName || update.Suffix) {
      var sn = update.Surname != null ? update.Surname : r.Surname;
      var fn = update.FirstName != null ? update.FirstName : r.FirstName;
      var mn = update.MiddleName != null ? update.MiddleName : r.MiddleName;
      var sx = update.Suffix != null ? update.Suffix : r.Suffix;
      if (!sn || !fn) throw new Error('Surname and first name are required.');
      update.FullName = String(sn).toUpperCase() + ', ' + String(fn).toUpperCase() + (mn ? ' ' + String(mn).toUpperCase() : '') + (sx ? ' ' + String(sx).toUpperCase() : '');
    }
    if (!Object.keys(update).length) { delete r._row; return { success: true, message: 'No changes were supplied.', data: r }; }

    var sh = admissionDbSheet_(), range = sh.getRange(r._row, 1, 1, ADM_DB.HEADERS.length), vals = range.getValues();
    Object.keys(update).forEach(function (key) { vals[0][ADM_DB.HEADERS.indexOf(key)] = update[key]; });
    range.setNumberFormat('@').setValues(vals);   // one write; text format keeps "=..." from becoming a formula
    maAdmissionSpeedBump_();
    admissionDbAudit_(actor.email, 'student-updated', r.StudentID, Object.keys(update).join(', '));
    var fresh = admissionDbFindById_(r.StudentID); delete fresh._row;
    return { success: true, message: 'Admission record saved.', data: fresh };
  } catch (err) {
    return authFail_(err.message || 'Could not save the admission record.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
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
    applicable.forEach(function (item) {
      if (actor.role === 'Encoder' && item.key === 'ReqConsent') return;
      allowedKeys[item.statusKey] = item;
    });
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


/**
 * Sets ApplicationStatus and/or EnrollStatus through the controlled admission workflow.
 * Accepts one update object or an array of up to 500 update objects:
 * {StudentID, ApplicationStatus?, EnrollStatus?, Reason?, TempUntil?, TempReason?, CancelReason?, CancelReasonOther?, CancelDate?}
 *
 * Application approval promotes the linked Applicant account to Student and bumps its token version.
 * Enrolled/Temporary are only available after ApplicationStatus=Approved.
 */
function admissionPortalSetStatus(token, updates) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    if (!updates) throw new Error('No status changes were supplied.');
    if (!Array.isArray(updates)) updates = [updates];
    if (!updates.length || updates.length > 500) throw new Error('Submit between 1 and 500 status changes.');

    var normalized = updates.map(function (u) {
      u = u || {};
      var item = {
        StudentID: String(u.StudentID || '').trim(),
        ApplicationStatus: u.ApplicationStatus == null ? '' : String(u.ApplicationStatus).trim(),
        EnrollStatus: u.EnrollStatus == null ? '' : String(u.EnrollStatus).trim(),
        Reason: String(u.Reason || '').trim().slice(0, 200),
        TempUntil: String(u.TempUntil || '').trim(),
        TempReason: String(u.TempReason || '').trim().slice(0, 200),
        CancelReason: String(u.CancelReason || '').trim().slice(0, 200),
        CancelReasonOther: String(u.CancelReasonOther || '').trim().slice(0, 200),
        CancelDate: String(u.CancelDate || '').trim()
      };
      if (!item.StudentID) throw new Error('StudentID is required for every status change.');
      if (!item.ApplicationStatus && !item.EnrollStatus) throw new Error('Specify an application or enrollment status.');
      if (item.ApplicationStatus && ADM_DB.APPLICATION_STATUSES.indexOf(item.ApplicationStatus) < 0) throw new Error('Unsupported application status: ' + item.ApplicationStatus);
      if (item.EnrollStatus && ADM_DB.ENROLL_STATUSES.indexOf(item.EnrollStatus) < 0) throw new Error('Unsupported enrollment status: ' + item.EnrollStatus);
      return item;
    });

    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');

    var today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
    var plan = [], seen = {};

    // PASS 1 - validate EVERYTHING (records, status rules, linked accounts) and write NOTHING.
    // A bad item now rejects the whole batch instead of leaving it half-applied.
    normalized.forEach(function (item) {
      if (seen[item.StudentID]) throw new Error('StudentID appears more than once in this batch: ' + item.StudentID);
      seen[item.StudentID] = true;
      var r = admissionDbFindById_(item.StudentID);
      if (!r) throw new Error('Admission record not found: ' + item.StudentID);

      var oldApp = String(r.ApplicationStatus || 'Submitted');
      var oldEnroll = String(r.EnrollStatus || 'Not Enrolled');
      var newApp = item.ApplicationStatus || oldApp;
      var newEnroll = item.EnrollStatus || oldEnroll;

      if (newEnroll === 'Enrolled' || newEnroll === 'Temporary') {
        if (newApp !== 'Approved') throw new Error('Learner ' + item.StudentID + ' must be Approved before being marked ' + newEnroll + '.');
      }
      if (newApp === 'Declined' && ['Enrolled','Temporary'].indexOf(newEnroll) >= 0) {
        throw new Error('A Declined applicant cannot be enrolled.');
      }

      if (newEnroll === 'Temporary') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.TempUntil)) throw new Error('Temporary enrollment requires an end date.');
        if (item.TempUntil <= today) throw new Error('The temporary enrollment end date must be in the future.');
        var max = new Date();
        max.setDate(max.getDate() + ADM_DB.TEMP_MAX_DAYS);
        var maxDate = Utilities.formatDate(max, 'Asia/Manila', 'yyyy-MM-dd');
        if (item.TempUntil > maxDate) throw new Error('Temporary enrollment can be at most ' + ADM_DB.TEMP_MAX_DAYS + ' days.');
        var why = item.TempReason || String(r.TempReason || '').trim();
        if (!why) throw new Error('Temporary enrollment requires a reason.');
        item.TempReason = why;
      }
      if (['Cancelled','Transferred','Transferred Out'].indexOf(newEnroll) >= 0) {
        var cancelWhy = item.CancelReason || String(r.CancelReason || '').trim() || item.Reason;
        if (!cancelWhy) throw new Error(newEnroll + ' requires a reason.');
        item.CancelReason = cancelWhy;
        item.CancelDate = item.CancelDate || String(r.CancelDate || '').trim() || today;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.CancelDate)) throw new Error('The cancellation / transfer date is invalid.');
        if (item.CancelReason === 'Other' && !item.CancelReasonOther && !r.CancelReasonOther) {
          throw new Error('Please specify the other cancellation / transfer reason.');
        }
      }

      var updatesMap = {};
      if (newApp !== oldApp) updatesMap.ApplicationStatus = newApp;
      if (newEnroll !== oldEnroll) updatesMap.EnrollStatus = newEnroll;
      if (newEnroll === 'Temporary') {
        updatesMap.TempUntil = item.TempUntil;
        updatesMap.TempReason = item.TempReason;
      } else if (oldEnroll === 'Temporary') {
        updatesMap.TempUntil = '';
        updatesMap.TempBy = '';
        updatesMap.TempReason = '';
      }
      if (['Cancelled','Transferred','Transferred Out'].indexOf(newEnroll) >= 0) {
        updatesMap.CancelReason = item.CancelReason;
        updatesMap.CancelDate = item.CancelDate;
        if (item.CancelReasonOther) updatesMap.CancelReasonOther = item.CancelReasonOther;
      } else if (newEnroll !== oldEnroll && ['Cancelled','Transferred','Transferred Out'].indexOf(oldEnroll) >= 0) {
        updatesMap.CancelReason = '';
        updatesMap.CancelDate = '';
        updatesMap.CancelReasonOther = '';
      }
      if (newEnroll !== oldEnroll || newApp !== oldApp) updatesMap.StatusChangedAt = new Date().toISOString();
      if (newEnroll === 'Temporary' && newEnroll !== oldEnroll) updatesMap.TempBy = actor.email;

      // Linked-account effect, decided and validated now so it cannot fail after sheet writes have started.
      var account = '';   // '' | 'promote' | 'demote'
      var email = String(r.Email || '').trim().toLowerCase();
      if (newApp === 'Approved') {
        var acct = email ? authFindUser_(email) : null;
        if (oldApp !== 'Approved') {
          if (!email) throw new Error('Approved learner has no linked account email.');
          if (!acct) throw new Error('The applicant account for ' + item.StudentID + ' could not be found.');
          if (acct.status !== 'Active') throw new Error('The applicant account for ' + item.StudentID + ' is not active.');
          if (['Applicant', 'Student'].indexOf(acct.role) < 0) throw new Error('The account for ' + item.StudentID + ' is not an applicant or student account.');
          if (acct.studentId && acct.studentId !== r.StudentID) throw new Error('The account for ' + item.StudentID + ' is linked to a different StudentID.');
        }
        // Also heals a record that was approved earlier but whose account was never promoted.
        if (acct && acct.status === 'Active' && acct.role === 'Applicant' && (!acct.studentId || acct.studentId === r.StudentID)) account = 'promote';
      } else if (oldApp === 'Approved' && email) {
        var cur = authFindUser_(email);
        if (cur && cur.role === 'Student' && cur.studentId === r.StudentID) account = 'demote';
      }

      plan.push({ item: item, r: r, oldApp: oldApp, newApp: newApp, oldEnroll: oldEnroll, newEnroll: newEnroll,
                  updatesMap: updatesMap, account: account, email: email });
    });

    // PASS 2 - apply. Per learner: account change first, then the sheet, so a learner is never left half-changed.
    var changed = [], sh = admissionDbSheet_();
    plan.forEach(function (x) {
      if (x.account === 'promote') authPromoteApplicantToStudentLocked_(x.email, x.r.StudentID);
      else if (x.account === 'demote') authDemoteStudentLocked_(x.email, x.r.StudentID);

      if (Object.keys(x.updatesMap).length) {
        var vals = sh.getRange(x.r._row, 1, 1, ADM_DB.HEADERS.length).getValues();
        Object.keys(x.updatesMap).forEach(function (k) {
          vals[0][ADM_DB.HEADERS.indexOf(k)] = x.updatesMap[k];
        });
        sh.getRange(x.r._row, 1, 1, ADM_DB.HEADERS.length).setNumberFormat('@').setValues(vals);

        var log = admissionDbEnsureStatusLogSheet_();
        log.getRange(log.getLastRow() + 1, 1, 1, ADM_DB.STATUS_LOG_HEADERS.length).setNumberFormat('@').setValues([[
          new Date().toISOString(), actor.email, x.r.StudentID, x.oldApp, x.newApp, x.oldEnroll, x.newEnroll,
          x.item.Reason || x.item.TempReason || x.item.CancelReason || ''
        ]]);
        admissionDbAudit_(actor.email, 'status-changed', x.r.StudentID,
          'ApplicationStatus: ' + x.oldApp + ' -> ' + x.newApp + '; EnrollStatus: ' + x.oldEnroll + ' -> ' + x.newEnroll);
        changed.push(x.r.StudentID);
      }
    });
    if (changed.length || plan.some(function (x) { return x.account; })) maAdmissionSpeedBump_();

    return {
      success: true,
      message: changed.length + ' status change' + (changed.length === 1 ? '' : 's') + ' saved.',
      data: { changed: changed }
    };
  } catch (err) {
    return authFail_(err.message || 'Could not update admission status.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/**
 * Temporary enrollment expiry. Moves 'Temporary' learners whose TempUntil date has passed back to 'Not Enrolled'
 * and records it in the status log. Idempotent and safe if called by anyone (runs at most once an hour).
 * Install the daily trigger once from the editor with admissionInstallTempExpiryTrigger().
 */
function admissionExpireTemporaryEnrollments() {
  var cache = CacheService.getScriptCache();
  if (cache.get('adm_temp_expiry_ran')) return;
  cache.put('adm_temp_expiry_ran', '1', 3600);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = admissionDbSheet_(), rows = admissionDbRows_(), n = 0, now = new Date().toISOString();
    var today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd'), log = null;
    rows.forEach(function (r) {
      if (r.EnrollStatus !== 'Temporary') return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.TempUntil) || r.TempUntil >= today) return;
      var range = sh.getRange(r._row, 1, 1, ADM_DB.HEADERS.length), vals = range.getValues();
      var set = { EnrollStatus: 'Not Enrolled', TempUntil: '', TempBy: '', TempReason: '', StatusChangedAt: now };
      Object.keys(set).forEach(function (k) { vals[0][ADM_DB.HEADERS.indexOf(k)] = set[k]; });
      range.setNumberFormat('@').setValues(vals);
      log = log || admissionDbEnsureStatusLogSheet_();
      log.getRange(log.getLastRow() + 1, 1, 1, ADM_DB.STATUS_LOG_HEADERS.length).setNumberFormat('@').setValues([[
        now, 'system', r.StudentID, r.ApplicationStatus || 'Submitted', r.ApplicationStatus || 'Submitted', 'Temporary', 'Not Enrolled',
        'Temporary enrollment expired on ' + r.TempUntil
      ]]);
      n++;
    });
    if (n) { maAdmissionSpeedBump_(); admissionDbAudit_('system', 'temp-enrollment-expired', '', n + ' learner(s)'); }
  } finally { lock.releaseLock(); }
}

/** Run ONCE from the Apps Script editor: installs the daily trigger for admissionExpireTemporaryEnrollments. */
function admissionInstallTempExpiryTrigger() {
  authRequireEditor_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'admissionExpireTemporaryEnrollments') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('admissionExpireTemporaryEnrollments').timeBased().everyDays(1).atHour(1).create();
  Logger.log('Daily temporary-enrollment expiry trigger installed.');
}

/** Creates the status-log sheet lazily when the deployment has not run the schema setup yet. */
function admissionDbEnsureStatusLogSheet_() {
  var ss = authSpreadsheet_();
  var sh = ss.getSheetByName(ADM_DB.STATUS_LOG);
  if (!sh) {
    sh = ss.insertSheet(ADM_DB.STATUS_LOG);
    sh.getRange(1, 1, 1, ADM_DB.STATUS_LOG_HEADERS.length).setValues([ADM_DB.STATUS_LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function admissionPortalReport(token, reportType, reportValue) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    reportType = String(reportType || 'Grade Level').trim();
    if (actor.role === 'Encoder' && ['Admission Category', 'Sex', 'Gender', 'Previous Scholarship'].indexOf(reportType) >= 0) throw new Error('This report contains restricted category or demographic information.');
    reportValue = String(reportValue || '').trim();
    var rows = admissionDbRows_();
    var groups = {};
    var reportDimensions = ['Grade Level','Admission Category','Enrollment Status','Application Status','Previous School',
      'Sex','Gender','Previous Scholarship','Classification','Cluster','Section'];
    if (reportDimensions.indexOf(reportType) < 0) throw new Error('Invalid report dimension.');
    function keyFor(r) { return admissionDimension_(r, reportType); }
    if (reportValue) rows = rows.filter(function(r){ return keyFor(r).toLowerCase() === reportValue.toLowerCase(); });
    rows.forEach(function(r){
      var key=keyFor(r);
      if(!groups[key]) groups[key]={Group:key,Total:0,Enrolled:0,NotEnrolled:0,Temporary:0,Transferred:0,Cancelled:0,Submitted:0,UnderReview:0,Approved:0,Declined:0};
      var g=groups[key]; g.Total++;
      var es=String(r.EnrollStatus||'Not Enrolled');
      if(es==='Enrolled')g.Enrolled++;else if(es==='Temporary')g.Temporary++;else if(es==='Transferred')g.Transferred++;else if(es==='Cancelled')g.Cancelled++;else g.NotEnrolled++;
      var as=String(r.ApplicationStatus||'Submitted');
      if(as==='Under Review')g.UnderReview++;else if(as==='Approved')g.Approved++;else if(as==='Declined')g.Declined++;else g.Submitted++;
    });
    var reports=Object.keys(groups).sort(function(a,b){return a.localeCompare(b);}).map(function(k){return groups[k];});
    var values=Object.keys(groups).sort(function(a,b){return a.localeCompare(b);});
    return {success:true,message:'Report loaded.',data:{reportType:reportType,selectedValue:reportValue,values:values,reports:reports}};
  } catch(err) { return authFail_(err.message || 'Could not load the report.'); }
}




function admissionPortalSpecializedReport(token, reportType, gradeLevel, section) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    reportType = String(reportType || 'Admission Daily').trim();
    if (actor.role === 'Encoder' && ['Demographic', 'No Parental Consent', 'Scholarship Beneficiaries', 'Scholarship by Grade', 'Personal Data'].indexOf(reportType) >= 0) throw new Error('This report contains restricted demographic, scholarship, or consent information.');
    gradeLevel = String(gradeLevel || '').trim();
    section = String(section || '').trim();

    var rows = admissionDbRows_().filter(function(r) {
      if (gradeLevel && String(r.GradeLevel || '').trim() !== gradeLevel) return false;
      if (section === '(none)' && String(r.Section || '').trim() !== '') return false;
      if (section && section !== '(none)' && String(r.Section || '').trim() !== section) return false;
      return true;
    });

    function active(r) {
      var es = String(r.EnrollStatus || 'Not Enrolled');
      return es !== 'Cancelled' && es !== 'Transferred' && es !== 'Transferred Out';
    }
    function count(list, fn) {
      return list.filter(fn).length;
    }
    function pct(a, b) {
      return b ? (Math.round((a / b) * 1000) / 10).toFixed(1) + '%' : '0.0%';
    }
    function groupBy(list, keyFn) {
      var map = {};
      list.forEach(function(r) {
        var key = String(keyFn(r) || 'Unspecified').trim() || 'Unspecified';
        if (!map[key]) map[key] = [];
        map[key].push(r);
      });
      return map;
    }

    var title = reportType;
    var columns = [];
    var dataRows = [];
    var summary = {};

    if (reportType === 'Admission Daily') {
      var dayMap = groupBy(rows, function(r) {
        return String(r.CreatedAt || '').slice(0, 10) || 'Unknown';
      });
      Object.keys(dayMap).sort(function(a,b){ return b.localeCompare(a); }).forEach(function(day) {
        var x = dayMap[day];
        dataRows.push([day, x.length, count(x, function(r){return active(r);}), count(x, function(r){return r.EnrollStatus === 'Enrolled';})]);
      });
      columns = ['Date', 'Registrations', 'Active', 'Enrolled'];
      title = 'ADMISSION DAILY REPORT';
      summary = { Total: rows.length, Active: count(rows, active), Enrolled: count(rows, function(r){return r.EnrollStatus === 'Enrolled';}) };
    } else if (reportType === 'School Overview') {
      var groups = {};
      rows.forEach(function(r) {
        var g = String(r.GradeLevel || 'Unspecified');
        if (!groups[g]) groups[g] = [];
        groups[g].push(r);
      });
      Object.keys(groups).sort(function(a,b){return a.localeCompare(b);}).forEach(function(g) {
        var x = groups[g], enrolled = count(x, function(r){return r.EnrollStatus === 'Enrolled';});
        dataRows.push([g, x.length, enrolled, count(x, function(r){return r.EnrollStatus === 'Not Enrolled';}), count(x, function(r){return r.EnrollStatus === 'Cancelled';}), count(x, function(r){return r.EnrollStatus === 'Transferred' || r.EnrollStatus === 'Transferred Out';}), pct(enrolled, x.length)]);
      });
      columns = ['Grade Level', 'Applicants', 'Enrolled', 'Not Enrolled', 'Cancelled', 'Transferred', 'Conversion Rate'];
      title = 'SCHOOL OVERVIEW / ADMISSION CONVERSION';
      summary = { Total: rows.length, Enrolled: count(rows, function(r){return r.EnrollStatus === 'Enrolled';}), ConversionRate: pct(count(rows, function(r){return r.EnrollStatus === 'Enrolled';}), rows.length) };
    } else if (reportType === 'Previous School') {
      var schoolMap = groupBy(rows, function(r){ return r.PrevSchool || '(NONE)'; });
      Object.keys(schoolMap).sort(function(a,b){
        return schoolMap[b].length - schoolMap[a].length || a.localeCompare(b);
      }).forEach(function(k) {
        var x = schoolMap[k], e = count(x, function(r){return r.EnrollStatus === 'Enrolled';});
        dataRows.push([k, x.length, e, pct(e, x.length)]);
      });
      columns = ['Previous School', 'Applicants', 'Enrolled', 'Conversion Rate'];
      title = 'PER PREVIOUS SCHOOL REPORT';
      summary = { Schools: Object.keys(schoolMap).length, Total: rows.length };
    } else if (reportType === 'Demographic') {
      var sex = groupBy(rows.filter(active), function(r){ return r.SexualOrient || 'Not specified'; });
      Object.keys(sex).sort(function(a,b){return sex[b].length-sex[a].length || a.localeCompare(b);}).forEach(function(k){ dataRows.push(['Sex', k, sex[k].length]); });
      var gender = groupBy(rows.filter(active), function(r){ return r.GenderOrient || 'Not specified'; });
      Object.keys(gender).sort(function(a,b){return gender[b].length-gender[a].length || a.localeCompare(b);}).forEach(function(k){ dataRows.push(['Gender', k, gender[k].length]); });
      var religion = groupBy(rows.filter(active), function(r){ return r.Religion === 'Others, specify' ? ('OTHERS: ' + (r.ReligionOther || '')) : (r.Religion || 'Not specified'); });
      Object.keys(religion).sort(function(a,b){return religion[b].length-religion[a].length || a.localeCompare(b);}).forEach(function(k){ dataRows.push(['Religion', k, religion[k].length]); });
      columns = ['Dimension', 'Value', 'Students'];
      title = 'DEMOGRAPHIC REPORT';
      summary = { ActiveLearners: rows.filter(active).length };
    } else if (reportType === 'Requirements Status') {
      var reqMap = {};
      rows.forEach(function(r) {
        admissionDbRequirementItems_(r).forEach(function(item) {
          if (actor.role === 'Encoder' && item.key === 'ReqConsent') return;
          var key = item.label || item.statusKey;
          if (!reqMap[key]) reqMap[key] = { required: 0, pending: 0, received: 0, verified: 0, incomplete: 0 };
          reqMap[key].required++;
          var st = String(item.status || 'Pending Submission');
          if (st === 'Received') reqMap[key].received++;
          else if (st === 'Verified') reqMap[key].verified++;
          else if (st === 'Incomplete') reqMap[key].incomplete++;
          else reqMap[key].pending++;
        });
      });
      Object.keys(reqMap).sort().forEach(function(k) {
        var q = reqMap[k];
        dataRows.push([k, q.required, q.pending, q.received, q.verified, q.incomplete]);
      });
      columns = ['Requirement', 'Applicable Learners', 'Pending Submission', 'Received', 'Verified', 'Incomplete'];
      title = 'REQUIREMENTS STATUS REPORT';
      summary = { Requirements: Object.keys(reqMap).length, ApplicableLearners: rows.length };
    } else if (reportType === 'Scholarship Beneficiaries') {
      var cat = groupBy(rows.filter(active), function(r){ return r.Category || 'Not set'; });
      Object.keys(cat).sort(function(a,b){return cat[b].length-cat[a].length || a.localeCompare(b);}).forEach(function(k) {
        dataRows.push([k, cat[k].length, pct(cat[k].length, rows.filter(active).length)]);
      });
      columns = ['Scholarship / Category', 'Students', 'Share'];
      title = 'SCHOLARSHIP BENEFICIARIES REPORT';
      summary = { ActiveLearners: rows.filter(active).length, Beneficiaries: rows.filter(active).filter(function(r){return String(r.Category||'').toUpperCase() !== 'REGULAR';}).length };
    } else if (reportType === 'Scholarship by Grade') {
      var grades = ADM_DB.GRADES;
      var categories = ADM_DB.CATEGORIES;
      var pop = rows.filter(active);
      grades.forEach(function(g) {
        var x = pop.filter(function(r){return r.GradeLevel===g;});
        if (!x.length) return;
        dataRows.push([g].concat(categories.map(function(cat){return count(x,function(r){return admissionDbCategoryLoose_(r.Category).toUpperCase()===cat.toUpperCase();});}),[x.length]));
      });
      dataRows.push(['TOTAL'].concat(categories.map(function(cat){return count(pop,function(r){return admissionDbCategoryLoose_(r.Category).toUpperCase()===cat.toUpperCase();});}),[pop.length]));
      columns = ['Grade Level'].concat(categories,['Total Students']);
      title = 'SCHOLARSHIP BENEFICIARIES BY GRADE LEVEL';
      summary = { ActiveLearners: pop.length, ScholarshipCategories: categories.length };
    } else if (reportType === 'No Parental Consent') {
      var missingConsent = rows.filter(function(r) {
        return active(r) && String(r.ReqConsent || '') !== 'Original' && String(r.ReqConsentStatus || '') !== 'Verified';
      }).sort(function(a,b){return String(a.FullName||'').localeCompare(String(b.FullName||''));});
      dataRows = missingConsent.map(function(r){return [r.StudentID,r.FullName,r.GradeLevel,r.Section,r.EnrollStatus||'Not Enrolled',r.ApplicationStatus||'Submitted'];});
      columns = ['Student ID','Learner','Grade Level','Section','Enrollment Status','Application Status'];
      title = 'LEARNERS WITHOUT PARENTAL CONSENT';
      summary = { MissingConsent: missingConsent.length, ActiveLearners: rows.filter(active).length };
    } else if (reportType === 'Advisory Class') {
      var ax = rows.filter(active).slice().sort(function(a,b){return String(a.FullName||'').localeCompare(String(b.FullName||''));});
      dataRows = ax.map(function(r){ return [r.StudentID, r.FullName, r.GradeLevel, r.Section, r.Category, r.EnrollStatus || 'Not Enrolled']; });
      columns = ['Student ID', 'Learner', 'Grade Level', 'Section', 'Category', 'Enrollment Status'];
      title = 'ADVISORY CLASS REPORT';
      summary = { Students: ax.length };
    } else if (reportType === 'Personal Data') {
      var px = rows.slice().sort(function(a,b){return String(a.FullName||'').localeCompare(String(b.FullName||''));});
      dataRows = px.map(function(r){
        return [r.StudentID, r.FullName, r.LRN, r.GradeLevel, r.Section, r.Birthdate, r.SexualOrient, r.Religion === 'Others, specify' ? (r.ReligionOther || 'Others') : (r.Religion || ''), r.Mobile];
      });
      columns = ['Student ID', 'Full Name', 'LRN', 'Grade Level', 'Section', 'Birth Date', 'Sex', 'Religion', 'Mobile'];
      title = "LEARNER'S PERSONAL DATA REPORT";
      summary = { Students: px.length };
    } else {
      throw new Error('Invalid specialized report type.');
    }

    if (actor.role === 'Encoder' && reportType === 'Advisory Class') {
      columns = columns.filter(function (column) { return column !== 'Category'; });
      dataRows = dataRows.map(function (row) { return row.filter(function (value, index) { return index !== 4; }); });
    }
    return {
      success: true,
      message: 'Specialized report loaded.',
      data: { reportType: reportType, title: title, columns: columns, rows: dataRows, summary: summary }
    };
  } catch (err) {
    return authFail_(err.message || 'Could not load the specialized report.');
  }
}

function admissionPortalDetailedStudentReport(token, reportType, reportValue) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    if (actor.role === 'Encoder' && ['Admission Category', 'Sex', 'Gender', 'Previous Scholarship'].indexOf(String(reportType || '').trim()) >= 0) throw new Error('This report contains restricted category or demographic information.');
    var allowed = {
      'Grade Level': 'GradeLevel',
      'Admission Category': 'Category',
      'Enrollment Status': 'EnrollStatus',
      'Application Status': 'ApplicationStatus',
      'Previous School': 'PrevSchool',
      'Classification': 'Classification',
      'Cluster': 'Cluster',
      'Section': 'Section',
      'Sex': 'SexualOrient',
      'Gender': 'GenderOrient',
      'Previous Scholarship': 'PrevScholarship'
    };
    reportType = String(reportType || 'Grade Level').trim();
    reportValue = String(reportValue || '').trim();
    if (!allowed[reportType]) throw new Error('Invalid detailed report dimension.');

    var rows = admissionDbRows_();
    function admissionPortalReportValueFor_(r) {
      return admissionDimension_(r, reportType);
    }
    if (reportValue) {
      rows = rows.filter(function(r) {
        return admissionPortalReportValueFor_(r).toLowerCase() === reportValue.toLowerCase();
      });
    }
    rows.sort(function(a,b) {
      return String(a.FullName || '').localeCompare(String(b.FullName || ''));
    });

    var students = rows.map(function(r) {
      return {
        StudentID: r.StudentID || '',
        FullName: r.FullName || '',
        GradeLevel: r.GradeLevel || '',
        Cluster: r.Cluster || '',
        Section: r.Section || '',
        Category: actor.role === 'Owner' ? (r.Category || '') : '',
        Classification: r.Classification || '',
        PreviousSchool: r.PrevSchool || '',
        PreviousSection: r.PrevSection || '',
        PreviousAdviser: r.PrevAdviser || '',
        ApplicationStatus: r.ApplicationStatus || 'Submitted',
        EnrollStatus: r.EnrollStatus || 'Not Enrolled'
      };
    });
    return {
      success: true,
      message: 'Detailed student report loaded.',
      data: { reportType: reportType, selectedValue: reportValue, students: students }
    };
  } catch (err) {
    return authFail_(err.message || 'Could not load the detailed student report.');
  }
}


function admissionPortalMatrixReport(token, rowDimension, columnDimension) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    if (actor.role === 'Encoder') {
      var restricted = ['Admission Category', 'Sex', 'Gender', 'Previous Scholarship'];
      if (restricted.indexOf(String(rowDimension || '').trim()) >= 0 || restricted.indexOf(String(columnDimension || '').trim()) >= 0) throw new Error('This matrix contains restricted category or demographic information.');
    }
    var allowed = {
      'Grade Level': 'GradeLevel',
      'Admission Category': 'Category',
      'Enrollment Status': 'EnrollStatus',
      'Application Status': 'ApplicationStatus',
      'Previous School': 'PrevSchool',
      'Sex': 'SexualOrient',
      'Gender': 'GenderOrient',
      'Previous Scholarship': 'PrevScholarship',
      'Cluster': 'Cluster',
      'Section': 'Section'
    };
    rowDimension = String(rowDimension || 'Grade Level').trim();
    columnDimension = String(columnDimension || 'Admission Category').trim();
    if (!allowed[rowDimension] || !allowed[columnDimension]) throw new Error('Invalid matrix report dimension.');

    var rows = admissionDbRows_();
    function admissionPortalMatrixValueFor_(r, label) {
      return admissionDimension_(r, label);
    }

    var colSet = {}, matrix = {};
    rows.forEach(function(r) {
      var rowKey = admissionPortalMatrixValueFor_(r, rowDimension), colKey = admissionPortalMatrixValueFor_(r, columnDimension);
      colSet[colKey] = true;
      if (!matrix[rowKey]) matrix[rowKey] = {};
      matrix[rowKey][colKey] = (matrix[rowKey][colKey] || 0) + 1;
    });

    var columns = Object.keys(colSet).sort(function(a,b){ return a.localeCompare(b); });
    var reportRows = Object.keys(matrix).sort(function(a,b){ return a.localeCompare(b); }).map(function(rowKey) {
      var cells = {};
      columns.forEach(function(colKey){ cells[colKey] = Number(matrix[rowKey][colKey] || 0); });
      var total = columns.reduce(function(n,colKey){ return n + cells[colKey]; }, 0);
      cells.Total = total;
      cells.Group = rowKey;
      return cells;
    });

    var totals = { Group: 'Total', Total: rows.length };
    columns.forEach(function(colKey) {
      totals[colKey] = rows.reduce(function(n,r){ return n + (admissionPortalMatrixValueFor_(r, columnDimension) === colKey ? 1 : 0); }, 0);
    });

    return {
      success: true,
      message: 'Matrix report loaded.',
      data: {
        rowDimension: rowDimension,
        columnDimension: columnDimension,
        columns: columns,
        reports: reportRows,
        totals: totals
      }
    };
  } catch (err) {
    return authFail_(err.message || 'Could not load the matrix report.');
  }
}

function admissionPortalFormerAdviserReport(token, formerAdviser) {
  try {
    var actor = authRequireRole_(token, ['Encoder', 'Owner']);
    formerAdviser = String(formerAdviser == null ? '' : formerAdviser).trim();
    var rows = admissionDbRows_();
    if (formerAdviser) {
      rows = rows.filter(function (r) {
        return String(r.PrevAdviser || '').trim().toLowerCase() === formerAdviser.toLowerCase();
      });
    }
    var groups = {};
    rows.forEach(function (r) {
      var key = String(r.PrevAdviser || '').trim() || 'Unassigned';
      if (!groups[key]) groups[key] = {
        FormerAdviser: key, Total: 0, Enrolled: 0, NotEnrolled: 0, Temporary: 0,
        Transferred: 0, Cancelled: 0, Submitted: 0, UnderReview: 0, Approved: 0, Declined: 0,
        students: []
      };
      var g = groups[key];
      g.Total++;
      var es = String(r.EnrollStatus || 'Not Enrolled');
      if (es === 'Enrolled') g.Enrolled++;
      else if (es === 'Temporary') g.Temporary++;
      else if (es === 'Transferred') g.Transferred++;
      else if (es === 'Cancelled') g.Cancelled++;
      else g.NotEnrolled++;
      var as = String(r.ApplicationStatus || 'Submitted');
      if (as === 'Under Review') g.UnderReview++;
      else if (as === 'Approved') g.Approved++;
      else if (as === 'Declined') g.Declined++;
      else g.Submitted++;
      g.students.push({
        StudentID: r.StudentID, FullName: r.FullName, GradeLevel: r.GradeLevel,
        PreviousSchool: r.PrevSchool, PreviousSection: r.PrevSection,
        Category: actor.role === 'Owner' ? r.Category : '', ApplicationStatus: as, EnrollStatus: es
      });
    });
    var advisers = Object.keys(groups).sort(function (a, b) {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    }).map(function (key) {
      var g = groups[key];
      g.students.sort(function (a, b) { return String(a.FullName).localeCompare(String(b.FullName)); });
      return g;
    });
    return {
      success: true,
      message: 'Former adviser report loaded.',
      data: {
        selectedFormerAdviser: formerAdviser,
        advisers: advisers.map(function (g) { return g.FormerAdviser; }),
        reports: advisers
      }
    };
  } catch (err) {
    return authFail_(err.message || 'Could not load the former adviser report.');
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

/** Return a shared, normalized dimension key for dashboards and reports. */
function admissionDimension_(record, name) {
  var fields = {
    grade: 'GradeLevel', 'Grade Level': 'GradeLevel',
    category: 'Category', 'Admission Category': 'Category',
    enrollment: 'EnrollStatus', 'Enrollment Status': 'EnrollStatus',
    application: 'ApplicationStatus', 'Application Status': 'ApplicationStatus',
    sex: 'SexualOrient', 'Sex': 'SexualOrient',
    gender: 'GenderOrient', 'Gender': 'GenderOrient',
    previousSchool: 'PrevSchool', 'Previous School': 'PrevSchool',
    scholarship: 'PrevScholarship', 'Previous Scholarship': 'PrevScholarship',
    classification: 'Classification', 'Classification': 'Classification',
    cluster: 'Cluster', 'Cluster': 'Cluster',
    section: 'Section', 'Section': 'Section'
  };
  var field = fields[String(name || '')];
  if (!field) throw new Error('Unsupported admission dimension: ' + name);
  var fallback = field === 'EnrollStatus' ? 'Not Enrolled' : field === 'ApplicationStatus' ? 'Submitted' : 'Unspecified';
  return String(record && record[field] || fallback).trim() || fallback;
}

function admissionPortalDashboard_(role) {
  var activeYear = admissionDbActiveYear_();
  var rows = maAdmissionSpeedRecords_().filter(function (r) { return String(r.SchoolYear || '').trim() === activeYear; });
  var isOwner = String(role || '') === 'Owner';
  var byStatus = {}, byApplicationStatus = {}, byGrade = {}, byCategory = {},
      enrolledByGrade = {}, enrolledByCluster = {}, bySex = {}, byGender = {},
      byPrevSchool = {}, byScholarship = {}, recent = [], needsAction = [],
      needsActionTotal = 0, today = new Date(), trend = [];

  function inc(map, key) {
    key = String(key || 'Unspecified').trim() || 'Unspecified';
    map[key] = (map[key] || 0) + 1;
  }
  function dayKey(d) { return Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd'); }
  function parseDate(v) {
    var d = new Date(String(v || ''));
    return isNaN(d.getTime()) ? null : d;
  }

  for (var i = 13; i >= 0; i--) {
    var d = new Date(today.getTime() - i * 86400000);
    trend.push({ date: dayKey(d), label: Utilities.formatDate(d, 'Asia/Manila', 'MMM d'), count: 0 });
  }
  var trendIndex = {};
  trend.forEach(function (x, i) { trendIndex[x.date] = i; });

  var certificateCategories = ADM_DB.CATEGORIES.filter(function (category) {
    return /ESC|TLC|PUB-QVR|QVA/i.test(category);
  }).map(function (category) { return admissionDbCategoryLoose_(category).toUpperCase(); });

  rows.forEach(function (r) {
    var status = admissionDimension_(r, 'enrollment');
    var appStatus = admissionDimension_(r, 'application');
    var grade = admissionDimension_(r, 'grade');
    inc(byStatus, status);
    inc(byApplicationStatus, appStatus);
    inc(byGrade, grade);

    if (isOwner) {
      inc(byCategory, admissionDimension_(r, 'category'));
      inc(bySex, admissionDimension_(r, 'sex'));
      inc(byGender, admissionDimension_(r, 'gender'));
      inc(byPrevSchool, admissionDimension_(r, 'previousSchool'));
      if (r.PrevScholarship) inc(byScholarship, admissionDimension_(r, 'scholarship'));
    }

    if (status === 'Enrolled') {
      inc(enrolledByGrade, grade);
      if ((grade === 'Grade 11' || grade === 'Grade 12') && r.Cluster) {
        inc(enrolledByCluster, grade + ' · ' + r.Cluster);
      }
    }

    var created = parseDate(r.CreatedAt);
    if (created) {
      var dateKey = dayKey(created);
      if (trendIndex[dateKey] != null) trend[trendIndex[dateKey]].count++;
    }

    var reasons = [];
    if (appStatus === 'Submitted') reasons.push('Waiting for initial review');

    var requirementItems = admissionDbRequirementItems_(r);
    var incomplete = requirementItems.some(function (item) {
      var value = String(r[item.statusKey] || item.status || '');
      return value === 'Incomplete' || value === 'Pending Submission';
    });
    if (incomplete) reasons.push('Incomplete requirements need follow-up');

    var consentStatus = String(r.ReqConsentStatus || '');
    var consentMissing = consentStatus !== 'Verified' && consentStatus !== 'Received';
    if (isOwner && consentMissing) reasons.push('Consent document needs verification');

    var normalizedCategory = admissionDbCategoryLoose_(r.Category).toUpperCase();
    var certMissing = certificateCategories.indexOf(normalizedCategory) >= 0 &&
      !String(r.CertNo || r.VoucherCertNo || r.EscCertNo || '').trim();
    if (certMissing) reasons.push('Scholarship certificate number is missing');
    if (appStatus === 'Approved' && status !== 'Enrolled') reasons.push('Ready for enrollment processing');

    if (reasons.length) {
      needsActionTotal++;
      if (needsAction.length < 40) {
        needsAction.push({ StudentID: r.StudentID, FullName: r.FullName, GradeLevel: r.GradeLevel,
          Category: isOwner ? r.Category : '', ApplicationStatus: appStatus, EnrollStatus: status,
          Reason: reasons.join(' · ') });
      }
    }
  });

  recent = rows.slice().sort(function (a, b) { return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); })
    .slice(0, 5).map(function (r) {
      return { StudentID: r.StudentID, FullName: r.FullName, GradeLevel: r.GradeLevel,
        Category: isOwner ? r.Category : '', ApplicationStatus: r.ApplicationStatus || 'Submitted', CreatedAt: r.CreatedAt };
    });

  var pipeline = {
    'Not Enrolled': Number(byStatus['Not Enrolled'] || 0),
    'Enrolled': Number(byStatus.Enrolled || 0),
    'Temporary': Number(byStatus.Temporary || 0),
    'Transferred': Number(byStatus.Transferred || 0) + Number(byStatus['Transferred Out'] || 0),
    'Cancelled': Number(byStatus.Cancelled || 0)
  };

  var topSchools = [];
  if (isOwner) {
    var schoolEntries = Object.keys(byPrevSchool).map(function (key) { return { name: key, count: byPrevSchool[key] }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    topSchools = schoolEntries.slice(0, 5);
    var others = schoolEntries.slice(5).reduce(function (sum, item) { return sum + item.count; }, 0);
    if (others) topSchools.push({ name: 'Others', count: others });
  }

  var totalTrend = trend.reduce(function (sum, item) { return sum + Number(item.count || 0); }, 0);
  var previousWeek = trend.slice(0, 7).reduce(function (sum, item) { return sum + Number(item.count || 0); }, 0);
  var currentWeek = trend.slice(7).reduce(function (sum, item) { return sum + Number(item.count || 0); }, 0);
  var todayKey = dayKey(today);
  var yesterday = new Date(today.getTime() - 86400000);
  var todayCount = 0, yesterdayCount = 0;
  trend.forEach(function (item) {
    if (item.date === todayKey) todayCount = item.count;
    if (item.date === dayKey(yesterday)) yesterdayCount = item.count;
  });

  return {
    total: rows.length, activeSchoolYear: activeYear, grades: ADM_DB.GRADES.slice(),
    byStatus: byStatus, byApplicationStatus: byApplicationStatus, byGrade: byGrade,
    byCategory: byCategory, enrolledByGrade: enrolledByGrade, enrolledByCluster: enrolledByCluster,
    pipeline: pipeline, trend: trend,
    trendSummary: { last14Days: totalTrend, currentWeek: currentWeek, previousWeek: previousWeek,
      weekDelta: currentWeek - previousWeek, today: todayCount, yesterday: yesterdayCount,
      dayDelta: todayCount - yesterdayCount },
    recent: recent, needsAction: needsAction, needsActionTotal: needsActionTotal,
    bySex: bySex, byGender: byGender, byPreviousSchoolTop: topSchools,
    byScholarship: byScholarship, role: role
  };
}


function admissionPortalRestrictEncoderRecord_(r) {
  [
    'Category', 'PrevScholarship', 'EscCertNo', 'VoucherCertNo', 'EscSchoolNo', 'CertNo',
    'SexualOrient', 'GenderOrient', 'Religion', 'ReligionOther', 'Birthdate', 'BirthPlace', 'Age',
    'FatherReligion', 'FatherReligionOther', 'MotherReligion', 'MotherReligionOther',
    'RelBirthdate', 'RelAge', 'RelSex', 'RelGender', 'RelGenderOther', 'RelReligion', 'RelReligionOther',
    'ReqConsent', 'ReqConsentStatus', 'ReqConsentDate', 'ConsentAt'
  ].forEach(function (key) { delete r[key]; });
  if (Array.isArray(r.RequirementItems)) {
    r.RequirementItems = r.RequirementItems.filter(function (item) { return item.key !== 'ReqConsent'; });
  }
  if (r.Requirements) delete r.Requirements.Consent;
  return r;
}

function admissionPortalPublicRecord_(r, role) {
  var out = {
    StudentID: r.StudentID, CreatedAt: r.CreatedAt, FullName: r.FullName,
    LRN: r.LRN, SchoolYear: r.SchoolYear, Category: r.Category,
    GradeLevel: r.GradeLevel, Department: r.Department, Cluster: r.Cluster,
    Section: r.Section, Email: r.Email, EnrollStatus: r.EnrollStatus,
    ApplicationStatus: r.ApplicationStatus || 'Submitted',
    ProcessedBy: r.ProcessedBy, ProcessedDate: r.ProcessedDate,
    Requirements: {
      SF9: r.ReqSF9, F137: r.ReqF137, Birth: r.ReqBirth, Moral: r.ReqMoral,
      JHS: r.ReqJHS, Photo: r.ReqPhoto, Transferee: r.ReqTransferee,
      Consent: r.ReqConsent, Envelope: r.ReqEnvelope
    }
  };
  return role === 'Encoder' ? admissionPortalRestrictEncoderRecord_(out) : out;
}
