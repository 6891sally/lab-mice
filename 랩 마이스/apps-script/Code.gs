/* =====================================================
   LAB MICE 기록 저장 API (Google Apps Script)
   - 화면(게임)은 GitHub Pages에서 실행되고, 여기는 기록만 저장합니다.
   - 구글 시트에서 [확장 프로그램 > Apps Script]로 열어 이 코드를 붙여넣으세요.

   처음 한 번:
   1) setupLabMice() 실행 → 시트 생성 + 교사 비밀번호 기본값(0520) 저장
   2) [프로젝트 설정 > 스크립트 속성]에서 TEACHER_PASSWORD 값을 원하는 비밀번호로 변경
   3) [배포 > 새 배포 > 웹 앱] 실행 사용자: 나 / 액세스 권한: 모든 사용자
   4) 나온 /exec 주소를 GitHub 저장소 js/config.js 의 API_URL에 붙여넣기

   ※ 비밀번호를 코드에 적지 않고 스크립트 속성에 두기 때문에
     이 파일을 공개 GitHub 저장소에 올려도 비밀번호가 드러나지 않아요.
===================================================== */

const LAB_MICE = {
  SETTINGS_SHEET: '설정',
  STUDENTS_SHEET: '학생현황',
  DEFAULT_PASSWORD: '0520',
  MAX_PROGRESS_LENGTH: 40000
};

const DEFAULT_SETTINGS = {
  level2Open: false,
  level3Open: false,
  level4Open: false,
  level5Open: false,
  hintsEnabled: true,
  timerVisible: true,
  starsVisible: true
};

const STUDENT_HEADERS = [
  'studentId', '닉네임', '현재레벨', '현재문제', '해결문제수', '별개수',
  '최근활동(ms)', '진행기록(JSON)', '마지막저장'
];

/* ---------- 처음 한 번 실행 ---------- */
function setupLabMice() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('구글 시트에서 [확장 프로그램 > Apps Script]로 열어 실행해 주세요.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAB_MICE_SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TEACHER_PASSWORD')) props.setProperty('TEACHER_PASSWORD', LAB_MICE.DEFAULT_PASSWORD);
  ensureSheets_(ss);
  return 'LAB MICE 설정 완료 — 스크립트 속성에서 TEACHER_PASSWORD를 꼭 바꿔 주세요.';
}

/* ---------- 웹 앱 진입점 ---------- */
function doGet(e) {
  return handle_(function () {
    const action = (e && e.parameter && e.parameter.action) || 'settings';
    if (action === 'settings') return { settings: getSettings_() };
    if (action === 'ping') return { time: Date.now() };
    throw new Error('알 수 없는 요청: ' + action);
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'save': return saveStudentProgress_(body.data);
      case 'dashboard': return getTeacherDashboard_(body.password);
      case 'saveSettings': return { settings: saveTeacherSettings_(body.password, body.settings) };
      case 'clear': return clearAllStudents_(body.password);
      default: throw new Error('알 수 없는 요청: ' + body.action);
    }
  });
}

