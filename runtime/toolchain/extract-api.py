#!/usr/bin/env python3
"""extract-api.py — Trích danh sách API của Zalo PC từ bundle renderer (đã bóc từ DMG), offline, chỉ dùng stdlib.

Nguồn (đều nằm trong `app-extracted/pc-dist/**/*.js`, không cần mạng/tài khoản/MITM):

1. **Bảng đăng ký endpoint theo miền** — `W=(e,t)=>{Object(h.a)(K,i.a.VOICE_CALL,e,t)}` rồi `W(12436,"/api/voicecall/group/answer")`
   → `(opcode, path, domain)`.
2. **Hàm bọc API** — `static sendAnswerCallGroup(e,t,n,a,i,r){ … "/api/voicecall/group/answer?" … {calleeId:e,callId:t,…}
   … this._get(url,null,12436) }` → tên hàm, phương thức (`_get`/`_post`), tên tham số gửi lên server, chế độ mã hoá
   (`encodeAES`), tên getter miền (`getVoiceCallDomain`). Opcode là khoá nối giữa (1) và (2).
3. **Enum miền** — `VOICE_CALL:"voice_call"` (tên key trong `zpw_service_map`).
4. **Bảng lệnh dạng object** — `11151:{domainType:l,commandId:11151,path:"/api/message/sms"}` (chat/nhóm/board…) và
   `{CMD:13397,PATH:"/api/aifeatures/translate/v1/manual"}` (AI features).
5. **Dự phòng:** mọi chuỗi `"/api/…"` còn lại trong bundle (không rõ opcode/tham số) vẫn được liệt kê (`source: literal`)
   để không bỏ sót đường dẫn nào.

Chỉ ghi **cấu trúc** (đường dẫn, tên tham số, miền): không chép mã nguồn, không có khoá/cookie/imei/token/nội dung tin.
Theo quy tắc cứng số 3 của repo, endpoint chỉ thấy trong code client có trạng thái `static` (= `❓` chưa capture);
chỉ endpoint đã có `✅` trong `docs/api-matrix.md`/`docs/protocol-map.md` mới là `verified`, và endpoint có mặt trong mã Rust
của repo là `in-repo`.

Dùng:
    python3 scripts/toolchain/extract-api.py [--app DIR] [--out DIR] [--root REPO] [--docs-md FILE]

Mặc định: `--app $ZALO_APP_DIR | build/app-extracted`, `--out build/api-inventory` (không commit), `--root` = gốc repo nếu có `crates/`.
`--docs-md docs/api-inventory.md` ghi bản tài liệu đã chọn lọc để commit.
"""

from __future__ import annotations

import argparse
import bisect
import glob
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_APP = Path(os.environ.get("ZALO_APP_DIR") or (ROOT / "build" / "app-extracted"))

MAX_BUNDLE_BYTES = 120 * 1024 * 1024
BODY_LIMIT = 60_000

IDENT = r"[A-Za-z_$][\w$]*"
RE_REGISTRAR_DEF = re.compile(
    r"(?<![\w$.])(" + IDENT + r")=\(e,t\)=>\{Object\(" + IDENT + r"(?:\.\w+)*\)\(" + IDENT + r",(" + IDENT + r"(?:\.\w+)*(?:\(\))?),e,t\)\}"
)
RE_REGISTER_CALL = re.compile(r'(?<![\w$.])(' + IDENT + r')\((\d{4,5}),"(/[A-Za-z0-9_/\-\.]+)"\)')
RE_STATIC_METHOD = re.compile(r"static (?:async )?(" + IDENT + r")\(([^)]*)\)\{")
RE_API_PATH = re.compile(r'"(/api/[A-Za-z0-9_/\-\.]+)')
RE_DOMAIN_GETTER = re.compile(r"\bget([A-Za-z0-9]+)Domain\(\)")
RE_CALL_HTTP = re.compile(r"\._(get|post)(?!Common)\w*\(")
RE_TABLE_ENTRY = re.compile(r"(\d{4,5}):\{domainType:(" + IDENT + r"(?:\.\w+)*),commandId:\1,path:\"(/[A-Za-z0-9_/\-\.]+)\"")
RE_CMD_PATH = re.compile(r'\{CMD:(\d{4,5}),PATH:"(/[A-Za-z0-9_/\-\.]+)"\}')
RE_OPCODE_LITERAL = re.compile(r"(?<![\w$.])(1[1-5]\d{3})(?![\w$])")
RE_ANY_API_LITERAL = re.compile(r'"(/api/[A-Za-z0-9_/\-\.]+)')
RE_ENUM_PAIR = re.compile(r'\b([A-Z][A-Z0-9_]{2,40}):"([A-Za-z0-9_\-]{2,40})"')


