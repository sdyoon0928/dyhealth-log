/* ============================================================
   DY 헬스 로그 — 화면 동작 스크립트

   구성
     1) 설정 · 유틸        2) 토큰 보관
     3) API 호출           4) 로그인 · 회원가입
     5) 구간 정의 · 게이지  6) 추세 차트 (SVG 직접 그리기)
     7) 화면 분기          8) 전체 탭 (월 → 일 → 상세)
     9) 기간 탭 (대시보드) 10) 기록 저장 · 삭제
    11) 바텀시트 · 토스트  12) 입력 제한   13) 시작

   화면 구조
     전체 기록 → 월 단위로 묶고, 월을 열면 날짜 목록,
                 날짜를 열면 상세(게이지·경고·메모)가 나온다.
     최근 7/30일 → 대시보드. 기간 요약 + 추세 차트.

   차트 설계
     게이지에 쓰는 구간 색을 차트 배경 띠로 그대로 쓴다.
     선이 노란 띠에 들어가면 '주의 구간에 진입했다'가 바로 보인다.
   ============================================================ */

/* ── 1) 설정 · 유틸 ─────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const API = "";                       // 같은 서버에서 서빙하므로 경로만 사용

const state = {
  me: null,             // 로그인한 사용자
  days: 0,              // 0 = 전체, 7 / 30 = 최근 N일
  mode: "login",        // 인증 화면 모드
  openMonths: new Set(),// 펼쳐진 월 키 ('2026-07')
  openDays: new Set(),  // 펼쳐진 기록 id
};

/** YYYY-MM-DD 문자열로 변환 (시간대 밀림 없이) */
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** '2026-07-25' → '금' */
function weekday(dateStr) {
  return WEEK[new Date(dateStr + "T00:00:00").getDay()];
}

/** '2026-07-25' → '07.25' */
function shortDate(dateStr) {
  return dateStr.slice(5).replace("-", ".");
}

