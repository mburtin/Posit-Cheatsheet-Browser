import * as vscode from 'vscode';

// Built-in Positron extension that provides a PDF.js custom editor for *.pdf files.
const POSITRON_PDF_EXTENSION = 'positron.positron-pdf-server';
const POSITRON_PDF_EDITOR = 'positronPdfServer.previewEditor';

export async function openPdf(file: vscode.Uri): Promise<void> {
	if (vscode.extensions.getExtension(POSITRON_PDF_EXTENSION)) {
		await vscode.commands.executeCommand('vscode.openWith', file, POSITRON_PDF_EDITOR);
	} else {
		// Plain VS Code has no PDF viewer: hand the file to the system's default app.
		await vscode.env.openExternal(file);
	}
}
