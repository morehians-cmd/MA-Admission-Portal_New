/**
 * AuthAccount.gs - Applicant registration, email verification (OTP), forgot/reset password.
 * PUBLIC (browser): authRegister, authVerifyEmail, authResendCode, authForgotPassword, authResetPassword
 * EDITOR-ONLY: authMigrateUsersSheet (run once)   TRIGGER: authPurgePending (daily, optional)
 * Depends on Auth.gs: AUTH, authFail_, authEmail_, authDigest_, authSheet_, authAllUsers_, authMakeHash_,
 *                     authIssueSession_, authAudit_, authRequireEditor_
 */
var ACC = { OTP_TTL_MS: 10 * 60 * 1000, OTP_MAX_TRIES: 5, RESEND_SEC: 60, REG_PER_HOUR: 150, REG_PER_EMAIL_DAY: 5, TERMS_VERSION: '2026-11' };

/* ====================== PUBLIC ====================== */

/** authRegister({name,email,mobile,password,terms,hp}) -> {success,message,data:{email}} */
function authRegister(p) {
  try {
    p = p || {};
    if (p.hp) return { success: true, message: 'We sent a 6-digit code to your email.', data: { email: '' } };   // honeypot: bots only
    var name = String(p.name || '').replace(/\s+/g, ' ').trim(), email = authEmail_(p.email), mobile = accMobile_(p.mobile);
    if (name.length < 2 || name.length > 100) return authFail_('Enter your full name.');
    if (!email) return authFail_('Enter a valid email address.');
    if (!mobile) return authFail_('Enter a valid mobile number, for example 09171234567.');
    var pwMsg = accPasswordProblem_(p.password, email, 'Applicant'); if (pwMsg) return authFail_(pwMsg);
    if (p.terms !== true) return authFail_('Please accept the Terms of Service and Privacy Policy.');

    var cache = CacheService.getScriptCache(), cd = 'oc_verify_' + authDigest_(email);
    if (cache.get(cd)) return authFail_('Please wait a minute before requesting another code.');
    // Per-email daily cap (counts every attempt, whether or not the email is registered) so nobody can mail-bomb an address.
    // The global hourly cap below is only a circuit breaker now; it used to be 30, which let one script block every real registration.
    var dayKey = 'reg_e_' + authDigest_(email) + '_' + Math.floor(Date.now() / 86400000), dayN = Number(cache.get(dayKey) || 0);
    if (dayN >= ACC.REG_PER_EMAIL_DAY) return authFail_('Too many attempts for this email today. Please try again tomorrow.');
    cache.put(dayKey, String(dayN + 1), 86400);
    var hash = authMakeHash_(p.password), code = accNewCode_(), now = new Date().toISOString();   // hash BEFORE locking (slow)
    var hourKey = 'reg_h_' + Math.floor(Date.now() / 3600000), busy = false, taken = false;

    var lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var cnt = Number(cache.get(hourKey) || 0);
      if (cnt >= ACC.REG_PER_HOUR) busy = true;
      else {
        var ex = accFind_(email);
        if (ex && ex.status !== 'Pending') taken = true;
        else {
          var f = accOtpFields_(email, 'verify', code);
          f.FullName = name; f.Mobile = mobile; f.PasswordHash = hash; f.PasswordChangedAt = now;
          f.TermsAcceptedAt = now + ' v' + ACC.TERMS_VERSION;
          if (ex) accWrite_(ex.row, f);
          else { f.Email = email; f.Role = 'Applicant'; f.Status = 'Pending'; f.TokenVersion = 1; f.CreatedAt = now; accAppend_(f); }
          cache.put(hourKey, String(cnt + 1), 3600);
        }
      }
    } finally { lock.releaseLock(); }
    if (busy) return authFail_('Registration is busy right now. Please try again later.');
    if (taken) {
      // Same answer as a fresh registration, so the form cannot be used to find out which emails have accounts.
      // The real owner of the address is told by email instead.
      try { accSendExistsNotice_(email); } catch (mailErr) { console.error('Notice email failed: ' + mailErr.message); }
      cache.put(cd, '1', ACC.RESEND_SEC);
      authAudit_(email, 'register-existing', '');
      return { success: true, message: 'We sent a 6-digit code to ' + email + '.', data: { email: email } };
    }

    cache.put(cd, '1', ACC.RESEND_SEC);
    accSendOtp_(email, name, code, 'verify');
    authAudit_(email, 'register', 'pending');
    return { success: true, message: 'We sent a 6-digit code to ' + email + '.', data: { email: email } };
  } catch (err) { return authFail_('We could not create the account. Please try again.', err); }
}

