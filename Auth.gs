/**
 * Auth.gs - Auth foundation: Users sheet, sign-in, sessions, sign-out, password change, Owner bootstrap.
 *
 * Roles: Owner, Encoder, Student. This file only answers "who is this and what is their role".
 * What each role may DO is decided by the feature files (e.g. HomepageMgmt.gs requires Owner).
 *
 * PUBLIC (callable from the browser):  authSignIn, authSignOut, authWhoAmI, authChangePassword
 * EDITOR-ONLY (refuse to run from the web): authSetupOwner, authResetPasswordFromProperties, authBenchmark
 * INTERNAL (trailing underscore, never callable from the browser): everything else, incl. authResolveSession_
 *
 * Sheet "Users":    Email | Role | Status | PasswordHash | TokenVersion | CreatedAt | LastLoginAt | PasswordChangedAt
 * Sheet "AuthAudit": At | Email | Action | Detail      (never contains passwords or tokens)
 *
 * Password storage: PBKDF2-HMAC-SHA256 with a per-user salt, written by hand because Apps Script has no
 * built-in password hasher. The iteration count is stored inside each hash, so it can be raised later
 * without locking anyone out. Run authBenchmark() once to pick a count that signs in in about a second.
 */
var AUTH = {
  USERS: 'Users', AUDIT: 'AuthAudit',
  HEADERS: ['Email', 'Role', 'Status', 'PasswordHash', 'TokenVersion', 'CreatedAt', 'LastLoginAt', 'PasswordChangedAt',
            'FullName', 'Mobile', 'TermsAcceptedAt', 'OtpHash', 'OtpExpires', 'OtpTries', 'OtpPurpose', 'StudentID'],
  ROLES: ['Owner', 'Website Administrator', 'Encoder', 'Student', 'Applicant'],
  ITER: 300000,                 // default for NEW hashes. Tune with authBenchmark().
  MIN_PW: 8, MIN_PW_OWNER: 12, MAX_PW: 200,
  IDLE_SEC: 7200,             // a session dies after 2 hours without use
  MAX_SEC: 21600,             // ...and after 6 hours no matter what (CacheService hard limit)
  MAX_FAILS: 10, LOCK_SEC: 600 // 10 wrong passwords for one email -> 10 minute pause
};

/* ====================== PUBLIC (browser) ====================== */

/** authSignIn(email, password) -> {success, message, data:{token, email, role}} */
function authSignIn(email, password) {
  try {
    email = authEmail_(email);
    if (!email || typeof password !== 'string' || !password || password.length > AUTH.MAX_PW) return authFail_('Enter your email and password.');
    var failKey = 'af_' + authDigest_(email), cache = CacheService.getScriptCache();
    if (Number(cache.get(failKey) || 0) >= AUTH.MAX_FAILS) return authFail_('Too many attempts. Please wait 10 minutes, or use "Forgot password" to unlock your account right away.');

    var u = authFindUser_(email), good = false;
    if (u) {
      good = authVerify_(password, u.hash);
    } else {
      authPbkdf2_(password, 'dummy-salt-for-timing', AUTH.ITER);   // same work whether or not the email exists
    }
    if (!good) {
      var n = Number(cache.get(failKey) || 0) + 1;
      cache.put(failKey, String(n), AUTH.LOCK_SEC);
      if (u) authAudit_(email, n >= AUTH.MAX_FAILS ? 'locked' : 'sign-in-fail', 'attempt ' + n);
      return authFail_('Incorrect email or password.');
    }
    if (u.status === 'Pending') {
      return { success: false, code: 'unverified', message: 'Please verify your email first. We will send you a new code.', error: 'unverified', data: { email: u.email } };
    }
    if (u.status !== 'Active') { authAudit_(email, 'sign-in-blocked', u.status); return authFail_('This account is not active. Please contact the school.'); }

    cache.remove(failKey);
    var chg = { LastLoginAt: new Date().toISOString() };
    if (authIters_(u.hash) < AUTH.ITER) chg.PasswordHash = authMakeHash_(password);   // upgrade old hashes at login
    authUpdateRow_(u.row, chg);
    var token = authIssueSession_(u);
    authAudit_(email, 'sign-in-ok', u.role);
    return { success: true, message: 'Signed in.', data: { token: token, email: u.email, role: u.role, studentId: u.studentId || '', fullName: u.name || '' } };
  } catch (err) {
    return authFail_('Sign-in is unavailable right now. Please try again.', err);
  }
}

