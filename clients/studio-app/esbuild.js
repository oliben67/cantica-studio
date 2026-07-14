const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function build() {
  // Main process
  await esbuild.build({
    ...common,
    entryPoints: ['main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });

  // Preload
  await esbuild.build({
    ...common,
    entryPoints: ['preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });

  // Renderer — same source as the VSCode webview but swap vscode.ts shim.
  // The webview files import './vscode' or '../vscode' (relative); we intercept
  // any resolution that lands on webview-src/vscode.ts and redirect to our bridge.
  const vscodeWebviewSrcDir = path.resolve(__dirname, '../vscode/webview-src');
  const sharedWebviewSrcDir = path.resolve(__dirname, '../shared/webview-src');
  const vscodeBridge = path.resolve(__dirname, 'renderer/vscode-electron.ts');
  const vscodeShimPlugin = {
    name: 'vscode-electron-shim',
    setup(build) {
      build.onResolve({ filter: /[/\\]vscode(\.[jt]sx?)?$/ }, (args) => {
        const resolved = path.resolve(path.dirname(args.importer), args.path);
        if (resolved.startsWith(vscodeWebviewSrcDir) || resolved.startsWith(sharedWebviewSrcDir)) {
          return { path: vscodeBridge };
        }
      });
    },
  };

  await esbuild.build({
    ...common,
    entryPoints: ['renderer/index.tsx'],
    outfile: 'dist/renderer/index.js',
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    // Resolve React and other deps from the vscode extension's node_modules
    nodePaths: [path.resolve(__dirname, '../vscode/node_modules')],
    plugins: [vscodeShimPlugin],
  });

  // The renderer page itself is static — main.ts loads dist/renderer/index.html.
  fs.copyFileSync(
    path.join(__dirname, 'renderer', 'index.html'),
    path.join(__dirname, 'dist', 'renderer', 'index.html'),
  );
}

build().catch(() => process.exit(1));
