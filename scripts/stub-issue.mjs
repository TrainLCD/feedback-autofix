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

import { realpathSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 管理チケットの参照は Worker が組み立てた固定の書式なので、緩く探さない。
// 本文のどこかに現れた `#123` を拾うと、人が書き足した関連 issue の番号を
// フィードバックの本文として取りにいってしまう。
const TICKET_PATTERN = /^- Issue:\s*([\w.-]+\/[\w.-]+)#(\d+)\s*$/m;

export const parseStubIssue = (body, expectedRepo = 'TrainLCD/Issues') => {
  const matched = TICKET_PATTERN.exec(String(body ?? ''));
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
  const body = await readFile(requireEnv('STUB_BODY_PATH'), 'utf8');
  const result = parseStubIssue(body, process.env.ISSUES_REPO || 'TrainLCD/Issues');

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
