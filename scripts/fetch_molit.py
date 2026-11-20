"""공공데이터포털 국토교통부 아파트 매매·전월세 실거래가 API -> docs/data.js

GitHub Actions가 매달 실행합니다. 직접 실행할 때:
    DATA_GO_KR_KEY=인증키 python3 scripts/fetch_molit.py

- 인증키는 공공데이터포털의 '일반 인증키(Decoding)' 값을 쓰세요.
- 매번 config.json의 start_ym부터 지난달·이번달까지 전부 다시 받습니다.
  (늦게 신고된 거래, 해제된 거래가 자동으로 반영되도록)
"""
import json, os, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
RENT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"


def month_list(start_ym):
    y, m = int(start_ym[:4]), int(start_ym[4:])
    today = date.today()
    out = []
    while (y, m) <= (today.year, today.month):
        out.append(f"{y}{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def call(url, key, lawd, ym):
    """한 구·한 달 자료를 페이지를 넘기며 모두 받는다."""
    items, page = [], 1
    while True:
        q = urllib.parse.urlencode({"serviceKey": key, "LAWD_CD": lawd, "DEAL_YMD": ym,
                                    "pageNo": page, "numOfRows": 1000})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(f"{url}?{q}", timeout=60) as r:
                    body = r.read()
                break
            except Exception as e:  # 일시 오류는 잠깐 쉬고 다시
                if attempt == 3:
                    raise
                print(f"  재시도 {lawd} {ym} p{page}: {e}", file=sys.stderr)
                time.sleep(3 * (attempt + 1))
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


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        sys.exit("DATA_GO_KR_KEY 환경변수(공공데이터포털 인증키)가 없습니다.")
    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    months = month_list(cfg["start_ym"])

    complexes, cx_list = {}, []

    def cx_index(sido, gu, dong, name, built):
        k = (gu, dong, name)
        if k not in complexes:
            complexes[k] = len(cx_list)
            cx_list.append([name, sido, gu, dong, built])
        return complexes[k]

    sale, jeonse = [], []
    for sido, gus in cfg["regions"].items():
        for gu, lawd in gus.items():
            for ym in months:
                tr = call(TRADE_URL, key, lawd, ym)
                for it in tr:
                    if it.get("cdealType", "").strip():      # 해제된 거래 제외
                        continue
                    if it.get("dealingGbn", "") == "직거래":  # 직거래 제외
                        continue
                    price, area = num(it.get("dealAmount")), num(it.get("excluUseAr"))
                    if price is None or area is None:
                        continue
                    i = cx_index(sido, gu, it.get("umdNm", ""), it.get("aptNm", ""), it.get("buildYear", ""))
                    sale.append([i, round(area, 2), int(it["dealYear"]) * 100 + int(it["dealMonth"]),
                                 int(it["dealDay"]), int(price), int(num(it.get("floor")) or 0)])
                rt = call(RENT_URL, key, lawd, ym)
                for it in rt:
                    if (num(it.get("monthlyRent")) or 0) > 0:  # 월세 제외, 전세만
                        continue
                    dep, area = num(it.get("deposit")), num(it.get("excluUseAr"))
                    if dep is None or area is None:
                        continue
                    i = cx_index(sido, gu, it.get("umdNm", ""), it.get("aptNm", ""), it.get("buildYear", ""))
                    jeonse.append([i, round(area, 2), int(it["dealYear"]) * 100 + int(it["dealMonth"]),
                                   int(it["dealDay"]), int(dep), int(num(it.get("floor")) or 0),
                                   1 if it.get("contractType", "") == "갱신" else 0])
                print(f"{gu} {ym}: 매매 {len(tr)}건, 전월세 {len(rt)}건")
                time.sleep(0.3)

    data = {"complexes": cx_list, "sale": sale, "jeonse": jeonse,
            "updated": date.today().isoformat(), "source": "공공데이터포털 국토교통부 실거래가 API"}
    with open(os.path.join(ROOT, "docs", "data.js"), "w", encoding="utf-8") as f:
        f.write("window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"완료: 단지 {len(cx_list)}개, 매매 {len(sale)}건, 전세 {len(jeonse)}건")


if __name__ == "__main__":
    main()
