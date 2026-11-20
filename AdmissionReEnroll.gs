/**
 * AdmissionReEnroll.gs
 * One AdmissionStudents row per learner; each completed school year is copied to Enrollment History.
 * StudentID and account linkage remain unchanged.
 */
var ADM_REENROLL_RESET = ['ReqSF9', 'ReqConsent', 'ReqRemarks', 'ReqEnvelope'];
var ADM_HISTORY_HEADERS = ['StudentID','SchoolYear','Classification','Category','GradeLevel','Cluster','Section','EnrollStatus','ArchivedAt','ArchivedBy','Snapshot'];

function admissionHistorySheet_() {
  var ss = authSpreadsheet_(), sh = ss.getSheetByName('Enrollment History');
  if (!sh) { sh = ss.insertSheet('Enrollment History'); sh.getRange(1,1,1,ADM_HISTORY_HEADERS.length).setValues([ADM_HISTORY_HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

function admissionHistory_(studentId) {
  var sh = admissionHistorySheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,8).getDisplayValues().filter(function(r){return String(r[0]) === String(studentId);}).map(function(r){
    return {SchoolYear:r[1], Classification:r[2], Category:r[3], GradeLevel:r[4], Cluster:r[5], Section:r[6], EnrollStatus:r[7]};
  }).sort(function(a,b){return a.SchoolYear.localeCompare(b.SchoolYear);});
}

/** Department label for a grade index, using the same vocabulary as the rest of the app. */
function admissionReEnrollDepartment_(gi) {
  return admissionDbDepartment_(gi);
}

/**
 * Recomputes the document statuses for the new school year.
 * - Documents that are renewed every year (report card, consent, envelope) go back to Pending Submission.
 * - Documents that do not apply to the new grade/category become Not Applicable.
 * - Newly applicable documents start as Pending Submission.
 * - Everything else (birth certificate, Form 137, good moral, ...) keeps its verified status.
 */
function admissionReEnrollRequirements_(r) {
  var renew = { ReqSF9Initial: true, ReqSF9Completion: true, ReqConsent: true, ReqEnvelope: true };
  var legacy = { ReqSF9: true, ReqBirth: true };
  var applicable = {};
  admissionDbRequirementItems_(r).forEach(function (it) { applicable[it.key] = true; });
  ADM_DB.REQUIREMENTS.forEach(function (it) {
    if (legacy[it.key]) return;
    var cur = String(r[it.statusKey] || '');
    if (!applicable[it.key]) r[it.statusKey] = 'Not Applicable';
    else if (renew[it.key] || !cur || cur === 'Not Applicable') r[it.statusKey] = 'Pending Submission';
  });
}

function admissionReEnrollRun(token, options) {
  var lock = LockService.getScriptLock();
  try {
    var actor = authRequireRole_(token, ['Owner','Encoder']);
    options = options || {};
    var ids = Array.isArray(options.ids) ? options.ids.map(String).slice(0, 50) : null;
    if (!ids && actor.role !== 'Owner') throw new Error('Only the Owner can run bulk re-enrollment without a learner list.');
    lock.waitLock(30000);
    var sh = admissionDbSheet_(), rows = admissionDbRows_(), sy = admissionDbActiveYear_();
    var grades = ADM_DB.GRADES, retain = options.retain === true, todo = [], skipped = 0;
    rows.forEach(function(r) {
      if (r.EnrollStatus !== 'Enrolled' || !r.SchoolYear || r.SchoolYear >= sy) return;
      if (ids ? ids.indexOf(String(r.StudentID)) < 0 : (options.grade && options.grade !== '*' && r.GradeLevel !== options.grade)) return;
      var g = grades.indexOf(r.GradeLevel);
      if (g < 0 || (!retain && g === grades.length - 1)) { skipped++; return; }
      todo.push({row:r});
    });
    if (options.preview) return {success:true,message:'Preview ready.',data:{count:todo.length,skipped:skipped,rows:todo.map(function(x){var g=grades.indexOf(x.row.GradeLevel);return [x.row.GradeLevel, retain ? x.row.GradeLevel : grades[g+1]];})}};
    if (!todo.length) throw new Error('No eligible learners were found. Only previously enrolled learners can be re-enrolled.');

    // Read the sheet exactly as it is (blank-ID rows included) and address every learner by its REAL sheet row (_row),
    // never by its position in the filtered rows array.
    var last = sh.getLastRow(), width = ADM_DB.HEADERS.length;
    var values = sh.getRange(2, 1, last - 1, width).getValues();
    var hist = admissionHistorySheet_(), now = new Date().toISOString(), histRows = [];
    var gi13 = grades.indexOf('Grade 11');
    todo.forEach(function(item){
      var old = Object.assign({}, item.row), g = grades.indexOf(old.GradeLevel), nextGrade = retain ? old.GradeLevel : grades[g+1], ng = grades.indexOf(nextGrade), r = Object.assign({}, old);
      var offset = old._row - 2;
      if (offset < 0 || offset >= values.length || String(values[offset][0] || '').trim() !== String(old.StudentID)) throw new Error('Row mismatch for ' + old.StudentID + '. Nothing was changed.');
      delete old._row; delete r._row;
      var snap = {}; Object.keys(old).forEach(function(k){ if (old[k] !== '') snap[k] = old[k]; });
      var snapJson = JSON.stringify(snap);
      if (snapJson.length > 49000) snapJson = JSON.stringify({ truncated: true, StudentID: old.StudentID, SchoolYear: old.SchoolYear, GradeLevel: old.GradeLevel, Category: old.Category, Cluster: old.Cluster, Section: old.Section, EnrollStatus: old.EnrollStatus });
      histRows.push([old.StudentID,old.SchoolYear,old.Classification,old.Category,old.GradeLevel,old.Cluster,old.Section,old.EnrollStatus,now,actor.email,snapJson]);
      r.SchoolYear = sy; r.Classification = 'Old'; r.GradeLevel = nextGrade; r.Department = admissionReEnrollDepartment_(ng);
      // A Senior High cluster carries over (Grade 11 -> 12, or a retained SHS learner); everyone else picks a new one.
      r.Cluster = (ng >= gi13 && (retain || g >= gi13)) ? old.Cluster : '';
      r.Section = ''; r.ReferredBy = ''; r.EnrollStatus = 'Not Enrolled'; r.ApplicationStatus = 'Approved';
      ADM_REENROLL_RESET.forEach(function(k){r[k]='None'; var dk=k+'Date'; if (ADM_DB.HEADERS.indexOf(dk)>=0) r[dk]='';});
      ['CancelDate','CancelReason','CancelReasonOther','DestSchool','DestAddress','DestType','DestGrade','TempUntil','TempBy','TempReason'].forEach(function(k){if(ADM_DB.HEADERS.indexOf(k)>=0)r[k]='';});
      admissionReEnrollRequirements_(r);
      r.Age = admissionDbAge_(r.Birthdate); r.StatusChangedAt = now;
      values[offset] = ADM_DB.HEADERS.map(function(h){return r[h] == null ? '' : String(r[h]);});
    });
    hist.getRange(hist.getLastRow()+1,1,histRows.length,ADM_HISTORY_HEADERS.length).setValues(histRows);
    sh.getRange(2,1,values.length,width).setNumberFormat('@').setValues(values);
    maAdmissionSpeedBump_();
    admissionDbAudit_(actor.email,'student-reenrollment', '', todo.length + ' learner(s) re-enrolled for ' + sy);
    return {success:true,message:todo.length+' learner(s) re-enrolled for '+sy+'.',data:{done:todo.length,skipped:skipped}};
  } catch(e){return authFail_(e.message || 'Could not re-enroll learners.');}
  finally{try{lock.releaseLock();}catch(_){} }
}

function admissionReEnrollHistory(token, studentId) {
  try { authRequireRole_(token,['Owner','Encoder']); return {success:true,message:'History loaded.',data:admissionHistory_(studentId)}; }
  catch(e){return authFail_(e.message || 'Could not load enrollment history.');}
}
