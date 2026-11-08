# FreeGameHub デザイン仕様（P7 用）v1

FreeGameHub の表示デザインと OG 画像・favicon の仕様。
実装の範囲と制約は SPEC.md の第6節・第7節の P7 に従う（編集してよいのは `components.css` / `tokens.css` / `tailwind.config.ts` の `theme.extend`。マークアップは装飾用フックの追加のみ）。

## 1. コンセプト

- ダークファースト。ダークを基準に作り、ライトはトークンの切替だけで実現する（`prefers-color-scheme`）
- 配布中と終了間近をそれぞれグリッドで見せる。終了間近で終了日時が最も早い1件を大きく（2×2）表示する。配布中の最後に「次回予告」の横長タイルを置く
- アクセントは1色（ライム）。緊急は別系統（オレンジ）。色だけで意味を伝えない（文言・アイコン・明度差を併用する）
- 数字（カウントダウン、価格、日付）は Space Grotesk のタビュラー数字。本文は日本語システムフォント

## 2. トレンドの採否

- 採用: ベントグリッド、ダークファースト、トークン化されたデザインシステム、大きな数字のタイポグラフィ（カウントダウン）、細かなマイクロインタラクション、アクセシビリティ（WCAG 2.2 AA）
- 採用（控えめに）: スクロール連動やビュー遷移は、フィルタ切替時の `view-transition` だけ。`prefers-reduced-motion` で無効化する
- 不採用: 3D / WebGL、重いパララックス、グラスモーフィズムの多用、動くタイポグラフィの多用。機能（一覧性・読み込み速度）を優先するため

## 3. デザイントークン

`src/styles/tokens.css` に、RGB 3値の CSS 変数（Tailwind の `<alpha-value>` 用）として定義する。形式: `--color-bg: 14 16 20;`。

ダーク（既定）:

```
bg          #0E1014    surface     #161A20    surface-2   #1D222A    line        #2A303A
text        #ECEFF4    dim         #A7B0BE
accent      #B8F25B    accent-on   #0E1014    accent-text #B8F25B
urgent      #FFA066    urgent-bg   #3A2316    urgent-line #7A4A2B
ok-bg       #1F2B14    pattern     rgba(255,255,255,0.05)
cover-0..5  #233047 #2B2A44 #1F3B3A #3A2A2A #2E3A22 #3A3322   （カバー画像が無いときの代替色）
```

ライト（`@media (prefers-color-scheme: light)` で差し替え）:

```
bg          #F6F7F4    surface     #FFFFFF    surface-2   #EEF0EA    line        #D9DDD2
text        #14171C    dim         #4B5563
accent      #BEF264    accent-on   #14171C    accent-text #3F6212
urgent      #9A3412    urgent-bg   #FFEDD5    urgent-line #FDBA74
ok-bg       #ECFCCB    pattern     rgba(20,23,28,0.05)
cover-0..5  #DCE6F5 #E3E0F2 #D6EBE8 #F3DEDC #E4EDD3 #F2EBD0
```

- 文字色のコントラスト比は 4.5:1 以上（12px の補助文字も含む）。ライトでは `accent` を文字色に使わず、`accent-text` を使う
- 角丸: カード16px、ボタン10px、チップ999px、入力まわり8px。余白は 4px 刻み（8/12/16/24/32/48）
- 影は使わず、境界線（`line`）で面を分ける

## 4. タイポグラフィ

- 日本語（本文・見出し）: `'Noto Sans JP','Hiragino Sans','Yu Gothic UI','Meiryo',system-ui,sans-serif`。**Web フォントとしての日本語フォントは読み込まない**（容量が大きいため）。端末のフォントを使う
- 数字・ロゴ: `Space Grotesk`（500/600/700）。**自己ホスト**（サブセット化した woff2 を `public/fonts/` に置く）。使う文字は数字・記号・英字のみ。`font-display: swap`
- すべて `font-variant-numeric: tabular-nums`（数字を使う箇所）
- サイズ（デスクトップ / スマホ）: ページ見出し 40 / 28、ヒーローのタイトル 28 / 24、ヒーローのカウントダウン 52 / 40（Space Grotesk 700）、セクション見出し 22、カード見出し 16、本文 14、補助 13、最小 12

## 5. レイアウト

- 最大幅 1200px、左右の余白はデスクトップ32px / スマホ16px
- 配布中と終了間近: デスクトップは各4列グリッド（gap 16px）。終了間近は `endAt` の昇順で表示し、先頭カードは `col-span-2 row-span-2`、配布中の次回予告は `col-span-3`。スマホはそれぞれ1列で表示する
- 配布予定: デスクトップは2列、スマホは1列。終了済み: 1列の簡易リスト
- 絞り込みバー: ストアのセレクト、種別のセグメント、「受け取り済みを隠す」。種別とRSSリンクはスマホで横スクロールする
- 基準のブレークポイント: 768px 未満をスマホ配置、1024px 以上を4列

