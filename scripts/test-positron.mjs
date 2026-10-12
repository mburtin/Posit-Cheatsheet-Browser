// Runs test/positron/suite.ts inside a throwaway Positron profile, so the
// installed Positron and its extensions are left untouched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const positron = process.env.POSITRON_PATH ?? '/Applications/Positron.app/Contents/MacOS/Positron';

const suite = join(root, 'out', 'positron-suite.js');
await esbuild.build({
	entryPoints: [join(root, 'test', 'positron', 'suite.ts')],
	bundle: true,
	outfile: suite,
	format: 'cjs',
	platform: 'node',
	external: ['vscode'],
	logLevel: 'warning',
});

// Without this, a Positron/VS Code terminal would hand the launch to the running app.
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith('VSCODE_') && key !== 'ELECTRON_RUN_AS_NODE'),
);

const profile = mkdtempSync(join(tmpdir(), 'posit-cheatsheets-test-'));
try {
	const result = spawnSync(positron, [
		`--extensionDevelopmentPath=${root}`,
		`--extensionTestsPath=${suite}`,
		`--user-data-dir=${join(profile, 'user-data')}`,
		`--extensions-dir=${join(profile, 'extensions')}`,
		'--disable-workspace-trust',
		'--skip-welcome',
		'--skip-release-notes',
		'--new-window',
	], { env, stdio: 'inherit' });
	if (result.error) {
		throw result.error;
	}
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(profile, { recursive: true, force: true });
}
