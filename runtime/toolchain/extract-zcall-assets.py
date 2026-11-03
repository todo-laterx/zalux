#!/usr/bin/env python3
"""extract-zcall-assets.py — bóc resource Qt RCC (format v3) từ binary ZaloCall.

Binary ZaloCall là Mach-O universal (x86_64 + arm64) do Qt Widgets biên dịch.
Resource nhúng được đăng ký bởi `qInitResources_ZaloCallWindows` qua
`qRegisterResourceData(3, tree, names, data)`. Script:

1. parse Mach-O, tìm symbol `...qInitResources_ZaloCallWindowsv`;
2. giải mã lệnh lea/adrp+add để lấy 3 con trỏ tree/names/data
   (nếu không có symbol thì fallback quét cấu trúc RCC);
3. duyệt tree, giải nén zlib/qCompress, ghi toàn bộ resource giữ nguyên cây thư mục.

Chỉ dùng stdlib Python 3. Không cần Node/npm.

usage:
    extract-zcall-assets.py [BINARY] [OUTPUT_DIR]
    mặc định: build/raw/ZaloCall -> build/zcall-assets
"""
import hashlib
import json
import os
import struct
import sys
import zlib
from array import array

# ---------------------------------------------------------------- Mach-O ---
FAT_MAGIC = 0xCAFEBABE
FAT_MAGIC_64 = 0xCAFEBABF
MH_MAGIC = 0xFEEDFACE
MH_MAGIC_64 = 0xFEEDFACF
LC_SEGMENT = 0x1
LC_SEGMENT_64 = 0x19
LC_SYMTAB = 0x2

CPU_NAMES = {
    7: "i386",
    0x01000007: "x86_64",
    12: "arm",
    0x0100000C: "arm64",
}


class Slice:
    def __init__(self, data, offset, size, cputype, cpusubtype):
        self.data = data
        self.offset = offset          # fat offset (absolute file offset)
        self.size = size
        self.cputype = cputype
        self.cpusubtype = cpusubtype
        self.arch = CPU_NAMES.get(cputype, f"cpu{cputype:#x}")
        self.is64 = False
        self.segments = []            # (vmaddr, vmsize, fileoff, filesize) relative to slice
        self.symtab = None            # (symoff, nsyms, stroff, strsize) relative to slice
        self._parse()

    def _parse(self):
        d, so = self.data, self.offset
        if so + 32 > len(d):
            return
        magic = struct.unpack("<I", d[so:so + 4])[0]
        if magic not in (MH_MAGIC, MH_MAGIC_64):
            return
        self.is64 = magic == MH_MAGIC_64
        ncmds, _ = struct.unpack("<II", d[so + 16:so + 24])
        p = so + 32
        for _ in range(ncmds):
            if p + 8 > len(d):
                break
            cmd, cmdsize = struct.unpack("<II", d[p:p + 8])
            if cmdsize < 8:
                break
            if cmd == LC_SEGMENT_64 and p + 72 <= len(d):
                vmaddr, vmsize, fileoff, filesize = struct.unpack("<QQQQ", d[p + 24:p + 56])
                self.segments.append((vmaddr, vmsize, fileoff, filesize))
            elif cmd == LC_SEGMENT and p + 56 <= len(d):
                vmaddr, vmsize, fileoff, filesize = struct.unpack("<IIII", d[p + 24:p + 40])
                self.segments.append((vmaddr, vmsize, fileoff, filesize))
            elif cmd == LC_SYMTAB and p + 24 <= len(d):
                self.symtab = struct.unpack("<IIII", d[p + 8:p + 24])
            p += cmdsize

    def file_off(self, vaddr):
        """Map virtual address -> absolute file offset, None nếu ngoài segment."""
        for vmaddr, vmsize, fileoff, filesize in self.segments:
            if vmaddr <= vaddr < vmaddr + vmsize:
                delta = vaddr - vmaddr
                if delta <= filesize:
                    return self.offset + fileoff + delta
        return None

    def vaddr(self, file_off):
        """Map absolute file offset -> virtual address."""
        rel = file_off - self.offset
        for vmaddr, vmsize, fileoff, filesize in self.segments:
            if fileoff <= rel < fileoff + filesize:
                return vmaddr + (rel - fileoff)
        return None

    def symbols(self):
        if not self.symtab:
            return []
        symoff, nsyms, stroff, strsize = self.symtab
        d, so = self.data, self.offset
        strtab = d[so + stroff:so + stroff + strsize]
        out = []
        for i in range(nsyms):
            e = so + symoff + i * 16
            if e + 16 > len(d):
                break
            strx, ntype, nsect, ndesc, value = struct.unpack("<IBBHQ", d[e:e + 16])
            end = strtab.find(b"\0", strx)
            if end < 0:
                continue
            name = strtab[strx:end].decode("utf-8", "replace")
            out.append((name, value, ntype))
        return out


