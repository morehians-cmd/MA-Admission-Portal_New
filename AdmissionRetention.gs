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
  var active = admissionDbActiveYear_();
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
    var sh=admissionDbSheet_(), archive=admissionRetentionArchiveSheet_();

    // Address every record by its REAL sheet row (_row) and confirm the StudentID still sits there before anything is deleted.
    var idCol=ADM_DB.HEADERS.indexOf('StudentID')+1, last=sh.getLastRow();
    var ids=sh.getRange(2,idCol,last-1,1).getValues();
    stale.forEach(function(r){
      var k=r._row-2;
      if(k<0||k>=ids.length||String(ids[k][0]||'').trim()!==String(r.StudentID)) throw new Error('Row mismatch for '+r.StudentID+'. Nothing was archived or deleted.');
    });

    var now=new Date().toISOString(), archiveRows=stale.map(function(r){return [now,actor.email].concat(ADM_DB.HEADERS.map(function(h){return r[h] == null ? '' : String(r[h]);}));});
    archive.getRange(archive.getLastRow()+1,1,archiveRows.length,archiveRows[0].length).setNumberFormat('@').setValues(archiveRows);
    var rowNums=stale.map(function(r){return r._row;}).sort(function(a,b){return b-a;});   // bottom-up so earlier rows do not shift
    rowNums.forEach(function(n){sh.deleteRow(n);});

    // The linked account must not keep pointing at a record that no longer exists.
    stale.forEach(function(r){
      if(r.Email){ try{authUnlinkStudentLocked_(r.Email,r.StudentID);}catch(e){console.error('Unlink failed for '+r.StudentID+': '+e.message);} }
      if(r.IDPhotoID){try{DriveApp.getFileById(r.IDPhotoID).setTrashed(true);}catch(_){}}
    });
    maAdmissionSpeedBump_();
    admissionDbAudit_(actor.email,'retention-archive', '', stale.length+' stale application(s) archived and removed');
    return {success:true,message:stale.length+' stale application(s) archived and removed.',data:{archived:stale.length}};
  }catch(e){return authFail_(e.message || 'Could not run retention.');}
  finally{try{lock.releaseLock();}catch(_){} }
}

function admissionRetentionPurgeArchive(token) {
  var lock=LockService.getScriptLock();
  try{
    var actor=authRequireRole_(token,['Owner']); lock.waitLock(20000); var sh=admissionRetentionArchiveSheet_(), last=sh.getLastRow();
    if(last<2)return {success:true,message:'Archive is empty.',data:{purged:0}};
    var cut=Date.now()-ADM_RETENTION.ARCHIVE_DAYS*86400000, vals=sh.getRange(2,1,last-1,1).getValues(), rows=[];
    vals.forEach(function(v,i){var d=new Date(v[0]).getTime();if(d && d<cut)rows.push(i+2);});
    for(var i=rows.length-1;i>=0;i--)sh.deleteRow(rows[i]);
    if(rows.length)admissionDbAudit_(actor.email,'retention-purge','',rows.length+' archive row(s) purged');
    return {success:true,message:rows.length+' archive row(s) purged.',data:{purged:rows.length}};
  }catch(e){return authFail_(e.message || 'Could not purge the archive.');}
  finally{try{lock.releaseLock();}catch(_){} }
}
