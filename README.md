# feedback-autofix

アプリに届いたフィードバックを Claude Code に読ませ、直せる不具合であれば修正の
Pull Request まで作らせる composite action です。TrainLCD の MobileApp /
StationAPI / Functions の 3 リポジトリから共通で使います。

判定と個人情報の除去、issue へ返すコメントの文面はここに 1 つだけ置いてあります。
各リポジトリに写すと、欠陥が見つかったときに 3 か所直すことになるためです。

## 何をするか

1. `TrainLCD/Issues` の issue を取得し、ラベルの条件を満たすか確かめます。
2. 本文から送信者を特定できる節とレポート画像の URL を取り除きます。
3. 同じ issue を二度扱っていないか、ブランチ・PR・コメントの 3 つで確かめます。
4. エージェントに渡すプロンプトを組み立てます。
5. （呼び出し側が Claude Code Action を走らせます）
6. 結果を issue へコメントし、最後まで進まなかった場合はジョブを落とします。

4 と 6 の間を呼び出し側に任せているのは、ツールチェーンの用意がリポジトリごとに
違うためです。判定より先に重い準備を走らせないよう、`prepare` は必ず先に通して
ください。届く issue の多くは対象外です。

## 使い方

```yaml
name: Auto Fix From Feedback

on:
  repository_dispatch:
    types: [feedback-auto-fix]
  workflow_dispatch:
    inputs:
      issue_number:
        description: "TrainLCD/Issues の issue 番号"
        required: true
        type: string

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: auto-fix-from-feedback-${{ github.event.client_payload.issue_number || inputs.issue_number }}
  cancel-in-progress: false

jobs:
  auto-fix:
    runs-on: ubuntu-22.04
    timeout-minutes: 60
    steps:
      # persist-credentials: false を外さないこと。既定の true だと、書き込み
      # 権限付きの GITHUB_TOKEN がローカルの git 設定に残り、依存のインストールの
      # postinstall とエージェントの Bash(git:*) から素で使える状態になる。
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false

      - uses: TrainLCD/feedback-autofix/prepare@v1
        id: prepare
        with:
          issue_number: ${{ github.event.client_payload.issue_number || inputs.issue_number }}
          issues_repo_token: ${{ secrets.ISSUES_REPO_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          handoffs: StationAPI,Functions
          guidelines_file: CLAUDE.md
          pr_template: .github/pull_request_template.md
          checks: |
            npm run lint
            npm test
            npm run typecheck
          scope: |
            - `src/**` のコード
            - 表示に使う定数やアセット

      # ここから先はリポジトリごとに違う。対象だったときだけ走らせる。
      - uses: actions/setup-node@v4
        if: steps.prepare.outputs.eligible == 'true'
        with:
          node-version: 24
          cache: npm
      - run: npm ci
        if: steps.prepare.outputs.eligible == 'true'

      - uses: anthropics/claude-code-action@v1
        id: claude
        if: steps.prepare.outputs.eligible == 'true'
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: ${{ steps.prepare.outputs.prompt }}
          claude_args: |
            --model claude-sonnet-5
            --allowedTools "Edit,Read,Write,Glob,Grep,TodoWrite,Bash(npm:*),Bash(git:*),Bash(gh:*),Bash(node:*)"

      # always() を外さないこと。エージェントが失敗した場合こそ報告が要る。
      - uses: TrainLCD/feedback-autofix/report@v1
        if: ${{ always() && steps.prepare.outputs.eligible == 'true' }}
        with:
          issue_number: ${{ github.event.client_payload.issue_number || inputs.issue_number }}
          issues_repo_token: ${{ secrets.ISSUES_REPO_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          branch: ${{ steps.prepare.outputs.branch }}
          verdict_path: ${{ steps.prepare.outputs.verdict_path }}
          claude_outcome: ${{ steps.claude.outcome }}
```

## リポジトリごとに変える入力

| 入力 | MobileApp | StationAPI | Functions |
| ---- | ---- | ---- | ---- |
| `guidelines_file` | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| `pr_template` | あり | あり | なし（空文字） |
| `handoffs` | `StationAPI,Functions` | `MobileApp,Functions` | `MobileApp,StationAPI` |
| `checks` | 3 つ（下記） | 7 つ（下記） | 3 つ（下記） |
| 許可する道具 | `Bash(npm:*)` ほか | `Bash(cargo:*)` `Bash(rustup:*)` ほか | `Bash(npm:*)` ほか |

### checks の中身

MobileApp:

```text
npm run lint
npm test
npm run typecheck
```

Functions（`AGENTS.md` が求める 3 つ）:

```text
npm run typecheck
npm run lint
npm test
```

StationAPI（`ci.yml` の 6 つ + データ検証の 1 つ）:

```text
cargo check -p stationapi -p stationapi-preprocessor -p data_validator
cargo check --target wasm32-unknown-unknown -p stationapi-worker
cargo test -p stationapi -p stationapi-preprocessor -p data_validator
cargo fmt --all -- --check
cargo clippy -p stationapi -p stationapi-preprocessor -p data_validator --all-targets -- -D warnings
cargo clippy --target wasm32-unknown-unknown -p stationapi-worker --all-targets -- -D warnings
cargo run -p data_validator
```

最後の `cargo run -p data_validator` は `ci.yml` には入っていません。`ci.yml` は
`paths` で `*.csv` を除いていて、CSV の検証は `verify_data_Integrity.yml` が
`cargo run -p data_validator` で行っています。エージェントには CSV も直させるので、
これを入れないと 6 つすべてを通した PR が data 検証で落ちます。

`cargo test -p stationapi-worker`（`make test` に入っている wasm 側のテスト）は
入れていません。`ci.yml` が回していないため、ここだけ厳しくすると CI が通る変更を
エージェントが自分で却下することになります。

`scope` と `checks` の字下げは気にしなくて構いません。プロンプトへ差し込む
ときに揃え直します。

`handoffs` に自分自身を入れないでください。入れても候補から落ちますが、
プロンプトに「自分へ引き継げ」と書くことになり、判断を濁らせます。

StationAPI の `scope` には `data/*.csv` を含めます。届くフィードバックの多くは
駅名・路線記号・停車駅の誤りで、これらはコードではなくデータにあります。

```yaml
          scope: |
            - `data/*.csv`（駅・路線・停車駅のデータ）
            - `stationapi/` `preprocessor/` `data_validator/` `src/` の Rust コード
```

検査は変更の中身で出し分けません。CSV だけを直した場合も 7 つすべてを通します。
出し分けるとエージェント自身に「これはデータだけの変更だ」と判断させることになり、
判断を誤ったときに検査を素通りします。

## 必要な secret

| secret | 用途 |
| ---- | ---- |
| `ANTHROPIC_API_KEY` | Claude Code Action の認証 |
| `ISSUES_REPO_TOKEN` | `TrainLCD/Issues` の issue 取得とコメント投稿 |

`ISSUES_REPO_TOKEN` に要る権限は `TrainLCD/Issues` の Issues (read and write)
だけです。どちらかを設定し忘れていると、警告を出すだけで何もせずに終わります。

## 設計上の判断

**生成された PR は必ず人がレビューします。** エージェントは実機で症状を再現
できません。確かめないまま書いた修正なので、自動マージはしません。

**issue の本文は信用できない入力として扱います。** 誰かが内容を確かめる工程は
ありません。個人情報を取り除き、プロンプトのタグと同じ綴りを置き換えたうえで
データとして渡していますが、プロンプトインジェクションの抜け道を完全には
ふさげません。

**エージェントには書き込み経路が残ります。** push と PR の作成は Claude Code
Action が行い、エージェントには `Bash(git:*)` と `Bash(gh:*)` を許可しています。
プロンプトに書いた制約は認証の境界ではありません。人がレビューする前提を
崩さないでください。

**結果は必ず issue へ返します。** PR が出来たならそのリンク、直せないなら理由、
最後まで進まなかったならどこで止まったのかを投稿します。何も言わずに終わる
場合は作っていません。

## 開発

```bash
npm test
```

Node 24 の標準テストランナーだけで動きます。依存はありません。`scripts/` の
コードに npm 依存を静的 import しないでください。
