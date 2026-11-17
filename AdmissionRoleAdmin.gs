/**
 * AdmissionRoleAdmin.gs
 * Owner-controlled assignment of the dedicated Admissions role.
 *
 * Employees use the existing verified account flow. The Owner must independently verify
 * that an account belongs to an employee before granting Admissions access.
 * No existing Encoder account is automatically upgraded.
 */
var ADM_ROLE = {
  SHEET: 'AdmissionRoleAudit',
  HEADERS: ['RoleAuditID','UserEmail','PreviousRole','NewRole','Action','Reason','ActorEmail','EventAt'],
  ELIGIBLE_ROLES: ['Applicant','Encoder']
};

function admissionRoleSetup_() {
  authRequireEditor_();
  var ss = authSpreadsheet_(), sh = ss.getSheetByName(ADM_ROLE.SHEET);
  if (!sh) {
    sh = ss.insertSheet(ADM_ROLE.SHEET);
    if (sh.getMaxColumns() < ADM_ROLE.HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), ADM_ROLE.HEADERS.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, ADM_ROLE.HEADERS.length).setValues([ADM_ROLE.HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    if (sh.getMaxColumns() < ADM_ROLE.HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), ADM_ROLE.HEADERS.length - sh.getMaxColumns());
    var actual = sh.getRange(1, 1, 1, ADM_ROLE.HEADERS.length).getDisplayValues()[0];
    ADM_ROLE.HEADERS.forEach(function (h, i) {
      if (String(actual[i] || '') !== h) throw new Error('AdmissionRoleAudit schema mismatch at column ' + (i + 1) + '. No records were changed.');
    });
  }
  Logger.log('AdmissionRoleAudit schema is ready. No account roles were changed.');
}

function runAdmissionRoleSetup() {
  admissionRoleSetup_();
}

function admissionRoleAuditSheet_() {
  var sh = authSpreadsheet_().getSheetByName(ADM_ROLE.SHEET);
  if (!sh) throw new Error('Admissions access setup is incomplete. Ask the system owner to run runAdmissionRoleSetup().');
  var actual = sh.getRange(1, 1, 1, ADM_ROLE.HEADERS.length).getDisplayValues()[0];
  ADM_ROLE.HEADERS.forEach(function (h, i) {
    if (String(actual[i] || '') !== h) throw new Error('Admissions role audit schema is invalid. Contact the system owner.');
  });
  return sh;
}

function admissionRoleAuditRows_() {
  var sh = admissionRoleAuditSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, ADM_ROLE.HEADERS.length).getValues(), out = [];
  values.forEach(function (row, index) {
    if (!row[0]) return;
    var item = { _row: index + 2 };
    ADM_ROLE.HEADERS.forEach(function (h, i) { item[h] = row[i] == null ? '' : String(row[i]); });
    out.push(item);
  });
  return out;
}

function admissionRoleClean_(value, max) {
  return String(value == null ? '' : value).replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

/** Owner-only list. Returns no password, OTP, token, or other authentication secrets. */
function admissionRoleListAccounts(token) {
  try {
    authRequireRole_(token, ['Owner']);
    admissionRoleAuditSheet_();
    var data = authAllUsers_().filter(function (u) {
      return ['Applicant','Encoder','Admissions'].indexOf(u.role) >= 0;
    }).map(function (u) {
      return { email: u.email, fullName: u.name || '', role: u.role, status: u.status };
    }).sort(function (a, b) { return a.email.localeCompare(b.email); });
    return { success: true, data: data };
  } catch (err) {
    return authFail_(err.message || 'Could not load Admissions account access.');
  }
}

/**
 * Owner-only grant/revoke. A role change increments TokenVersion so every prior session
 * for the affected account becomes invalid on its next request.
 */
function admissionRoleSetAdmissionsAccess(token, targetEmail, enabled, reason) {
  var owner, target, previousRole, newRole, action, now;
  try {
    owner = authRequireRole_(token, ['Owner']);
    targetEmail = authEmail_(targetEmail);
    if (!targetEmail || typeof enabled !== 'boolean') throw new Error('Select a valid account and access action.');
    reason = admissionRoleClean_(reason, 500);
    if (reason.length < 10) throw new Error('Enter a documented reason of at least 10 characters.');

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    try {
      owner = authRequireRole_(token, ['Owner']);
      admissionRoleAuditSheet_();
      var all = authAllUsers_();
      target = all.filter(function (u) { return u.email === targetEmail; })[0];
      if (!target) throw new Error('The account was not found.');
      if (target.role === 'Owner' || targetEmail === owner.email) throw new Error('Owner accounts cannot be changed here.');

      previousRole = target.role;
      if (enabled) {
        if (target.status !== 'Active') throw new Error('Only an active, email-verified account can receive Admissions access.');
        if (target.studentId) throw new Error('A student-linked account cannot be converted to an Admissions staff account. Use a separate verified employee account.');
        if (ADM_ROLE.ELIGIBLE_ROLES.indexOf(target.role) < 0) {
          if (target.role === 'Admissions') throw new Error('This account already has Admissions access.');
          throw new Error('Only existing Applicant or Encoder accounts can be granted Admissions access.');
        }
        newRole = 'Admissions';
        action = 'GRANT_ADMISSIONS';
      } else {
        if (target.role !== 'Admissions') throw new Error('This account does not currently have Admissions access.');
        var history = admissionRoleAuditRows_();
        var grants = history.filter(function (r) {
          return r.UserEmail === targetEmail && r.Action === 'GRANT_ADMISSIONS';
        });
        var lastGrant = grants.length ? grants[grants.length - 1] : null;
        if (!lastGrant || ADM_ROLE.ELIGIBLE_ROLES.indexOf(lastGrant.PreviousRole) < 0) {
          throw new Error('The original role cannot be safely restored from the audit history. Ask the system owner to review this account manually.');
        }
        newRole = lastGrant.PreviousRole;
        action = 'REVOKE_ADMISSIONS';
      }

      var sh = authSheet_(), roleCol = AUTH.HEADERS.indexOf('Role'), versionCol = AUTH.HEADERS.indexOf('TokenVersion');
      if (roleCol < 0 || versionCol < 0) throw new Error('Users schema is missing required authentication columns.');
      var userRange = sh.getRange(target.row, 1, 1, AUTH.HEADERS.length);
      var userValues = userRange.getValues()[0];
      userValues[roleCol] = newRole;
      userValues[versionCol] = (Number(target.tv) || 1) + 1;

      now = new Date().toISOString();
      var audit = {
        RoleAuditID: Utilities.getUuid(), UserEmail: targetEmail,
        PreviousRole: previousRole, NewRole: newRole, Action: action,
        Reason: reason, ActorEmail: owner.email, EventAt: now
      };
      var auditSheet = admissionRoleAuditSheet_(), row = ADM_ROLE.HEADERS.map(function (h) { return audit[h] || ''; });
      var auditRow = auditSheet.getLastRow() + 1;
      auditSheet.getRange(auditRow, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      try {
        userRange.setValues([userValues]);
      } catch (writeError) {
        auditSheet.deleteRow(auditRow);
        throw writeError;
      }
    } finally {
      lock.releaseLock();
    }
    authAudit_(targetEmail, action, 'Actor=' + owner.email);
    return { success: true, message: enabled ? 'Admissions access granted. The account must sign in again.' : 'Admissions access revoked. The account must sign in again.' };
  } catch (err) {
    return authFail_(err.message || 'Could not update Admissions access.');
  }
}
