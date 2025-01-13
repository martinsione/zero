// @ts-check

import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {builtinModules} from 'node:module';
import {resolve as resolvePath} from 'node:path';
import {makeDefine, sharedOptions} from '../../shared/src/build.js';
import {getExternalFromPackageJSON} from '../../shared/src/tool/get-external-from-package-json.js';

const forBundleSizeDashboard = process.argv.includes('--bundle-sizes');
const minify = process.argv.includes('--minify');
// You can then visualize the metafile at https://esbuild.github.io/analyze/
const metafile = process.argv.includes('--metafile');
const splitting = !forBundleSizeDashboard;

/**
 * @param {string} path
 * @returns {string}
 */
function basePath(path) {
  const base = resolvePath(path);
  return base;
}

/**
 * @param {boolean} includePeerDeps
 * @returns {Promise<string[]>}
 */
async function getExternal(includePeerDeps) {
  const externalSet = new Set([
    ...(await getExternalFromPackageJSON(import.meta.url, true)),
    ...extraExternals,
  ]);

  /**
   * @param {string} internalPackageName
   */
  async function addExternalDepsFor(internalPackageName) {
    const internalPackageDir = basePath('../' + internalPackageName);
    for (const dep of await getExternalFromPackageJSON(
      internalPackageDir,
      includePeerDeps,
    )) {
      externalSet.add(dep);
    }
  }

  // Normally we would put the internal packages in devDependencies, but we cant
  // do that because zero has a preinstall script that tries to install the
  // devDependencies and fails because the internal packages are not published to
  // npm.
  //
  // preinstall has a `--omit=dev` flag, but it does not work with `npm install`
  // for whatever reason.
  //
  // Instead we list the internal packages here.
  for (const dep of [
    'btree',
    'datadog',
    'replicache',
    'shared',
    'zero-cache',
    'zero-client',
    'zero-protocol',
    'zero-react',
    'zero-solid',
    'zero-advanced',
    'zql',
    'zqlite',
  ]) {
    await addExternalDepsFor(dep);
  }

  return [...externalSet].sort();
}

const extraExternals = ['node:*', ...builtinModules];

await verifyDependencies(await getExternal(false));

/**
 * @param {Iterable<string>} external
 */
async function verifyDependencies(external) {
  // Get the dependencies from the package.json file
  const packageJSON = await readFile(basePath('package.json'), 'utf-8');
  const expectedDeps = new Set(external);
  for (const dep of extraExternals) {
    expectedDeps.delete(dep);
  }

  const {dependencies} = JSON.parse(packageJSON);
  const actualDeps = new Set(Object.keys(dependencies));
  assert.deepEqual(
    expectedDeps,
    actualDeps,
    'zero/package.json dependencies do not match the dependencies of the internal packages',
  );
}

async function buildZeroClient() {
  const define = makeDefine('unknown');
  const entryPoints = forBundleSizeDashboard
    ? {zero: basePath('src/zero.ts')}
    : {
        zero: basePath('src/zero.ts'),
        react: basePath('src/react.ts'),
        solid: basePath('src/solid.ts'),
        advanced: basePath('src/advanced.ts'),
      };
  const result = await esbuild.build({
    ...sharedOptions(minify, metafile),
    external: await getExternal(true),
    splitting,
    // Use neutral to remove the automatic define for process.env.NODE_ENV
    platform: 'neutral',
    define,
    outdir: basePath('out'),
    entryPoints,
  });
  if (metafile) {
    await writeFile(basePath('out/meta.json'), JSON.stringify(result.metafile));
  }
}

await buildZeroClient();
