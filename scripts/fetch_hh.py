"""공동주택(K-apt) 단지 세대수 -> docs/data/hh.js

  1) 단지 목록제공 서비스: 구마다 단지코드·단지명·법정동
  2) 기본 정보제공 서비스: 단지코드마다 세대수·사용승인일
결과: window.HH = { "송파구": [[단지명, 법정동, 세대수, 사용승인년], ...], ... }

이미 받은 단지는 data/cache/hh_basic.json 에 저장해 두고 새 단지만 받습니다.
API 주소는 버전이 자주 바뀌어서 후보를 차례로 시도합니다(어느 것이 됐는지 로그에 남김).
이 스크립트가 실패해도 실거래가 갱신은 멈추지 않습니다(워크플로에서 continue-on-error).
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "hh_basic.json")
LIST_CACHE = os.path.join(ROOT, "data", "cache", "hh_list.json")
OUT = os.path.join(ROOT, "docs", "data", "hh.js")

LIST_APIS = [
    "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3",
    "https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4",
    "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList",
    "https://apis.data.go.kr/1613000/AptListService2/getSigunguAptList",
    "https://apis.data.go.kr/1611000/AptListService/getSigunguAptList",
]
BASIC_APIS = [
    "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4",
    "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5",
    "https://apis.data.go.kr/1613000/AptBasisInfoServiceV3/getAphusBassInfoV3",
    "https://apis.data.go.kr/1613000/AptBasisInfoService1/getAphusBassInfo",
    "https://apis.data.go.kr/1611000/AptBasisInfoService/getAphusBassInfo",
]


def get_items(url, params):
    """JSON이든 XML이든 item 목록과 totalCount를 돌려준다. 실패하면 예외."""
    q = urllib.parse.urlencode(params)
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=30) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            msg = ""
            try: msg = e.read().decode("utf-8", "replace")[:300].replace("\n", " ")
            except Exception: pass
            raise RuntimeError(f"HTTP {e.code} {msg}")
        except Exception as e:   # 일시 오류는 다시
            last = e
        time.sleep(1.5 * (attempt + 1))
    else:
        raise RuntimeError(f"연결 실패: {last}")
    txt = body.decode("utf-8", "replace").strip()
    if txt.startswith("{"):
        j = json.loads(txt)
        resp = j.get("response", j)
        hdr = resp.get("header", {})
        if hdr.get("resultCode") not in (None, "00", "000"):
            raise RuntimeError(f"결과 오류 {hdr.get('resultCode')} {hdr.get('resultMsg')}")
        bodyj = resp.get("body", {}) or {}
        items = bodyj.get("items", [])
        if isinstance(items, dict):
            items = items.get("item", [])
        if isinstance(items, dict):
            items = [items]
        if not items and isinstance(bodyj.get("item"), dict):
            items = [bodyj["item"]]
        return items or [], int(bodyj.get("totalCount") or len(items or []))
    root = ET.fromstring(txt)
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code not in (None, "00", "000"):
        raise RuntimeError(f"결과 오류 {code} {root.findtext('.//resultMsg') or root.findtext('.//returnAuthMsg')}")
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    return items, int(root.findtext(".//totalCount") or len(items))


def pick_api(cands, params, label, need=None):
    for u in cands:
        for drop in (False, True):
            p = {k: v for k, v in params.items() if not (drop and k == "_type")}
            try:
                items, _ = get_items(u, p)
                if need and not any(need in it for it in items):
                    print(f"[{label}] {u}: '{need}' 항목 없음 -> 다음 후보 (항목: {sorted(items[0].keys()) if items else '-'})")
                    break
                print(f"[{label}] 사용: {u} ({len(items)}건){' (_type 없이)' if drop else ''}")
                return u
            except Exception as e:
                print(f"[{label}] 안 됨: {u}{' (_type 없이)' if drop else ''} -> {e}")
    return None


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        print("DATA_GO_KR_KEY 없음 - 건너뜀"); return
    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    regions = {}   # 구 이름 -> 시군구코드
    for sido, gus in cfg["regions"].items():
        for gu, code in gus.items():
            regions[gu] = str(code)

    first = next(iter(regions.values()))
    list_api = pick_api(LIST_APIS, {"serviceKey": key, "sigunguCode": first, "pageNo": 1, "numOfRows": 10, "_type": "json"}, "단지목록")
    if not list_api:
        print("단지 목록 API를 쓸 수 없어요(활용신청 확인)."); sys.exit(1)

    # 1) 단지 목록
    lists = {}
    for gu, code in regions.items():
        out, page = [], 1
        while True:
            items, total = get_items(list_api, {"serviceKey": key, "sigunguCode": code, "pageNo": page, "numOfRows": 1000, "_type": "json"})
            out += items
            if len(out) >= total or not items:
                break
            page += 1
        lists[gu] = [{"code": i.get("kaptCode"), "name": i.get("kaptName"), "dong": i.get("as3") or i.get("as4") or "", "bjd": i.get("bjdCode", "")} for i in out if i.get("kaptCode")]
        print(f"{gu}: 단지 {len(lists[gu])}개")
    os.makedirs(os.path.dirname(LIST_CACHE), exist_ok=True)
    json.dump(lists, open(LIST_CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    # 2) 기본정보 (새 단지만)
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    todo = [x["code"] for l in lists.values() for x in l if not (cache.get(x["code"]) or {}).get("cnt")]
    print(f"기본정보 새로 받을 단지: {len(todo)}개 (저장된 것 {len(cache)}개)")
    if todo:
        basic_api = pick_api(BASIC_APIS, {"serviceKey": key, "kaptCode": todo[0], "_type": "json"}, "기본정보", need="kaptdaCnt")
        if not basic_api:
            print("기본 정보 API를 쓸 수 없어요(활용신청 확인).")
        else:
            def one(code):
                try:
                    items, _ = get_items(basic_api, {"serviceKey": key, "kaptCode": code, "_type": "json"})
                    it = items[0] if items else {}
                    return code, {"cnt": int(float(it.get("kaptdaCnt") or it.get("hoCnt") or 0)),
                                  "use": str(it.get("kaptUsedate") or "")[:4], "name": it.get("kaptName", "")}
                except Exception as e:
                    return code, None
            fails = 0
            with ThreadPoolExecutor(6) as ex:
                for n, (code, v) in enumerate(ex.map(one, todo), 1):
                    if v is None:
                        fails += 1
                    else:
                        cache[code] = v
                    if n % 300 == 0:
                        print(f"  {n}/{len(todo)}")
                        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"기본정보 실패 {fails}개")
            json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    # 3) 사이트용 파일
    hh = {}
    for gu, l in lists.items():
        rows = []
        for x in l:
            b = cache.get(x["code"])
            if b and b["cnt"]:
                rows.append([x["name"], x["dong"], b["cnt"], b["use"]])
        hh[gu] = rows
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 공동주택(K-apt) 단지별 세대수 - scripts/fetch_hh.py 가 만듦\n")
        f.write("window.HH = " + json.dumps(hh, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"저장: {OUT} ({sum(len(v) for v in hh.values())}개 단지)")


if __name__ == "__main__":
    main()
