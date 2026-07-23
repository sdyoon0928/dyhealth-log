/* ============================================================
   DY 헬스 로그 — 화면 동작 스크립트

   구성
     1) 설정 · 유틸
     2) API 호출 래퍼 (오류 메시지 해석 포함)
     3) 게이지 렌더링 (구간 띠 + 마커)
     4) 사용자
     5) 기록 목록 / 통계
     6) 카드 그리기
     7) 바텀시트 · 토스트
     8) 초기화
   ============================================================ */

/* ── 1) 설정 · 유틸 ─────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const API = "";                    // 같은 서버에서 서빙하므로 경로만 사용

const state = {
  userId: null,
  days: 0,                         // 0 = 전체, 7 / 30 = 최근 N일
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


/* ── 2) API 호출 ────────────────────────────────────── */

/**
 * fetch를 감싸서 실패 시 {status, detail} 형태로 던진다.
 * 화면 어디서든 같은 방식으로 오류를 처리하기 위함.
 */
async function callApi(path, options) {
  const res = await fetch(API + path, options);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, detail: readDetail(body) };
  return body;
}

/**
 * 서버 오류 메시지를 사람이 읽을 문장으로 바꾼다.
 * - 400/404/409 : detail이 문자열
 * - 422         : detail이 배열(어느 필드가 왜 틀렸는지)
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


/* ── 3) 게이지 ──────────────────────────────────────── */

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
    // 마지막 구간의 오른쪽 끝은 눈금을 달지 않는다(표시 범위의 끝일 뿐이므로)
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


/* ── 4) 사용자 ──────────────────────────────────────── */

async function loadUsers(selectId) {
  const sel = $("userSel");

  try {
    const users = await callApi("/users");

    if (users.length === 0) {
      sel.innerHTML = `<option value="">사용자 추가하기</option>`;
      state.userId = null;
      renderEmpty("사용자를 먼저 추가하세요", "상단 선택 메뉴에서 사용자를 만들면 기록을 남길 수 있습니다.");
      return;
    }

    sel.innerHTML =
      users.map((u) => `<option value="${u.id}">${escapeHtml(u.nickname)}</option>`).join("") +
      `<option value="__new">+ 사용자 추가</option>`;

    state.userId = String(selectId || users[0].id);
    sel.value = state.userId;
    refresh();
  } catch (e) {
    toast(e.detail, true, e.status);
  }
}

$("userSel").addEventListener("change", (ev) => {
  if (ev.target.value === "__new") {
    ev.target.value = state.userId || "";
    openSheet("sheetUser");
    return;
  }
  state.userId = ev.target.value;
  refresh();
});

$("btnUser").addEventListener("click", async () => {
  const nickname = $("uNick").value.trim();
  const email = $("uEmail").value.trim();

  if (!nickname || !email) {
    toast("이름과 이메일을 모두 입력하세요", true);
    return;
  }

  try {
    const user = await callApi("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, nickname }),
    });

    $("uNick").value = "";
    $("uEmail").value = "";
    closeSheets();
    toast(`${user.nickname} 님을 추가했습니다`, false, 200);
    loadUsers(user.id);
  } catch (e) {
    toast(e.detail, true, e.status);
  }
});


/* ── 5) 목록 · 통계 ─────────────────────────────────── */

/** 기간 칩에 맞는 조회 경로를 만든다 (전체=logs, N일=search) */
function logsPath() {
  const uid = state.userId;
  if (state.days === 0) return `/users/${uid}/logs`;

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (state.days - 1));
  return `/users/${uid}/search?start=${ymd(start)}&end=${ymd(end)}`;
}

async function refresh() {
  if (!state.userId) return;

  const feed = $("feed");
  feed.innerHTML = `<div class="empty">불러오는 중…</div>`;

  try {
    // 통계와 목록을 동시에 요청해 대기 시간을 줄인다
    const [stats, logs] = await Promise.all([
      callApi(`/users/${state.userId}/stats`),
      callApi(logsPath()),
    ]);

    let html = summaryCard(stats);

    html += logs.length
      ? logs.map(logCard).join("")
      : emptyHtml("아직 기록이 없습니다", "오른쪽 아래 + 버튼을 눌러 오늘의 수치를 남겨보세요.");

    feed.innerHTML = html;
  } catch (e) {
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

function renderEmpty(title, desc) {
  $("feed").innerHTML = emptyHtml(title, desc);
}


/* ── 6) 기록 카드 ───────────────────────────────────── */

function logCard(l) {
  const stripe = stripeColor([l.bmi_category, l.bp_category, l.sugar_category]);

  // 걸음 수 · 수면은 있을 때만 표시
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

/** 카드의 삭제 버튼에서 호출 (onclick 속성에서 쓰므로 전역에 둔다) */
window.removeLog = async function (id) {
  if (!confirm("이 기록을 삭제할까요?")) return;

  try {
    await callApi(`/logs/${id}`, { method: "DELETE" });
    toast("기록을 삭제했습니다", false, 200);
    refresh();
  } catch (e) {
    toast(e.detail, true, e.status);
  }
};


/* ── 7) 기록 저장 ───────────────────────────────────── */

$("btnSave").addEventListener("click", async () => {
  if (!state.userId) {
    toast("사용자를 먼저 선택하세요", true);
    return;
  }

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
    await callApi(`/users/${state.userId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    $("fMemo").value = "";
    closeSheets();
    toast("기록을 저장했습니다", false, 200);
    refresh();
  } catch (e) {
    toast(e.detail, true, e.status);
  } finally {
    btn.disabled = false;
  }
});


/* ── 8) 바텀시트 · 토스트 ───────────────────────────── */

function openSheet(id) {
  $("scrim").hidden = false;
  $(id).hidden = false;
  document.body.classList.add("is-locked");
}

function closeSheets() {
  $("scrim").hidden = true;
  $("sheetLog").hidden = true;
  $("sheetUser").hidden = true;
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


/* ── 9) 기간 필터 ───────────────────────────────────── */

$("chips").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip");
  if (!btn) return;

  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-on"));
  btn.classList.add("is-on");

  state.days = Number(btn.dataset.days);
  refresh();
});


/* ── 10) 초기화 ─────────────────────────────────────── */

const today = ymd(new Date());
$("fDate").value = today;
$("fDate").max = today;          // 미래 날짜는 달력에서 아예 못 고르게

loadUsers();