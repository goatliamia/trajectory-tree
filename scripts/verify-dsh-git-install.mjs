// Run against the public repository URL exactly as a new DSH user would.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = ['trajectory-tools', 'analysis-view'];
const packagesOnDisk = packages.map(dir => {
  const folder = join(root, 'plugin', dir);
  const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  assert.ok(existsSync(join(folder, pkg.dsh.bundle.patch)), pkg.name + ' bundle entry');
  const guide = readFileSync(join(folder, 'README.md'), 'utf8');
  const examples = [...guide.matchAll(/(dsh-[\w-]+-[\d.]+\.tgz)/g)].map(m => m[1]);
  assert.ok(examples.includes(pkg.name + '-' + pkg.version + '.tgz'), pkg.name + ' archive example');
  assert.ok(examples.filter(file => file.startsWith(pkg.name + '-')).every(file => file === pkg.name + '-' + pkg.version + '.tgz'), pkg.name + ' stale archive example');
  return pkg;
});
const archiveNames = packagesOnDisk.map(pkg => pkg.name + '-' + pkg.version + '.tgz');
const commands = ['README.md', 'README.en.md'].map(file => {
  const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
  assert.ok(lines.includes('dsh plugin --profile web add ' + archiveNames.map(name => './' + name).join(' ')), file + ' archive install command');
  return lines.find(line => line.startsWith('dsh plugin --profile web add "https://github.com/'));
});
assert.ok(commands[0], 'The Git install command must be present in the README');
assert.equal(commands[1], commands[0], 'Both languages should install the same bundles');
const specs = [...commands[0].matchAll(/"([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(specs, packages.map(dir => 'https://github.com/goatliamia/trajectory-tree#path:/plugin/' + dir));

if (process.argv.includes('--check')) {
  console.log('Both README install commands and the package archive examples match the DSH manifests.');
} else {
  const args = process.argv.slice(2);
  assert.ok(!args.length || (args.length === 2 && args[0] === '--archives'), 'Usage: verify-dsh-git-install.mjs [--check | --archives DIRECTORY]');
  verifyInstall(args.length ? archiveNames.map(name => resolve(args[1], name)) : specs);
}

function verifyInstall(installSpecs) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
  const scratch = mkdtempSync(join(tmpdir(), 'trajectory-dsh-install-'));
  try {
    const home = join(scratch, 'data');
    const result = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', ...installSpecs], {
      cwd: scratch, windowsHide: true, stdio: 'inherit', timeout: 300000,
      env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(scratch, 'agents'), DSH_TELEMETRY_DISABLED: 'true' },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'The documented Git install must succeed in an empty profile');
    const profile = join(home, 'profiles/web');
    const config = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
    for (const { name, version } of packagesOnDisk) {
      const dir = join(profile, 'node_modules', name);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, name);
      assert.equal(pkg.version, version, name + ' installed version');
      assert.ok(config.dsh.profile.bundles.includes(name), name + ' must be registered in the Web profile');
      assert.ok(existsSync(join(dir, pkg.dsh.bundle.patch)), name + ' bundle entry');
      assert.ok(existsSync(join(dir, pkg.main)), name + ' runtime entry');
      console.log(name, pkg.version, 'installed and registered');
    }
  } finally {
    if (dirname(scratch) === resolve(tmpdir()) && basename(scratch).startsWith('trajectory-dsh-install-')) {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
