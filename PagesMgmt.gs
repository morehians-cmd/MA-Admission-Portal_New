/**
 * PagesMgmt.gs - Phase 3 backend: content for dedicated subsection pages (About Us first).
 * Sheet "PageContent": Route | Draft | Published | DraftUpdatedAt | DraftUpdatedBy | PublishedAt | PublishedBy
 * Sheet "PageHistory": append-only log of every publish (for rollback).
 * Content is a list of structured BLOCKS (never raw HTML): h2, p, ul, img, link, download.
 * Public visitors can call ONLY getPublishedPage(). Every other function calls hpAssertAdmin_(token) (Owner only).
 * Depends on HomepageMgmt.gs: hpAssertAdmin_, hpAudit_, hpClean_, hpParse_, hpSpreadsheet_.
 * Script Properties: PG_FOLDER_ID is created automatically (separate Drive folder for downloadable files).
 * No new OAuth scopes: uses the same Spreadsheet, Drive, Cache, Lock and Properties services as Phase 2.
 */
var PG = {
  SHEET: 'PageContent', HISTORY: 'PageHistory', FOLDER: 'MorehAcademy_Website_Files',
  /* To make more pages editable, add a line here. Route = nav id + '/' + slug(label), as built by Homepage.html. */
  ROUTES: [
    { route: 'about', label: 'About Us (landing page)', group: 'About Us' },
    { route: 'about/vision-mission-and-core-values', label: 'Vision, Mission & Core Values', group: 'About Us' },
    { route: 'about/history', label: 'History', group: 'About Us' },
    { route: 'about/school-leadership', label: 'School Leadership', group: 'About Us' },
    { route: 'admissions', label: 'Admissions (landing page)', group: 'Admissions' },
    { route: 'admissions/enrollment-procedure', label: 'Enrollment Procedure', group: 'Admissions' },
    { route: 'admissions/admission-requirements', label: 'Admission Requirements', group: 'Admissions' },
    { route: 'admissions/scholarships', label: 'Scholarships', group: 'Admissions' },
    { route: 'admissions/frequently-asked-questions', label: 'Frequently Asked Questions', group: 'Admissions' },
    { route: 'academics', label: 'Academics (landing page)', group: 'Academics' },
    { route: 'academics/kindergarten', label: 'Kindergarten', group: 'Academics' },
    { route: 'academics/elementary', label: 'Elementary', group: 'Academics' },
    { route: 'academics/junior-high-school', label: 'Junior High School', group: 'Academics' },
    { route: 'academics/senior-high-school', label: 'Senior High School', group: 'Academics' },
    { route: 'academics/college-program', label: 'College Program', group: 'Academics' },
    { route: 'campus-life', label: 'Campus Life (landing page)', group: 'Campus Life' },
    { route: 'campus-life/student-organizations', label: 'Student Organizations', group: 'Campus Life' },
    { route: 'campus-life/school-activities-and-events', label: 'School Activities & Events', group: 'Campus Life' },
    { route: 'campus-life/sports-and-athletics', label: 'Sports & Athletics', group: 'Campus Life' },
    { route: 'campus-life/clubs-and-societies', label: 'Clubs & Societies', group: 'Campus Life' },
    { route: 'campus-life/campus-facilities-and-tour', label: 'Campus Facilities & Tour', group: 'Campus Life' },
    { route: 'forms', label: 'Downloadable Forms (landing page)', group: 'Downloadable Forms' },
    { route: 'forms/downloadable-forms', label: 'Downloadable Forms', group: 'Downloadable Forms' },
    { route: 'news', label: 'News & Updates (landing page)', group: 'News & Updates' },
    { route: 'news/school-announcements', label: 'School Announcements', group: 'News & Updates' },
    { route: 'news/latest-news', label: 'Latest News', group: 'News & Updates' },
    { route: 'news/upcoming-events', label: 'Upcoming Events', group: 'News & Updates' },
    { route: 'news/enrollment-announcements', label: 'Enrollment Announcements', group: 'News & Updates' },
    { route: 'news/school-achievements', label: 'School Achievements', group: 'News & Updates' },
    { route: 'contact', label: 'Contact Information', group: 'Contact' },
    { route: 'contact', label: 'Contact Information', group: 'Contact' },
    { route: 'terms', label: 'Terms of Service', group: 'Legal' },
    { route: 'privacy', label: 'Privacy Policy', group: 'Legal' }
  ],
  TYPES: ['h2', 'p', 'ul', 'img', 'link', 'download'],
  MAX_BLOCKS: 100, MAX_JSON: 45000, MAX_FILE: 5 * 1024 * 1024
};

