# nexus-companion

Even G2 向けのコンパニオンプラグインです。ローカル環境の情報を Even Realities グラス上から参照するための Even Hub アプリとして開発します。

本リポジトリは TypeScript + Vite で構成され、[`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) を用いて Even App との橋渡しを行います。

## 開発

```bash
npm install
npm run dev
npm run build
```

Node.js 20 系を使用してください（`.nvmrc` 参照）。

## 環境変数

ビルド時に Vite が読み込む環境変数です。`.env` ファイルまたはシェルで設定します。

| 変数 | デフォルト | 用途 |
|------|-----------|------|
| `VITE_CHARGE_SERVER_URL` | `http://localhost:8088` | charge_server（日記・消費進捗） |
| `VITE_GHDAG_UI_URL` | `http://localhost:8080` | ghdag_ui（タスク集計） |

**実機（Even G2）向け** は開発 PC の LAN IP を指定してください。グラス経由の Even Hub アプリから localhost には到達できません。

```bash
# 例: 開発 PC の IP が 192.168.1.42 の場合
VITE_CHARGE_SERVER_URL=http://192.168.1.42:8088 \
VITE_GHDAG_UI_URL=http://192.168.1.42:8080 \
npm run build
```

サーバ側の起動方法は nexus リポジトリ [Issue #1614](https://github.com/sumipan/nexus/issues/1614) を参照してください（`charge_server` を `0.0.0.0:8088`、`ghdag_ui` を `0.0.0.0:8080` で起動）。

## ビュー切替

右テンプル **ダブルタップ** で Diary → Dashboard → Charge → Diary の順に循環します。

`DOUBLE_CLICK_EVENT` が実機で発火しない場合は、`src/main.ts` のイベント種別を `CLICK_EVENT` に変更して再ビルドしてください。

## `.ehpk` ビルド & サイドロード

Even Hub への配布には `app.json` マニフェストと `.ehpk` パッケージが必要です。

### 1. マニフェスト作成（初回のみ）

```bash
npx evenhub init
```

`app.json` を編集し、`permissions` に LAN 向け `network` を追加してください（`whitelist` は空配列 `[]` で LAN 全体を許可できます）。

### 2. ビルド & パッケージング

```bash
npm run build:ehpk
```

`dist/` をビルドし、`nexus-companion.ehpk` を生成します。内部では `evenhub pack app.json dist -o nexus-companion.ehpk` を実行しています。

### 3. サイドロード

1. ビルド済み `dist/` を LAN 内 HTTP サーバで公開する

   ```bash
   npx serve dist/ --listen 3000
   ```

2. 公開 URL を QR コード化する（URL は環境ごとに異なるため、都度生成する）

   ```bash
   npx qrcode-terminal "http://192.168.1.42:3000"
   ```

3. Even G2 とペアリング済みスマホの Even Hub アプリで QR をスキャンしてサイドロードする

## 既知の制約

- **LAN 限定**: サーバは同一 LAN 内の HTTP のみ。インターネット経由の接続は想定していない
- **当日固定**: Diary ビューは `charge_server` の `/diary/today`（当日の日記のみ）を表示する
- **表示専用**: グラス上から日記・タスク・消費量を変更する API は呼ばない

## エラー表示

サーバ未起動や LAN 接続失敗時、各ビューは以下のメッセージを表示します。

| ビュー | エラーメッセージ |
|--------|----------------|
| Diary | 「サーバに接続できません」 |
| Dashboard | 「ghdag UI に接続できません」 |
| Charge | 「進捗データ取得失敗」 |

## スクリーンショット

### シミュレータ起動手順

```bash
# nexus 側（charge_server + ghdag_ui）
overmind start -l charge_server,ghdag_ui

# nexus-companion 側
npm install && npm run build
npm run preview -- --host 127.0.0.1 --port 4173

# 別ターミナル
npx @evenrealities/evenhub-simulator http://127.0.0.1:4173 --automation-port 9898
```

Charge ビューは `OffscreenCanvas` + `updateImageRawData` で描画する。シミュレータ v0.7.x では Canvas API が利用可能であり、単体テスト（`tests/views/charge.test.ts`）でも描画を検証済み。
