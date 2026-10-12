import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchCatalog, fetchPdfUrl, LISTING_URL, parseListing, parsePdfUrl, tagsNotInTitle } from '../src/catalog';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseListing', () => {
	const sheets = parseListing(fixture('listing.html'));
	const bySlug = new Map(sheets.map(sheet => [sheet.slug, sheet]));

	it('finds every cheatsheet once, in page order', () => {
		expect(sheets).toHaveLength(30);
		expect(new Set(sheets.map(sheet => sheet.slug)).size).toBe(30);
		expect(sheets[0].slug).toBe('ml-measure-performance');
		expect(sheets.at(-1)?.slug).toBe('shinychat');
	});

	it('reads the card details', () => {
		expect(bySlug.get('positron')).toEqual({
			slug: 'positron',
			title: 'Positron',
			description: 'Quick reference guide for positron',
			authors: [],
			tags: ['Positron'],
			pageUrl: 'https://opensource.posit.co/resources/cheatsheets/positron/',
		});
		expect(bySlug.get('polars')).toMatchObject({
			title: 'Python Polars: The Definitive Cheatsheet',
			authors: ['Jeroen Janssens', 'Thijs Nieuwdorp'],
			tags: ['Great Tables', 'plotnine'],
		});
	});

	it('decodes HTML entities', () => {
		expect(bySlug.get('nlp-with-llms')?.title).toBe('Natural Language Processing using LLMs in R & Python');
		expect(bySlug.get('data-import')?.authors).toContain('Mine Çetinkaya-Rundel');
	});

	it('ignores links outside the cheatsheets section', () => {
		const html = '<a class="card-link" href="/blog/post/" title="Post"></a>'
			+ '<a class="card-link" href="/resources/cheatsheets/gt/" title="gt"></a>';
		expect(parseListing(html).map(sheet => sheet.slug)).toEqual(['gt']);
	});
});

describe('tagsNotInTitle', () => {
	const sheets = new Map(parseListing(fixture('listing.html')).map(sheet => [sheet.slug, sheet]));

	it('drops tags the title already mentions, ignoring case', () => {
		expect(tagsNotInTitle(sheets.get('positron')!)).toEqual([]);
		expect(tagsNotInTitle(sheets.get('rstudio-ide')!)).toEqual([]);
		expect(tagsNotInTitle(sheets.get('polars')!)).toEqual(['Great Tables', 'plotnine']);
		expect(tagsNotInTitle(sheets.get('package-development')!)).toEqual(['devtools', 'usethis']);
	});
});

describe('parsePdfUrl', () => {
	it('resolves the PDF link against the page URL', () => {
		expect(parsePdfUrl(fixture('positron.html'), 'https://opensource.posit.co/resources/cheatsheets/positron/'))
			.toBe('https://opensource.posit.co/resources/cheatsheets/positron/positron.pdf');
		expect(parsePdfUrl(fixture('polars.html'), 'https://opensource.posit.co/resources/cheatsheets/polars/'))
			.toBe('https://opensource.posit.co/resources/cheatsheets/polars/polars-cheatsheet.pdf');
	});

	it('returns undefined when the page has no PDF link', () => {
		expect(parsePdfUrl('<a href="/about/">About</a>', LISTING_URL)).toBeUndefined();
	});
});

// Checks the live website still matches what the parser expects: LIVE=1 npm test
describe.runIf(process.env.LIVE)('live website', () => {
	it('lists cheatsheets that link to PDFs', async () => {
		const sheets = await fetchCatalog();
		expect(sheets.length).toBeGreaterThan(20);

		const pdfUrl = await fetchPdfUrl(sheets[0]);
		const response = await fetch(pdfUrl, { method: 'HEAD' });
		expect(response.ok).toBe(true);
		expect(response.headers.get('content-type')).toBe('application/pdf');
	}, 30_000);
});