/** authSignOut(token) -> {success} Always succeeds from the caller's point of view. */
function authSignOut(token) {
  try {
    var s = authResolveSession_(token);
    if (authValidToken_(token)) CacheService.getScriptCache().remove('as_' + authDigest_(token));
    if (s) authAudit_(s.email, 'sign-out', '');
  } catch (err) { /* ignore */ }
  return { success: true, message: 'Signed out.' };
}

/** authWhoAmI(token) -> {success, data:{email, role, studentId, fullName}}  Used by pages to restore state after a reload. */
function authWhoAmI(token) {
  try {
    var s = authResolveSession_(token);
    return s ? { success: true, message: 'OK', data: { email: s.email, role: s.role, studentId: s.studentId || '', fullName: s.fullName || '' } } : authFail_('Session expired. Please sign in again.');
  } catch (err) { return authFail_('Could not check your session.', err); }
}

/** authChangePassword(token, oldPassword, newPassword) -> {success, data:{token}}  All other sessions are ended. */
function authChangePassword(token, oldPassword, newPassword) {
  try {
    var s = authResolveSession_(token);
    if (!s) return authFail_('Session expired. Please sign in again.');
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') return authFail_('Enter your current and new password.');
    var min = s.role === 'Owner' ? AUTH.MIN_PW_OWNER : AUTH.MIN_PW;
    if (newPassword.length < min || newPassword.length > AUTH.MAX_PW) return authFail_('New password must be ' + min + ' to ' + AUTH.MAX_PW + ' characters.');
    if (newPassword === oldPassword) return authFail_('Choose a password different from the current one.');
    var pwMsg = accPasswordProblem_(newPassword, s.email, s.role); if (pwMsg) return authFail_(pwMsg);   // same rules as registration
    var u = authFindUser_(s.email);
    if (!u || !authVerify_(oldPassword, u.hash)) return authFail_('Current password is incorrect.');
    authUpdateRow_(u.row, { PasswordHash: authMakeHash_(newPassword), TokenVersion: u.tv + 1, PasswordChangedAt: new Date().toISOString() });
    authAudit_(u.email, 'password-change', '');
    var fresh = authFindUser_(u.email);
    return { success: true, message: 'Password changed.', data: { token: authIssueSession_(fresh) } };
  } catch (err) { return authFail_('Could not change the password.', err); }
}

/* ====================== INTERNAL: used by feature files ====================== */

/**
 * The portal's one session check. Returns the authenticated account identity and StudentID link for a valid session, otherwise null. Fails closed.
 * Role and status are read from the Users sheet on every call, so disabling a user or changing a role takes
 * effect on their very next request.
 */
function authResolveSession_(token) {
  if (!authValidToken_(token)) return null;
  var cache = CacheService.getScriptCache(), key = 'as_' + authDigest_(token), raw = cache.get(key);
  if (!raw) return null;
  var s; try { s = JSON.parse(raw); } catch (e) { return null; }
  var age = Math.floor(Date.now() / 1000) - s.iat;
  if (age >= AUTH.MAX_SEC) { cache.remove(key); return null; }
  var u = authSessionUser_(s.e);   // cached lookup (see below); busted by every Users write
  if (!u || u.status !== 'Active' || u.tv !== s.tv) { cache.remove(key); return null; }
  cache.put(key, raw, Math.max(1, Math.min(AUTH.IDLE_SEC, AUTH.MAX_SEC - age)));   // sliding idle window
  return { email: u.email, role: u.role, studentId: u.studentId || '', fullName: u.name || '' };
}

/* ---- Users lookup cache -------------------------------------------------------------------------
 * Every page load makes several authenticated calls, and each one used to read the whole Users sheet.
 * The role/status/token-version of a user is now cached for 2 minutes under a version number. Every write the
 * app makes to Users (authUpdateRow_, accWrite_, accAppend_, student link, purge, owner setup) bumps the version, so
 * disabling a user, changing a password or a role through the app still takes effect on the very next request.
 * Only a hand edit made directly in the Google Sheet can take up to 2 minutes to be noticed.
 * The cache holds no password hashes or OTP data. */
