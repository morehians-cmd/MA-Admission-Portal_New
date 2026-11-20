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

function admissionReEnrollRun(token, options) {
  var lock = LockService.getScriptLock();
  try {
    var actor = authRequireRole_(token, ['Owner','Encoder']);
    options = options || {};
    var ids = Array.isArray(options.ids) ? options.ids.map(String).slice(0, 50) : null;
    if (!ids && actor.role !== 'Owner') throw new Error('Only the Owner can run bulk re-enrollment without a learner list.');
    lock.waitLock(30000);
    var sh = admissionDbSheet_(), rows = admissionDbRows_(), sy = PropertiesService.getScriptProperties().getProperty('ADM_SY_ACTIVE') || '2026-2027';
    var grades = ADM_DB.GRADES, retain = options.retain === true, todo = [], skipped = 0;
    rows.forEach(function(r, i) {
      if (r.EnrollStatus !== 'Enrolled' || !r.SchoolYear || r.SchoolYear >= sy) return;
      if (ids ? ids.indexOf(String(r.StudentID)) < 0 : (options.grade && options.grade !== '*' && r.GradeLevel !== options.grade)) return;
      var g = grades.indexOf(r.GradeLevel);
      if (g < 0 || (!retain && g === grades.length - 1)) { skipped++; return; }
      todo.push({row:r, index:i});
    });
    if (options.preview) return {success:true,message:'Preview ready.',data:{count:todo.length,skipped:skipped,rows:todo.map(function(x){var g=grades.indexOf(x.row.GradeLevel);return [x.row.GradeLevel, retain ? x.row.GradeLevel : grades[g+1]];})}};
    if (!todo.length) throw new Error('No eligible learners were found. Only previously enrolled learners can be re-enrolled.');
    var hist = admissionHistorySheet_(), now = new Date().toISOString(), histRows = [], values = sh.getRange(2,1,rows.length,ADM_DB.HEADERS.length).getValues();
    todo.forEach(function(item){
      var old = Object.assign({}, item.row), g = grades.indexOf(old.GradeLevel), nextGrade = retain ? old.GradeLevel : grades[g+1], r = Object.assign({}, old);
      histRows.push([old.StudentID,old.SchoolYear,old.Classification,old.Category,old.GradeLevel,old.Cluster,old.Section,old.EnrollStatus,now,actor.email,JSON.stringify(old).slice(0,49000)]);
      r.SchoolYear=sy; r.Classification='Old'; r.GradeLevel=nextGrade; r.Department = nextGrade === 'Grade 11' || nextGrade === 'Grade 12' ? 'Senior High School' : (grades.indexOf(nextGrade) >= 9 ? 'Junior High School' : 'Elementary/Pre-school');
      r.Cluster = nextGrade === 'Grade 11' || nextGrade === 'Grade 12' ? '' : ''; r.Section=''; r.ReferredBy=''; r.EnrollStatus='Not Enrolled'; r.ApplicationStatus='Approved';
      ADM_REENROLL_RESET.forEach(function(k){r[k]='None'; var dk=k+'Date'; if (ADM_DB.HEADERS.indexOf(dk)>=0) r[dk]='';});
      ['CancelDate','CancelReason','CancelReasonOther','DestSchool','DestAddress','DestType','DestGrade','TempUntil','TempBy'].forEach(function(k){if(ADM_DB.HEADERS.indexOf(k)>=0)r[k]='';});
      r.Age = admissionDbAge_(r.Birthdate); r.StatusChangedAt=now;
      values[item.index] = ADM_DB.HEADERS.map(function(h){return r[h] == null ? '' : String(r[h]);});
    });
    hist.getRange(hist.getLastRow()+1,1,histRows.length,ADM_HISTORY_HEADERS.length).setValues(histRows);
    sh.getRange(2,1,values.length,ADM_DB.HEADERS.length).setNumberFormat('@').setValues(values);
    admissionDbAudit_(actor.email,'student-reenrollment', '', todo.length + ' learner(s) re-enrolled for ' + sy);
    return {success:true,message:todo.length+' learner(s) re-enrolled for '+sy+'.',data:{done:todo.length,skipped:skipped}};
  } catch(e){return authFail_(e.message || 'Could not re-enroll learners.');}
  finally{try{lock.releaseLock();}catch(_){} }
}

function admissionReEnrollHistory(token, studentId) {
  try { authRequireRole_(token,['Owner','Encoder']); return {success:true,message:'History loaded.',data:admissionHistory_(studentId)}; }
  catch(e){return authFail_(e.message || 'Could not load enrollment history.');}
}
