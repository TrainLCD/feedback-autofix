# feedback-autofix

アプリに届いたフィードバックを Claude Code に読ませ、直せる不具合であれば修正の
Pull Request まで作らせる composite action です。TrainLCD の MobileApp /
StationAPI / Functions の 3 リポジトリから共通で使います。

判定と個人情報の除去、issue へ返すコメントの文面はここに 1 つだけ置いてあります。
各リポジトリに写すと、欠陥が見つかったときに 3 か所直すことになるためです。

## 何をするか

0. 自分のリポジトリに立ったスタブ issue の本文から、管理チケットの番号を取ります。
1. `TrainLCD/Issues` の管理チケットを取得し、ラベルの条件を満たすか確かめます。
2. 本文から送信者を特定できる節とレポート画像の URL を取り除きます。
3. 同じ issue を二度扱っていないか、ブランチ・PR・コメントの 3 つで確かめます。
4. エージェントに渡すプロンプトを組み立てます。
5. （呼び出し側が Claude Code Action を走らせます）
6. 結果を issue へコメントし、最後まで進まなかった場合はジョブを落とします。

4 と 6 の間を呼び出し側に任せているのは、ツールチェーンの用意がリポジトリごとに
違うためです。判定より先に重い準備を走らせないよう、`prepare` は必ず先に通して
ください。届く issue の多くは対象外です。

## 起点はスタブ issue です

原因がどのリポジトリにあるかは、`TrainLCD/Functions` のフィードバックトリアージが
本文を読んで判定済みです。信頼度が `PUBLIC_ISSUE_MIN_CONFIDENCE`（0.7）を超えると、
そのリポジトリにスタブ issue を立てます。

```text
アプリ → Worker → TrainLCD/Issues に管理チケット（非公開・原文あり）
                → 原因のリポジトリにスタブ issue（公開・参照だけ）
                                    ▼
                  そのリポジトリの workflow が issues: opened で起動
                  本文から管理チケット番号を読み、Issues 側から本文を取得
                  → エージェントが修正 → PR
```

スタブ issue の本文はこの形です。原文・要約・端末情報は入りません。

```text
## 管理チケット
- Issue: TrainLCD/Issues#1277
- チケットID: `268bc14a-...`
```

**振り分けをやり直さないでください。** どこかのリポジトリを窓口にして、そこの
エージェントに原因を調べさせてから回すと、データ起因が多い現状では毎回ムダな
1 往復になります。自分のところに立っていること自体が振り分けの答えです。

### 振り分けが外れた場合

エージェントが「原因は別のリポジトリにある」と判断したら、`report` が引き継ぎ先に
同じ形のスタブ issue を立て、そのあとで結果を管理チケットにコメントします。向こうは
自分に立った issue に反応するので、経路は Worker のときと同じです。`handoff_token` を
空にすると、コメントに名前が出るだけで向こうは動きません。

**順番を入れ替えないでください。** 先にコメントを投稿すると、issue を立てられなかった
ときに「済み」の目印だけが管理チケットに残ります。`prepare` は次からそこで打ち切るので、
引き継ぎは起きないまま二度と動かなくなります。issue を立てられなかった場合は、
コメントを失敗の報告へ差し替えます。目印が変わるので、もう一度試せます。

同じスタブを二度立てないよう、作る前に引き継ぎ先を題名で探します。コメントの投稿に
失敗して再実行したときに、向こうへ同じ issue が並ぶのを防ぐためです。検索そのものが
失敗した場合は issue を立てずに終えます。「1 件も無い」のか「調べられなかった」のかを
区別できないまま作ると、スタブが 2 つ並びます。

この確認は、同じ管理チケットの実行が直列に走ることが前提です。並行して走ると、両方が
「1 件も無い」を受け取ってから両方が作ります。そのため「使い方」の workflow では `concurrency`
をスタブ issue の番号ではなく題名で束ねています。題名には管理チケットへの参照が入って
いるので、同じチケットを指すスタブはグループが揃います。

直列になるのは 1 つのリポジトリの中だけです。`concurrency` のグループはリポジトリごとに
分かれているので、違うリポジトリから同じ引き継ぎ先へ同時に回った場合は揃いません。
これが起きるには、同じ管理チケットのスタブが 2 つのリポジトリに同時に立っている必要が
あります。

