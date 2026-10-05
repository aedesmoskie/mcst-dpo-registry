import type { DpoObservation } from '../types';

import type {
	BrowserPageLike,
	BrowserSearchResult,
} from './browser';

import type {
	PdpcSearchType,
} from './types';

import {
	normaliseUen,
	cleanSourceText,
} from '../normalise';


/**
 * Additional page capabilities required for interacting with
 * the PDPC registry form.
 */
interface PdpcFormPage extends BrowserPageLike {
	$(
		selector: string,
	): Promise<unknown | null>;

	$$eval<T>(
		selector: string,
		fn: (elements: Element[]) => T,
	): Promise<T>;

	evaluate<T>(
		fn: (...args: any[]) => T | Promise<T>,
		...args: any[]
	): Promise<T>;

	waitForSelector(
		selector: string,
		options?: Record<string, unknown>,
	): Promise<unknown>;

	waitForFunction(
		fn: (...args: any[]) => unknown,
		options?: Record<string, unknown>,
		...args: any[]
	): Promise<unknown>;
}


function asFormPage(
	page: BrowserPageLike,
): PdpcFormPage {
	return page as PdpcFormPage;
}


/**
 * Finds the visible organisation-search input using its semantic
 * relationship to the PDPC form rather than relying on one brittle
 * generated CSS class.
 */
async function findSearchInputSelector(
	page: PdpcFormPage,
): Promise<string | null> {
	return page.evaluate(() => {
		const inputs = Array.from(
			document.querySelectorAll<HTMLInputElement>(
				'input[type="text"], input:not([type])',
			),
		);

		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];

			const placeholder =
				(input.getAttribute('placeholder') ?? '')
					.toLowerCase();

			const aria =
				(input.getAttribute('aria-label') ?? '')
					.toLowerCase();

			const name =
				(input.getAttribute('name') ?? '')
					.toLowerCase();

			const id =
				(input.id ?? '')
					.toLowerCase();

			const combined =
				`${placeholder} ${aria} ${name} ${id}`;

			if (
				combined.includes('uen') ||
				combined.includes('entity') ||
				combined.includes('organisation') ||
				combined.includes('organization') ||
				combined.includes('search')
			) {
				input.setAttribute(
					'data-mcst-dpo-search',
					'true',
				);

				return (
					'input[data-mcst-dpo-search="true"]'
				);
			}
		}

		/*
		 * Fallback:
		 * if the page contains only one normal visible text input,
		 * treat it as the registry search field.
		 */
		const visible = inputs.filter((input) => {
			const style =
				window.getComputedStyle(input);

			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				!input.disabled
			);
		});

		if (visible.length === 1) {
			visible[0].setAttribute(
				'data-mcst-dpo-search',
				'true',
			);

			return (
				'input[data-mcst-dpo-search="true"]'
			);
		}

		return null;
	});
}


/**
 * Enters a search value and submits the PDPC form.
 *
 * This code does NOT interact with reCAPTCHA.
 */
async function submitSearch(
	page: PdpcFormPage,
	selector: string,
	value: string,
): Promise<void> {
	await page.evaluate(
		(searchSelector, searchValue) => {
			const input =
				document.querySelector<HTMLInputElement>(
					searchSelector,
				);

			if (!input) {
				throw new Error(
					'PDPC search input disappeared.',
				);
			}

			const nativeSetter =
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					'value',
				)?.set;

			if (nativeSetter) {
				nativeSetter.call(
					input,
					searchValue,
				);
			} else {
				input.value = searchValue;
			}

			input.dispatchEvent(
				new Event('input', {
					bubbles: true,
				}),
			);

			input.dispatchEvent(
				new Event('change', {
					bubbles: true,
				}),
			);
		},
		selector,
		value,
	);


	await page.evaluate(() => {
		const buttons = Array.from(
			document.querySelectorAll<HTMLButtonElement>(
				'button, input[type="submit"]',
			),
		);

		const searchButton =
			buttons.find((element) => {
				const text =
					(
						element.textContent ??
						element.getAttribute('value') ??
						''
					)
						.trim()
						.toLowerCase();

				return (
					text === 'search' ||
					text.includes('search')
				);
			});

		if (!searchButton) {
			throw new Error(
				'PDPC Search button was not found.',
			);
		}

		searchButton.click();
	});


	/*
	 * Wait for either results, a no-result response, or a new
	 * verification requirement.
	 */
	await page.waitForFunction(
		() => {
			const text =
				document.body.innerText
					.toLowerCase();

			return (
				text.includes("dpo's name") ||
				text.includes('entity name') ||
				text.includes('no record') ||
				text.includes('no result') ||
				text.includes('not found') ||
				text.includes(
					'i am not a robot',
				) ||
				text.includes('recaptcha')
			);
		},
		{
			timeout: 30_000,
		},
	);
}