/** authVerifyEmail(email, code) -> {success,data:{token,email,role}}  Activates the account and signs the user in. */
function authVerifyEmail(email, code) {
  try {
    email = authEmail_(email); code = String(code == null ? '' : code).replace(/\D/g, '');
    if (!email || code.length !== 6) return authFail_('Enter the 6-digit code.');
    var u, msg, lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      u = accFind_(email);
      msg = (u && u.status === 'Pending') ? accCheckOtp_(u, email, 'verify', code) : 'That code is not valid or has expired. Please request a new one.';
      if (!msg) accWrite_(u.row, { Status: 'Active', LastLoginAt: new Date().toISOString(), OtpHash: '', OtpExpires: '', OtpTries: '', OtpPurpose: '' });
    } finally { lock.releaseLock(); }
    if (msg) return authFail_(msg);
    authAudit_(email, 'verify-ok', '');
    return { success: true, message: 'Email verified.', data: { token: authIssueSession_(u), email: u.email, role: u.role, studentId: u.studentId || '', fullName: u.name || '' } };
  } catch (err) { return authFail_('Could not verify the code. Please try again.', err); }
}

/** authResendCode(email) -> generic success (never reveals whether the email is registered). */
function authResendCode(email) {
  try { return accRequestCode_(email, 'verify'); } catch (err) { return authFail_('Could not send the code. Please try again.', err); }
}

/** authForgotPassword(email) -> generic success. */
function authForgotPassword(email) {
  try { return accRequestCode_(email, 'reset'); } catch (err) { return authFail_('Could not send the code. Please try again.', err); }
}

/** authResetPassword(email, code, newPassword) -> {success}. Ends every existing session for that user. */
function authResetPassword(email, code, newPassword) {
  try {
    email = authEmail_(email); code = String(code == null ? '' : code).replace(/\D/g, '');
    if (!email || code.length !== 6) return authFail_('Enter the 6-digit code.');
    if (typeof newPassword !== 'string') return authFail_('Enter a new password.');
    var msg, lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var u = accFind_(email);
      msg = (u && u.status === 'Active') ? accCheckOtp_(u, email, 'reset', code) : 'That code is not valid or has expired. Please request a new one.';
      if (!msg) msg = accPasswordProblem_(newPassword, email, u.role);
      if (!msg) accWrite_(u.row, { PasswordHash: authMakeHash_(newPassword), TokenVersion: u.tv + 1, PasswordChangedAt: new Date().toISOString(),
                                   OtpHash: '', OtpExpires: '', OtpTries: '', OtpPurpose: '' });
    } finally { lock.releaseLock(); }
    if (msg) return authFail_(msg);
    CacheService.getScriptCache().remove('af_' + authDigest_(email));
    authAudit_(email, 'password-reset-otp', '');
    return { success: true, message: 'Password changed. Please sign in.' };
  } catch (err) { return authFail_('Could not reset the password. Please try again.', err); }
}

/* ====================== EDITOR-ONLY / TRIGGER ====================== */

