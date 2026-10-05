import type { McstRecord, SyncResult } from './types';
import { upsertMcstRecord, replaceLookupJobs } from './db';
import {
	cleanSourceText,
	normaliseMcstNumber,
	normaliseUen,
} from './normalise';

const BCA_DATASET_ID =
	'd_1f9391a2f1476cdaf4f05a8d3a05c257';

const BCA_API =
	'https://data.gov.sg/api/action/datastore_search';

const PAGE_SIZE = 500;

interface BcaApiRecord {
	usr_mcno?: string;
	usr_mcstuen?: string;
	usr_devtname?: string;
	status?: string;

	[key: string]: unknown;
}

interface BcaApiResponse {
	success?: boolean;

	result?: {
		total?: number;
		records?: BcaApiRecord[];
	};
}


/**
 * Fetches the complete BCA MCST population from data.gov.sg.
 *
 * BCA remains the population/reference source. Its development name is
 * preserved as source data and is not assumed to be identical to the
 * organisation name that may later be observed from PDPC.
 */
export async function fetchBcaMcstRecords(): Promise<McstRecord[]> {
	const output: McstRecord[] = [];

	let offset = 0;
	let total = Number.POSITIVE_INFINITY;

	while (offset < total) {
		const url = new URL(BCA_API);

		url.searchParams.set(
			'resource_id',
			BCA_DATASET_ID,
		);

		url.searchParams.set(
			'limit',
			String(PAGE_SIZE),
		);

		url.searchParams.set(
			'offset',
			String(offset),
		);

		const response = await fetch(url.toString(), {
			headers: {
				Accept: 'application/json',
			},
		});

		if (!response.ok) {
			throw new Error(
				`BCA request failed: HTTP ${response.status}`,
			);
		}

		const payload =
			(await response.json()) as BcaApiResponse;

		if (!payload.success || !payload.result) {
			throw new Error(
				'BCA returned an invalid datastore response.',
			);
		}

		const records = payload.result.records ?? [];

		total = Number(
			payload.result.total ?? records.length,
		);

		for (const source of records) {
			const mcstNo =
				normaliseMcstNumber(source.usr_mcno);

			if (!mcstNo) {
				continue;
			}

			const estateName =
				cleanSourceText(source.usr_devtname);

			const uen =
				normaliseUen(source.usr_mcstuen);

			output.push({
				mcst_no: mcstNo,
				estate_name: estateName,
				uen,
				source: 'BCA',
				source_estate_name: estateName,
			});
		}

		if (records.length === 0) {
			break;
		}

		offset += records.length;
	}

	return output;
}


/**
 * Refreshes the BCA master population in D1.
 *
 * Existing historical DPO observations are deliberately NOT deleted here.
 * BCA population refresh and PDPC lookup are separate operations.
 */
export async function syncBcaToDatabase(
	db: D1Database,
): Promise<SyncResult> {
	try {
		const records =
			await fetchBcaMcstRecords();

		let inserted = 0;

		/*
		 * Upserts preserve the source estate name and UEN while avoiding
		 * duplicate rows for the same BCA identity.
		 */
		for (const record of records) {
			await upsertMcstRecord(db, record);
			inserted++;
		}

		/*
		 * Rebuild the lookup queue from the current BCA population.
		 * This does not delete existing DPO results.
		 */
		await replaceLookupJobs(db);

		return {
			ok: true,
			count: records.length,
			inserted,
			updated: 0,
		};
	} catch (error) {
		return {
			ok: false,
			count: 0,
			inserted: 0,
			updated: 0,
			error:
				error instanceof Error
					? error.message
					: String(error),
		};
	}
}