/**
 * Parses the visible PDPC result table.
 *
 * Expected columns observed in the registry:
 *
 * Entity Name | UEN | DPO's Name | Email
 */
async function parseResults(
	page: PdpcFormPage,
): Promise<DpoObservation[]> {
	return page.evaluate(() => {
		const observations: Array<{
			organisationName: string;
			uen: string;
			dpoName: string;
			dpoEmail: string;
			dpoCompany: string;
		}> = [];

		const tables = Array.from(
			document.querySelectorAll('table'),
		);

		for (const table of tables) {
			const rows = Array.from(
				table.querySelectorAll('tr'),
			);

			for (const row of rows) {
				const cells = Array.from(
					row.querySelectorAll('td'),
				).map((cell) =>
					(
						cell.textContent ?? ''
					)
						.replace(/\s+/g, ' ')
						.trim(),
				);

				if (cells.length < 4) {
					continue;
				}

				const [
					organisationName,
					uen,
					dpoName,
					dpoEmail,
				] = cells;

				/*
				 * Avoid accidentally treating unrelated tables
				 * as DPO results.
				 */
				if (
					!organisationName ||
					!uen ||
					!dpoName
				) {
					continue;
				}

				observations.push({
					organisationName,
					uen,
					dpoName,
					dpoEmail:
						dpoEmail ?? '',
					dpoCompany: '',
				});
			}
		}

		return observations;
	});
}


/**
 * Executes one search against an already-accessible PDPC registry
 * session.
 *
 * UEN will normally be supplied first by the orchestration layer.
 */
export async function searchPdpcForm(
	pageInput: BrowserPageLike,
	searchType: PdpcSearchType,
	searchValue: string,
): Promise<BrowserSearchResult> {
	const page =
		asFormPage(pageInput);

	const html =
		await page.content();

	const lower =
		html.toLowerCase();

	/*
	 * Never interact with the human-verification control.
	 */
	if (
		lower.includes('g-recaptcha') ||
		lower.includes('recaptcha')
	) {
		return {
			state:
				'verification_required',
			observations: [],
			message:
				'PDPC requires human verification before the search can continue.',
		};
	}


	const selector =
		await findSearchInputSelector(page);

	if (!selector) {
		return {
			state: 'parse_error',
			observations: [],
			message:
				'Unable to locate the PDPC registry search field.',
		};
	}


	const value =
		searchType === 'uen'
			? normaliseUen(searchValue)
			: cleanSourceText(searchValue);

	if (!value) {
		return {
			state: 'not_found',
			observations: [],
			message:
				'No usable search value was supplied.',
		};
	}


	try {
		await submitSearch(
			page,
			selector,
			value,
		);
	} catch (error) {
		const currentHtml =
			(await page.content())
				.toLowerCase();

		if (
			currentHtml.includes(
				'recaptcha',
			)
		) {
			return {
				state:
					'verification_required',
				observations: [],
				message:
					'PDPC requires human verification before the search can continue.',
			};
		}

		return {
			state: 'parse_error',
			observations: [],
			message:
				error instanceof Error
					? error.message
					: String(error),
		};
	}


	const afterSearch =
		(await page.content())
			.toLowerCase();

	if (
		afterSearch.includes('recaptcha')
	) {
		return {
			state:
				'verification_required',
			observations: [],
			message:
				'PDPC requested human verification.',
		};
	}


	const observations =
		await parseResults(page);


	/*
	 * For UEN searches, only retain records whose returned UEN
	 * actually matches the requested UEN.
	 *
	 * This prevents an unrelated result from being accepted merely
	 * because it appeared in the table.
	 */
	const filtered =
		searchType === 'uen'
			? observations.filter(
					(item) =>
						normaliseUen(item.uen) ===
						normaliseUen(value),
				)
			: observations;


	if (filtered.length > 0) {
		return {
			state: 'found',
			observations: filtered,
		};
	}


	const bodyText =
		await page.evaluate(
			() =>
				document.body.innerText
					.toLowerCase(),
		);


	if (
		bodyText.includes('no record') ||
		bodyText.includes('no result') ||
		bodyText.includes('not found')
	) {
		return {
			state: 'not_found',
			observations: [],
		};
	}


	/*
	 * A completed search with no qualifying result is treated as
	 * not-found rather than manufacturing a DPO observation.
	 */
	return {
		state: 'not_found',
		observations: [],
	};
}
