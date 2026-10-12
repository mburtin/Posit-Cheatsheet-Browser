import * as vscode from 'vscode';
import { Cheatsheet, tagsNotInTitle } from './catalog';
import { Favorites } from './favorites';
import { PdfCache } from './pdfCache';

/** A flat list of cheatsheets; used for both the full list and the favorites. */
export class CheatsheetTreeProvider implements vscode.TreeDataProvider<Cheatsheet> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(
		private readonly getSheets: () => readonly Cheatsheet[],
		private readonly cache: PdfCache,
		private readonly favorites: Favorites,
	) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getChildren(element?: Cheatsheet): Cheatsheet[] {
		return element ? [] : [...this.getSheets()];
	}

	getTreeItem(sheet: Cheatsheet): vscode.TreeItem {
		const cached = this.cache.isCached(sheet.slug);
		const pinned = this.favorites.has(sheet.slug);
		const item = new vscode.TreeItem(sheet.title, vscode.TreeItemCollapsibleState.None);
		item.id = sheet.slug;
		item.description = tagsNotInTitle(sheet).join(', ');
		item.tooltip = tooltip(sheet, cached, pinned);
		item.iconPath = new vscode.ThemeIcon(cached ? 'pass-filled' : 'file-pdf');
		// Menus in package.json match on these words, e.g. `viewItem =~ / unpinned/`.
		item.contextValue = ['cheatsheet', cached && 'cached', pinned ? 'pinned' : 'unpinned'].filter(Boolean).join(' ');
		item.command = { command: 'positCheatsheets.open', title: 'Open', arguments: [sheet] };
		return item;
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

function tooltip(sheet: Cheatsheet, cached: boolean, pinned: boolean): vscode.MarkdownString {
	const md = new vscode.MarkdownString('', true);
	md.appendMarkdown('**').appendText(sheet.title).appendMarkdown('**');
	if (sheet.description) {
		md.appendMarkdown('\n\n').appendText(sheet.description);
	}
	if (sheet.authors.length > 0) {
		md.appendMarkdown('\n\n$(person) ').appendText(sheet.authors.join(', '));
	}
	if (sheet.tags.length > 0) {
		md.appendMarkdown('\n\n$(tag) ').appendText(sheet.tags.join(', '));
	}
	md.appendMarkdown(cached ? '\n\n$(pass-filled) Available offline' : '\n\n$(cloud-download) Downloads on first open');
	if (pinned) {
		md.appendMarkdown('\n\n$(pinned) In Favorites');
	}
	return md;
}