def parse_slices(data):
    if len(data) < 8:
        return []
    magic = struct.unpack(">I", data[0:4])[0]
    if magic in (FAT_MAGIC, FAT_MAGIC_64):
        nfat = struct.unpack(">I", data[4:8])[0]
        slices = []
        wide = magic == FAT_MAGIC_64
        entsize = 32 if wide else 20
        for i in range(nfat):
            off = 8 + i * entsize
            if off + entsize > len(data):
                break
            cputype, cpusubtype = struct.unpack(">ii", data[off:off + 8])
            if wide:
                offset, size = struct.unpack(">QQ", data[off + 8:off + 24])
            else:
                offset, size = struct.unpack(">II", data[off + 8:off + 16])
            if offset + size > len(data):
                continue
            slices.append(Slice(data, offset, size, cputype, cpusubtype))
        return slices
    if struct.unpack("<I", data[0:4])[0] in (MH_MAGIC, MH_MAGIC_64):
        return [Slice(data, 0, len(data), 0, 0)]
    return []


# ------------------------------------------------------- RCC arrays lookup ---
def _be16(b):
    return struct.unpack(">H", b)[0]


def _be32(b):
    return struct.unpack(">I", b)[0]


def _be64(b):
    return struct.unpack(">Q", b)[0]


def find_resource_symbol(sl):
    for name, value, ntype in sl.symbols():
        if "qInitResources_ZaloCallWindows" in name and "Cleanup" not in name:
            return value
    return None


def lea_pointers(sl, func_va):
    """Giải mã byte đầu của qInitResources, trả về {reg: vaddr} cho các lea/adrp-add."""
    f = sl.file_off(func_va)
    if f is None:
        return {}
    code = sl.data[f:f + 256]
    ptrs = {}
    if sl.arch == "x86_64":
        i = 0
        while i + 7 <= len(code):
            # 48 8d /r : lea r64, [rip+disp32]  (modrm mod=00, rm=101)
            if code[i] == 0x48 and code[i + 1] == 0x8D and (code[i + 2] & 0xC7) == 0x05:
                reg = (code[i + 2] >> 3) & 7
                disp = struct.unpack("<i", code[i + 3:i + 7])[0]
                insn_va = sl.vaddr(f + i)
                if insn_va is not None:
                    ptrs[reg] = insn_va + 7 + disp
                i += 7
                continue
            if code[i] in (0xC3, 0xE9) and ptrs:  # ret / jmp: dừng
                break
            if code[i] == 0xE8 and ptrs:          # call: đã nạp đủ tham số
                break
            i += 1
        return ptrs
    if sl.arch == "arm64":
        adrp = {}
        for i in range(0, len(code) - 4, 4):
            insn = struct.unpack("<I", code[i:i + 4])[0]
            if (insn & 0xFC000000) == 0x94000000 and ptrs:  # bl: dừng
                break
            if (insn & 0x9F000000) == 0x90000000:  # adrp
                rd = insn & 0x1F
                immlo = (insn >> 29) & 0x3
                immhi = (insn >> 5) & 0x7FFFF
                imm = (immhi << 2 | immlo) << 12
                if imm & (1 << 32):
                    imm -= 1 << 33
                pc = sl.vaddr(f + i)
                if pc is not None:
                    adrp[rd] = (pc & ~0xFFF) + imm
            elif (insn & 0xFF800000) == 0x91000000:  # add xD, xN, #imm12
                shift = (insn >> 22) & 0x3
                imm12 = (insn >> 10) & 0xFFF
                rn = (insn >> 5) & 0x1F
                rd = insn & 0x1F
                if shift == 0 and rn in adrp:
                    ptrs[rd] = adrp[rn] + imm12
        return ptrs
    return {}


