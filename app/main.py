"""FastAPI 앱의 진입점. 모든 API 엔드포인트(라우트)를 정의한다.

계층 구조:
  main.py     : 요청을 받고 응답을 돌려주는 '창구' (이 파일)
  schemas.py  : 주고받는 데이터의 형식/검증
  models.py   : DB 테이블 구조
  health_rules: 건강 분류 규칙
  database.py : DB 연결/세션

각 라우트 함수의 Depends(get_db)는 요청마다 DB 세션을 하나 받아오고,
응답이 끝나면 자동으로 닫아준다.
"""

from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine, get_db
from app.models import HealthLog, User
from app.health_rules import calc_bmi
from app.schemas import (
    HealthLogCreate,
    HealthLogOut,
    HealthLogUpdate,
    StatsOut,
    UserCreate,
    UserOut,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버의 시작/종료 시점에 실행되는 준비 작업.

    시작 시: 테이블이 없으면 자동 생성한다.
    (yield 앞 = 시작 시 실행, yield 뒤 = 종료 시 실행)
    """
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="DY헬스케어 로그 API",
    description="일일 건강 기록 관리 REST API",
    version="0.1.0",
    lifespan=lifespan,
)

# 정적 파일(HTML/CSS) 서빙 설정
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    """루트 경로. 프론트엔드 화면(index.html)을 반환한다.

    include_in_schema=False라서 /docs 문서에는 표시되지 않는다.
    """
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health", tags=["system"])
def healthcheck():
    """서버 생존 확인용. 배포 후 상태 점검에 쓴다."""
    return {"status": "ok"}


# ==================== 사용자 ====================

@app.post("/users", response_model=UserOut, tags=["users"])
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """새 사용자를 생성한다.

    - 호출: POST /users
    - 이메일이 이미 있으면 409(중복)로 거부한다.
    - 성공 시 생성된 사용자 정보를 반환한다.
    """
    exists = db.scalar(select(User).where(User.email == payload.email))
    if exists:
        raise HTTPException(status_code=409, detail="이미 존재하는 이메일입니다")

    user = User(**payload.model_dump())
    db.add(user)
    db.commit()
    db.refresh(user)          # DB가 채워준 id 등을 객체에 다시 불러옴
    return user


@app.get("/users", response_model=list[UserOut], tags=["users"])
def list_users(db: Session = Depends(get_db)):
    """전체 사용자 목록을 id 순으로 반환한다.

    - 호출: GET /users
    """
    return db.scalars(select(User).order_by(User.id)).all()


@app.get("/users/{user_id}", response_model=UserOut, tags=["users"])
def get_user(user_id: int, db: Session = Depends(get_db)):
    """사용자 한 명을 id로 조회한다. 없으면 404.

    - 호출: GET /users/{user_id}
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return user


@app.delete("/users/{user_id}", tags=["users"])
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """사용자를 삭제한다. 없으면 404.

    - 호출: DELETE /users/{user_id}
    - 이 사용자의 건강 기록도 함께 삭제된다
      (models.py의 CASCADE 설정 때문).
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    db.delete(user)
    db.commit()
    return {"message": "삭제되었습니다", "id": user_id}


# ==================== 건강 기록 ====================

@app.post("/users/{user_id}/logs", response_model=HealthLogOut, tags=["logs"])
def create_log(user_id: int, payload: HealthLogCreate, db: Session = Depends(get_db)):
    """특정 사용자의 건강 기록을 추가한다.

    - 호출: POST /users/{user_id}/logs
    - 사용자가 없으면 404.
    - 같은 사용자가 같은 날짜에 이미 기록이 있으면 409(중복).
    - 성공 시 응답에는 bmi/분류/warnings가 함께 계산되어 나온다
      (HealthLogOut의 computed_field가 처리).
    """
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    # (user_id, date) 조합 중복 방지
    dup = db.scalar(
        select(HealthLog).where(
            HealthLog.user_id == user_id,
            HealthLog.date == payload.date,
        )
    )
    if dup:
        raise HTTPException(status_code=409, detail="해당 날짜의 기록이 이미 있습니다")

    log = HealthLog(user_id=user_id, **payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@app.get("/users/{user_id}/logs", response_model=list[HealthLogOut], tags=["logs"])
def list_logs(
    user_id: int,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """특정 사용자의 기록 목록을 최신순으로 반환한다.

    - 호출: GET /users/{user_id}/logs
    - start_date/end_date로 기간 필터 (둘 다 선택).
    - limit/offset으로 페이징 (한 번에 최대 200건).
    - 시작일이 종료일보다 늦으면 400.
    - 사용자가 없으면 404.
    """
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail=f"시작날짜({start_date})가 종료날짜({end_date})보다 늦을 수 없습니다",
        )

    stmt = select(HealthLog).where(HealthLog.user_id == user_id)
    if start_date:
        stmt = stmt.where(HealthLog.date >= start_date)
    if end_date:
        stmt = stmt.where(HealthLog.date <= end_date)
    stmt = stmt.order_by(HealthLog.date.desc()).limit(limit).offset(offset)
    return db.scalars(stmt).all()


@app.get("/users/{user_id}/search", response_model=list[HealthLogOut], tags=["logs"])
def search_logs(
    user_id: int,
    start: date,
    end: date,
    db: Session = Depends(get_db),
):
    """날짜 범위로 기록을 검색한다 (검색 전용 엔드포인트).

    - 호출: GET /users/{user_id}/search?start=...&end=...
    - list_logs와 달리 start/end가 '필수'다(안 넣으면 422).
      검색이라는 의도를 분명히 하기 위한 별도 경로.
    - start > end 이면 400, 사용자 없으면 404.
    """
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    if start > end:
        raise HTTPException(
            status_code=400,
            detail=f"시작날짜({start})가 종료날짜({end})보다 늦을 수 없습니다",
        )

    stmt = (
        select(HealthLog)
        .where(
            HealthLog.user_id == user_id,
            HealthLog.date >= start,
            HealthLog.date <= end,
        )
        .order_by(HealthLog.date.desc())
    )
    return db.scalars(stmt).all()


@app.get("/users/{user_id}/stats", response_model=StatsOut, tags=["stats"])
def get_stats(user_id: int, db: Session = Depends(get_db)):
    """특정 사용자의 전체 기록을 집계해 평균 통계를 반환한다.

    - 호출: GET /users/{user_id}/stats
    - 기록이 0건이면 count=0, 나머지 평균은 None
      (0으로 나누는 오류를 막기 위함).
    - avg_bmi는 저장값이 아니라 기록마다 calc_bmi로 다시 계산해 평균낸다.
    - 사용자가 없으면 404.
    """
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    logs = db.scalars(
        select(HealthLog).where(HealthLog.user_id == user_id)
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


@app.get("/logs/{log_id}", response_model=HealthLogOut, tags=["logs"])
def get_log(log_id: int, db: Session = Depends(get_db)):
    """기록 한 건을 id로 조회한다. 없으면 404.

    - 호출: GET /logs/{log_id}
    - 사용자와 무관하게 기록 id로 직접 찾는다.
    """
    log = db.get(HealthLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")
    return log


@app.patch("/logs/{log_id}", response_model=HealthLogOut, tags=["logs"])
def update_log(log_id: int, payload: HealthLogUpdate, db: Session = Depends(get_db)):
    """기록을 부분 수정한다. 없으면 404.

    - 호출: PATCH /logs/{log_id}
    - exclude_unset=True: 요청에 '실제로 담긴 필드만' 골라 덮어쓴다.
      (안 보낸 필드는 기존 값 유지)
    """
    log = db.get(HealthLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")

    # 보낸 필드만 골라서 덮어쓰기
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(log, key, value)

    db.commit()
    db.refresh(log)
    return log


@app.delete("/logs/{log_id}", tags=["logs"])
def delete_log(log_id: int, db: Session = Depends(get_db)):
    """기록을 삭제한다. 없으면 404.

    - 호출: DELETE /logs/{log_id}
    """
    log = db.get(HealthLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다")
    db.delete(log)
    db.commit()
    return {"message": "삭제되었습니다", "id": log_id}