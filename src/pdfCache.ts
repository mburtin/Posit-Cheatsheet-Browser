import * as vscode from 'vscode';
import { Cheatsheet, fetchBytes, fetchPdfUrl } from './catalog';

const PDF_MAGIC = '%PDF';

/**
 * Downloaded PDFs, stored as `<globalStorage>/pdfs/<slug>.pdf`. Positron's PDF
 * viewer reads files from disk, so a cheatsheet is downloaded before it opens.
 */
export class PdfCache implements vscode.Disposable {
	private readonly dir: vscode.Uri;
	private readonly cached = new Set<string>();
	private readonly downloads = new Map<string, Promise<vscode.Uri>>();
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(storageUri: vscode.Uri) {
		this.dir = vscode.Uri.joinPath(storageUri, 'pdfs');
	}

	async load(): Promise<void> {
		this.cached.clear();
		try {
			for (const [name, type] of await vscode.workspace.fs.readDirectory(this.dir)) {
				if (type === vscode.FileType.File && name.endsWith('.pdf')) {
					this.cached.add(name.slice(0, -'.pdf'.length));
				}
			}
		} catch {
			// Nothing downloaded yet.
		}
		this.changeEmitter.fire();
	}

	isCached(slug: string): boolean {
		return this.cached.has(slug);
	}

	/**
	 * Return the local copy of a cheatsheet's PDF, downloading it if it is
	 * missing or if `force` is set.
	 */
	async getLocalPdf(sheet: Cheatsheet, force = false): Promise<vscode.Uri> {
		const file = this.fileFor(sheet.slug);
		if (!force && this.isCached(sheet.slug) && await exists(file)) {
			return file;
		}
		let download = this.downloads.get(sheet.slug);
		if (!download) {
			download = this.download(sheet, file).finally(() => this.downloads.delete(sheet.slug));
			this.downloads.set(sheet.slug, download);
		}
		return download;
	}

	async clear(): Promise<void> {
		try {
			await vscode.workspace.fs.delete(this.dir, { recursive: true, useTrash: false });
		} catch (err) {
			if (!(err instanceof vscode.FileSystemError && err.code === 'FileNotFound')) {
				throw err;
			}
		}
		this.cached.clear();
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	private async download(sheet: Cheatsheet, file: vscode.Uri): Promise<vscode.Uri> {
		// The file name can change between versions, so read it from the page each time.
		const pdfUrl = await fetchPdfUrl(sheet);
		const bytes = await fetchBytes(pdfUrl);
		if (new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
			throw new Error(`${pdfUrl} is not a PDF file.`);
		}

		// Write to a temporary file first so an interrupted download never looks cached.
		const partial = vscode.Uri.joinPath(this.dir, `${sheet.slug}.pdf.partial`);
		await vscode.workspace.fs.createDirectory(this.dir);
		await vscode.workspace.fs.writeFile(partial, bytes);
		await vscode.workspace.fs.rename(partial, file, { overwrite: true });

		this.cached.add(sheet.slug);
		this.changeEmitter.fire();
		return file;
	}

	private fileFor(slug: string): vscode.Uri {
		return vscode.Uri.joinPath(this.dir, `${slug}.pdf`);
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
