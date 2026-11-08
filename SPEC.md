# FreeGameHub 仕様書 v0.2

無料配布ゲームの日本語トラッカー。運用コストは0円（Cloudflare Pages + GitHub Actions の無料枠のみ）。

- 配置: `C:\Github\FreeGameHub`
- 技術: TypeScript（strict）/ Vite（vanilla-ts、フレームワークなし）/ Tailwind CSS **v3**（3.4.x）/ Vitest / tsx
- 実装者: GPT-6.1 Terra 級を想定（第1節のルールに従うこと）
- 優先順位: 機能 → 疎結合の維持 → 最後にデザイン仕上げ
- 実行環境: Windows（ローカル）と GitHub Actions（ubuntu）の両方で動くこと。bash 専用のコマンドを npm scripts に書かない

---

## 1. 実装者向けルール（Terra 級前提）

Terra は視覚理解・繰り返し作業に強く、コーディングも実用水準だが、最難関の設計判断は上位モデルの領分とされている。判断の余地を減らす。

- 1ファイル1責務。モジュール間の入出力は本書の「契約」だけに従う
- 契約（型・関数シグネチャ）は本書が正。変更したい場合は実装せず質問する
- 推測で仕様を足さない。不明点は質問する
- 純粋関数（status 計算、重複除去、通知対象の判定など）には Vitest のテストを書く。フェーズの受入条件は、実際に `npm test` や実行コマンドで確認する
- 触ってよいファイルの範囲をフェーズごとに守る
- 取得元APIの返却形式は、書く前に実際にリクエストして確認する
- **Tailwind は v3 を使う**。`tailwindcss@^3.4`、`postcss`、`autoprefixer`、`tailwind.config.ts`。v4 の記法（`@import "tailwindcss"`、`@theme`、`@tailwindcss/vite`）は使わない

---

## 2. 参考にした海外サービスと、取り入れる点

調査した類似サービスの良い点を、静的サイト＋cron という制約に収まる範囲で取り入れる。

- LootScraper（OSS）: ストア別のRSS・ページ・通知チャネル、全ソース1ページ、過去分のアーカイブページ → **ストア別RSS＋全体RSS、ストア絞り込み、終了済みの履歴表示**
- FreeGamesNotifier 系の Discord ボット: 配布開始の24時間前の予告、ストア別ルーティング、ジャンル絞り込み、ロールメンション → **開始予告（upcoming）、チャネルごとのストア／種別フィルタ、Discord のロールメンション**
- MercuryBot: Epic の「来週の無料ゲーム」を同じ通知に添える → **新規通知に次回予告を同梱**
- GamerPower: 種別（本体／DLC／ゲーム内アイテム／ベータ）の区別と、通常価格相当の金額 → **種別タブ、「通常価格相当」の表示**
- Free Games Radar / Budget Gamer / Free Games Hub: 終了前のリマインド → **終了24時間前の通知（1回）**
- 差別化（日本語圏向け）: 日本時間での表示、残り時間カウントダウン、日本語の一行要約、「受け取り済み」の記録（ブラウザ内）

### 対象外（理由つき）
- 自動受け取り（アカウント操作）: 各ストアの規約リスクがあるため対象外
- Steam ウィッシュリスト連携・価格追跡・セール情報: サーバーとユーザーデータが必要で、無料の静的運用の方針と合わないため対象外
- メールのダイジェスト配信: 将来の拡張（通知チャネルの追加で対応可能）

---

## 3. 全体構成（疎結合）

```
[fetchers] → [merge] → [store] → [outputs: RSS]
                         ↑   ↘ [notifiers]（new / ending-soon）
                      [enrich]
                    （Groq要約）          [site]（UI：機能層 / デザイン層を分離）
```

結合点は `public/data/games.json`（契約A）だけ。各モジュールは他モジュールの内部を import しない。ただし `src/shared/` は共有部品として、scripts と site の両方から import してよい。

