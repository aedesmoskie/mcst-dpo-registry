import { replaceLookupJobs, upsertMcstRecords } from './db';
import {
	cleanSourceText,
	normaliseMcstNumber,
	normaliseUen
} from './normalise';
import type { McstRecord, SyncResult } from './types';

const DATASET = 'd_f988c57e16e99ad3a649aa04572efd1c';

const POLL_DOWNLOAD =
	`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET}/poll-download`;

function value(
	row: Record<string, unknown>,
	...names: string[]
): unknown {
	const keys = new Map(
		Object.keys(row).map((key) => [
			key.toLowerCase().replace(/[^a-z0-9]/g, ''),
			key
		])
	);

	for (const name of names) {
		const actual = keys.get(
			name.toLowerCase().replace(/[^a-z0-9]/g, '')
		);

		if (actual !== undefined) {
			return row[actual];
		}
	}

	return undefined;
}

function textValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}

	return String(value).trim();
}

export async function syncBcaToDatabase(
	db: D1Database
): Promise<SyncResult> {
	/*
	 * Obtain the current download URL from data.gov.sg rather than
	 * hard-coding a particular XLSX file URL.
	 */
	const catalogueResponse = await fetch(POLL_DOWNLOAD, {
		headers: {
			accept: 'application/json'
		}
	});

	if (!catalogueResponse.ok) {
		throw new Error(
			`BCA/data.gov.sg catalogue request failed (${catalogueResponse.status}).`
		);
	}

	const catalogue: any = await catalogueResponse.json();

	if (catalogue?.code !== 0 || !catalogue?.data?.url) {
		throw new Error(
			catalogue?.errMsg ||
				'BCA/data.gov.sg did not return a dataset download URL.'
		);
	}

	/*
	 * Download the current official BCA workbook.
	 */
	const downloadResponse = await fetch(catalogue.data.url);

	if (!downloadResponse.ok) {
		throw new Error(
			`BCA/data.gov.sg dataset download failed (${downloadResponse.status}).`
		);
	}

	const XLSX = await import('xlsx');

	const workbook = XLSX.read(
		await downloadResponse.arrayBuffer(),
		{ type: 'array' }
	);

	const sheetName = workbook.SheetNames[0];

	if (!sheetName) {
		throw new Error('BCA dataset contains no worksheet.');
	}

	const rows =
		XLSX.utils.sheet_to_json<Record<string, unknown>>(
			workbook.Sheets[sheetName],
			{ defval: '' }
		);

	if (!rows.length) {
		throw new Error(
			'BCA synchronisation returned zero source rows; existing data was left unchanged.'
		);
	}

	/*
	 * The BCA workbook contains primary MCST records as well as
	 * subsidiary-management-corporation records.
	 *
	 * The PDPC workflow is keyed to the primary MCST population.
	 * A populated sub_mcno therefore does not create another primary
	 * MCST lookup job.
	 */
	const recordsByMcst = new Map<string, McstRecord>();

	for (const row of rows) {
		const status = textValue(
			value(row, 'ust_status', 'status')
		).toUpperCase();

		if (status && status !== 'ACTIVE') {
			continue;
		}

		const subMcst = textValue(
			value(row, 'sub_mcno', 'submcno')
		);

		if (subMcst) {
			continue;
		}

		const mcst = normaliseMcstNumber(
			textValue(
				value(
					row,
					'usr_mcno',
					'mcst_no',
					'mcstno'
				)
			)
		);

		if (!mcst) {
			continue;
		}

		const estate = cleanSourceText(
			textValue(
				value(
					row,
					'usr_devtname',
					'estate_name',
					'development_name',
					'developmentname'
				)
			)
		);

		const uen = normaliseUen(
			textValue(
				value(
					row,
					'usr_mcstuen',
					'uen',
					'mcst_uen',
					'mcstuen'
				)
			)
		);

		recordsByMcst.set(mcst, {
			mcst_no: mcst,
			estate_name: estate,
			uen,
			source: 'BCA',
			source_estate_name: estate
		});
	}

	const records = [...recordsByMcst.values()];

	/*
	 * Never destroy the existing BCA snapshot if the upstream
	 * download/parsing unexpectedly produces no usable records.
	 */
	if (!records.length) {
		throw new Error(
			'BCA synchronisation returned zero valid primary MCST records; existing data was left unchanged.'
		);
	}

	/*
	 * Replace the previous BCA snapshot only after the new snapshot
	 * has been successfully downloaded and validated.
	 */
	await db
		.prepare(`DELETE FROM mcst_records WHERE source='BCA'`)
		.run();

	await upsertMcstRecords(db, records);

	await replaceLookupJobs(db);

	return {
		ok: true,
		count: records.length,
		inserted: records.length,
		updated: 0
	};
}
