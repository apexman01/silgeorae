"""서울시 정비사업 추진현황 엑셀(열린데이터광장 OA-22856) → docs/data/jb.js

- data/jb/ 폴더에서 파일 이름순으로 가장 마지막 .xlsx 하나를 읽음
  (파일 이름 앞에 'YYYY-MM' 기준월을 붙여 두면 최신이 자동 선택됨)
- 서울시가 분기마다 새 파일을 올리면 data/jb/에 넣기만 하면 됨
"""
import glob, json, os, re, sys
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(os.path.join(ROOT, "data", "jb", "*.xlsx")))
if not files:
    sys.exit("data/jb/ 에 엑셀이 없음")
path = files[-1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb.worksheets[0]
head = [list(r) for r in ws.iter_rows(min_row=1, max_row=4, values_only=True)]

# 엑셀 양식이 바뀌면 바로 알 수 있게 칸 이름 확인
def label(r, c):
    v = head[r][c]
    return re.sub(r"\s+", "", str(v)) if v else ""
expect = {(0, 2): "자치구", (0, 3): "구역명", (0, 9): "사업추진단계", (0, 10): "기존가구수(멸실량)",
          (3, 4): "위치1(지번주소)", (3, 7): "일반/재촉지구", (3, 8): "사업유형",
          (2, 11): "구역지정(아파트지구는정비계획수립)", (2, 13): "추진위원회", (2, 14): "조합설립인가(사업시행자지정일)",
          (2, 15): "건축심의", (2, 16): "사업시행인가", (2, 18): "관리처분계획인가", (2, 20): "이주", (2, 22): "착공", (1, 23): "총합계"}
bad = [(k, v, label(*k)) for k, v in expect.items() if label(*k) != v]
if bad:
    sys.exit(f"엑셀 칸 구성이 예전과 다름: {bad}")

STAGES = ["구역지정", "추진위", "조합설립", "건축심의", "사업시행", "관리처분", "착공"]
DATE_COL = {"구역지정": 11, "추진위": 13, "조합설립": 14, "건축심의": 15, "사업시행": 16, "관리처분": 18, "착공": 22}
d = lambda v: v.strftime("%Y.%m.%d") if hasattr(v, "strftime") else ""
num = lambda v: int(v) if isinstance(v, (int, float)) else 0

out, unknown = {}, set()
for r in ws.iter_rows(min_row=5, values_only=True):
    if not r[2] or not r[3]:
        continue
    stage = str(r[9]).strip()
    if stage not in STAGES:
        unknown.add(stage)
        continue
    dates = {s: d(r[c]) for s, c in DATE_COL.items() if d(r[c])}
    if d(r[20]): dates["이주시작"] = d(r[20])
    if d(r[21]): dates["이주종료"] = d(r[21])
    addr = str(r[4] or "").strip()
    m = re.match(r"([가-힣0-9]+?(?:동|가|로))\s*\d", addr)
    dong = m.group(1) if m else ""
    if not dong:  # '서소문58-7'처럼 '동'이 빠진 주소
        m2 = re.match(r"([가-힣]+)", addr)
        dong = (m2.group(1) + "동") if m2 else ""
    out.setdefault(str(r[2]).strip(), []).append({
        "code": r[0], "name": str(r[3]).strip(), "addr": addr, "dong": dong,
        "type": str(r[8] or "").strip(), "jc": str(r[7] or "").strip() == "재촉",
        "stage": stage, "old": num(r[10]), "new": num(r[23]), "dates": dates})
if unknown:
    print("모르는 단계(제외):", unknown)

asof = re.search(r"(\d{4})-(\d{2})", os.path.basename(path))
payload = {"asof": f"{asof.group(1)}.{asof.group(2)}" if asof else "", "stages": STAGES,
           "src": "서울 열린데이터광장 · 서울특별시 도시정비사업 통계(OA-22856)", "rows": out}
with open(os.path.join(ROOT, "docs", "data", "jb.js"), "w", encoding="utf-8") as f:
    f.write("window.JB = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(os.path.basename(path), "→ docs/data/jb.js", sum(len(v) for v in out.values()), "구역,", len(out), "개 구")
