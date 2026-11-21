"""구별 현황 숫자 -> docs/data/gustats.js

  - 84㎡ 중간 거래가: 최근 6개월 매매(전용 80~90㎡ 미만, 해제·직거래 제외 = 이미 빠진 자료) 거래가의 중앙값
  - 1년 상승률: 같은 6개월 구간을 1년 전과 비교한 중앙값 변화
  - 서울 순위: 84㎡ 중간 거래가 높은 순
  - 인구: 행정안전부 주민등록 인구(공공데이터포털 '법정동별(행정동 통반단위) 주민등록 인구 및 세대현황')
          인증키·활용신청이 없거나 실패하면 이전 값을 그대로 둠
실거래가 자료(docs/data/<코드>.js)만 읽고 그 형식은 바꾸지 않습니다.
"""
import json, os, re, statistics, urllib.parse, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs", "data")
OUT = os.path.join(DOCS, "gustats.js")
WIN = 6
POP_APIS = [
    "https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus",
]


def load_js(path):
    t = open(path, encoding="utf-8").read()
    m = re.search(r'=\s*(\{.*\})\s*;?\s*$', t, re.S)
    return json.loads(m.group(1))


def shift(ym, k):
    y, m = int(ym[:4]), int(ym[4:])
    m += k
    while m <= 0:
        m += 12; y -= 1
    while m > 12:
        m -= 12; y += 1
    return f"{y}{m:02d}"


def prev_out():
    if not os.path.exists(OUT):
        return {}
    try:
        return load_js(OUT)
    except Exception:
        return {}


def fetch_pop(key, regions):
    """구별 인구. 가장 최근 달부터 거꾸로 찾아본다."""
    out = {}
    if not key:
        print("인구: 인증키 없음 - 건너뜀"); return out
    t = date.today()
    for back in range(1, 4):
        ym = shift(f"{t.year}{t.month:02d}", -back)
        for api in POP_APIS:
            ok = 0
            for gu, code in regions.items():
                q = urllib.parse.urlencode({"serviceKey": key, "stdgCd": code + "00000", "srchFrYm": ym, "srchToYm": ym,
                                            "lv": "2", "regSeCd": "1", "type": "JSON", "numOfRows": 10, "pageNo": 1})
                try:
                    with urllib.request.urlopen(f"{api}?{q}", timeout=30) as r:
                        txt = r.read().decode("utf-8", "replace")
                    j = json.loads(txt)
                    items = (((j.get("Response") or j.get("response") or {}).get("items") or {}).get("item")) or []
                    if isinstance(items, dict):
                        items = [items]
                    tot = sum(int(str(i.get("totNmprCnt") or 0).replace(",", "")) for i in items)
                    if tot:
                        out[gu] = [tot, ym]; ok += 1
                    elif ok == 0 and gu == next(iter(regions)):
                        print(f"인구 {api} {ym}: 빈 응답 {txt[:200]}")
                        break
                except Exception as e:
                    msg = ""
                    if hasattr(e, "read"):
                        try: msg = e.read().decode("utf-8", "replace")[:200]
                        except Exception: pass
                    print(f"인구 {api} {ym} {gu}: {e} {msg}")
                    break
            if ok:
                print(f"인구: {ym} 기준 {ok}개 구 ({api})")
                return out
    return out


def main():
    idx = load_js(os.path.join(DOCS, "index.js"))
    regions = {}
    for sido, gus in idx["regions"].items():
        regions.update(gus)
    stats = {}
    last = max(idx["months"]) if idx.get("months") else None
    for gu, code in regions.items():
        p = os.path.join(DOCS, f"{code}.js")
        if not os.path.exists(p):
            continue
        d = load_js(p)
        sale = [r for r in d["sale"] if 80 <= r[1] < 90]
        if not last:
            last = max(str(r[2]) for r in d["sale"])
        lo, hi = shift(str(last), -(WIN - 1)), str(last)
        plo, phi = shift(lo, -12), shift(hi, -12)
        cur = [r[4] for r in sale if lo <= str(r[2]) <= hi]
        pre = [r[4] for r in sale if plo <= str(r[2]) <= phi]
        if not cur:
            continue
        med = statistics.median(cur)
        o = {"med": round(med), "n": len(cur)}
        if len(pre) >= 5:
            pm = statistics.median(pre)
            o["prev"] = round(pm); o["chg"] = round((med / pm - 1) * 100, 1)
        stats[gu] = o
    for i, gu in enumerate(sorted(stats, key=lambda g: -stats[g]["med"]), 1):
        stats[gu]["rank"] = i

    old = prev_out()
    pop = fetch_pop(os.environ.get("DATA_GO_KR_KEY", "").strip(), regions) or old.get("pop", {})
    lo = shift(str(last), -(WIN - 1))
    res = {"from": lo, "to": str(last), "win": WIN, "total": len(stats), "gu": stats, "pop": pop}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 구별 현황 숫자 - scripts/build_stats.py 가 만듦\n")
        f.write("window.GUSTATS = " + json.dumps(res, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"저장: {OUT} - {len(stats)}개 구, 인구 {len(pop)}개 구, 기간 {lo}~{last}")


if __name__ == "__main__":
    main()