# ---------------------------------------------------------------------------
# Quét cú pháp JS tối thiểu (bỏ qua chuỗi / template / regex / comment khi khớp ngoặc)
# ---------------------------------------------------------------------------


def _skip_string(s: str, i: int) -> int:
    q = s[i]
    j = i + 1
    n = len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == q:
            return j + 1
        j += 1
    return n


def _skip_template(s: str, i: int) -> int:
    j = i + 1
    n = len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "`":
            return j + 1
        if c == "$" and j + 1 < n and s[j + 1] == "{":
            end = block_end(s, j + 1)
            j = end if end > 0 else n
            continue
        j += 1
    return n


def _skip_regex(s: str, i: int) -> int:
    j = i + 1
    n = len(s)
    in_class = False
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            j += 1
            while j < n and (s[j].isalpha()):
                j += 1
            return j
        elif c == "\n":
            return i + 1
        j += 1
    return n


def _prev_sig(s: str, j: int) -> str:
    k = j - 1
    while k >= 0 and s[k] in " \t\r\n":
        k -= 1
    return s[k] if k >= 0 else ""


def block_end(s: str, i: int, limit: int = BODY_LIMIT) -> int:
    """`s[i]` là `{`/`(`/`[` → trả chỉ số ngay sau ngoặc đóng tương ứng, hoặc -1."""
    n = len(s)
    end = min(n, i + limit)
    depth = 0
    j = i
    while j < end:
        c = s[j]
        if c in "\"'":
            j = _skip_string(s, j)
            continue
        if c == "`":
            j = _skip_template(s, j)
            continue
        if c == "/" and j + 1 < n:
            nx = s[j + 1]
            if nx == "/":
                k = s.find("\n", j)
                j = k if k != -1 else n
                continue
            if nx == "*":
                k = s.find("*/", j + 2)
                j = k + 2 if k != -1 else n
                continue
            if _prev_sig(s, j) in "(,=:[!&|?{};" or _prev_sig(s, j) == "":
                j = _skip_regex(s, j)
                continue
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def split_top_level(src: str, sep: str = ",") -> list[str]:
    """Tách `src` theo `sep` ở độ sâu 0 (bỏ qua chuỗi/ngoặc)."""
    out: list[str] = []
    depth = 0
    start = 0
    j = 0
    n = len(src)
    while j < n:
        c = src[j]
        if c in "\"'":
            j = _skip_string(src, j)
            continue
        if c == "`":
            j = _skip_template(src, j)
            continue
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
        elif c == sep and depth == 0:
            out.append(src[start:j])
            start = j + 1
        j += 1
    out.append(src[start:])
    return [x.strip() for x in out if x.strip()]


# ---------------------------------------------------------------------------
# Trích xuất
# ---------------------------------------------------------------------------


def parse_enum_map(text: str) -> dict[str, str]:
    """`VOICE_CALL:"voice_call"` … quanh vùng enum miền (tên key trong zpw_service_map)."""
    anchor = text.find('VOICE_CALL:"')
    if anchor < 0:
        return {}
    window = text[max(0, anchor - 4000): anchor + 4000]
    return {k: v for k, v in RE_ENUM_PAIR.findall(window)}


