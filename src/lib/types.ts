export interface Env {
	DB: D1Database;
	BROWSER: Fetcher;
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
	uen: string;
	estate_name: string;
	dpo_found: boolean;
	dpo_name: string;
	dpo_email: string;
	dpo_company: string;
	pdpc_organisation_name: string;
	record_discrepancy: boolean;
	lookup_status: string;
	lookup_method: string;
	checked_at: string;
}

export interface DpoObservation {
	organisationName: string;
	dpoName: string;
	dpoEmail: string;
	dpoCompany: string;
}

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
	status: 'pending' | 'processing' | 'completed' | 'failed';
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
