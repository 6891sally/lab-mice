/* =====================================================
   LAB MICE 게임 본체 (GitHub Pages에서 실행)
   - 퍼즐: js/puzzles.js (tools/generator.html로 생성)
   - 규칙: js/labmice-core.js
   - 기록 저장: js/api.js → Apps Script
===================================================== */
(function () {
  'use strict';

  const Core = window.LabMiceCore;
  const Api = window.LabApi;
  const PUZZLE_SETS = window.LAB_PUZZLE_SETS || {};
  const DIFFICULTY = {
    easy:   { label: '입문', grade: '3~4학년', icon: '🌱' },
    normal: { label: '기본', grade: '5~6학년', icon: '🧀' },
    hard:   { label: '도전', grade: '영재·심화', icon: '🔥' }
  };
  let PUZZLES = PUZZLE_SETS.normal || [];
  const CONFIG = window.LAB_CONFIG || {};
  const LEVELS = [0, 1, 2, 3, 4, 5];
  const STORE = 'labMice2_';

  const COLORS = {
    red:    { name: '빨간', hex: '#ef4444', num: 1 },
    blue:   { name: '파란', hex: '#3b82f6', num: 2 },
    yellow: { name: '노란', hex: '#eab308', num: 3 },
    green:  { name: '초록', hex: '#22c55e', num: 4 },
    purple: { name: '보라', hex: '#a855f7', num: 5 },
    orange: { name: '주황', hex: '#f97316', num: 6 }
  };

  const THEMES = {
    0: { icon: '🐣', name: '치즈 연습실', color: '#d97706', desc: '규칙을 익히는 연습 문제', chips: ['기본 규칙'] },
    1: { icon: '🌱', name: '기초 연구실', color: '#16a34a', desc: '쥐가 조금 늘어나요. 길을 잘 계획하세요.', chips: [] },
    2: { icon: '🧱', name: '미로 연구실', color: '#2563eb', desc: '벽이 생겼어요. 벽은 넘어갈 수 없어요.', chips: ['🧱 벽'] },
    3: { icon: '🪤', name: '덫 연구실', color: '#0d9488', desc: '덫 칸은 아무도 지나갈 수 없어요.', chips: ['🧱 벽', '🪤 덫'] },
    4: { icon: '➜', name: '일방통행 연구실', color: '#7c3aed', desc: '화살표 칸에서는 화살표 방향으로만 나가요.', chips: ['➜ 일방통행'] },
    5: { icon: '🧪', name: '시약 연구실', color: '#be123c', desc: '시약은 같은 색 쥐가 꼭 지나가야 해요.', chips: ['🧪 시약', '모든 장치'] }
  };

  // 별점 기준: 판 크기에 맞춰 목표 시간(초)과 실수 허용 횟수를 정함
  function scoreRule(p) {
    const open = p.rows * p.cols - (p.traps || []).length;
    return { target: Math.max(60, Math.round(open * 4 / 10) * 10), ok3: 2 + p.level, ok2: 6 + p.level * 2 };
  }
  const UNLOCK_NEED = 3; // 이전 레벨에서 몇 문제를 풀어야 열리는지

  const DEFAULT_SETTINGS = {
    difficulty: 'normal',
    level2Open: false, level3Open: false, level4Open: false, level5Open: false,
    hintsEnabled: true, timerVisible: true, starsVisible: true
  };

  function useDifficulty(key) {
    const k = PUZZLE_SETS[key] ? key : 'normal';
    PUZZLES = PUZZLE_SETS[k] || [];
    return k;
  }

  /* ---------- 저장소 ---------- */
  function lsGet(k, fb) { try { const v = localStorage.getItem(STORE + k); return v === null ? fb : v; } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(STORE + k, v); } catch (e) { /* 무시 */ } }
  function lsDel(k) { try { localStorage.removeItem(STORE + k); } catch (e) { /* 무시 */ } }
  function safeParse(s, fb) { try { return JSON.parse(s); } catch (e) { return fb; } }

  function makeStudentId() {
    let id = lsGet('studentId', '');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'student_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      lsSet('studentId', id);
    }
    return id;
  }

  const state = {
    view: 'ROLE',
    nickname: lsGet('nickname', ''),
    studentId: makeStudentId(),
    progress: safeParse(lsGet('progress', '{}'), {}),
    settings: Object.assign({}, DEFAULT_SETTINGS, Api.enabled ? {} : {
      level2Open: true, level3Open: true, level4Open: true, level5Open: true,
      difficulty: lsGet('offlineDifficulty', 'normal')
    }),
    // 게임
    puzzle: null, g: null,
    paths: {}, drawing: null, strokeErased: false,
    history: [], mistakes: 0, restarts: 0, undos: 0, erases: 0,
    hintLevel: 0, hintCap: 3, ghost: null,
    isWin: false, animating: false,
    feedback: '', feedbackKind: '',
    timer: 0, timerHandle: null,
    modal: null,
    // 교사
    teacherPassword: '', teacherError: '', teacherStudents: [], teacherSort: 'active', dashHandle: null
  };

  /* ---------- 유틸 ---------- */
  const $ = id => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  function fmt(sec) { return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  const levelPuzzles = lv => PUZZLES.filter(p => p.level === lv);
  const levelSolved = lv => levelPuzzles(lv).filter(p => state.progress[p.id] && state.progress[p.id].solved).length;
  const solvedCount = () => PUZZLES.filter(p => state.progress[p.id] && state.progress[p.id].solved).length;
  const totalStars = () => PUZZLES.reduce((a, p) => a + ((state.progress[p.id] && state.progress[p.id].stars) || 0), 0);

  function isLevelUnlocked(lv) {
    if (lv <= 1) return true;
    if (!state.settings['level' + lv + 'Open']) return false;
    return levelSolved(lv - 1) >= UNLOCK_NEED;
  }
  function lockReason(lv) {
    if (!state.settings['level' + lv + 'Open']) return '🔒 선생님이 아직 열지 않았어요';
    return '🔒 LEVEL ' + (lv - 1) + '에서 ' + UNLOCK_NEED + '문제를 풀면 열려요';
  }

  /* ---------- 서버 동기화 ---------- */
  let syncTimer = null;
  function syncStudent(override) {
    if (!Api.enabled || !state.nickname) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const p = state.puzzle;
      const data = Object.assign({
        studentId: state.studentId,
        nickname: state.nickname,
        currentLevel: p ? p.level : 0,
        currentPuzzle: p ? p.id : '',
        solvedCount: solvedCount(),
        totalStars: totalStars(),
        progressJson: JSON.stringify(state.progress)
      }, override || {});
      try {
        const res = await Api.saveStudent(data);
        if (res.settings) applySettings(res.settings);
      } catch (e) { console.warn('기록 저장 실패', e); }
    }, 300);
  }

  function applySettings(s) {
    const next = Object.assign({}, DEFAULT_SETTINGS, s);
    if (!Api.enabled) next.difficulty = state.settings.difficulty;
    const changed = JSON.stringify(next) !== JSON.stringify(state.settings);
    state.settings = next;
    // 문제를 푸는 중에는 문제 세트를 바꾸지 않고, 목록으로 돌아갈 때 바꿈
    if (state.view !== 'GAME') useDifficulty(next.difficulty);
    if (changed && state.view === 'LEVELS') render();
  }

  async function refreshSettings() {
    if (!Api.enabled) return;
    try { applySettings(await Api.getSettings()); } catch (e) { console.warn('설정 불러오기 실패', e); }
  }

  function saveProgress() {
    lsSet('progress', JSON.stringify(state.progress));
    syncStudent();
  }

  /* ---------- 타이머 ---------- */
  function stopTimer() { if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; } }
  function startTimer() {
    stopTimer();
    state.timerHandle = setInterval(() => {
      state.timer++;
      const el = $('timerText');
      if (el) el.textContent = fmt(state.timer);
    }, 1000);
  }

  function setView(v) {
    if (v !== 'GAME') stopTimer();
    if (v !== 'TEACHER' && state.dashHandle) { clearInterval(state.dashHandle); state.dashHandle = null; }
    if (v === 'LEVELS') useDifficulty(state.settings.difficulty);
    state.view = v;
    render();
  }

  /* =====================================================
     화면
  ===================================================== */
  function render() {
    const app = $('app');
    ({
      ROLE: renderRole, START: renderStart, LEVELS: renderLevels, GAME: renderGame,
      TEACHER_AUTH: renderTeacherAuth, TEACHER: renderTeacher
    })[state.view](app);
  }

  function renderRole(app) {
    app.innerHTML = `
      <div class="page center">
        <div class="card" style="width:min(460px,100%)">
          <div class="logo">
            <div class="mark">🐭🧪🧀</div>
            <h1 class="display">LAB MICE</h1>
            <p>실험실 쥐들이 같은 색 치즈까지 가도록<br>모든 칸을 채우는 길을 만들어 주세요!</p>
          </div>
          <div class="stack" style="margin-top:24px">
            <button class="btn btn-primary" id="studentStart">🐭 연구원(학생)으로 시작</button>
            <button class="btn btn-ghost" id="teacherStart">🔐 교사 모드</button>
          </div>
          <div class="version">버전 ${esc(CONFIG.APP_VERSION || '')}${Api.enabled ? '' : ' · 오프라인 모드(기록은 이 기기에만 저장)'}</div>
        </div>
      </div>`;
    $('studentStart').onclick = () => setView(state.nickname ? 'LEVELS' : 'START');
    $('teacherStart').onclick = () => {
      if (!Api.enabled) return toast('js/config.js에 API_URL을 넣어야 교사 모드를 쓸 수 있어요.');
      state.teacherError = '';
      setView('TEACHER_AUTH');
    };
  }

  function renderStart(app) {
    app.innerHTML = `
      <div class="page center">
        <div class="card" style="width:min(460px,100%)">
          <div class="logo"><div class="mark">🥼</div><h1 class="display" style="font-size:32px">연구원 등록</h1>
            <p>선생님이 알아볼 수 있는 이름을 써 주세요.</p></div>
          <div class="stack" style="margin-top:22px">
            <input class="input" id="nameInput" maxlength="20" placeholder="예: 3번 김연구" value="${esc(state.nickname)}">
            <div class="row">
              <button class="btn btn-ghost grow" id="backRole">돌아가기</button>
              <button class="btn btn-primary grow" id="goLevels">실험 시작</button>
            </div>
          </div>
        </div>
      </div>`;
    const start = () => {
      const name = $('nameInput').value.trim();
      if (!name) return toast('이름을 입력해 주세요.');
      state.nickname = name;
      lsSet('nickname', name);
      setView('LEVELS');
    };
    $('goLevels').onclick = start;
    $('nameInput').onkeydown = e => { if (e.key === 'Enter') start(); };
    $('backRole').onclick = () => setView('ROLE');
    $('nameInput').focus();
  }

  function renderLevels(app) {
    const solved = solvedCount(), total = PUZZLES.length;
    const dk = useDifficulty(state.settings.difficulty), D = DIFFICULTY[dk];
    let html = `
      <div class="page"><div class="wrap">
        <div class="topbar">
          <div class="between">
            <div><div class="small">연구원 · ${D.icon} ${D.label} 난이도 (${D.grade})</div><div class="name">${esc(state.nickname)}</div></div>
            <div class="stat"><b>${solved}</b> / ${total} 해결${state.settings.starsVisible ? `<div class="small">⭐ ${totalStars()}</div>` : ''}</div>
          </div>
          <div class="progress"><i style="width:${total ? (solved / total * 100) : 0}%"></i></div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-sm btn-ghost" id="rulesBtn">📖 규칙</button>
            <button class="btn btn-sm btn-ghost" id="changeName">이름 변경</button>
            ${Api.enabled ? '' : `<select class="btn btn-sm btn-ghost" id="offlineDiff">${Object.keys(DIFFICULTY).map(k =>
              `<option value="${k}" ${k === dk ? 'selected' : ''}>${DIFFICULTY[k].label} (${DIFFICULTY[k].grade})</option>`).join('')}</select>`}
            <span class="grow"></span>
            <button class="btn btn-sm btn-ghost" id="homeBtn">🏠</button>
          </div>
        </div>
        <div class="levels">`;

    LEVELS.forEach(lv => {
      const t = THEMES[lv], list = levelPuzzles(lv), unlocked = isLevelUnlocked(lv);
      if (!list.length) return;
      const maxPairs = Math.max(...list.map(p => p.pairs.length));
      const chips = [`${list[0].rows}×${list[0].cols}`, `🐭 최대 ${maxPairs}마리`].concat(t.chips);
      html += `
        <section class="level-card ${unlocked ? '' : 'locked'}" style="--lv:${t.color}">
          <div class="level-head">
            <div>
              <div class="level-name display">${unlocked ? t.icon : '🔒'} LEVEL ${lv}</div>
              <div class="level-sub">${t.name} <span class="small">(${levelSolved(lv)}/${list.length})</span></div>
              <div class="level-desc">${unlocked ? t.desc : lockReason(lv)}</div>
              <div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>
            </div>
          </div>
          <div class="puzzle-grid">
            ${list.map((p, i) => {
              const pd = state.progress[p.id];
              return `<button class="puzzle-btn ${pd && pd.solved ? 'solved' : ''}" data-pid="${p.id}" ${unlocked ? '' : 'disabled'}>
                ${i + 1}
                ${pd && pd.solved && state.settings.starsVisible ? `<span class="stars">${'⭐'.repeat(pd.stars || 1)}</span>` : ''}
              </button>`;
            }).join('')}
          </div>
        </section>`;
    });

    html += `</div>
        <div style="margin-top:16px;text-align:center">
          <button class="btn btn-sm btn-ghost" id="resetMine">내 기록 초기화</button>
        </div>
      </div></div>
      ${state.modal ? state.modal() : ''}`;
    app.innerHTML = html;

    app.querySelectorAll('[data-pid]').forEach(btn => {
      btn.onclick = () => loadPuzzle(PUZZLES.find(p => p.id === btn.dataset.pid));
    });
    $('changeName').onclick = () => setView('START');
    $('homeBtn').onclick = () => setView('ROLE');
    if ($('offlineDiff')) $('offlineDiff').onchange = e => {
      state.settings.difficulty = e.target.value;
      lsSet('offlineDifficulty', e.target.value);
      render();
    };
    $('rulesBtn').onclick = () => { state.modal = () => rulesModal(null); render(); bindModal(); };
    $('resetMine').onclick = () => {
      if (!confirm('이 기기의 내 게임 기록을 모두 지울까요?')) return;
      state.progress = {};
      lsDel('progress');
      render();
      syncStudent({ solvedCount: 0, totalStars: 0 });
    };
    bindModal();
    syncStudent({ currentPuzzle: '' });
  }

  /* ---------- 규칙 설명 ---------- */
  const RULES = [
    { lv: 0, ic: '🐭', text: '같은 색 <b>쥐</b>에서 출발해 같은 색 <b>치즈</b>까지 손가락으로 길을 그어요.' },
    { lv: 0, ic: '⬜', text: '<b>모든 칸</b>을 채워야 성공! 길끼리는 겹칠 수 없어요.' },
    { lv: 2, ic: '🧱', text: '<b>벽</b>(굵은 선)은 넘어갈 수 없어요.' },
    { lv: 3, ic: '🪤', text: '<b>덫</b> 칸은 아무도 못 지나가고, 채우지 않아도 돼요.' },
    { lv: 4, ic: '➜', text: '<b>일방통행</b> 칸에 들어가면 화살표 방향으로만 나갈 수 있어요.' },
    { lv: 5, ic: '🧪', text: '<b>시약</b> 칸은 같은 색 쥐만 지나갈 수 있고, 반드시 지나가야 해요.' },
    { lv: 0, ic: '⭐', text: '실수(되돌리기·지우기·처음부터)가 적고, 목표 시간 안에 풀고, 힌트를 덜 쓸수록 별이 많아요.' }
  ];

  function rulesModal(onlyLevel) {
    const list = onlyLevel === null ? RULES : RULES.filter(r => r.lv === onlyLevel);
    const title = onlyLevel === null ? '게임 규칙' : '새 장치 등장!';
    return `
      <div class="overlay"><div class="modal">
        <div class="big">${onlyLevel === null ? '📖' : THEMES[onlyLevel].icon}</div>
        <h2 class="display">${title}</h2>
        <div class="rule-list">${list.map(r => `<div class="rule-item"><span class="ic">${r.ic}</span><span>${r.text}</span></div>`).join('')}</div>
        <button class="btn btn-primary" id="modalClose" style="width:100%">알겠어요!</button>
      </div></div>`;
  }
  function bindModal() {
    const b = $('modalClose');
    if (b) b.onclick = () => { state.modal = null; render(); };
  }

  /* =====================================================
     게임
  ===================================================== */
  function loadPuzzle(p) {
    state.puzzle = p;
    state.g = Core.compile(p);
    state.paths = {};
    p.pairs.forEach(pair => { state.paths[pair.id] = [{ r: pair.mouse[0], c: pair.mouse[1] }]; });
    Object.assign(state, {
      drawing: null, strokeErased: false, history: [], mistakes: 0, restarts: 0, undos: 0, erases: 0,
      hintLevel: 0, hintCap: 3, ghost: null, isWin: false, animating: false,
      feedback: '', feedbackKind: '', timer: 0, modal: null
    });
    // 새 장치가 처음 나오는 레벨이면 설명 보여주기
    const introLv = [0, 2, 3, 4, 5].includes(p.level) ? p.level : -1;
    if (introLv >= 0 && !lsGet('intro' + introLv, '')) {
      state.modal = () => rulesModal(introLv);
      lsSet('intro' + introLv, '1');
    }
    state.view = 'GAME';
    renderGame();
    startTimer();
    syncStudent({ currentLevel: p.level, currentPuzzle: p.id });
  }

  function renderGame() {
    const p = state.puzzle;
    if (!p) return;
    const app = $('app');
    const list = levelPuzzles(p.level);
    const idx = list.findIndex(x => x.id === p.id) + 1;
    app.innerHTML = `
      <div class="game-shell">
        <div class="game-top">
          <button class="icon-btn" id="backLevels" aria-label="문제 선택으로">←</button>
          <div class="game-title"><div class="small">LEVEL ${p.level} · ${THEMES[p.level].name}</div><b>문제 ${idx} / ${list.length}</b></div>
          ${state.settings.timerVisible
            ? `<div class="timer">⏱ <span id="timerText">${fmt(state.timer)}</span></div>`
            : '<div style="width:82px"></div>'}
        </div>
        <div class="game-main">
          <div class="board-wrap">
            <div class="status">
              <div class="pill">채운 칸 <span id="usedText"></span></div>
              <div class="pill" id="mistakeText"></div>
            </div>
            <div style="height:8px"></div>
            <div id="gameBoard"><div class="board-inner">
              <div class="cells" id="cells"></div>
              <svg class="layer paths" id="pathLayer" viewBox="0 0 ${p.cols} ${p.rows}" preserveAspectRatio="none"></svg>
              <svg class="layer marks" id="markLayer" viewBox="0 0 ${p.cols} ${p.rows}" preserveAspectRatio="none"></svg>
            </div></div>
            <div style="height:10px"></div>
            <div class="feedback" id="feedbackBox"></div>
          </div>
        </div>
        <div class="game-actions">
          <button class="btn btn-ghost" id="undoBtn">↶ <span class="label">되돌리기</span></button>
          <button class="btn btn-ghost" id="restartBtn">🔄 <span class="label">처음부터</span></button>
          <button class="btn btn-ghost" id="rulesBtn2">📖 <span class="label">규칙</span></button>
          ${state.settings.hintsEnabled ? '<button class="btn btn-navy" id="hintBtn">💡 <span class="label">힌트</span></button>' : ''}
        </div>
      </div>
      ${state.isWin && !state.animating ? winModal() : ''}
      ${state.modal ? state.modal() : ''}`;

    $('backLevels').onclick = () => { stopTimer(); state.puzzle = null; setView('LEVELS'); };
    $('undoBtn').onclick = undoMove;
    $('restartBtn').onclick = restartPuzzle;
    $('rulesBtn2').onclick = () => { state.modal = () => rulesModal(null); renderGame(); };
    if ($('hintBtn')) $('hintBtn').onclick = showHint;
    if ($('nextBtn')) $('nextBtn').onclick = goNext;
    if ($('listBtn')) $('listBtn').onclick = () => { state.puzzle = null; setView('LEVELS'); };
    const mc = $('modalClose');
    if (mc) mc.onclick = () => { state.modal = null; renderGame(); };

    buildCells();
    drawMarks();
    drawPaths();
    const board = $('gameBoard');
    board.onpointerdown = pointerDown;
    board.onpointermove = pointerMove;
    board.onpointerup = pointerUp;
    board.onpointercancel = pointerUp;
  }

  function buildCells() {
    const p = state.puzzle, g = state.g;
    const cells = $('cells');
    cells.style.gridTemplateColumns = `repeat(${p.cols},1fr)`;
    cells.style.gridTemplateRows = `repeat(${p.rows},1fr)`;
    let html = '';
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const i = r * p.cols + c;
      let inner = '';
      const end = endpointAt(r, c);
      if (end) {
        const col = COLORS[end.color];
        inner = `<span class="emoji">${end.type === 'mouse' ? '🐭' : '🧀'}</span>
                 <span class="badge" style="background:${col.hex}">${col.num}</span>`;
      } else if (g.trap[i]) {
        inner = '<span class="emoji" style="opacity:.75">🪤</span>';
      }
      html += `<div class="cell ${g.trap[i] ? 'trap' : ''}">${inner}</div>`;
    }
    cells.innerHTML = html;
  }

  function drawMarks() {
    const p = state.puzzle;
    let svg = '';
    // 시약
    (p.checkpoints || []).forEach(([r, c, id]) => {
      svg += `<circle cx="${c + .5}" cy="${r + .5}" r=".36" fill="#fff" stroke="${COLORS[id].hex}" stroke-width=".08" opacity=".95"/>
              <text x="${c + .5}" y="${r + .62}" font-size=".42" text-anchor="middle">🧪</text>`;
    });
    // 일방통행 화살표
    const rot = { U: -90, D: 90, L: 180, R: 0 };
    (p.arrows || []).forEach(([r, c, d]) => {
      svg += `<g transform="translate(${c + .5} ${r + .5}) rotate(${rot[d]})">
                <circle r=".3" fill="#fff" stroke="#12324a" stroke-width=".05" opacity=".95"/>
                <path d="M -.14 -.15 L .1 0 L -.14 .15" fill="none" stroke="#12324a" stroke-width=".09" stroke-linecap="round" stroke-linejoin="round"/>
              </g>`;
    });
    // 벽
    (p.walls || []).forEach(([r, c, s]) => {
      if (s === 'R') svg += `<line x1="${c + 1}" y1="${r - .02}" x2="${c + 1}" y2="${r + 1.02}" stroke="#12324a" stroke-width=".14" stroke-linecap="round"/>`;
      else svg += `<line x1="${c - .02}" y1="${r + 1}" x2="${c + 1.02}" y2="${r + 1}" stroke="#12324a" stroke-width=".14" stroke-linecap="round"/>`;
    });
    $('markLayer').innerHTML = svg;
  }

  function drawPaths() {
    const layer = $('pathLayer');
    if (!layer) return;
    let svg = '';
    if (state.ghost) {
      const pts = state.ghost.cells.map(([r, c]) => `${c + .5},${r + .5}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${COLORS[state.ghost.color].hex}" stroke-width=".16"
                 stroke-dasharray=".18 .14" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`;
    }
    for (const [color, path] of Object.entries(state.paths)) {
      const hex = COLORS[color].hex;
      path.forEach(pt => {
        svg += `<rect x="${pt.c + .04}" y="${pt.r + .04}" width=".92" height=".92" rx=".12" fill="${hex}" opacity=".16"/>`;
      });
      if (path.length < 2) continue;
      const pts = path.map(pt => `${pt.c + .5},${pt.r + .5}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${hex}" stroke-width=".3" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
    }
    layer.innerHTML = svg;
    updateHud();
  }

  function updateHud() {
    const p = state.puzzle;
    const open = p.rows * p.cols - (p.traps || []).length;
    const used = Object.values(state.paths).reduce((a, x) => a + x.length, 0) + p.pairs.filter(pair => !isFinished(pair.id)).length;
    const u = $('usedText');
    if (u) u.textContent = `${used}/${open}`;
    const m = $('mistakeText');
    if (m) {
      const rule = scoreRule(p);
      m.textContent = `실수 ${state.mistakes}${state.hintCap < 3 ? ` · 최대 ${'⭐'.repeat(state.hintCap)}` : ''}`;
      m.className = 'pill' + (state.mistakes > rule.ok3 ? ' warn' : '');
    }
    const fb = $('feedbackBox');
    if (fb) {
      fb.innerHTML = state.feedback || '쥐를 눌러 치즈까지 길을 그어 보세요.';
      fb.className = 'feedback' + (state.feedbackKind ? ' ' + state.feedbackKind : '');
    }
  }

  function say(msg, kind) {
    state.feedback = msg; state.feedbackKind = kind || '';
    updateHud();
    if (kind === 'warn') {
      const fb = $('feedbackBox');
      if (fb) { fb.classList.remove('shake'); void fb.offsetWidth; fb.classList.add('shake'); }
    }
  }

  /* ---------- 판 정보 ---------- */
  function endpointAt(r, c) {
    for (const pair of state.puzzle.pairs) {
      if (pair.mouse[0] === r && pair.mouse[1] === c) return { type: 'mouse', color: pair.id };
      if (pair.cheese[0] === r && pair.cheese[1] === c) return { type: 'cheese', color: pair.id };
    }
    return null;
  }
  function pairOf(color) { return state.puzzle.pairs.find(x => x.id === color); }
  function isFinished(color) {
    const path = state.paths[color], pair = pairOf(color), last = path[path.length - 1];
    return last.r === pair.cheese[0] && last.c === pair.cheese[1];
  }
  function ownerAt(r, c) {
    for (const [color, path] of Object.entries(state.paths)) {
      const i = path.findIndex(pt => pt.r === r && pt.c === c);
      if (i >= 0) return { color, index: i };
    }
    return null;
  }
  function checkpointAt(r, c) {
    const cp = (state.puzzle.checkpoints || []).find(x => x[0] === r && x[1] === c);
    return cp ? cp[2] : null;
  }
  function cellFromEvent(e) {
    const inner = $('gameBoard').querySelector('.board-inner');
    const rect = inner.getBoundingClientRect();
    const p = state.puzzle;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    return { r: Math.floor(y / rect.height * p.rows), c: Math.floor(x / rect.width * p.cols) };
  }

  function snapshot(color) { return { color, prev: state.paths[color].map(x => ({ ...x })) }; }
  function addMistake(n) { state.mistakes += n; }

  /* ---------- 입력 ---------- */
  function pointerDown(e) {
    if (state.isWin || state.modal) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
    const cell = cellFromEvent(e);
    if (!cell) return;
    state.strokeErased = false;
    const hit = ownerAt(cell.r, cell.c);
    if (hit) {
      const path = state.paths[hit.color];
      if (hit.index < path.length - 1) {
        // 길 중간을 누르면 그 뒤를 잘라냄 (지우기 = 실수 1)
        state.history.push(snapshot(hit.color));
        state.paths[hit.color] = path.slice(0, hit.index + 1);
        state.erases++; addMistake(1); state.strokeErased = true;
        drawPaths();
      }
      state.drawing = hit.color;
      return;
    }
    const end = endpointAt(cell.r, cell.c);
    if (end && end.type === 'cheese') say('🧀 치즈가 아니라 <b>쥐</b>에서 출발해요!', 'warn');
  }

  function pointerMove(e) {
    if (!state.drawing || state.isWin) return;
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (!cell) return;
    // 빠르게 움직여 칸을 건너뛰면 한 칸씩 따라감
    let guard = 0;
    while (guard++ < 20) {
      const path = state.paths[state.drawing];
      const last = path[path.length - 1];
      if (last.r === cell.r && last.c === cell.c) break;
      const dr = cell.r - last.r, dc = cell.c - last.c;
      const step = Math.abs(dr) >= Math.abs(dc) ? { r: last.r + Math.sign(dr), c: last.c } : { r: last.r, c: last.c + Math.sign(dc) };
      if (!tryStep(step)) break;
      if (!state.drawing) break;
    }
  }

  function tryStep(cell) {
    const color = state.drawing, path = state.paths[color];
    const last = path[path.length - 1];
    const p = state.puzzle, g = state.g;

    // 바로 전 칸으로 돌아가면 지우기
    if (path.length > 1) {
      const prev = path[path.length - 2];
      if (prev.r === cell.r && prev.c === cell.c) {
        if (!state.strokeErased) { state.history.push(snapshot(color)); state.erases++; addMistake(1); state.strokeErased = true; }
        state.paths[color] = path.slice(0, -1);
        drawPaths();
        return true;
      }
    }
    if (isFinished(color)) return false;
    if (path.some(pt => pt.r === cell.r && pt.c === cell.c)) return false;

    const a = last.r * p.cols + last.c, b = cell.r * p.cols + cell.c;
    const d = Core.dirBetween({ nbr: rawNeighbors() }, a, b);
    if (g.trap[b]) { say('🪤 덫 칸은 지나갈 수 없어요.', 'warn'); return false; }
    if (d < 0) return false;
    if (g.nbr[a * 4 + d] < 0) { say('🧱 벽으로 막혀 있어요.', 'warn'); return false; }
    if (Core.stepOk(g, a, d) !== b) { say('➜ 일방통행! 화살표 방향으로만 지나갈 수 있어요.', 'warn'); return false; }

    const end = endpointAt(cell.r, cell.c);
    if (end && end.color !== color) { say(`다른 색(${COLORS[end.color].name}색) 쥐·치즈 칸이에요.`, 'warn'); return false; }
    const owner = ownerAt(cell.r, cell.c);
    if (owner && owner.color !== color) { say(`${COLORS[owner.color].name}색 쥐의 길이에요. 먼저 그 길을 지워 주세요.`, 'warn'); return false; }
    const cp = checkpointAt(cell.r, cell.c);
    if (cp && cp !== color) { say(`🧪 ${COLORS[cp].name}색 쥐만 지나갈 수 있는 시약이에요.`, 'warn'); return false; }

    const pair = pairOf(color);
    const isCheese = cell.r === pair.cheese[0] && cell.c === pair.cheese[1];
    if (isCheese) {
      const need = (p.checkpoints || []).filter(x => x[2] === color);
      const missed = need.filter(([r, c]) => !path.some(pt => pt.r === r && pt.c === c));
      if (missed.length) { say(`🧪 먼저 ${COLORS[color].name}색 시약을 지나가야 해요! (${missed.length}개 남음)`, 'warn'); return false; }
    }

    if (!state.strokeErased && (state.history.length === 0 || state.history[state.history.length - 1].stroke !== state.strokeId)) {
      const snap = snapshot(color); snap.stroke = state.strokeId; state.history.push(snap);
    }
    state.paths[color] = [...path, cell];
    if (state.ghost && state.ghost.color === color) state.ghost = null;
    if (isCheese) {
      state.drawing = null;
      say(`${COLORS[color].name}색 쥐 도착! 🧀`, 'good');
    } else if (state.feedbackKind === 'warn') {
      say('', '');
    }
    drawPaths();
    checkWin();
    return true;
  }

  // 벽을 무시한 이웃 (방향 계산용)
  let rawNbrCache = null;
  function rawNeighbors() {
    const p = state.puzzle;
    if (rawNbrCache && rawNbrCache.id === p.id) return rawNbrCache.nbr;
    const N = p.rows * p.cols, nbr = new Int16Array(N * 4).fill(-1);
    for (let i = 0; i < N; i++) {
      const r = (i / p.cols) | 0, c = i % p.cols;
      Core.DIRS.forEach(([dr, dc], d) => {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < p.rows && cc >= 0 && cc < p.cols) nbr[i * 4 + d] = rr * p.cols + cc;
      });
    }
    rawNbrCache = { id: p.id, nbr };
    return nbr;
  }

  state.strokeId = 0;
  function pointerUp() {
    state.drawing = null;
    state.strokeErased = false;
    state.strokeId++;
  }

  function undoMove() {
    if (state.isWin || !state.history.length) return;
    const h = state.history.pop();
    state.paths[h.color] = h.prev;
    state.undos++; addMistake(1);
    say('↶ 한 번 되돌렸어요.', '');
    drawPaths();
  }

  function restartPuzzle() {
    if (state.isWin) return;
    const drawn = Object.values(state.paths).some(x => x.length > 1);
    if (!drawn) return;
    state.puzzle.pairs.forEach(pair => { state.paths[pair.id] = [{ r: pair.mouse[0], c: pair.mouse[1] }]; });
    state.history = [];
    state.restarts++; addMistake(2);
    state.ghost = null;
    say('🔄 처음부터 다시! (실수 +2)', '');
    drawPaths();
  }

  /* ---------- 힌트 ---------- */
  function wrongColor() {
    // 정답과 처음 어긋나는 색 (아직 시작 안 한 색 포함). 가장 일찍 어긋난 색 우선
    const sol = state.puzzle.solution;
    let best = null, bestScore = Infinity;
    for (const pair of state.puzzle.pairs) {
      const mine = state.paths[pair.id], right = sol[pair.id];
      let k = 0;
      while (k < mine.length && k < right.length && mine[k].r === right[k][0] && mine[k].c === right[k][1]) k++;
      const correct = k === right.length && mine.length === right.length;
      if (correct) continue;
      const score = k; // 덜 맞은 색일수록 먼저
      if (score < bestScore) { bestScore = score; best = { color: pair.id, k }; }
    }
    return best;
  }

  function showHint() {
    if (state.isWin) return;
    const w = wrongColor();
    if (!w) return say('지금 길은 모두 정답과 같아요. 남은 칸을 확인해 보세요!', 'hint');
    if (state.hintLevel === 0) {
      state.hintLevel = 1;
      return say('💡 구석, 벽 옆, 덫 옆처럼 <b>갈 곳이 하나뿐인 칸</b>을 먼저 찾아보세요. 그 칸을 채울 수 있는 색은 몇 개일까요? (다음 힌트부터 별이 줄어요)', 'hint');
    }
    const right = state.puzzle.solution[w.color];
    if (state.hintLevel === 1) {
      state.hintLevel = 2;
      state.hintCap = Math.min(state.hintCap, 2);
      state.ghost = { color: w.color, cells: right.slice(0, Math.min(right.length, Math.max(w.k, 1) + 3)) };
      drawPaths();
      return say(`💡 ${COLORS[w.color].name}색 쥐의 처음 길을 점선으로 보여 줄게요. (최대 ⭐⭐)`, 'hint');
    }
    // 3단계: 한 색의 정답 길을 그려 줌
    state.hintLevel = 3;
    state.hintCap = 1;
    const cells = new Set(right.map(([r, c]) => r + ',' + c));
    for (const [color, path] of Object.entries(state.paths)) {
      if (color === w.color) continue;
      const cut = path.findIndex(pt => cells.has(pt.r + ',' + pt.c));
      if (cut > 0) state.paths[color] = path.slice(0, cut);
    }
    state.paths[w.color] = right.map(([r, c]) => ({ r, c }));
    state.ghost = null;
    state.history = [];
    say(`💡 ${COLORS[w.color].name}색 쥐의 길을 대신 그려 줬어요. (최대 ⭐)`, 'hint');
    drawPaths();
    checkWin();
  }

  /* ---------- 승리 ---------- */
  function computeScore() {
    const rule = scoreRule(state.puzzle);
    const lines = [];
    let stars = 3;
    if (state.mistakes > rule.ok2) { stars = 1; lines.push([`실수 ${state.mistakes}회 (${rule.ok2}회 초과)`, -2]); }
    else if (state.mistakes > rule.ok3) { stars = 2; lines.push([`실수 ${state.mistakes}회 (${rule.ok3}회 초과)`, -1]); }
    else lines.push([`실수 ${state.mistakes}회`, 0]);
    if (state.settings.timerVisible) {
      if (state.timer > rule.target) { stars--; lines.push([`시간 ${fmt(state.timer)} (목표 ${fmt(rule.target)} 초과)`, -1]); }
      else lines.push([`시간 ${fmt(state.timer)} (목표 ${fmt(rule.target)})`, 0]);
    }
    if (state.hintCap < 3) lines.push([`힌트 사용 → 최대 ${'⭐'.repeat(state.hintCap)}`, null]);
    stars = Math.max(1, Math.min(stars, state.hintCap));
    return { stars, lines };
  }

  function checkWin() {
    const p = state.puzzle;
    const all = p.pairs.every(pair => isFinished(pair.id));
    if (!all) return;
    const open = p.rows * p.cols - (p.traps || []).length;
    const used = Object.values(state.paths).reduce((a, x) => a + x.length, 0);
    if (used < open) return say(`거의 다 왔어요! 아직 빈 칸이 ${open - used}개 있어요.`, 'warn');

    stopTimer();
    state.isWin = true;
    state.drawing = null;
    const { stars } = computeScore();
    const old = state.progress[p.id] || {};
    state.progress[p.id] = {
      solved: true,
      stars: Math.max(stars, old.stars || 0),
      time: Math.min(state.timer, old.time || 999999),
      mistakes: Math.min(state.mistakes, old.mistakes == null ? 999 : old.mistakes),
      hints: state.hintLevel
    };
    saveProgress();
    playWinAnimation(() => renderGame());
  }

  function playWinAnimation(done) {
    const layer = $('markLayer');
    if (!layer) return done();
    state.animating = true;
    const runners = Object.entries(state.paths).map(([color, path]) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('font-size', '.62'); t.setAttribute('text-anchor', 'middle');
      t.textContent = '🐭';
      layer.appendChild(t);
      return { t, path };
    });
    const dur = 1400, t0 = performance.now();
    let finished = false;
    const finish = () => { if (finished) return; finished = true; state.animating = false; done(); };
    setTimeout(finish, dur + 900); // 탭이 가려져 애니메이션이 멈춰도 결과 창은 뜨도록
    function frame(now) {
      if (finished) return;
      const k = Math.min(1, (now - t0) / dur);
      runners.forEach(({ t, path }) => {
        const pos = k * (path.length - 1), i = Math.floor(pos), f = pos - i;
        const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
        t.setAttribute('x', a.c + .5 + (b.c - a.c) * f);
        t.setAttribute('y', a.r + .72 + (b.r - a.r) * f);
      });
      if (k < 1) requestAnimationFrame(frame);
      else setTimeout(finish, 350);
    }
    requestAnimationFrame(frame);
  }

  function nextPuzzle() {
    const list = levelPuzzles(state.puzzle.level);
    const i = list.findIndex(x => x.id === state.puzzle.id);
    if (i < list.length - 1) return list[i + 1];
    const nl = state.puzzle.level + 1;
    if (nl <= 5 && isLevelUnlocked(nl)) return levelPuzzles(nl)[0];
    return null;
  }
  function goNext() {
    const n = nextPuzzle();
    if (n) loadPuzzle(n); else { state.puzzle = null; setView('LEVELS'); }
  }

  function winModal() {
    const { stars, lines } = computeScore();
    const n = nextPuzzle();
    return `
      <div class="overlay"><div class="modal">
        <div class="big">🧀🐭</div>
        <h2 class="display">실험 성공!</h2>
        ${state.settings.starsVisible ? `<div style="font-size:40px;margin:4px 0">${'⭐'.repeat(stars)}${'<span style="opacity:.2">⭐</span>'.repeat(3 - stars)}</div>` : ''}
        <table class="score-table">
          ${lines.map(([t, v]) => `
            <tr><td>${t}</td><td class="${v ? 'minus' : ''}">${v === null ? '' : v ? v + '⭐' : '✔'}</td></tr>`).join('')}
        </table>
        <div class="stack">
          ${n ? '<button class="btn btn-primary" id="nextBtn">다음 문제 ▶</button>' : ''}
          <button class="btn btn-ghost" id="listBtn">문제 선택으로</button>
        </div>
      </div></div>`;
  }

  /* =====================================================
     교사 모드
  ===================================================== */
  function renderTeacherAuth(app) {
    app.innerHTML = `
      <div class="page center">
        <div class="card" style="width:min(430px,100%)">
          <div class="logo"><div class="mark">🔐</div><h1 class="display" style="font-size:32px">교사 모드</h1></div>
          <div class="stack" style="margin-top:18px">
            <input class="input" id="teacherPw" type="password" placeholder="비밀번호">
            <div style="color:var(--bad);font-weight:800;text-align:center">${esc(state.teacherError)}</div>
            <div class="row">
              <button class="btn btn-ghost grow" id="teacherBack">돌아가기</button>
              <button class="btn btn-navy grow" id="teacherLogin">입장</button>
            </div>
          </div>
        </div>
      </div>`;
    $('teacherBack').onclick = () => setView('ROLE');
    $('teacherLogin').onclick = teacherLogin;
    $('teacherPw').onkeydown = e => { if (e.key === 'Enter') teacherLogin(); };
    $('teacherPw').focus();
  }

  async function teacherLogin() {
    const pw = $('teacherPw').value;
    $('teacherLogin').disabled = true;
    try {
      const d = await Api.dashboard(pw);
      state.teacherPassword = pw;
      state.teacherError = '';
      state.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
      state.teacherStudents = d.students || [];
      setView('TEACHER');
      state.dashHandle = setInterval(refreshDashboard, 10000);
    } catch (e) {
      state.teacherError = '비밀번호가 틀렸거나 서버에 연결하지 못했어요.';
      render();
    }
  }

  async function refreshDashboard() {
    if (state.view !== 'TEACHER') return;
    try {
      const d = await Api.dashboard(state.teacherPassword);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
      state.teacherStudents = d.students || [];
      renderTeacher($('app'));
    } catch (e) { console.warn(e); }
  }

  function renderTeacher(app) {
    const list = [...state.teacherStudents];
    if (state.teacherSort === 'progress') list.sort((a, b) => (b.solvedCount - a.solvedCount) || (b.totalStars - a.totalStars));
    else list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
    const now = Date.now();
    const isOn = s => now - (s.lastActive || 0) < 120000;
    const online = list.filter(isOn).length;

    const rows = list.length ? list.map(s => `
      <div class="student-row">
        <div>
          <div style="font-weight:900"><span class="${isOn(s) ? 'online' : 'away'}">●</span> ${esc(s.nickname)}</div>
          <div class="small">LEVEL ${s.currentLevel} ${s.currentPuzzle ? '(' + esc(s.currentPuzzle) + ' 푸는 중)' : ''}</div>
        </div>
        <div style="text-align:right;font-weight:900">${s.solvedCount || 0} / ${PUZZLES.length}
          <div class="small">⭐ ${s.totalStars || 0}</div></div>
      </div>`).join('') : '<div class="small" style="text-align:center;padding:18px">아직 접속한 학생이 없습니다.</div>';

    const toggle = (k, on, offTxt, onTxt) =>
      `<button class="toggle ${on ? 'on' : 'off'}" data-setting="${k}">${on ? onTxt : offTxt}</button>`;

    app.innerHTML = `
      <div class="teacher"><div class="wrap">
        <div class="topbar between">
          <div><div class="small">관리자 화면</div><div class="name">🐭 LAB MICE 교사 모드</div></div>
          <button class="btn btn-sm btn-ghost" id="teacherExit">학생 화면</button>
        </div>
        <section class="section">
          <div class="between"><h3>📊 학생 진행 현황</h3><div class="small">접속 중 ${online}명 / 등록 ${list.length}명</div></div>
          <div class="row" style="margin-bottom:10px">
            <button class="btn btn-sm btn-ghost grow" id="sortActive">최근 활동순</button>
            <button class="btn btn-sm btn-ghost grow" id="sortProgress">진행도순</button>
            <button class="btn btn-sm btn-ghost" id="refreshDash">↻</button>
          </div>
          ${rows}
        </section>
        <section class="section">
          <h3>🎚️ 난이도 (학년군)</h3>
          <div class="small" style="margin-bottom:10px">바꾸면 학생 화면의 문제 세트가 바뀌어요 (최대 30초 안에 반영). 난이도마다 기록은 따로 저장돼요.</div>
          <div class="diff-grid">
            ${Object.keys(DIFFICULTY).map(k => {
              const D = DIFFICULTY[k], set = PUZZLE_SETS[k] || [];
              const sizes = set.length ? `${set[0].rows}×${set[0].cols} → ${set[set.length - 1].rows}×${set[set.length - 1].cols}` : '';
              return `<button class="diff-btn ${state.settings.difficulty === k ? 'on' : ''}" data-diff="${k}">
                <span class="ic">${D.icon}</span><b>${D.label}</b><span class="small">${D.grade}</span><span class="small">${sizes}</span>
              </button>`;
            }).join('')}
          </div>
        </section>
        <section class="section">
          <h3>🔓 레벨 공개 설정</h3>
          <div class="small" style="margin-bottom:8px">공개해도 이전 레벨에서 ${UNLOCK_NEED}문제를 풀어야 열려요.</div>
          ${LEVELS.map(lv => `
            <div class="between" style="margin:10px 0">
              <b>${THEMES[lv].icon} LEVEL ${lv} · ${THEMES[lv].name}</b>
              ${lv <= 1 ? '<span class="toggle on">항상 공개</span>' : toggle('level' + lv + 'Open', state.settings['level' + lv + 'Open'], '🔒 잠금', '🟢 공개')}
            </div>`).join('')}
        </section>
        <section class="section">
          <h3>⚙️ 게임 설정</h3>
          ${[['hintsEnabled', '💡 힌트 사용'], ['timerVisible', '⏱ 시간 표시'], ['starsVisible', '⭐ 별점 표시']].map(([k, l]) => `
            <div class="between" style="margin:10px 0"><b>${l}</b>${toggle(k, state.settings[k], 'OFF', 'ON')}</div>`).join('')}
        </section>
        <section class="section" style="border-color:#fecaca">
          <h3 style="color:var(--bad)">🗑️ 데이터 관리</h3>
          <button class="btn btn-red" style="width:100%" id="clearStudents">전체 학생 현황 초기화</button>
        </section>
      </div></div>`;

    $('teacherExit').onclick = () => setView('ROLE');
    $('sortActive').onclick = () => { state.teacherSort = 'active'; renderTeacher(app); };
    $('sortProgress').onclick = () => { state.teacherSort = 'progress'; renderTeacher(app); };
    $('refreshDash').onclick = refreshDashboard;
    app.querySelectorAll('[data-setting]').forEach(b => { b.onclick = () => toggleSetting(b.dataset.setting); });
    app.querySelectorAll('[data-diff]').forEach(b => {
      b.onclick = () => { if (b.dataset.diff !== state.settings.difficulty) toggleSetting('difficulty', b.dataset.diff); };
    });
    $('clearStudents').onclick = clearStudents;
  }

  async function toggleSetting(key, value) {
    const next = Object.assign({}, state.settings, { [key]: value !== undefined ? value : !state.settings[key] });
    try {
      const d = await Api.saveSettings(state.teacherPassword, next);
      state.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
      renderTeacher($('app'));
    } catch (e) { toast('설정 저장 실패'); }
  }

  async function clearStudents() {
    if (!confirm('시트의 전체 학생 현황을 지울까요? (학생 기기의 기록은 남아 있어요)')) return;
    try {
      await Api.clearStudents(state.teacherPassword);
      state.teacherStudents = [];
      renderTeacher($('app'));
    } catch (e) { toast('초기화 실패'); }
  }

  /* =====================================================
     시작
  ===================================================== */
  async function init() {
    render();
    await refreshSettings();
    // 레벨 화면에 있을 때만 30초마다 설정 확인 (서버 호출 줄이기)
    setInterval(() => { if (state.view === 'LEVELS') refreshSettings(); }, 30000);
    // 접속 표시용: 1분마다 기록 전송
    setInterval(() => { if (state.nickname && (state.view === 'LEVELS' || state.view === 'GAME')) syncStudent(); }, 60000);
  }

  useDifficulty(state.settings.difficulty);
  if (!PUZZLES.length) {
    document.getElementById('app').innerHTML = '<div class="page center"><div class="card">js/puzzles.js를 불러오지 못했어요.</div></div>';
  } else {
    init();
  }
})();
