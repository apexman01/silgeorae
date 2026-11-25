# 비상한 아파트 생활권 — Claude 작업 지침

서울 25개 구·생활권 100개의 아파트 실거래가를 그래프로 보는 사이트.
주소 apexman01.github.io/silgeorae · 국토부 API로 GitHub Actions가 매달 자동 갱신.
파일 구성·버전 관리는 README.md 참고.

## 작업 원칙
- 새 기능·수정은 `/beta/`(docs/beta) 시험판에서 먼저 → 사용자가 확인한 뒤에 정식 반영
- v1 고정판(docs/v1, 브랜치 v1)은 건드리지 않음
- `docs/data/` 자료 형식은 바꾸지 않음 (새 기능 자료는 새 파일로 추가)
- 버그는 원인부터 3줄 보고 → 사용자 OK 후 수정
- 바뀐 부분만 수정, 파일 전체 재작성 금지
- 휴대폰 화면 기준 디자인
- 답변은 결론 먼저, 짧게, 한국어로
- 시세 요약 파일 구조(항목 이름)를 바꿀 때는 먼저 보고 (임장기록 프로젝트 지침과 연결됨)

## 현재 상태 (작업 끝날 때마다 갱신)
- 인구 정보 사라짐 버그 수정(build_stats.py) 정식 반영 완료 → 다음 자동 갱신 결과 확인 대기
- 시세 요약 파일 시험판 완성(커밋 55db7db): `scripts/build_summary.js` → `docs/beta/data/summary/구코드.json`
  - 공개 주소에서 열림 확인 완료 (2026-11-25, 11740 강동구)
  - 남은 일: 사용자가 임장기록 프로젝트에서 테스트 후 OK하면 정식 반영
    `node scripts/build_summary.js --out docs/data/summary --no-patch` + `.github/workflows/update.yml`에 요약 생성 단계 추가

- 시험판 새 화면(2026-11-25, 커밋 c387bf9): 서울 지도 홈(home.html)·상승/하락(cycle.html)·내 집 진단(mine.html)·시세 그룹(group.html)·공통 아래 메뉴(nav.js)
  - 자료: `node scripts/build_beta.js` → `docs/beta/data/x/` (아직 자동 갱신 미연결)
  - 사용자 확인 대기 → OK 후 정식 반영 방법 결정

## 로드맵
1. 하락기/상승기(시험판 완료) 2. 규제탐색기 3. 생활권 요약 4. 교통1·2 5. 내 집 진단(시험판 완료)
6. 앱 출시: PWA(홈 화면 설치) → 앱스토어 등록

## 참고
- 이 작업 환경에서는 github.io 직접 접속이 막혀 있음 → 공개 주소 확인은 Firecrawl 등 외부 도구 사용
