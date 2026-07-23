/* ============================================================
   DY 헬스 로그 — 화면 동작 스크립트

   구성
     1) 설정 · 유틸
     2) 토큰 보관
     3) API 호출 (인증 헤더 · 오류 해석)
     4) 로그인 · 회원가입 화면
     5) 게이지 렌더링
     6) 목록 · 통계
     7) 기록 카드
     8) 기록 저장 · 삭제
     9) 바텀시트 · 토스트 · 필터
    10) 시작

   인증 방식
     로그인하면 서버가 JWT 토큰을 준다. 토큰을 브라우저에 보관해두고
     이후 모든 요청 헤더에 담아 보낸다. 로그아웃은 토큰을 지우는 것.
   ============================================================ */

/* ── 1) 설정 · 유틸 ─────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const API = "";                       // 같은 서버에서 서빙하므로 경로만 사용

const state = {
  me: null,        // 로그인한 사용자 정보
  days: 0,         // 0 = 전체, 7 / 30 = 최근 N일
  mode: "login",   // 인증 화면 모드: login | register
};

/** YYYY-MM-DD 문자열로 변환 (시간대 밀림 없이) */
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 날짜 문자열에서 요일 한 글자 뽑기 */
function weekday(dateStr) {
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  return names[new Date(dateStr + "T00:00:00").getDay()];
}

/** 사용자 입력을 그대로 HTML에 넣지 않도록 이스케이프 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

/** 입력칸이 비어 있으면 null, 아니면 숫자 */
function numOrNull(id) {
  const v = $(id).value.trim();
  return v === "" ? null : Number(v);
}


/* ── 2) 토큰 보관 ───────────────────────────────────── */

const TOKEN_KEY = "dyhealth_token";

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);


/* ── 3) API 호출 ────────────────────────────────────── */

/**
 * fetch를 감싸서
 *  - 토큰이 있으면 Authorization 헤더를 자동으로 붙이고
 *  - 실패 시 {status, detail} 형태로 던진다.
 * 401(토큰 만료·없음)이면 자동으로 로그아웃 처리한다.
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

/**
 * 서버 오류 메시지를 사람이 읽을 문장으로 바꾼다.
 *  - 400/401/404/409 : detail이 문자열
 *  - 422            : detail이 배열(어느 필드가 왜 틀렸는지)
 */
function readDetail(body) {
  if (!body || !body.detail) return "요청을 처리하지 못했습니다";
  if (typeof body.detail === "string") return body.detail;

  return body.detail
    .map((e) => {
      const field = (e.loc || []).slice(-1)[0];
      const msg = e.msg.replace("Value error, ", "");
      return `${field}: ${msg}`;
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

function clearAuthError() {
  $("authErr").hidden = true;
}

/** 로그인 / 회원가입 탭 전환 */
$("seg").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;

  state.mode = btn.dataset.mode;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.remove("is-on"));
  btn.classList.add("is-on");

  const isRegister = state.mode === "register";
  $("fieldNick").hidden = !isRegister;      // 이름은 회원가입에만 필요
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
    // 회원가입이면 계정을 만든 뒤 곧바로 로그인까지 진행한다
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
  showAuth();
  if (message) authError(message);
}

$("btnLogout").addEventListener("click", () => {
  if (!confirm("로그아웃할까요?")) return;
  logout();
});

/** 엔터로도 제출되게 */
["aEmail", "aPw", "aNick"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnAuth").click();
  });
});


/* ── 5) 게이지 ──────────────────────────────────────── */

/* 각 지표의 표시 범위와 구간 색.
   서버 health_rules.py의 분류 기준과 같은 경계값을 쓴다. */
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

/** 분류명 → 배지 색상 클래스 */
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

/** 카드 왼쪽 띠 색: 그날 가장 나쁜 분류를 기준으로 */
function stripeColor(categories) {
  if (categories.some((c) => TAG_CLASS[c] === "tag--risk")) return "var(--risk)";
  if (categories.some((c) => TAG_CLASS[c] === "tag--warn")) return "var(--warn)";
  if (categories.some((c) => TAG_CLASS[c] === "tag--low"))  return "var(--t-low)";
  return "var(--ok)";
}

