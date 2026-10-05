/*
 * MCST identity rules
 * -------------------
 *
 * The complete BCA-published MCST identifier is the canonical identifier
 * for this application.
 *
 * Examples:
 *   4355       -> 4355
 *   01-4355    -> 01-4355
 *   02-4355    -> 02-4355
 *   SUB01-3978 -> SUB01-3978
 *
 * These identifiers must never be collapsed to their individual numeric
 * components because main and subsidiary management corporations are
 * separate records for DPO research.
 */

export function normaliseMcstIdentifier(
	v: string | number | null | undefined
): string {
	if (v === null || v === undefined) {
		return '';
	}

	const value = String(v)
		.normalize('NFKC')
		.trim()
		.toUpperCase();

	if (
		!value ||
		/^(?:NA|N\/A|NULL|NIL|-)$/i.test(value)
	) {
		return '';
	}

	/*
	 * Preserve the BCA identifier structure while removing accidental
	 * whitespace around separators.
	 */
	return value
		.replace(/\s*-\s*/g, '-')
		.replace(/\s+/g, ' ');
}


/*
 * Legacy/numeric MCST normalisation.
 *
 * This remains useful when interpreting an MCST number embedded inside
 * free-form PDPC organisation text. It must NOT be used as the canonical
 * identifier for BCA records.
 */
export function normaliseMcstNumber(
	v: string | number | null | undefined
): string {
	if (v === null || v === undefined) {
		return '';
	}

	const s = String(v).trim();

	const explicit = s.match(
		/(?:MCST|STRATA\s*TITLE\s*PLAN|STP)(?:\s*(?:NO|NUMBER))?[\s.:#-]*(\d+)/i
	);

	const n =
		explicit?.[1] ??
		s.match(/\d+/)?.[0];

	return n
		? String(Number(n))
		: '';
}


export function normaliseName(
	v: string | null | undefined
): string {
	return (v ?? '')
		.normalize('NFKC')
		.toUpperCase()
		.replace(/&/g, ' AND ')
		.replace(/[’'`]/g, '')
		.replace(/\bNO\.?\s*/g, 'NO ')
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}


export function normaliseUen(
	v: string | null | undefined
): string {
	const value = (v ?? '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.trim();

	if (
		!value ||
		/^(?:NA|NULL|NIL)$/i.test(value)
	) {
		return '';
	}

	return value;
}


export function cleanSourceText(
	v: string | null | undefined
): string {
	if (v === null || v === undefined) {
		return '';
	}

	const value = String(v).trim();

	if (
		/^(?:NA|N\/A|NULL|NIL|-)$/i.test(value)
	) {
		return '';
	}

	return value;
}


/*
 * Extract a numeric MCST reference from a PDPC entity name.
 *
 * This is supporting discrepancy evidence only. It is deliberately
 * separate from the canonical BCA MCST identifier.
 */
export function extractMcstFromEntityName(
	v: string | null | undefined
): string {
	if (!v) {
		return '';
	}

	const m = v.match(
		/(?:STRATA\s*TITLE\s*PLAN|MCST|STP)(?:\s*(?:NO|NUMBER))?[\s.:#-]*(\d+)/i
	);

	return m?.[1]
		? String(Number(m[1]))
		: '';
}


/*
 * For discrepancy checking, obtain the parent/main numeric MCST component
 * from a canonical BCA identifier.
 *
 * Examples:
 *   4355       -> 4355
 *   01-4355    -> 4355
 *   02-4355    -> 4355
 *   SUB01-3978 -> 3978
 *
 * This does NOT alter the stored canonical identifier.
 */
export function getParentMcstNumber(
	v: string | number | null | undefined
): string {
	const id = normaliseMcstIdentifier(v);

	if (!id) {
		return '';
	}

	const numbers = id.match(/\d+/g);

	if (!numbers?.length) {
		return '';
	}

	return String(
		Number(numbers[numbers.length - 1])
	);
}


export function compareIdentity(i: {
	bcaMcstNo?: string | null;
	bcaUen?: string | null;
	bcaEstateName?: string | null;
	pdpcUen?: string | null;
	pdpcEntityName?: string | null;
}) {
	const bcaIdentifier =
		normaliseMcstIdentifier(i.bcaMcstNo);

	const parentMcst =
		getParentMcstNumber(bcaIdentifier);

	const bcaUen =
		normaliseUen(i.bcaUen);

	const pdpcUen =
		normaliseUen(i.pdpcUen);

	const pdpcMcst =
		extractMcstFromEntityName(
			i.pdpcEntityName
		);

	/*
	 * UEN conflict is the strongest discrepancy signal.
	 */
	if (bcaUen && pdpcUen) {
		if (bcaUen !== pdpcUen) {
			return {
				discrepancy: true,
				reason: 'BCA and PDPC UEN differ.'
			};
		}

		/*
		 * When UEN matches, a PDPC entity-name reference to a different
		 * parent MCST number is still worth flagging.
		 *
		 * For subsidiary MCs we compare against the parent/main numeric
		 * component rather than destroying the subsidiary identifier.
		 */
		if (
			parentMcst &&
			pdpcMcst &&
			parentMcst !== pdpcMcst
		) {
			return {
				discrepancy: true,
				reason:
					'UEN matches but PDPC entity name references a different MCST number.'
			};
		}

		return {
			discrepancy: false,
			reason: ''
		};
	}

	if (
		parentMcst &&
		pdpcMcst &&
		parentMcst !== pdpcMcst
	) {
		return {
			discrepancy: true,
			reason:
				'PDPC entity name references a different MCST number.'
		};
	}

	return {
		discrepancy: false,
		reason: ''
	};
}
