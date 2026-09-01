import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import {
  loroCrdtBundlerAlias,
  loroCrdtWasmUrlWorkaround,
} from '../../packages/components/vite-wasm-workarounds';
import { emojibaseAssetsPlugin } from '../../packages/components/vite-emojibase-assets';
import { mermaidLazyBoundaryGuardPlugin } from '../../packages/components/vite-mermaid-lazy-boundary-guard';
import {
  isMermaidRuntimeDependency,
  rendererBundleAliasPlugin,
  rendererBundleAliases,
} from '../../packages/components/vite-renderer-bundle-aliases';

function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim().slice(0, 8);
  } catch {
    return 'unknown';
  }
}

function getAppVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return manifest.version ?? '0.0.0';
}

export default defineConfig({
  envDir: false,
  envPrefix: '__LodyPublicBuildOnlyPrefix__',
  define: {
    'import.meta.env.VITE_LODY_PLATFORM': JSON.stringify('self-hosted'),
    'import.meta.env.VITE_PREVIEW_PUBLIC_BASE_DOMAIN': JSON.stringify('local.invalid'),
    'import.meta.env.VITE_CONVEX_SITE_URL': JSON.stringify('https://self-hosted.invalid'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(getGitCommitHash()),
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'convex'],
    alias: [
      ...loroCrdtBundlerAlias(),
      ...rendererBundleAliases(),
      {
        find: '@lody/components',
        replacement: resolve(__dirname, '../../packages/components/src'),
      },
      {
        find: '@/',
        replacement: `${resolve(__dirname, '../../packages/components/src')}/`,
      },
    ],
  },
  worker: {
    format: 'es',
    plugins: () => [loroCrdtWasmUrlWorkaround(), wasm()],
  },
  optimizeDeps: {
    exclude: ['@loro-dev/streams-crdt', '@loro-dev/streams-crdt/zstd'],
  },
  build: {
    target: 'esnext',
    minify: true,
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          return isMermaidRuntimeDependency(id) ? 'mermaid-deps' : undefined;
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    loroCrdtWasmUrlWorkaround(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: resolve(__dirname, '../../packages/components/src/routes'),
      generatedRouteTree: resolve(__dirname, '../../packages/components/src/routeTree.gen.ts'),
    }),
    react(),
    wasm(),
    emojibaseAssetsPlugin(),
    rendererBundleAliasPlugin(),
    mermaidLazyBoundaryGuardPlugin(),
  ],
});