var AUTH_UCACHE_SEC = 120;
function authUserVer_() {
  var c = CacheService.getScriptCache(), v = c.get('au_ver');
  if (!v) { v = Utilities.getUuid(); c.put('au_ver', v, 21600); }
  return v;
}
function authUserBump_() {
  try { CacheService.getScriptCache().put('au_ver', Utilities.getUuid(), 21600); } catch (e) { /* cache is best-effort */ }
}
function authSessionUser_(email) {
  var c = CacheService.getScriptCache(), key = 'au_' + authUserVer_() + '_' + authDigest_(email), raw = c.get(key);
  if (raw) { try { return JSON.parse(raw); } catch (e) { /* fall through to the sheet */ } }
  var u = authFindUser_(email);
  if (!u) return null;
  var slim = { email: u.email, role: u.role, status: u.status, tv: u.tv, studentId: u.studentId, name: u.name };
  try { c.put(key, JSON.stringify(slim), AUTH_UCACHE_SEC); } catch (e) { /* ignore */ }
  return slim;
}

/** For feature files: returns {email, role} if the session holds one of `roles`, otherwise throws 'Not authorized.' */
function authRequireRole_(token, roles) {
  var s = authResolveSession_(token);
  if (!s || roles.indexOf(s.role) < 0) throw new Error('Not authorized.');
  return s;
}

/**
 * Internal account-to-admission link. Call only from a trusted server-side admission workflow.
 * Requires an active Applicant/Student account, a migrated StudentID column, and a unique link.
 */
function authLinkStudentLocked_(email, studentId) {
  email = authEmail_(email);
  studentId = String(studentId == null ? '' : studentId).trim();
  if (!email || !/^[A-Za-z0-9_-]{3,40}$/.test(studentId)) throw new Error('Invalid account or StudentID.');
  var all = authAllUsers_(), u = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].email === email) u = all[i];
    else if (all[i].studentId && all[i].studentId === studentId) throw new Error('StudentID is already linked to another account.');
  }
  if (!u || u.status !== 'Active' || ['Applicant', 'Student'].indexOf(u.role) < 0) throw new Error('Active applicant account not found.');
  if (u.studentId && u.studentId !== studentId) throw new Error('This account is already linked to another StudentID.');
  var sh = authSheet_(), header = String(sh.getRange(1, AUTH.HEADERS.length).getValue() || '');
  if (header !== 'StudentID') throw new Error('Run the approved Users schema migration before linking student records.');
  sh.getRange(u.row, AUTH.HEADERS.length).setNumberFormat('@').setValue(studentId);
  authUserBump_();
  authAudit_(email, 'student-link', studentId);
  return true;
}

/** Internal wrapper for trusted server-side workflows that are not already holding the script lock. */
function authLinkStudent_(email, studentId) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try { return authLinkStudentLocked_(email, studentId); }
  finally { lock.releaseLock(); }
}

/* ====================== EDITOR-ONLY (run from the Apps Script editor) ====================== */

/**
 * Creates the first Owner. Refuses if an Owner already exists.
 * 1) Project Settings > Script Properties: add AUTH_OWNER_EMAIL and AUTH_OWNER_PASSWORD (12+ characters).
 * 2) Select authSetupOwner in the editor and click Run. 3) The password property is deleted automatically.
 */
function authSetupOwner() {
  authRequireEditor_();
  var props = PropertiesService.getScriptProperties();
  var email = authEmail_(props.getProperty('AUTH_OWNER_EMAIL')), pw = props.getProperty('AUTH_OWNER_PASSWORD') || '';
  if (!email) throw new Error('Set Script Property AUTH_OWNER_EMAIL to a valid email address.');
  if (pw.length < AUTH.MIN_PW_OWNER) throw new Error('Set Script Property AUTH_OWNER_PASSWORD to at least ' + AUTH.MIN_PW_OWNER + ' characters.');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var all = authAllUsers_();
    if (all.some(function (u) { return u.role === 'Owner'; })) throw new Error('An Owner already exists. Use authResetPasswordFromProperties to reset a password.');
    if (all.some(function (u) { return u.email === email; })) throw new Error('That email already has an account.');
    var now = new Date().toISOString();
    authSheet_().appendRow([email, 'Owner', 'Active', authMakeHash_(pw), 1, now, '', now]);
    authUserBump_();
  } finally { lock.releaseLock(); }
  props.deleteProperty('AUTH_OWNER_PASSWORD');
  authAudit_(email, 'owner-setup', 'by script owner');
  Logger.log('Owner created for ' + email + '. AUTH_OWNER_PASSWORD was deleted from Script Properties.');
}