/** '2026-07' → '2026년 7월' */
function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${y}년 ${Number(m)}월`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function numOrNull(id) {
  const v = $(id).value.trim();
  return v === "" ? null : Number(v);
}

/** 평균 (빈 배열이면 null) */
function avg(values, digits = 1) {
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(digits));
}


/* ── 2) 토큰 보관 ───────────────────────────────────── */

const TOKEN_KEY = "dyhealth_token";
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);


/* ── 3) API 호출 ────────────────────────────────────── */

/**
 * fetch를 감싸서 토큰 헤더를 자동으로 붙이고,
 * 실패 시 {status, detail} 형태로 던진다. 401이면 자동 로그아웃.
 */
async function callApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(API + path, { ...options, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.status === 401) {
    logout("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    throw { status: 401, detail: "로그인이 필요합니다" };
  }
  if (!res.ok) throw { status: res.status, detail: readDetail(body) };

  return body;
}

/** 서버 오류를 읽을 수 있는 문장으로 (422는 detail이 배열) */
function readDetail(body) {
  if (!body || !body.detail) return "요청을 처리하지 못했습니다";
  if (typeof body.detail === "string") return body.detail;

  return body.detail
    .map((e) => {
      const field = (e.loc || []).slice(-1)[0];
      return `${field}: ${e.msg.replace("Value error, ", "")}`;
    })
    .join(" / ");
}


/* ── 4) 로그인 · 회원가입 ───────────────────────────── */

function showAuth() {
  $("authView").hidden = false;
  $("appView").hidden = true;
}

function showApp() {
  $("authView").hidden = true;
  $("appView").hidden = false;
  $("meName").textContent = state.me ? state.me.nickname : "";
}

function authError(message, code) {
  const el = $("authErr");
  el.innerHTML = (code ? `<code>${code}</code>` : "") + escapeHtml(message);
  el.hidden = false;
}
const clearAuthError = () => ($("authErr").hidden = true);

$("seg").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;

  state.mode = btn.dataset.mode;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.remove("is-on"));
  btn.classList.add("is-on");

  const isRegister = state.mode === "register";
  $("fieldNick").hidden = !isRegister;      // 이름은 회원가입에만
  $("pwHint").hidden = !isRegister;
  $("aPw").autocomplete = isRegister ? "new-password" : "current-password";
  $("btnAuth").textContent = isRegister ? "가입하고 시작하기" : "로그인";

  clearAuthError();
});

/**
 * 로그인 요청.
 * 주의: /auth/login은 JSON이 아니라 '폼' 형식이며,
 *       이메일을 username이라는 이름으로 보낸다(OAuth2 표준).
 */
async function requestLogin(email, password) {
  const res = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, detail: readDetail(body) };

  setToken(body.access_token);
}

$("btnAuth").addEventListener("click", async () => {
  const email = $("aEmail").value.trim();
  const password = $("aPw").value;
  const nickname = $("aNick").value.trim();
  const isRegister = state.mode === "register";

  clearAuthError();

  if (!email || !password || (isRegister && !nickname)) {
    authError("빈칸을 모두 채워주세요.");
    return;
  }

  const btn = $("btnAuth");
  btn.disabled = true;

  try {
    // 회원가입이면 계정을 만든 뒤 곧바로 로그인까지 진행
    if (isRegister) {
      await callApi("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, nickname, password }),
      });
    }

    await requestLogin(email, password);

    state.me = await callApi("/auth/me");
    $("aPw").value = "";
    showApp();
    refresh();
    toast(`${state.me.nickname} 님, 반갑습니다`, false);
  } catch (e) {
    authError(e.detail, e.status);
  } finally {
    btn.disabled = false;
  }
});

/** 로그아웃 = 보관 중인 토큰을 지우는 것 (서버에 알릴 필요 없음) */
function logout(message) {
  clearToken();
  state.me = null;
  state.openMonths.clear();
  state.openDays.clear();
  showAuth();
  if (message) authError(message);
}

$("btnLogout").addEventListener("click", () => {
  if (confirm("로그아웃할까요?")) logout();
});

["aEmail", "aPw", "aNick"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnAuth").click();
  });
});


/* ── 5) 구간 정의 · 게이지 ──────────────────────────── */

/* 표시 범위와 구간 색. 서버 health_rules.py와 같은 경계값을 쓴다. */
const SCALES = {
  bmi: {
    min: 15, max: 35,
    zones: [
      { to: 18.5, color: "var(--t-low)" },
      { to: 23,   color: "var(--t-ok)" },
      { to: 25,   color: "var(--t-warn)" },
      { to: 35,   color: "var(--t-risk)" },
    ],
  },
  sys: {
    min: 90, max: 170,
    zones: [
      { to: 120, color: "var(--t-ok)" },
      { to: 140, color: "var(--t-warn)" },
      { to: 170, color: "var(--t-risk)" },
    ],
  },
  dia: {
    min: 50, max: 110,
    zones: [
      { to: 80,  color: "var(--t-ok)" },
      { to: 90,  color: "var(--t-warn)" },
      { to: 110, color: "var(--t-risk)" },
    ],
  },
  sugar: {
    min: 70, max: 160,
    zones: [
      { to: 100, color: "var(--t-ok)" },
      { to: 126, color: "var(--t-warn)" },
      { to: 160, color: "var(--t-risk)" },
    ],
  },
};

const TAG_CLASS = {
  "정상": "tag--ok",
  "저체중": "tag--low",
  "과체중": "tag--warn",
  "비만": "tag--risk",
  "주의": "tag--warn",
  "고혈압": "tag--risk",
  "공복혈당장애": "tag--warn",
  "당뇨 의심": "tag--risk",
};

/** 그날 가장 나쁜 분류의 색 (왼쪽 띠) */
function stripeColor(categories) {
  if (categories.some((c) => TAG_CLASS[c] === "tag--risk")) return "var(--risk)";
  if (categories.some((c) => TAG_CLASS[c] === "tag--warn")) return "var(--warn)";
  if (categories.some((c) => TAG_CLASS[c] === "tag--low"))  return "var(--t-low)";
  return "var(--ok)";
}

/** 등급을 숫자로 (분포 집계·비교용) */
function grade(category) {
  const cls = TAG_CLASS[category];
  if (cls === "tag--risk") return 2;
  if (cls === "tag--warn") return 1;
  return 0;
}

function gauge(key, value) {
  const s = SCALES[key];
  const span = s.max - s.min;

  let prev = s.min, bars = "", ticks = "";
  s.zones.forEach((z, i) => {
    const w = (z.to - prev) / span;
    bars += `<span style="flex:${w};background:${z.color}"></span>`;
    ticks += `<span style="flex:${w}">${i < s.zones.length - 1 ? z.to : ""}</span>`;
    prev = z.to;
  });

  const pct = Math.min(1, Math.max(0, (value - s.min) / span)) * 100;

  return `
    <div class="gauge">
      <div class="gauge__track">${bars}</div>
      <i class="gauge__mark" style="left:${pct}%"></i>
    </div>
    <div class="ticks">${ticks}</div>`;
}

function tag(text) {
  return `<span class="tag ${TAG_CLASS[text] || "tag--ok"}">${text}</span>`;
}


/* ── 6) 추세 차트 ───────────────────────────────────── */

/**
 * SVG 꺾은선 차트를 직접 그린다. (외부 라이브러리 없음)
 *
 * @param points   [{date, value, value2?}] — 날짜 오름차순
 * @param scaleKey SCALES의 키. 있으면 구간 띠를 배경에 깐다.
 *                 null이면 데이터에 맞춰 자동 범위 (체중처럼 기준이 없는 값)
 * @param title    차트 제목
 * @param unit     단위 표시
 * @param sub      보조선 설명 (혈압의 이완기 등)
 */
function trendChart(points, scaleKey, title, unit, sub) {
  if (!points.length) {
    return `<div class="chart">
              <div class="chart__head"><span class="chart__title">${title}</span></div>
              <div class="chart__empty">표시할 데이터가 없습니다</div>
            </div>`;
  }

  const W = 320, H = 128;
  const L = 30, R = 10, T = 10, B = 18;         // 여백
  const pw = W - L - R, ph = H - T - B;         // 그림 영역

  // y축 범위 결정
  let min, max;
  const scale = scaleKey ? SCALES[scaleKey] : null;
  if (scale) {
    min = scale.min; max = scale.max;
  } else {
    const vals = points.flatMap((p) => [p.value, p.value2].filter((v) => v != null));
    min = Math.min(...vals); max = Math.max(...vals);
    const pad = (max - min) * 0.3 || 2;         // 값이 하나뿐이면 최소 여백 확보
    min -= pad; max += pad;
  }

  const n = points.length;
  const px = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const py = (v) => T + ph - ((v - min) / (max - min)) * ph;

  // 배경 구간 띠 — 게이지와 같은 색을 쓴다
  let bands = "";
  if (scale) {
    let prev = scale.min;
    scale.zones.forEach((z) => {
      const yTop = py(z.to), yBot = py(prev);
      bands += `<rect class="c-band" x="${L}" y="${yTop}" width="${pw}"
                      height="${Math.max(0, yBot - yTop)}" fill="${z.color}"/>`;
      prev = z.to;
    });
  } else {
    bands = `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="#F4F7F8"/>`;
  }

  const line = points.map((p, i) => `${px(i)},${py(p.value)}`).join(" ");
  const dots = points
    .map((p, i) => `<circle class="c-dot ${i === n - 1 ? "c-dot--last" : ""}"
                            cx="${px(i)}" cy="${py(p.value)}" r="${i === n - 1 ? 3.4 : 2.4}"/>`)
    .join("");

  // 보조선 (혈압 이완기)
  let subLine = "";
  if (points.some((p) => p.value2 != null)) {
    const pts = points.map((p, i) => `${px(i)},${py(p.value2)}`).join(" ");
    subLine = `<polyline class="c-line c-line--sub" points="${pts}"/>`;
  }

  // y축 눈금 (최대 · 중간 · 최소)
  const mid = (min + max) / 2;
  const yLabels = [max, mid, min]
    .map((v) => `<text class="c-axis" x="${L - 5}" y="${py(v) + 3}" text-anchor="end">${
      Number(v.toFixed(v % 1 === 0 ? 0 : 1))
    }</text>`)
    .join("");

  const xLabels =
    `<text class="c-axis" x="${L}" y="${H - 5}">${shortDate(points[0].date)}</text>` +
    (n > 1
      ? `<text class="c-axis" x="${W - R}" y="${H - 5}" text-anchor="end">${shortDate(points[n - 1].date)}</text>`
      : "");

  const last = points[n - 1];

  return `
  <div class="chart">
    <div class="chart__head">
      <span class="chart__title">${title}</span>
      ${sub ? `<span class="chart__title" style="opacity:.6">${sub}</span>` : ""}
      <span class="chart__last">${last.value}${
        last.value2 != null ? ` / ${last.value2}` : ""
      }<small>${unit}</small></span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} 추세">
      ${bands}
      <line class="c-grid" x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}"/>
      ${subLine}
      ${n > 1 ? `<polyline class="c-line" points="${line}"/>` : ""}
      ${dots}
      ${yLabels}
      ${xLabels}
    </svg>
  </div>`;
}


/* ── 7) 화면 분기 ───────────────────────────────────── */

/** 기간 칩에 맞는 조회 경로 (전체=logs, N일=search) */
function logsPath() {
  if (state.days === 0) return "/me/logs";

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (state.days - 1));
  return `/me/search?start=${ymd(start)}&end=${ymd(end)}`;
}

async function refresh() {
  if (!state.me) return;

  const feed = $("feed");
  feed.innerHTML = `<div class="empty">불러오는 중…</div>`;

  try {
    const logs = await callApi(logsPath());

    if (state.days === 0) {
      const stats = await callApi("/me/stats");
      renderAllTab(logs, stats);
    } else {
      renderDashboard(logs);
    }
  } catch (e) {
    if (e.status === 401) return;      // 이미 로그아웃 처리됨
    feed.innerHTML = emptyHtml("불러오지 못했습니다", e.detail);
  }
}

function emptyHtml(title, desc) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(desc)}</div>`;
}


