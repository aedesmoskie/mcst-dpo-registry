import {
	replaceLookupJobs,
	upsertMcstRecords
} from './db';

import {
	cleanSourceText,
	normaliseMcstIdentifier,
	normaliseUen
} from './normalise';

import type {
	McstRecord,
	SyncResult
} from './types';


const DATASET =
	'd_f988c57e16e99ad3a649aa04572efd1c';

const POLL_DOWNLOAD =
	`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET}/poll-download`;


/*
 * BCA uses placeholder strings such as NA in fields that are
 * logically empty.
 */
function textValue(
	value: unknown
): string {
	if (
		value === null ||
		value === undefined
	) {
		return '';
	}

	const text =
		String(value).trim();

	if (
		/^(?:NA|N\/A|NULL|NIL|-)$/i.test(text)
	) {
		return '';
	}

	return text;
}


/*
 * Resolve a field without depending on exact case, spaces or
 * punctuation in the XLSX column heading.
 */
function value(
	row: Record<string, unknown>,
	...names: string[]
): unknown {
	const keys =
		new Map(
			Object.keys(row).map(
				(key) => [
					key
						.toLowerCase()
						.replace(/[^a-z0-9]/g, ''),
					key
				]
			)
		);

	for (const name of names) {
		const actual =
			keys.get(
				name
					.toLowerCase()
					.replace(/[^a-z0-9]/g, '')
			);

		if (actual !== undefined) {
			return row[actual];
		}
	}

	return undefined;
}


export async function syncBcaToDatabase(
	db: D1Database
): Promise<SyncResult> {

	/*
	 * Obtain the current official dataset download URL from
	 * data.gov.sg on every synchronisation.
	 */
	const catalogueResponse =
		await fetch(
			POLL_DOWNLOAD,
			{
				headers: {
					accept: 'application/json'
				}
			}
		);

	if (!catalogueResponse.ok) {
		throw new Error(
			`BCA/data.gov.sg catalogue request failed (${catalogueResponse.status}).`
		);
	}

	const catalogue: any =
		await catalogueResponse.json();

	if (
		catalogue?.code !== 0 ||
		!catalogue?.data?.url
	) {
		throw new Error(
			catalogue?.errMsg ||
			'BCA/data.gov.sg did not return a dataset download URL.'
		);
	}


	/*
	 * Download the latest BCA workbook.
	 */
	const downloadResponse =
		await fetch(
			catalogue.data.url
		);

	if (!downloadResponse.ok) {
		throw new Error(
			`BCA/data.gov.sg dataset download failed (${downloadResponse.status}).`
		);
	}


	const XLSX =
		await import('xlsx');

	const workbook =
		XLSX.read(
			await downloadResponse.arrayBuffer(),
			{
				type: 'array'
			}
		);

	const sheetName =
		workbook.SheetNames[0];

	if (!sheetName) {
		throw new Error(
			'BCA dataset contains no worksheet.'
		);
	}


	const rows =
		XLSX.utils.sheet_to_json<
			Record<string, unknown>
		>(
			workbook.Sheets[sheetName],
			{
				defval: ''
			}
		);


	if (!rows.length) {
		throw new Error(
			'BCA synchronisation returned zero source rows; existing data was left unchanged.'
		);
	}


	/*
	 * IMPORTANT:
	 *
	 * One ACTIVE BCA source row represents one MCST entity for this
	 * application.
	 *
	 * Main and subsidiary MCSTs are retained independently.
	 *
	 * Examples:
	 *
	 *   4355
	 *   01-4355
	 *   02-4355
	 *
	 * remain three distinct records even when two or more happen to
	 * share the same UEN.
	 *
	 * Therefore:
	 *
	 * - do NOT filter records because sub_mcno is populated;
	 * - do NOT deduplicate by UEN;
	 * - do NOT collapse subsidiary identifiers to their parent number.
	 */
	const recordsByMcst =
		new Map<
			string,
			McstRecord
		>();


	for (const row of rows) {

		const status =
			textValue(
				value(
					row,
					'ust_status',
					'status'
				)
			).toUpperCase();


		/*
		 * Current BCA records are expected to be ACTIVE.
		 *
		 * Explicitly non-active records are excluded. A blank status
		 * is not silently discarded.
		 */
		if (
			status &&
			status !== 'ACTIVE'
		) {
			continue;
		}


		/*
		 * usr_mcno is the canonical unique identifier.
		 *
		 * We deliberately preserve its complete structure.
		 */
		const mcst =
			normaliseMcstIdentifier(
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


		const estate =
			cleanSourceText(
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


		const uen =
			normaliseUen(
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
		 * The complete MCST identifier is the map key.
		 *
		 * UEN is intentionally NOT used as the key because BCA can
		 * legitimately contain separate MCST entities sharing a UEN.
		 */
		recordsByMcst.set(
			mcst,
			{
				mcst_no: mcst,
				estate_name: estate,
				uen,
				source: 'BCA',
				source_estate_name: estate
			}
		);
	}


	const records =
		[
			...recordsByMcst.values()
		];


	/*
	 * Safety guard.
	 *
	 * Never destroy the existing D1 BCA snapshot if retrieval or
	 * parsing unexpectedly yields no usable records.
	 */
	if (!records.length) {
		throw new Error(
			'BCA synchronisation returned zero valid ACTIVE MCST records; existing data was left unchanged.'
		);
	}


	/*
	 * Replace the BCA snapshot only after the complete new dataset
	 * has been downloaded and parsed successfully.
	 */
	await db
		.prepare(
			`DELETE FROM mcst_records
			 WHERE source='BCA'`
		)
		.run();


	await upsertMcstRecords(
		db,
		records
	);


	/*
	 * Rebuild the PDPC lookup queue using the complete MCST identifier.
	 *
	 * The db.ts replacement supplied next will preserve identifiers
	 * such as 01-4355 and 02-4355 as independent jobs.
	 */
	await replaceLookupJobs(
		db
	);


	return {
		ok: true,
		count: records.length,
		inserted: records.length,
		updated: 0
	};
}
