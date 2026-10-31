#!/usr/bin/env python3
"""Minimal ASAR extract/pack (no Node). Preserves symlinks and SHA256 integrity."""
import hashlib, json, os, struct, sys

BLOCK = 4 * 1024 * 1024


def read_asar(path):
    with open(path, 'rb') as f:
        head = f.read(16)
        if len(head) < 16 or struct.unpack('<I', head[0:4])[0] != 4:
            raise SystemExit(f'not an asar: {path}')
        header_size = struct.unpack('<I', head[4:8])[0]
        json_len = struct.unpack('<I', head[12:16])[0]
        f.seek(16)
        header = json.loads(f.read(json_len).decode('utf-8'))
        data_start = 8 + header_size
        f.seek(data_start)
        data = f.read()
    return header, data


def walk(node, base=''):
    for name, child in node.get('files', {}).items():
        p = os.path.join(base, name)
        if 'files' in child:
            yield from walk(child, p)
        else:
            yield p, child


def extract(src, dst):
    header, data = read_asar(src)
    os.makedirs(dst, exist_ok=True)
    for rel, node in walk(header):
        out = os.path.join(dst, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if 'link' in node:
            if os.path.lexists(out):
                os.unlink(out)
            target = os.path.relpath(node['link'], os.path.dirname(rel) or '.')
            os.symlink(target, out)
        else:
            off = int(node['offset'])
            size = int(node['size'])
            with open(out, 'wb') as f:
                f.write(data[off:off + size])
    print(f'extracted {src} -> {dst}')


def integrity(data):
    h = hashlib.sha256(data).hexdigest()
    blocks = [hashlib.sha256(data[i:i + BLOCK]).hexdigest() for i in range(0, len(data), BLOCK)] or [h]
    return {'algorithm': 'SHA256', 'hash': h, 'blockSize': BLOCK, 'blocks': blocks}


def scan(root, base=''):
    node = {'files': {}}
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name)
        rel = os.path.join(base, name)
        if os.path.islink(p):
            target = os.readlink(p)
            if not os.path.isabs(target):
                target = os.path.normpath(os.path.join(os.path.dirname(rel), target))
            node['files'][name] = {'link': target.replace(os.sep, '/')}
        elif os.path.isdir(p):
            node['files'][name] = scan(p, rel)
        else:
            with open(p, 'rb') as f:
                data = f.read()
            node['files'][name] = {'size': len(data), 'integrity': integrity(data)}
    return node


def assign(node, data_parts, offset=0):
    for name in sorted(node.get('files', {})):
        child = node['files'][name]
        if 'files' in child:
            offset = assign(child, data_parts, offset)
        elif 'link' not in child:
            child['offset'] = str(offset)
            data_parts.append(child.pop('_data'))
            offset += child['size']
    return offset


def collect(node, base):
    for name in sorted(node.get('files', {})):
        child = node['files'][name]
        p = os.path.join(base, name)
        if 'files' in child:
            collect(child, p)
        elif 'link' not in child:
            with open(p, 'rb') as f:
                child['_data'] = f.read()


def pack(src, dst):
    node = scan(src)
    collect(node, src)
    parts = []
    assign(node, parts)
    header = json.dumps(node, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    header_size = (8 + len(header) + 3) // 4 * 4
    pad = header_size - 8 - len(header)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<I', 4))
        f.write(struct.pack('<I', header_size))
        f.write(struct.pack('<I', header_size - 4))
        f.write(struct.pack('<I', len(header)))
        f.write(header)
        f.write(b'\0' * pad)
        for part in parts:
            f.write(part)
    print(f'packed {src} -> {dst}')


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ('extract', 'pack'):
        raise SystemExit('usage: asar.py extract|pack <src> <dst>')
    if sys.argv[1] == 'extract':
        extract(sys.argv[2], sys.argv[3])
    else:
        pack(sys.argv[2], sys.argv[3])


if __name__ == '__main__':
    main()