/**
 * Recovery: sets a new password for the account in AUTH_OWNER_EMAIL, reactivates it, clears any sign-in lock
 * and ends all of its sessions. Same two Script Properties as authSetupOwner; the password one is deleted after.
 */
function authResetPasswordFromProperties() {
  authRequireEditor_();
  var props = PropertiesService.getScriptProperties();
  var email = authEmail_(props.getProperty('AUTH_OWNER_EMAIL')), pw = props.getProperty('AUTH_OWNER_PASSWORD') || '';
  var u = email && authFindUser_(email);
  if (!u) throw new Error('No account found for AUTH_OWNER_EMAIL.');
  var min = u.role === 'Owner' ? AUTH.MIN_PW_OWNER : AUTH.MIN_PW;
  if (pw.length < min) throw new Error('AUTH_OWNER_PASSWORD must be at least ' + min + ' characters.');
  authUpdateRow_(u.row, { PasswordHash: authMakeHash_(pw), Status: 'Active', TokenVersion: u.tv + 1, PasswordChangedAt: new Date().toISOString() });
  CacheService.getScriptCache().remove('af_' + authDigest_(email));
  props.deleteProperty('AUTH_OWNER_PASSWORD');
  authAudit_(email, 'password-reset', 'by script owner');
  Logger.log('Password reset for ' + email + '. AUTH_OWNER_PASSWORD was deleted from Script Properties.');
}

/** Times one password hash so you can choose AUTH.ITER. Aim for roughly 0.5 to 1.5 seconds, then raise AUTH.ITER to the largest value that fits (stored hashes upgrade themselves at next sign-in). Results go to the log. */
function authBenchmark() {
  authRequireEditor_();
  [20000, 100000, 300000, 600000].forEach(function (n) {
    var t = Date.now(); authPbkdf2_('benchmark', 'benchmark-salt', n);
    Logger.log(n + ' iterations: ' + (Date.now() - t) + ' ms');
  });
}

/* ====================== helpers ====================== */

function authRequireEditor_() {
  var a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
  if (!a || a !== e) throw new Error('This function can only be run from the Apps Script editor by the script owner.');
}
function authFail_(msg, err) {
  if (err) console.error('Auth error: ' + (err && err.message));
  return { success: false, message: msg, error: msg };
}
function authEmail_(v) {
  var e = String(v == null ? '' : v).trim().toLowerCase();
  // A leading = + - @ would be read as a spreadsheet formula when the address is stored, so such addresses are refused.
  return (e.length <= 254 && /^[^@\s=+\-][^@\s]*@[^@\s]+\.[^@\s]+$/.test(e)) ? e : '';
}
function authValidToken_(t) { return typeof t === 'string' && /^[a-f0-9]{64}$/.test(t); }
function authIters_(stored) { var p = String(stored || '').split('$'); return parseInt(p[1], 10) || 0; }
function authDigest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function authIssueSession_(u) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 64 hex chars, about 240 random bits
  CacheService.getScriptCache().put('as_' + authDigest_(token),
    JSON.stringify({ e: u.email, tv: u.tv, iat: Math.floor(Date.now() / 1000) }), AUTH.IDLE_SEC);
  return token;
}

/* ---- password hashing: PBKDF2-HMAC-SHA256, one 32-byte block ---- */
/*
 * The first block uses the built-in HMAC service. The remaining iterations run as plain JavaScript SHA-256 with the HMAC
 * pad states precomputed (2 compressions per iteration). Calling Utilities.computeHmacSha256Signature once per iteration
 * costs about 0.4 ms each in Apps Script (20,000 iterations = ~9 s); this loop is many times faster and produces
 * BIT-IDENTICAL output, so every existing stored hash still verifies.
 */
