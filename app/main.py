"""FastAPI 앱의 진입점. 모든 API 엔드포인트(라우트)를 정의한다.

계층 구조:
  main.py       : 요청을 받고 응답을 돌려주는 '창구' (이 파일)
  auth.py       : 비밀번호 해시 · 토큰 발급/검증
  schemas.py    : 주고받는 데이터의 형식/검증
  models.py     : DB 테이블 구조
  health_rules  : 건강 분류 규칙
  database.py   : DB 연결/세션

인증 방식:
  로그인하면 JWT 토큰을 발급하고, 이후 요청은 헤더에 토큰을 담아 보낸다.
  라우트에 Depends(get_current_user)를 붙이면 그 API는 로그인 필수가 되며,
  URL에 user_id를 적을 필요가 없다(토큰이 주인을 결정하므로).
"""

from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.database import Base, engine, get_db
from app.health_rules import calc_bmi
from app.models import HealthLog, User
from app.schemas import (
    HealthLogCreate,
    HealthLogOut,
    HealthLogUpdate,
    StatsOut,
    Token,
    UserCreate,
    UserOut,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 시작/종료 시점에 실행되는 준비 작업.

    시작 시: 테이블이 없으면 자동 생성한다.
    (yield 앞 = 시작 시, yield 뒤 = 종료 시)
    """
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="DY헬스케어 로그 API",
    description="일일 건강 기록 관리 REST API",
    version="0.2.0",
    lifespan=lifespan,
)

# 정적 파일(HTML/CSS/JS) 서빙 설정
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    """루트 경로. 프론트엔드 화면(index.html)을 반환한다."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health", tags=["system"])
def healthcheck():
    """서버 생존 확인용. 배포 후 상태 점검에 쓴다."""
    return {"status": "ok"}


# ==================== 공통 헬퍼 ====================

def get_owned_log(log_id: int, user: User, db: Session) -> HealthLog:
    """기록을 찾되, 로그인한 사용자의 것이 아니면 404를 낸다.

    남의 기록에 접근했을 때 403(권한 없음)이 아니라 404(없음)를 주는 이유:
    403은 "그 id의 기록이 존재하긴 한다"는 사실을 알려주는 셈이라
    id를 훑어 남의 데이터 존재 여부를 알아낼 수 있다.
    사용처: 기록 단건 조회 / 수정 / 삭제
    """
    log = db.get(HealthLog, log_id)
    if not log or log.user_id != user.id:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")
    return log


# ==================== 인증 ====================

@app.post("/auth/register", response_model=UserOut, tags=["auth"])
def register(payload: UserCreate, db: Session = Depends(get_db)):
    """회원가입. 비밀번호는 해시로 변환해 저장한다.

    - 호출: POST /auth/register
    - 이메일이 이미 있으면 409.
    - 응답 스키마(UserOut)에 password_hash가 없으므로 해시는 노출되지 않는다.
    """
    exists = db.scalar(select(User).where(User.email == payload.email))
    if exists:
        raise HTTPException(status_code=409, detail="이미 존재하는 이메일입니다")

    user = User(
        email=payload.email,
        nickname=payload.nickname,
        password_hash=hash_password(payload.password),   # 원문 대신 해시
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=Token, tags=["auth"])
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """로그인. 성공하면 JWT 토큰을 발급한다.

    - 호출: POST /auth/login (폼 형식)
    - form.username 칸에 '이메일'을 넣는다(OAuth2 표준 필드명이라 이름이 username).
    - 실패 시 401. 이메일이 틀렸는지 비밀번호가 틀렸는지는 구분해 알리지 않는다
      (가입 여부가 새어나가지 않도록).
    """
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="이메일 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(access_token=create_access_token(user.id))


@app.get("/auth/me", response_model=UserOut, tags=["auth"])
def read_me(current_user: User = Depends(get_current_user)):
    """현재 로그인한 사용자 정보를 반환한다.

    - 호출: GET /auth/me (토큰 필요)
    - 토큰이 아직 유효한지 확인하는 용도로도 쓴다.
    """
    return current_user


@app.delete("/me", tags=["auth"])
def delete_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """회원 탈퇴. 본인 계정과 기록을 모두 삭제한다.

    - 호출: DELETE /me (토큰 필요)
    - 기록도 함께 삭제된다(models.py의 CASCADE 설정).
    - 남의 계정을 지울 방법이 없다. URL에 id가 없기 때문.
    """
    db.delete(current_user)
    db.commit()
    return {"message": "탈퇴 처리되었습니다"}


# ==================== 건강 기록 (전부 로그인 필요) ====================