function handle_(fn) {
  let out;
  try {
    out = Object.assign({ ok: true }, fn());
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 학생 기록 ---------- */
function saveStudentProgress_(data) {
  if (!data || !data.studentId) throw new Error('studentId가 없습니다.');
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  const sheet = ss.getSheetByName(LAB_MICE.STUDENTS_SHEET);

  const studentId = String(data.studentId).slice(0, 120);
  const nickname = String(data.nickname || '익명 연구원').slice(0, 30);
  let progressJson = String(data.progressJson || '{}');
  if (progressJson.length > LAB_MICE.MAX_PROGRESS_LENGTH) progressJson = '{}';
  const now = Date.now();
  const row = [
    studentId,
    nickname,
    clampNum_(data.currentLevel, 0, 99),
    String(data.currentPuzzle || '').slice(0, 20),
    clampNum_(data.solvedCount, 0, 999),
    clampNum_(data.totalStars, 0, 9999),
    now,
    progressJson,
    new Date()
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const lastRow = sheet.getLastRow();
    let target = -1;
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const idx = ids.findIndex(v => String(v) === studentId);
      if (idx !== -1) target = idx + 2;
    }
    if (target === -1) sheet.appendRow(row);
    else sheet.getRange(target, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  // 학생 화면이 따로 설정을 묻지 않도록 함께 돌려줌
  return { lastActive: now, settings: readSettings_(ss) };
}

/* ---------- 교사 기능 ---------- */
function getTeacherDashboard_(password) {
  assertTeacher_(password);
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  const sheet = ss.getSheetByName(LAB_MICE.STUDENTS_SHEET);
  const lastRow = sheet.getLastRow();
  const students = [];
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 7).getValues().forEach(r => {
      if (!r[0]) return;
      students.push({
        studentId: String(r[0]),
        nickname: String(r[1] || '익명'),
        currentLevel: Number(r[2] || 0),
        currentPuzzle: String(r[3] || ''),
        solvedCount: Number(r[4] || 0),
        totalStars: Number(r[5] || 0),
        lastActive: Number(r[6] || 0)
      });
    });
  }
  return { settings: readSettings_(ss), students: students, serverTime: Date.now() };
}

function saveTeacherSettings_(password, newSettings) {
  assertTeacher_(password);
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  const current = readSettings_(ss);
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (newSettings && Object.prototype.hasOwnProperty.call(newSettings, k)) current[k] = Boolean(newSettings[k]);
  });
  writeSettings_(ss, current);
  return current;
}

function clearAllStudents_(password) {
  assertTeacher_(password);
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  const sheet = ss.getSheetByName(LAB_MICE.STUDENTS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  return {};
}

function assertTeacher_(password) {
  const saved = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD') || LAB_MICE.DEFAULT_PASSWORD;
  if (String(password || '') !== saved) {
    Utilities.sleep(800); // 비밀번호 연속 대입 늦추기
    throw new Error('교사 비밀번호가 올바르지 않습니다.');
  }
}

/* ---------- 시트 ---------- */
function getSettings_() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  return readSettings_(ss);
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('LAB_MICE_SPREADSHEET_ID');
  if (!id) {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('먼저 Apps Script 편집기에서 setupLabMice()를 한 번 실행해 주세요.');
    id = active.getId();
    props.setProperty('LAB_MICE_SPREADSHEET_ID', id);
  }
  return SpreadsheetApp.openById(id);
}

function ensureSheets_(ss) {
  let s = ss.getSheetByName(LAB_MICE.SETTINGS_SHEET);
  if (!s) s = ss.insertSheet(LAB_MICE.SETTINGS_SHEET);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, 2).setValues([['설정', '값']]).setFontWeight('bold');
    s.setFrozenRows(1);
    writeSettings_(ss, DEFAULT_SETTINGS);
  } else {
    // 새로 생긴 설정(level4Open 등)이 없으면 추가
    const keys = s.getLastRow() >= 2 ? s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().flat().map(String) : [];
    if (Object.keys(DEFAULT_SETTINGS).some(k => keys.indexOf(k) === -1)) writeSettings_(ss, readSettings_(ss));
  }

  let st = ss.getSheetByName(LAB_MICE.STUDENTS_SHEET);
  if (!st) st = ss.insertSheet(LAB_MICE.STUDENTS_SHEET);
  if (st.getLastRow() === 0) {
    st.getRange(1, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]).setFontWeight('bold');
    st.setFrozenRows(1);
  }
}

function readSettings_(ss) {
  const s = ss.getSheetByName(LAB_MICE.SETTINGS_SHEET);
  const result = Object.assign({}, DEFAULT_SETTINGS);
  if (!s || s.getLastRow() < 2) return result;
  s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
    k = String(k);
    if (Object.prototype.hasOwnProperty.call(result, k)) result[k] = String(v).toLowerCase() === 'true';
  });
  return result;
}

function writeSettings_(ss, settings) {
  const s = ss.getSheetByName(LAB_MICE.SETTINGS_SHEET);
  const rows = Object.keys(DEFAULT_SETTINGS).map(k => [k, Boolean(settings[k])]);
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).clearContent();
  s.getRange(2, 1, rows.length, 2).setValues(rows);
}

function clampNum_(v, min, max) {
  const n = Number(v);
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