/* ── 8) 전체 탭 — 월 → 일 → 상세 ───────────────────── */

/**
 * 기록을 월 단위로 묶는다.
 * 서버가 최신순으로 주므로 순서를 유지하면 월도 최신순이 된다.
 * @returns [{ key:'2026-07', logs:[...] }, ...]
 */
function groupByMonth(logs) {
  const map = new Map();
  logs.forEach((l) => {
    const key = l.date.slice(0, 7);          // '2026-07-25' → '2026-07'
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  });
  return [...map.entries()].map(([key, items]) => ({ key, logs: items }));
}

function renderAllTab(logs, stats) {
  let html = summaryCard(stats);

  if (!logs.length) {
    html += emptyHtml("아직 기록이 없습니다", "오른쪽 아래 + 버튼을 눌러 오늘의 수치를 남겨보세요.");
    $("feed").innerHTML = html;
    return;
  }

  const groups = groupByMonth(logs);

  // 처음 열 때는 가장 최근 월과 그 달의 첫 기록을 펼쳐 둔다
  if (state.openMonths.size === 0) {
    state.openMonths.add(groups[0].key);
    if (state.openDays.size === 0) state.openDays.add(groups[0].logs[0].id);
  }

  html += groups.map(monthBlock).join("");
  $("feed").innerHTML = html;
}

