# nexus-companion

Even G2 向けのコンパニオンプラグインです。nexus リポジトリ上の ghdag UI や日記など、ローカル環境の情報を Even Realities グラス上から参照するための Even Hub アプリとして開発します。

本リポジトリは TypeScript + Vite で構成され、[`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) を用いて Even App との橋渡しを行います。親 Issue の準備・全体設計は [sumipan/nexus#1614](https://github.com/sumipan/nexus/issues/1614) を参照してください。

## 開発

```bash
npm install
npm run dev
npm run build
```

Node.js 20 系を使用してください（`.nvmrc` 参照）。