def parse_names(data, start, end):
    """Đọc name table: u16 len + u32 hash + UTF-16BE. Trả (list[(offset,name)], end)."""
    names = []
    p = start
    while p + 6 <= end:
        ln = _be16(data[p:p + 2])
        if ln == 0 or ln > 4096 or p + 6 + 2 * ln > end:
            break
        raw = data[p + 6:p + 6 + 2 * ln]
        try:
            name = raw.decode("utf-16-be")
        except UnicodeDecodeError:
            break
        names.append((p - start, name))
        p += 6 + 2 * ln
        if len(names) > 200000:
            break
    return names, p


def tree_entry(sl, tree_off, idx, stride):
    o = tree_off + idx * stride
    if o + stride > len(sl.data):
        return None
    no, flags, a, b, ts = struct.unpack(">IHIIQ", sl.data[o:o + 22])
    return no, flags, a, b, ts


def walk_tree(sl, tree_off, stride, name_by_off, max_nodes=250000):
    """Duyệt cây resource; trả list (đường_dẫn, flags, dataOffset) hoặc None nếu hỏng."""
    root = tree_entry(sl, tree_off, 0, stride)
    if not root:
        return None
    no, flags, cc, fc, _ = root
    if no != 0 or not (flags & 0x02) or cc <= 0 or cc > 100000 or fc <= 0:
        return None
    visited = set()
    files = []
    stack = [(0, ())]            # (index, path segments của thư mục cha)
    while stack:
        idx, parent = stack.pop()
        if idx in visited or idx < 0 or len(visited) > max_nodes:
            return None
        visited.add(idx)
        ent = tree_entry(sl, tree_off, idx, stride)
        if not ent:
            return None
        no, flags, a, b, _ = ent
        if no not in name_by_off:
            return None
        name = name_by_off[no]
        if flags & ~0x17:          # chỉ Compressed|Directory|CompressedZstd|Locale
            return None
        if flags & 0x02:           # directory
            if a <= 0 or a > 100000 or b <= 0:
                return None
            # node 0 là root: tên của nó không phải một thư mục thật
            child_path = parent if idx == 0 else parent + (name,)
            stack.extend((b + i, child_path) for i in range(a))
        elif flags & 0x10:         # locale leaf
            continue
        else:                      # file
            files.append(("/".join(parent + (name,)), flags, b))
    return files, len(visited)