/* ---------- helpers ---------- */
function pgRoute_(r) {
  for (var i = 0; i < PG.ROUTES.length; i++) if (PG.ROUTES[i].route === r) return PG.ROUTES[i];
  return null;
}
function pgSheet_() {
  var ss = hpSpreadsheet_(), sh = ss.getSheetByName(PG.SHEET);
  if (!sh) {
    sh = ss.insertSheet(PG.SHEET);
    var rows = [['Route', 'Draft', 'Published', 'DraftUpdatedAt', 'DraftUpdatedBy', 'PublishedAt', 'PublishedBy']];
    PG.ROUTES.forEach(function (p) { rows.push([p.route, '', '', '', '', '', '']); });
    sh.getRange(1, 1, rows.length, 7).setValues(rows);
    sh.setFrozenRows(1);
  }
  return sh;
}
function pgHistory_() {
  var ss = hpSpreadsheet_(), sh = ss.getSheetByName(PG.HISTORY);
  if (!sh) { sh = ss.insertSheet(PG.HISTORY); sh.appendRow(['PublishedAt', 'By', 'Route', 'Content']); sh.setFrozenRows(1); }
  return sh;
}
function pgRows_() {
  var v = pgSheet_().getDataRange().getValues(), o = {};
  for (var i = 1; i < v.length; i++) o[v[i][0]] = { row: i + 1, draft: v[i][1], pub: v[i][2], dAt: v[i][3], pAt: v[i][5] };
  return o;
}
function pgRowFor_(sh, rows, route) {
  if (rows[route]) return rows[route].row;
  sh.appendRow([route, '', '', '', '', '', '']);
  return sh.getLastRow();
}

/* ---------- validation: whitelists every field, returns clean blocks ---------- */
function pgText_(v, max, n) {
  var s = String(v == null ? '' : v).trim();
  if (!s) throw new Error(n + 'text is required.');
  if (s.length > max) throw new Error(n + 'text is too long (maximum ' + max + ' characters).');
  return s;
}
function pgUrl_(u, n, httpsOnly) {
  u = String(u == null ? '' : u).trim();
  var ok = httpsOnly
    ? /^https:\/\/[^\s"'<>]+$/i.test(u)
    : /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|route:[a-z0-9\/-]+|#[A-Za-z0-9_-]*)$/i.test(u);
  if (!ok) throw new Error(n + 'the address is not valid.');
  return u;
}

function pgInline_(s, n) {
  var re = /\[([^\]\n]+)\]\(([^)\s]*)\)/g, m;
  while ((m = re.exec(s))) pgUrl_(m[2], n, false);
}
function pgBlocks_(blocks) {
  if (!Array.isArray(blocks)) throw new Error('Invalid content.');
  if (blocks.length > PG.MAX_BLOCKS) throw new Error('At most ' + PG.MAX_BLOCKS + ' blocks per page.');
  return blocks.map(function (b, i) {
    var n = 'Block ' + (i + 1) + ': ';
    if (!b || typeof b !== 'object' || PG.TYPES.indexOf(b.type) < 0) throw new Error(n + 'unknown block type.');
    var t = b.type, o = { type: t };
    if (t === 'h2' || t === 'p') {
      o.text = pgText_(b.text, t === 'h2' ? 200 : 2000, n);
    if (t === 'p') pgInline_(o.text, n);
    } else if (t === 'ul') {
      if (!Array.isArray(b.items)) throw new Error(n + 'a list needs items.');
      o.items = b.items.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(String);
      if (!o.items.length || o.items.length > 30) throw new Error(n + 'a list needs 1 to 30 items.');
      o.items.forEach(function (x) { if (x.length > 300) throw new Error(n + 'a list item is too long (maximum 300 characters).'); });
    } else if (t === 'img') {
      o.url = pgUrl_(b.url, n, true);
      o.alt = String(b.alt || '').trim().slice(0, 200);
      o.name = String(b.name || '').trim().slice(0, 100);
      o.place = (b.place === 'side' || b.place === 'banner') ? b.place : '';
      o.caption = String(b.caption || '').trim().slice(0, 200);
    } else {   // link, download
      o.label = pgText_(b.label, 80, n);
      o.url = pgUrl_(b.url, n, t === 'download');
    }
    return o;
  });
}

/* ---------- Public ---------- */
/** Published blocks for ONE route. Safe for anonymous visitors. Unknown routes return no blocks. Cached 5 minutes. */
function getPublishedPage(route) {
  route = String(route || '');
  if (!pgRoute_(route)) return { route: route, blocks: [] };
  var cache = CacheService.getScriptCache(), key = 'pg_pub_' + route, hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var r = pgRows_()[route], d = r ? hpParse_(r.pub) : null;
  var out = { route: route, blocks: (d && d.blocks) || [] }, s = JSON.stringify(out);
  if (s.length < 90000) cache.put(key, s, 300);
  return out;
}

