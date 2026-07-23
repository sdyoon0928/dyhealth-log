"""요청/응답 데이터의 형식과 검증 규칙 정의 (Pydantic 스키마).

역할 구분:
- models.py  : DB에 '저장'되는 실제 테이블 구조
- schemas.py : API가 '주고받는' 데이터의 형식과 검증 (이 파일)

Pydantic이 자동으로 해주는 일:
- 타입/범위 검증 (틀리면 자동으로 422 응답)
- JSON <-> 파이썬 객체 변환
- computed_field로 계산값을 응답에 끼워넣기
"""

import datetime as dt

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.health_rules import (
    build_warnings,
    calc_bmi,
    classify_bmi,
    classify_bp,
    classify_sugar,
)


class HealthLogBase(BaseModel):
    """건강 기록의 공통 필드와 검증 규칙.

    Create/Out 스키마가 이 클래스를 상속해 필드를 공유한다.
    Field(...)의 gt/lt/ge/le는 값의 허용 범위이며,
    범위를 벗어나면 Pydantic이 자동으로 422를 낸다.
    """

    date: dt.date
    weight: float = Field(gt=0, lt=500)          # kg · 소수 1자리로 반올림
    height: float = Field(gt=50, lt=300)         # cm · 소수 1자리로 반올림
    systolic: int = Field(ge=60, le=180)         # 수축기
    diastolic: int = Field(ge=40, le=120)        # 이완기
    blood_sugar: int = Field(ge=40, le=400)      # 공복 혈당

    # 선택 항목: 안 보내면 None
    steps: int | None = Field(None, ge=0, le=30000)
    sleep_hours: float | None = Field(None, ge=0, le=24)
    memo: str | None = Field(None, max_length=500)

    @field_validator("weight", "height", "sleep_hours")
    @classmethod
    def one_decimal(cls, v: float | None) -> float | None:
        """소수점 한 자리로 반올림한다.

        거부하지 않고 반올림하는 이유: 체중계가 68.53을 보여줬을 때
        입력을 막기보다 68.5로 받아주는 편이 쓰기 편하다.
        """
        return None if v is None else round(v, 1)

    @field_validator("date")
    @classmethod
    def no_future_date(cls, v: dt.date) -> dt.date:
        """단일 필드 검증: 측정일이 미래이면 거부한다.

        오늘까지만 허용. 위반 시 422.
        (field_validator = 필드 하나만 보는 검증)
        """
        if v > dt.date.today():
            raise ValueError("미래 날짜는 기록할 수 없습니다")
        return v

    @model_validator(mode="after")
    def check_blood_pressure(self):
        """여러 필드 교차 검증: 수축기 <= 이완기이면 거부한다.

        혈압은 항상 수축기 > 이완기여야 하므로 두 값을 함께 본다.
        (model_validator = 필드끼리 비교할 때 사용) 위반 시 422.
        """
        if self.systolic <= self.diastolic:
            raise ValueError("수축기 혈압은 이완기 혈압보다 커야 합니다")
        return self


class HealthLogCreate(HealthLogBase):
    """기록 생성(POST) 시 받는 입력 형식.

    Base와 완전히 동일하지만, '생성 요청'이라는 의미를 위해
    별도 이름으로 둔다. 나중에 생성 전용 규칙이 생기면 여기에 추가.
    사용처: main.py create_log의 payload
    """
    pass


class HealthLogUpdate(BaseModel):
    """기록 수정(PATCH) 시 받는 입력 형식. 모든 필드가 선택.

    보낸 항목만 반영하기 위해 전부 Optional로 둔다.
    main.py에서 model_dump(exclude_unset=True)로
    '실제로 보낸 필드'만 골라 덮어쓴다.
    사용처: main.py update_log의 payload
    """
    date: dt.date | None = None
    weight: float | None = Field(None, gt=0, lt=500)
    height: float | None = Field(None, gt=50, lt=300)
    systolic: int | None = Field(None, ge=60, le=180)
    diastolic: int | None = Field(None, ge=40, le=120)
    blood_sugar: int | None = Field(None, ge=40, le=400)
    steps: int | None = Field(None, ge=0, le=30000)
    sleep_hours: float | None = Field(None, ge=0, le=24)
    memo: str | None = Field(None, max_length=500)

    @field_validator("weight", "height", "sleep_hours")
    @classmethod
    def one_decimal(cls, v: float | None) -> float | None:
        """소수점 한 자리로 반올림 (Base와 동일 규칙)."""
        return None if v is None else round(v, 1)


class HealthLogOut(HealthLogBase):
    """기록 조회/응답 시 내보내는 출력 형식.

    Base의 원본 필드 + DB에서 온 id/시각 + 서버가 계산한 필드로 구성.
    from_attributes=True 덕분에 DB 객체(HealthLog)를 그대로 넣으면
    자동으로 이 형식의 JSON으로 변환된다.

    핵심: bmi/분류/warnings는 DB에 저장하지 않고
          아래 computed_field가 '응답을 만들 때마다' 계산한다.
          (기준이 바뀌어도 과거 데이터가 틀려지지 않게 하기 위함)
    사용처: 거의 모든 logs 관련 라우트의 response_model
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: dt.datetime
    updated_at: dt.datetime | None

    # ---- 서버가 계산해서 응답에 추가하는 필드 ----
    # computed_field: DB엔 없지만 응답 JSON엔 자동으로 포함되는 값

    @computed_field
    @property
    def bmi(self) -> float:
        """이 기록의 BMI. weight/height로 매번 계산."""
        return calc_bmi(self.weight, self.height)

    @computed_field
    @property
    def bmi_category(self) -> str:
        """BMI 분류명 (저체중/정상/과체중/비만)."""
        return classify_bmi(self.bmi)

    @computed_field
    @property
    def bp_category(self) -> str:
        """혈압 분류명 (정상/주의/고혈압)."""
        return classify_bp(self.systolic, self.diastolic)

    @computed_field
    @property
    def sugar_category(self) -> str:
        """혈당 분류명 (정상/공복혈당장애/당뇨 의심)."""
        return classify_sugar(self.blood_sugar)

    @computed_field
    @property
    def warnings(self) -> list[str]:
        """위 세 분류를 종합한 경고 목록. 위험 없으면 []."""
        return build_warnings(self.bmi_category, self.bp_category, self.sugar_category)


# ---------- 사용자 ----------

class UserCreate(BaseModel):
    """회원가입 입력.

    password는 bcrypt 제한(72바이트) 때문에 상한을 둔다.
    사용처: main.py register의 payload
    """
    email: EmailStr
    nickname: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=72)


class Token(BaseModel):
    """로그인 성공 시 발급되는 토큰.

    클라이언트는 이후 요청 헤더에
    Authorization: Bearer <access_token> 형태로 담아 보낸다.
    """
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """사용자 조회/응답 시 내보내는 출력.

    비밀번호 같은 민감 정보는 애초에 없지만, 응답 형식을 따로 두어
    '내보낼 필드'를 명시적으로 통제한다.
    사용처: users 관련 라우트의 response_model
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    nickname: str
    created_at: dt.datetime


# ---------- 통계 ----------

class StatsOut(BaseModel):
    """통계(GET /stats) 응답 형식.

    평균값들은 기록이 0건일 때 계산할 수 없으므로 None을 허용한다.
    (None을 허용하지 않으면 빈 사용자 통계에서 오류가 난다)
    사용처: main.py get_stats의 response_model
    """
    count: int
    avg_weight: float | None
    avg_bmi: float | None
    avg_systolic: float | None
    avg_diastolic: float | None
    avg_blood_sugar: float | None