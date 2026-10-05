import type { DpoObservation } from '../types';

export const PDPC_REGISTRY_URL =
	'https://www.pdpc.gov.sg/individuals/e-services/data-protection-officers-dpo-registry';

export type PdpcSearchType =
	| 'uen'
	| 'estate_name';

export type PdpcLookupState =
	| 'found'
	| 'not_found'
	| 'verification_required'
	| 'registry_unavailable'
	| 'parse_error';

export interface PdpcSearchRequest {
	mcstNo: string;
	uen: string;
	estateName: string;
}

export interface PdpcSearchAttempt {
	searchType: PdpcSearchType;
	searchValue: string;
	state: PdpcLookupState;
	observations: DpoObservation[];
	message?: string;
}

export interface PdpcLookupResponse {
	found: boolean;

	state: PdpcLookupState;

	/**
	 * Records returned by PDPC.
	 *
	 * Never collapse multiple DPOs into a single observation.
	 */
	observations: DpoObservation[];

	/**
	 * Which identifier ultimately produced the result.
	 */
	matchedBy?: PdpcSearchType;

	/**
	 * Audit trail showing UEN/name attempts.
	 */
	attempts: PdpcSearchAttempt[];

	message?: string;
}


/**
 * Determines the search order for a BCA MCST record.
 *
 * UEN is deliberately preferred because it is the stronger
 * organisation identifier.
 */
export function buildPdpcSearchOrder(
	request: PdpcSearchRequest,
): Array<{
	type: PdpcSearchType;
	value: string;
}> {
	const searches: Array<{
		type: PdpcSearchType;
		value: string;
	}> = [];

	const uen = request.uen.trim();
	const estateName = request.estateName.trim();

	if (uen) {
		searches.push({
			type: 'uen',
			value: uen,
		});
	}

	if (estateName) {
		searches.push({
			type: 'estate_name',
			value: estateName,
		});
	}

	return searches;
}
