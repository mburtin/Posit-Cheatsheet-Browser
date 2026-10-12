import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { PositCheatsheetsApi } from '../../src/extension';

const PDF_EDITOR = 'positronPdfServer.previewEditor';

/** Entry point called by Positron when started with --extensionTestsPath. */
export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension<PositCheatsheetsApi>('mburtin.posit-cheatsheets-browser');
	assert.ok(extension, 'The extension is not installed.');
	const api = await extension.activate();
	await vscode.commands.executeCommand('workbench.view.extension.positCheatsheets');

	await vscode.commands.executeCommand('positCheatsheets.refresh');
	const sheets = api.getCheatsheets();
	assert.ok(sheets.length > 20, `Expected more than 20 cheatsheets, got ${sheets.length}.`);
	log(`listed ${sheets.length} cheatsheets`);

	const sheet = sheets.find(s => s.slug === 'positron');
	assert.ok(sheet, 'The Positron cheatsheet is not listed.');

	// Favorites keep the order they were pinned in.
	const other = sheets.find(s => s.slug !== sheet.slug)!;
	await vscode.commands.executeCommand('positCheatsheets.pin', other);
	await vscode.commands.executeCommand('positCheatsheets.pin', sheet);
	await vscode.commands.executeCommand('positCheatsheets.pin', sheet);
	assert.deepEqual(api.getFavorites().map(s => s.slug), [other.slug, sheet.slug]);
	await vscode.commands.executeCommand('positCheatsheets.unpin', other);
	assert.deepEqual(api.getFavorites().map(s => s.slug), [sheet.slug]);
	log(`pinned and unpinned favorites`);

	const started = Date.now();
	await vscode.commands.executeCommand('positCheatsheets.open', sheet);
	const tab = await waitFor(() => {
		const active = vscode.window.tabGroups.activeTabGroup.activeTab;
		return active?.input instanceof vscode.TabInputCustom && active.input.viewType === PDF_EDITOR ? active.input : undefined;
	}, 'the cheatsheet to open in the Positron PDF viewer');
	assert.match(tab.uri.path, /\/pdfs\/positron\.pdf$/);
	const stat = await vscode.workspace.fs.stat(tab.uri);
	log(`downloaded and opened ${tab.uri.fsPath} (${stat.size} bytes) in ${Date.now() - started} ms`);

	// The second open must come from the cache.
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	const reopened = Date.now();
	await vscode.commands.executeCommand('positCheatsheets.open', sheet);
	await waitFor(() => {
		const active = vscode.window.tabGroups.activeTabGroup.activeTab;
		return active?.input instanceof vscode.TabInputCustom && active.input.viewType === PDF_EDITOR ? true : undefined;
	}, 'the cached cheatsheet to reopen');
	log(`reopened from cache in ${Date.now() - reopened} ms`);
}

async function waitFor<T>(check: () => T | undefined, what: string, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = check();
		if (value !== undefined) {
			return value;
		}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error(`Timed out waiting for ${what}.`);
}

function log(message: string): void {
	console.log(`[posit-cheatsheets] ${message}`);
}
