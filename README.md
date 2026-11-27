# 생활권별 아파트 실거래가 트렌드

서울 > 구 > 생활권을 골라 주요 단지의 월별 실거래가 추이를 그래프로 보는 사이트입니다.
국토교통부 실거래가 자료를 매달 자동으로 받아 갱신합니다. 만든이: 비상

## 파일 구성

| 파일 | 하는 일 |
|---|---|
| `docs/index.html` | 사이트 화면 |
| `docs/lifezones.js` | **생활권 설정** — 생활권 추가·수정은 이 파일만 고치면 됨 |
| `docs/data/` | 구별 실거래 자료 (자동으로 바뀜, 직접 고치지 않음) |
| `config.json` | 자동 수집할 구와 시작 월 |
| `scripts/fetch_molit.py` | 공공데이터포털 API에서 자료를 받는 스크립트 (매매·전세·분양권/입주권) |
| `data/cache/` | 받은 원자료 보관 (최근 4개월만 새로 받는 데 사용) |
| `scripts/build_from_csv.py` | (예비용) 실거래가 공개시스템 CSV로 자료 만들기 |
| `.github/workflows/update.yml` | 매월 3일 새벽 자동 실행 설정 |

## 버전 관리

| 주소 | 파일 | 용도 |
|---|---|---|
| `/silgeorae/` | `docs/index.html` | 기본 사이트 (검증된 기능만) |
| `/silgeorae/v1/` | `docs/v1/` | 버전 1 고정판 — 2026-11-27 시험판 전체(지도·시세 그룹·상승·하락·내 집·정비사업) 저장본. 화면은 그대로, `docs/data/` 실거래 자료만 매달 갱신 (`v1/data/`의 요약·지도·단지 지표는 저장 시점 그대로) |
| `/silgeorae/beta/` | `docs/beta/` | 시험판 — 새 기능은 여기서 먼저 만들고, 확인 후 기본 사이트에 반영 |

- 저장소 브랜치 `v1` = 2026-11-27 버전 1 상태(코드+자료) 저장본. 이 브랜치에는 커밋하지 않음. 문제가 생기면 여기로 되돌리거나 여기서 다시 시작.
- 예전 v1(2026-11-21)은 브랜치 `v1-backup-20261121`에 남겨 둠.
- 약속: `docs/data/` 자료 형식(complexes·sale·jeonse·presale 칸 순서)은 바꾸지 않음. 새 기능에 필요한 자료는 새 파일로 추가 → v1이 깨지지 않음.

## 시세 요약 파일 (임장기록용, 시험판)

- `scripts/build_summary.js` → `docs/beta/data/summary/구코드.json` (25개 구, 구당 약 15~20KB)
- 생활권별 단지의 세대수 순 목록, 59·84㎡ 최근 거래·12개월 최고가, 대표평형(거래 가장 많은 평형)
- 사이트와 같은 계산(단지 매칭·면적 구간·분양권/입주권 포함)을 쓰고, `docs/data/` 형식은 건드리지 않음
- 확인 뒤 정식 반영 시: `node scripts/build_summary.js --out docs/data/summary --no-patch` + 자동 갱신(update.yml)에 단계 추가
- 파일 구조(항목 이름)를 바꾸면 임장기록 프로젝트 지침도 같이 고쳐야 하므로 먼저 보고

## 시세 그룹 (시험판)

- 화면: `docs/beta/group.html` — 가용 금액(매매가 또는 투자금=매매−전세) 범위의 단지를 생활권 서열 순으로 모아 보기
- 자료: `docs/beta/data/x/cx.json` (build_beta.js). 예전 전세 자료 `data/group/jeonse.json`·`scripts/build_group.js`는 지금 쓰지 않음(삭제 후보)

## 새 화면 묶음 (시험판, 2026-11-25)

