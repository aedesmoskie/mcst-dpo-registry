export interface Env {
	DB: D1Database;
}


export interface McstRecord {
	id?: number;
	mcst_no: string;
	estate_name: string;
	uen: string;
	source: string;
	source_estate_name: string;
}


export interface DpoRecord {
	id?: number;

	mcst_no: string;

	/*
	 * Canonical identity used by the output dataset.
	 * BCA UEN takes precedence where available.
	 */
	uen: string;

	estate_name: string;

	dpo_found: boolean;

	dpo_name: string;

	dpo_email: string;

	dpo_company: string;

	/*
	 * Organisation/entity name exactly as captured from
	 * the PDPC registry result.
	 */
	pdpc_organisation_name: string;

	/*
	 * UEN returned by PDPC.
	 *
	 * This is deliberately stored independently from the
	 * canonical BCA UEN so conflicts are never overwritten.
	 */
	pdpc_uen: string;

	record_discrepancy: boolean;

	/*
	 * Explanation of a genuine identity conflict.
	 * Empty when no discrepancy was identified.
	 */
	discrepancy_reason: string;

	lookup_status: string;

	lookup_method: string;

	checked_at: string;
}


export interface DpoObservation {
	organisationName: string;

	uen: string;

	dpoName: string;

	dpoEmail: string;

	dpoCompany: string;
}


/*
 * Public/exported dataset.
 *
 * Keep these column names exactly as specified.
 */
export interface OutputRow {
	'MCST#': string;

	'Estate Name': string;

	'UEN': string;

	'DPO(Y/N)': 'Y' | 'N';

	'DPO Name': string;

	'DPO Email': string;

	'DPO Company': string;

	'Record Discrepancy(Y/N)': 'Y' | 'N';
}


export interface LookupResult {
	found: boolean;

	observations: DpoObservation[];

	status: string;

	method: string;

	error?: string;
}


export interface LookupJob {
	id?: number;

	mcst_no: string;

	status:
		| 'pending'
		| 'processing'
		| 'completed'
		| 'failed';

	attempts: number;

	last_error?: string;

	started_at?: string;

	completed_at?: string;
}


export interface BatchResult {
	ok: boolean;

	processed: number;

	completed: string[];

	failed: string[];

	remaining: number;

	done: boolean;

	error?: string;
}


export interface SyncResult {
	ok: boolean;

	count: number;

	inserted: number;

	updated: number;

	error?: string;
}
