var CURRENT_STUDENT = {
  SCHOOL_YEAR:'2026-2027', OPEN_PROPERTY:'ADM_CURRENT_STUDENT_OPEN',
  TLC_CATEGORIES:['TLC Scholar','TLC-OVAP','TLC-ESC'], TLC_PATTERN:/^TLC\d{4}-\d{4}$/, LRN_PATTERN:/^[1-5]\d{11}$/,
  CLUSTERS:{STEM:'Science, Technology, Engineering, and Mathematics',ASSH:'Arts, Social Sciences, and Humanities',BE:'Business and Entrepreneurship',ICT:'ICT Support and Computer Programming Technologies',HT:'Hospitality and Tourism'},
  SECTIONS:{'Nursery':['JOY'],'Kinder 1':['LOVE','FAITH'],'Kinder 2':['PEACE','HOPE'],'Grade 1':['RIGHTEOUSNESS','OBEDIENCE'],'Grade 2':['HARMONY','GOODNESS'],'Grade 3':['KINDNESS','TRUST'],'Grade 4':['RESPECT','COMPASSION'],'Grade 5':['COURTEOUS','UNITY'],'Grade 6':['EXCELLENCE'],'Grade 7':['CHARITY','COURAGE','GENEROSITY','GRATITUDE','HUMILITY','INTEGRITY','PATIENCE','PRUDENCE','WISDOM','EMPATHY'],'Grade 8':['AMBER','AMETHYST','DIAMOND','GARNET','JADE','JASPER','OPAL','SAPPHIRE','TOPAZ','ZIRCON'],'Grade 9':['JUPITER','MARS','MERCURY','NEPTUNE','PLUTO','SATURN','TERRA','URANUS','VENUS'],'Grade 10':['COPERNICUS','DARWIN','FRANKLIN','GALILEI','KEPLER','MENDEL','PASCAL'],'Grade 11|STEM':['JOHN','LUKE','MATTHEW','PAUL','PRISCILLA','TABITHA'],'Grade 12|STEM':['ABRAHAM','ADAN','ISAAC','JACOB','NOAH','SETH'],'Grade 11|ASSH':['ANDREW','JAMES','MARK','NATHANIEL','PETER','SILAS','SIMON','THOMAS','TIMOTHY'],'Grade 12|ASSH':['AMOS','DANIEL','ELISHA','EZEKIEL','ELIJAH','ISAIAH','JEREMIAH','MICAH','SAMUEL'],'Grade 11|BE':['AQUILA','THADDEUS','PHILEMON','ZACCHAEUS'],'Grade 12|BE':['NEHEMIAH','JOSEPH','BOAZ','JETHRO'],'Grade 11|ICT':['STEPHEN','TITUS','CORNELIUS'],'Grade 12|ICT':['JOB','UZZIAH','BENJAMIN'],'Grade 11|HT':['DAMARIS','MARIAM','PHOEBE','SALOME'],'Grade 12|HT':['DEBORAH','ESTHER','RUTH','ABIGAIL']}
};
function admissionCurrentStudentIsOpen_(){var v=PropertiesService.getScriptProperties().getProperty(CURRENT_STUDENT.OPEN_PROPERTY);return v==null||String(v).toUpperCase()!=='FALSE';}
function admissionCurrentStudentConfig(){return {success:true,message:'Current-student sign-up configuration loaded.',data:{open:admissionCurrentStudentIsOpen_(),schoolYear:CURRENT_STUDENT.SCHOOL_YEAR,grades:ADM_DB.GRADES,categories:ADM_DB.CATEGORIES,clusters:CURRENT_STUDENT.CLUSTERS,sections:CURRENT_STUDENT.SECTIONS,tlcCategories:CURRENT_STUDENT.TLC_CATEGORIES}};}
function admissionCurrentStudentCreate(token,input){var lock=null;try{
 if(!admissionCurrentStudentIsOpen_())throw new Error('Current-student account creation is closed.');
 var a=authRequireRole_(token,['Applicant']);if(a.studentId)throw new Error('This account is already linked to a student record.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid current-student information.');
 var sn=admissionDbCleanText_(input.Surname,80),fn=admissionDbCleanText_(input.FirstName,80),mn=admissionDbCleanText_(input.MiddleName,80),sx=admissionDbCleanText_(input.Suffix,20);
 if(!sn||!fn)throw new Error('Surname and first name are required.');
 var bd=String(input.Birthdate||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(bd)||!admissionDbAge_(bd))throw new Error('Enter a valid birth date.');
 var lrn=String(input.LRN||'').replace(/\D/g,'');if(!CURRENT_STUDENT.LRN_PATTERN.test(lrn))throw new Error('LRN must be 12 digits and start with 1, 2, 3, 4 or 5.');
 var g=String(input.GradeLevel||'').trim(),gi=ADM_DB.GRADES.indexOf(g);if(gi<0)throw new Error('Select a valid grade level.');
 var cat=admissionDbCategory_(input.Category),cl=String(input.Cluster||'').trim(),sec=String(input.Section||'').trim();
 if(gi>=13){if(!CURRENT_STUDENT.CLUSTERS[cl]||!CURRENT_STUDENT.SECTIONS[g+'|'+cl]||CURRENT_STUDENT.SECTIONS[g+'|'+cl].indexOf(sec)<0)throw new Error('Select a valid SHS cluster and section.');}else{if((CURRENT_STUDENT.SECTIONS[g]||[]).indexOf(sec)<0)throw new Error('Select a valid section for the chosen grade.');cl='';}
 var tlc='';if(CURRENT_STUDENT.TLC_CATEGORIES.indexOf(cat)>=0){tlc=String(input.ClaimedIDNumber||'').trim().toUpperCase();if(!CURRENT_STUDENT.TLC_PATTERN.test(tlc))throw new Error('Enter a valid TLC ID Number in the format TLC####-####.');}
 var mob=String(input.Mobile||'').replace(/\D/g,'');if(!/^09\d{9}$/.test(mob))throw new Error('Enter a valid 11-digit mobile number starting with 09.');
 var full=sn.toUpperCase()+', '+fn.toUpperCase()+(mn?' '+mn.toUpperCase():'')+(sx?' '+sx.toUpperCase():'');
 var r={StudentID:'',CreatedAt:new Date().toISOString(),Classification:'Old',SchoolYear:CURRENT_STUDENT.SCHOOL_YEAR,LRN:lrn,Surname:sn.toUpperCase(),FirstName:fn.toUpperCase(),MiddleName:mn.toUpperCase(),Suffix:sx.toUpperCase(),FullName:full,Category:cat,GradeLevel:g,Department:gi<3?'Preschool':gi<9?'Elementary':gi<13?'Junior High School':'Senior High School',Cluster:cl,Section:sec,Birthdate:bd,Age:admissionDbAge_(bd),Mobile:mob,Email:a.email,EnrollStatus:'Not Enrolled',ApplicationStatus:'Submitted',ClaimedIDNumber:tlc};
 lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw new Error('The service is busy. Please try again.');
 var sh=admissionDbSheet_(),rows=admissionDbRows_();
 if(rows.some(function(x){return String(x.Email||'').toLowerCase()===a.email.toLowerCase();}))throw new Error('An admission record already exists for this account.');
 if(rows.some(function(x){return String(x.LRN||'')===lrn;}))throw new Error('An admission record already uses this LRN. Please contact the Admissions Office.');
 if(rows.some(function(x){return String(x.Surname||'').toUpperCase()===r.Surname&&String(x.FirstName||'').toUpperCase()===r.FirstName&&String(x.Birthdate||'')===bd;}))throw new Error('A student record with the same name and birth date already exists. Please contact the Admissions Office.');
 if(tlc&&rows.some(function(x){return String(x.ClaimedIDNumber||'').toUpperCase()===tlc||String(x.IDNumber||'').toUpperCase()===tlc;}))throw new Error('That TLC ID Number has already been claimed.');
 var id=admissionDbNewStudentId_(CURRENT_STUDENT.SCHOOL_YEAR),row={};ADM_DB.HEADERS.forEach(function(h){row[h]='';});Object.keys(r).forEach(function(k){row[k]=r[k];});row.StudentID=id;
 ADM_DB.REQUIREMENTS.forEach(function(i){row[i.statusKey]='Not Applicable';});admissionDbRequirementItems_(row).forEach(function(i){row[i.statusKey]='Pending Submission';});
 var vals=[ADM_DB.HEADERS.map(function(h){return row[h]==null?'':String(row[h]);})],inserted=sh.getLastRow()+1;sh.getRange(inserted,1,1,ADM_DB.HEADERS.length).setNumberFormat('@').setValues(vals);
 try{authLinkStudentLocked_(a.email,id);}catch(e){sh.deleteRow(inserted);throw e;}maAdmissionSpeedBump_();admissionDbAudit_(a.email,'current-student-account-created',id,'SY2026-2027 current-student sign-up');
 return {success:true,message:'Your current-student account and admission record were created.',data:{studentId:id,tlcClaimed:!!tlc}};
 }catch(e){return authFail_(e.message||'Could not create the current-student record.');}finally{if(lock){try{lock.releaseLock();}catch(e){}}}}
