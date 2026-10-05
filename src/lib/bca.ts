import type {
	McstRecord,
	SyncResult,
} from './types';

import {
	replaceLookupJobs,
	upsertMcstRecords,
} from './db';

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
 * BCA remains the population/reference source. Its development name
 * is preserved as source data and is not assumed to be identical to
 * the organisation name that may later be observed from PDPC.
 */
export async function fetchBcaMcstRecords():
	Promise<McstRecord[]> {
	const output: McstRecord[] = [];

	let offset = 0;
	let total =
		Number.POSITIVE_INFINITY;

	while (offset < total) {
		const url =
			new URL(BCA_API);

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

		const response =
			await fetch(
				url.toString(),
				{
					headers: {
						Accept:
							'application/json',
					},
				},
			);

		if (!response.ok) {
			throw new Error(
				`BCA request failed: HTTP ${response.status}`,
			);
		}

		const payload =
			(await response.json()) as BcaApiResponse;

		if (
			!payload.success ||
			!payload.result
		) {
			throw new Error(
				'BCA returned an invalid datastore response.',
			);
		}

		const records =
			payload.result.records ?? [];

		total =
			Number(
				payload.result.total ??
					records.length,
			);

		for (const source of records) {
			const mcstNo =
				normaliseMcstNumber(
					source.usr_mcno,
				);

			if (!mcstNo) {
				continue;
			}

			const estateName =
				cleanSourceText(
					source.usr_devtname,
				);

			const uen =
				normaliseUen(
					source.usr_mcstuen,
				);

			output.push({
				mcst_no:
					mcstNo,

				estate_name:
					estateName,

				uen,

				source:
					'BCA',

				source_estate_name:
					estateName,
			});
		}

		if (records.length === 0) {
			break;
		}

		offset +=
			records.length;
	}

	return output;
}


/**
 * Refreshes the BCA master population in D1.
 *
 * Existing historical DPO observations are deliberately NOT deleted.
 * BCA population refresh and PDPC lookup remain separate operations.
 */
export async function syncBcaToDatabase(
	db: D1Database,
): Promise<SyncResult> {
	try {
		const records =
			await fetchBcaMcstRecords();

		/*
		 * Never modify the database if the upstream source unexpectedly
		 * returns an empty population.
		 */
		if (records.length === 0) {
			throw new Error(
				'BCA returned zero valid MCST records. Database sync aborted.',
			);
		}


		/*
		 * Remove duplicate source rows from the incoming payload before
		 * writing them to D1.
		 *
		 * The database identity currently consists of:
		 *
		 *     MCST number + estate name + source
		 */
		const uniqueRecords =
			new Map<string, McstRecord>();

		for (const record of records) {
			const key = [
				normaliseMcstNumber(
					record.mcst_no,
				),

				cleanSourceText(
					record.estate_name,
				)
					.toUpperCase(),

				cleanSourceText(
					record.source,
				)
					.toUpperCase(),
			].join('|');

			uniqueRecords.set(
				key,
				record,
			);
		}


		const canonicalRecords =
			Array.from(
				uniqueRecords.values(),
			);


		/*
		 * D1 writes are performed in bounded batches rather than one
		 * network/database round-trip for every MCST.
		 */
		const processed =
			await upsertMcstRecords(
				db,
				canonicalRecords,
			);


		/*
		 * Rebuild the lookup queue only after the complete BCA
		 * population has been persisted successfully.
		 *
		 * Existing DPO observations remain untouched.
		 */
		await replaceLookupJobs(
			db,
		);


		return {
			ok: true,

			count:
				canonicalRecords.length,

			inserted:
				processed,

			/*
			 * The current schema performs upserts and does not expose
			 * SQLite's insert-vs-update distinction reliably enough to
			 * report a separate update count.
			 */
			updated:
				0,
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
