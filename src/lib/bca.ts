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

const MIN_EXPECTED_ACTIVE_RECORDS =
	3500;

const BATCH_SIZE =
	50;


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


type SyncHistoryRow = {
	id: number;
};


async function createSyncHistory(
	db: D1Database
): Promise<number> {
	const startedAt =
		new Date().toISOString();

	const result =
		await db
			.prepare(`
				INSERT INTO sync_history (
					source,
					status,
					started_at
				)
				VALUES (
					'BCA',
					'running',
					?
				)
				RETURNING id
			`)
			.bind(startedAt)
			.first<SyncHistoryRow>();

	if (!result?.id) {
		throw new Error(
			'Unable to create BCA sync history record.'
		);
	}

	return Number(result.id);
}


async function completeSyncHistory(
	db: D1Database,
	id: number,
	populationCount: number,
	insertedCount: number,
	updatedCount: number,
	removedCount: number
): Promise<void> {
	await db
		.prepare(`
			UPDATE sync_history
			SET
				status = 'completed',
				population_count = ?,
				inserted_count = ?,
				updated_count = ?,
				removed_count = ?,
				completed_at = ?
			WHERE id = ?
		`)
		.bind(
			populationCount,
			insertedCount,
			updatedCount,
			removedCount,
			new Date().toISOString(),
			id
		)
		.run();
}


async function failSyncHistory(
	db: D1Database,
	id: number,
	error: unknown
): Promise<void> {
	const message =
		error instanceof Error
			? error.message
			: String(error);

	try {
		await db
			.prepare(`
				UPDATE sync_history
				SET
					status = 'failed',
					error_message = ?,
					completed_at = ?
				WHERE id = ?
			`)
			.bind(
				message.slice(0, 2000),
				new Date().toISOString(),
				id
			)
			.run();
	} catch {
		/*
		 * Preserve the original synchronisation error.
		 * Failure to write diagnostic history must not mask it.
		 */
	}
}


export async function syncBcaToDatabase(
	db: D1Database
): Promise<SyncResult> {

	const syncHistoryId =
		await createSyncHistory(db);

	try {

		/*
		 * Obtain the current official dataset URL.
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
		 * Download the latest workbook.
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
				await downloadResponse
					.arrayBuffer(),
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
				workbook.Sheets[
					sheetName
				],
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
		 * Canonical identity is the complete BCA MCST
		 * identifier. UEN is not an identity key.
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
					mcst_no:
						mcst,
					estate_name:
						estate,
					uen,
					source:
						'BCA',
					source_estate_name:
						estate
				}
			);
		}


		const records =
			[
				...recordsByMcst
					.values()
			];


		/*
		 * Prevent an unexpectedly incomplete source
		 * workbook from damaging the current snapshot.
		 */
		if (
			records.length <
			MIN_EXPECTED_ACTIVE_RECORDS
		) {
			throw new Error(
				`BCA synchronisation produced only ${records.length} valid ACTIVE MCST records. Expected at least ${MIN_EXPECTED_ACTIVE_RECORDS}. Existing data was left unchanged.`
			);
		}


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
			of existingResult.results ??
				[]
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
					existing
						.source_estate_name,
					record
						.source_estate_name
				);


			if (changed) {
				updates.push({
					id: existing.id,
					record
				});
			}
		}


		for (
			const existing
			of existingByMcst.values()
		) {
			if (
				!recordsByMcst.has(
					existing.mcst_no
				)
			) {
				removals.push(
					existing
				);
			}
		}


		/*
		 * A large sudden disappearance is treated as a
		 * source anomaly, not an instruction to delete
		 * a substantial part of the registry.
		 */
		if (removals.length > 100) {
			throw new Error(
				`BCA synchronisation would remove ${removals.length} existing MCST records. This exceeds the safety limit of 100, so no changes were applied.`
			);
		}


		/*
		 * Insert only genuinely new MCST records.
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
								record
									.source_estate_name
							)
				)
			);
		}


		/*
		 * Update only BCA records whose authoritative
		 * attributes changed.
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
								item.record
									.uen,
								item.record
									.source_estate_name,
								item.id
							)
				)
			);
		}


		/*
		 * Remove only BCA population rows absent from
		 * the fully validated new source snapshot.
		 *
		 * DPO research records are not deleted.
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
		 * Reconcile lookup jobs only after the BCA
		 * population reconciliation succeeds.
		 */
		await replaceLookupJobs(
			db
		);


		/*
		 * Record the successful explicit sync even when
		 * there were zero source-data changes.
		 */
		await completeSyncHistory(
			db,
			syncHistoryId,
			records.length,
			inserts.length,
			updates.length,
			removals.length
		);


		return {
			ok: true,
			count: records.length,
			inserted: inserts.length,
			updated: updates.length
		};

	} catch (error) {

		await failSyncHistory(
			db,
			syncHistoryId,
			error
		);

		throw error;
	}
}
