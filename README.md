<a id="top"></a>

# DY 헬스 로그 API

> 매일의 건강 수치를 기록하면, 서버가 BMI를 계산하고 혈압·혈당을 분류해 위험 신호를 짚어주는 개인 건강 기록 API입니다.

---

## 목차

- [1. 프로젝트 개요](#1-프로젝트-개요)
- [2. 프로젝트 구조](#2-프로젝트-구조)
- [3. 기술 스택](#3-기술-스택)
- [4. 주요 기능](#4-주요-기능)
- [5. 실행 방법](#5-실행-방법)
- [6. API 엔드포인트](#6-api-엔드포인트)
- [7. 요청 · 응답 예시](#7-요청--응답-예시)
- [8. 분류 기준](#8-분류-기준)
- [9. 응답 코드 정책](#9-응답-코드-정책)
- [10. 검증 규칙](#10-검증-규칙)
- [11. 인증 방식](#11-인증-방식)
- [12. 데이터 저장 방식](#12-데이터-저장-방식)
- [13. 화면](#13-화면)
- [14. 한계와 향후 과제](#14-한계와-향후-과제)

---

## 1. 프로젝트 개요

건강검진 수치를 받아도 "이 숫자가 정상인지"는 비전문가가 판단하기 어렵습니다.
이 API는 몸무게·키·혈압·혈당을 저장하는 동시에 **BMI 계산 · 상태 분류 · 경고 생성**까지 한 번의 요청으로 끝냅니다.
쌓인 기록은 기간별 검색과 평균 통계로 다시 확인할 수 있습니다.

| 항목 | 내용 |
|---|---|
| 프로젝트명 | DY 헬스 로그 API (dyhealth-log) |
| 버전 | 0.2.0 |
| 개발 환경 | VS Code · Docker Desktop (Windows) |
| 저장소 | https://github.com/sdyoon0928/dyhealth-log |

### 설계 문서

기획 배경과 요구사항 정의는 아래 문서에 정리했습니다.

| 문서 | 내용 |
|---|---|
| 📄 [기획서](docs/기획서.md) | 배경 · 목적 · 시스템 구성 · 데이터 모델 · 개발 단계 |
| 📄 [PRD](docs/PRD.md) | 제품 요구사항 정의 · 기능 명세 · 제출물 체크리스트 |

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 2. 프로젝트 구조

```
dyhealth-log/
├── app/
│   ├── __init__.py
│   ├── main.py            # 엔드포인트 정의
│   ├── auth.py            # 비밀번호 해시 · JWT 토큰 발급/검증
│   ├── database.py        # DB 연결 · 세션 관리
│   ├── models.py          # 테이블 구조 (SQLAlchemy)
│   ├── schemas.py         # 요청/응답 형식 · 검증 (Pydantic)
│   ├── health_rules.py    # 건강 분류 로직
│   ├── static/
│   │   ├── index.html     # 화면 구조
│   │   ├── style.css      # 스타일
│   │   └── app.js         # 화면 동작
│   └── screenshots/       # README용 화면 이미지
├── docs/
│   ├── 기획서.md
│   └── PRD.md
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
├── .gitignore
├── .dockerignore
└── README.md
```

### 계층 분리 원칙

| 파일 | 책임 |
|---|---|
| `main.py` | 요청을 받고 응답을 돌려주는 창구 |
| `auth.py` | 인증 — 비밀번호 해시, 토큰 발급·검증 |
| `schemas.py` | 주고받는 데이터의 형식과 검증 |
| `models.py` | DB에 저장되는 테이블 구조 |
| `health_rules.py` | 건강 분류 규칙 (DB · 프레임워크와 무관한 순수 함수) |

분류 로직을 라우트와 스키마에서 떼어냈기 때문에, 기준이 바뀌어도 API 코드는 건드리지 않습니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 3. 기술 스택

| 영역 | 사용 기술 | 선택 이유 |
|---|---|---|
| 언어 | Python 3.12 | |
| 웹 프레임워크 | FastAPI | 타입 힌트 기반 자동 검증, Swagger 문서 자동 생성 |
| 데이터 검증 | Pydantic v2 | 요청 검증과 응답 직렬화를 한 곳에서 처리 |
| ORM | SQLAlchemy 2.0 | 파이썬 코드로 DB를 다루고 제약 조건을 선언적으로 관리 |
| 데이터베이스 | PostgreSQL 16 | 외래 키 · 복합 유니크 등 제약 조건 지원이 견고함 |
| 인증 | PyJWT · bcrypt | 토큰 기반 인증, 비밀번호 단방향 해시 |
| 실행 환경 | Docker · Docker Compose | 앱과 DB를 함께 띄워 어느 환경에서나 동일하게 실행 |
| 화면 | HTML · CSS · Vanilla JS | 별도 빌드 도구 없이 정적 파일로 서빙 |

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 4. 주요 기능

| 기능 | 설명 |
|---|---|
| 회원가입 · 로그인 | 비밀번호는 bcrypt 해시로 저장, 로그인 시 JWT 토큰 발급 |
| 기록 접근 제어 | 로그인한 본인의 기록만 조회 · 수정 · 삭제 가능 |
| 건강 기록 CRUD | 하루치 측정값의 생성 · 조회 · 수정 · 삭제 |
| BMI 자동 계산 | 몸무게와 키로 BMI를 계산해 응답에 포함 |
| 상태 분류 | BMI · 혈압 · 공복혈당을 각각 구간별로 분류 |
| 경고 생성 | 정상 범위를 벗어난 항목에 대한 안내 문구 자동 생성 |
| 기간 검색 | 시작일~종료일 범위로 기록 검색 |
| 통계 | 기록 수와 항목별 평균값 집계 |
| 웹 화면 | 모바일 우선 레이아웃의 로그인 · 기록 입력 · 조회 화면 |
| 입력값 제한 | 서버 검증 + 브라우저 입력 차단의 2단계 방어 |

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 5. 실행 방법

### Docker로 실행 (권장)

```bash
git clone https://github.com/sdyoon0928/dyhealth-log.git
cd dyhealth-log

# 환경변수 파일 생성 후 값 수정
cp .env.example .env

docker compose up --build
```

| 주소 | 내용 |
|---|---|
| http://localhost:4923 | 웹 화면 |
| http://localhost:4923/docs | Swagger 자동 문서 (API 테스트) |
| http://localhost:4923/health | 서버 상태 확인 |

컨테이너 중지 · 재시작:

```bash
docker compose down      # 데이터는 유지됩니다
docker compose up -d     # 다시 실행
```

> ⚠️ `docker compose down -v` 는 볼륨까지 삭제해 **데이터가 사라집니다.**

### 로컬에서 실행 (Docker 없이)

PostgreSQL이 로컬에 설치되어 있어야 합니다.

```bash
python -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate

pip install -r requirements.txt

set DATABASE_URL=postgresql+psycopg://myhealth:myhealth@localhost:5432/myhealth
set SECRET_KEY=로컬테스트용_임의의_긴_문자열

uvicorn app.main:app --reload
```

http://127.0.0.1:8000/docs 에서 확인할 수 있습니다.

### 환경변수

`.env.example` 을 복사해 `.env` 로 만들고 값을 채웁니다.

| 변수 | 설명 |
|---|---|
| `POSTGRES_USER` | DB 사용자명 |
| `POSTGRES_PASSWORD` | DB 비밀번호 |
| `POSTGRES_DB` | DB 이름 |
| `SECRET_KEY` | JWT 토큰 서명용 비밀키 (길고 무작위인 문자열) |

`.env` 는 `.gitignore` 로 제외되어 저장소에 올라가지 않습니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 6. API 엔드포인트

### 시스템

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| GET | `/` | — | 웹 화면 |
| GET | `/health` | — | 서버 상태 확인 |
| GET | `/docs` | — | Swagger 자동 문서 |

### 인증

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/auth/register` | — | 회원가입 |
| POST | `/auth/login` | — | 로그인 (토큰 발급) |
| GET | `/auth/me` | 필요 | 내 정보 조회 |
| DELETE | `/me` | 필요 | 회원 탈퇴 (기록도 함께 삭제) |

### 건강 기록

모두 로그인이 필요하며, **URL에 사용자 id가 없습니다.** 토큰이 주인을 결정합니다.

| Method | Path | 설명 |
|---|---|---|
| POST | `/me/logs` | 기록 생성 (BMI · 분류 · 경고 계산 포함) |
| GET | `/me/logs` | 기록 목록 (기간 필터 · 페이징) |
| GET | `/me/search` | 날짜 범위 검색 (start, end 필수) |
| GET | `/me/stats` | 통계 (기록 수 · 평균값) |
| GET | `/me/logs/{log_id}` | 기록 단건 조회 |
| PATCH | `/me/logs/{log_id}` | 기록 부분 수정 |
| DELETE | `/me/logs/{log_id}` | 기록 삭제 |

### 쿼리 파라미터

| 엔드포인트 | 파라미터 | 기본값 | 설명 |
|---|---|---|---|
| `GET /me/logs` | `start_date`, `end_date` | 없음 | 기간 필터 (선택) |
| | `limit` | 50 | 최대 200 |
| | `offset` | 0 | 건너뛸 개수 |
| `GET /me/search` | `start`, `end` | — | **필수** |

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 7. 요청 · 응답 예시

### 회원가입

`POST /auth/register`

```json
{
  "email": "dy@example.com",
  "nickname": "동윤",
  "password": "test1234"
}
```

응답에 `password_hash` 는 포함되지 않습니다. 응답 스키마(`UserOut`)에 아예 없기 때문입니다.

```json
{
  "id": 1,
  "email": "dy@example.com",
  "nickname": "동윤",
  "created_at": "2026-07-23T05:12:40+00:00"
}
```

### 로그인

`POST /auth/login` — JSON이 아닌 **폼 형식**이며, 이메일을 `username` 이라는 이름으로 보냅니다(OAuth2 표준).

```
username=dy@example.com&password=test1234
```

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

이후 모든 요청 헤더에 담아 보냅니다.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

### 기록 생성

`POST /me/logs`

```json
{
  "date": "2026-07-20",
  "weight": 85.0,
  "height": 170.0,
  "systolic": 145,
  "diastolic": 95,
  "blood_sugar": 130,
  "steps": 4200,
  "sleep_hours": 5.5,
  "memo": "야근이 이어진 주"
}
```

응답 — 입력값에 더해 **서버가 계산한 5개 필드**가 함께 반환됩니다.

```json
{
  "id": 1,
  "user_id": 1,
  "date": "2026-07-20",
  "weight": 85.0,
  "height": 170.0,
  "systolic": 145,
  "diastolic": 95,
  "blood_sugar": 130,
  "steps": 4200,
  "sleep_hours": 5.5,
  "memo": "야근이 이어진 주",
  "created_at": "2026-07-20T09:14:22+00:00",
  "updated_at": null,

  "bmi": 29.4,
  "bmi_category": "비만",
  "bp_category": "고혈압",
  "sugar_category": "당뇨 의심",
  "warnings": [
    "체중 상태가 '비만' 구간입니다.",
    "혈압이 '고혈압' 구간입니다.",
    "공복혈당이 '당뇨 의심' 구간입니다.",
    "정확한 판단은 의료 전문가의 진료가 필요합니다."
  ]
}
```

### 통계

`GET /me/stats`

```json
{
  "count": 12,
  "avg_weight": 82.4,
  "avg_bmi": 28.5,
  "avg_systolic": 138.2,
  "avg_diastolic": 89.1,
  "avg_blood_sugar": 118.6
}
```

> 기록이 0건이면 `count`는 0, 나머지 평균은 `null` 을 반환합니다. 오류가 아닙니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 8. 분류 기준

분류 로직은 `app/health_rules.py` 한 곳에 모아두었습니다. 기준이 바뀌어도 이 파일만 수정하면 됩니다.

### BMI

`BMI = 몸무게(kg) ÷ (키(m))²`

| 구간 | 분류 |
|---|---|
| 18.5 미만 | 저체중 |
| 18.5 ~ 22.9 | 정상 |
| 23 ~ 24.9 | 과체중 |
| 25 이상 | 비만 |

### 혈압

| 조건 | 분류 |
|---|---|
| 수축기 < 120 **그리고** 이완기 < 80 | 정상 |
| 120~139 **또는** 80~89 | 주의 |
| 수축기 ≥ 140 **또는** 이완기 ≥ 90 | 고혈압 |

> 구현 시 **고혈압 → 정상 → 주의** 순으로 검사합니다. 정상을 먼저 판정하면 `수축기 150 / 이완기 70` 처럼 한쪽만 높은 값이 "주의"로 잘못 분류됩니다.

### 공복혈당

| 구간 | 분류 |
|---|---|
| 100 미만 | 정상 |
| 100 ~ 125 | 공복혈당장애 |
| 126 이상 | 당뇨 의심 |

### 경고 (warnings)

정상이 아닌 항목마다 안내 문구를 만들고, 하나라도 있으면 마지막에 전문가 진료 권고를 덧붙입니다. 해당 없으면 빈 목록 `[]` 입니다.

### 계산 값을 저장하지 않는 이유

`bmi`, `bmi_category`, `bp_category`, `sugar_category`, `warnings` 는 DB에 저장하지 않고 **응답을 만들 때마다 계산**합니다.

분류 기준은 가이드라인 개정으로 바뀔 수 있습니다. 계산 결과를 저장해두면 기준이 바뀌는 순간 과거 데이터 전체가 잘못된 값이 됩니다. 계산식만 관리하면 항상 최신 기준이 적용됩니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 9. 응답 코드 정책

### 성공

| 코드 | 상황 |
|---|---|
| 200 | 모든 성공 응답 (생성 · 삭제 포함) |

> REST 관례상 생성은 201, 삭제는 204를 쓰지만 이 프로젝트는 **200으로 통일**했습니다. 클라이언트가 성공 여부를 단일 조건으로 판단할 수 있어 처리가 단순해집니다.

### 실패

| 코드 | 의미 | 발생 예시 |
|---|---|---|
| 400 | 논리적으로 잘못된 요청 | 시작일이 종료일보다 늦음 |
| 401 | 인증 실패 | 토큰 없음 · 만료 · 위조, 로그인 정보 불일치 |
| 404 | 대상 없음 | 존재하지 않거나 **내 것이 아닌** `log_id` |
| 409 | 중복 충돌 | 이메일 중복, 같은 날짜 기록 중복 |
| 422 | 값 검증 실패 | 미래 날짜, 수축기 ≤ 이완기, 범위 초과 |

**400과 422의 차이** — 400은 코드에서 명시적으로 발생시키는 비즈니스 규칙 위반이고, 422는 Pydantic이 자동으로 발생시키는 형식 · 값 검증 실패입니다. 422 응답에는 어떤 필드가 왜 틀렸는지가 배열로 담겨 클라이언트가 처리하기 좋습니다.

**남의 기록에 403이 아닌 404를 쓰는 이유** — 403("권한 없음")은 *"그 id의 기록이 존재하긴 한다"* 는 사실을 알려주는 셈입니다. id를 훑어 타인의 기록 수를 파악할 수 있으므로, 없는 것과 남의 것을 구분하지 않고 404로 통일했습니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 10. 검증 규칙

### 건강 기록

| 필드 | 규칙 | 위반 시 |
|---|---|---|
| `date` | 미래 날짜 불가 | 422 |
| `weight` | 0 초과 500 미만 · 소수 1자리로 반올림 | 422 |
| `height` | 50 초과 300 미만 · 소수 1자리로 반올림 | 422 |
| `systolic` | 60 ~ 180 | 422 |
| `diastolic` | 40 ~ 120 | 422 |
| 혈압 관계 | 수축기 > 이완기 | 422 |
| `blood_sugar` | 40 ~ 400 | 422 |
| `steps` | 0 ~ 30,000 | 422 |
| `sleep_hours` | 0 ~ 24 · 소수 1자리로 반올림 | 422 |
| `memo` | 500자 이하 | 422 |
| `(user_id, date)` | 같은 사용자 · 같은 날짜 조합 유일 | 409 |

### 사용자

| 필드 | 규칙 | 위반 시 |
|---|---|---|
| `email` | 이메일 형식 · 중복 불가 | 422 / 409 |
| `nickname` | 1 ~ 50자 | 422 |
| `password` | 8 ~ 72자 | 422 |

### 2단계 방어

같은 제한을 브라우저와 서버 양쪽에 겁니다.

| 위치 | 역할 |
|---|---|
| 브라우저 (`app.js`) | 범위를 벗어나는 값이 **입력칸에 찍히지 않게** 차단, 소수 자릿수 제한 |
| 서버 (`schemas.py`) | 실제 차단. 개발자 도구로 우회해도 여기서 걸립니다 |

브라우저 쪽은 편의 장치이고, 최종 방어선은 서버입니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 11. 인증 방식

### 흐름

```
회원가입 → 비밀번호를 bcrypt 해시로 변환해 저장 (원문은 저장하지 않음)
   │
로그인 → 이메일/비밀번호 확인 → JWT 토큰 발급 (유효기간 24시간)
   │
이후 요청 → 헤더에 Authorization: Bearer <토큰>
   │
서버 → 토큰을 해석해 사용자를 식별 → 본인 기록만 조회/수정
```

### 설계 포인트

**비밀번호는 되돌릴 수 없습니다.**
bcrypt 해시는 단방향이라 DB가 유출돼도 원문을 복원할 수 없습니다. 로그인 시에는 입력값을 같은 방식으로 해시해 비교합니다.

**URL에서 `user_id` 를 없앴습니다.**
`/users/{user_id}/logs` 대신 `/me/logs` 를 씁니다. 클라이언트가 남의 id를 지정할 방법 자체가 사라집니다.

**로그인 실패 시 원인을 구분해 알리지 않습니다.**
"이메일이 없음" / "비밀번호 틀림" 을 나누면 가입 여부가 새어나갑니다. 두 경우 모두 같은 401 메시지를 반환합니다.

**로그아웃에 별도 API가 없습니다.**
JWT는 서버가 상태를 저장하지 않으므로, **클라이언트가 토큰을 버리는 것**이 곧 로그아웃입니다. 화면에서는 저장된 토큰을 삭제하는 방식으로 구현했습니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 12. 데이터 저장 방식

### PostgreSQL + Docker 볼륨

기록은 PostgreSQL에 저장하고, DB 데이터 디렉터리를 Docker **named volume(`pgdata`)** 에 연결했습니다. 컨테이너를 지우거나 재시작해도 볼륨은 남아 데이터가 유지됩니다.

| 명령 | 데이터 |
|---|---|
| `docker compose restart` | 유지 |
| `docker compose down` | 유지 |
| `docker compose down -v` | **삭제** |

### 파일 저장 대신 DB를 선택한 이유

과제 명세는 JSON 파일 저장을 제시했으나, 요구사항의 핵심인 **"서버를 재시작해도 데이터가 유지될 것"** 을 볼륨 기반 PostgreSQL로 구현했습니다.

- **동시 쓰기 안전성** — JSON 파일은 요청이 겹치면 내용이 깨질 수 있습니다.
- **제약 조건을 DB가 보장** — 외래 키(존재하지 않는 사용자 참조 차단)와 복합 유니크(같은 날짜 중복 차단)를 애플리케이션 코드가 아닌 DB 레벨에서 지킵니다.
- **검색 · 집계** — 기간 검색과 평균 계산을 인덱스 기반으로 처리할 수 있습니다.

### ERD

```
User (1) ──────< (N) HealthLog
```

**users**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | Integer | PK |
| email | String(255) | Unique, Not Null |
| nickname | String(50) | Not Null |
| password_hash | String(255) | Not Null |
| created_at | DateTime | 자동 |

**health_logs**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | Integer | PK |
| user_id | Integer | FK → users.id (ON DELETE CASCADE) |
| date | Date | Not Null |
| weight | Float | Not Null |
| height | Float | Not Null |
| systolic | Integer | Not Null |
| diastolic | Integer | Not Null |
| blood_sugar | Integer | Not Null |
| steps | Integer | Nullable |
| sleep_hours | Float | Nullable |
| memo | String(500) | Nullable |
| created_at | DateTime | 자동 |
| updated_at | DateTime | 자동 |

복합 유니크 제약: `(user_id, date)`

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 13. 화면

`/` 로 접속하면 웹 화면이 열립니다.

| 로그인 | 기록 목록 | 기록 추가 |
|:---:|:---:|:---:|
| <img src="app/screenshots/login.png" width="240" alt="로그인 화면"> 
| <img src="app/screenshots/main.png" width="240" alt="기록 목록 화면"> 
| <img src="app/screenshots/create.png" width="240" alt="기록 추가 화면"> |
| 로그인 · 회원가입 전환 | 요약 카드와 기록 카드 피드 | 하단에서 올라오는 입력 시트 |

### 화면 특징

- **모바일 우선 레이아웃** — 카드 피드 + 하단 시트 입력, 플로팅 버튼으로 기록 추가
- **구간 게이지** — 분류 구간을 띠로 그리고 현재 값의 위치를 마커로 표시해, 기준을 몰라도 수치의 의미를 파악할 수 있습니다
- **상태 띠** — 카드 왼쪽 색은 그날 가장 위험한 항목의 등급을 나타내, 스크롤만으로 흐름이 보입니다
- **엔드포인트 활용** — 기간 필터는 `/me/search`, 상단 요약 카드는 `/me/stats` 를 사용합니다
- **오류 표시** — 서버가 보낸 상태 코드와 메시지를 그대로 노출합니다 (409 중복, 422 검증 실패 등)
- **로그인 유지** — 발급받은 토큰을 브라우저에 보관해, 새로고침해도 로그인 상태가 유지됩니다

HTML · CSS · JS를 파일로 분리해 `/static` 경로로 서빙합니다.

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 14. 한계와 향후 과제

### 현재 한계

- **의학적 진단이 아닙니다.** 제공하는 분류는 단순화한 학습용 기준이며, 응답의 `warnings` 에도 전문가 진료 권고를 포함합니다.
- **스키마 변경 시 데이터 초기화가 필요합니다.** 서버 시작 시 `create_all()` 로 테이블을 만들고 있어, 컬럼이 추가되면 기존 테이블과 어긋납니다.
- **토큰 무효화 수단이 없습니다.** JWT 특성상 발급된 토큰은 만료 전까지 유효합니다. 즉시 차단하려면 별도의 블랙리스트가 필요합니다.
- **HTTPS가 적용되지 않았습니다.** 현재는 HTTP로만 통신하므로, 실제 서비스에서는 토큰이 노출될 수 있습니다.

### 향후 과제

| 우선순위 | 과제 |
|---|---|
| 상 | Alembic 마이그레이션 도입 (데이터를 유지한 채 스키마 변경) |
| 상 | HTTPS 적용 및 클라우드 배포 |
| 중 | 리프레시 토큰 · 토큰 무효화 |
| 중 | 기간별 추세 통계 · 주간 리포트 |
| 하 | 목표 체중 · 혈압 관리 기능 |

<div align="right"><a href="#top">⬆ 맨 위로</a></div>

---

## 참고

- 이 프로젝트의 건강 분류 기준은 학습을 위해 단순화한 값이며, 실제 의학적 진단이 아닙니다.
- BMI 구간은 아시아-태평양 기준을 적용했습니다. (WHO 국제 기준은 25부터 과체중)

<div align="right"><a href="#top">⬆ 맨 위로</a></div>