/** Run ONCE from the editor: adds the new columns, makes them plain text, and triggers the email permission prompt. */
function authMigrateUsersSheet() {
  authRequireEditor_();
  var sh = authSheet_(), n = AUTH.HEADERS.length, oldN = n - 1;
  var last = sh.getLastRow(), width = Math.min(n, sh.getMaxColumns());
  var existing = sh.getRange(1, 1, 1, Math.max(width, 1)).getDisplayValues()[0];
  var hasHeader = existing.some(function (v) { return String(v || '') !== ''; });
  if (hasHeader) {
    for (var i = 0; i < oldN; i++) {
      if (String(existing[i] || '') !== AUTH.HEADERS[i]) {
        throw new Error('Users schema mismatch at column ' + (i + 1) + '. No headers or records were changed.');
      }
    }
    if (existing[oldN] && String(existing[oldN]) !== 'StudentID') {
      throw new Error('Users column ' + (oldN + 1) + ' is already occupied. Review the sheet before adding StudentID.');
    }
  } else if (last > 1) {
    throw new Error('Users has records but no recognizable header. No changes were made.');
  }
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  if (!hasHeader) sh.getRange(1, 1, 1, n).setValues([AUTH.HEADERS]).setFontWeight('bold');
  else if (!existing[oldN]) sh.getRange(1, n).setValue('StudentID').setFontWeight('bold');
  sh.getRange(2, 9, Math.max(1, sh.getMaxRows() - 1), n - 8).setNumberFormat('@');
  Logger.log('Users schema verified; StudentID link column is ready.');
}

/** Optional daily time trigger: deletes unverified (Pending) accounts older than 7 days. Harmless if called by anyone. */
function authPurgePending() {
  // Public function (so a trigger can call it): allow one real run per hour so it cannot be used to hog the script lock.
  var cache = CacheService.getScriptCache();
  if (cache.get('purge_pending_ran')) return;
  cache.put('purge_pending_ran', '1', 3600);
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = authSheet_(), v = sh.getDataRange().getValues(), cutoff = Date.now() - 7 * 86400000, del = [];
    for (var i = 1; i < v.length; i++) if (String(v[i][2]) === 'Pending' && new Date(v[i][5]).getTime() < cutoff) del.push(i + 1);
    del.reverse().forEach(function (r) { sh.deleteRow(r); });
    if (del.length) authUserBump_();
  } finally { lock.releaseLock(); }
}