def extract_registry(text: str, enum_map: dict[str, str]) -> list[dict]:
    defs: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for m in RE_REGISTRAR_DEF.finditer(text):
        defs[m.group(1)].append((m.start(), m.group(2)))
    out: list[dict] = []
    for m in RE_REGISTER_CALL.finditer(text):
        name = m.group(1)
        lst = defs.get(name)
        if not lst:
            continue
        idx = bisect.bisect_left([p for p, _ in lst], m.start()) - 1
        if idx < 0:
            continue
        dom_expr = lst[idx][1]
        key = dom_expr.replace("()", "").split(".")[-1]
        out.append(
            {
                "opcode": int(m.group(2)),
                "path": m.group(3),
                "domain_ref": dom_expr,
                "domain": enum_map.get(key) or ("auth" if key == "authDomain" else key),
                "source": "registry",
            }
        )
    return out


def _resolve_var(text: str, var: str, pos: int) -> str | None:
    """Gán gần nhất trước `pos` có dạng `var=a.b.C` (vd. `l=i.a.CHAT`)."""
    window = text[max(0, pos - 40_000): pos]
    last = None
    for m in re.finditer(r"(?<![\w$.])" + re.escape(var) + r"=(" + IDENT + r"(?:\.[\w$]+)+)(?![\w$(])", window):
        last = m.group(1)
    return last


def extract_tables(text: str, enum_map: dict[str, str]) -> list[dict]:
    """Bảng lệnh dạng object: `{domainType:l,commandId:N,path:"…"}` và `{CMD:N,PATH:"…"}`."""
    out: list[dict] = []
    for m in RE_TABLE_ENTRY.finditer(text):
        var = m.group(2)
        ref = var if "." in var else (_resolve_var(text, var, m.start()) or var)
        key = ref.replace("()", "").split(".")[-1]
        out.append(
            {
                "opcode": int(m.group(1)),
                "path": m.group(3),
                "domain_ref": ref,
                "domain": enum_map.get(key) or key.lower(),
                "source": "table",
            }
        )
    for m in RE_CMD_PATH.finditer(text):
        seg = m.group(2).split("/")
        out.append(
            {
                "opcode": int(m.group(1)),
                "path": m.group(2),
                "domain_ref": None,
                "domain": seg[2] if len(seg) > 2 else None,
                "source": "table",
            }
        )
    return out


def extract_literals(text: str) -> set[str]:
    return {m.group(1).split("?")[0] for m in RE_ANY_API_LITERAL.finditer(text)}


def _parse_args(arg_src: str) -> tuple[list[str], list[str]]:
    """Trả (danh sách tham số vị trí, danh sách khoá nếu tham số là object destructuring)."""
    names: list[str] = []
    obj_keys: list[str] = []
    for a in split_top_level(arg_src):
        a = a.split("=")[0].strip() if not a.startswith("{") else a
        if a.startswith("{"):
            inner = a[1:-1] if a.endswith("}") else a[1:]
            for part in split_top_level(inner):
                key = part.split(":")[0].split("=")[0].strip().strip("\"'")
                if key and not key.startswith("..."):
                    obj_keys.append(key)
            names.append("{…}")
        else:
            names.append(a)
    return names, obj_keys


def _object_literal_after(body: str, start: int) -> str | None:
    """Tìm object literal (chứa `key:` hoặc shorthand) đầu tiên từ `start`."""
    for m in re.finditer(r"[=(,]\{(?=[A-Za-z_$\"'.])", body[start:]):
        pos = start + m.end() - 1
        end = block_end(body, pos, 20_000)
        if end > 0:
            return body[pos + 1: end - 1]
    return None


def _pair_keys(obj_src: str) -> list[str]:
    keys: list[str] = []
    for part in split_top_level(obj_src):
        if part.startswith("..."):
            continue
        key = part.split(":")[0].strip().strip("\"'")
        if re.fullmatch(r"[A-Za-z_$][\w$\-]*", key):
            keys.append(key)
    return keys


def _http_call(body: str) -> tuple[str | None, int | None]:
    first_method: str | None = None
    for m in RE_CALL_HTTP.finditer(body):
        end = block_end(body, m.end() - 1, 4000)
        if end < 0:
            continue
        method = m.group(1).upper()
        first_method = first_method or method
        args = split_top_level(body[m.end(): end - 1])
        for a in args[1:]:
            if re.fullmatch(r"\d{4,5}", a):
                return method, int(a)
    return first_method, None