function summaryCard(s) {
  const val = (v) => (v == null ? "—" : v);

  return `
    <section class="summary">
      <div class="summary__label">전체 기록 요약</div>
      <div class="summary__grid">
        <div class="summary__cell">
          <span class="summary__num">${s.count}</span>
          <span class="summary__cap">기록 수</span>
        </div>
        <div class="summary__cell">
          <span class="summary__num">${val(s.avg_bmi)}</span>
          <span class="summary__cap">평균 BMI</span>
        </div>
        <div class="summary__cell">
          <span class="summary__num">${val(s.avg_systolic)}<span style="font-size:12px">/${val(s.avg_diastolic)}</span></span>
          <span class="summary__cap">평균 혈압</span>
        </div>
        <div class="summary__cell">
          <span class="summary__num">${val(s.avg_blood_sugar)}</span>
          <span class="summary__cap">평균 혈당</span>
        </div>
      </div>
    </section>`;
}

/** 월 블록 — 접힌 상태에서는 월 이름과 요약만 보인다 */
function monthBlock(group) {
  const { key, logs } = group;
  const isOpen = state.openMonths.has(key);

  // 그달에 경고가 있던 날 수 — 접힌 상태에서도 위험 신호가 보이도록
  const warnDays = logs.filter((l) => l.warnings && l.warnings.length).length;

  // 월 전체에서 가장 나쁜 등급의 색을 왼쪽 띠로
  const worstColor = stripeColor(
    logs.flatMap((l) => [l.bmi_category, l.bp_category, l.sugar_category])
  );

  return `
  <section class="month ${isOpen ? "is-open" : ""}" style="--stripe:${worstColor}">
    <button class="month__head" data-month="${key}" aria-expanded="${isOpen}">
      <span class="month__title">${monthLabel(key)}</span>
      <span class="month__meta">
        기록 ${logs.length}일${warnDays ? ` · <b>경고 ${warnDays}일</b>` : ""}
      </span>
      <svg class="month__chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="month__list" ${isOpen ? "" : "hidden"}>
      ${logs.map(dayRow).join("")}
    </div>
  </section>`;
}