```
FreeGameHub/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts
  tailwind.config.ts, postcss.config.js, config.json
  index.html                      # 構造のみ（役割クラスのみ）
  public/
    data/        games.json, notified.json
    feeds/       all.xml, epic.xml, steam.xml ...（ストア別）
  src/
    shared/      types.ts（契約A）, schema.ts, status.ts, format.ts
    ui/          main.ts, state.ts, render.ts, templates.ts, countdown.ts, storage.ts
    styles/      index.css, tokens.css, components.css   # デザイン層（P7 で作り込む）
  scripts/       run.ts, merge.ts, store.ts, enrich.ts, validate.ts
    fetchers/    epic.ts, gamerpower.ts
    outputs/     rss.ts
    notifiers/   index.ts, discord.ts, slack.ts, telegram.ts, ntfy.ts,
                 bluesky.ts, mastodon.ts, webhook.ts
  tests/         各純粋関数のテスト
  .github/workflows/update.yml
  README.md
```

ビルドとデプロイ:
- Cloudflare Pages（Git連携）。ビルドコマンド `npm run build`（`vite build`）、出力 `dist`
- `public/` 配下は、そのまま `dist/` に配信される
- データ更新のコミットが Pages のビルドを起こす（1日4回程度で、月500回の枠に収まる）

---

## 4. 契約

### 契約A: `src/shared/types.ts`（正）と `public/data/games.json`

```ts
export type Store = "epic" | "steam" | "gog" | "itch" | "prime" | "other";
export type GameType = "game" | "dlc" | "loot" | "beta" | "other";
export type Status = "active" | "upcoming" | "ended";

export interface Game {
  id: string;                 // 例: "epic:<offerId>" / "gamerpower:<id>"
  title: string;              // 表示用（Epic は日本語タイトル）
  titleEn: string | null;     // 照合用の英語タイトル（Epic は en-US の応答から、GamerPower は正規化後のタイトル）
  store: Store;
  type: GameType;
  url: string;
  imageUrl: string | null;
  startAt: string | null;     // ISO8601 UTC
  endAt: string | null;       // ISO8601 UTC
  status: Status;
  endApprox: boolean;         // true: endAt は日付のみ有効（時刻は不正確）。GamerPower 由来で Epic に上書きされていないもの
  worthUsd: number | null;    // 通常価格相当（取得元が持つ場合のみ）
  source: "epic" | "gamerpower";
  descriptionOrig: string | null;
  summaryJa: string | null;
}

export interface GamesFile { updatedAt: string; games: Game[]; }
```

- `src/shared/schema.ts` に、同じ形の zod スキーマを置く。`scripts/validate.ts` と読み込み時の検証に使う
- `status` は `src/shared/status.ts` の純粋関数 `computeStatus(game, now)` で再計算する（merge と UI の両方が使う）
- `endAt` が null の場合は `active` とし、UIでは「終了日時不明」と表示する
- 終了後30日を超えたものは store が削除する

### 契約B: fetcher

```ts
// scripts/fetchers/*.ts
export async function fetchGames(): Promise<Omit<Game, "status" | "summaryJa">[]>
```

- 失敗時は例外を投げる。`run.ts` が捕捉し、他の取得元は続行する
- 全ての取得元が失敗した場合、`games.json` は更新しない（前回データを保持）
- Epic は、現在配布中のものと、次回以降の配布予定（upcoming）の両方を返す

### 契約C: enrich

```ts
export async function enrich(games: Game[], opts: { max: number }): Promise<Game[]>
```

- `summaryJa` が空で、`descriptionOrig` があるものだけが対象。1回の実行で最大 `max` 件（既定30）
- 失敗した件は空のまま返す（落とさない）

### 契約D: notifier