@app.post("/me/logs", response_model=HealthLogOut, tags=["logs"])
def create_log(
    payload: HealthLogCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 건강 기록을 추가한다.

    - 호출: POST /me/logs (토큰 필요)
    - 같은 날짜에 이미 기록이 있으면 409.
    - 응답에는 bmi/분류/warnings가 함께 계산되어 나온다
      (HealthLogOut의 computed_field가 처리).
    """
    dup = db.scalar(
        select(HealthLog).where(
            HealthLog.user_id == current_user.id,
            HealthLog.date == payload.date,
        )
    )
    if dup:
        raise HTTPException(status_code=409, detail="해당 날짜의 기록이 이미 있습니다")

    log = HealthLog(user_id=current_user.id, **payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@app.get("/me/logs", response_model=list[HealthLogOut], tags=["logs"])
def list_logs(
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 기록 목록을 최신순으로 반환한다.

    - 호출: GET /me/logs (토큰 필요)
    - start_date/end_date로 기간 필터 (둘 다 선택).
    - limit/offset으로 페이징 (한 번에 최대 200건).
    - 시작일이 종료일보다 늦으면 400.
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail=f"시작날짜({start_date})가 종료날짜({end_date})보다 늦을 수 없습니다",
        )

    stmt = select(HealthLog).where(HealthLog.user_id == current_user.id)
    if start_date:
        stmt = stmt.where(HealthLog.date >= start_date)
    if end_date:
        stmt = stmt.where(HealthLog.date <= end_date)
    stmt = stmt.order_by(HealthLog.date.desc()).limit(limit).offset(offset)
    return db.scalars(stmt).all()


@app.get("/me/search", response_model=list[HealthLogOut], tags=["logs"])
def search_logs(
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """날짜 범위로 내 기록을 검색한다 (검색 전용 엔드포인트).

    - 호출: GET /me/search?start=...&end=... (토큰 필요)
    - list_logs와 달리 start/end가 '필수'다(안 넣으면 422).
    - start > end 이면 400.
    """
    if start > end:
        raise HTTPException(
            status_code=400,
            detail=f"시작날짜({start})가 종료날짜({end})보다 늦을 수 없습니다",
        )

    stmt = (
        select(HealthLog)
        .where(
            HealthLog.user_id == current_user.id,
            HealthLog.date >= start,
            HealthLog.date <= end,
        )
        .order_by(HealthLog.date.desc())
    )
    return db.scalars(stmt).all()


@app.get("/me/stats", response_model=StatsOut, tags=["stats"])
def get_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 전체 기록을 집계해 평균 통계를 반환한다.

    - 호출: GET /me/stats (토큰 필요)
    - 기록이 0건이면 count=0, 나머지 평균은 None (0으로 나누기 방지).
    - avg_bmi는 저장값이 아니라 기록마다 calc_bmi로 다시 계산해 평균낸다.
    """
    logs = db.scalars(
        select(HealthLog).where(HealthLog.user_id == current_user.id)
    ).all()

    if not logs:
        return StatsOut(
            count=0,
            avg_weight=None,
            avg_bmi=None,
            avg_systolic=None,
            avg_diastolic=None,
            avg_blood_sugar=None,
        )

    n = len(logs)
    # 같은 평균 계산을 6번 반복하지 않으려고 짧은 헬퍼로 묶음
    avg = lambda values: round(sum(values) / n, 1)

    return StatsOut(
        count=n,
        avg_weight=avg([l.weight for l in logs]),
        avg_bmi=avg([calc_bmi(l.weight, l.height) for l in logs]),
        avg_systolic=avg([l.systolic for l in logs]),
        avg_diastolic=avg([l.diastolic for l in logs]),
        avg_blood_sugar=avg([l.blood_sugar for l in logs]),
    )


@app.get("/me/logs/{log_id}", response_model=HealthLogOut, tags=["logs"])
def get_log(
    log_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 기록 한 건을 조회한다.

    - 호출: GET /me/logs/{log_id} (토큰 필요)
    - 남의 기록 id를 넣으면 404 (존재 여부를 알려주지 않음).
    """
    return get_owned_log(log_id, current_user, db)


@app.patch("/me/logs/{log_id}", response_model=HealthLogOut, tags=["logs"])
def update_log(
    log_id: int,
    payload: HealthLogUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 기록을 부분 수정한다.

    - 호출: PATCH /me/logs/{log_id} (토큰 필요)
    - exclude_unset=True: 요청에 '실제로 담긴 필드만' 골라 덮어쓴다
      (안 보낸 필드는 기존 값 유지).
    - 날짜를 다른 기록과 겹치게 바꾸려 하면 409.
    """
    log = get_owned_log(log_id, current_user, db)
    changes = payload.model_dump(exclude_unset=True)

    # 날짜를 바꾸는 경우, 같은 날짜의 다른 기록이 있는지 먼저 확인.
    # (확인 없이 저장하면 DB 유니크 제약에 걸려 500이 난다)
    new_date = changes.get("date")
    if new_date and new_date != log.date:
        dup = db.scalar(
            select(HealthLog).where(
                HealthLog.user_id == current_user.id,
                HealthLog.date == new_date,
            )
        )
        if dup:
            raise HTTPException(status_code=409, detail="해당 날짜의 기록이 이미 있습니다")

    for key, value in changes.items():
        setattr(log, key, value)

    db.commit()
    db.refresh(log)
    return log


@app.delete("/me/logs/{log_id}", tags=["logs"])
def delete_log(
    log_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내 기록을 삭제한다.

    - 호출: DELETE /me/logs/{log_id} (토큰 필요)
    - 남의 기록은 404라서 지울 수 없다.
    """
    log = get_owned_log(log_id, current_user, db)
    db.delete(log)
    db.commit()
    return {"message": "삭제되었습니다", "id": log_id}