/* ====================== helpers ====================== */
function accFind_(email) {
  var all = authAllUsers_();
  for (var i = 0; i < all.length; i++) if (all[i].email === email && AUTH.ROLES.indexOf(all[i].role) >= 0) return all[i];
  return null;
}
function accNewCode_() {
  var n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000;
  return ('00000' + n).slice(-6);
}
function accOtpHash_(email, purpose, code) { return authDigest_(email + '|' + purpose + '|' + code); }
function accOtpFields_(email, purpose, code) {
  return { OtpHash: accOtpHash_(email, purpose, code), OtpExpires: Date.now() + ACC.OTP_TTL_MS, OtpTries: 0, OtpPurpose: purpose };
}
function accSafeEq_(a, b) {
  var d = a.length ^ b.length;
  for (var i = 0; i < a.length && i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** Caller holds the script lock. Returns '' if the code is right, otherwise a message. Counts wrong tries. */
function accCheckOtp_(u, email, purpose, code) {
  var bad = 'That code is not valid or has expired. Please request a new one.';
  if (!u || !u.otpHash || u.otpPurpose !== purpose || Date.now() > u.otpExp) return bad;
  if (u.otpTries >= ACC.OTP_MAX_TRIES) return 'Too many wrong codes. Please request a new one.';
  if (!accSafeEq_(accOtpHash_(email, purpose, code), u.otpHash)) {
    accWrite_(u.row, { OtpTries: u.otpTries + 1 });
    return 'Incorrect code. ' + (ACC.OTP_MAX_TRIES - u.otpTries - 1) + ' attempt(s) left.';
  }
  return '';
}
/** Resend / forgot. Always answers the same way so nobody can probe which emails are registered. */
function accRequestCode_(email, purpose) {
  email = authEmail_(email);
  if (!email) return authFail_('Enter a valid email address.');
  var cache = CacheService.getScriptCache(), cd = 'oc_' + purpose + '_' + authDigest_(email);
  if (cache.get(cd)) return authFail_('Please wait a minute before requesting another code.');
  cache.put(cd, '1', ACC.RESEND_SEC);
  var want = purpose === 'reset' ? 'Active' : 'Pending', code = accNewCode_(), u = null;
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    u = accFind_(email);
    if (u && u.status === want) accWrite_(u.row, accOtpFields_(email, purpose, code)); else u = null;
  } finally { lock.releaseLock(); }
  if (u) { accSendOtp_(email, u.name, code, purpose); authAudit_(email, purpose === 'reset' ? 'forgot-password' : 'resend-code', ''); }
  return { success: true, message: purpose === 'reset' ? 'If an account exists for this email, we sent a reset code.' : 'If this email has a pending registration, we sent a new code.' };
}
function accMobile_(v) {
  var d = String(v == null ? '' : v).replace(/[\s\-()]/g, '');
  if (/^\+639\d{9}$/.test(d)) d = '0' + d.slice(3); else if (/^639\d{9}$/.test(d)) d = '0' + d.slice(2);
  return /^09\d{9}$/.test(d) ? d : '';
}
function accPasswordProblem_(pw, email, role) {
  var min = role === 'Owner' ? AUTH.MIN_PW_OWNER : AUTH.MIN_PW;
  if (typeof pw !== 'string' || pw.length < min || pw.length > AUTH.MAX_PW) return 'Password must be ' + min + ' to ' + AUTH.MAX_PW + ' characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  if (pw.toLowerCase() === email) return 'Your password cannot be your email address.';
  return '';
}
/** Sheet writes. The CALLER must hold the script lock (locks are not re-entrant, so these never lock themselves). */
function accWrite_(row, changes) {
  var sh = authSheet_(), n = AUTH.HEADERS.length, range = sh.getRange(row, 1, 1, n), vals = range.getValues();
  Object.keys(changes).forEach(function (k) { var c = AUTH.HEADERS.indexOf(k); if (c >= 0) vals[0][c] = changes[k]; });
  range.setNumberFormat('@');   // whole row as text so no value can become a formula
  range.setValues(vals);
  authUserBump_();
}
function accAppend_(obj) {
  var sh = authSheet_(), n = AUTH.HEADERS.length, row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  sh.getRange(row, 1, 1, n).setNumberFormat('@');   // Email/Role/... as text too (was columns 9+ only)
  sh.getRange(row, 1, 1, n).setValues([AUTH.HEADERS.map(function (h) { return obj[h] == null ? '' : obj[h]; })]);
  authUserBump_();
}
function accEsc_(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function accSendExistsNotice_(email) {
  if (MailApp.getRemainingDailyQuota() < 1) return;
  var html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#14213d">'
    + '<h2 style="color:#062E70;margin:0 0 12px">Moreh Academy</h2>'
    + '<p>Someone tried to create a portal account with this email address, but an account already exists.</p>'
    + '<p>If it was you, please sign in, or choose <b>Forgot password</b> on the sign-in page. If it was not you, you can ignore this email.</p></div>';
  MailApp.sendEmail({ to: email, subject: 'You already have an account - Moreh Academy', htmlBody: html,
    body: 'An account already exists for this email. Please sign in or use Forgot password. If this was not you, ignore this email.', name: 'Moreh Academy' });
}
function accSendOtp_(email, name, code, purpose) {
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Daily email quota reached.');
  var reset = purpose === 'reset';
  var html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#14213d">'
    + '<h2 style="color:#062E70;margin:0 0 12px">Moreh Academy</h2><p>Hello ' + accEsc_(name || 'there') + ',</p>'
    + '<p>' + (reset ? 'Use this code to reset your portal password:' : 'Use this code to verify your email and activate your applicant account:') + '</p>'
    + '<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#062E70;margin:16px 0">' + code + '</p>'
    + '<p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>'
    + '<p style="color:#667;font-size:12px">Never share this code. Moreh Academy staff will never ask for it.</p></div>';
  MailApp.sendEmail({ to: email, subject: (reset ? 'Reset your password' : 'Verify your email') + ' - Moreh Academy',
    htmlBody: html, body: 'Your Moreh Academy code is ' + code + '. It expires in 10 minutes.', name: 'Moreh Academy' });
}