```ts
// scripts/notifiers/<name>.ts
export type NotifyKind = "new" | "ending-soon";
export interface NotifyContext { upcoming: Game[]; }   // 次回予告の同梱用

export const name: string;                                       // 例: "discord"
export function isEnabled(env: NodeJS.ProcessEnv): boolean       // 必要なシークレットが揃っているか
export async function send(game: Game, kind: NotifyKind, ctx: NotifyContext, env: NodeJS.ProcessEnv): Promise<void>
```

- `notifiers/index.ts` は、各チャネルを登録簿にまとめるだけ。チャネルの追加は「ファイルを1つ足す」だけで済み、他のコードは変更しない
- `run.ts` は `isEnabled` が真のチャネルにだけ `send` を呼ぶ
- 1つのチャネルが失敗しても、他のチャネルと全体の処理は続行する

---

## 5. 機能仕様

### 5.1 取得
- Epic Games Store の無料配布（日本向け: locale=ja, country=JP）。配布中と配布予定の両方
- GamerPower の giveaways API（認証不要）。種別（type）・通常価格相当（worth）・終了日時を取り込む
- 取得頻度は GitHub Actions の cron で1日4回

### 5.2 マージ
- 重複は1件にまとめ、Epic 公式のデータを優先する。同一ゲームかどうかは、次の規則だけで判定する（これ以外の曖昧な一致は採用しない）
  - 前提: `store` が同じで、かつ `type` も同じであること（規則1・規則2の両方に適用する。例: Epic の本体と GamerPower の DLC は、タイトルが前方一致しても統合しない）
  - `type` が違うだけで、規則1または規則2の他の条件には当たる組は、統合せずにログに「候補」として出力する（人間が後から確認できるように）
  - タイトルの正規化 `normalizeTitle`: Unicode の NFKC 正規化 → 小文字化 → 記号・商標記号（™ ® © : - ! など）を除去 → 連続する空白を1つにまとめて前後を除く
  - 規則1（主）: `normalizeTitle(titleEn)` 同士、または `normalizeTitle(title)` 同士が完全一致
  - 規則2（予備。規則1で一致せず、かつ両方の `endAt` が非 null で、**終了日（UTC の年月日）が同じ**場合のみ）: 一方の正規化タイトルが、もう一方の先頭と**単語境界で**一致する（例: `flotsam` と `flotsam 漂流ガラクタウン`）。短すぎる誤一致を避けるため、前方一致する側は4文字以上とする
  - 規則2で統合した場合は、ログに「両方のタイトルと終了日」を出力して、後から人間が確認できるようにする
  - 上記のどれにも当たらなければ、統合しない（別ゲームとして残す）
- Epic の取得は、`locale=ja` に加えて `locale=en-US` でも行い、同じオファー（offerId 等の共通ID）同士を突き合わせて `titleEn` を作る。en-US の取得に失敗しても、Epic の取得全体は失敗にせず `titleEn: null` で続行する
- GamerPower の platform / type を `Store` / `GameType` に対応づける（対応表は `config.json` に置く）

