import type {
	DpoObservation,
} from '../types';

import type {
	PdpcLookupResponse,
	PdpcLookupState,
	PdpcSearchAttempt,
	PdpcSearchRequest,
	PdpcSearchType,
} from './types';

import {
	buildPdpcSearchOrder,
	PDPC_REGISTRY_URL,
} from './types';


/**
 * Minimal browser/page interfaces.
 *
 * These deliberately avoid coupling the rest of the application to a
 * particular Puppeteer package version. The Browser Rendering adapter
 * can supply a compatible Page object.
 */
export interface BrowserPageLike {
	goto(
		url: string,
		options?: Record<string, unknown>,
	): Promise<unknown>;

	content(): Promise<string>;

	title(): Promise<string>;

	close(): Promise<void>;
}


export interface PdpcBrowserSession {
	page: BrowserPageLike;
	close(): Promise<void>;
}


/**
 * Result produced by the browser-specific search implementation.
 *
 * The low-level adapter is responsible for interacting with the real
 * PDPC form after the page has been verified as usable.
 */
export interface BrowserSearchResult {
	state: PdpcLookupState;

	observations: DpoObservation[];

	message?: string;
}


/**
 * Detects whether the page appears to be blocked behind an interactive
 * human-verification challenge.
 *
 * This is detection only.
 *
 * The application must not attempt to solve, click, bypass or otherwise
 * circumvent reCAPTCHA.
 */
export function pageRequiresVerification(
	html: string,
): boolean {
	const value = html.toLowerCase();

	return (
		value.includes('g-recaptcha') ||
		value.includes('recaptcha') ||
		value.includes('i am not a robot') ||
		value.includes("i'm not a robot") ||
		value.includes('cf-chl-') ||
		value.includes('challenge-platform')
	);
}


/**
 * Detects obvious upstream/service failures.
 */
export function pageLooksUnavailable(
	html: string,
	title = '',
): boolean {
	const value =
		`${title} ${html}`.toLowerCase();

	return (
		value.includes('service unavailable') ||
		value.includes('temporarily unavailable') ||
		value.includes('bad gateway') ||
		value.includes('gateway timeout') ||
		value.includes('internal server error')
	);
}


/**
 * Opens the official PDPC registry and determines whether automated
 * interaction is currently possible without bypassing human verification.
 */
export async function inspectPdpcRegistry(
	session: PdpcBrowserSession,
): Promise<{
	state: PdpcLookupState;
	message?: string;
}> {
	const { page } = session;

	try {
		await page.goto(
			PDPC_REGISTRY_URL,
			{
				waitUntil: 'networkidle2',
				timeout: 30_000,
			},
		);

		const [html, title] =
			await Promise.all([
				page.content(),
				page.title(),
			]);

		if (
			pageLooksUnavailable(
				html,
				title,
			)
		) {
			return {
				state: 'registry_unavailable',
				message:
					'The PDPC registry is currently unavailable.',
			};
		}

		if (
			pageRequiresVerification(html)
		) {
			return {
				state: 'verification_required',
				message:
					'PDPC requires interactive human verification before registry searching can continue.',
			};
		}

		return {
			state: 'not_found',
			message:
				'PDPC registry loaded without a detected verification challenge.',
		};
	} catch (error) {
		return {
			state: 'registry_unavailable',
			message:
				error instanceof Error
					? error.message
					: String(error),
		};
	}
}


/**
 * Executes the UEN-first lookup policy.
 *
 * The actual form interaction is injected as `search`.
 *
 * This separation is intentional:
 *
 * - identity/reconciliation rules remain stable;
 * - browser selectors can be changed independently if PDPC changes its UI;
 * - CAPTCHA handling cannot accidentally become mixed into search logic.
 */
export async function lookupPdpc(
	request: PdpcSearchRequest,
	session: PdpcBrowserSession,
	search: (
		page: BrowserPageLike,
		type: PdpcSearchType,
		value: string,
	) => Promise<BrowserSearchResult>,
): Promise<PdpcLookupResponse> {
	const inspection =
		await inspectPdpcRegistry(session);

	if (
		inspection.state ===
			'verification_required'
	) {
		return {
			found: false,
			state: 'verification_required',
			observations: [],
			attempts: [],
			message: inspection.message,
		};
	}

	if (
		inspection.state ===
			'registry_unavailable'
	) {
		return {
			found: false,
			state: 'registry_unavailable',
			observations: [],
			attempts: [],
			message: inspection.message,
		};
	}

	const searchOrder =
		buildPdpcSearchOrder(request);

	const attempts: PdpcSearchAttempt[] =
		[];

	for (const item of searchOrder) {
		let result: BrowserSearchResult;

		try {
			result = await search(
				session.page,
				item.type,
				item.value,
			);
		} catch (error) {
			result = {
				state: 'parse_error',
				observations: [],
				message:
					error instanceof Error
						? error.message
						: String(error),
			};
		}

		const attempt: PdpcSearchAttempt = {
			searchType: item.type,
			searchValue: item.value,
			state: result.state,
			observations:
				result.observations,
			message: result.message,
		};

		attempts.push(attempt);


		/*
		 * Never proceed past an interactive verification requirement.
		 */
		if (
			result.state ===
			'verification_required'
		) {
			return {
				found: false,
				state:
					'verification_required',
				observations: [],
				attempts,
				message: result.message,
			};
		}


		if (
			result.state ===
			'registry_unavailable'
		) {
			return {
				found: false,
				state:
					'registry_unavailable',
				observations: [],
				attempts,
				message: result.message,
			};
		}


		/*
		 * Preserve every DPO returned for the matched organisation.
		 *
		 * Example:
		 * one UEN returning two DPOs => two observations.
		 */
		if (
			result.state === 'found' &&
			result.observations.length > 0
		) {
			return {
				found: true,
				state: 'found',
				observations:
					result.observations,
				matchedBy: item.type,
				attempts,
			};
		}


		/*
		 * If UEN produces no record, continue to the estate-name
		 * fallback automatically.
		 */
		if (
			result.state === 'not_found'
		) {
			continue;
		}


		if (
			result.state === 'parse_error'
		) {
			return {
				found: false,
				state: 'parse_error',
				observations: [],
				attempts,
				message:
					result.message ??
					'Unable to interpret the PDPC registry response.',
			};
		}
	}


	return {
		found: false,
		state: 'not_found',
		observations: [],
		attempts,
		message:
			'No PDPC registry result was found using the available identifiers.',
	};
}


/**
 * Convenience helper for safely closing a browser session.
 */
export async function closePdpcSession(
	session:
		| PdpcBrowserSession
		| null
		| undefined,
): Promise<void> {
	if (!session) return;

	try {
		await session.close();
	} catch {
		/*
		 * Browser cleanup must not overwrite the actual lookup result.
		 */
	}
}
