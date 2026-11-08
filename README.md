# FreeGameHub

## Cloudflare Pages の設定

Cloudflare Dashboard で **Workers & Pages → Create application → Pages → Connect to Git** から GitHub リポジトリを接続します。ビルド設定は次のとおりです。

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: リポジトリのルート
- Production branch: リポジトリの既定ブランチ

Pages はコミットを受けてビルドし、`dist` の内容を公開します。設定画面の名称や場所は Cloudflare の UI 更新で変わる場合があります。[Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)

## GitHub Actions の手動運用

`.github/workflows/update.yml` は UTC の `0, 6, 12, 18` 時（1日4回）の定期実行と `workflow_dispatch` による手動実行を定義しています。`Actions` タブで **Update FreeGameHub data** を選び、既定ブランチに対して **Run workflow** を実行します。ジョブは既定ブランチ以外では動かず、更新があった場合だけ `public/` の変更をコミットして push します。差分がなければコミットしません。

`.github/workflows/ci.yml` は PR と `main` への push で型チェック・テスト・ビルド・依存関係監査を実行します。Android 実機テストは CI の対象外です。

P4 の手動実行は確認済みです。更新を [run 42482039934](https://github.com/4getkun/FreeGameHub/actions/runs/42482039934)、差分なし時のコミット省略を [run 42482090574](https://github.com/4getkun/FreeGameHub/actions/runs/42482090574) で確認しました。workflow の `environment: production` は設定されていますが、現在の private リポジトリ／GitHub Free で Environment の保護・Secrets が利用でき、強制されるかは未確認です。GitHub の公式仕様では private リポジトリの Environment secrets 利用に Pro、Team または Enterprise が必要とされています。将来登録する Secrets は `production` Environment 用とし、リポジトリ Secrets には登録しないでください。利用可否が確認できるまで秘密値を登録しないでください。[Workflow の手動実行](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-running-a-workflow) · [Environments の利用条件](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [Environment secrets](https://docs.github.com/en/actions/concepts/security/secrets)

## Secrets を登録する前のチェックリスト

1. リポジトリを public にし、その時点で Git 履歴を再検査する。
2. `production` Environment の `main` 限定ルールが実際に強制されることを確認する。public リポジトリでは無料で保護設定を利用できる。
3. その後で初めて、必要な Secrets を `production` Environment に登録する。

**Environment 保護の実効性は、private リポジトリでは未確認。Secrets の登録前に必ず確認すること。**

## Groq による紹介文の生成

GitHub のリポジトリで **Settings → Environments → production → Add secret** を開き、`GROQ_API_KEY` を登録します。キーは [Groq Console の API Keys](https://console.groq.com/keys) で作成します。`GROQ_MODEL` は任意の Environment variable (`vars`) で、未設定時は `config.json` の `groqModel` を使います。初期値のモデル ID は `openai/gpt-oss-120b` です。キー未設定時は要約処理を省略します。[Groq Quickstart](https://console.groq.com/docs/quickstart)

## 通知チャネルの共通設定

通知チャネルは任意です。workflow に設定した Environment の `production` 内で、チャネルの認証値は **Environment secrets**、絞り込みや URL などの非秘密設定は **Environment variables** (`vars`) に登録します。チャネル用の値を repository secrets に登録しないでください。Environment secrets を安全に使える状態か確認できていないため、その確認が済むまでは認証値を登録しないでください。

`*_STORES` は任意のカンマ区切りストア絞り込み（`epic`, `steam`, `gog`, `itch`, `prime`, `other`）、`*_TYPES` は任意のカンマ区切り種別絞り込み（`game`, `dlc`, `loot`, `beta`, `other`）です。未設定のストア絞り込みは全ストア対象、種別絞り込みは `game` のみが対象です。以下に各チャネルの必要値と取得方法を記します。

### Discord

- Secret: `DISCORD_WEBHOOK_URL`（必須）、`DISCORD_ROLE_ID`（任意。`new` 通知でメンションするロール ID）
- Variables: `DISCORD_STORES`, `DISCORD_TYPES`（任意）
- 取得: Discord サーバーの **Server Settings → Integrations → Webhooks** で webhook を作成し、URL をコピーします。ロールメンションを使う場合は Discord の開発者モードで対象ロール ID をコピーします。[Discord Webhooks](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)

### ntfy

- Secret: `NTFY_TOPIC`（必須。推測されにくいトピック名を指定）
- Variables: `NTFY_SERVER`（任意。未設定時 `https://ntfy.sh`）、`NTFY_STORES`, `NTFY_TYPES`（任意）
- 取得: [ntfy アプリ](https://ntfy.sh/) または Web アプリで任意のトピックを購読し、その同じ名前を `NTFY_TOPIC` に設定します。ntfy.sh のトピック名は公開されるため、名前を秘密として扱ってください。[ntfy Getting Started](https://docs.ntfy.sh/)

### 汎用 Webhook

- Secret: `GENERIC_WEBHOOK_URL`（必須）
- Variables: `WEBHOOK_STORES`, `WEBHOOK_TYPES`（任意）
- 取得: POST と JSON を受け取れる通知先の URL を用意します。このチャネルは外部サービスを特定していないため、URL の発行方法は通知先の提供元に従ってください。送信 JSON は `{ game, kind, upcoming }` で、`upcoming` は Epic の `new` 通知以外では空配列です。

### Slack

- Secret: `SLACK_WEBHOOK_URL`（必須）
- Variables: `SLACK_STORES`, `SLACK_TYPES`（任意）
- 取得: Slack API の手順でアプリを作成し、Incoming Webhooks を有効にして **Add New Webhook to Workspace** から投稿先チャンネルを選びます。[Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)

### Telegram

- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`（両方必須）
- Variables: `TELEGRAM_STORES`, `TELEGRAM_TYPES`（任意）
- 取得: Telegram の `@BotFather` に `/newbot` を送り bot を作成して token を取得します。bot を投稿先チャットに加え、チャット ID を確認して `TELEGRAM_CHAT_ID` に設定します。[Telegram Bots](https://core.telegram.org/bots)

### Bluesky

- Secrets: `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`（両方必須。通常のアカウントパスワードは使わない）
- Variables: `BLUESKY_SERVICE_URL`（任意。未設定時 `https://bsky.social`）、`BLUESKY_STORES`, `BLUESKY_TYPES`（任意）
- 取得: `BLUESKY_HANDLE` は投稿アカウントのハンドルです。Bluesky の **Settings → Advanced → App Passwords** でアプリパスワードを作成します。[Bluesky App Passwords](https://bsky.app/settings/app-passwords) · [AT Protocol API](https://docs.bsky.app/)

### Mastodon

- Secret: `MASTODON_ACCESS_TOKEN`（必須）
- Variables: `MASTODON_BASE_URL`（必須。利用するインスタンスのベース URL）、`MASTODON_STORES`, `MASTODON_TYPES`（任意）
- 取得: 利用インスタンスのアプリ設定でアプリを登録し、投稿用の権限を付けたユーザーアクセストークンを取得します。インスタンスの URL とトークンをそれぞれ設定します。[Mastodon: Obtaining client app access](https://docs.joinmastodon.org/client/token/) · [Mastodon OAuth](https://docs.joinmastodon.org/client/authorized/)

## Android 実機テスト

USB デバッグに対応した Android 端末を USB で接続し、端末側で USB デバッグを有効にします。初回接続時は端末に表示される USB デバッグ許可ダイアログを確認し、この PC からの接続を許可してください。テスト中は端末の画面を点灯したままにし、画面ロックを解除しておきます。画面消灯やロック状態では操作・画面確認が失敗することがあります。

リポジトリのルートで次を実行します。

```sh
npm run test:device:smoke
npm run test:device
```

`test:device:smoke` は短い接続・起動確認、`test:device` は実機テスト一式を実行します。レポートは `device-report\report.md` と `device-report\report.json` に保存され、画面キャプチャ PNG も `device-report\` 内に出力されます。実行ごとに前回レポートが更新されるため、必要な結果は次回実行前に退避してください。

### 接続・実行時のトラブル

- **adb が見つからない／端末が一覧に出ない:** Android SDK Platform-Tools をインストールし、その `platform-tools` ディレクトリを `PATH` に追加します。USB ケーブルをデータ通信対応のものに替え、端末の USB 接続モードと USB デバッグ設定を確認してから再接続します。`adb devices` で端末が表示されることを確認してください。
- **`unauthorized` と表示される:** 端末のロックを解除し、表示された「USB デバッグを許可しますか？」で許可します。ダイアログが出ない場合は USB を抜き差しして再接続します。
- **ポート競合:** 開発サーバー用ポートを別プロセスが使用しています。別のデバイステストや開発サーバーを終了してから再実行してください。使用中のプロセスが分からない場合は、OS のポート使用状況から該当プロセスを確認して終了します。
