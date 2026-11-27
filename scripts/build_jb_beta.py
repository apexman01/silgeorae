"""시험판 정비사업 자료: data/jb_auto/(자동으로 받은 엑셀) → docs/beta/data/jb.js

정식 사이트용 build_jb.py와 같은 계산을 그대로 쓰되(파일을 고치지 않고 읽어서 실행),
읽는 폴더와 쓰는 파일만 시험판 경로로 바꾼다. 결과에 출처·기준일 칸을 붙인다.
data/jb_auto/에 파일이 없으면 data/jb/(손으로 넣은 엑셀)를 대신 읽는다.
"""
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_dir = "jb_auto" if glob.glob(os.path.join(ROOT, "data", "jb_auto", "*.xlsx")) else "jb"
code = open(os.path.join(ROOT, "scripts", "build_jb.py"), encoding="utf-8").read()
a = 'os.path.join(ROOT, "data", "jb", "*.xlsx")'
b = 'os.path.join(ROOT, "docs", "data", "jb.js")'
assert code.count(a) == 1 and code.count(b) == 1, "build_jb.py 경로 부분이 바뀜 — 이 스크립트도 같이 고쳐야 함"
code = code.replace(a, f'os.path.join(ROOT, "data", "{src_dir}", "*.xlsx")').replace(b, 'os.path.join(ROOT, "docs", "beta", "data", "jb.js")')
code = code.replace('"→ docs/data/jb.js"', '"→ docs/beta/data/jb.js"')
g = {"__file__": os.path.join(ROOT, "scripts", "build_jb.py"), "__name__": "__main__"}
exec(compile(code, "build_jb.py(시험판 경로)", "exec"), g)

# 출처·기준일 칸 붙이기 (자료 형식은 그대로, 칸만 추가)
out = os.path.join(ROOT, "docs", "beta", "data", "jb.js")
txt = open(out, encoding="utf-8").read()
payload = json.loads(txt[txt.index("=") + 1:].strip().rstrip(";"))
meta_file = sorted(glob.glob(os.path.join(ROOT, "data", src_dir, "*.xlsx.json")))
meta = json.load(open(meta_file[-1], encoding="utf-8")) if meta_file else {}
ym = payload.get("asof", "")
payload["출처"] = ["서울 열린데이터광장 · 서울특별시 도시정비사업 통계(OA-22856)"]
payload["출처주소"] = "https://data.seoul.go.kr/dataList/OA-22856/F/1/datasetView.do"
payload["기준일"] = {"자료": ym.replace(".", "-") + " 말" if ym else ""}
payload["받는방법"] = "자동(scripts/fetch_jb.py, 월간 시험판 워크플로)" if src_dir == "jb_auto" else "손으로 넣은 엑셀(data/jb/)"
payload["만든곳"] = "scripts/build_jb_beta.py"
payload["원본파일"] = meta.get("파일") or os.path.basename(sorted(glob.glob(os.path.join(ROOT, "data", src_dir, "*.xlsx")))[-1])
with open(out, "w", encoding="utf-8") as f:
    f.write("window.JB = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("시험판 정비사업 자료:", src_dir, "→ docs/beta/data/jb.js")
