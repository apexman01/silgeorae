"""시험판: K-apt 사용승인일 전체(YYYYMMDD) 받기 -> data/master/kapt_usedate.json

정식 fetch_hh.py는 사용승인일을 연도(4자리)만 저장해서, '준공 연월 <= 자료 기준월' 판단을 못 함.
그래서 시험판에서만 단지 마스터(docs/beta/data/master/complexes.json)의 K-apt 코드 중
최근 준공(K-apt 연도 2024 이후)이거나 아직 연월을 모르는 단지만 골라 기본정보를 다시 받아 날짜 전체를 저장.
fetch_hh.py의 API 함수를 그대로 가져다 씀(그 파일은 고치지 않음). 키가 없거나 실패하면 건너뜀.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_hh as H

ROOT = H.ROOT
OUT = os.path.join(ROOT, "data", "master", "kapt_usedate.json")
MASTER = os.path.join(ROOT, "docs", "beta", "data", "master", "complexes.json")


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        print("DATA_GO_KR_KEY 없음 - 건너뜀"); return
    basic = json.load(open(H.CACHE, encoding="utf-8")) if os.path.exists(H.CACHE) else {}
    old = json.load(open(OUT, encoding="utf-8")).get("단지", {}) if os.path.exists(OUT) else {}
    codes = set()
    for x in json.load(open(MASTER, encoding="utf-8"))["단지"]:
        for k in x.get("kapt") or []:
            y = (basic.get(k["코드"]) or {}).get("use") or ""
            if k["코드"] not in old and (not y or int(y) >= 2024):
                codes.add(k["코드"])
    codes = sorted(codes)
    print(f"사용승인일 받을 단지: {len(codes)}개 (저장된 것 {len(old)}개)")
    if not codes:
        return
    api = H.pick_api(H.BASIC_APIS, {"serviceKey": key, "kaptCode": codes[0], "_type": "json"}, "기본정보", need="kaptUsedate")
    if not api:
        print("기본 정보 API를 쓸 수 없어요 - 건너뜀"); return
    got = 0
    for c in codes:
        try:
            items, _ = H.get_items(api, {"serviceKey": key, "kaptCode": c, "_type": "json"})
            d = str((items[0] if items else {}).get("kaptUsedate") or "").strip()
            if len(d) >= 6 and d[:6].isdigit():
                old[c] = d[:8]; got += 1
        except Exception as e:
            print(f"  실패 {c}: {str(e)[:120]}")
    out = {"설명": "K-apt 기본정보 kaptUsedate(사용승인일) 전체. scripts/fetch_usedate_beta.py가 만듦. 시험판 사이클 분류(준공 연월 <= 자료 기준월)에 씀.",
           "출처": ["국토부 공동주택 기본 정보제공 서비스(K-apt, apis.data.go.kr)"], "만든곳": "scripts/fetch_usedate_beta.py",
           "단지": dict(sorted(old.items()))}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"저장: {OUT} (새로 {got}개, 전체 {len(old)}개)")


if __name__ == "__main__":
    main()
