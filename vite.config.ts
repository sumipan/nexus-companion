import { defineConfig, type Plugin } from "vite";

/**
 * .ehpk 配布版 (file:// 配信) で <script type="module" crossorigin> だと
 * iOS WKWebView が CORS 違反でロードを拒否する。IIFE bundle で吐いた
 * /assets/index.js を classic script として読ませるため、生成 HTML から
 * type="module" / crossorigin / nomodule 属性を剥がす。
 */
function stripModuleAttrs(): Plugin {
  return {
    name: "strip-module-attrs",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/\s+type="module"/g, "")
        .replace(/\s+crossorigin/g, "")
        .replace(/\s+nomodule/g, "");
    },
  };
}

export default defineConfig({
  root: "src",
  // `.ehpk` 配布版は file:// 配信で WebView に読み込まれるため、
  // 生成 HTML の <script src="..."> は相対パスである必要がある。
  // 既定の base: "/" だと WebView が `/assets/...` をファイルシステムルートから
  // 探そうとして 404 になり、JS が読まれず白画面になる。
  base: "./",
  plugins: [stripModuleAttrs()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2020",
    modulePreload: false,
    // 全コードを 1 ファイル IIFE に固める。`<script type="module">` だと
    // iOS WKWebView が file:// 経路で ES module 間 import を CORS 違反
    // （同一オリジン扱いされない）で拒否し、JS が一切ロードされない。
    rollupOptions: {
      output: {
        format: "iife",
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/[name][extname]",
        inlineDynamicImports: true,
      },
    },
  },
});
