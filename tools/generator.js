/* =====================================================
   LAB MICE 퍼즐 생성기
   1) 판 전체를 덮는 여러 갈래의 길을 무작위로 만들고 (백바이트 섞기)
   2) 자동 풀이기로 해답 개수를 셈
   3) 해답이 2개 이상이면, 다른 해답을 막는 벽/화살표/시약을 하나씩 추가
   4) 해답이 정확히 1개인 문제만 채택하고, 풀이기 탐색량(난이도)으로 고름
===================================================== */
(function (root) {
  'use strict';
  const Core = root.LabMiceCore;
  const COLOR_IDS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];

  /* 난이도(학년군)별 레벨 설계 — 쥐는 어느 난이도든 최대 5마리
     pick: 후보 중 어떤 문제를 고를지 (low=쉬운 쪽, mid=중간, high=어려운 쪽) */
  const DIFFICULTIES = {
    easy: {
      label: '입문 (3~4학년)', prefix: 'E', pick: 'low',
      specs: [
        { level: 0, rows: 4, cols: 4, pairs: [2, 2], traps: [0, 0], minLen: 3, budget: {}, pool: 10 },
        { level: 1, rows: 5, cols: 5, pairs: [3, 3], traps: [0, 0], minLen: 3, budget: {}, pool: 12 },
        { level: 2, rows: 5, cols: 5, pairs: [3, 3], traps: [0, 0], minLen: 3, budget: { walls: 5 }, must: { walls: 1 }, pool: 16 },
        { level: 3, rows: 6, cols: 6, pairs: [3, 4], traps: [1, 2], minLen: 4, budget: { walls: 4 }, must: { traps: 1 }, pool: 16 },
        { level: 4, rows: 6, cols: 6, pairs: [4, 4], traps: [0, 1], minLen: 4, budget: { walls: 3, arrows: 4 }, must: { arrows: 1 }, pool: 16 },
        { level: 5, rows: 6, cols: 6, pairs: [4, 4], traps: [0, 1], minLen: 4, budget: { walls: 3, arrows: 2, checkpoints: 3 }, must: { checkpoints: 1 }, pool: 16 }
      ]
    },
    normal: {
      label: '기본 (5~6학년)', prefix: 'N', pick: 'mid',
      specs: [
        { level: 0, rows: 5, cols: 5, pairs: [3, 3], traps: [0, 0], minLen: 3, budget: {}, pool: 14 },
        { level: 1, rows: 5, cols: 5, pairs: [3, 4], traps: [0, 0], minLen: 3, budget: {}, pool: 14, noAdjacent: true },
        { level: 2, rows: 6, cols: 6, pairs: [4, 4], traps: [0, 0], minLen: 4, budget: { walls: 6 }, must: { walls: 1 }, pool: 20, noAdjacent: true },
        { level: 3, rows: 6, cols: 6, pairs: [4, 4], traps: [2, 2], minLen: 4, budget: { walls: 5 }, must: { traps: 2 }, pool: 20, noAdjacent: true },
        { level: 4, rows: 7, cols: 7, pairs: [4, 5], traps: [0, 1], minLen: 4, budget: { walls: 4, arrows: 4 }, must: { arrows: 2 }, pool: 20, noAdjacent: true },
        { level: 5, rows: 7, cols: 7, pairs: [5, 5], traps: [0, 2], minLen: 4, budget: { walls: 4, arrows: 2, checkpoints: 3 }, must: { checkpoints: 2 }, pool: 20, noAdjacent: true }
      ]
    },
    hard: {
      label: '도전 (영재·심화)', prefix: 'H', pick: 'high',
      specs: [
        { level: 0, rows: 5, cols: 5, pairs: [3, 3], traps: [0, 0], minLen: 3, budget: {}, pool: 14 },
        { level: 1, rows: 6, cols: 6, pairs: [4, 4], traps: [0, 0], minLen: 4, budget: {}, pool: 14, noAdjacent: true },
        { level: 2, rows: 7, cols: 7, pairs: [4, 5], traps: [0, 0], minLen: 4, budget: { walls: 8 }, must: { walls: 1 }, pool: 40, noAdjacent: true },
        { level: 3, rows: 7, cols: 7, pairs: [4, 4], traps: [2, 3], minLen: 4, budget: { walls: 6 }, must: { traps: 2 }, pool: 50, noAdjacent: true },
        { level: 4, rows: 8, cols: 8, pairs: [5, 5], traps: [0, 2], minLen: 4, budget: { walls: 6, arrows: 5 }, must: { arrows: 2 }, pool: 30, noAdjacent: true },
        { level: 5, rows: 9, cols: 9, pairs: [5, 5], traps: [0, 3], minLen: 5, budget: { walls: 6, arrows: 3, checkpoints: 4 }, must: { checkpoints: 2 }, pool: 20, noAdjacent: true }
      ]
    }
  };
  const LEVEL_SPECS = DIFFICULTIES.hard.specs;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));
  function shuffle(rand, arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  /* ---------- 1) 판을 덮는 길 만들기 ---------- */
  function genCover(R, C, k, t, minLen, rand) {
    const N = R * C;
    // ㄹ자 시작 경로
    let snake = [];
    for (let r = 0; r < R; r++) for (let c0 = 0; c0 < C; c0++) {
      const c = r % 2 === 0 ? c0 : C - 1 - c0;
      snake.push(r * C + c);
    }
    // 덫 + 자르기 위치 고르기
    let paths = null, trapSet = null;
    for (let attempt = 0; attempt < 300 && !paths; attempt++) {
      const cuts = k - 1 - t;
      if (cuts < 0) return null;
      const events = new Map();
      let guard = 0;
      while (events.size < t + cuts && guard++ < 500) {
        const pos = randInt(rand, 1, N - 2);
        if (events.has(pos) || events.has(pos - 1) || events.has(pos + 1)) continue;
        events.set(pos, events.size < t ? 'trap' : 'cut');
      }
      if (events.size < t + cuts) continue;
      const segs = []; let cur = []; const traps = new Set();
      for (let i = 0; i < N; i++) {
        const ev = events.get(i);
        if (ev === 'trap') { traps.add(snake[i]); if (cur.length) segs.push(cur); cur = []; continue; }
        if (ev === 'cut') { if (cur.length) segs.push(cur); cur = []; }
        cur.push(snake[i]);
      }
      if (cur.length) segs.push(cur);
      if (segs.length !== k || segs.some(s => s.length < minLen)) continue;
      paths = segs; trapSet = traps;
    }
    if (!paths) return null;

    // 백바이트 섞기
    const pathOf = new Int16Array(N).fill(-1), posOf = new Int16Array(N);
    const reindex = a => paths[a].forEach((v, i) => { pathOf[v] = a; posOf[v] = i; });
    paths.forEach((_, a) => reindex(a));
    const open = N - trapSet.size;
    const maxLen = Math.ceil(open / k * 2.2);
    const nb = i => {
      const r = (i / C) | 0, c = i % C, out = [];
      if (r > 0) out.push(i - C); if (r < R - 1) out.push(i + C);
      if (c > 0) out.push(i - 1); if (c < C - 1) out.push(i + 1);
      return out.filter(j => !trapSet.has(j));
    };
    const iters = 60 * N * k;
    for (let it = 0; it < iters; it++) {
      const a = Math.floor(rand() * k);
      if (rand() < 0.5) { paths[a].reverse(); reindex(a); }
      const A = paths[a];
      const e = A[A.length - 1];
      const ns = nb(e);
      const x = ns[Math.floor(rand() * ns.length)];
      const b = pathOf[x], i = posOf[x];
      if (b === a) {
        if (i === A.length - 2) continue;
        paths[a] = A.slice(0, i + 1).concat(A.slice(i + 1).reverse());
        reindex(a);
      } else {
        const B = paths[b];
        const opts = shuffle(rand, [1, 2]);
        let applied = false;
        for (const o of opts) {
          let nA, rem;
          if (o === 1) { nA = A.concat(B.slice(0, i + 1).reverse()); rem = B.slice(i + 1); }
          else { nA = A.concat(B.slice(i)); rem = B.slice(0, i); }
          if (rem.length < minLen || nA.length > maxLen) continue;
          paths[a] = nA; paths[b] = rem; reindex(a); reindex(b); applied = true; break;
        }
        if (!applied) continue;
      }
    }
    paths.forEach(p => { if (rand() < 0.5) p.reverse(); });
    return { paths, traps: [...trapSet] };
  }

  /* ---------- 2) 퍼즐 객체 만들기 ---------- */
  function toPuzzle(R, C, cover) {
    const rc = i => [(i / C) | 0, i % C];
    const pairs = [], solution = {};
    cover.paths.forEach((p, k) => {
      const id = COLOR_IDS[k];
      pairs.push({ id, mouse: rc(p[0]), cheese: rc(p[p.length - 1]) });
      solution[id] = p.map(rc);
    });
    return { rows: R, cols: C, pairs, traps: cover.traps.map(rc), walls: [], arrows: [], checkpoints: [], solution };
  }

  function solutionMaps(p, sol) {
    const N = p.rows * p.cols, C = p.cols;
    const next = new Int16Array(N).fill(-1), color = new Int8Array(N).fill(-1), end = new Uint8Array(N);
    p.pairs.forEach((pair, k) => {
      const path = sol[pair.id];
      path.forEach(([r, c], i) => {
        const v = r * C + c;
        color[v] = k;
        if (i < path.length - 1) next[v] = path[i + 1][0] * C + path[i + 1][1];
        if (i === 0 || i === path.length - 1) end[v] = 1;
      });
    });
    return { next, color, end };
  }

  function sameSolution(a, b) {
    return Object.keys(a).every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }

  function wallSpec(C, i, j) {
    const a = Math.min(i, j), b = Math.max(i, j);
    return [(a / C) | 0, a % C, b - a === 1 ? 'R' : 'D'];
  }
  function dirName(C, i, j) {
    if (j === i - C) return 'U'; if (j === i + C) return 'D'; if (j === i - 1) return 'L'; return 'R';
  }
  function marked(p, i) {
    const C = p.cols, r = (i / C) | 0, c = i % C;
    return p.arrows.some(a => a[0] === r && a[1] === c) || p.checkpoints.some(a => a[0] === r && a[1] === c);
  }

  /* 다른 해답(T)을 막는 제약 후보 */
  function constraintCandidates(p, S, T, kinds) {
    const C = p.cols, N = p.rows * C;
    const s = solutionMaps(p, S), t = T ? solutionMaps(p, T) : null;
    const out = [];
    const hasWall = (i, j) => { const w = wallSpec(C, i, j); return p.walls.some(x => x[0] === w[0] && x[1] === w[1] && x[2] === w[2]); };
    for (let i = 0; i < N; i++) {
      if (s.color[i] < 0) continue;
      if (kinds.walls) {
        // T에서 쓰는(또는 아무 데서도 안 쓰는) 이웃 경계 중 S가 안 쓰는 곳
        const cand = t ? (t.next[i] >= 0 ? [t.next[i]] : []) : [i + 1, i + C].filter(j => j < N && (j !== i + 1 || i % C !== C - 1) && s.color[j] >= 0);
        cand.forEach(j => {
          if (s.next[i] === j || s.next[j] === i || hasWall(i, j)) return;
          out.push({ kind: 'walls', v: wallSpec(C, i, j) });
        });
      }
      if (s.end[i] || marked(p, i)) continue;
      if (kinds.arrows && (!t || t.next[i] !== s.next[i])) {
        out.push({ kind: 'arrows', v: [(i / C) | 0, i % C, dirName(C, i, s.next[i])] });
      }
      if (kinds.checkpoints && (!t || t.color[i] !== s.color[i])) {
        out.push({ kind: 'checkpoints', v: [(i / C) | 0, i % C, p.pairs[s.color[i]].id] });
      }
    }
    return out;
  }

  function adjacentPair(p) {
    return p.pairs.some(x => Math.abs(x.mouse[0] - x.cheese[0]) + Math.abs(x.mouse[1] - x.cheese[1]) === 1);
  }

  /* ---------- 3) 해답이 하나가 될 때까지 다듬기 ---------- */
  function tryMake(spec, rand) {
    const k = randInt(rand, spec.pairs[0], spec.pairs[1]);
    const t = randInt(rand, spec.traps[0], spec.traps[1]);
    const cover = genCover(spec.rows, spec.cols, k, t, spec.minLen, rand);
    if (!cover) return null;
    const p = toPuzzle(spec.rows, spec.cols, cover);
    if (spec.noAdjacent && adjacentPair(p)) return null;
    if (spec.must && spec.must.traps && p.traps.length < spec.must.traps) return null;
    const S = p.solution;
    const used = { walls: 0, arrows: 0, checkpoints: 0 };
    for (let round = 0; round < 20; round++) {
      const res = Core.solve(p, { limit: 2, nodeLimit: 200000 });
      if (res.aborted) return null;
      if (res.count === 1) break;
      const T = res.solutions.find(x => !sameSolution(x, S));
      if (!T) return null;
      const kinds = {};
      Object.keys(spec.budget).forEach(kd => { if (used[kd] < spec.budget[kd]) kinds[kd] = true; });
      if (!Object.keys(kinds).length) return null;
      const cands = constraintCandidates(p, S, T, kinds);
      if (!cands.length) return null;
      const pick = cands[Math.floor(rand() * cands.length)];
      p[pick.kind].push(pick.v); used[pick.kind]++;
      if (round === 19) return null;
    }
    // 새 장치가 최소 개수만큼 나오도록 (정답과 맞는 장치라 해답은 계속 하나)
    if (spec.must) {
      for (const kd of ['walls', 'arrows', 'checkpoints']) {
        const need = (spec.must[kd] || 0) - p[kd].length;
        for (let n = 0; n < need; n++) {
          const cands = constraintCandidates(p, S, null, { [kd]: true });
          if (!cands.length) return null;
          p[kd].push(cands[Math.floor(rand() * cands.length)].v);
        }
      }
    }
    const final = Core.solve(p, { limit: 2, nodeLimit: 2000000 });
    if (final.aborted || final.count !== 1 || !sameSolution(final.solutions[0], S)) return null;
    p.rating = final.nodes;
    return p;
  }

  function generateLevel(spec, count, seed, onProgress, pick, prefix) {
    const rand = mulberry32(seed);
    const pool = [], seen = new Set();
    let attempts = 0;
    while (pool.length < Math.max(spec.pool, count) && attempts < 6000) {
      attempts++;
      const p = tryMake(spec, rand);
      if (!p) continue;
      const key = JSON.stringify(p.pairs);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(p);
      if (onProgress) onProgress(spec.level, pool.length, spec.pool, attempts);
    }
    if (pool.length < count) throw new Error('LEVEL ' + spec.level + ' 문제를 ' + count + '개 만들지 못했어요 (' + pool.length + '개).');
    pool.sort((a, b) => a.rating - b.rating);
    let start = 0;
    if (pick === 'high') start = pool.length - count;
    else if (pick === 'mid') start = Math.floor((pool.length - count) / 2);
    const chosen = pool.slice(start, start + count);
    return chosen.map((p, i) => Object.assign({ id: (prefix ? prefix + '-' : '') + 'L' + spec.level + '-0' + (i + 1), level: spec.level }, p));
  }

  function generateDifficulty(key, seed, onProgress) {
    const d = DIFFICULTIES[key];
    const base = { easy: 1000, normal: 2000, hard: 3000 }[key];
    const out = [];
    d.specs.forEach((spec, i) => { out.push(...generateLevel(spec, 5, seed * 31 + base + i, onProgress, d.pick, d.prefix)); });
    return out;
  }

  function generateAll(seed, onProgress) {
    const sets = {};
    Object.keys(DIFFICULTIES).forEach(k => { sets[k] = generateDifficulty(k, seed, onProgress); });
    return sets;
  }

  function toFileText(sets, seed) {
    let text = '/* 자동 생성 파일: tools/generator.html 로 다시 만들 수 있어요. seed=' + seed +
      '\n   모든 문제는 해답이 정확히 1개임을 풀이기로 확인했습니다.\n   easy=입문(3~4학년) / normal=기본(5~6학년) / hard=도전 */\n' +
      'window.LAB_PUZZLE_SETS = {\n';
    text += Object.keys(sets).map(k =>
      '  ' + k + ': [\n' + sets[k].map(p => '    ' + JSON.stringify(p)).join(',\n') + '\n  ]').join(',\n');
    return text + '\n};\n';
  }

  root.LabMiceGenerator = { DIFFICULTIES, LEVEL_SPECS, generateLevel, generateDifficulty, generateAll, toFileText, tryMake, mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
