/**
 * AdmissionIdCard.gs
 * ID-card support for the destination admission system.
 * TLC Scholar, TLC-OVAP and TLC-ESC share the same TLC ID eligibility.
 * The TLC number is staff-confirmed; it is never generated from StudentID.
 */
var ADM_IDCARD = {
  CATEGORIES: ['TLC Scholar', 'TLC-OVAP', 'TLC-ESC'],
  NUMBER_RE: /^TLC\d{4}-\d{4}$/,
  MAX_PHOTO_BYTES: 1024 * 1024,
  ART_SLOTS: ['front', 'back', 'STEM', 'ASSH', 'BE', 'ICT', 'HT']
};

function admissionIdCardIsTlc_(category) {
  return ADM_IDCARD.CATEGORIES.indexOf(String(category || '').trim()) >= 0;
}

function admissionIdCardFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('ADM_ID_PHOTO_FOLDER_ID');
  if (!id) throw new Error('ADM_ID_PHOTO_FOLDER_ID is not configured.');
  return DriveApp.getFolderById(id);
}

function admissionIdCardJpeg_(dataUrl, maxBytes) {
  var bytes = Utilities.base64Decode(String(dataUrl || '').split(',')[1] || '');
  if (!bytes.length || bytes.length > maxBytes) throw new Error('The image is empty or too large.');
  if ((bytes[0] & 255) !== 0xFF || (bytes[1] & 255) !== 0xD8) throw new Error('The image must be a JPEG.');
  return bytes;
}

function admissionIdCardHighest_(year) {
  var sh = admissionDbSheet_(), col = ADM_DB.HEADERS.indexOf('IDNumber') + 1, last = sh.getLastRow(), best = '';
  if (last < 2) return '';
  var prefix = 'TLC' + year + '-', vals = sh.getRange(2, col, last - 1, 1).getDisplayValues().flat();
  var max = -1;
  vals.forEach(function(v) {
    v = String(v || '');
    if (v.indexOf(prefix) === 0) { var n = parseInt(v.slice(prefix.length), 10); if (n > max) { max = n; best = v; } }
  });
  return best;
}

function admissionIdCardData(token, studentId) {
  try {
    var actor = authRequireRole_(token, ['Owner', 'Encoder']);
    var hit = admissionDbFindById_(String(studentId || ''));
    if (!hit) throw new Error('Learner not found.');
    var data = {
      StudentID: hit.StudentID, FullName: hit.FullName, IDNumber: hit.IDNumber || '',
      Photo: hit.IDPhotoID ? DriveApp.getFileById(hit.IDPhotoID).getBlob().getAs('image/jpeg').getBytes() : '',
      LastAssigned: admissionIdCardHighest_(String(hit.SchoolYear || '').slice(0, 4) || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy'))
    };
    if (actor.role === 'Owner') {
      data.Category = hit.Category;
      data.Eligible = admissionIdCardIsTlc_(hit.Category);
      data.ClaimedIDNumber = hit.ClaimedIDNumber || '';
    }
    return { success: true, message: 'ID card data loaded.', data: data };
  } catch (e) { return authFail_(e.message || 'Could not load ID card data.'); }
}

function admissionIdCardSaveNumber(token, studentId, number) {
  var lock = LockService.getScriptLock();
  try {
    authRequireRole_(token, ['Owner', 'Encoder']);
    lock.waitLock(20000);
    var hit = admissionDbFindById_(String(studentId || ''));
    if (!hit) throw new Error('Learner not found.');
    if (!admissionIdCardIsTlc_(hit.Category)) throw new Error('ID cards are available only to TLC Scholar, TLC-OVAP and TLC-ESC learners.');
    var n = String(number || '').trim().toUpperCase();
    if (!ADM_IDCARD.NUMBER_RE.test(n)) throw new Error('The TLC ID must look like TLC2027-0001.');
    var year = parseInt(n.slice(3, 7), 10), activeYear = parseInt(String(hit.SchoolYear || '').slice(0, 4), 10) || new Date().getFullYear();
    if (year < 2018 || year > activeYear + 1) throw new Error('The year in the TLC ID is outside the allowed range.');
    var sh = admissionDbSheet_(), col = ADM_DB.HEADERS.indexOf('IDNumber') + 1, vals = sh.getRange(2, col, Math.max(0, sh.getLastRow() - 1), 1).getDisplayValues().flat();
    vals.forEach(function(v, i) { if (String(v || '').toUpperCase() === n && i + 2 !== hit._row) throw new Error(n + ' is already assigned to another learner.'); });
    sh.getRange(hit._row, col).setNumberFormat('@').setValue(n);
    admissionDbAudit_(authResolveSession_(token).email, 'idcard-number-confirmed', hit.StudentID, (hit.IDNumber ? hit.IDNumber + ' -> ' : '') + n);
    return { success: true, message: 'TLC ID number saved.', data: { idNumber: n } };
  } catch (e) { return authFail_(e.message || 'Could not save the TLC ID.'); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}

function admissionIdCardSavePhoto(token, studentId, dataUrl) {
  var lock = LockService.getScriptLock();
  try {
    authRequireRole_(token, ['Owner', 'Encoder']);
    lock.waitLock(20000);
    var hit = admissionDbFindById_(String(studentId || ''));
    if (!hit) throw new Error('Learner not found.');
    if (!admissionIdCardIsTlc_(hit.Category)) throw new Error('ID cards are available only to TLC-family learners.');
    var bytes = admissionIdCardJpeg_(dataUrl, ADM_IDCARD.MAX_PHOTO_BYTES), folder = admissionIdCardFolder_();
    var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', hit.StudentID + '_idphoto.jpg'));
    var sh = admissionDbSheet_(), col = ADM_DB.HEADERS.indexOf('IDPhotoID') + 1;
    sh.getRange(hit._row, col).setNumberFormat('@').setValue(file.getId());
    if (hit.IDPhotoID) { try { DriveApp.getFileById(hit.IDPhotoID).setTrashed(true); } catch (_) {} }
    var actor = authResolveSession_(token).email;
    admissionDbAudit_(actor, 'idcard-photo-updated', hit.StudentID, 'ID photo replaced');
    return { success: true, message: 'ID photo saved.', data: { fileId: file.getId() } };
  } catch (e) { return authFail_(e.message || 'Could not save the ID photo.'); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}

function admissionIdCardSaveArtwork(token, slot, dataUrl) {
  try {
    authRequireRole_(token, ['Owner']);
    if (ADM_IDCARD.ART_SLOTS.indexOf(slot) < 0) throw new Error('Unknown ID artwork slot.');
    var bytes = admissionIdCardJpeg_(dataUrl, 1500 * 1024), folder = admissionIdCardFolder_(), pr = PropertiesService.getScriptProperties();
    var key = 'ADM_ID_ART_' + slot, old = pr.getProperty(key), file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', key + '.jpg'));
    pr.setProperty(key, file.getId());
    if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (_) {} }
    admissionDbAudit_(authResolveSession_(token).email, 'idcard-artwork-updated', '', slot);
    return { success: true, message: 'ID artwork saved.', data: { fileId: file.getId() } };
  } catch (e) { return authFail_(e.message || 'Could not save ID artwork.'); }
}