def _params_literal(body: str) -> str | None:
    """Object literal chứa tham số gửi lên server: `JSON.stringify({…})`, hoặc `JSON.stringify(x)` với `x={…}`."""
    m = re.search(r"JSON\.stringify\(", body)
    if m:
        pos = m.end()
        if body[pos: pos + 1] == "{":
            end = block_end(body, pos, 20_000)
            if end > 0:
                return body[pos + 1: end - 1]
        ident = re.match(r"([A-Za-z_$][\w$]*)\s*[,)]", body[pos: pos + 80])
        if ident:
            mm = re.search(r"(?<![\w$.])" + re.escape(ident.group(1)) + r"=\{", body)
            if mm:
                end = block_end(body, mm.end() - 1, 20_000)
                if end > 0:
                    return body[mm.end(): end - 1]
    return _object_literal_after(body, 0)


def extract_wrappers(text: str) -> list[dict]:
    out: list[dict] = []
    for m in RE_STATIC_METHOD.finditer(text):
        name, arg_src = m.group(1), m.group(2)
        brace = m.end() - 1
        # lọc nhanh: nhìn trước 600 ký tự có '/api/' hoặc _get/_post mới tính tiếp
        head = text[m.end(): m.end() + 700]
        if "/api/" not in head and "._get(" not in head and "._post(" not in head and "Domain()" not in head:
            continue
        end = block_end(text, brace)
        if end < 0:
            continue
        body = text[brace + 1: end - 1]
        paths = list(dict.fromkeys(RE_API_PATH.findall(body)))
        method, opcode = _http_call(body)
        if not paths or method is None:
            continue
        arg_names, obj_arg_keys = _parse_args(arg_src)
        dom = RE_DOMAIN_GETTER.search(body)
        obj_src = _params_literal(body)
        params = _pair_keys(obj_src) if obj_src else []
        enc = "aes" if "encodeAES(" in body else ("encryptParam" if "encryptParam" in body else "plain")
        op_candidates = [int(x) for x in dict.fromkeys(RE_OPCODE_LITERAL.findall(body))]
        out.append(
            {
                "wrapper": name,
                "op_candidates": op_candidates,
                "args": arg_names,
                "args_object_keys": obj_arg_keys,
                "paths": paths,
                "method": method,
                "opcode": opcode,
                "domain_getter": ("get" + dom.group(1) + "Domain") if dom else ("authDomain" if "authDomain" in body else None),
                "params": params,
                "encrypt": enc,
            }
        )
    return out


def scan_bundle(path: Path) -> tuple[list[dict], list[dict], set[str]]:
    text = path.read_text("utf-8", errors="ignore")
    enum_map = parse_enum_map(text)
    registry = extract_registry(text, enum_map) + extract_tables(text, enum_map)
    return registry, extract_wrappers(text), extract_literals(text)


def _row(r: dict | None, w: dict | None, op, path, source: str, in_registry: bool) -> dict:
    return {
        "opcode": op,
        "path": path,
        "domain": r["domain"] if r else None,
        "method": w["method"] if w else None,
        "wrapper": w["wrapper"] if w else None,
        "params": w["params"] if w else [],
        "args": w["args"] if w else [],
        "encrypt": w["encrypt"] if w else None,
        "domain_getter": w["domain_getter"] if w else None,
        "in_registry": in_registry,
        "source": source,
    }


