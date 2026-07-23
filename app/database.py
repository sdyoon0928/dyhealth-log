import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 환경변수가 없으면 로컬 기본값 사용
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+psycopg://myhealth:myhealth@localhost:5432/myhealth",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """모든 테이블 모델의 부모 클래스"""
    pass


def get_db():
    """요청 1개당 DB 세션 1개를 열고, 끝나면 닫아준다"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()