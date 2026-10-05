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

	const text = String(value).trim();

	/*
	 * The BCA workbook uses placeholder strings in fields that are
	 * logically empty. They must not be interpreted as actual values.
	 */
	if (/^(?:NA|N\/A|NULL|NIL|-)$/i.test(text)) {
		return '';
	}

	return text;
}

export async function syncBcaToDatabase(
	db: D1Database
): Promise<SyncResult> {
	/*
	 * Ask data.gov.sg for the current download URL for the official
	 * BCA MCST dataset. The application therefore does not depend on
	 * a manually downloaded workbook or a fixed XLSX URL.
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
	 * Download the latest official workbook.
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
		throw new Error(
			'BCA dataset contains no worksheet.'
		);
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

	const recordsByMcst =
		new Map<string, McstRecord>();

	for (const row of rows) {
		/*
		 * Ignore records explicitly identified by BCA as inactive.
		 * A blank status is retained rather than silently discarded.
		 */
		const status = textValue(
			value(
				row,
				'ust_status',
				'status'
			)
		).toUpperCase();

		if (status && status !== 'ACTIVE') {
			continue;
		}

		/*
		 * BCA includes subsidiary-management-corporation records in
		 * the same source workbook.
		 *
		 * Crucially, ordinary primary MCST rows may contain "NA" in
		 * sub_mcno. textValue() converts that placeholder to blank.
		 *
		 * Only a genuine subsidiary number causes the row to be
		 * excluded from the primary MCST lookup population.
		 */
		const subMcst = textValue(
			value(
				row,
				'sub_mcno',
				'submcno'
			)
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

		/*
		 * Primary MCST number is the canonical key for the PDPC
		 * lookup queue.
		 */
		recordsByMcst.set(mcst, {
			mcst_no: mcst,
			estate_name: estate,
			uen,
			source: 'BCA',
			source_estate_name: estate
		});
	}

	const records =
		[...recordsByMcst.values()];

	/*
	 * Safety guard: never delete the existing D1 BCA snapshot if
	 * upstream retrieval/parsing unexpectedly yields no usable data.
	 */
	if (!records.length) {
		throw new Error(
			'BCA synchronisation returned zero valid primary MCST records; existing data was left unchanged.'
		);
	}

	/*
	 * Replace the BCA snapshot only after the new source has been
	 * downloaded, parsed and validated successfully.
	 */
	await db
		.prepare(
			`DELETE FROM mcst_records WHERE source='BCA'`
		)
		.run();

	await upsertMcstRecords(
		db,
		records
	);

	await replaceLookupJobs(db);

	return {
		ok: true,
		count: records.length,
		inserted: records.length,
		updated: 0
	};
}
