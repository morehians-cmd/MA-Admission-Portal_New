/** Student self-service profile editing. Only Approved Student accounts may use this endpoint. */
var ADMISSION_STUDENT_PROFILE_FIELDS = [
  'SchoolYear','LRN','Surname','FirstName','MiddleName','Suffix','GradeLevel','Department','Cluster',
  'PrevSchool','PrevSY','PrevGrade','PrevCluster','PrevSection','PrevAdviser','PrevScholarship','PrevSchoolID','PrevAddress','PrevSchoolType',
  'AddressLine1','AddressLine2','Barangay','City','Province','Birthdate','Mobile','SexualOrient','GenderOrient','Religion','ReligionOther',
  'FatherName','FatherStatus','FatherOccupation','FatherEducation','FatherMobile','FatherReligion','FatherReligionOther','FatherEmail',
  'MotherName','MotherStatus','MotherOccupation','MotherEducation','MotherMobile','MotherReligion','MotherReligionOther','MotherEmail',
  'LivingWith','EmName','EmRelation','EmMobile','EmSameAddr','EmAddress','EmSource',
  'GuardName','GuardRelation','GuardEmail','GuardMobile','Facebook','RelName','RelRelation','RelBirthdate','RelAge','RelSex','RelGender','RelGenderOther','RelMobile','RelCivil','RelSameAddr','RelAddress','RelSide','RelStatus','RelOccupation','RelEducation','RelEmail','RelReligion','RelReligionOther','BirthPlace'
];
var ADMISSION_STUDENT_PROFILE_LOCKED_AFTER_ENROLLMENT = ['StudentID','CreatedAt','Classification','Category','Email','ConsentAt','EnrollStatus','ApplicationStatus','IDNumber','IDPhotoID','StatusChangedAt','TempUntil','TempBy'];

function admissionStudentProfileGet(token) {
  try {
    var a = authRequireRole_(token, ['Student']);
    var r = admissionDbFindById_(a.studentId);
    if (!r) throw new Error('Student record not found.');
    if (String(r.ApplicationStatus || '') !== 'Approved') throw new Error('Your student profile becomes available after your application is approved.');
    var out = {};
    ADMISSION_STUDENT_PROFILE_FIELDS.forEach(function(k){ out[k] = r[k] == null ? '' : r[k]; });
    out.StudentID = r.StudentID; out.FullName = r.FullName; out.ApplicationStatus = r.ApplicationStatus; out.EnrollStatus = r.EnrollStatus; out.IDNumber = r.IDNumber || '';
    out.lockIdentity = String(r.EnrollStatus || '') === 'Enrolled';
    return {success:true,message:'Student profile loaded.',data:out};
  } catch(e) { return authFail_(e.message || 'Could not load the student profile.'); }
}

function admissionStudentProfileSave(token, changes) {
  var lock=null;
  try {
    var a = authRequireRole_(token, ['Student']);
    var r = admissionDbFindById_(a.studentId);
    if (!r) throw new Error('Student record not found.');
    if (String(r.ApplicationStatus || '') !== 'Approved') throw new Error('Only approved students may update their profile.');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid profile data.');
    var enrolled = String(r.EnrollStatus || '') === 'Enrolled';
    var lockedIdentity = {StudentID:true,CreatedAt:true,Classification:true,Category:true,Email:true,ConsentAt:true,EnrollStatus:true,ApplicationStatus:true,IDNumber:true,IDPhotoID:true,StatusChangedAt:true,TempUntil:true,TempBy:true};
    if (enrolled) { ['LRN','Surname','FirstName','MiddleName','Suffix','Birthdate'].forEach(function(k){lockedIdentity[k]=true;}); }
    var update={}; Object.keys(changes).forEach(function(k){
      if (ADMISSION_STUDENT_PROFILE_FIELDS.indexOf(k)<0) throw new Error('Unsupported profile field: '+k);
      if (lockedIdentity[k]) return;
      update[k]=admissionDbCleanText_(changes[k],1000);
    });
    if (update.GradeLevel != null && ADM_DB.GRADES.indexOf(update.GradeLevel)<0) throw new Error('Unsupported grade level.');
    if (update.LRN != null && update.LRN && !/^[1-5]\d{11}$/.test(update.LRN)) throw new Error('LRN must be 12 digits and start with 1–5.');
    if (update.Mobile != null && update.Mobile && !/^09\d{9}$/.test(update.Mobile)) throw new Error('Enter a valid 11-digit mobile number.');
    if (update.Birthdate != null && update.Birthdate && (!/^\d{4}-\d{2}-\d{2}$/.test(update.Birthdate) || !admissionDbAge_(update.Birthdate))) throw new Error('Enter a valid birth date.');
    if (update.LRN && admissionDbRows_().some(function(x){return x.LRN===update.LRN && x.StudentID!==r.StudentID;})) throw new Error('Another admission record already uses this LRN.');
    if (update.Surname != null) update.Surname=String(update.Surname).toUpperCase();
    if (update.FirstName != null) update.FirstName=String(update.FirstName).toUpperCase();
    if (update.MiddleName != null) update.MiddleName=String(update.MiddleName).toUpperCase();
    if (update.Suffix != null) update.Suffix=String(update.Suffix).toUpperCase();
    var sn=update.Surname!=null?update.Surname:r.Surname, fn=update.FirstName!=null?update.FirstName:r.FirstName, mn=update.MiddleName!=null?update.MiddleName:r.MiddleName, sx=update.Suffix!=null?update.Suffix:r.Suffix;
    if ((update.Surname!=null||update.FirstName!=null||update.MiddleName!=null||update.Suffix!=null) && (!sn||!fn)) throw new Error('Surname and first name are required.');
    if (update.Surname!=null||update.FirstName!=null||update.MiddleName!=null||update.Suffix!=null) update.FullName=String(sn).toUpperCase()+', '+String(fn).toUpperCase()+(mn?' '+String(mn).toUpperCase():'')+(sx?' '+String(sx).toUpperCase():'');
    if (update.Birthdate!=null) update.Age=admissionDbAge_(update.Birthdate);
    if (update.GradeLevel!=null) { var gi=ADM_DB.GRADES.indexOf(update.GradeLevel); update.Department=gi<3?'Preschool':gi<9?'Elementary':gi<13?'Junior High School':'Senior High School'; }
    if (!Object.keys(update).length) return {success:true,message:'No changes were supplied.',data:admissionStudentProfileGet(token).data};
    lock=LockService.getScriptLock(); if(!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    var sh=admissionDbSheet_(), range=sh.getRange(r._row,1,1,ADM_DB.HEADERS.length), vals=range.getValues();
    Object.keys(update).forEach(function(k){vals[0][ADM_DB.HEADERS.indexOf(k)]=update[k];}); range.setNumberFormat('@').setValues(vals);
    maAdmissionSpeedBump_(); admissionDbAudit_(a.email,'student-profile-updated',r.StudentID,Object.keys(update).join(', '));
    return {success:true,message:'Your student profile has been updated.',data:admissionStudentProfileGet(token).data};
  } catch(e){return authFail_(e.message||'Could not save your student profile.');}
  finally{if(lock){try{lock.releaseLock();}catch(e){}}}
}
