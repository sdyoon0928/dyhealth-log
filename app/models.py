"""DB 테이블 구조 정의 (SQLAlchemy 모델).

역할 구분:
- models.py  : DB에 '저장'되는 실제 테이블 구조 (이 파일)
- schemas.py : API가 '주고받는' 데이터의 형식/검증

여기서 정의한 클래스가 곧 DB의 테이블이 된다.
서버 시작 시 main.py의 create_all()이 이 정의를 읽어 테이블을 만든다.

용어 미리 정리:
- Mapped[타입]      : 이 컬럼이 담는 파이썬 타입
- mapped_column()   : 컬럼의 세부 설정(기본키, 인덱스, 널 허용 등)
- ForeignKey        : 다른 테이블의 값을 참조하도록 강제
- relationship      : 파이썬 코드에서 테이블 간 연결을 편히 다루게 해줌
"""

import datetime as dt

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    """사용자 테이블. 한 명이 여러 건강 기록을 가진다 (1:N).

    email은 유일(unique)해서 같은 이메일로 두 번 가입할 수 없다.
    사용처: main.py의 users 관련 라우트
    """
    __tablename__ = "users"

    # 기본키: 자동 증가하는 식별 번호
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # 이메일: 중복 불가(unique), 조회 빠르게(index)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    nickname: Mapped[str] = mapped_column(String(50))
    # 생성 시각: 서버가 아니라 DB가 현재 시각을 자동으로 채움

    # 비밀번호는 원문이 아니라 해시만 저장한다(되돌릴 수 없음).
    password_hash: Mapped[str] = mapped_column(String(255))

    
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 이 사용자의 기록들(파이썬에서 user.logs 로 접근 가능).
    # cascade="all, delete-orphan": 사용자를 지우면 그 기록도 함께 삭제.
    logs: Mapped[list["HealthLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class HealthLog(Base):
    """건강 기록 테이블. 하루치 측정값 한 건이 한 행(row)이다.

    저장하는 값은 '원본 측정값'뿐이다.
    bmi/분류/warnings 같은 계산값은 여기 저장하지 않고,
    응답을 만들 때 schemas.py에서 계산한다.
    사용처: main.py의 logs/search/stats 라우트
    """
    __tablename__ = "health_logs"
    __table_args__ = (
        # (user_id, date) 조합은 유일해야 함.
        # -> 같은 사용자가 같은 날짜에 기록을 두 번 만들 수 없다.
        UniqueConstraint("user_id", "date", name="uq_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # 이 기록의 주인. users.id를 참조하며,
    # ondelete="CASCADE": 참조하는 사용자가 삭제되면 이 기록도 삭제.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # ----- 필수 측정값 (nullable 아님 = 반드시 값이 있어야 함) -----
    date: Mapped[dt.date] = mapped_column(Date, index=True)   # 측정일
    weight: Mapped[float] = mapped_column()                   # 몸무게(kg)
    height: Mapped[float] = mapped_column()                   # 키(cm)
    systolic: Mapped[int] = mapped_column()                   # 수축기 혈압
    diastolic: Mapped[int] = mapped_column()                  # 이완기 혈압
    blood_sugar: Mapped[int] = mapped_column()                # 공복 혈당

    # ----- 선택 항목 (nullable=True = 값이 없어도 됨) -----
    steps: Mapped[int | None] = mapped_column(nullable=True)
    sleep_hours: Mapped[float | None] = mapped_column(nullable=True)
    memo: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 생성 시각: 행이 처음 만들어질 때 DB가 자동 기록
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # 수정 시각: 행이 update될 때만 자동 갱신(처음엔 비어 있음)
    updated_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), nullable=True
    )

    # 이 기록의 주인 사용자(파이썬에서 log.user 로 접근 가능).
    # User.logs와 짝을 이룬다(back_populates).
    user: Mapped["User"] = relationship(back_populates="logs")