var AUTH_K_ = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
var AUTH_IV_ = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
/** One SHA-256 compression: state (8 words) + block (16 words) -> out (8 words). w is a reusable 64-word scratch array. */
function authSha256Block_(st, blk, out, w) {
  var K = AUTH_K_, t;
  for (t = 0; t < 16; t++) w[t] = blk[t];
  for (t = 16; t < 64; t++) {
    var x = w[t - 15], y = w[t - 2];
    var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
  }
  var a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (t = 0; t < 64; t++) {
    var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    var ch = (e & f) ^ (~e & g);
    var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
    var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    var mj = (a & b) ^ (a & c) ^ (b & c);
    var t2 = (S0 + mj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = (st[0] + a) | 0; out[1] = (st[1] + b) | 0; out[2] = (st[2] + c) | 0; out[3] = (st[3] + d) | 0;
  out[4] = (st[4] + e) | 0; out[5] = (st[5] + f) | 0; out[6] = (st[6] + g) | 0; out[7] = (st[7] + h) | 0;
}
function authPbkdf2_(password, salt, iters) {
  var pw = Utilities.newBlob(password).getBytes(), sb = Utilities.newBlob(salt).getBytes();
  var i, j;
  // block 1 (U1) through the built-in service: its input length varies with the salt
  var u1 = Utilities.computeHmacSha256Signature(sb.concat([0, 0, 0, 1]), pw);
  // HMAC key: hashed first when longer than one block, then zero-padded to 64 bytes
  var key = pw;
  if (key.length > 64) key = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw);
  var ip = [], op = [];
  for (i = 0; i < 16; i++) {
    var w0 = 0, w1 = 0;
    for (j = 0; j < 4; j++) {
      var kb = (i * 4 + j < key.length) ? (key[i * 4 + j] & 255) : 0;
      w0 = (w0 << 8) | (kb ^ 0x36); w1 = (w1 << 8) | (kb ^ 0x5c);
    }
    ip.push(w0 | 0); op.push(w1 | 0);
  }
  var scratch = new Array(64), innerSt = new Array(8), outerSt = new Array(8);
  authSha256Block_(AUTH_IV_, ip, innerSt, scratch);
  authSha256Block_(AUTH_IV_, op, outerSt, scratch);
  var u = new Array(8), t = new Array(8), blk = new Array(16), h = new Array(8);
  for (i = 0; i < 8; i++) { u[i] = ((u1[i*4] & 255) << 24) | ((u1[i*4+1] & 255) << 16) | ((u1[i*4+2] & 255) << 8) | (u1[i*4+3] & 255); t[i] = u[i]; }
  blk[8] = 0x80000000 | 0; for (i = 9; i < 15; i++) blk[i] = 0; blk[15] = 768;   // (64 + 32) bytes * 8 bits
  for (var n = 1; n < iters; n++) {
    for (i = 0; i < 8; i++) blk[i] = u[i];
    authSha256Block_(innerSt, blk, h, scratch);
    for (i = 0; i < 8; i++) blk[i] = h[i];
    authSha256Block_(outerSt, blk, u, scratch);
    for (i = 0; i < 8; i++) t[i] ^= u[i];
  }
  var bytes = [];
  for (i = 0; i < 8; i++) bytes.push((t[i] >> 24) << 24 >> 24, (t[i] >> 16) << 24 >> 24, (t[i] >> 8) << 24 >> 24, t[i] << 24 >> 24);
  return Utilities.base64Encode(bytes);
}
function authMakeHash_(password) {
  var salt = Utilities.getUuid();
  return 'v1$' + AUTH.ITER + '$' + salt + '$' + authPbkdf2_(password, salt, AUTH.ITER);
}
function authVerify_(password, stored) {
  var p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') return false;
  var iters = parseInt(p[1], 10);
  if (!(iters >= 1 && iters <= 1000000)) return false;
  var a = authPbkdf2_(password, p[2], iters), b = p[3], diff = a.length ^ b.length;   // compare without stopping early
  for (var i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- Users sheet (batch reads and writes only) ---- */
function authSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function authSheet_() {
  var ss = authSpreadsheet_(), sh = ss.getSheetByName(AUTH.USERS);
  if (!sh) { sh = ss.insertSheet(AUTH.USERS); sh.appendRow(AUTH.HEADERS); sh.setFrozenRows(1); }
  return sh;
}
function authAllUsers_() {
  var v = authSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i], email = String(r[0] || '').trim().toLowerCase();
    if (!email) continue;
  out.push({ row: i + 1, email: email, role: String(r[1] || ''), status: String(r[2] || ''), hash: String(r[3] || ''), tv: Number(r[4]) || 1,
      name: String(r[8] || ''), mobile: String(r[9] || ''), otpHash: String(r[11] || ''), otpExp: Number(r[12]) || 0,
      otpTries: Number(r[13]) || 0, otpPurpose: String(r[14] || ''), studentId: String(r[15] || '') });
  }
  return out;
}
function authFindUser_(email) {
  var all = authAllUsers_();
  for (var i = 0; i < all.length; i++) if (all[i].email === email && AUTH.ROLES.indexOf(all[i].role) >= 0) return all[i];
  return null;
}
/** changes = {HeaderName: value}. Reads the row once, writes the row once. */
function authUpdateRow_(row, changes) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = authSheet_(), range = sh.getRange(row, 1, 1, AUTH.HEADERS.length), vals = range.getValues();
    Object.keys(changes).forEach(function (k) { var c = AUTH.HEADERS.indexOf(k); if (c >= 0) vals[0][c] = changes[k]; });
    range.setNumberFormat('@');   // whole row as text so no value can become a formula
    range.setValues(vals);
    authUserBump_();
  } finally { lock.releaseLock(); }
}

