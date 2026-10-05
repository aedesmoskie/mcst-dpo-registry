/**
 * Conservative text normalisation used for comparison only.
 *
 * IMPORTANT:
 * - Original source values must always be preserved.
 * - Normalised values must never be written over BCA or PDPC source data.
 * - This function is for discrepancy detection, not entity merging.
 */
export function normaliseName(value: string | null | undefined): string {
	if (!value) return '';

	return value
		.normalize('NFKC')
		.toUpperCase()
		.replace(/&/g, ' AND ')
		.replace(/[’'`]/g, '')
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}


/**
 * Normalises an MCST number while preserving the meaningful numeric
 * identifier.
 *
 * Examples:
 * "MCST 1000"      -> "1000"
 * "MCST No. 1000"  -> "1000"
 * "1000"           -> "1000"
 */
export function normaliseMcstNumber(
	value: string | number | null | undefined,
): string {
	if (value === null || value === undefined) return '';

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


/**
 * Conservative UEN normalisation.
 *
 * We remove formatting whitespace/punctuation and uppercase the value.
 * We do not attempt to infer or repair a malformed UEN.
 */
export function normaliseUen(value: string | null | undefined): string {
	if (!value) return '';

	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.trim();
}


/**
 * Determines whether two supplied names are equivalent after conservative
 * formatting normalisation.
 *
 * Empty values are never considered equivalent.
 */
export function namesEquivalent(
	left: string | null | undefined,
	right: string | null | undefined,
): boolean {
	const a = normaliseName(left);
	const b = normaliseName(right);

	if (!a || !b) return false;

	return a === b;
}


/**
 * Returns true when both sources provide an estate/organisation name and
 * those names differ after conservative normalisation.
 *
 * A missing PDPC organisation name is NOT automatically a discrepancy.
 * It simply means there is insufficient evidence for a name comparison.
 */
export function hasNameDiscrepancy(
	bcaEstateName: string | null | undefined,
	pdpcOrganisationName: string | null | undefined,
): boolean {
	const bca = normaliseName(bcaEstateName);
	const pdpc = normaliseName(pdpcOrganisationName);

	if (!bca || !pdpc) return false;

	return bca !== pdpc;
}


/**
 * Removes surrounding whitespace without otherwise modifying source data.
 */
export function cleanSourceText(
	value: string | null | undefined,
): string {
	return value?.trim() ?? '';
}


/**
 * Basic email validation for collected public DPO business-email fields.
 *
 * It deliberately does not reject uncommon but syntactically valid domains.
 */
export function looksLikeEmail(
	value: string | null | undefined,
): boolean {
	if (!value) return false;

	const email = value.trim();

	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
