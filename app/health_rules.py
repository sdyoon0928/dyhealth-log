"""건강 수치 분류 로직 모음.

이 파일은 '판정 규칙'만 담당한다. DB나 FastAPI와는 무관하며,
순수하게 숫자를 받아 문자열(분류명)이나 경고 목록을 돌려준다.

이렇게 분리한 이유:
- 분류 기준(BMI 구간 등)은 가이드라인 개정으로 바뀔 수 있다.
  기준이 바뀌어도 이 파일만 고치면 되고, 라우트/스키마는 안 건드린다.
- 규칙만 따로 있으니 테스트하기도 쉽다.

주 사용처: schemas.py의 HealthLogOut (응답을 만들 때 호출)
          main.py의 get_stats (평균 BMI 계산 시 calc_bmi 호출)
"""


def calc_bmi(weight: float, height_cm: float) -> float:
    """몸무게와 키로 BMI를 계산한다.

    공식: BMI = 체중(kg) / 키(m)^2
    키는 cm로 들어오므로 100으로 나눠 m로 바꾼 뒤 계산한다.
    결과는 소수 첫째 자리로 반올림한다.

    사용처: HealthLogOut.bmi, get_stats의 avg_bmi
    예) calc_bmi(68.5, 170) -> 23.7
    """
    height_m = height_cm / 100
    return round(weight / (height_m ** 2), 1)


def classify_bmi(bmi: float) -> str:
    """BMI 수치를 '저체중/정상/과체중/비만' 중 하나로 분류한다.

    구간(아시아-태평양 기준):
      18.5 미만        -> 저체중
      18.5 ~ 22.9      -> 정상
      23   ~ 24.9      -> 과체중
      25   이상        -> 비만

    사용처: HealthLogOut.bmi_category
    """
    if bmi < 18.5:
        return "저체중"
    if bmi < 23:
        return "정상"
    if bmi < 25:
        return "과체중"
    return "비만"


def classify_bp(systolic: int, diastolic: int) -> str:
    """수축기·이완기 혈압을 '정상/주의/고혈압'으로 분류한다.

    구간:
      수축기 < 120 그리고 이완기 < 80  -> 정상
      120~139 또는 80~89              -> 주의
      수축기 >= 140 또는 이완기 >= 90  -> 고혈압

    ⚠️ 반드시 높은 단계(고혈압)부터 검사한다.
       '정상'을 먼저 판정하면 한쪽만 높은 값
       (예: 수축기 150 / 이완기 70)이 '주의'로 잘못 분류된다.

    사용처: HealthLogOut.bp_category
    """
    # 높은 단계부터 검사해야 함
    if systolic >= 140 or diastolic >= 90:
        return "고혈압"
    if systolic < 120 and diastolic < 80:
        return "정상"
    return "주의"


def classify_sugar(blood_sugar: int) -> str:
    """공복 혈당을 '정상/공복혈당장애/당뇨 의심'으로 분류한다.

    구간:
      100 미만    -> 정상
      100 ~ 125   -> 공복혈당장애
      126 이상    -> 당뇨 의심

    사용처: HealthLogOut.sugar_category
    """
    if blood_sugar < 100:
        return "정상"
    if blood_sugar <= 125:
        return "공복혈당장애"
    return "당뇨 의심"


def build_warnings(bmi_cat: str, bp_cat: str, sugar_cat: str) -> list[str]:
    """세 분류 결과를 받아, 위험 항목에 대한 경고 문구 목록을 만든다.

    - 체중이 저체중/비만이면 경고 추가
    - 혈압이 정상이 아니면 경고 추가
    - 혈당이 정상이 아니면 경고 추가
    - 경고가 하나라도 있으면 마지막에 전문가 진료 권고를 덧붙인다
    - 해당 없으면 빈 목록 [] 반환

    사용처: HealthLogOut.warnings
    """
    warnings: list[str] = []

    if bmi_cat in ("저체중", "비만"):
        warnings.append(f"체중 상태가 '{bmi_cat}' 구간입니다.")
    if bp_cat != "정상":
        warnings.append(f"혈압이 '{bp_cat}' 구간입니다.")
    if sugar_cat != "정상":
        warnings.append(f"공복혈당이 '{sugar_cat}' 구간입니다.")

    if warnings:
        warnings.append("정확한 판단은 의료 전문가의 진료가 필요합니다.")
    return warnings