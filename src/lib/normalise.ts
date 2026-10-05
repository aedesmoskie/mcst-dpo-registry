/**
 * Conservative normalisation and identity reconciliation.
 *
 * Identity hierarchy:
 *
 * 1. UEN exact match = strongest organisation match.
 * 2. MCST number = canonical BCA strata-plan identifier.
 * 3. Entity / estate name = supporting evidence only.
 *
 * Source values must always be preserved separately.
 */


export function normaliseName(
	value: string | null | undefined,
): string {
	if (!value) return '';

	return value
		.normalize('NFKC')
		.toUpperCase()
		.replace(/&/g, ' AND ')
		.replace(/[’'`]/g, '')
		.replace(/\bNO\.?\s*/g, 'NO ')
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}


export function normaliseMcstNumber(
	value: string | number | null | undefined,
): string {
	if (value === null || value === undefined) {
		return '';
	}

	const raw = String(value).trim();

	const explicit = raw.match(
		/(?:MCST|STRATA\s*TITLE\s*PLAN|STP)(?:\s*(?:NO|NUMBER))?[\s.:#-]*(\d+)/i,
	);

	if (explicit?.[1]) {
		return String(Number(explicit[1]));
	}

	const numeric = raw.match(/\d+/);

	if (!numeric) return '';

	return String(Number(numeric[0]));
}


export function normaliseUen(
	value: string | null | undefined,
): string {
	if (!value) return '';

	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.trim();
}


export function cleanSourceText(
	value: string | null | undefined,
): string {
	return value?.trim() ?? '';
}


export function namesEquivalent(
	left: string | null | undefined,
	right: string | null | undefined,
): boolean {
	const a = normaliseName(left);
	const b = normaliseName(right);

	if (!a || !b) return false;

	return a === b;
}


export function uensEquivalent(
	left: string | null | undefined,
	right: string | null | undefined,
): boolean {
	const a = normaliseUen(left);
	const b = normaliseUen(right);

	if (!a || !b) return false;

	return a === b;
}


/**
 * Attempts to extract an MCST number from a PDPC/BCA organisation name.
 *
 * Example:
 *
 * "THE MANAGEMENT CORPORATION - STRATA TITLE PLAN NO. 4869"
 * -> "4869"
 */
export function extractMcstFromEntityName(
	value: string | null | undefined,
): string {
	if (!value) return '';

	const match = value.match(
		/(?:STRATA\s*TITLE\s*PLAN|MCST|STP)(?:\s*(?:NO|NUMBER))?[\s.:#-]*(\d+)/i,
	);

	if (!match?.[1]) return '';

	return String(Number(match[1]));
}


export type IdentityMatch =
	| 'uen_match'
	| 'mcst_match'
	| 'name_match'
	| 'insufficient_evidence'
	| 'conflict';


export interface IdentityComparison {
	match: IdentityMatch;

	discrepancy: boolean;

	reason: string;
}


/**
 * Reconciles a BCA MCST record against a PDPC result.
 *
 * IMPORTANT:
 *
 * A matching UEN overrides harmless organisation-name differences.
 *
 * Example:
 *
 * BCA:
 *   UEN: T24MC0007E
 *
 * PDPC:
 *   UEN: T24MC0007E
 *   Entity Name:
 *   THE MANAGEMENT CORPORATION - STRATA TITLE PLAN NO. 4869
 *
 * This is the same legal entity even if the BCA development name is
 * "Riverfront Residences".
 */
export function compareIdentity(input: {
	bcaMcstNo?: string | null;
	bcaUen?: string | null;
	bcaEstateName?: string | null;

	pdpcUen?: string | null;
	pdpcEntityName?: string | null;
}): IdentityComparison {
	const bcaMcst =
		normaliseMcstNumber(input.bcaMcstNo);

	const bcaUen =
		normaliseUen(input.bcaUen);

	const bcaName =
		normaliseName(input.bcaEstateName);

	const pdpcUen =
		normaliseUen(input.pdpcUen);

	const pdpcName =
		normaliseName(input.pdpcEntityName);

	const pdpcMcst =
		extractMcstFromEntityName(
			input.pdpcEntityName,
		);


	/*
	 * Rule 1:
	 * Both systems provide UEN.
	 *
	 * Matching UEN is the strongest identity evidence.
	 */
	if (bcaUen && pdpcUen) {
		if (bcaUen === pdpcUen) {
			/*
			 * If PDPC also explicitly identifies another MCST number,
			 * preserve that as a genuine conflict.
			 */
			if (
				bcaMcst &&
				pdpcMcst &&
				bcaMcst !== pdpcMcst
			) {
				return {
					match: 'conflict',
					discrepancy: true,
					reason:
						'UEN matches but PDPC entity name references a different MCST number.',
				};
			}

			return {
				match: 'uen_match',
				discrepancy: false,
				reason:
					'BCA and PDPC UEN match.',
			};
		}

		return {
			match: 'conflict',
			discrepancy: true,
			reason:
				'BCA and PDPC UEN differ.',
		};
	}


	/*
	 * Rule 2:
	 * UEN comparison is unavailable, but PDPC explicitly contains
	 * an MCST number.
	 */
	if (bcaMcst && pdpcMcst) {
		if (bcaMcst === pdpcMcst) {
			return {
				match: 'mcst_match',
				discrepancy: false,
				reason:
					'MCST number matches.',
			};
		}

		return {
			match: 'conflict',
			discrepancy: true,
			reason:
				'PDPC entity name references a different MCST number.',
		};
	}


	/*
	 * Rule 3:
	 * Name matching is only supporting evidence.
	 */
	if (
		bcaName &&
		pdpcName &&
		bcaName === pdpcName
	) {
		return {
			match: 'name_match',
			discrepancy: false,
			reason:
				'Entity names match but stronger identifiers were unavailable.',
		};
	}


	/*
	 * A different development/entity name alone is NOT sufficient
	 * evidence of a discrepancy.
	 *
	 * BCA may publish the development name while PDPC may publish the
	 * legal Management Corporation name.
	 */
	return {
		match: 'insufficient_evidence',
		discrepancy: false,
		reason:
			'No conflicting authoritative identifier was found.',
	};
}


/**
 * Compatibility helper for existing application code.
 *
 * Name differences by themselves no longer create a discrepancy.
 */
export function hasNameDiscrepancy(
	_bcaEstateName: string | null | undefined,
	_pdpcOrganisationName: string | null | undefined,
): boolean {
	return false;
}


export function looksLikeEmail(
	value: string | null | undefined,
): boolean {
	if (!value) return false;

	const email = value.trim();

	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