#### GamerPower の取り込みルール（v0.2.1 で確定）
- 日時（`published_date`, `end_date`）: 文字列は UTC として扱い、`Z` を付けて ISO8601 に変換する
- **`end_date` の時刻は信頼しない（確定事項）**: Epic と GamerPower の両方に載っている Flotsam で、Epic は `2026-11-12 16:00 UTC`、GamerPower は `2026-11-12 23:59:00` だった。日付は一致し、時刻だけが違うため、タイムゾーンのずれではなく、GamerPower の終了時刻は日付のみの精度で、時刻部分は `23:59:00` の仮の値だと判断する。したがって GamerPower 由来の `endAt` は **`endApprox: true`** とする（Epic 由来、またはEpicで上書きしたものは `false`）
- 追加確認: 実装時に、取得した GamerPower の全件について、`end_date` の時刻部分の分布（`23:59:00` が何件か、それ以外が何件か）を数えて報告する。`23:59:00` 以外が多い場合は、方針を見直すので止めて報告する
- `end_date` が `"N/A"` のときは `endAt: null`（`endApprox: false`）、`published_date` は `startAt` にする
- `platforms` はカンマ区切りの文字列（例: `"PC, Steam"`）。分割して前後の空白を除き、大文字小文字を区別せずに照合する
- `store` は次の優先順で、最初に一致したものを1つ採用する: `epic`（"Epic Games Store"）→ `steam` → `gog` → `itch`（"itch.io"）→ `prime`（"Prime Gaming" / "Amazon"）。どれにも一致しなければ `other`。`"PC"` と `"DRM-Free"` は店舗ではないので無視する。コンソール（PS4/PS5/Xbox/Switch）やモバイル（Android/iOS）のみの場合は `other`
- `type`: 大文字小文字を区別せず、`game`→`game`、`dlc`→`dlc`、`loot`→`loot`、`beta` と `early access`→`beta`、それ以外→`other`
- `worth`: `"$9.99"` のような文字列を数値にして `worthUsd` に入れる。`"N/A"` など数値にできないものは null
- タイトル: GamerPower は `"○○ (Steam) Giveaway"` の形式なので、末尾の `"(…) Giveaway"` と `"Giveaway"` を取り除いた文字列を `title` とする（重複判定にも、この正規化後のタイトルを使う）
- `url` は `open_giveaway_url`（無ければ `gamerpower_url`）。`id` は `"gamerpower:<id>"`
- Epic と重複した場合は、Epic の `startAt` / `endAt` / `url` / `imageUrl` / `type` を優先し、GamerPower からは `worthUsd` だけを補う（`type` は、型が同じことが統合の条件なので補わない）
- Epic の `type`: オファーの種別から決める。本体（BASE_GAME 相当）→ `game`、追加コンテンツ（ADD_ON / DLC 相当）→ `dlc`、判別できないもの→ `other`。実データで、種別を表すフィールドを確認してから実装する

### 5.3 AI要約（Groq）
- 新規ゲームのみ、日本語の一行紹介（60字以内）を生成する
- 入力は取得元の説明文・ストア名のみ。「入力に書かれていない事実は書かない」を指示する
- モデル名は `config.json` の `groqModel`（環境変数 `GROQ_MODEL` で上書き可）。直書き禁止
- 実装時に Groq の現行モデル一覧を確認し、無料枠で使える日本語に強いものを初期値にする
- 無料枠の目安: 1,000リクエスト/日・20万トークン/日/モデル
- `GROQ_API_KEY` が無くても全体が動く

### 5.4 出力（RSS）
- `public/feeds/all.xml` と、ストア別の `<store>.xml`（RSS 2.0）。新規に配布開始したもののみ item 追加。guid は `startAt` がある場合 `<id>@<startAt>`、`null` の場合 `<id>` とし、`isPermaLink=false` とする。同じ ID の再配布でも開始日時が異なれば別 item として追加し、既存 item は保持する
- 本体（`type=game`）以外は、タイトルに種別のラベルを付ける（例: 「[DLC] …」）

### 5.5 通知
- 種別は2つ: `new`（新たに `active` になった）と `ending-soon`（終了24時間以内になった。1ゲームにつき1回）。**`endApprox: true` のものは `ending-soon` の対象外**にする（時刻が不正確なため）。`new` 通知の終了表示は、日付のみ（例: 「11/12まで」）にする
- Epic の `new` 通知には、`ctx.upcoming` から次回予告（「次回: ○○（開始日JST）」）を同梱する
- 通知済みは `public/data/notified.json` に、`{ "<id>@<startAt>:<kind>": ["discord", "ntfy"] }`（開始日時が `null` の場合は `{ "<id>:<kind>": [...] }`）の形で記録する。同じ ID の再配布でも開始日時が異なれば新しい通知として扱う。あるチャネルだけ失敗した場合は、そのチャネルのみ次回再送する
- シークレットが無いチャネルは自動でスキップする（落ちない）
- 初回実行時は、既存の配布中ゲームを「通知済み」として記録するだけで送信しない（過去分の一斉送信を防ぐ）
- 1回の実行あたりの送信数に上限（チャネルごとに10件）を設ける
- チャネルごとのフィルタ（環境変数、任意）: `<CHANNEL>_STORES`（例: `epic,steam`）、`<CHANNEL>_TYPES`（例: `game`。既定は `game` のみ）。未設定なら全ストア・本体のみ
- Discord のみ `DISCORD_ROLE_ID` を設定すると、`new` 通知にロールメンションを付ける

