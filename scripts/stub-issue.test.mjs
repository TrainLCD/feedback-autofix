// stub-issue.mjs の回帰テスト。
// 管理チケット番号を取り違えると、別のフィードバックの本文を取りにいく。
// Worker が立てる本文は固定の書式なので、そこから外れたものは拾わない。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAuthorIds, parseStubIssue } from './stub-issue.mjs';

// TrainLCD/MobileApp#6994 の実際の作成者。
const WORKER_ID = 32848922;
const ALLOWED = [String(WORKER_ID)];
const stub = (body, userId = WORKER_ID) => ({ user: { id: userId }, body });
const parse = (body, userId = WORKER_ID, allowed = ALLOWED) =>
  parseStubIssue(stub(body, userId), { allowedAuthorIds: allowed });

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
  const result = parse(REAL_STUB);
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
  assert.equal(parse(body).number, '1277');
});

test('管理チケットの置き場が違えば受け付けない', () => {
  const body = '- Issue: TrainLCD/MobileApp#1277';
  const result = parse(body);
  assert.equal(result.found, false);
  assert.match(result.reason, /置き場が想定と違います/);
});

test('参照が無い issue はスタブとして扱わない', () => {
  // 人が手で立てた issue がワークフローを起動しても、ここで止まる。
  for (const body of ['', '普通の issue です', 'Issue: TrainLCD/Issues#1277', undefined]) {
    const result = parse(body);
    assert.equal(result.found, false);
    assert.match(result.reason, /参照が本文にありません/);
  }
});

test('置き場は引数で変えられる', () => {
  const result = parseStubIssue(stub('- Issue: Other/Repo#5'), {
    expectedRepo: 'Other/Repo',
    allowedAuthorIds: ALLOWED,
  });
  assert.equal(result.number, '5');
});

// CodeRabbit #1 の指摘に対する回帰テスト。
// 対象の 3 リポジトリはどれも公開なので、issue は誰でも立てられる。作成者を
// 見ないと、第三者が管理チケットの番号を書くだけで非公開の本文を取得させられる。
test('許可されていない作成者の issue は本文を見る前に弾く', () => {
  const result = parse(REAL_STUB, 99999999);
  assert.equal(result.found, false);
  assert.match(result.reason, /許可されていない作成者/);
});

test('作成者の許可リストが空なら通さない', () => {
  // 設定を忘れたときに素通りするより、動かないほうが気づける。
  const result = parse(REAL_STUB, WORKER_ID, []);
  assert.equal(result.found, false);
  assert.match(result.reason, /許可リストが設定されていません/);
});

test('作成者を特定できない issue も弾く', () => {
  const result = parseStubIssue({ body: REAL_STUB }, { allowedAuthorIds: ALLOWED });
  assert.equal(result.found, false);
  assert.match(result.reason, /作成者を特定できません/);
});

test('作成者は login ではなく数値の id で照合する', () => {
  assert.deepEqual(parseAuthorIds('32848922, 41898282'), ['32848922', '41898282']);
  assert.deepEqual(parseAuthorIds('32848922\n41898282'), ['32848922', '41898282']);
  // login を書かれても数値でないので弾く。
  assert.deepEqual(parseAuthorIds('TinyKitten'), []);
  assert.deepEqual(parseAuthorIds(undefined), []);
});
