#!/usr/bin/env python3
"""config/enemies.json의 monsters[].anim 패턴이 assets/enemies/의 실제 파일과 맞는지 확인.
스탯은 건드리지 않고 패턴(anim)만 점검한다 - 사람이 결과를 보고 enemies.json을 고친다.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
ENEMIES_JSON = os.path.join(ROOT, 'config', 'enemies.json')
SPRITE_DIR = os.path.join(ROOT, 'assets', 'enemies')


def expected_files(pattern, frames):
    return [pattern.replace('{i}', str(i)) + '.png' for i in frames]


def main():
    E = json.load(open(ENEMIES_JSON, encoding='utf-8'))
    actual = set(os.listdir(SPRITE_DIR))
    actual_lower = {f.lower(): f for f in actual}

    problems = []
    for mid, m in E['monsters'].items():
        anim = m['anim']
        frames = anim['frames']
        for kind in ('walk', 'idle'):
            pattern = anim.get(kind)
            if not pattern:
                continue
            missing = []
            case_mismatch = []
            for fname in expected_files(pattern, frames):
                if fname in actual:
                    continue
                if fname.lower() in actual_lower:
                    case_mismatch.append((fname, actual_lower[fname.lower()]))
                else:
                    missing.append(fname)
            if missing or case_mismatch:
                problems.append((mid, kind, pattern, missing, case_mismatch))

    if not problems:
        print('모든 몬스터의 anim 패턴이 assets/enemies/ 파일과 일치합니다.')
        return

    print(f'{len(problems)}개 몬스터/애니메이션 패턴이 실제 파일과 다릅니다:\n')
    for mid, kind, pattern, missing, case_mismatch in problems:
        print(f'- {mid}.{kind} 패턴="{pattern}"')
        if case_mismatch:
            for expected, real in case_mismatch:
                print(f'    대소문자 다름: {expected} -> 실제 파일 {real}')
        if missing:
            for fname in missing:
                print(f'    없음: {fname}')


if __name__ == '__main__':
    main()
