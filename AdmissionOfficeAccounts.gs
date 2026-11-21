/**
 * AdmissionOfficeAccounts.gs
 *
 * The Owner creates and manages the Guidance and Accounting office accounts here.
 * The project had no staff-account creation flow (staff rows were only ever added by hand in the Users sheet),
 * so this is the first one. It only ever creates or touches accounts whose role is Guidance or Accounting.
 * It can never create, change or disable an Owner, Encoder, Website Administrator, Student or Applicant account.
 *
 * PUBLIC (browser, Owner session required):
 *   admissionOfficeAccountList(token)
 *   admissionOfficeAccountCreate(token, fullName, email, office, password)
 *   admissionOfficeAccountSetStatus(token, email, status)        status = 'Active' | 'Disabled'
 *   admissionOfficeAccountResetPassword(token, email, newPassword)
 *
 * Uses only Auth.gs / AuthAccount.gs helpers: authRequireRole_, authFail_, authEmail_, authAllUsers_, authMakeHash_,
 * authAudit_, accWrite_, accAppend_, accPasswordProblem_. Passwords are hashed with the same PBKDF2 as every other account.
 * Needs no new sheet and no new columns.
 */

var ADM_OFFICE_ACCTS = { OFFICES: ['Guidance', 'Accounting'], MIN_PW: 12, STATUSES: ['Active', 'Disabled'] };

function admissionOfficeIsOffice_(role) { return ADM_OFFICE_ACCTS.OFFICES.indexOf(role) >= 0; }

function admissionOfficePasswordProblem_(pw, email, office) {
  if (typeof pw !== 'string' || pw.length < ADM_OFFICE_ACCTS.MIN_PW) return 'Use a password of at least ' + ADM_OFFICE_ACCTS.MIN_PW + ' characters.';
  return accPasswordProblem_(pw, email, office);   // letter + number, max length, not the email
}

/** Office accounts only. Never returns hashes, OTP data or tokens. */
function admissionOfficeAccountList(token) {
  try {
    authRequireRole_(token, ['Owner']);
    var list = authAllUsers_().filter(function (u) { return admissionOfficeIsOffice_(u.role); })
      .map(function (u) { return { Email: u.email, Office: u.role, Status: u.status, FullName: u.name }; });
    list.sort(function (a, b) { return a.Office.localeCompare(b.Office) || a.Email.localeCompare(b.Email); });
    return { success: true, message: 'Office accounts loaded.', data: list };
  } catch (err) {
    return authFail_(err.message || 'Could not load office accounts.');
  }
}

function admissionOfficeAccountCreate(token, fullName, email, office, password) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Owner']);
    fullName = String(fullName || '').replace(/\s+/g, ' ').trim();
    email = authEmail_(email);
    office = String(office || '').trim();
    if (fullName.length < 2 || fullName.length > 100) throw new Error('Enter the staff member\'s full name.');
    if (!email) throw new Error('Enter a valid email address.');
    if (!admissionOfficeIsOffice_(office)) throw new Error('Choose Guidance or Accounting.');
    var pwMsg = admissionOfficePasswordProblem_(password, email, office);
    if (pwMsg) throw new Error(pwMsg);

    var hash = authMakeHash_(password), now = new Date().toISOString();   // hash BEFORE locking (slow)
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    if (authAllUsers_().some(function (u) { return u.email === email; })) throw new Error('That email already has an account.');
    accAppend_({ Email: email, Role: office, Status: 'Active', PasswordHash: hash, TokenVersion: 1, CreatedAt: now,
                 PasswordChangedAt: now, FullName: fullName });
    authAudit_(actor.email, 'office-account-created', office + ': ' + email);
    return { success: true, message: office + ' account created for ' + email + '.', data: { email: email, office: office } };
  } catch (err) {
    return authFail_(err.message || 'Could not create the account.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function admissionOfficeAccountSetStatus(token, email, status) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Owner']);
    email = authEmail_(email);
    status = String(status || '').trim();
    if (ADM_OFFICE_ACCTS.STATUSES.indexOf(status) < 0) throw new Error('Status must be Active or Disabled.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    var u = authAllUsers_().filter(function (x) { return x.email === email; })[0];
    if (!u || !admissionOfficeIsOffice_(u.role)) throw new Error('Office account not found.');
    accWrite_(u.row, { Status: status, TokenVersion: u.tv + 1 });   // new TokenVersion ends every open session
    authAudit_(actor.email, 'office-account-' + status.toLowerCase(), email);
    return { success: true, message: 'Account ' + (status === 'Active' ? 'enabled.' : 'disabled.'), data: { email: email, status: status } };
  } catch (err) {
    return authFail_(err.message || 'Could not change the account.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function admissionOfficeAccountResetPassword(token, email, newPassword) {
  var lock = null;
  try {
    var actor = authRequireRole_(token, ['Owner']);
    email = authEmail_(email);
    var pre = authAllUsers_().filter(function (x) { return x.email === email; })[0];
    if (!pre || !admissionOfficeIsOffice_(pre.role)) throw new Error('Office account not found.');
    var pwMsg = admissionOfficePasswordProblem_(newPassword, email, pre.role);
    if (pwMsg) throw new Error(pwMsg);

    var hash = authMakeHash_(newPassword);   // slow, so before locking
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) throw new Error('The service is busy. Please try again.');
    var u = authAllUsers_().filter(function (x) { return x.email === email; })[0];
    if (!u || !admissionOfficeIsOffice_(u.role)) throw new Error('Office account not found.');
    accWrite_(u.row, { PasswordHash: hash, TokenVersion: u.tv + 1, PasswordChangedAt: new Date().toISOString() });
    CacheService.getScriptCache().remove('af_' + authDigest_(email));   // clear any sign-in lock
    authAudit_(actor.email, 'office-account-pw-reset', email);
    return { success: true, message: 'Password reset. Share it with the staff member privately; they can change it after signing in.', data: { email: email } };
  } catch (err) {
    return authFail_(err.message || 'Could not reset the password.');
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
  }
}