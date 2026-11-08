import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function escCsv(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  if (rows.length === 0) {
    writeFileSync(path, '', 'utf8');
    return;
  }
  // 모든 행의 키 합집합 - 한 CSV에 모양이 다른 행(T4 요약/보스/해금)이 섞여 있어 첫 행만 보면 칸이 빠진다.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escCsv(row[h])).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

export function todayTag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function mdTable(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}
