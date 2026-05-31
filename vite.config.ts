import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  // `.ehpk` 配布版は file:// 配信で WebView に読み込まれるため、
  // 生成 HTML の <script src="..."> は相対パスである必要がある。
  // 既定の base: "/" だと WebView が `/assets/...` をファイルシステムルートから
  // 探そうとして 404 になり、JS が読まれず白画面になる。
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