def resolve_arrays(sl):
    """Trả (tree_off, names_off, names, data_off_hint, stride, files) hoặc None."""
    func = find_resource_symbol(sl)
    if func is None:
        return None
    ptrs = lea_pointers(sl, func)
    if sl.arch == "x86_64":
        tree_va, names_va, data_va = ptrs.get(6), ptrs.get(2), ptrs.get(1)
    else:
        tree_va, names_va, data_va = ptrs.get(1), ptrs.get(2), ptrs.get(3)
    if tree_va is None or names_va is None:
        return None
    tree_off = sl.file_off(tree_va)
    names_off = sl.file_off(names_va)
    data_off = sl.file_off(data_va) if data_va is not None else None
    if tree_off is None or names_off is None:
        return None
    names, names_end = parse_names(sl.data, names_off, min(len(sl.data), names_off + 4 * 1024 * 1024))
    if len(names) < 5:
        return None
    name_by_off = {o: n for o, n in names}
    best = None
    for stride in (22, 14):
        res = walk_tree(sl, tree_off, stride, name_by_off)
        if not res:
            continue
        files, visited = res
        # tree thật phải phủ gần hết name table (name trùng được chia sẻ)
        if visited < len(names) or visited > len(names) * 3 + 16 or not files:
            continue
        if best is None or len(files) > len(best[0]):
            best = (files, visited, stride)
    if best is None:
        return None
    files, visited, stride = best
    return tree_off, names_off, names, data_off, stride, files


def _entry_ok(d, p, n):
    """Một entry name table hợp lệ? u16 len + u32 hash + UTF-16BE, ký tự in được."""
    if p + 6 > n:
        return 0
    ln = _be16(d[p:p + 2])
    if ln == 0 or ln > 4096 or p + 6 + 2 * ln > n:
        return 0
    # kiểm tra nhanh từng ký tự, thoát sớm với dữ liệu rác
    raw = d[p + 6:p + 6 + 2 * ln]
    try:
        s = raw.decode("utf-16-be")
    except UnicodeDecodeError:
        return 0
    for ch in s:
        o = ord(ch)
        if o < 0x20 or o == 0x7F:
            return 0
    return 6 + 2 * ln


def fallback_scan(sl):
    """Không có symbol: quét name table + tree bằng cấu trúc RCC.

    - DP tuyến tính tìm name table dài nhất (mỗi entry: u16 len + u32 hash + UTF-16BE).
    - Quét root tree (nameOffset=0, flags=Directory) và duyệt thử stride 22/14.
    """
    d = sl.data
    n = len(d)
    chain = bytearray(n + 1)          # độ dài chain, bão hoà 255
    step = array("H", bytes(2 * (n + 1)))  # kích thước entry tại p (0 nếu hỏng)
    for p in range(n - 1, -1, -1):
        ln = _entry_ok(d, p, n)
        if not ln:
            continue
        step[p] = ln
        nxt = p + ln
        chain[p] = min(255, 1 + (chain[nxt] if nxt <= n else 0))
    cands = []
    for p in range(n):
        if chain[p] >= 10 and step[p]:
            cands.append((chain[p], p))
    # giữ các start "đầu mảng": chain dài nhất trong lân cận 64KB
    cands.sort(reverse=True)
    starts = []
    for c, p in cands:
        if any(abs(p - q) < 65536 for q in starts):
            continue
        starts.append(p)
        if len(starts) >= 8:
            break
    best = None
    for names_off in starts:
        names, _ = parse_names(d, names_off, n)
        if len(names) < 10:
            continue
        name_by_off = {o: n for o, n in names}
        pos = 0
        while True:
            t = d.find(b"\x00\x00\x00\x00\x00\x02", pos)
            if t < 0:
                break
            pos = t + 1
            for stride in (22, 14):
                res = walk_tree(sl, t, stride, name_by_off)
                if not res:
                    continue
                files, visited = res
                if visited < len(names) or visited > len(names) * 3 + 16 or not files:
                    continue
                if best is None or len(files) > len(best[5]):
                    best = (t, names_off, names, None, stride, files)
    return best