/** 일 단위 줄 — 클릭하면 상세가 펼쳐진다 */
function dayRow(l) {
  const cats = [l.bmi_category, l.bp_category, l.sugar_category];
  const isOpen = state.openDays.has(l.id);

  // 접힌 줄에는 그날 가장 나쁜 분류만 표시
  const worst = cats.reduce((a, b) => (grade(b) > grade(a) ? b : a));

  return `
  <article class="acc ${isOpen ? "is-open" : ""}"
           style="--stripe:${stripeColor(cats)}" data-id="${l.id}">
    <button class="acc__head" data-day="${l.id}" aria-expanded="${isOpen}">
      <span class="acc__date">${shortDate(l.date)}<em>${weekday(l.date)}</em></span>
      <span class="acc__peek">BMI ${l.bmi}</span>
      ${tag(worst)}
      <svg class="acc__chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="acc__body" ${isOpen ? "" : "hidden"}>
      ${detailBody(l)}
    </div>
  </article>`;
}

/** 펼쳤을 때 보이는 상세 내용 */
function detailBody(l) {
  const meta = [
    l.steps != null ? `${l.steps.toLocaleString()} 걸음` : null,
    l.sleep_hours != null ? `수면 ${l.sleep_hours}시간` : null,
  ].filter(Boolean).join("  ·  ");

  return `
    ${meta ? `<div class="acc__meta">${meta}</div>` : `<div style="height:12px"></div>`}

    <div class="metric">
      <div class="metric__head">
        <span class="metric__name">BMI</span>
        <span class="metric__val">${l.bmi}</span>
        ${tag(l.bmi_category)}
      </div>
      ${gauge("bmi", l.bmi)}
    </div>

    <div class="metric">
      <div class="metric__head">
        <span class="metric__name">혈압</span>
        <span class="metric__val">${l.systolic} / ${l.diastolic}</span>
        ${tag(l.bp_category)}
      </div>
      <div class="bp">
        <div><small>수축기</small>${gauge("sys", l.systolic)}</div>
        <div><small>이완기</small>${gauge("dia", l.diastolic)}</div>
      </div>
    </div>

    <div class="metric">
      <div class="metric__head">
        <span class="metric__name">혈당</span>
        <span class="metric__val">${l.blood_sugar}</span>
        ${tag(l.sugar_category)}
      </div>
      ${gauge("sugar", l.blood_sugar)}
    </div>

    ${l.memo ? `<div class="memo">${escapeHtml(l.memo)}</div>` : ""}
    ${l.warnings && l.warnings.length
      ? `<ul class="warnings">${l.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
      : ""}

    <div class="acc__foot">
      <button class="btn-del" data-del="${l.id}">삭제</button>
    </div>`;
}

/* 월 · 일 열고 닫기, 삭제 (이벤트 위임으로 한 번에 처리) */
$("feed").addEventListener("click", (ev) => {
  // 삭제
  const delBtn = ev.target.closest("[data-del]");
  if (delBtn) {
    removeLog(Number(delBtn.dataset.del));
    return;
  }

  // 월 토글
  const monthHead = ev.target.closest("[data-month]");
  if (monthHead) {
    const key = monthHead.dataset.month;
    const block = monthHead.closest(".month");
    const list = block.querySelector(".month__list");
    toggle(state.openMonths, key, block, list, monthHead);
    return;
  }

  // 일 토글
  const dayHead = ev.target.closest("[data-day]");
  if (dayHead) {
    const id = Number(dayHead.dataset.day);
    const acc = dayHead.closest(".acc");
    const body = acc.querySelector(".acc__body");
    toggle(state.openDays, id, acc, body, dayHead);
  }
});

/** 펼침 상태를 뒤집고 화면에 반영한다 (월·일 공통) */
function toggle(set, key, container, panel, head) {
  const opening = !set.has(key);

  if (opening) set.add(key);
  else set.delete(key);

  container.classList.toggle("is-open", opening);
  panel.hidden = !opening;
  head.setAttribute("aria-expanded", String(opening));
}


/* ── 9) 기간 탭 — 대시보드 ─────────────────────────── */

function renderDashboard(logs) {
  const label = `최근 ${state.days}일`;

  if (!logs.length) {
    $("feed").innerHTML =
      `<div class="dash-head"><h2>${label} 현황</h2></div>` +
      emptyHtml("이 기간에 기록이 없습니다", "기록을 남기면 추세가 그려집니다.");
    return;
  }

  // 서버 응답은 최신순 → 차트는 시간 순서대로 그려야 하므로 뒤집는다
  const asc = [...logs].reverse();

  const bmis = asc.map((l) => l.bmi);
  const sys = asc.map((l) => l.systolic);
  const dia = asc.map((l) => l.diastolic);
  const sugar = asc.map((l) => l.blood_sugar);

  // 기간 통계는 /me/stats(전체 기준)와 다르므로 여기서 직접 계산한다
  const warnDays = asc.filter((l) => l.warnings && l.warnings.length).length;
  const first = asc[0], last = asc[asc.length - 1];
  const wDiff = Number((last.weight - first.weight).toFixed(1));

  $("feed").innerHTML = `
    <div class="dash-head">
      <h2>${label} 현황</h2>
      <span>${first.date} ~ ${last.date}</span>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="stat__cap">기록</span>
        <span class="stat__num">${asc.length}<small> / ${state.days}일</small></span>
        <span class="stat__sub">기록률 ${Math.round((asc.length / state.days) * 100)}%</span>
      </div>
      <div class="stat">
        <span class="stat__cap">체중 변화</span>
        <span class="stat__num">${wDiff > 0 ? "+" : ""}${wDiff}<small> kg</small></span>
        <span class="stat__sub">${first.weight} → ${last.weight} kg</span>
      </div>
      <div class="stat">
        <span class="stat__cap">평균 BMI</span>
        <span class="stat__num">${avg(bmis)}</span>
        <span class="stat__sub">평균 혈압 ${avg(sys, 0)}/${avg(dia, 0)}</span>
      </div>
      <div class="stat">
        <span class="stat__cap">경고일</span>
        <span class="stat__num">${warnDays}<small> / ${asc.length}일</small></span>
        <span class="stat__sub">평균 혈당 ${avg(sugar, 0)} mg/dL</span>
      </div>
    </div>

    ${distributionCard(asc)}

    ${trendChart(asc.map((l) => ({ date: l.date, value: l.weight })), null, "체중", "kg")}
    ${trendChart(asc.map((l) => ({ date: l.date, value: l.bmi })), "bmi", "BMI", "")}
    ${trendChart(
      asc.map((l) => ({ date: l.date, value: l.systolic, value2: l.diastolic })),
      "sys", "혈압", "mmHg", "수축기 실선 · 이완기 점선"
    )}
    ${trendChart(asc.map((l) => ({ date: l.date, value: l.blood_sugar })), "sugar", "공복 혈당", "mg/dL")}
  `;
}

/** 항목별로 정상/주의/위험이 며칠씩이었는지 막대로 */
function distributionCard(logs) {
  const rows = [
    { name: "체중(BMI)", key: "bmi_category" },
    { name: "혈압", key: "bp_category" },
    { name: "공복혈당", key: "sugar_category" },
  ];

  const bars = rows.map((r) => {
    const counts = [0, 0, 0];      // [정상, 주의, 위험]
    logs.forEach((l) => counts[grade(l[r.key])]++);

    const colors = ["var(--t-ok)", "var(--t-warn)", "var(--t-risk)"];
    const seg = counts
      .map((c, i) => (c ? `<span style="flex:${c};background:${colors[i]}"></span>` : ""))
      .join("");

    const legend = ["정상", "주의", "위험"]
      .map((n, i) => (counts[i] ? `${n} ${counts[i]}일` : null))
      .filter(Boolean)
      .join("  ·  ");

    return `
      <div class="dist__row">
        <div class="dist__name">${r.name}</div>
        <div class="dist__bar">${seg}</div>
        <div class="dist__legend">${legend} (총 ${logs.length}일)</div>
      </div>`;
  }).join("");

  return `<div class="dist"><div class="dist__title">기간 내 분류 분포</div>${bars}</div>`;
}


/* ── 10) 기록 저장 · 삭제 ───────────────────────────── */

$("btnSave").addEventListener("click", async () => {
  const payload = {
    date:        $("fDate").value,
    weight:      numOrNull("fWeight"),
    height:      numOrNull("fHeight"),
    systolic:    numOrNull("fSys"),
    diastolic:   numOrNull("fDia"),
    blood_sugar: numOrNull("fSugar"),
    steps:       numOrNull("fSteps"),
    sleep_hours: numOrNull("fSleep"),
    memo:        $("fMemo").value.trim() || null,
  };

  const btn = $("btnSave");
  btn.disabled = true;

  try {
    const created = await callApi("/me/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    $("fMemo").value = "";

    // 방금 저장한 기록이 보이도록 해당 월과 날짜를 펼친다
    state.openMonths.add(created.date.slice(0, 7));
    state.openDays.clear();
    state.openDays.add(created.id);

    closeSheets();
    toast("기록을 저장했습니다", false, 200);
    refresh();
  } catch (e) {
    if (e.status !== 401) toast(e.detail, true, e.status);
  } finally {
    btn.disabled = false;
  }
});

async function removeLog(id) {
  if (!confirm("이 기록을 삭제할까요?")) return;

  try {
    await callApi(`/me/logs/${id}`, { method: "DELETE" });
    state.openDays.delete(id);
    toast("기록을 삭제했습니다", false, 200);
    refresh();
  } catch (e) {
    if (e.status !== 401) toast(e.detail, true, e.status);
  }
}


/* ── 11) 바텀시트 · 토스트 · 필터 ──────────────────── */

function openSheet(id) {
  $("scrim").hidden = false;
  $(id).hidden = false;
  document.body.classList.add("is-locked");
}

function closeSheets() {
  $("scrim").hidden = true;
  $("sheetLog").hidden = true;
  document.body.classList.remove("is-locked");
}

$("fabAdd").addEventListener("click", () => openSheet("sheetLog"));
$("scrim").addEventListener("click", closeSheets);
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheets));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

let toastTimer;
function toast(message, isError = false, code) {
  const el = $("toast");
  el.className = "toast" + (isError ? " toast--err" : "");
  el.innerHTML = (code ? `<code>${code}</code>` : "") + escapeHtml(message);
  el.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

$("chips").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip");
  if (!btn) return;

  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-on"));
  btn.classList.add("is-on");

  state.days = Number(btn.dataset.days);
  refresh();
});


/* ── 12) 입력 제한 ──────────────────────────────────── */

/**
 * 날짜칸: 키보드 입력을 막고 달력으로만 고르게 한다.
 * 직접 타이핑하면 '0024-07-30' 같은 잘못된 연도가 들어갈 수 있기 때문.
 */
const dateInput = $("fDate");
dateInput.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") e.preventDefault();      // Tab만 허용 (다음 칸 이동)
});
dateInput.addEventListener("paste", (e) => e.preventDefault());
dateInput.addEventListener("click", () => {
  if (dateInput.showPicker) {
    try { dateInput.showPicker(); } catch { /* 미지원 브라우저는 기본 동작 */ }
  }
});

/**
 * 숫자칸: 범위를 벗어난 값이 아예 찍히지 않게 막는다.
 *  - 최대값 초과와 소수 자릿수는 입력 시점에 차단
 *  - 최소값은 칸을 벗어날 때 보정 (60이 최소인데 '6'을 막으면 입력 불가)
 */
function guardNumber(el) {
  const max = el.max !== "" ? Number(el.max) : Infinity;
  const min = el.min !== "" ? Number(el.min) : -Infinity;
  const maxDecimals = String(el.step || "1").includes(".") ? 1 : 0;

  let last = el.value;

  el.addEventListener("input", () => {
    const v = el.value;
    if (v === "") { last = ""; return; }

    if (!/^\d*\.?\d*$/.test(v)) { el.value = last; return; }

    const decimals = v.split(".")[1];
    if (decimals && decimals.length > maxDecimals) { el.value = last; return; }

    if (Number(v) > max) { el.value = last; return; }

    last = v;
  });

  el.addEventListener("blur", () => {
    if (el.value === "") return;
    if (Number(el.value) < min) {
      el.value = String(min);
      last = el.value;
      toast(`최소 ${min}까지 입력할 수 있습니다`, true);
    }
  });
}

document.querySelectorAll('#sheetLog input[type="number"]').forEach(guardNumber);


/* ── 13) 시작 ───────────────────────────────────────── */

const today = ymd(new Date());
$("fDate").value = today;
$("fDate").max = today;          // 미래 날짜는 달력에서 아예 못 고르게

/** 보관된 토큰이 유효하면 앱 화면으로, 아니면 로그인 화면으로 */
(async function start() {
  if (!getToken()) { showAuth(); return; }

  try {
    state.me = await callApi("/auth/me");
    showApp();
    refresh();
  } catch {
    showAuth();
  }
})();