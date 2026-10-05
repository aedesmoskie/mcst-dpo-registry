import {
	replaceLookupJobs
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
 * The current authoritative BCA population is approximately 3,818
 * ACTIVE MCST records.
 *
 * Do not allow an unexpectedly small source dataset to replace the
 * existing registry population.
 *
 * This is deliberately below the current population so legitimate
 * future changes do not require an exact-count code change.
 */
const MIN_EXPECTED_ACTIVE_RECORDS =
	3500;


/*
 * Keep D1 operations comfortably below statement/bind limits.
 */
const BATCH_SIZE =
	50;


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
						.replace(
							/[^a-z0-9]/g,
							''
						),
					key
				]
			)
		);

	for (const name of names) {
		const actual =
			keys.get(
				name
					.toLowerCase()
					.replace(
						/[^a-z0-9]/g,
						''
					)
			);

		if (actual !== undefined) {
			return row[actual];
		}
	}

	return undefined;
}


function sameText(
	a: string | null | undefined,
	b: string | null | undefined
): boolean {
	return (a ?? '') === (b ?? '');
}


type ExistingMcstRecord = {
	id: number;
	mcst_no: string;
	estate_name: string | null;
	uen: string | null;
	source_estate_name: string | null;
};


export async function syncBcaToDatabase(
	db: D1Database
): Promise<SyncResult> {

	/*
	 * Obtain the current official dataset download URL from
	 * data.gov.sg on every user-requested synchronisation.
	 */
	const catalogueResponse =
		await fetch(
			POLL_DOWNLOAD,
			{
				headers: {
					accept:
						'application/json'
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
	 * One ACTIVE BCA source row represents one MCST entity.
	 *
	 * Main and subsidiary MCSTs remain independent:
	 *
	 *   4355
	 *   01-4355
	 *   02-4355
	 *
	 * UEN is NOT an identity key.
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


		if (
			status &&
			status !== 'ACTIVE'
		) {
			continue;
		}


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


		recordsByMcst.set(
			mcst,
			{
				mcst_no: mcst,
				estate_name: estate,
				uen,
				source: 'BCA',
				source_estate_name:
					estate
			}
		);
	}


	const records =
		[
			...recordsByMcst.values()
		];


	/*
	 * Source integrity guard.
	 *
	 * A malformed or unexpectedly incomplete BCA workbook must
	 * never be allowed to destroy the current registry snapshot.
	 */
	if (
		records.length <
		MIN_EXPECTED_ACTIVE_RECORDS
	) {
		throw new Error(
			`BCA synchronisation produced only ${records.length} valid ACTIVE MCST records. Expected at least ${MIN_EXPECTED_ACTIVE_RECORDS}. Existing data was left unchanged.`
		);
	}


	/*
	 * Load the existing BCA snapshot.
	 *
	 * This is a read-only comparison. No database mutation has
	 * occurred at this point.
	 */
	const existingResult =
		await db
			.prepare(`
				SELECT
					id,
					mcst_no,
					estate_name,
					uen,
					source_estate_name
				FROM mcst_records
				WHERE source = 'BCA'
			`)
			.all<ExistingMcstRecord>();


	const existingByMcst =
		new Map<
			string,
			ExistingMcstRecord
		>();


	for (
		const row
		of existingResult.results ?? []
	) {
		existingByMcst.set(
			row.mcst_no,
			row
		);
	}


	const inserts:
		McstRecord[] = [];

	const updates: {
		id: number;
		record: McstRecord;
	}[] = [];

	const removals:
		ExistingMcstRecord[] = [];


	/*
	 * Compare the new authoritative snapshot against D1.
	 *
	 * Unchanged records generate no write.
	 */
	for (const record of records) {

		const existing =
			existingByMcst.get(
				record.mcst_no
			);

		if (!existing) {
			inserts.push(record);
			continue;
		}


		const changed =
			!sameText(
				existing.estate_name,
				record.estate_name
			) ||
			!sameText(
				existing.uen,
				record.uen
			) ||
			!sameText(
				existing.source_estate_name,
				record.source_estate_name
			);


		if (changed) {
			updates.push({
				id: existing.id,
				record
			});
		}
	}


	/*
	 * Existing BCA records absent from the newly validated
	 * authoritative snapshot are candidates for removal.
	 *
	 * This is evaluated only after the complete source dataset has
	 * passed the population safety check above.
	 */
	for (
		const existing
		of existingByMcst.values()
	) {
		if (
			!recordsByMcst.has(
				existing.mcst_no
			)
		) {
			removals.push(existing);
		}
	}


	/*
	 * Additional removal guard.
	 *
	 * A sudden large disappearance is treated as a source anomaly
	 * rather than automatically deleting a significant part of the
	 * registry.
	 */
	if (removals.length > 100) {
		throw new Error(
			`BCA synchronisation would remove ${removals.length} existing MCST records. This exceeds the safety limit of 100, so no changes were applied.`
		);
	}


	/*
	 * Apply inserts in controlled batches.
	 */
	for (
		let i = 0;
		i < inserts.length;
		i += BATCH_SIZE
	) {
		const batch =
			inserts.slice(
				i,
				i + BATCH_SIZE
			);

		await db.batch(
			batch.map(
				(record) =>
					db
						.prepare(`
							INSERT INTO mcst_records (
								mcst_no,
								estate_name,
								uen,
								source,
								source_estate_name,
								created_at,
								updated_at
							)
							VALUES (
								?,
								?,
								?,
								'BCA',
								?,
								CURRENT_TIMESTAMP,
								CURRENT_TIMESTAMP
							)
						`)
						.bind(
							record.mcst_no,
							record.estate_name,
							record.uen,
							record.source_estate_name
						)
			)
		);
	}


	/*
	 * Apply only records whose authoritative BCA attributes
	 * actually changed.
	 */
	for (
		let i = 0;
		i < updates.length;
		i += BATCH_SIZE
	) {
		const batch =
			updates.slice(
				i,
				i + BATCH_SIZE
			);

		await db.batch(
			batch.map(
				(item) =>
					db
						.prepare(`
							UPDATE mcst_records
							SET
								estate_name = ?,
								uen = ?,
								source_estate_name = ?,
								updated_at =
									CURRENT_TIMESTAMP
							WHERE
								id = ?
								AND source = 'BCA'
						`)
						.bind(
							item.record
								.estate_name,
							item.record.uen,
							item.record
								.source_estate_name,
							item.id
						)
			)
		);
	}


	/*
	 * Remove BCA population records that are no longer present in
	 * the validated authoritative snapshot.
	 *
	 * This does NOT delete dpo_records.
	 */
	for (
		let i = 0;
		i < removals.length;
		i += BATCH_SIZE
	) {
		const batch =
			removals.slice(
				i,
				i + BATCH_SIZE
			);

		await db.batch(
			batch.map(
				(item) =>
					db
						.prepare(`
							DELETE FROM mcst_records
							WHERE
								id = ?
								AND source = 'BCA'
						`)
						.bind(
							item.id
						)
			)
		);
	}


	/*
	 * Reconcile the lookup-job population only after the BCA
	 * population changes have completed successfully.
	 *
	 * Existing completed research is preserved by
	 * replaceLookupJobs().
	 */
	await replaceLookupJobs(
		db
	);


	return {
		ok: true,
		count: records.length,
		inserted: inserts.length,
		updated: updates.length
	};
}
