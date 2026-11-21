/**
 * AdmissionHolds.gs
 *
 * Office holds (Guidance / Accounting / Academic) carried over from the old portal's Flags.gs.
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
 * NOT DONE YET: office-account sign-in (Guidance / Accounting / Academic). Do NOT add those roles to
 * AUTH.ROLES yet: admissionPortalGetBootstrap and the search/record functions only admit Owner and Encoder.
 * Until that is done, Owner and Encoder raise and clear holds on the offices' behalf.
 * ------------------------------------------------------------------------------------------------
 * 4) Run setupAdmissionHolds() once from the editor.
 */

var ADM_HOLDS = {
  SHEET: 'AdmissionHolds',
  HEADERS: ['HoldID', 'StudentID', 'Office', 'Status', 'Reason', 'Instruction', 'RaisedBy', 'RaisedAt', 'ClearedBy', 'ClearedAt'],
  OFFICES: ['Guidance', 'Accounting', 'Academic'],
  ROLES: ['Owner', 'Encoder', 'Guidance', 'Accounting', 'Academic']
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
    if (ADM_HOLDS.OFFICES.indexOf(office) < 0) throw new Error('Choose Guidance, Accounting or Academic.');
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

/** Staff view: active holds for one learner (includes the internal reason). */
function admissionHoldList(token, studentId) {
  try {
    authRequireRole_(token, ADM_HOLDS.ROLES);
    studentId = String(studentId || '').trim();
    var list = admissionHoldsRows_().filter(function (h) { return h.StudentID === studentId && h.Status === 'Active'; });
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