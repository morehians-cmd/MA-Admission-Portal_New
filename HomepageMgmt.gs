/**
 * HomepageMgmt.gs - Phase 2 backend: homepage content in Google Sheets (draft vs published) and images in Drive.
 * Sheet "HomepageContent": one row per section -> Section | Draft | Published | DraftUpdatedAt | DraftUpdatedBy | PublishedAt | PublishedBy
 * Sheet "HomepageHistory": append-only log of every publish (for rollback).
 * Public visitors can call ONLY getPublishedHomepage(). Every other function checks hpAssertAdmin_().
 */
var HP = {
  SHEET: 'HomepageContent', HISTORY: 'HomepageHistory', FOLDER: 'MorehAcademy_Website_Images',
  SECTIONS: ['masthead', 'hero', 'values', 'admission', 'about', 'programs', 'news', 'footer', 'display'],
  LIMITS: { ids: 3, slides: 6, items: 12, steps: 12 },
  MAX_IMG: 3 * 1024 * 1024, MIME: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
};

/* ---------- Authorization ---------- */
/**
 * INTEGRATION POINT. Fails closed. Default rule: the signed-in Google account must be listed in the
 * Script Property HP_ADMIN_EMAILS (comma separated). Replace the body with your portal's Owner/Encoder
 * session check once wired; keep it throwing when the caller is not an authorized administrator.
 */
function hpAssertAdmin_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  var list = (PropertiesService.getScriptProperties().getProperty('HP_ADMIN_EMAILS') || '')
    .toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!email || list.indexOf(email) < 0) throw new Error('Not authorized.');
  return email;
}