def merge(registry: list[dict], wrappers: list[dict], literals=None) -> list[dict]:
    reg_by_op: dict[int, dict] = {}
    for r in registry:
        reg_by_op.setdefault(r["opcode"], r)

    wr_by_op: dict[int, dict] = {}
    wr_no_op: list[dict] = []

    def better(cur: dict | None, w: dict) -> bool:
        return cur is None or len(w["params"]) > len(cur["params"])

    for w in wrappers:
        op = w["opcode"]
        if op is None:
            # `_postSendMsg(c,…,l,…)` với `l=11163` gán riêng: ghép theo opcode nào trong bảng có path trùng đường dẫn của hàm
            matched = [
                o for o in w.get("op_candidates", []) if o in reg_by_op and reg_by_op[o]["path"] in w["paths"]
            ]
            if matched:
                for o in matched:
                    if better(wr_by_op.get(o), w):
                        wr_by_op[o] = w
                continue
            wr_no_op.append(w)
        elif better(wr_by_op.get(op), w):
            wr_by_op[op] = w

    rows: dict[str, dict] = {}
    for op, r in reg_by_op.items():
        w = wr_by_op.get(op)
        rows.setdefault(r["path"], _row(r, w, op, r["path"], r.get("source", "registry"), True))
    for op, w in wr_by_op.items():
        for p in w["paths"][:1]:
            if p not in rows:
                rows[p] = _row(None, w, op, p, "wrapper", False)
    for w in wr_no_op:
        p = w["paths"][0]
        if p not in rows:
            rows[p] = _row(None, w, None, p, "wrapper", False)
    for p in sorted(set(literals or ())):
        if p not in rows:
            rows[p] = _row(None, None, None, p, "literal", False)
    return sorted(rows.values(), key=lambda r: ((r["domain"] or r["domain_getter"] or "~"), r["path"]))


# ---------------------------------------------------------------------------
# Đối chiếu với repo (chỉ khi có --root chứa crates/)
# ---------------------------------------------------------------------------