行ったり来たりは目印が止めます。管理チケットへ書くコメントの目印にはリポジトリ名が
入っていて（`<!-- auto-fix-from-feedback:TrainLCD/MobileApp -->`）、`prepare` は
自分の目印だけを探します。StationAPI から MobileApp へ戻ってきても、MobileApp は
すでに自分の目印を残しているので、そこで打ち切られます。

目印を共通の綴りにしないでください。最初に結果を書いたリポジトリのコメントが
残りの 2 つを止め、手動で叩いても動かなくなります。

## 誰が立てた issue かを確かめます

対象の 3 リポジトリはどれも公開されていて、issue は誰でも立てられます。本文の
書式だけを見て管理チケットの番号を受け取ると、第三者が

```text
## 管理チケット
- Issue: TrainLCD/Issues#1200
```

と書いた issue を立てるだけで、`ISSUES_REPO_TOKEN` が非公開チケットの本文を
取りに行き、エージェントへ渡してしまいます。そこから公開 PR に内容が出ます。

そのため `allowed_authors` に挙げたアカウントが立てた issue だけを対象にします。
照合するのは login ではなく数値の ID です。login は本人が変更でき、手放された
名前は他人が取得できますが、ID は作り直せません。`allowed_authors` が空のときは
どのスタブ issue も対象になりません。設定を忘れたまま素通りするより、動かないほうが
気づけるためです。

現在スタブ issue を立てているのは TinyKitten（ID `32848922`）です。`TrainLCD/MobileApp`
の issue #6994 を API で取得すると `user.id` がこの値になります。Worker のトークンを
別のアカウントへ移したら、3 リポジトリの `allowed_authors` も一緒に変えてください。

引き継ぎで立つスタブ issue の作成者は `HANDOFF_ISSUE_TOKEN` のアカウントです。
Worker と違うアカウントのトークンを使うなら、その ID も `allowed_authors` に足して
ください。足さないと引き継ぎ先が issue を受け取っても動きません。複数の ID は
カンマで区切ります。

## 使い方

