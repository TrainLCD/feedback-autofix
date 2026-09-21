// stub-issue.mjs の回帰テスト。
// 管理チケット番号を取り違えると、別のフィードバックの本文を取りにいく。
// Worker が立てる本文は固定の書式なので、そこから外れたものは拾わない。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseStubIssue } from './stub-issue.mjs';

// TrainLCD/MobileApp#6994 の実際の本文。
const REAL_STUB = [
  'アプリから届いたフィードバックのトリアージで、原因が本リポジトリにあると推定されたため起票しています。',
  '',
  'フィードバックの内容は公開リポジトリには掲載していません。原文・要約・端末情報などの詳細は、下記の非公開の管理チケットを参照してください。',
  '',
  '## 管理チケット',
  '- Issue: TrainLCD/Issues#1277',
  '- チケットID: `268bc14a-f4c4-410b-9ace-30ba190b7389`',
].join('\n');

test('実際のスタブ issue から管理チケット番号を取れる', () => {
  const result = parseStubIssue(REAL_STUB);
  assert.equal(result.found, true);
  assert.equal(result.repo, 'TrainLCD/Issues');
  assert.equal(result.number, '1277');
});

test('本文中の他の issue 参照は拾わない', () => {
  // 人が「#6883 と同じでは」と書き足しても、管理チケットの行以外は見ない。
  const body = [
    '関連しそう: #6883 と TrainLCD/StationAPI#12',
    '',
    '## 管理チケット',
    '- Issue: TrainLCD/Issues#1277',
  ].join('\n');
  assert.equal(parseStubIssue(body).number, '1277');
});

test('管理チケットの置き場が違えば受け付けない', () => {
  const body = '- Issue: TrainLCD/MobileApp#1277';
  const result = parseStubIssue(body);
  assert.equal(result.found, false);
  assert.match(result.reason, /置き場が想定と違います/);
});

test('参照が無い issue はスタブとして扱わない', () => {
  // 人が手で立てた issue がワークフローを起動しても、ここで止まる。
  for (const body of ['', '普通の issue です', 'Issue: TrainLCD/Issues#1277', undefined]) {
    const result = parseStubIssue(body);
    assert.equal(result.found, false);
    assert.match(result.reason, /参照が本文にありません/);
  }
});

test('置き場は引数で変えられる', () => {
  assert.equal(parseStubIssue('- Issue: Other/Repo#5', 'Other/Repo').number, '5');
});
