/**
 * StudentWorkspaceService.gs
 * Read-only, account-scoped workspace data for the student/applicant self-service pages.
 * No applicant-facing API accepts a StudentID from the browser; ownership comes from the session.
 */
function admissionApplicantWorkspaceGet(token) {
  try {
    var account = authRequireRole_(token, ['Applicant', 'Student']);
    var mine = admissionGetMyApplication(token);
    if (!mine || mine.success !== true) return mine || authFail_('Could not load your application.');
    var record = mine.data;
    if (!record) {
      return { success:true, message:'Workspace loaded.', data:{
        account:{email:account.email,role:account.role,studentId:'',fullName:account.fullName||''},
        application:null,timeline:[],notifications:[]
      }};
    }

    var timeline = [];
    var statusSheet = authSpreadsheet_().getSheetByName(ADM_DB.STATUS_LOG);
    if (statusSheet && statusSheet.getLastRow() > 1) {
      var statusValues = statusSheet.getDataRange().getDisplayValues();
      var statusHeaders = statusValues.shift();
      var ix = {};
      statusHeaders.forEach(function(h,i){ix[h]=i;});
      statusValues.forEach(function(row){
        if (String(row[ix.StudentID]||'') !== String(record.StudentID)) return;
        var oldApp = String(row[ix.OldApplicationStatus]||'');
        var newApp = String(row[ix.NewApplicationStatus]||'');
        var oldEnroll = String(row[ix.OldEnrollStatus]||'');
        var newEnroll = String(row[ix.NewEnrollStatus]||'');
        if (oldApp !== newApp && newApp) timeline.push({
          id:'app:'+row[ix.At]+':'+newApp, at:String(row[ix.At]||''),
          title:'Application status updated', detail:'Your application is now '+newApp+'.', type:'application'
        });
        if (oldEnroll !== newEnroll && newEnroll) timeline.push({
          id:'enroll:'+row[ix.At]+':'+newEnroll, at:String(row[ix.At]||''),
          title:'Enrollment status updated', detail:'Your enrollment status is now '+newEnroll+'.', type:'enrollment'
        });
      });
    }

    var auditSheet = authSpreadsheet_().getSheetByName(ADM_DB.AUDIT);
    if (auditSheet && auditSheet.getLastRow() > 1) {
      var auditValues = auditSheet.getDataRange().getDisplayValues();
      var auditHeaders = auditValues.shift(), ai = {};
      auditHeaders.forEach(function(h,i){ai[h]=i;});
      auditValues.forEach(function(row){
        if (String(row[ai.StudentID]||'') !== String(record.StudentID)) return;
        var action = String(row[ai.Action]||'');
        if (action !== 'requirement-status-updated') return;
        var detail = String(row[ai.Detail]||'');
        timeline.push({
          id:'req:'+row[ai.At]+':'+detail, at:String(row[ai.At]||''),
          title:'Requirement status updated', detail:detail, type:'requirement'
        });
      });
    }

    if (record.CreatedAt) timeline.push({
      id:'submitted:'+record.StudentID, at:String(record.CreatedAt),
      title:'Application submitted', detail:'Your application was received by Moreh Academy.', type:'application'
    });
    timeline.sort(function(a,b){return String(a.at).localeCompare(String(b.at));});

    var rawOwnRecord = admissionDbFindById_(account.studentId);
    var lastStatusAt = rawOwnRecord ? String(rawOwnRecord.StatusChangedAt || rawOwnRecord.CreatedAt || '') : String(record.CreatedAt || '');
    var notifications = [];
    var appStatus = String(record.ApplicationStatus||'Submitted');
    notifications.push({
      id:'application-status:'+appStatus, type:'application',
      title:'Application status: '+appStatus,
      message: appStatus === 'Approved' ? 'Your application has been approved. Please review your enrollment and profile information.'
        : appStatus === 'Declined' ? 'Your application has been declined. Please contact the Admissions Office for assistance.'
        : appStatus === 'Under Review' ? 'Your application is being reviewed by the Admissions Office.'
        : 'Your application has been submitted and is awaiting review.',
      at:lastStatusAt
    });
    (record.RequirementItems||[]).forEach(function(item){
      var st=String(item.status||'Pending Submission');
      if (st === 'Verified' || st === 'Received') return;
      notifications.push({
        id:'requirement:'+item.key+':'+st, type:'requirement',
        title:'Requirement: '+item.label,
        message: st === 'Incomplete' ? 'The Admissions Office marked this requirement incomplete. Please follow the instruction from the school office.'
          : 'This document is still marked '+st+'. Submit the physical document to the Admissions Office.',
        at:String(record.CreatedAt||'')
      });
    });
    (record.Holds||[]).forEach(function(hold,i){
      notifications.push({
        id:'hold:'+hold.Office+':'+i+':'+String(hold.Instruction||''), type:'office',
        title:hold.Office+' office instruction',
        message:String(hold.Instruction||'Please contact the office for instructions.'),
        at:''
      });
    });
    timeline.slice(-8).reverse().forEach(function(event){
      notifications.push({
        id:'event:'+event.id, type:event.type, title:event.title,
        message:event.detail, at:event.at
      });
    });
    notifications.sort(function(a,b){return String(b.at||'').localeCompare(String(a.at||''));});

    return {success:true,message:'Workspace loaded.',data:{
      account:{email:account.email,role:account.role,studentId:record.StudentID,fullName:record.FullName||account.fullName||''},
      application:record,timeline:timeline,notifications:notifications
    }};
  } catch(err) {
    return authFail_(err.message||'Could not load your student workspace.');
  }
}
