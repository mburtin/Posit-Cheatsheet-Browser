import * as vscode from 'vscode';

const FAVORITES_KEY = 'favorites';

/** Slugs of the pinned cheatsheets, in the order they were pinned. */
export class Favorites implements vscode.Disposable {
	private slugs: string[];
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly state: vscode.ExtensionContext['globalState']) {
		// Follow the user across machines when Settings Sync is on.
		state.setKeysForSync([FAVORITES_KEY]);
		const stored = state.get<unknown>(FAVORITES_KEY);
		this.slugs = Array.isArray(stored) ? stored.filter((slug): slug is string => typeof slug === 'string') : [];
	}

	get all(): readonly string[] {
		return this.slugs;
	}

	has(slug: string): boolean {
		return this.slugs.includes(slug);
	}

	add(slug: string): Thenable<void> {
		return this.has(slug) ? Promise.resolve() : this.save([...this.slugs, slug]);
	}

	remove(slug: string): Thenable<void> {
		return this.has(slug) ? this.save(this.slugs.filter(s => s !== slug)) : Promise.resolve();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	private async save(slugs: string[]): Promise<void> {
		this.slugs = slugs;
		this.changeEmitter.fire();
		await this.state.update(FAVORITES_KEY, slugs);
	}
}
