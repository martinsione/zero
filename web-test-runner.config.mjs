// @ts-check
import {esbuildPlugin} from '@web/dev-server-esbuild';
import {playwrightLauncher} from '@web/test-runner-playwright';
import {readFileSync} from 'fs';

const chromium = playwrightLauncher({product: 'chromium'});
const webkit = playwrightLauncher({product: 'webkit'});
const firefox = playwrightLauncher({product: 'firefox'});

function readPackageJSON() {
  const url = new URL('./package.json', import.meta.url);
  const s = readFileSync(url, 'utf-8');
  return JSON.parse(s);
}

const json = readPackageJSON();

/** @type {import('@web/test-runner').TestRunnerConfig} */
const config = {
  concurrentBrowsers: 3,
  nodeResolve: true,
  plugins: [
    esbuildPlugin({
      ts: true,
      target: 'esnext',
      define: {
        'process.env.NODE_ENV': '"development"',
        'REPLICACHE_VERSION': JSON.stringify(json.version),
      },
    }),
  ],
  staticLogging: !!process.env.CI,
  testFramework: {
    config: {
      ui: 'tdd',
      reporter: 'html',
      timeout: 30000,
      retries: process.env.CI ? 3 : 0, // Firefox is flaky
    },
  },
  files: [
    'src/*.test.ts',
    'src/dag/*.test.ts',
    'src/db/*.test.ts',
    'src/kv/*.test.ts',
    'src/sync/*.test.ts',
    'src/migrate/*.test.ts',
    'src/btree/*.test.ts',
    'src/persist/*.test.ts',
  ],
  browsers: [firefox, chromium, webkit],
};

export {config as default};
