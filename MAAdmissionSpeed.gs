/**
 * MAAdmissionSpeed.gs
 *
 * Adapted from the Backup project's Speed bundle for the destination
 * AdmissionStudents database.
 *
 * Scope:
 * - Cache compact admission records for staff search/dashboard.
 * - Find one admission record with a cache hit + one sheet-row read.
 * - Invalidate the compact cache after AdmissionStudents writes.
 *
 * Deliberately does NOT replace Auth user reads: the destination Auth layer
 * intentionally re-checks Users on every authenticated request so role/status
 * changes take effect immediately.
 */

var MA_ADM_SPEED = {
  VERSION: 3,
  FIELDS: [
    'StudentID', 'FullName', 'LRN', 'Classification', 'GradeLevel', 'Section',
    'EnrollStatus', 'SchoolYear', 'Category', 'Department', 'Cluster', 'PrevSchool', 'PrevSchoolType', 'PrevScholarship', 'SexualOrient', 'GenderOrient',
    'Email', 'CreatedAt', 'ApplicationStatus', 'ReqConsent', 'ReqSF9InitialStatus', 'ReqSF9CompletionStatus', 'ReqBirthInitialStatus', 'ReqBirthCompletionStatus', 'ReqPhotoStatus', 'ReqEnvelopeStatus', 'ReqF137Status', 'ReqMoralStatus', 'ReqJHSStatus', 'ReqTransfereeStatus', 'ReqConsentStatus', 'TempUntil', 'CertNo', 'VoucherCertNo', 'EscCertNo'
  ],
  CHUNK: 30000,   // characters; CacheService's 100 KB limit is in bytes and accented names take 2+ bytes each
  TTL: 600,
  VERSION_TTL: 21600
};

function maAdmissionSpeedVersion_() {
  var c = CacheService.getScriptCache();
  var v = c.get('ma_adm_stv_' + MA_ADM_SPEED.VERSION);
  if (!v) {
    v = Utilities.getUuid();
    c.put('ma_adm_stv_' + MA_ADM_SPEED.VERSION, v, MA_ADM_SPEED.VERSION_TTL);
  }
  return v;
}

function maAdmissionSpeedBump_() {
  try {
    CacheService.getScriptCache().put('ma_adm_stv_' + MA_ADM_SPEED.VERSION, Utilities.getUuid(), MA_ADM_SPEED.VERSION_TTL);
  } catch (e) {
    console.error('Admission cache version bump failed: ' + e.message);
  }
}

function maAdmissionSpeedPeek_() {
  var c = CacheService.getScriptCache();
  var v = maAdmissionSpeedVersion_();
  var n = Number(c.get('ma_adm_stl_' + v) || 0);
  if (!n) return null;

  var keys = [];
  for (var i = 0; i < n; i++) keys.push('ma_adm_stl_' + v + '_' + i);

  var got = c.getAll(keys);
  for (var j = 0; j < keys.length; j++) {
    if (got[keys[j]] == null) return null;
  }

  try {
    return JSON.parse(keys.map(function (k) { return got[k]; }).join(''));
  } catch (e) {
    return null;
  }
}

function maAdmissionSpeedArray_() {
  var hit = maAdmissionSpeedPeek_();
  if (hit) return hit;

  var v = maAdmissionSpeedVersion_();
  var fields = MA_ADM_SPEED.FIELDS;
  var rows = admissionDbSheet_();
  var last = rows.getLastRow();
  var arr = [];

  if (last >= 2) {
    var values = rows.getRange(2, 1, last - 1, ADM_DB.HEADERS.length).getValues();
    var index = {};
    fields.forEach(function (f) { index[f] = ADM_DB.HEADERS.indexOf(f); });

    values.forEach(function (row) {
      if (!String(row[index.StudentID] || '').trim()) return;
      arr.push(fields.map(function (f) { return row[index[f]] == null ? '' : String(row[index[f]]); }));
    });
  }

  var serialized = JSON.stringify(arr);
  var put = {};
  var count = 0;
  for (var i = 0; i < serialized.length; i += MA_ADM_SPEED.CHUNK) {
    put['ma_adm_stl_' + v + '_' + count++] = serialized.slice(i, i + MA_ADM_SPEED.CHUNK);
  }
  put['ma_adm_stl_' + v] = String(count);

  if (maAdmissionSpeedVersion_() === v) {
    try {
      CacheService.getScriptCache().putAll(put, MA_ADM_SPEED.TTL);
    } catch (e) {
      console.error('Admission compact cache rebuild failed: ' + e.message);
    }
  }

  return arr;
}

function maAdmissionSpeedRecords_() {
  var fields = MA_ADM_SPEED.FIELDS;
  return maAdmissionSpeedArray_().map(function (a) {
    var o = {};
    fields.forEach(function (f, i) { o[f] = a[i]; });
    return o;
  });
}

/**
 * Finds one AdmissionStudents record using the compact cache first.
 * The final full record is still read from the sheet by row number.
 */
function maAdmissionSpeedFindStudent_(studentId) {
  studentId = String(studentId || '');
  if (!studentId) return null;

  var arr = maAdmissionSpeedPeek_();
  if (arr) {
    var idIndex = 0;
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i][idIndex]) === studentId) {
        return maAdmissionSpeedReadStudentRow_(studentId);
      }
    }
  }

  return null;
}

function maAdmissionSpeedReadStudentRow_(studentId) {
  var sh = admissionDbSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;

  var idCol = ADM_DB.HEADERS.indexOf('StudentID') + 1;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  var found = -1;

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '') === studentId) {
      if (found >= 0) throw new Error('Admission database integrity error: duplicate StudentID.');
      found = i + 2;
    }
  }

  if (found < 0) return null;

  var row = sh.getRange(found, 1, 1, ADM_DB.HEADERS.length).getValues()[0];
  var record = { _row: found };
  ADM_DB.HEADERS.forEach(function (h, j) {
    record[h] = row[j] == null ? '' : String(row[j]);
  });
  return record;
}

function maAdmissionSpeedTest() {
  authRequireEditor_();

  maAdmissionSpeedBump_();

  var t0 = Date.now();
  maAdmissionSpeedRecords_();
  var miss = Date.now() - t0;

  t0 = Date.now();
  maAdmissionSpeedRecords_();
  var hit = Date.now() - t0;

  Logger.log('Admission compact cache rebuild: ' + miss + ' ms');
  Logger.log('Admission compact cache hit: ' + hit + ' ms');
}
