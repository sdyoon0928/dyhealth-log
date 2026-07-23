# MyHealth Log API

일일 건강 기록(체중·혈압·수면·걸음 수)을 관리하는 REST API입니다.

## 기술 스택
- FastAPI / SQLAlchemy 2.0 / PostgreSQL 16
- Docker & Docker Compose
- AWS Lightsail 배포

## 실행 방법
```bash
git clone <repo-url>
cd myhealth-log
cp .env.example .env
docker compose up --build
```
API 문서: http://localhost:4923/docs

## API 엔드포인트
| Method | Path | 설명 |
|---|---|---|
| GET | /health | 서버 상태 확인 |
| POST | /logs | 기록 생성 |
| GET | /logs | 기록 목록 (기간 필터, 페이징) |
| GET | /logs/{id} | 기록 단건 조회 |
| PATCH | /logs/{id} | 기록 수정 |
| DELETE | /logs/{id} | 기록 삭제 |

## 데이터 모델
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | int | PK |
| log_date | date | 기록 날짜 |
| weight_kg | float | 체중 |
| systolic / diastolic | int | 혈압 |
| sleep_hours | float | 수면 시간 |
| steps | int | 걸음 수 |
| memo | str(500) | 메모 |

## 배포
AWS Lightsail 인스턴스에서 Docker Compose로 실행.