def find_data_start(sl, files, hint):
    """Xác định offset data array: mọi dataOffset phải là blob liên tiếp."""
    d = sl.data
    offs = sorted({b for _, _, b in files})
    if len(offs) < 2:
        return hint

    def valid(ds):
        if ds is None or ds < 0:
            return False
        for a, b in zip(offs, offs[1:]):
            if ds + a + 4 > len(d):
                return False
            ln = _be32(d[ds + a:ds + a + 4])
            if ln <= 0 or ds + a + 4 + ln > len(d):
                return False
            if a + 4 + ln != b:
                return False
        a = offs[-1]
        if ds + a + 4 > len(d):
            return False
        ln = _be32(d[ds + a:ds + a + 4])
        return 0 < ln and ds + a + 4 + ln <= len(d)

    if valid(hint):
        return hint
    # dò vị trí q sao cho blob đầu tiên dài đúng bằng khoảng cách offset đầu
    a0, a1 = offs[0], offs[1]
    want = a1 - a0 - 4
    if want <= 0:
        return None
    pat = struct.pack(">I", want)
    pos = 0
    tries = 0
    while True:
        q = d.find(pat, pos)
        if q < 0:
            break
        pos = q + 1
        ds = q - a0
        if valid(ds):
            return ds
        tries += 1
        if tries > 20000:
            break
    return None


# ------------------------------------------------------------- extraction ---
def safe_parts(rel):
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts:
        return None
    for p in parts:
        if p == ".." or "\\" in p or p.startswith("/") or "\0" in p:
            return None
    return parts


def decompress_payload(payload, flags, rel):
    if flags & 0x01:                       # qCompress: u32 uncompressed + zlib
        if len(payload) < 4:
            raise ValueError("blob compressed quá ngắn")
        expected = _be32(payload[:4])
        out = zlib.decompress(payload[4:])
        if len(out) != expected:
            raise ValueError(f"zlib size {len(out)} != {expected}")
        return out
    if flags & 0x04:                       # zstd (Qt 6 optional)
        try:
            from compression import zstd as _zstd  # Python 3.14+
            return _zstd.decompress(payload)
        except ImportError:
            pass
        try:
            import zstandard as _zstd            # pip optional
            return _zstd.ZstdDecompressor().decompress(payload)
        except ImportError:
            raise ValueError("cần zstd (Python 3.14 compression.zstd hoặc gói zstandard)")
    return payload


CATEGORY_EXT = {
    "png": (".png",),
    "svg": (".svg",),
    "icon": (".ico", ".icns"),
    "sound": (".mp3", ".wav", ".ogg", ".aac"),
    "translation": (".qm",),
}


def category_for(rel):
    low = rel.lower()
    for cat, exts in CATEGORY_EXT.items():
        if low.endswith(exts):
            return cat
    return "other"