#### 対応チャネル（すべて無料）
- Discord: webhook（`DISCORD_WEBHOOK_URL`）。画像付きの埋め込み形式
- Slack: Incoming Webhook（`SLACK_WEBHOOK_URL`）
- Telegram: Bot API（`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`）
- ntfy: ntfy.sh（`NTFY_TOPIC`、任意で `NTFY_SERVER`）。アカウント不要のスマホプッシュ。トピック名は推測されにくい文字列にする
- Bluesky: 投稿（`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`）。アプリパスワードを使う。リンクカード付き
- Mastodon: 投稿（`MASTODON_BASE_URL`, `MASTODON_ACCESS_TOKEN`）
- 汎用 webhook: 任意URLへ、`{ game, kind, upcoming }` をJSONでPOST（`GENERIC_WEBHOOK_URL`）。IFTTT / Zapier / Make などの連携口
- X(Twitter) は、無料枠での投稿条件を未確認のため今回は対象外。契約Dに従って、後から追加できる

### 5.6 サイト（機能層）
- `public/data/games.json` を fetch して描画する。他のデータ源には依存しない
- 区分: 配布中 / もうすぐ終了（24時間以内）/ 配布予定 / 終了済み（直近30日）
- 絞り込み: ストア（全部／ストア別）、種別タブ（既定は「ゲーム本体」。DLC・ゲーム内アイテム・ベータは切替）
- 終了日時は日本時間（Asia/Tokyo）で表示し、残り時間をカウントダウンする。ただし `endApprox: true` のものは、日付のみ（UTC の日付をそのまま使い、例: 「11/12まで」）を表示し、時刻とカウントダウンは出さない。「もうすぐ終了」区分にも入れない（日付が今日・明日のものには「まもなく」の補助表示を付けるだけにする）
- `worthUsd` がある場合のみ「通常価格相当 $X」を表示する
- `summaryJa` がある場合のみ表示し、「AI要約」と明記する
- 「受け取り済み」チェック（ブラウザの localStorage に保存。読み書きは try/catch で囲む）。受け取り済みを薄く表示するか隠すかを切り替えられる
- ストア別RSSへのリンクを、各ストアの絞り込み付近に置く
- URL のクエリ（例: `?store=epic&type=game`）で絞り込み状態を共有できる

---

## 6. デザインの疎結合ルール（Tailwind v3）

機能フェーズでは見た目を作り込まない。デザイン仕上げで、機能に触れずに差し替えられる状態を保つ。

1. `index.html` と `src/ui/templates.ts` には、**役割クラス**（例: `.game-card`, `.game-card__title`, `.badge`）と `data-*` 属性だけを書く。Tailwind のユーティリティクラスは、これらのファイルに直接書かない
2. 役割クラスの見た目は、すべて `src/styles/components.css` に `@apply` で定義する。機能フェーズでは、レイアウトに必要な最小限の構造系（`flex`, `grid`, `gap-*`, `hidden` など）だけを書く。色・フォント・影・装飾は書かない
3. 色・フォント・余白・角丸・影は、デザイントークンに集約する。トークンは `src/styles/tokens.css` の CSS変数（ライト／ダークを `prefers-color-scheme` で切替）として定義し、`tailwind.config.ts` の `theme.extend` から `rgb(var(--color-xxx) / <alpha-value>)` の形で参照する
4. TS コードは見た目を直接いじらない（`style` の直書き禁止）。状態は `data-state="active|ending|upcoming|ended"`、`data-claimed="true"` などの属性で表現し、見た目の切替は CSS 側が行う
5. `components.css` と `tokens.css` を丸ごと差し替えても、全機能が動くこと

