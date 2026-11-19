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
      } catch (dashboardErr) {
        // Keep the Admissions page usable even if an analytics-only calculation fails.
        // The compact speed dashboard is the safe fallback; the detailed dashboard can
        // be diagnosed without blocking the whole Admissions Personnel screen.
        console.error('Admission dashboard analytics failed: ' + (dashboardErr.message || dashboardErr));
        data.stats = maAdmissionSpeedDashboard_();
        data.stats.byApplicationStatus = {};
        data.stats.pipeline = {};
        data.stats.trend = [];
        data.stats.recent = [];
        data.stats.needsAction = [];
        data.stats.needsActionTotal = 0;
        data.stats.byGradeCluster = {};
        data.stats.bySex = {};
        data.stats.byPreviousSchool = {};
        data.stats.byScholarship = {};
        data.stats.role = account.role;
        data.stats.dashboardWarning = 'Detailed dashboard analytics are temporarily unavailable.';
      }
    }
    return { success: true, message: 'Admission portal loaded.', data: data };
  } catch (err) {
    return authFail_(err.message || 'Could not load the admission portal.');
  }
}

function admissionPortalSearch(token, q, status, applicationStatus, limit, grade, sy) {
  try {
    authRequireRole_(token, ['Encoder', 'Owner']);
    q = String(q == null ? '' : q).trim().toLowerCase();
    status = String(status == null ? '' : status).trim();
    applicationStatus = String(applicationStatus == null ? '' : applicationStatus).trim();
    grade = String(grade == null ? '' : grade).trim();
    sy = String(sy == null ? '' : sy).trim();
    limit = Math.max(1, Math.min(100, Number(limit || 25)));
    var rows = maAdmissionSpeedRecords_().filter(function (r) {
      if (status && r.EnrollStatus !== status) return false;
      if (applicationStatus && String(r.ApplicationStatus || 'Submitted') !== applicationStatus) return false;
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

function admissionPortalReport(token, reportType, reportValue) {
  try {
    authRequireRole_(token, ['Encoder', 'Owner']);
    reportType = String(reportType || 'Grade Level').trim();
    reportValue = String(reportValue || '').trim();
    var rows = admissionDbRows_();
    var groups = {};
    function keyFor(r) {
      if (reportType === 'Grade Level') return String(r.GradeLevel || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Admission Category') return String(r.Category || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Enrollment Status') return String(r.EnrollStatus || 'Not Enrolled').trim() || 'Not Enrolled';
      if (reportType === 'Application Status') return String(r.ApplicationStatus || 'Submitted').trim() || 'Submitted';
      if (reportType === 'Previous School') return String(r.PrevSchool || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Sex') return String(r.SexualOrient || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Gender') return String(r.GenderOrient || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Previous Scholarship') return String(r.PrevScholarship || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Classification') return String(r.Classification || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Cluster') return String(r.Cluster || 'Unspecified').trim() || 'Unspecified';
      if (reportType === 'Section') return String(r.Section || 'Unspecified').trim() || 'Unspecified';
      return 'Unspecified';
    }
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
    authRequireRole_(token, ['Encoder', 'Owner']);
    reportType = String(reportType || 'Admission Daily').trim();
    gradeLevel = String(gradeLevel || '').trim();
    section = String(section || '').trim();

    var rows = admissionDbRows_().filter(function(r) {
      if (gradeLevel && String(r.GradeLevel || '').trim() !== gradeLevel) return false;
      if (section === '(none)' && String(r.Section || '').trim() !== '') return false;
      if (section && section !== '(none)' && String(r.Section || '').trim() !== section) return false;
      return true;
    });

    function active(r) {
      return String(r.EnrollStatus || 'Not Enrolled') !== 'Cancelled' &&
             String(r.EnrollStatus || 'Not Enrolled') !== 'Transferred Out';
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
    authRequireRole_(token, ['Encoder', 'Owner']);
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
    function valueFor(r) {
      var value = r[allowed[reportType]];
      if (reportType === 'Enrollment Status') value = value || 'Not Enrolled';
      else if (reportType === 'Application Status') value = value || 'Submitted';
      return String(value == null ? '' : value).trim() || 'Unspecified';
    }
    if (reportValue) {
      rows = rows.filter(function(r) {
        return valueFor(r).toLowerCase() === reportValue.toLowerCase();
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
        Category: r.Category || '',
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
    authRequireRole_(token, ['Encoder', 'Owner']);
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
    function valueFor(r, label) {
      var key = allowed[label], value = r[key];
      if (label === 'Enrollment Status') value = value || 'Not Enrolled';
      else if (label === 'Application Status') value = value || 'Submitted';
      return String(value == null ? '' : value).trim() || 'Unspecified';
    }

    var colSet = {}, matrix = {};
    rows.forEach(function(r) {
      var rowKey = valueFor(r, rowDimension), colKey = valueFor(r, columnDimension);
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
      totals[colKey] = rows.reduce(function(n,r){ return n + (valueFor(r, columnDimension) === colKey ? 1 : 0); }, 0);
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
    authRequireRole_(token, ['Encoder', 'Owner']);
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
        Category: r.Category, ApplicationStatus: as, EnrollStatus: es
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

function admissionPortalDashboard_(role) {
  var rows = maAdmissionSpeedRecords_();
  var byStatus = {}, byApplicationStatus = {}, byGrade = {}, byCategory = {}, byCluster = {},
      bySex = {}, byPrevSchool = {}, byScholarship = {}, recent = [], needsAction = [],
      needsActionTotal = 0, today = new Date(), trend = [];

  function inc(map, key) {
    key = String(key || 'Unspecified').trim() || 'Unspecified';
    map[key] = (map[key] || 0) + 1;
  }
  function dayKey(d) {
    return Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd');
  }
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

  var requirementStatusFields = [
    'ReqSF9InitialStatus','ReqSF9CompletionStatus','ReqBirthInitialStatus',
    'ReqBirthCompletionStatus','ReqPhotoStatus','ReqEnvelopeStatus',
    'ReqF137Status','ReqMoralStatus','ReqJHSStatus','ReqTransfereeStatus','ReqConsentStatus'
  ];
  var certificateCategories = ['ESC','TLC','PUB-QVR','QVA PASSER'];

  rows.forEach(function (r) {
    var s = r.EnrollStatus || 'Unspecified';
    var a = r.ApplicationStatus || 'Submitted';
    inc(byStatus, s);
    inc(byApplicationStatus, a);
    inc(byGrade, r.GradeLevel);
    inc(byCategory, r.Category);
    inc(bySex, r.SexualOrient);
    inc(byPrevSchool, r.PrevSchool);
    if (r.PrevScholarship) inc(byScholarship, r.PrevScholarship);
    if (r.Cluster) inc(byCluster, (r.GradeLevel || 'Unspecified') + ' · ' + r.Cluster);

    var created = parseDate(r.CreatedAt);
    if (created) {
      var dk = dayKey(created);
      if (trendIndex[dk] != null) trend[trendIndex[dk]].count++;
    }

    var reason = '';
    var incomplete = requirementStatusFields.some(function (f) {
      var v = String(r[f] || '');
      return v === 'Incomplete' || v === 'Pending Submission';
    });
    var consentMissing = String(r.ReqConsentStatus || '') !== 'Verified' &&
                         String(r.ReqConsentStatus || '') !== 'Received';
    var certMissing = certificateCategories.indexOf(String(r.Category || '').toUpperCase()) >= 0 &&
                      !String(r.CertNo || r.VoucherCertNo || r.EscCertNo || '').trim();

    if (a === 'Submitted') reason = 'Waiting for initial review';
    else if (a === 'Under Review' && consentMissing) reason = 'Consent document needs verification';
    else if (a === 'Under Review' && incomplete) reason = 'Incomplete requirements need follow-up';
    else if (a === 'Under Review' && certMissing) reason = 'Scholarship certificate number is missing';
    else if (a === 'Approved' && String(s) !== 'Enrolled') reason = 'Ready for enrollment processing';

    if (reason) {
      needsActionTotal++;
      if (needsAction.length < 20) {
        needsAction.push({
          StudentID: r.StudentID,
          FullName: r.FullName,
          GradeLevel: r.GradeLevel,
          Category: r.Category,
          ApplicationStatus: a,
          EnrollStatus: s,
          Reason: reason
        });
      }
    }
  });

  rows.slice().sort(function(a,b){ return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); });
  recent = rows.slice().sort(function(a,b){ return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); })
    .slice(0, 5).map(function(r) {
      return { StudentID:r.StudentID, FullName:r.FullName, GradeLevel:r.GradeLevel,
        Category:r.Category, ApplicationStatus:r.ApplicationStatus || 'Submitted',
        CreatedAt:r.CreatedAt };
    });

  var pipeline = {
    'Not Enrolled': Number(byStatus['Not Enrolled'] || 0),
    'Enrolled': Number(byStatus.Enrolled || 0),
    'Temporary': Number(byStatus.Temporary || 0),
    'Transferred': Number(byStatus.Transferred || byStatus['Transferred Out'] || 0),
    'Cancelled': Number(byStatus.Cancelled || 0)
  };

  var gradeCluster = {};
  Object.keys(byCluster).forEach(function(k) {
    var parts = k.split(' · ');
    var grade = parts.shift() || 'Unspecified';
    var cluster = parts.join(' · ') || 'Unspecified';
    if (!gradeCluster[grade]) gradeCluster[grade] = {};
    gradeCluster[grade][cluster] = byCluster[k];
  });

  return {
    total: rows.length,
    byStatus: byStatus,
    byApplicationStatus: byApplicationStatus,
    byGrade: byGrade,
    byCategory: byCategory,
    pipeline: pipeline,
    trend: trend,
    recent: recent,
    needsAction: needsAction,
    needsActionTotal: needsActionTotal,
    byGradeCluster: gradeCluster,
    bySex: bySex,
    byPreviousSchool: byPrevSchool,
    byScholarship: byScholarship,
    role: role
  };
}

function admissionPortalPublicRecord_(r) {
  return {
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
}