def repo_paths(root: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = defaultdict(list)
    rx = re.compile(r'"(/api/[A-Za-z0-9_/\-\.]+)')
    for pattern in ("crates/**/*.rs", "src-tauri/**/*.rs"):
        for f in glob.glob(str(root / pattern), recursive=True):
            try:
                text = Path(f).read_text("utf-8", errors="ignore")
            except OSError:
                continue
            rel = os.path.relpath(f, root)
            for p in set(rx.findall(text)):
                found[p.split("?")[0]].append(rel)
    return found


def doc_verified(root: Path) -> set[str]:
    out: set[str] = set()
    rx = re.compile(r"`(?:(?:GET|POST|PUT)\s+)?(/api/[A-Za-z0-9_/\-\.]+)")
    for name in ("docs/api-matrix.md", "docs/protocol-map.md"):
        f = root / name
        if not f.is_file():
            continue
        for line in f.read_text("utf-8", errors="ignore").splitlines():
            if "✅" in line:
                out.update(rx.findall(line))
    return out


def annotate(rows: list[dict], root: Path | None) -> None:
    if root is None or not (root / "crates").is_dir():
        for r in rows:
            r["status"] = "static"
            r["in_repo_files"] = []
        return
    rp = repo_paths(root)
    verified = doc_verified(root)
    for r in rows:
        files = sorted(set(rp.get(r["path"], [])))
        r["in_repo_files"] = files[:3]
        if r["path"] in verified:
            r["status"] = "verified"
        elif files:
            r["status"] = "in-repo"
        else:
            r["status"] = "static"


# ---------------------------------------------------------------------------
# Xuất
# ---------------------------------------------------------------------------


STATUS_ICON = {"verified": "✅", "in-repo": "🟡", "static": "❓"}


def render_markdown(rows: list[dict], meta: dict, curated: bool) -> str:
    lines = [
        "# Danh sách API Zalo PC (trích tĩnh từ bundle renderer)",
        "",
        "> Sinh tự động bởi `scripts/toolchain/extract-api.py` từ `pc-dist/**/*.js` của DMG — **không sửa tay**.",
        "> Chỉ ghi đường dẫn / tên tham số / miền; không có mã nguồn, khoá, cookie hay nội dung tin nhắn.",
        "> Trạng thái: ✅ `verified` (đã có ✅ trong `api-matrix.md`/`protocol-map.md`) · 🟡 `in-repo` (có trong mã Rust, chưa ghi ✅) ·",
        "> ❓ `static` (chỉ thấy trong code client, **chưa capture** — theo quy tắc cứng số 3 không coi là đã verify).",
        "",
        f"Tổng: **{meta['endpoints']}** endpoint ({meta['with_wrapper']} có hàm bọc/tham số, {meta['in_registry']} trong bảng lệnh, "
        f"{meta['literal_only']} chỉ thấy đường dẫn).",
        "",
    ]
    by_dom: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_dom[r["domain"] or r["domain_getter"] or "(chưa rõ miền)"].append(r)
    for dom in sorted(by_dom):
        group = by_dom[dom]
        lines += [f"## {dom} ({len(group)})", "", "| Opcode | Method | Path | Tham số | Mã hoá | Hàm bọc | TT |", "|---|---|---|---|---|---|---|"]
        for r in group:
            params = ", ".join(f"`{p}`" for p in r["params"]) or "—"
            lines.append(
                "| {op} | {m} | `{p}` | {params} | {enc} | {w} | {st} |".format(
                    op=r["opcode"] if r["opcode"] is not None else "—",
                    m=r["method"] or "—",
                    p=r["path"],
                    params=params,
                    enc=r["encrypt"] or "—",
                    w=f"`{r['wrapper']}`" if r["wrapper"] else "—",
                    st=STATUS_ICON.get(r.get("status", "static"), "❓"),
                )
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Trích danh sách API Zalo PC từ bundle renderer.")
    ap.add_argument("--app", default=str(DEFAULT_APP), help="thư mục app-extracted (có pc-dist/)")
    ap.add_argument("--out", default=str(ROOT / "build" / "api-inventory"), help="thư mục xuất JSON + Markdown")
    ap.add_argument("--root", default=str(ROOT), help="gốc repo để đối chiếu mã Rust/docs (bỏ qua nếu không có crates/)")
    ap.add_argument("--docs-md", default="", help="ghi thêm bản Markdown chọn lọc vào đường dẫn này (để commit)")
    args = ap.parse_args()

    app = Path(args.app)
    pc = app / "pc-dist"
    if not pc.is_dir():
        print(f"extract-api: LỖI: không thấy {pc} (chạy run-toolchain.sh trước)", file=sys.stderr)
        return 1

    files = [
        Path(p)
        for p in sorted(glob.glob(str(pc / "**" / "*.js"), recursive=True))
        if not Path(p).name.startswith("lang-") and Path(p).stat().st_size <= MAX_BUNDLE_BYTES
    ]
    registry: list[dict] = []
    wrappers: list[dict] = []
    literals: set[str] = set()
    seen_bundles: list[str] = []
    for f in files:
        reg, wr, lit = scan_bundle(f)
        if reg or wr:
            seen_bundles.append(f.name)
        registry += reg
        wrappers += wr
        literals |= lit
    rows = merge(registry, wrappers, literals)
    if not rows:
        print("extract-api: LỖI: không trích được endpoint nào (bundle đổi cấu trúc?)", file=sys.stderr)
        return 2

    root = Path(args.root) if args.root else None
    annotate(rows, root)
    meta = {
        "generator": "scripts/toolchain/extract-api.py",
        "bundles": sorted(set(seen_bundles)),
        "endpoints": len(rows),
        "with_wrapper": sum(1 for r in rows if r["wrapper"]),
        "in_registry": sum(1 for r in rows if r["in_registry"]),
        "literal_only": sum(1 for r in rows if r["source"] == "literal"),
        "by_status": {s: sum(1 for r in rows if r.get("status") == s) for s in ("verified", "in-repo", "static")},
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "api-inventory.json").write_text(json.dumps({"meta": meta, "endpoints": rows}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    md = render_markdown(rows, meta, curated=False)
    (out / "api-inventory.md").write_text(md, "utf-8")
    if args.docs_md:
        dm = Path(args.docs_md)
        dm.parent.mkdir(parents=True, exist_ok=True)
        dm.write_text(md, "utf-8")
    print(
        f"extract-api: {meta['endpoints']} endpoint ({meta['with_wrapper']} có hàm bọc, {meta['in_registry']} trong bảng, "
        f"{meta['literal_only']} chỉ-literal) "
        f"· trạng thái {meta['by_status']} -> {out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
