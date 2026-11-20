"""공공데이터포털 국토교통부 실거래가 API -> docs/data.js

받는 자료 (구마다):
  - 아파트 매매            RTMSDataSvcAptTrade
  - 아파트 전월세 (전세만)  RTMSDataSvcAptRent
  - 아파트 분양권·입주권    RTMSDataSvcSilvTrade   (활용신청 안 했으면 자동으로 건너뜀)

빠르게 돌도록 받은 자료를 data/cache/ 에 구·종류별로 저장해 두고,
매번 '최근 REFRESH_MONTHS개월'과 '아직 안 받은 달'만 새로 받습니다.
(늦게 신고된 거래·해제 거래는 신고 기한이 30일이라 최근 몇 달만 다시 받으면 충분)

직접 실행:  DATA_GO_KR_KEY=인증키 python3 scripts/fetch_molit.py
처음부터 전부 다시 받기:  FULL_REFRESH=1 ... (또는 data/cache 폴더 삭제)
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache")
REFRESH_MONTHS = 4
APIS = {
    "sale":    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    "rent":    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    "presale": "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade",
}
OPTIONAL = {"presale"}   # 이 API는 실패해도 전체를 멈추지 않음


class NotRegistered(Exception):
    pass


def month_list(start_ym):
    y, m = int(start_ym[:4]), int(start_ym[4:])
    t = date.today()
    out = []
    while (y, m) <= (t.year, t.month):
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def call(url, key, lawd, ym):
    """한 구·한 달 자료를 페이지를 넘기며 모두 받는다."""
    items, page = [], 1
    while True:
        q = urllib.parse.urlencode({"serviceKey": key, "LAWD_CD": lawd, "DEAL_YMD": ym,
                                    "pageNo": page, "numOfRows": 1000})
        body = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(f"{url}?{q}", timeout=40) as r:
                    body = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    raise NotRegistered(f"HTTP {e.code}")
                err = e
            except Exception as e:
                err = e
            print(f"  재시도 {lawd} {ym} p{page}: {err}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
        if body is None:
            raise RuntimeError(f"응답 없음 {lawd} {ym}")
        text = body.decode("utf-8", "ignore")
        if "SERVICE_KEY_IS_NOT_REGISTERED" in text or "SERVICE ACCESS DENIED" in text.upper():
            raise NotRegistered(text[:200])
        root = ET.fromstring(body)
        code = (root.findtext(".//resultCode") or "").strip()
        if code not in ("00", "000"):
            raise RuntimeError(f"API 오류 {code}: {root.findtext('.//resultMsg')} ({lawd} {ym})")
        batch = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
        items += batch
        total = int(root.findtext(".//totalCount") or 0)
        if page * 1000 >= total or not batch:
            return items
        page += 1


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def slim(kind, it):
    """캐시에 저장할 필요한 항목만 남긴다."""
    keep = ["aptNm", "umdNm", "buildYear", "excluUseAr", "dealYear", "dealMonth", "dealDay", "floor"]
    if kind == "sale":
        keep += ["dealAmount", "cdealType", "dealingGbn"]
    elif kind == "rent":
        keep += ["deposit", "monthlyRent", "contractType"]
    else:
        keep += ["dealAmount", "cdealType", "dealingGbn", "ownershipGbn"]
    return {k: it.get(k, "") for k in keep}


def load_cache(lawd, kind):
    p = os.path.join(CACHE, f"{lawd}_{kind}.json")
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}


def save_cache(lawd, kind, data):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f"{lawd}_{kind}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        sys.exit("DATA_GO_KR_KEY 환경변수(공공데이터포털 인증키)가 없습니다.")
    full = os.environ.get("FULL_REFRESH") == "1"
    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    months = month_list(cfg["start_ym"])
    recent = set(months[-REFRESH_MONTHS:])
    skipped = set()

    for sido, gus in cfg["regions"].items():
        for gu, lawd in gus.items():
            for kind, url in APIS.items():
                if kind in skipped:
                    continue
                cache = {} if full else load_cache(lawd, kind)
                todo = [m for m in months if m not in cache or m in recent]
                got = 0
                try:
                    for ym in todo:
                        cache[ym] = [slim(kind, it) for it in call(url, key, lawd, ym)]
                        got += len(cache[ym])
                        time.sleep(0.2)
                except NotRegistered as e:
                    if kind in OPTIONAL:
                        print(f"※ {kind} API 사용 권한 없음 → 건너뜀 (공공데이터포털 활용신청 필요): {e}")
                        skipped.add(kind)
                        continue
                    raise
                except Exception as e:
                    if kind in OPTIONAL:
                        print(f"※ {gu} {kind} 받기 실패 → 이번엔 건너뜀: {e}")
                        continue
                    raise
                # 설정 기간 밖의 달은 버림
                cache = {m: v for m, v in cache.items() if m in set(months)}
                save_cache(lawd, kind, cache)
                print(f"{gu} {kind}: {len(todo)}개월 새로 받음({got}건), 저장 {len(cache)}개월")

    build(cfg, months)


def build(cfg, months):
    complexes, cx_list = {}, []

    def cx_index(sido, gu, it):
        k = (gu, it.get("umdNm", ""), it.get("aptNm", ""))
        if k not in complexes:
            complexes[k] = len(cx_list)
            cx_list.append([k[2], sido, gu, k[1], it.get("buildYear", "")])
        elif not cx_list[complexes[k]][4] and it.get("buildYear"):
            cx_list[complexes[k]][4] = it.get("buildYear")
        return complexes[k]

    def ymd(it):
        return int(it["dealYear"]) * 100 + int(it["dealMonth"]), int(it["dealDay"])

    sale, jeonse, presale = [], [], []
    for sido, gus in cfg["regions"].items():
        for gu, lawd in gus.items():
            for ym in months:
                for it in load_cache(lawd, "sale").get(ym, []):
                    if it.get("cdealType", "").strip() or it.get("dealingGbn") == "직거래":
                        continue
                    p, a = num(it.get("dealAmount")), num(it.get("excluUseAr"))
                    if p is None or a is None:
                        continue
                    m, d = ymd(it)
                    sale.append([cx_index(sido, gu, it), round(a, 2), m, d, int(p), int(num(it.get("floor")) or 0)])
                for it in load_cache(lawd, "rent").get(ym, []):
                    if (num(it.get("monthlyRent")) or 0) > 0:
                        continue
                    p, a = num(it.get("deposit")), num(it.get("excluUseAr"))
                    if p is None or a is None:
                        continue
                    m, d = ymd(it)
                    jeonse.append([cx_index(sido, gu, it), round(a, 2), m, d, int(p), int(num(it.get("floor")) or 0),
                                   1 if it.get("contractType") == "갱신" else 0])
                for it in load_cache(lawd, "presale").get(ym, []):
                    if it.get("cdealType", "").strip() or it.get("dealingGbn") == "직거래":
                        continue
                    p, a = num(it.get("dealAmount")), num(it.get("excluUseAr"))
                    if p is None or a is None:
                        continue
                    m, d = ymd(it)
                    kind = 1 if "입" in it.get("ownershipGbn", "") else 0   # 0 분양권, 1 입주권
                    presale.append([cx_index(sido, gu, it), round(a, 2), m, d, int(p), int(num(it.get("floor")) or 0), kind])

    data = {"complexes": cx_list, "sale": sale, "jeonse": jeonse, "presale": presale,
            "updated": date.today().isoformat(), "source": "공공데이터포털 국토교통부 실거래가 API"}
    with open(os.path.join(ROOT, "docs", "data.js"), "w", encoding="utf-8") as f:
        f.write("window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"완료: 단지 {len(cx_list)}개, 매매 {len(sale)}건, 전세 {len(jeonse)}건, 분양권·입주권 {len(presale)}건")


if __name__ == "__main__":
    main()