| 주소 | 파일 | 내용 |
|---|---|---|
| `/beta/home.html` | 서울 지도 | 25개 구 지도(84㎡ 시세·6개월 변화·전고점 대비·전세가율), 2021년~ 타임랩스 재생, 구를 누르면 시세 흐름·생활권 서열 |
| `/beta/cycle.html` | 상승·하락 | 구별·단지별 전고점(2021~22 최고)·전저점·지금 위치, 전고점 돌파/고점 아래 목록 |
| `/beta/mine.html` | 내 집 진단 | 단지 검색 → 시세·전세·갭·사이클·입지 서열·갈아타기 후보 |
| `/beta/group.html` | 시세 그룹 | 시세(4층 이상 최근 3건 중간)/최근 1건/내 호가, 서열 기준 2가지, 네이버 호가 링크 |

- 공통: `docs/beta/x.css`·`x.js`(모양·함수), `nav.js`(아래 메뉴, 생활권 그래프 화면에도 붙음)
- 자료: `node scripts/build_beta.js` → `docs/beta/data/x/` (map.json 지도 경계, gu.json 구별 월별, cx.json 단지 지표). 지도 경계 원본은 `data/geo/seoul_gu_2013.geojson`
- 자동 갱신: `.github/workflows/beta.yml`이 매달 실거래가 갱신(update.yml)이 끝나면 build_summary.js → build_beta.js 순으로 돌려 `docs/beta/data/summary`·`docs/beta/data/x`만 저장. 정식 반영 시에는 `--out docs/data/... --no-patch`로 따로 단계 추가

## 정비사업 카드 (시험판)

- 자료: 서울 열린데이터광장 「서울특별시 도시정비사업 통계」(OA-22856) 엑셀, 분기마다 갱신
- 새 엑셀이 나오면 `data/jb/`에 `YYYY-MM 서울시 정비사업 추진현황.xlsx` 이름으로 넣기 → 자동 갱신 때 `scripts/build_jb.py`가 `docs/data/jb.js`를 다시 만듦
- 생활권 연결: 구역 지번의 동 = 대표 단지가 있는 동이면 자동. 애매하면 `docs/lifezones.js`의 `jb`(구역명)·`jbDongs`(동)로 지정

## 처음 한 번 설정

1. **인증키 넣기**: 저장소 Settings > Secrets and variables > Actions > New repository secret
   - Name: `DATA_GO_KR_KEY`
   - Secret: 공공데이터포털 마이페이지의 **일반 인증키(Decoding)** 값
2. **사이트 켜기**: Settings > Pages > Source를 `Deploy from a branch`, Branch를 `main` / `/docs`로 저장
   - 몇 분 뒤 `https://아이디.github.io/저장소이름/` 주소로 열립니다.
3. **첫 자동 수집 돌려보기**: Actions 탭 > `실거래가 자동 갱신` > Run workflow

## 자주 하는 일

- **생활권 추가**: `docs/lifezones.js`를 열고 연필(Edit) 버튼 > 기존 생활권 블록을 복사해 이름과 단지명만 바꾸기 > Commit changes
  - 단지명은 사이트의 '＋ 단지 직접 고르기' 목록에 나오는 이름 그대로 적어야 합니다.
  - 띄어쓰기 차이는 자동으로 합쳐요. 이름이 아예 다르면 `"이스트폴|롯데캐슬 이스트폴"`처럼 `|`로 묶고, 같은 이름이 여러 동에 있으면 `"현대@마장동"`처럼 `@동`을 붙여요.
- **구 추가**: `config.json`의 `regions`에 `"성동구": "11200"`처럼 추가 (코드는 같은 파일의 코드표 참고). 다음 자동 실행 때부터 반영되고, 바로 보려면 Run workflow.
- **더 예전 자료부터 보기**: `config.json`의 `start_ym`을 바꾸기 (예: `"202401"`)

## 집계 기준

- 매매: 해제된 거래와 직거래는 제외
- 전세: 월세 제외. 그래프는 신규 계약만, 표에는 갱신 계약도 표시
- 면적: 59㎡(55~66), 74㎡(70~80), 84㎡(80~90), 100㎡+(95 이상)
- 회색 주석: 직전 달보다 2% 넘게 떨어졌지만 거래 1건이거나 3층 이하라 하락 신호가 약한 달
- 자료는 계약일 기준이며, 신고 기한(30일) 때문에 최근 1~2개월은 거래가 더 늘어날 수 있습니다.
