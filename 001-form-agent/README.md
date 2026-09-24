# 001 form-agent — フォーム記入エージェント

| | |
| --- | --- |
| **状態** | 実装完了・動作確認待ち |
| **種類** | ブラウザ拡張機能（Chrome / Edge / Firefox） |
| **作った日** | 2026-09-24 |
| **使った技術** | Claude ブラウザ使用ツール `browser_toolset_20260801`（2026-08-19 提供開始） |
| **設計図** | https://claude.ai/artifact/KhFkfAb8abSSRycLsvubsz |
| **入れるもの** | `extension/` フォルダを Chrome に読み込む |
| **紹介ページ** | 未（`sakidori.app/lab/form-agent` に出す予定） |
| **記事** | 未（Zenn） |

面倒なWebフォームを開いてボタンを押すと、保存しておいた自分の情報から **AIが下書きします**。
**送信は必ず人が押します。** 拡張機能は送信を行いません。

## なぜ拡張機能なのか

Webページとして作ると、同一オリジンポリシーで他サイトのフォームに触れません。
拡張機能の `content script` は**そのページの一部として動く**ので、この制限がそもそも適用されません。
通信は `background` が行うので、**サイト側の CSP にも引っかかりません**（ブックマークレットが詰まるのはここ）。

サーバーは使いません。APIキーは利用者が自分で持ち、**運営者のサーバーは一切通りません**。

## 入れ方（開発者モード）

1. `chrome://extensions` を開く
2. 右上の **デベロッパーモード** を ON
3. **パッケージ化されていない拡張機能を読み込む** → この中の `extension` フォルダを選ぶ
4. ツールバーのパズルのアイコンから、この拡張機能を**ピン留め**しておく

## 最初の設定

拡張機能の詳細 → **拡張機能のオプション**（またはパネルの「設定」ボタン）から：

1. **APIキー** … https://console.anthropic.com/settings/keys で発行
2. **よく使う自分の情報** … 氏名・カナ・電話・住所・勤務先など。一度入れれば使い回します

どちらも `chrome.storage.local`（この端末の中）だけに保存されます。

## 使い方

1. フォームのあるページを開く
2. ツールバーのボタンを押す → 右下にパネルが出る
3. ひとこと指示を書く（空でも可）→ **下書きする**
4. AIがページを読み、埋めていく。操作した場所にオレンジの枠が出る
5. 終わると**確認画面**が出る。各行に「何を・なぜ」が書いてある
6. 内容を確認して、**自分で送信ボタンを押す**

## 動作確認

`test/form.html` が確認用のフォームです。実在サイトの面倒さを全部入れてあります。

- 全角カナ指定／電話番号の3分割／選択肢の多い `select`
- **「その他」を選ぶと、最初は存在しない必須欄が現れる**（読み直しが必要）
- **必須の入れ忘れでエラーが出て戻される**（エラーを読んで直す必要がある）

この2つが、決まった手順をなぞっているだけでは通れない部分です。

`file://` では content script が動かないので、どちらかで開いてください。

```bash
# 方法A：簡易サーバーを立てる（推奨）
cd extension/test && python -m http.server 8787   # → http://localhost:8787/form.html

# 方法B：chrome://extensions の詳細で「ファイルの URL へのアクセスを許可する」を ON
```

## 録画する

フォームを埋めるところを自動で撮ります。出力は `_local/` の中（git には入りません）。

```bash
cd lab && npm install        # 最初の1回だけ
# _local/apikey.txt に Anthropic の APIキーを書く（または環境変数 ANTHROPIC_API_KEY）
npm run rec:001
```

出るもの：アニメーション（`.webp`）、最後の画面（`.png`）、実況ログ（`.log.txt`）、1コマずつのPNG（`frames/`）。

指示文は `NOTE` で変えられます。

```bash
NOTE="採用への応募です。エンジニア職で、来月から勤務可能。" npm run rec:001
```

> **Chrome 152 以降はコマンドラインからの拡張機能の読み込みを拒否します。** そのため録画は **Edge** を使います
> （どちらも Chromium なので、拡張機能の動きも撮れる絵も同じ）。`BROWSER_PATH` で明示もできます。

録画では、わざと崩した情報を渡しています。**カナをひらがなで、電話番号を1本で**保存しておき、
AIが全角カナに直すところと、3つの欄に分けるところが映るようにしてあります。

## しないこと

- **送信ボタンを押さない**（`isSubmit()` で構造的に弾いています）
- **CAPTCHA・画像認証に触れない**
- **ログインしない**
- **別のページへ移動しない**（`navigate` を無効化）
- ボタンを押したときだけ動く（`activeTab` 権限。常時監視しない）

## 中身

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | 権限は `activeTab` / `scripting` / `storage` と Anthropic API のみ |
| `background.js` | Anthropic API を呼ぶ。8つ以外の道具は `configs` で無効化 |
| `content.js` | **本体。** DOM →「文字の地図」の変換、8つの道具の実行、枠と実況、確認画面 |
| `options.html` / `options.js` | APIキーと自分の情報 |
| `test/form.html` | 動作確認用のフォーム |

### 「文字の地図」とは

`read_page` で Claude に返しているのは JSON ではなく、この形のテキストです。

```
textbox "お名前（全角カナ）" [ref_3] required hint="ヤマダ タロウ"
combobox "従業員規模" [ref_6] value="選択してください" options="選択してください／1〜10名／…"
radio "その他" [ref_9] group="kind"
button "送信する" [ref_14]
```

実在サイトは `<label for>` を書いていないことが多いので、名前の拾い方を何段構えにもしています
（`aria-label` → `aria-labelledby` → `label[for]` → 囲っている `label` → **直前の要素のテキスト** → `placeholder`）。
最後から2番目が、実在サイトでは一番効きます。

`ref` は読み直すたびに振り直します。古い `ref` が来たら
`Error: ref_N is stale... Re-read the page.` を返すと、Claude が自分で読み直して立ち直ります。
**「途中で欄が増える」はこの仕組みで通ります。**

## 費用

利用者が自分のAPIキーを使うので、運営側の負担はありません。
20項目のフォーム1回で **5〜8円** ほど（`claude-sonnet-5` / 10〜16往復）。

## Firefox で動かすとき

`manifest.json` に `browser_specific_settings` を入れてあります。Firefox は MV3 の
`background.service_worker` より `background.scripts` を好むため、そこだけ差し替えが要ります。

```json
"background": { "scripts": ["background.js"] }
```

Android（Firefox for Android）も `gecko_android` の宣言で対象に入ります。**こちらは翌週に対応予定。**

## まだやっていないこと

- 下見のパス（埋める前にフォーム全体を見て、足りない情報を1回でまとめて聞く）
- 多段ステップのフォーム（「次へ」は送信扱いで弾いているため）
- Firefox / Android 対応の実機確認
- ストアへの申請