/* ---------- Owner only ---------- */
/** Draft where one exists, otherwise published. Needs the 10-minute ticket from createHomepagePreviewTicket. */
function getDraftPage(route, ticket) {
  if (!ticket || !CacheService.getScriptCache().get('hp_pt_' + ticket)) throw new Error('Preview expired. Open it again from Website Pages Management.');
  route = String(route || '');
  if (!pgRoute_(route)) return { route: route, blocks: [] };
  var r = pgRows_()[route] || {}, d = hpParse_(r.draft) || hpParse_(r.pub);
  return { route: route, blocks: (d && d.blocks) || [] };
}
/** Everything the admin screen needs: route list, working blocks per route, status per route. */
function getPagesAdminState(token) {
  var email = hpAssertAdmin_(token), rows = pgRows_(), out = { email: email, routes: PG.ROUTES, pages: {}, status: {} };
  PG.ROUTES.forEach(function (p) {
    var r = rows[p.route] || {}, d = hpParse_(r.draft) || hpParse_(r.pub);
    out.pages[p.route] = (d && d.blocks) || [];
    out.status[p.route] = { hasDraft: !!r.draft, draftAt: String(r.dAt || ''), publishedAt: String(r.pAt || ''), isPublished: !!r.pub };
  });
  return out;
}
function savePageDraft(token, route, data) {
  var email = hpAssertAdmin_(token);
  if (!pgRoute_(route)) throw new Error('Unknown page.');
  var clean = hpClean_(data, 0);
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new Error('Invalid content.');
  var json = JSON.stringify({ blocks: pgBlocks_(clean.blocks) });
  if (json.length > PG.MAX_JSON) throw new Error('This page is too large. Remove some content.');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = pgSheet_(), row = pgRowFor_(sh, pgRows_(), route);
    sh.getRange(row, 2).setValue(json);
    sh.getRange(row, 4, 1, 2).setValues([[new Date().toISOString(), email]]);
  } finally { lock.releaseLock(); }
  hpAudit_(email, 'save-page-draft', route);
  return { ok: true, route: route };
}
function discardPageDraft(token, route) {
  var email = hpAssertAdmin_(token);
  if (!pgRoute_(route)) throw new Error('Unknown page.');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = pgSheet_(), row = pgRowFor_(sh, pgRows_(), route);
    sh.getRange(row, 2).setValue(''); sh.getRange(row, 4, 1, 2).setValues([['', '']]);
  } finally { lock.releaseLock(); }
  hpAudit_(email, 'discard-page-draft', route);
  return { ok: true };
}
/** Copies every saved page draft to Published, logs it to PageHistory, clears the page caches. */
function publishPages(token) {
  var email = hpAssertAdmin_(token), done = [], lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = pgSheet_(), rows = pgRows_(), now = new Date().toISOString(), hist = [];
    Object.keys(rows).forEach(function (k) {
      var r = rows[k];
      if (!r.draft) return;
      sh.getRange(r.row, 2, 1, 6).setValues([['', r.draft, '', '', now, email]]);   // Draft, Published, DraftAt, DraftBy, PubAt, PubBy
      hist.push([now, email, k, r.draft]); done.push(k);
    });
    if (hist.length) { var h = pgHistory_(); h.getRange(h.getLastRow() + 1, 1, hist.length, 4).setValues(hist); }
  } finally { lock.releaseLock(); }
  if (done.length) CacheService.getScriptCache().removeAll(done.map(function (k) { return 'pg_pub_' + k; }));
  hpAudit_(email, 'publish-pages', done.length + ' page(s)');
  return { ok: true, published: done.length };
}

/* ---------- Drive: downloadable PDFs (separate folder from website images) ---------- */
function pgFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('PG_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder(PG.FOLDER);
  props.setProperty('PG_FOLDER_ID', f.getId());
  return f;
}
/** p = {name, mime:'application/pdf', data(base64 without prefix)} -> {id, url}. Images use uploadHomepageImage. */
function uploadPageFile(token, p) {
  var email = hpAssertAdmin_(token);
  if (!p || p.mime !== 'application/pdf') throw new Error('Only PDF files can be uploaded.');
  var bytes = Utilities.base64Decode(String(p.data || ''));
  if (!bytes.length || bytes.length > PG.MAX_FILE) throw new Error('File must be under 5 MB.');
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error('File content is not a PDF.');
  var base = String(p.name || 'file').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'file';
  var name = base + '_' + Date.now() + '.pdf';
  var file = pgFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  hpAudit_(email, 'upload-file', name);
  return { id: file.getId(), url: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}