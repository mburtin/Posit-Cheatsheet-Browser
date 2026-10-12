import { parse } from 'node-html-parser';

// posit.co/resources/cheatsheets/ redirects here.
export const LISTING_URL = 'https://opensource.posit.co/resources/cheatsheets/';

const PAGE_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 120_000;
const USER_AGENT = 'posit-cheatsheets-vscode';

export interface Cheatsheet {
	slug: string;
	title: string;
	description: string;
	authors: string[];
	tags: string[];
	/** The cheatsheet's page on the website, which links to its PDF. */
	pageUrl: string;
}

/**
 * Extract the cheatsheets from the listing page, in the order the site shows them.
 */
export function parseListing(html: string, baseUrl: string = LISTING_URL): Cheatsheet[] {
	const root = parse(html);
	const listingPath = new URL(baseUrl).pathname;
	const sheets = new Map<string, Cheatsheet>();

	for (const card of root.querySelectorAll('a.card-link')) {
		const href = card.getAttribute('href');
		if (!href) {
			continue;
		}
		const pageUrl = new URL(href, baseUrl);
		if (!pageUrl.pathname.startsWith(listingPath)) {
			continue;
		}
		const slug = pageUrl.pathname.slice(listingPath.length).replace(/\/+$/, '');
		if (!slug || slug.includes('/') || sheets.has(slug)) {
			continue;
		}

		const title = card.getAttribute('title')?.trim() || card.querySelector('h3')?.text.trim();
		if (!title) {
			continue;
		}

		sheets.set(slug, {
			slug,
			title,
			description: card.querySelector('p')?.text.trim() ?? '',
			authors: unique(
				card.querySelectorAll('img')
					.filter(img => img.getAttribute('src')?.startsWith('/people/'))
					.map(img => img.getAttribute('alt')?.trim() ?? '')
			),
			tags: unique(card.querySelectorAll('span.pill').map(pill => pill.text.trim())),
			pageUrl: pageUrl.href,
		});
	}

	return [...sheets.values()];
}

/**
 * The tags worth showing next to the title: "Shiny for R" tagged "Shiny" would only repeat itself.
 */
export function tagsNotInTitle(sheet: Cheatsheet): string[] {
	const title = sheet.title.toLowerCase();
	return sheet.tags.filter(tag => !title.includes(tag.toLowerCase()));
}

/**
 * Find the PDF download link on a cheatsheet's page. The file name varies
 * between cheatsheets, so it has to be read from the page.
 */
export function parsePdfUrl(html: string, pageUrl: string): string | undefined {
	const link = parse(html).querySelector('a[href$=".pdf"]');
	const href = link?.getAttribute('href');
	return href ? new URL(href, pageUrl).href : undefined;
}

export async function fetchCatalog(): Promise<Cheatsheet[]> {
	const sheets = parseListing(await fetchText(LISTING_URL));
	if (sheets.length === 0) {
		throw new Error(`No cheatsheets found on ${LISTING_URL}. The website layout may have changed.`);
	}
	return sheets;
}

export async function fetchPdfUrl(sheet: Cheatsheet): Promise<string> {
	const pdfUrl = parsePdfUrl(await fetchText(sheet.pageUrl), sheet.pageUrl);
	if (!pdfUrl) {
		throw new Error(`No PDF link found on ${sheet.pageUrl}.`);
	}
	return pdfUrl;
}

export async function fetchText(url: string): Promise<string> {
	return (await request(url, PAGE_TIMEOUT_MS)).text();
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
	return new Uint8Array(await (await request(url, PDF_TIMEOUT_MS)).arrayBuffer());
}

async function request(url: string, timeoutMs: number): Promise<Response> {
	const response = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	return response;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
