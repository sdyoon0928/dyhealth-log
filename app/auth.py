"""인증(로그인) 기능 모음.

역할:
- 비밀번호를 안전하게 해시 / 검증 (bcrypt)
- 로그인 성공 시 JWT 토큰 발급
- 요청에 담긴 토큰을 해석해 '지금 로그인한 사용자'를 찾아냄

보안 원칙: 비밀번호 원문은 절대 저장하지 않는다.
해시는 단방향이라 DB가 유출돼도 원문을 되돌릴 수 없다.

사용처: main.py의 auth 라우트, 그리고 로그인이 필요한 모든 라우트
"""

import datetime as dt
import os

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

# 토큰 서명에 쓰는 비밀키. 유출되면 토큰을 위조할 수 있으므로 .env로 관리한다.
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-insecure-key")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24          # 24시간

# Swagger 화면 우측 상단에 'Authorize' 버튼을 만들어 주는 설정.
# tokenUrl은 로그인 엔드포인트의 경로를 가리킨다.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(plain: str) -> str:
    """평문 비밀번호를 bcrypt 해시로 바꾼다.

    같은 비밀번호라도 매번 다른 해시가 나온다(salt 때문).
    사용처: 회원가입
    """
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """입력한 비밀번호가 저장된 해시와 일치하는지 확인한다.

    해시를 복호화하는 게 아니라, 입력값을 같은 방식으로 해시해 비교한다.
    사용처: 로그인
    """
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int) -> str:
    """사용자 id를 담은 JWT 토큰을 만든다.

    sub = 토큰의 주인(사용자 id), exp = 만료 시각.
    SECRET_KEY로 서명하므로 내용을 위조하면 검증 단계에서 걸린다.
    사용처: 로그인 성공 시
    """
    payload = {
        "sub": str(user_id),
        "exp": dt.datetime.now(dt.timezone.utc)
        + dt.timedelta(minutes=TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """요청에 담긴 토큰을 해석해 '지금 로그인한 사용자'를 돌려준다.

    라우트에 Depends(get_current_user)를 붙이면 그 API는 로그인 필수가 된다.
    토큰이 없거나 만료·위조됐거나 해당 사용자가 삭제됐으면 401.
    """
    credential_error = HTTPException(
        status_code=401,
        detail="로그인이 필요합니다",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise credential_error

    user = db.get(User, user_id)
    if not user:
        raise credential_error
    return user