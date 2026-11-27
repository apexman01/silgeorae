"""서울 열린데이터광장 '서울특별시 도시정비사업 통계'(OA-22856) 엑셀을 자동으로 받기 (시험판용)

- 자료 페이지에서 가장 최근 파일(예: '★(26년 6월기준) 서울시 정비사업 추진현황.xlsx')을 찾아 내려받음
- data/jb_auto/ 에 'YYYY-MM 서울시 정비사업 추진현황.xlsx' 이름으로 저장 (이미 있으면 받지 않음)
- 정식 사이트가 쓰는 data/jb/ 는 건드리지 않음 → 시험판은 build_jb.py --src data/jb_auto --out docs/beta/data/jb.js 로 따로 만듦
- 실패해도 워크플로는 멈추지 않음(continue-on-error). 원인은 로그에 남김
"""
import os, re, sys, json, functools
print = functools.partial(print, flush=True)
import builtins, urllib.request, urllib.parse, http.cookiejar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "jb_auto")
PAGE = "https://data.seoul.go.kr/dataList/OA-22856/F/1/datasetView.do"
INF_ID = "OA-22856"
UA = "Mozilla/5.0 (compatible; silgeorae-bot/1.0)"

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
opener.addheaders = [("User-Agent", UA), ("Referer", PAGE)]


def get(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    with opener.open(url, data=body, timeout=40) as r:
        return r.read(), r.headers


def ym_of(name):   # '★(26년 6월기준) …' → '2026-06'
    m = re.search(r"(\d{2})년\s*(\d{1,2})월", name)
    return f"20{m.group(1)}-{int(m.group(2)):02d}" if m else None


def main():
    html, _ = get(PAGE)
    html = html.decode("utf-8", "replace")
    # 1) 파일 목록과 내려받기 함수 인자 찾기
    rows = []
    for m in re.finditer(r"([^<>'\"]*정비사업[^<>'\"]*\.xlsx)", html):
        rows.append(m.group(1).strip())
    names = list(dict.fromkeys(rows))
    print("파일 이름 후보:", names[:5])
    calls = re.findall(r"""(\w*[dD]own\w*)\s*\(\s*([^)]{0,200})\)""", html)
    calls = [c for c in calls if re.search(r"\d", c[1])]
    print("내려받기 함수 호출 후보:", calls[:10])
    for kw in ["nio_download", "datafile.seoul.go.kr", "fileDown", "downloadFile", "seqNo", "infSeq"]:
        for m in re.finditer(re.escape(kw), html):
            s = html[max(0, m.start() - 160): m.end() + 200].replace("\n", " ")
            print(f"[{kw}]", s[:360])
            break
    if not names:
        sys.exit("자료 페이지에서 엑셀 파일 이름을 찾지 못함")
    latest = sorted(names, key=lambda n: ym_of(n) or "")[-1]
    ym = ym_of(latest)
    if not ym:
        sys.exit(f"기준월을 알 수 없음: {latest}")
    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, f"{ym} 서울시 정비사업 추진현황.xlsx")
    if os.path.exists(dest):
        print("이미 받은 파일:", os.path.basename(dest)); return
    # 2) 내려받기: 함수 인자에서 숫자(seq)를 뽑아 서울 열린데이터광장 파일 서버에 요청
    seqs = []
    for fn, args in calls:
        nums = re.findall(r"'(\d+)'|\"(\d+)\"|\b(\d+)\b", args)
        nums = [a or b or c for a, b, c in nums]
        if nums: seqs.append((fn, args, nums))
    # 페이지의 frmFile 양식 칸(hidden input)을 그대로 읽어서 seq만 바꿔 보냄 (사이트의 downloadFile(seqNo)와 같은 동작)
    form = {}
    fm = re.search(r"<form[^>]*name=[\"']frmFile[\"'][^>]*>(.*?)</form>", html, re.S | re.I)
    if fm:
        for inp in re.finditer(r"<input[^>]*>", fm.group(1), re.I):
            t = inp.group(0)
            n = re.search(r"name=[\"']([^\"']+)", t); v = re.search(r"value=[\"']([^\"']*)", t)
            if n: form[n.group(1)] = v.group(1) if v else ""
    print("frmFile 칸:", form)
    # 파일 표에서 최신 파일의 downloadFile 번호 찾기 (파일 이름 바로 뒤에 나오는 호출)
    pos = html.find(latest)
    near = re.search(r"downloadFile\(\s*'?(\d+)'?\s*\)", html[pos:pos + 3000]) if pos >= 0 else None
    seq_order = ([near.group(1)] if near else []) + [n for _, _, ns in seqs for n in ns]
    seq_order = list(dict.fromkeys(seq_order))
    print("시도할 seq:", seq_order)
    tries = []
    for seq in seq_order:
        data = dict(form); data["seq"] = seq
        data.setdefault("infId", INF_ID)
        tries.append(("https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false", data))
    for url, data in tries[:6]:
        try:
            body, hd = get(url, data)
        except Exception as e:
            print("실패:", url, data, e); continue
        ct = hd.get("Content-Type", "")
        print("응답:", url, data, ct, len(body), body[:4])
        if body[:2] == b"PK" and len(body) > 10000:   # xlsx(zip)
            open(dest, "wb").write(body)
            json.dump({"출처": "서울 열린데이터광장 OA-22856", "파일": latest, "기준월": ym, "주소": PAGE},
                      open(dest + ".json", "w", encoding="utf-8"), ensure_ascii=False)
            print("저장:", os.path.relpath(dest, ROOT)); return
    sys.exit("엑셀 내려받기 실패 (위 로그 참고)")


if __name__ == "__main__":
    main()
