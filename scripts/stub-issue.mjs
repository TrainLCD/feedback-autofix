#!/usr/bin/env node
// 各リポジトリに立つスタブ issue から、非公開の管理チケット番号を取り出す。
// prepare/action.yml から呼ばれる前提で、追加の依存を持たず Node 24 の標準機能
// （ESM）だけで動くようにしている。
//
// スタブ issue は TrainLCD/Functions のフィードバックトリアージが立てるもので、
// 本文に原文も端末情報も含まず、管理チケットへの参照だけを持つ。
//
//   ## 管理チケット
//   - Issue: TrainLCD/Issues#1277
//   - チケットID: `268bc14a-...`
//
// 原因のリポジトリは Worker が本文を読んで判定済みなので、ここでは受け取った
// スタブが自分のリポジトリに立っていること自体を振り分けの答えとして扱う。
//
// ただし「自分のリポジトリに立っている」だけでは足りない。対象の 3 リポジトリは
// どれも公開なので、issue は誰でも立てられる。本文の書式しか見ないと、第三者が
// 管理チケットの番号を書いた issue を立てるだけで、非公開チケットの本文を
// ISSUES_REPO_TOKEN で取得させ、エージェントへ渡せてしまう。作成者を先に
// 確かめる。

import { realpathSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 管理チケットの参照は Worker が組み立てた固定の書式なので、緩く探さない。
// 本文のどこかに現れた `#123` を拾うと、人が書き足した関連 issue の番号を
// フィードバックの本文として取りにいってしまう。
const TICKET_PATTERN = /^- Issue:\s*([\w.-]+\/[\w.-]+)#(\d+)\s*$/m;

// 作成者は login ではなく数値の id で照合する。login は本人が変えられるうえ、
// 手放された名前は他人が取得できる。id は作り直せない。
export const parseAuthorIds = (raw) =>
  String(raw ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^\d+$/.test(entry));

export const parseStubIssue = (issue, options = {}) => {
  const { expectedRepo = 'TrainLCD/Issues', allowedAuthorIds = [] } = options;

  // 許可リストが空なら通さない。設定を忘れたときに素通りするより、動かないほうが
  // 気づける。
  if (allowedAuthorIds.length === 0) {
    return { found: false, reason: '作成者の許可リストが設定されていません' };
  }
  const authorId = issue?.user?.id;
  if (authorId === undefined || authorId === null) {
    return { found: false, reason: '作成者を特定できません' };
  }
  if (!allowedAuthorIds.includes(String(authorId))) {
    return {
      found: false,
      reason: `許可されていない作成者の issue です (id: ${String(authorId).slice(0, 32)})`,
    };
  }

  const matched = TICKET_PATTERN.exec(String(issue?.body ?? ''));
  if (!matched) {
    return { found: false, reason: '管理チケットへの参照が本文にありません' };
  }
  const [, repo, number] = matched;
  if (repo !== expectedRepo) {
    return {
      found: false,
      reason: `管理チケットの置き場が想定と違います (${repo})`,
    };
  }
  return { found: true, repo, number };
};

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} は必須です`);
  }
  return value;
};

const main = async () => {
  const issue = JSON.parse(await readFile(requireEnv('STUB_ISSUE_JSON_PATH'), 'utf8'));
  const result = parseStubIssue(issue, {
    expectedRepo: process.env.ISSUES_REPO || 'TrainLCD/Issues',
    allowedAuthorIds: parseAuthorIds(process.env.ALLOWED_AUTHOR_IDS),
  });

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `found=${result.found}\nnumber=${result.number ?? ''}\n`,
      'utf8'
    );
  }

  if (!result.found) {
    console.log(`::notice::スタブ issue として扱えません: ${result.reason}`);
    return;
  }
  console.log(`管理チケット: ${result.repo}#${result.number}`);
};

// テストから関数だけを import できるよう、直接起動されたときだけ main() を走らせる。
const isDirectRun = () => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  main().catch((error) => {
    console.error(`::error::スタブ issue の解析に失敗しました: ${error.message}`);
    process.exitCode = 1;
  });
}