/** 구간 띠 + 현재값 마커 + 경계 눈금 HTML 생성 */
function gauge(key, value) {
  const s = SCALES[key];
  const span = s.max - s.min;

  let prev = s.min;
  let bars = "";
  let ticks = "";

  s.zones.forEach((z, i) => {
    const w = (z.to - prev) / span;
    bars += `<span style="flex:${w};background:${z.color}"></span>`;
    // 마지막 구간의 오른쪽 끝은 표시 범위의 끝일 뿐이므로 눈금을 달지 않는다
    const label = i < s.zones.length - 1 ? z.to : "";
    ticks += `<span style="flex:${w}">${label}</span>`;
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


/* ── 6) 목록 · 통계 ─────────────────────────────────── */

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
    // 통계와 목록을 동시에 요청해 대기 시간을 줄인다
    const [stats, logs] = await Promise.all([
      callApi("/me/stats"),
      callApi(logsPath()),
    ]);

    let html = summaryCard(stats);

    html += logs.length
      ? logs.map(logCard).join("")
      : emptyHtml("아직 기록이 없습니다", "오른쪽 아래 + 버튼을 눌러 오늘의 수치를 남겨보세요.");

    feed.innerHTML = html;
  } catch (e) {
    if (e.status === 401) return;      // 이미 로그아웃 처리됨
    feed.innerHTML = emptyHtml("불러오지 못했습니다", e.detail);
  }
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

function emptyHtml(title, desc) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(desc)}</div>`;
}


/* ── 7) 기록 카드 ───────────────────────────────────── */

function logCard(l) {
  const stripe = stripeColor([l.bmi_category, l.bp_category, l.sugar_category]);

  // 걸음 수 · 수면은 값이 있을 때만 표시
  const sub = [
    l.steps != null ? `${l.steps.toLocaleString()} 걸음` : null,
    l.sleep_hours != null ? `수면 ${l.sleep_hours}시간` : null,
  ].filter(Boolean).join("  ·  ");

  return `
  <article class="card" style="--stripe:${stripe}">
    <div class="card__top">
      <div>
        <div class="card__date">${l.date}<span class="card__day">${weekday(l.date)}</span></div>
        ${sub ? `<div class="card__sub">${sub}</div>` : ""}
      </div>
      <button class="card__del" onclick="removeLog(${l.id})">삭제</button>
    </div>

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
  </article>`;
}


/* ── 8) 기록 저장 · 삭제 ────────────────────────────── */

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
    await callApi("/me/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    $("fMemo").value = "";
    closeSheets();
    toast("기록을 저장했습니다", false, 200);
    refresh();
  } catch (e) {
    if (e.status !== 401) toast(e.detail, true, e.status);
  } finally {
    btn.disabled = false;
  }
});

/** 카드의 삭제 버튼에서 호출 (onclick 속성에서 쓰므로 전역에 둔다) */
window.removeLog = async function (id) {
  if (!confirm("이 기록을 삭제할까요?")) return;

  try {
    await callApi(`/me/logs/${id}`, { method: "DELETE" });
    toast("기록을 삭제했습니다", false, 200);
    refresh();
  } catch (e) {
    if (e.status !== 401) toast(e.detail, true, e.status);
  }
};


/* ── 9) 바텀시트 · 토스트 · 필터 ────────────────────── */

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

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", closeSheets);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheets();
});

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

/* ── 입력칸 제한 ────────────────────────────────────── */

/**
 * 숫자 입력칸에 아예 잘못된 값이 '찍히지 않게' 막는다.
 *
 * 동작 방식
 *  - 타이핑할 때마다 검사해, 어긋나면 직전 값으로 되돌린다.
 *  - 최대값 초과와 소수 자릿수는 '입력 시점'에 차단한다.
 *  - 최소값은 입력 중에는 두고, 칸을 벗어날 때 맞춰준다.
 *    (60이 최소인데 '6'을 치는 순간 막으면 아무것도 못 쓰기 때문)
 *
 * min/max/step은 HTML에 적힌 값을 그대로 읽어 쓴다.
 */
function guardNumber(el) {
  const max = el.max !== "" ? Number(el.max) : Infinity;
  const min = el.min !== "" ? Number(el.min) : -Infinity;
  const maxDecimals = String(el.step || "1").includes(".") ? 1 : 0;

  let last = el.value;   // 되돌릴 직전 값

  el.addEventListener("input", () => {
    const v = el.value;

    if (v === "") { last = ""; return; }

    // 숫자와 소수점만 허용
    if (!/^\d*\.?\d*$/.test(v)) { el.value = last; return; }

    // 소수 자릿수 초과 (예: 5.25 → 5.2까지만)
    const decimals = v.split(".")[1];
    if (decimals && decimals.length > maxDecimals) { el.value = last; return; }

    // 최대값 초과 (예: 180이 최대인데 1800을 치려는 경우)
    if (Number(v) > max) { el.value = last; return; }

    last = v;
  });

  // 칸을 벗어날 때 최소값보다 작으면 최소값으로 올려준다
  el.addEventListener("blur", () => {
    if (el.value === "") return;
    if (Number(el.value) < min) {
      el.value = String(min);
      last = el.value;
      toast(`최소 ${min}까지 입력할 수 있습니다`, true);
    }
  });
}

// 기록 입력 시트의 모든 숫자 칸에 적용
document.querySelectorAll('#sheetLog input[type="number"]').forEach(guardNumber);


/* ── 10) 시작 ───────────────────────────────────────── */

const today = ymd(new Date());
$("fDate").value = today;
$("fDate").max = today;          // 미래 날짜는 달력에서 아예 못 고르게

/**
 * 페이지를 열 때: 보관된 토큰이 있으면 아직 유효한지 확인하고
 * 유효하면 바로 앱 화면으로, 아니면 로그인 화면으로 보낸다.
 */
(async function start() {
  if (!getToken()) {
    showAuth();
    return;
  }

  try {
    state.me = await callApi("/auth/me");
    showApp();
    refresh();
  } catch {
    // 토큰이 만료됐거나 잘못된 경우 (callApi가 이미 로그아웃 처리)
    showAuth();
  }
})();