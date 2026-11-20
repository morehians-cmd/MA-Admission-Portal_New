/**
 * AdmissionRetention.gs
 * Archives stale never-enrolled admission records without touching enrolled history.
 * Default policy: 12 months after creation and only for school years older than active SY.
 */
var ADM_RETENTION = { APPLICATION_MONTHS: 12, ARCHIVE_DAYS: 90, MAX_PER_RUN: 150 };

function admissionRetentionArchiveSheet_() {
  var ss=authSpreadsheet_(), sh=ss.getSheetByName('Deleted Students');
  var headers=['DeletedAt','DeletedBy'].concat(ADM_DB.HEADERS);
  if(!sh){sh=ss.insertSheet('Deleted Students');sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');sh.setFrozenRows(1);}
  return sh;
}

function admissionRetentionStale_() {
  var cut = new Date(); cut.setMonth(cut.getMonth() - ADM_RETENTION.APPLICATION_MONTHS);
  var active = PropertiesService.getScriptProperties().getProperty('ADM_SY_ACTIVE') || '2026-2027';
  return admissionDbRows_().filter(function(r){
    return r.EnrollStatus === 'Not Enrolled' && r.CreatedAt && new Date(r.CreatedAt) < cut && r.SchoolYear && r.SchoolYear < active;
  });
}

function admissionRetentionReview(token) {
  try {
    authRequireRole_(token,['Owner']);
    return {success:true,message:'Retention preview ready.',data:admissionRetentionStale_().slice(0,ADM_RETENTION.MAX_PER_RUN).map(function(r){return {studentId:r.StudentID,fullName:r.FullName,createdAt:r.CreatedAt,schoolYear:r.SchoolYear};})};
  } catch(e){return authFail_(e.message || 'Could not review retention.');}
}

function admissionRetentionRun(token) {
  var lock=LockService.getScriptLock();
  try{
    var actor=authRequireRole_(token,['Owner']); lock.waitLock(30000);
    var stale=admissionRetentionStale_().slice(0,ADM_RETENTION.MAX_PER_RUN); if(!stale.length)return {success:true,message:'No stale applications found.',data:{archived:0}};
    var sh=admissionDbSheet_(), archive=admissionRetentionArchiveSheet_(), all=admissionDbRows_(), ids={}; stale.forEach(function(r){ids[r.StudentID]=true;});
    var now=new Date().toISOString(), archiveRows=stale.map(function(r){return [now,actor.email].concat(ADM_DB.HEADERS.map(function(h){return r[h] == null ? '' : String(r[h]);}));});
    archive.getRange(archive.getLastRow()+1,1,archiveRows.length,archiveRows[0].length).setValues(archiveRows);
    var rowNums=[]; all.forEach(function(r,i){if(ids[r.StudentID])rowNums.push(i+2);});
    for(var i=rowNums.length-1;i>=0;i--)sh.deleteRow(rowNums[i]);
    stale.forEach(function(r){if(r.IDPhotoID){try{DriveApp.getFileById(r.IDPhotoID).setTrashed(true);}catch(_){}}});
    admissionDbAudit_(actor.email,'retention-archive', '', stale.length+' stale application(s) archived and removed');
    return {success:true,message:stale.length+' stale application(s) archived and removed.',data:{archived:stale.length}};
  }catch(e){return authFail_(e.message || 'Could not run retention.');}
  finally{try{lock.releaseLock();}catch(_){} }
}

function admissionRetentionPurgeArchive(token) {
  var lock=LockService.getScriptLock();
  try{
    var actor=authRequireRole_(token,['Owner']); lock.waitLock(20000), sh=admissionRetentionArchiveSheet_(), last=sh.getLastRow();
    if(last<2)return {success:true,message:'Archive is empty.',data:{purged:0}};
    var cut=Date.now()-ADM_RETENTION.ARCHIVE_DAYS*86400000, vals=sh.getRange(2,1,last-1,1).getValues(), rows=[];
    vals.forEach(function(v,i){var d=new Date(v[0]).getTime();if(d && d<cut)rows.push(i+2);});
    for(var i=rows.length-1;i>=0;i--)sh.deleteRow(rows[i]);
    if(rows.length)admissionDbAudit_(actor.email,'retention-purge','',rows.length+' archive row(s) purged');
    return {success:true,message:rows.length+' archive row(s) purged.',data:{purged:rows.length}};
  }catch(e){return authFail_(e.message || 'Could not purge the archive.');}
  finally{try{lock.releaseLock();}catch(_){} }
}
