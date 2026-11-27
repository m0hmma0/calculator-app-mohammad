import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
};

/** The commit a build is made from, so an error report can be read against its source. */
function release(): string {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}+changes` : sha;
  } catch {
    return 'unknown';
  }
}

// `preview` mode emits one self-contained HTML file so a phase can be published
// as an artifact and clicked through without any backend. `npm run build:preview`.
export default defineConfig(({ mode }) => {
  const singleFile = mode === 'preview';

  return {
    plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
    resolve: { alias },
    define: { __RELEASE__: JSON.stringify(release()) },
    build: singleFile
      ? {
          outDir: 'dist-preview',
          emptyOutDir: true,
          cssCodeSplit: false,
          assetsInlineLimit: Infinity,
        }
      : { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  };
});