```yaml
name: Auto Fix From Feedback

on:
  # Worker がこのリポジトリに立てるスタブ issue を起点にする。
  issues:
    types: [opened]
  # 取りこぼしをやり直すときと、スタブを介さず動かすときに使う。
  workflow_dispatch:
    inputs:
      issue_number:
        description: "TrainLCD/Issues の issue 番号"
        required: true
        type: string

permissions:
  contents: write
  # prepare がスタブ issue を GITHUB_TOKEN で取得する。permissions を書いた時点で
  # 挙げなかった権限は none になるので、これを省くとそこで止まる。
  issues: read
  pull-requests: write

# 同じ管理チケットに対する実行を直列にする。スタブ issue の番号で束ねると、同じ
# チケットを指すスタブが 2 つあったときに別のグループへ入って同時に走る。エージェントが
# 2 つ動き、同じ名前のブランチを取り合い、引き継ぎ先にも issue が 2 つ立つ。
#
# 題名には管理チケットへの参照が入っていて、Worker が立てるものも report が立てる
# ものも同じ形なので、これで同じチケットは同じグループに入る。cancel-in-progress を
# false にしてあるので後続は待たされ、先行が結果を書き終えてから動き出す。そこで
# prepare の重複確認に引っかかって打ち切られる。
concurrency:
  # 題名にコロンが入るので、値全体を引用符で囲むこと。囲まないと YAML が
  # そこでキーの区切りと読み、workflow を読み込めなくなる。
  group: "auto-fix-from-feedback-${{ github.event.issue.title || format('フィードバック対応: {0}#{1}', 'TrainLCD/Issues', inputs.issue_number) }}"
  cancel-in-progress: false

jobs:
  auto-fix:
    runs-on: ubuntu-22.04
    timeout-minutes: 60
    steps:
      # action は可変タグではなく commit SHA で固定すること。理由は「action は
      # SHA で固定してください」に書いてある。
      #
      # persist-credentials: false を外さないこと。既定の true だと、書き込み
      # 権限付きの GITHUB_TOKEN がローカルの git 設定に残り、依存のインストールの
      # postinstall とエージェントの Bash(git:*) から素で使える状態になる。
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          ref: ${{ github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false

      - uses: TrainLCD/feedback-autofix/prepare@406de875a89dd1e640f8b66b71d4de9516a952ca # v1
        id: prepare
        with:
          stub_issue_number: ${{ github.event.issue.number }}
          issue_number: ${{ inputs.issue_number }}
          # スタブ issue の作成者として認める数値 ID。詳しくは下記。
          allowed_authors: "32848922"
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
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        if: steps.prepare.outputs.eligible == 'true'
        with:
          node-version: 24
          cache: npm
      - run: npm ci
        if: steps.prepare.outputs.eligible == 'true'

      - uses: anthropics/claude-code-action@cfc3eb22bfed5c26ef66e3223c982af27e4524de # v1
        id: claude
        if: steps.prepare.outputs.eligible == 'true'
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: ${{ steps.prepare.outputs.prompt }}
          claude_args: |
            --model claude-sonnet-5
            --allowedTools "Edit,Read,Write,Glob,Grep,TodoWrite,Bash(npm:*),Bash(git:*),Bash(gh:*),Bash(node:*)"

      # always() を外さないこと。エージェントが失敗した場合こそ報告が要る。
      - uses: TrainLCD/feedback-autofix/report@406de875a89dd1e640f8b66b71d4de9516a952ca # v1
        if: ${{ always() && steps.prepare.outputs.eligible == 'true' }}
        with:
          issue_number: ${{ steps.prepare.outputs.issue_number }}
          issues_repo_token: ${{ secrets.ISSUES_REPO_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          branch: ${{ steps.prepare.outputs.branch }}
          verdict_path: ${{ steps.prepare.outputs.verdict_path }}
          claude_outcome: ${{ steps.claude.outcome }}
          # 引き継ぎ先に issue を立てられるトークン。省くと引き継ぎは起きない。
          handoff_token: ${{ secrets.HANDOFF_ISSUE_TOKEN }}
```

## action は SHA で固定してください

このワークフローのジョブは `contents: write` と `pull-requests: write` を持ち、
`ISSUES_REPO_TOKEN` と `ANTHROPIC_API_KEY` を渡します。`@v1` のような可変タグのままに
すると、タグが差し替えられた時点でその内容がこの権限で動きます。

`prepare` は非公開の管理チケットを読めるトークンを受け取るので、外部の action より
むしろ厳しく固定してください。このリポジトリの `v1` タグは実際に 1 度付け替えており、
「タグは動く」という前提は仮定ではありません。

版はコメントで残します。タグは人が読むためのもので、実行するものではありません。

```yaml
- uses: TrainLCD/feedback-autofix/prepare@406de875a89dd1e640f8b66b71d4de9516a952ca # v1
```

SHA は `git ls-remote` で確かめてください。注釈付きタグの場合、使うのはタグ
オブジェクトではなく `refs/tags/<タグ>^{}` が指すコミットです。

```bash
git ls-remote https://github.com/TrainLCD/feedback-autofix 'refs/tags/v1' 'refs/tags/v1^{}'
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
| `HANDOFF_ISSUE_TOKEN` | 引き継ぎ先のリポジトリに issue を立てる（任意） |

`ISSUES_REPO_TOKEN` に要る権限は `TrainLCD/Issues` の Issues (read and write)
だけです。`ANTHROPIC_API_KEY` と合わせて、どちらかを設定し忘れていると、警告を
出すだけで何もせずに終わります。

`HANDOFF_ISSUE_TOKEN` は引き継ぎ先のリポジトリに issue を立てるために使います。
fine-grained token なら、引き継ぎ先の 2 リポジトリに対する **Issues: write** が
要ります（[GitHub の権限表](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)で
`POST /repos/{owner}/{repo}/issues` の行）。

設定しなければ引き継ぎは起きず、コメントに名前が出るだけになります。Worker の
振り分けが外れたときだけ使うので、後回しにしても通常の経路は動きます。

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
