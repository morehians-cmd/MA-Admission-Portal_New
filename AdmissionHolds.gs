/**
 * AdmissionHolds.gs
 *
 * Office holds (Guidance / Accounting) carried over from the old portal's Flags.gs.
 * An ACTIVE hold blocks EnrollStatus "Enrolled". Owner/Encoder can still use "Temporary" enrollment
 * (already in admissionPortalSetStatus: reason + end date + 120-day cap + expiry trigger).
 * The portal never stores amounts. Accounting only marks "hold" or "cleared".
 *
 * Uses only what already exists in this project:
 *   authRequireRole_, authFail_, authSpreadsheet_, authRequireEditor_, admissionDbEnsureSchemaSheet_,
 *   admissionDbFindById_, admissionDbCleanText_, admissionDbAudit_, maAdmissionSpeedRecords_.
 *
 * ------------------------------------------------------------------------------------------------
 * INSTALL (the edits are already made in the MAAdmissionPortal.gs and AdmissionDb.gs delivered with this file)
 *   1) Replace MAAdmissionPortal.gs and AdmissionDb.gs with the delivered versions.
 *        - admissionPortalSetStatus: refuses "Enrolled" while a hold is active (Temporary is still allowed).
 *        - admissionGetMyApplication: adds record.Holds (office + instruction only, never the reason).
 *      Both calls check that this file exists first, so nothing breaks if it is not installed yet.
 *   2) Add this file (AdmissionHolds.gs) to the project.
 *   3) Replace MAAdmissionPage.html with the delivered version.
 *
 * OFFICE ACCOUNTS (Guidance, Accounting): these two roles are now in AUTH.ROLES (Auth.gs). They can sign in and
 * reach ONLY the functions in this file (the "Holds Desk"). Every other server function still admits only
 * Owner/Encoder (or Applicant/Student), so the rest of the system stays closed to them. Owner/Encoder still raise and
 * clear holds on the offices' behalf. The Owner creates office accounts in AdmissionOfficeAccounts.gs.
 * The Academic office was removed. Any leftover active 'Academic' hold would still block "Enrolled"; the Owner/Encoder can clear it.
 * ------------------------------------------------------------------------------------------------
 * 4) Run setupAdmissionHolds() once from the editor.
 */

var ADM_HOLDS = {
  SHEET: 'AdmissionHolds',
  HEADERS: ['HoldID', 'StudentID', 'Office', 'Status', 'Reason', 'Instruction', 'RaisedBy', 'RaisedAt', 'ClearedBy', 'ClearedAt'],
  OFFICES: ['Guidance', 'Accounting'],
  ROLES: ['Owner', 'Encoder', 'Guidance', 'Accounting'],
  SEARCH_MIN: 3, SEARCH_MAX: 20
};

/** Run ONCE from the editor. Creates the sheet only; never touches existing data. */
function setupAdmissionHolds() {
  authRequireEditor_();
  admissionDbEnsureSchemaSheet_(authSpreadsheet_(), ADM_HOLDS.SHEET, ADM_HOLDS.HEADERS);
  Logger.log('AdmissionHolds sheet is ready.');
}

/* ---------------- internal ---------------- */

function admissionHoldsRows_() {
  var sh = authSpreadsheet_().getSheetByName(ADM_HOLDS.SHEET);
  if (!sh) return [];                                   // not set up yet = no holds exist
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, ADM_HOLDS.HEADERS.length).getDisplayValues().map(function (v, i) {
    var o = { _row: i + 2 };
    ADM_HOLDS.HEADERS.forEach(function (h, j) { o[h] = String(v[j] || ''); });
    return o;
  });
}

/** { StudentID: ['Accounting', ...] } for ACTIVE holds. One sheet read, safe to call once per batch. */
function admissionHoldsMap_() {
  var map = {};
  admissionHoldsRows_().forEach(function (h) {
    if (h.Status !== 'Active') return;
    (map[h.StudentID] = map[h.StudentID] || []).push(h.Office);
  });
  return map;
}

/** What an applicant/student may see: office and instruction only. Never throws. */
function admissionHoldsForApplicant_(studentId) {
  try {
    return admissionHoldsRows_().filter(function (h) { return h.StudentID === studentId && h.Status === 'Active'; })
      .map(function (h) { return { Office: h.Office, Instruction: h.Instruction }; });
  } catch (e) { return []; }
}

function admissionHoldOwnOffice_(account) {
  return ADM_HOLDS.OFFICES.indexOf(account.role) >= 0 ? account.role : '';
}

/* ---------------- browser-facing ---------------- */