/** Internal status workflow helper. Caller must already hold the script lock. */
function authPromoteApplicantToStudentLocked_(email, studentId) {
  email = authEmail_(email);
  studentId = String(studentId || '').trim();
  var u = authFindUser_(email);
  if (!u) throw new Error('The applicant account could not be found.');
  if (u.status !== 'Active') throw new Error('The applicant account is not active.');
  if (u.role === 'Student') {
    if (u.studentId !== studentId) throw new Error('The student account is linked to a different StudentID.');
    return false;
  }
  if (u.role !== 'Applicant') throw new Error('Only an Applicant account can be promoted to Student.');
  if (u.studentId && u.studentId !== studentId) throw new Error('The applicant account is already linked to another StudentID.');

  var sh = authSheet_();
  var range = sh.getRange(u.row, 1, 1, AUTH.HEADERS.length);
  var vals = range.getValues();
  var roleCol = AUTH.HEADERS.indexOf('Role');
  var tvCol = AUTH.HEADERS.indexOf('TokenVersion');
  var idCol = AUTH.HEADERS.indexOf('StudentID');
  vals[0][roleCol] = 'Student';
  vals[0][tvCol] = String(Number(u.tv || 0) + 1);
  vals[0][idCol] = studentId;
  range.setNumberFormat('@').setValues(vals);
  authUserBump_();
  authAudit_(email, 'role-promoted', studentId);
  return true;
}

function authAudit_(email, action, detail) {
  try {
    var ss = authSpreadsheet_(), sh = ss.getSheetByName(AUTH.AUDIT);
    if (!sh) { sh = ss.insertSheet(AUTH.AUDIT); sh.appendRow(['At', 'Email', 'Action', 'Detail']); sh.setFrozenRows(1); }
    var row = [new Date().toISOString(), String(email == null ? '' : email), String(action), String(detail || '').slice(0, 300)];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);   // text, never a formula
  } catch (e) { /* auditing never blocks sign-in */ }
}

/**
 * Internal. Caller must already hold the script lock.
 * Moves a Student account back to Applicant (used when an approval is withdrawn). Bumps TokenVersion so open sessions end.
 * Returns true if anything changed.
 */
function authDemoteStudentLocked_(email, studentId) {
  email = authEmail_(email);
  studentId = String(studentId || '').trim();
  var u = authFindUser_(email);
  if (!u || u.role !== 'Student' || u.studentId !== studentId) return false;
  var sh = authSheet_(), range = sh.getRange(u.row, 1, 1, AUTH.HEADERS.length), vals = range.getValues();
  vals[0][AUTH.HEADERS.indexOf('Role')] = 'Applicant';
  vals[0][AUTH.HEADERS.indexOf('TokenVersion')] = String(Number(u.tv || 0) + 1);
  range.setNumberFormat('@').setValues(vals);
  authUserBump_();
  authAudit_(email, 'role-demoted', studentId);
  return true;
}

/**
 * Internal. Caller must already hold the script lock.
 * Clears the StudentID link of an account whose admission record was removed (retention). A Student becomes an Applicant again.
 */
function authUnlinkStudentLocked_(email, studentId) {
  email = authEmail_(email);
  studentId = String(studentId || '').trim();
  var u = authFindUser_(email);
  if (!u || !u.studentId || u.studentId !== studentId) return false;
  var sh = authSheet_(), range = sh.getRange(u.row, 1, 1, AUTH.HEADERS.length), vals = range.getValues();
  if (u.role === 'Student') vals[0][AUTH.HEADERS.indexOf('Role')] = 'Applicant';
  vals[0][AUTH.HEADERS.indexOf('TokenVersion')] = String(Number(u.tv || 0) + 1);
  vals[0][AUTH.HEADERS.indexOf('StudentID')] = '';
  range.setNumberFormat('@').setValues(vals);
  authUserBump_();
  authAudit_(email, 'student-unlink', studentId);
  return true;
}