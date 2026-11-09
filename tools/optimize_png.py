#!/usr/bin/env python3
"""PNG 무손실 최적화. 픽셀은 1비트도 안 바뀐다.

두 가지만 한다:
1) 보조 청크(생성 도구가 넣는 caBX 등 5.7KB짜리 메타데이터) 제거.
2) 256색 이하면 RGBA 32bit -> 8bit 팔레트(+tRNS)로 재인코딩.

쓰기 전에 항상 재디코딩해서 원본과 픽셀이 같은지 확인하고, 다르거나 더 커지면
그 파일은 건너뛴다. 여러 번 돌려도 안전하다(이미 최적인 파일은 그대로 둔다).

    python tools/optimize_png.py           # assets/ 전체, 실제 수정
    python tools/optimize_png.py --dry-run # 얼마나 줄지만 보기
    python tools/optimize_png.py assets/title

아트 생성기(art/**)가 PNG를 다시 뽑으면 메타데이터와 32bit가 돌아오므로,
생성 후에 이 스크립트를 한 번 돌리는 것까지가 한 세트다.
"""
import io
import os
import struct
import sys

from PIL import Image

KEEP_CHUNKS = {b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS'}


def ancillary_bytes(path):
    """표준 청크를 뺀 나머지(메타데이터) 바이트 수."""
    data = open(path, 'rb').read()[8:]
    i = total = 0
    while i + 8 <= len(data):
        length = struct.unpack('>I', data[i:i + 4])[0]
        if data[i + 4:i + 8] not in KEEP_CHUNKS:
            total += length + 12
        i += 12 + length
    return total


def encode(img):
    """팔레트(가능하면) 또는 그대로 재인코딩한 바이트. 보조 청크는 PIL이 안 넣는다."""
    pixels = list(img.getdata())
    palette = sorted(set(pixels))
    buf = io.BytesIO()
    if len(palette) <= 256:
        index = {c: i for i, c in enumerate(palette)}
        out = Image.new('P', img.size)
        out.putdata([index[c] for c in pixels])
        rgb = []
        alpha = []
        for c in palette:
            rgb += list(c[:3])
            alpha.append(c[3])
        out.putpalette(rgb)
        # 전부 불투명하면 tRNS 자체가 필요 없다.
        kwargs = {} if all(a == 255 for a in alpha) else {'transparency': bytes(alpha)}
        out.save(buf, 'PNG', optimize=True, **kwargs)
    else:
        img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def optimize(path, dry_run):
    before = os.path.getsize(path)
    original = Image.open(path).convert('RGBA')
    pixels = list(original.getdata())
    data = encode(original)

    if list(Image.open(io.BytesIO(data)).convert('RGBA').getdata()) != pixels:
        return before, before, 'MISMATCH'  # 안전장치 - 절대 안 걸려야 정상
    if len(data) >= before:
        return before, before, 'skip'
    if not dry_run:
        with open(path, 'wb') as f:
            f.write(data)
    return before, len(data), 'ok'


def main(argv):
    dry_run = '--dry-run' in argv
    roots = [a for a in argv[1:] if not a.startswith('--')] or ['assets']

    files = []
    for root in roots:
        if os.path.isfile(root):
            files.append(root)
            continue
        for dirpath, _, names in os.walk(root):
            files += [os.path.join(dirpath, n) for n in names if n.lower().endswith('.png')]
    # store/ = 스토어 제출용 원본. 경로로 넘겨도 건드리지 않는다.
    files = [f for f in files if 'store' not in os.path.normpath(os.path.relpath(f)).split(os.sep)[:1]]

    before_total = after_total = meta_total = 0
    changed = skipped = 0
    bad = []
    for path in sorted(files):
        meta_total += ancillary_bytes(path)
        before, after, status = optimize(path, dry_run)
        before_total += before
        after_total += after
        if status == 'MISMATCH':
            bad.append(path)
        elif status == 'ok':
            changed += 1
        else:
            skipped += 1

    mb = 1024 * 1024
    print(f'{"[dry-run] " if dry_run else ""}{len(files)} files')
    print(f'  ancillary chunks found: {meta_total / mb:.2f} MB')
    print(f'  {before_total / mb:.2f} MB -> {after_total / mb:.2f} MB '
          f'({(1 - after_total / before_total) * 100:.0f}% smaller), '
          f'{changed} rewritten, {skipped} already optimal')
    for path in bad:
        print(f'  MISMATCH (left untouched): {path}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