def main(argv):
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = [a for a in argv[1:] if not a.startswith("-")]
    binary = args[0] if len(args) > 0 else os.path.join(root, "build", "raw", "ZaloCall")
    outdir = args[1] if len(args) > 1 else os.path.join(root, "build", "zcall-assets")
    binary = os.path.abspath(binary)
    outdir = os.path.abspath(outdir)

    if not os.path.isfile(binary):
        print(f"extract-zcall-assets: không thấy binary: {binary}", file=sys.stderr)
        return 1
    data = open(binary, "rb").read()
    print(f"Binary : {binary} ({len(data):,} bytes)")
    print(f"SHA256 : {hashlib.sha256(data).hexdigest()}")
    slices = parse_slices(data)
    if not slices:
        print("extract-zcall-assets: không phải Mach-O/fat binary hợp lệ", file=sys.stderr)
        return 1
    print("Arch   : " + ", ".join(s.arch for s in slices))

    chosen = None
    for sl in slices:
        if sl.arch.endswith("64") or sl.arch in ("x86_64", "arm64"):
            res = resolve_arrays(sl)
            if res is None:
                res = fallback_scan(sl)
            if res is not None:
                chosen = (sl, res)
                break
    if chosen is None:
        for sl in slices:
            res = fallback_scan(sl)
            if res is not None:
                chosen = (sl, res)
                break
    if chosen is None:
        print("extract-zcall-assets: không tìm thấy RCC tree/names/data trong binary", file=sys.stderr)
        return 1

    sl, res = chosen
    tree_off, names_off, names, data_hint, stride, files = res
    data_start = find_data_start(sl, files, data_hint)
    if data_start is None:
        print("extract-zcall-assets: không xác định được data array", file=sys.stderr)
        return 1

    print(f"Slice   : {sl.arch} (offset {sl.offset}, {sl.size:,} bytes)")
    print(f"RCC     : tree={tree_off} names={names_off} data={data_start} stride={stride} "
          f"names={len(names)} files={len(files)}")

    os.makedirs(outdir, exist_ok=True)
    manifest = []
    errors = []
    counts = {}
    written = {}
    for rel, flags, off in files:
        parts = safe_parts(rel)
        if not parts:
            errors.append(f"bỏ qua tên không an toàn: {rel!r}")
            continue
        rel = "/".join(parts)
        blob = data_start + off
        if blob + 4 > len(data):
            errors.append(f"{rel}: offset ngoài file")
            continue
        ln = _be32(data[blob:blob + 4])
        payload = data[blob + 4:blob + 4 + ln]
        if len(payload) != ln:
            errors.append(f"{rel}: payload cụt ({len(payload)}/{ln})")
            continue
        try:
            payload = decompress_payload(payload, flags, rel)
        except Exception as e:
            errors.append(f"{rel}: {e}")
            continue
        dst = os.path.join(outdir, *parts)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(payload)
        h = hashlib.sha256(payload).hexdigest()
        if rel in written and written[rel] != h:
            errors.append(f"{rel}: trùng đường dẫn nhưng nội dung khác")
            continue
        written[rel] = h
        cat = category_for(rel)
        counts[cat] = counts.get(cat, 0) + 1
        manifest.append({
            "path": rel,
            "size": len(payload),
            "sha256": h,
            "flags": flags,
            "compressed": "zlib" if flags & 1 else ("zstd" if flags & 4 else None),
            "data_offset": off,
        })

    manifest.sort(key=lambda m: m["path"])
    with open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({
            "source": os.path.basename(binary),
            "source_sha256": hashlib.sha256(data).hexdigest(),
            "arch": sl.arch,
            "rcc": {"tree": tree_off, "names": names_off, "data": data_start, "stride": stride},
            "counts": counts,
            "files": manifest,
        }, f, ensure_ascii=False, indent=2)
        f.write("\n")

    required = [
        "endcall.png", "camera1.png", "camera_off1.png", "mic1.png", "mic_off1.png",
        "accept_audiocall.png", "accept_videocall.png", "speak.png",
    ]
    found_names = {os.path.basename(m["path"]) for m in manifest}
    sounds = [m["path"] for m in manifest if category_for(m["path"]) == "sound"]
    pngs = [m["path"] for m in manifest if category_for(m["path"]) == "png"]

    print("\nĐã trích xuất:")
    for cat in sorted(counts):
        print(f"  {cat:12s}: {counts[cat]}")
    print(f"  tổng cộng   : {len(manifest)} file -> {outdir}")
    print("\nIcon cuộc gọi (PNG):")
    for n in required:
        mark = "OK " if n in found_names else "THIẾU"
        print(f"  [{mark}] {n}")
    print("\nÂm thanh chuông:")
    for p in sounds:
        print(f"  {p}")
    if pngs:
        print(f"\nTổng PNG: {len(pngs)}")
    if errors:
        print(f"\nCảnh báo ({len(errors)}):", file=sys.stderr)
        for e in errors[:20]:
            print(f"  - {e}", file=sys.stderr)

    missing = [n for n in required if n not in found_names]
    if not manifest:
        print("extract-zcall-assets: không trích xuất được file nào", file=sys.stderr)
        return 1
    if missing:
        print(f"\nextract-zcall-assets: thiếu icon bắt buộc: {', '.join(missing)}", file=sys.stderr)
        return 2
    print("\nextract-zcall-assets: xong.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
