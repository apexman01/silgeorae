"""(예비용) 실거래가 공개시스템에서 받은 CSV로 docs/data.js 만들기.
API를 못 쓸 때만 사용합니다. 여러 구 파일을 한꺼번에 넣을 수 있어요.
    python3 scripts/build_from_csv.py 매매1.csv 매매2.csv -- 전월세1.csv 전월세2.csv
"""
import csv, io, json, os, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_rows(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('"NO"'))  # 안내문 건너뛰기
    return list(csv.DictReader(io.StringIO("\n".join(lines[start:]))))


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


args = sys.argv[1:]
cut = args.index("--") if "--" in args else len(args)
sale_files, rent_files = args[:cut], args[cut + 1:]
complexes, cx_list = {}, []


def cx_index(r):
    p = r["시군구"].split()
    k = (p[1], " ".join(p[2:]), r["단지명"])
    if k not in complexes:
        complexes[k] = len(cx_list)
        cx_list.append([r["단지명"], p[0], p[1], " ".join(p[2:]), r.get("건축년도", "")])
    return complexes[k]


sale, jeonse = [], []
for f in sale_files:
    for r in read_rows(f):
        if r.get("해제사유발생일", "-").strip() not in ("-", "") or r.get("거래유형") == "직거래":
            continue
        price, area = num(r["거래금액(만원)"]), num(r["전용면적(㎡)"])
        if price is None or area is None:
            continue
        sale.append([cx_index(r), round(area, 2), int(r["계약년월"]), int(r["계약일"]), int(price), int(num(r["층"]) or 0)])
for f in rent_files:
    for r in read_rows(f):
        if r.get("전월세구분") != "전세":
            continue
        dep, area = num(r["보증금(만원)"]), num(r["전용면적(㎡)"])
        if dep is None or area is None:
            continue
        jeonse.append([cx_index(r), round(area, 2), int(r["계약년월"]), int(r["계약일"]), int(dep),
                       int(num(r["층"]) or 0), 1 if r.get("계약구분") == "갱신" else 0])

data = {"complexes": cx_list, "sale": sale, "jeonse": jeonse,
        "updated": date.today().isoformat(), "source": "국토교통부 실거래가 공개시스템 CSV"}
with open(os.path.join(ROOT, "docs", "data.js"), "w", encoding="utf-8") as f:
    f.write("window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"완료: 단지 {len(cx_list)}개, 매매 {len(sale)}건, 전세 {len(jeonse)}건")