/* ---------- Sheet helpers ---------- */
function hpSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function hpSheet_() {
  var ss = hpSpreadsheet_(), sh = ss.getSheetByName(HP.SHEET);
  if (!sh) {
    sh = ss.insertSheet(HP.SHEET);
    sh.appendRow(['Section', 'Draft', 'Published', 'DraftUpdatedAt', 'DraftUpdatedBy', 'PublishedAt', 'PublishedBy']);
    sh.setFrozenRows(1);
    HP.SECTIONS.forEach(function (k) { sh.appendRow([k, '', '', '', '', '', '']); });
  }
  return sh;
}
function hpRows_() {
  var v = hpSheet_().getDataRange().getValues(), o = {};
  for (var i = 1; i < v.length; i++) o[v[i][0]] = { row: i + 1, draft: v[i][1], pub: v[i][2], dAt: v[i][3], pAt: v[i][5] };
  return o;
}
function hpRowFor_(sh, rows, section) {
  if (rows[section]) return rows[section].row;
  sh.appendRow([section, '', '', '', '', '', '']);
  return sh.getLastRow();
}
function hpParse_(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/* ---------- Validation ---------- */
function hpClean_(v, depth) {
  if (depth > 6) throw new Error('Content is nested too deeply.');
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    var t = v.trim().slice(0, 3000);
    if (/^\s*(javascript|data|vbscript):/i.test(t)) throw new Error('A link or image address is not allowed.');
    return t;
  }
  if (Array.isArray(v)) {
    if (v.length > 50) throw new Error('Too many items.');
    return v.map(function (x) { return hpClean_(x, depth + 1); });
  }
  if (typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function (k) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) throw new Error('Invalid field name.');
      o[k] = hpClean_(v[k], depth + 1);
    });
    return o;
  }
  throw new Error('Unsupported value.');
}
function hpValidate_(section, d) {
  var L = HP.LIMITS;
  if (section === 'masthead' && d.ids && d.ids.length > L.ids) throw new Error('At most 3 institutions.');
  if (section === 'hero') {
    if (d.slides && d.slides.length > L.slides) throw new Error('Too many carousel images.');
    if (d.intervalMs != null && (d.intervalMs < 3000 || d.intervalMs > 15000)) throw new Error('Slide time must be 3000 to 15000 ms.');
  }
  if (section === 'values' && d.items && d.items.length > 8) throw new Error('At most 8 values.');
  if (section === 'admission' && d.steps && d.steps.length > L.steps) throw new Error('At most 12 steps.');
  if ((section === 'programs' || section === 'news') && d.items && d.items.length > L.items) throw new Error('Too many items.');
  if (section === 'footer' && d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new Error('Enter a valid email address.');
  if (JSON.stringify(d).length > 45000) throw new Error('Content is too large for one section.');
}

/* ---------- Public ---------- */
/** Published content only. Safe for anonymous visitors. Cached 5 minutes. */
function getPublishedHomepage() {
  var cache = CacheService.getScriptCache(), hit = cache.get('hp_pub');
  if (hit) return JSON.parse(hit);
  var rows = hpRows_(), out = { sections: {}, publishedAt: '' };
  Object.keys(rows).forEach(function (k) {
    var d = hpParse_(rows[k].pub);
    if (d) { out.sections[k] = d; if (String(rows[k].pAt) > out.publishedAt) out.publishedAt = String(rows[k].pAt); }
  });
  var s = JSON.stringify(out);
  if (s.length < 90000) cache.put('hp_pub', s, 300);
  return out;
}

/* ---------- Administrator ---------- */
/** Draft where one exists, otherwise published. Used by ?page=home&preview=draft. */
function getDraftHomepage() {
  hpAssertAdmin_();
  var rows = hpRows_(), out = { sections: {} };
  Object.keys(rows).forEach(function (k) {
    var d = hpParse_(rows[k].draft) || hpParse_(rows[k].pub);
    if (d) out.sections[k] = d;
  });
  return out;
}
/** Everything the admin screen needs: working content plus per-section status. */
function getHomepageAdminState() {
  var email = hpAssertAdmin_(), rows = hpRows_(), out = { email: email, sections: {}, status: {} };
  HP.SECTIONS.forEach(function (k) {
    var r = rows[k] || {};
    out.sections[k] = hpParse_(r.draft) || hpParse_(r.pub);
    out.status[k] = { hasDraft: !!r.draft, draftAt: String(r.dAt || ''), publishedAt: String(r.pAt || ''), isPublished: !!r.pub };
  });
  return out;
}
function saveHomepageDraft(section, data) {
  var email = hpAssertAdmin_();
  if (HP.SECTIONS.indexOf(section) < 0) throw new Error('Unknown section.');
  var clean = hpClean_(data, 0);
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new Error('Invalid content.');
  hpValidate_(section, clean);
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = hpSheet_(), row = hpRowFor_(sh, hpRows_(), section);
    sh.getRange(row, 2).setValue(JSON.stringify(clean));
    sh.getRange(row, 4, 1, 2).setValues([[new Date().toISOString(), email]]);
  } finally { lock.releaseLock(); }
  return { ok: true, section: section };
}
function discardHomepageDraft(section) {
  hpAssertAdmin_();
  if (HP.SECTIONS.indexOf(section) < 0) throw new Error('Unknown section.');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = hpSheet_(), row = hpRowFor_(sh, hpRows_(), section);
    sh.getRange(row, 2).setValue(''); sh.getRange(row, 4, 1, 2).setValues([['', '']]);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
/** Copies every saved draft to Published, logs it to HomepageHistory, clears the cache. */
function publishHomepage() {
  var email = hpAssertAdmin_(), lock = LockService.getScriptLock(); lock.waitLock(15000);
  var n = 0;
  try {
    var sh = hpSheet_(), rows = hpRows_(), hist = hpSpreadsheet_().getSheetByName(HP.HISTORY), now = new Date().toISOString();
    if (!hist) { hist = hpSpreadsheet_().insertSheet(HP.HISTORY); hist.appendRow(['PublishedAt', 'By', 'Section', 'Content']); hist.setFrozenRows(1); }
    Object.keys(rows).forEach(function (k) {
      if (!rows[k].draft) return;
      sh.getRange(rows[k].row, 2, 1, 1).setValue('');
      sh.getRange(rows[k].row, 3).setValue(rows[k].draft);
      sh.getRange(rows[k].row, 4, 1, 4).setValues([['', '', now, email]]);
      hist.appendRow([now, email, k, rows[k].draft]); n++;
    });
  } finally { lock.releaseLock(); }
  CacheService.getScriptCache().remove('hp_pub');
  return { ok: true, published: n };
}

/* ---------- Drive images (public website images only; never applicant documents) ---------- */
function hpFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('HP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder(HP.FOLDER);
  props.setProperty('HP_FOLDER_ID', f.getId());
  return f;
}
/** p = {kind:'photo'|'logo', name, mime, data(base64 without prefix)} -> {id, url} */
function uploadHomepageImage(p) {
  hpAssertAdmin_();
  if (!p || !HP.MIME[p.mime]) throw new Error('Use a JPG, PNG or WebP image.');
  var bytes = Utilities.base64Decode(String(p.data || ''));
  if (!bytes.length || bytes.length > HP.MAX_IMG) throw new Error('Image must be under 3 MB.');
  var b = bytes.map(function (x) { return (x + 256) % 256; });
  var ok = (p.mime === 'image/png' && b[0] === 0x89 && b[1] === 0x50) ||
           (p.mime === 'image/jpeg' && b[0] === 0xFF && b[1] === 0xD8) ||
           (p.mime === 'image/webp' && b[0] === 0x52 && b[1] === 0x49);
  if (!ok) throw new Error('File content does not match its image type.');
  var name = (p.kind === 'logo' ? 'logo_' : 'photo_') + Date.now() + '.' + HP.MIME[p.mime];
  var file = hpFolder_().createFile(Utilities.newBlob(bytes, p.mime, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600' };
}