function admissionHoldRaise(token, studentId, office, reason, instruction) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ADM_HOLDS.ROLES);
    var own = admissionHoldOwnOffice_(actor);
    office = String(office || own).trim();
    if (ADM_HOLDS.OFFICES.indexOf(office) < 0) throw new Error('Choose Guidance or Accounting.');
    if (own && own !== office) throw new Error('You can only raise holds for your own office.');
    studentId = String(studentId || '').trim();
    reason = admissionDbCleanText_(reason, 200);
    instruction = admissionDbCleanText_(instruction, 200);
    if (!reason) throw new Error('A reason is required (staff only).');
    if (!instruction) throw new Error('An instruction for the student is required.');
    if (!admissionDbFindById_(studentId)) throw new Error('Admission record not found.');

    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');

    var dup = admissionHoldsRows_().some(function (h) { return h.StudentID === studentId && h.Office === office && h.Status === 'Active'; });
    if (dup) throw new Error(office + ' already has an active hold on this learner.');

    var sh = authSpreadsheet_().getSheetByName(ADM_HOLDS.SHEET);
    if (!sh) throw new Error('Holds are not set up yet. Run setupAdmissionHolds() once from the editor.');
    var id = 'H-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    sh.getRange(sh.getLastRow() + 1, 1, 1, ADM_HOLDS.HEADERS.length).setNumberFormat('@')
      .setValues([[id, studentId, office, 'Active', reason, instruction, actor.email, new Date().toISOString(), '', '']]);
    admissionDbAudit_(actor.email, 'hold-raised', studentId, office + ': ' + reason);
    return { success: true, message: 'Hold raised.', data: { holdId: id } };
  } catch (err) {
    return authFail_(err.message || 'Could not raise the hold.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function admissionHoldClear(token, holdId) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ADM_HOLDS.ROLES);
    var own = admissionHoldOwnOffice_(actor);
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');

    var hold = admissionHoldsRows_().filter(function (h) { return h.HoldID === String(holdId || '').trim() && h.Status === 'Active'; })[0];
    if (!hold) throw new Error('Active hold not found.');
    if (own && own !== hold.Office) throw new Error('Only ' + hold.Office + ' (or the Owner/Encoder) can clear this hold.');

    var sh = authSpreadsheet_().getSheetByName(ADM_HOLDS.SHEET);
    var col = ADM_HOLDS.HEADERS.indexOf('Status') + 1;
    sh.getRange(hold._row, col, 1, 1).setValue('Cleared');
    sh.getRange(hold._row, ADM_HOLDS.HEADERS.indexOf('ClearedBy') + 1, 1, 2).setNumberFormat('@').setValues([[actor.email, new Date().toISOString()]]);
    admissionDbAudit_(actor.email, 'hold-cleared', hold.StudentID, hold.Office);
    return { success: true, message: 'Hold cleared.', data: { holdId: hold.HoldID } };
  } catch (err) {
    return authFail_(err.message || 'Could not clear the hold.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/** Staff view: active holds for one learner (includes the internal reason). Office accounts get only their own office's holds. */
function admissionHoldList(token, studentId) {
  try {
    var actor = authRequireRole_(token, ADM_HOLDS.ROLES);
    var own = admissionHoldOwnOffice_(actor);   // an office account sees only its own office's holds
    studentId = String(studentId || '').trim();
    var list = admissionHoldsRows_().filter(function (h) { return h.StudentID === studentId && h.Status === 'Active' && (!own || h.Office === own); });
    list.forEach(function (h) { delete h._row; });
    return { success: true, message: 'Holds loaded.', data: list };
  } catch (err) {
    return authFail_(err.message || 'Could not load holds.');
  }
}

/** Staff view: every active hold with the learner's name, for the Holds desk. */
function admissionHoldsOverview(token) {
  try {
    var actor = authRequireRole_(token, ADM_HOLDS.ROLES);
    var own = admissionHoldOwnOffice_(actor);
    var names = {};
    maAdmissionSpeedRecords_().forEach(function (r) { names[r.StudentID] = r; });
    var list = admissionHoldsRows_().filter(function (h) { return h.Status === 'Active' && (!own || h.Office === own); })
      .slice(0, 300).map(function (h) {
        var r = names[h.StudentID] || {};
        return { HoldID: h.HoldID, StudentID: h.StudentID, FullName: r.FullName || '', GradeLevel: r.GradeLevel || '',
                 Office: h.Office, Reason: h.Reason, Instruction: h.Instruction, RaisedBy: h.RaisedBy, RaisedAt: h.RaisedAt };
      });
    return { success: true, message: 'Holds loaded.', data: { office: own, holds: list } };
  } catch (err) {
    return authFail_(err.message || 'Could not load holds.');
  }
}

/**
 * Holds Desk learner search for office accounts (and Owner/Encoder).
 * Needs at least 3 characters. Matches ONLY on name or Student ID and returns ONLY {StudentID, FullName, GradeLevel}:
 * never the LRN, birthdate, contact details, status or documents. LRN/email are deliberately not searchable.
 */
function admissionHoldsDeskSearch(token, q) {
  try {
    authRequireRole_(token, ADM_HOLDS.ROLES);
    q = String(q == null ? '' : q).trim().toLowerCase().replace(/\s+/g, ' ');
    if (q.length < ADM_HOLDS.SEARCH_MIN) throw new Error('Type at least ' + ADM_HOLDS.SEARCH_MIN + ' characters to search.');
    var out = [];
    var rows = maAdmissionSpeedRecords_();
    for (var i = 0; i < rows.length && out.length < ADM_HOLDS.SEARCH_MAX; i++) {
      var r = rows[i];
      if ((String(r.StudentID || '') + ' ' + String(r.FullName || '')).toLowerCase().indexOf(q) >= 0) {
        out.push({ StudentID: String(r.StudentID || ''), FullName: String(r.FullName || ''), GradeLevel: String(r.GradeLevel || '') });
      }
    }
    return { success: true, message: out.length ? 'Learners found.' : 'No learner matches that search.', data: out };
  } catch (err) {
    return authFail_(err.message || 'Could not search learners.');
  }
}