---

## 7. フェーズと受入条件

各フェーズ完了時にコミットする。

- P0 土台: `package.json`（scripts: dev / build / test / typecheck / update）、`tsconfig.json`（strict）、Vite、Tailwind v3、Vitest、tsx のセットアップ。`src/shared/` の契約A（types / schema / status）と `computeStatus` のテスト。受入: `npm run typecheck`、`npm test`、`npm run build` が通る。空の `games.json` が検証を通る
- P1 fetchers: epic / gamerpower。受入: `npx tsx scripts/fetchers/epic.ts` 等で実データが取れ、契約Bの形になる（配布予定も含む）
- P2 merge / store: 受入: 重複除去・status再計算・30日掃除・GamerPower の対応表が、テストで検証される
- P3 outputs: RSS（全体＋ストア別）。受入: `feeds/` に生成され、guid が開始日時ありの場合 `<id>@<startAt>`、null の場合 `<id>` と一致する
- P3b notifiers 基盤: 契約Dの登録簿、`new` / `ending-soon` の判定、`notified.json` の記録、フィルタ、初回の抑止、送信上限。discord / ntfy / webhook の3チャネルを実装する。受入: テストで次を確認 ― シークレットなしで全スキップ／1チャネルを意図的に失敗させても他が送られる／再実行で二重送信されない／初回で過去分が送られない／`ending-soon` が1回だけ出る
- P3c notifiers 追加: slack / telegram / bluesky / mastodon を、契約Dに従ってファイル追加のみで実装する（既存コードを変更しない）。受入: 各チャネルの `isEnabled` が正しくON/OFFされる
- P4 Actions: `.github/workflows/update.yml`（cron 1日4回＋手動実行）。取得→差分があれば `public/` を commit & push。受入: 手動実行で更新が走り、差分なしなら commit されない
- P5 enrich: 受入: キーあり・なし・失敗の3ケースで落ちない（テスト）
- P6 サイト機能層: 受入: 4区分・絞り込み・種別タブ・JST表示・カウントダウン・受け取り済み・URLクエリ共有が動く。`components.css` と `tokens.css` を空にしても機能が壊れない。TSの型チェックとビルドが通る
- P7 デザイン仕上げ（最後）: 下記

### P7 デザイン仕上げ

- 編集してよいのは `src/styles/components.css`、`src/styles/tokens.css`、`tailwind.config.ts` の `theme.extend` のみ。必要な場合に限り、`index.html` と `src/ui/templates.ts` に、装飾用のフック（クラス名・補助要素）の**マークアップ追加だけ**を許可する。ロジックは変更しない
- 方向性: 日本語で読みやすく、スマホ優先。ゲームのカバー画像を主役にする。終了間近が一目で分かる強調を入れる。ライト／ダーク両対応
- Playwright 等でスクリーンショットを撮り、スマホ幅（390px程度）とPC幅（1280px程度）、ライト／ダークの計4通りを、目視で確認して調整する
- 受入: 4通りで崩れがなく、文字のコントラストが十分で、P6 の受入条件が引き続き通る

---

## 8. 非機能要件

- 運用コストは0円: Cloudflare Pages + GitHub Actions（公開リポジトリ）のみ。DB・常駐サーバーは使わない
- 取得失敗でデータを壊さない
- README に、Pages の設定手順（ビルドコマンドと出力ディレクトリ）、Groq キーと各通知チャネルのシークレット登録手順を書く（チャネルごとに、必要な環境変数と取得方法を1節ずつ）
- シークレットはリポジトリに含めない（Actions の Secrets のみ）。ログにも出力しない