## 6. コンポーネントと状態

- ゲームカード（`.game-card`）: カバー（16:9）→ 本文。左上にストアのバッジ、終了間近または概算で「まもなく」の場合は右上に状態のチップ
- 配布状態は `data-state`、概算日時は `data-approx="true"`、受取済みは `data-claimed="true"` で表し、見た目は CSS 側で切り替える
  - `ending`: 終了24時間以内。右上に「まもなく終了」チップ（urgent 系）。カウントダウンの数字は urgent 色
  - `data-approx="true"`: 終了時刻が日付のみ（`endApprox`）。「11/14まで」と「時刻未確定」のラベル。カウントダウンは出さない
  - `claimed`（`data-claimed="true"`）: カバーの不透明度を下げ、チェック済みの「受け取り済み」表示を強調。リンクは「ストアを開く」（枠線のみ）
  - `upcoming` / `ended`: デスクトップでは簡易行、スマホでは縦型カードで表示する。配布予定には開始日時も表示する
- 主ボタン（「受け取る」）: 高さ44px以上、accent 背景、accent-on 文字。外部リンクのアイコン付き
- 「AI要約」: 本文の頭にテキストで明記し、自動生成であることを示す
- 通常価格相当: `$29.99` を accent-text 色で表示。無ければ表示しない
- 次回予告タイル: 破線の枠、surface-2 の背景。開始日時を JST で並べる
- 空の状態: 各区分が0件のときは、それぞれに専用の案内を表示する。配布中が0件で配布予定がある場合は、次回予告も表示する

## 7. モーション

- すべて 150ms 以内、`ease-out`。ホバー時は枠線を `accent` 寄りにする（拡大や影は使わない）
- カウントダウンは1分ごとに更新（数字の幅が変わらないよう tabular-nums）
- フィルタ切替は `document.startViewTransition` が使えるときだけ。使えなければ即時
- `@media (prefers-reduced-motion: reduce)` では、すべてのトランジションを無効にする

## 8. アクセシビリティ

- チップ・ボタン・チェックボックスの操作領域は44px以上（デスクトップのチップは40px可）
- フォーカスは `outline: 2px solid accent`、`outline-offset: 2px` を常に表示する
- 状態を色だけで伝えない（「まもなく終了」「受け取り済み」は文言とアイコンも持つ）
- `aria-pressed`、`aria-label`、`<label>` と `<input>` の対応は、機能層のまま維持する

## 9. 受入（P7）

- ライト／ダーク × スマホ／デスクトップの4通りで崩れがなく、この仕様の構成・色・余白・サイズ感に沿う
- 文字のコントラストが十分（4.5:1 以上）
- Space Grotesk 以外の Web フォントを読み込まない。初回表示のブロックがない
- P6 の受入条件（4区分・絞り込み・種別タブ・JST・カウントダウン・受け取り済み・URL共有）が引き続き通る

## 10. OG画像・favicon

- 配置: `public/` 直下に `og.png`(1200×630) / `favicon.svg` / `favicon.ico`(16・32・48) / `apple-touch-icon.png`(180×180)。ソースは `design/og-source.html` に置き、再生成可能にする。
- ブランドマーク: ライム `#B8F25B` の角丸正方形(rx=25%)に、`#0E1014` のギフトアイコン(線幅2.4/32)。OG画像と favicon に使用する。ヘッダーはテキストロゴ。
- OG画像: 背景 `#0E1014` + 40px格子(`#161A20`)。左にロゴ・見出し「無料配布ゲームを、日本時間で。」(「日本時間」のみライム)・説明文。右にbentoモチーフ(ヒーロー: 橙の残り時間 `08:12:33`)。装飾のみで実データは載せない。
- 数字はSpace Grotesk 700、本文はNoto Sans JP系。
- `<head>`: `link rel=icon href=/favicon.ico sizes=any`、`link rel=icon type=image/svg+xml href=/favicon.svg`、`link rel=apple-touch-icon href=/apple-touch-icon.png`、`meta name=theme-color content=#0E1014`、`og:title / og:description / og:type=website / og:image / og:url`、`twitter:card=summary_large_image`。
- `og:image` と `og:url` は絶対URL。ドメイン確定まではビルド時に環境変数 `SITE_URL` から生成し、未設定なら相対パスのままにせず、`og:image`・`og:url`・`twitter:image` を出力しない（タイトル等の固定タグは残す）。
- 受入: Discord/Slack/Xのカードプレビューで崩れない、favicon が16pxで判別できる、Lighthouse の SEO で警告なし。
