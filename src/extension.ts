import * as vscode from 'vscode';
import { Cheatsheet, fetchCatalog, tagsNotInTitle } from './catalog';
import { CheatsheetTreeProvider } from './cheatsheetTree';
import { Favorites } from './favorites';
import { openPdf } from './openPdf';
import { PdfCache } from './pdfCache';

const LIST_VIEW_ID = 'positCheatsheets.list';
const FAVORITES_VIEW_ID = 'positCheatsheets.favorites';
const CATALOG_KEY = 'catalog';
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredCatalog {
	fetchedAt: number;
	sheets: Cheatsheet[];
}

type ViewState = 'loading' | 'ready' | 'error';

export interface PositCheatsheetsApi {
	/** The cheatsheets currently listed in the view. */
	getCheatsheets(): readonly Cheatsheet[];
	/** The pinned cheatsheets, in the order they were pinned. */
	getFavorites(): readonly Cheatsheet[];
}

export async function activate(context: vscode.ExtensionContext): Promise<PositCheatsheetsApi> {
	const cache = new PdfCache(context.globalStorageUri);
	const favorites = new Favorites(context.globalState);

	// Show the last known list right away; it also keeps the view usable offline.
	const stored = context.globalState.get<StoredCatalog>(CATALOG_KEY);
	let sheets = Array.isArray(stored?.sheets) ? stored.sheets : [];
	// Favorites missing from the current list stay stored, in case they come back.
	const favoriteSheets = () => favorites.all.flatMap(slug => sheets.find(sheet => sheet.slug === slug) ?? []);

	const listTree = new CheatsheetTreeProvider(() => sheets, cache, favorites);
	const favoritesTree = new CheatsheetTreeProvider(favoriteSheets, cache, favorites);
	const listView = vscode.window.createTreeView(LIST_VIEW_ID, { treeDataProvider: listTree });
	const favoritesView = vscode.window.createTreeView(FAVORITES_VIEW_ID, { treeDataProvider: favoritesTree });
	const refreshTrees = () => {
		listTree.refresh();
		favoritesTree.refresh();
	};

	// The view the user last picked a cheatsheet in, for progress bars and keybindings.
	let active = { view: listView, id: LIST_VIEW_ID };
	context.subscriptions.push(
		cache, favorites, listTree, favoritesTree, listView, favoritesView,
		cache.onDidChange(refreshTrees),
		favorites.onDidChange(() => {
			refreshTrees();
			void setHasFavorites(favorites.all.length > 0);
		}),
		listView.onDidChangeSelection(() => active = { view: listView, id: LIST_VIEW_ID }),
		favoritesView.onDidChangeSelection(() => active = { view: favoritesView, id: FAVORITES_VIEW_ID }),
	);

	await setHasFavorites(favorites.all.length > 0);
	await cache.load();

	let refreshing: Promise<void> | undefined;
	const refresh = (): Promise<void> => {
		refreshing ??= (async () => {
			await setViewState('loading');
			listView.message = sheets.length === 0 ? 'Loading cheatsheets…' : undefined;
			try {
				sheets = await vscode.window.withProgress({ location: { viewId: LIST_VIEW_ID } }, fetchCatalog);
				refreshTrees();
				listView.message = undefined;
				await context.globalState.update(CATALOG_KEY, { fetchedAt: Date.now(), sheets } satisfies StoredCatalog);
				await setViewState('ready');
			} catch (err) {
				if (sheets.length > 0) {
					listView.message = undefined;
					vscode.window.showWarningMessage(`Couldn't refresh the cheatsheet list: ${errorMessage(err)}`);
					await setViewState('ready');
				} else {
					// The welcome view offers a Retry button; the message says what went wrong.
					listView.message = `Couldn't load the cheatsheets: ${errorMessage(err)}`;
					await setViewState('error');
				}
			} finally {
				refreshing = undefined;
			}
		})();
		return refreshing;
	};

	const open = async (sheet: Cheatsheet, force = false): Promise<void> => {
		try {
			let file: vscode.Uri;
			if (cache.isCached(sheet.slug) && !force) {
				file = await cache.getLocalPdf(sheet);
			} else {
				const location = active.view.visible ? { viewId: active.id } : vscode.ProgressLocation.Notification;
				file = await vscode.window.withProgress(
					{ location, title: `Downloading "${sheet.title}"…` },
					() => cache.getLocalPdf(sheet, force),
				);
			}
			await openPdf(file);
		} catch (err) {
			const openOnWebsite = 'Open on Website';
			const choice = await vscode.window.showErrorMessage(
				`Couldn't open "${sheet.title}": ${errorMessage(err)}`,
				openOnWebsite,
			);
			if (choice === openOnWebsite) {
				await vscode.env.openExternal(vscode.Uri.parse(sheet.pageUrl));
			}
		}
	};

	// Commands from the tree get the cheatsheet as argument; from a keybinding, use the selection.
	const withSheet = (fn: (sheet: Cheatsheet) => unknown) => (sheet?: Cheatsheet) => {
		const target = sheet ?? active.view.selection[0];
		return target && fn(target);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('positCheatsheets.refresh', refresh),
		vscode.commands.registerCommand('positCheatsheets.open', withSheet(sheet => open(sheet))),
		vscode.commands.registerCommand('positCheatsheets.redownload', withSheet(sheet => open(sheet, true))),
		vscode.commands.registerCommand('positCheatsheets.openInBrowser', withSheet(sheet =>
			vscode.env.openExternal(vscode.Uri.parse(sheet.pageUrl)),
		)),
		vscode.commands.registerCommand('positCheatsheets.pin', withSheet(sheet => favorites.add(sheet.slug))),
		vscode.commands.registerCommand('positCheatsheets.unpin', withSheet(sheet => favorites.remove(sheet.slug))),
		vscode.commands.registerCommand('positCheatsheets.quickOpen', async () => {
			if (sheets.length === 0) {
				await refresh();
			}
			if (sheets.length === 0) {
				vscode.window.showErrorMessage("Couldn't load the cheatsheet list. Check your internet connection and try again.");
				return;
			}
			const picked = await vscode.window.showQuickPick(
				sheets.map(sheet => ({
					label: sheet.title,
					description: tagsNotInTitle(sheet).join(', '),
					detail: sheet.description,
					sheet,
				})),
				{ placeHolder: 'Open a Posit cheatsheet', matchOnDescription: true, matchOnDetail: true },
			);
			if (picked) {
				await open(picked.sheet);
			}
		}),
		vscode.commands.registerCommand('positCheatsheets.clearCache', async () => {
			try {
				await cache.clear();
				vscode.window.showInformationMessage('Deleted the downloaded cheatsheet PDFs.');
			} catch (err) {
				vscode.window.showErrorMessage(`Couldn't delete the downloaded PDFs: ${errorMessage(err)}`);
			}
		}),
	);

	const isStale = !stored || Date.now() - stored.fetchedAt > CATALOG_MAX_AGE_MS;
	if (sheets.length === 0 || isStale) {
		void refresh();
	} else {
		await setViewState('ready');
	}

	return { getCheatsheets: () => sheets, getFavorites: favoriteSheets };
}

export function deactivate(): void { }

function setViewState(state: ViewState): Thenable<unknown> {
	return vscode.commands.executeCommand('setContext', 'positCheatsheets.state', state);
}

function setHasFavorites(hasFavorites: boolean): Thenable<unknown> {
	return vscode.commands.executeCommand('setContext', 'positCheatsheets.hasFavorites', hasFavorites);
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		// fetch() wraps network failures as "fetch failed"; the cause says what happened.
		const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
		return err.name === 'TimeoutError' ? 'the request timed out' : err.message + cause;
	}
	return String(err);
}
