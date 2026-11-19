/* =====================================================
   LAB MICE 규칙 + 자동 풀이기 (게임 화면과 퍼즐 생성기가 함께 사용)

   퍼즐 데이터 형식
   {
     id, level, rows, cols,
     pairs:[{id:'red', mouse:[r,c], cheese:[r,c]}],
     traps:[[r,c]],                 // 🪤 덫: 아무도 못 지나가는 칸 (채우지 않아도 됨)
     walls:[[r,c,'R'|'D']],         // 🧱 벽: (r,c)의 오른쪽(R) / 아래쪽(D) 경계
     arrows:[[r,c,'U'|'D'|'L'|'R']],// ➜ 일방통행: 이 칸에서는 화살표 방향으로만 나감
     checkpoints:[[r,c,'red']],     // 🧪 시약: 그 색 쥐만, 반드시 지나가야 함
     solution:{red:[[r,c],...]}
   }
===================================================== */
(function (root) {
  'use strict';

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // U D L R
  const DIR_NAMES = ['U', 'D', 'L', 'R'];
  const OPP = [1, 0, 3, 2];

  function compile(p) {
    const R = p.rows, C = p.cols, N = R * C;
    const colorIds = p.pairs.map(x => x.id);
    const trap = new Uint8Array(N);
    (p.traps || []).forEach(([r, c]) => { trap[r * C + c] = 1; });

    const wall = new Uint8Array(N); // 막힌 방향 비트 (1<<d)
    (p.walls || []).forEach(([r, c, s]) => {
      const i = r * C + c;
      if (s === 'R') { wall[i] |= 8; wall[i + 1] |= 4; }
      else { wall[i] |= 2; wall[i + C] |= 1; }
    });

    const arrow = new Int8Array(N).fill(-1);
    (p.arrows || []).forEach(([r, c, d]) => { arrow[r * C + c] = DIR_NAMES.indexOf(d); });

    const cp = new Int8Array(N).fill(-1);
    (p.checkpoints || []).forEach(([r, c, id]) => { cp[r * C + c] = colorIds.indexOf(id); });

    const mouse = p.pairs.map(x => x.mouse[0] * C + x.mouse[1]);
    const cheese = p.pairs.map(x => x.cheese[0] * C + x.cheese[1]);

    // 벽·덫을 반영한 이웃 표
    const nbr = new Int16Array(N * 4).fill(-1);
    for (let i = 0; i < N; i++) {
      if (trap[i]) continue;
      const r = (i / C) | 0, c = i % C;
      for (let d = 0; d < 4; d++) {
        const rr = r + DIRS[d][0], cc = c + DIRS[d][1];
        if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
        if (wall[i] & (1 << d)) continue;
        const j = rr * C + cc;
        if (trap[j]) continue;
        nbr[i * 4 + d] = j;
      }
    }

    return { R, C, N, K: colorIds.length, colorIds, trap, wall, arrow, cp, mouse, cheese, nbr };
  }

  /** from 칸에서 d 방향으로 한 칸 이동할 수 있으면 도착 칸 번호, 아니면 -1 */
  function stepOk(g, from, d) {
    const j = g.nbr[from * 4 + d];
    if (j < 0) return -1;
    if (g.arrow[from] >= 0 && g.arrow[from] !== d) return -1;        // 화살표 칸에서는 화살표 방향으로만
    const a = g.arrow[j];
    if (a >= 0) {
      if (a === OPP[d]) return -1;                                   // 화살표 정면에서 거꾸로 들어갈 수 없음
      if (g.nbr[j * 4 + a] < 0) return -1;                           // 나갈 곳이 막힌 화살표
    }
    return j;
  }

  function dirBetween(g, a, b) {
    for (let d = 0; d < 4; d++) if (g.nbr[a * 4 + d] === b) return d;
    return -1;
  }

  /**
   * 해답 개수 세기 (limit개 찾으면 멈춤)
   * 반환: {count, nodes, aborted, solutions:[[[r,c]...] per color]}
   */
  function solve(p, opts) {
    opts = opts || {};
    const limit = opts.limit || 2;
    const nodeLimit = opts.nodeLimit || 400000;
    const g = compile(p);
    const { N, K, nbr, cp, mouse, cheese, trap, C } = g;

    const owner = new Int8Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (trap[i]) owner[i] = -2;
    const head = mouse.slice();
    const done = new Uint8Array(K);
    const cpNeed = new Int16Array(K);
    for (let i = 0; i < N; i++) if (cp[i] >= 0) cpNeed[cp[i]]++;
    const headOf = new Int8Array(N).fill(-1);
    const cheeseOf = new Int8Array(N).fill(-1);
    const paths = [];
    for (let k = 0; k < K; k++) {
      owner[mouse[k]] = k; owner[cheese[k]] = k;
      headOf[mouse[k]] = k; cheeseOf[cheese[k]] = k;
      paths.push([mouse[k]]);
    }
    let empty = 0;
    for (let i = 0; i < N; i++) if (owner[i] === -1) empty++;

    let nodes = 0, count = 0, aborted = false;
    const solutions = [];
    const comp = new Int16Array(N);
    const queue = new Int16Array(N);
    const headMask = new Int32Array(N);
    const cheeseMask = new Int32Array(N);

    function freeFor(j) {
      return owner[j] === -1 || headOf[j] >= 0 || (cheeseOf[j] >= 0 && !done[cheeseOf[j]]);
    }

    function prune() {
      // 1) 빈 칸은 길의 중간이므로 쓸 수 있는 이웃이 2개 이상 필요
      for (let i = 0; i < N; i++) {
        if (owner[i] !== -1) continue;
        let c = 0;
        for (let d = 0; d < 4; d++) {
          const j = nbr[i * 4 + d];
          if (j >= 0 && freeFor(j)) c++;
        }
        if (c < 2) return false;
      }
      // 2) 빈 칸 덩어리 나누기
      comp.fill(-1);
      let nc = 0;
      for (let s = 0; s < N; s++) {
        if (owner[s] !== -1 || comp[s] >= 0) continue;
        let qh = 0, qt = 0;
        queue[qt++] = s; comp[s] = nc;
        while (qh < qt) {
          const i = queue[qh++];
          for (let d = 0; d < 4; d++) {
            const j = nbr[i * 4 + d];
            if (j >= 0 && owner[j] === -1 && comp[j] < 0) { comp[j] = nc; queue[qt++] = j; }
          }
        }
        headMask[nc] = 0; cheeseMask[nc] = 0;
        nc++;
      }
      // 3) 각 색의 머리/치즈가 닿는 덩어리 표시
      for (let k = 0; k < K; k++) {
        if (done[k]) continue;
        const bit = 1 << k;
        const h = head[k], z = cheese[k];
        let direct = false;
        for (let d = 0; d < 4; d++) {
          const j = nbr[h * 4 + d];
          if (j < 0) continue;
          if (j === z) direct = true;
          else if (owner[j] === -1) headMask[comp[j]] |= bit;
        }
        for (let d = 0; d < 4; d++) {
          const j = nbr[z * 4 + d];
          if (j >= 0 && owner[j] === -1) cheeseMask[comp[j]] |= bit;
        }
        if (!direct) {
          let ok = false;
          for (let c = 0; c < nc; c++) if (headMask[c] & cheeseMask[c] & bit) { ok = true; break; }
          if (!ok) return false;
        }
      }
      // 4) 모든 덩어리는 어떤 색이 들어갔다 나올 수 있어야 함
      for (let c = 0; c < nc; c++) if ((headMask[c] & cheeseMask[c]) === 0) return false;
      // 5) 남은 시약 칸은 그 색이 닿을 수 있어야 함
      for (let i = 0; i < N; i++) {
        const k = cp[i];
        if (k < 0 || owner[i] !== -1) continue;
        if (done[k]) return false;
        const bit = 1 << k;
        if (!(headMask[comp[i]] & cheeseMask[comp[i]] & bit)) return false;
      }
      return true;
    }

    function movesOf(k, out) {
      const h = head[k];
      let n = 0;
      for (let d = 0; d < 4; d++) {
        const j = stepOk(g, h, d);
        if (j < 0) continue;
        if (j === cheese[k]) { if (cpNeed[k] === 0) out[n++] = j; continue; }
        if (owner[j] !== -1) continue;
        if (cp[j] >= 0 && cp[j] !== k) continue;
        out[n++] = j;
      }
      return n;
    }

    function search() {
      if (aborted || count >= limit) return;
      if (++nodes > nodeLimit) { aborted = true; return; }
      let allDone = true;
      for (let k = 0; k < K; k++) if (!done[k]) { allDone = false; break; }
      if (allDone) {
        if (empty === 0) {
          count++;
          solutions.push(paths.map(pa => pa.map(i => [(i / C) | 0, i % C])));
        }
        return;
      }
      if (!prune()) return;

      let best = -1, bestN = 5, bestMoves = null;
      for (let k = 0; k < K; k++) {
        if (done[k]) continue;
        const m = [0, 0, 0, 0];
        const n = movesOf(k, m);
        if (n === 0) return;
        if (n < bestN) { best = k; bestN = n; bestMoves = m; if (n === 1) break; }
      }
      const k = best, h = head[k];
      for (let t = 0; t < bestN; t++) {
        const j = bestMoves[t];
        headOf[h] = -1;
        paths[k].push(j);
        if (j === cheese[k]) {
          done[k] = 1; head[k] = j;
          search();
          done[k] = 0;
        } else {
          owner[j] = k; empty--; head[k] = j; headOf[j] = k;
          const own = cp[j] === k;
          if (own) cpNeed[k]--;
          search();
          if (own) cpNeed[k]++;
          headOf[j] = -1; owner[j] = -1; empty++;
        }
        head[k] = h; headOf[h] = k;
        paths[k].pop();
        if (aborted || count >= limit) return;
      }
    }

    search();
    return {
      count, nodes, aborted,
      solutions: solutions.map(sol => {
        const o = {};
        sol.forEach((pa, k) => { o[g.colorIds[k]] = pa; });
        return o;
      })
    };
  }

  const api = { DIRS, DIR_NAMES, OPP, compile, stepOk, dirBetween, solve };
  root.LabMiceCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
