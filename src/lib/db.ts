import type {
	DpoObservation,
	McstRecord,
	OutputRow,
} from './types';

import {
	cleanSourceText,
	compareIdentity,
	normaliseMcstNumber,
	normaliseUen,
} from './normalise';


const D1_BATCH_SIZE = 75;


/*
 * Builds the canonical BCA upsert statement.
 *
 * Keeping statement construction here means both single-record writes
 * and bulk synchronisation use exactly the same persistence rules.
 */
function prepareMcstUpsert(
	db: D1Database,
	record: McstRecord,
): D1PreparedStatement {
	const mcstNo =
		normaliseMcstNumber(record.mcst_no);

	if (!mcstNo) {
		throw new Error(
			'Cannot store MCST record without a valid MCST number.',
		);
	}

	const estateName =
		cleanSourceText(record.estate_name);

	const uen =
		normaliseUen(record.uen);

	const source =
		cleanSourceText(record.source) || 'BCA';

	const sourceEstateName =
		cleanSourceText(
			record.source_estate_name,
		) || estateName;

	return db
		.prepare(`
			INSERT INTO mcst_records (
				mcst_no,
				estate_name,
				uen,
				source,
				source_estate_name,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

			ON CONFLICT(mcst_no, estate_name, source)
			DO UPDATE SET
				uen = excluded.uen,
				source_estate_name =
					excluded.source_estate_name,
				updated_at =
					CURRENT_TIMESTAMP
		`)
		.bind(
			mcstNo,
			estateName,
			uen,
			source,
			sourceEstateName,
		);
}


export async function upsertMcstRecord(
	db: D1Database,
	record: McstRecord,
): Promise<void> {
	await prepareMcstUpsert(
		db,
		record,
	).run();
}


/*
 * Writes MCST records to D1 in bounded batches.
 */
export async function upsertMcstRecords(
	db: D1Database,
	records: McstRecord[],
): Promise<number> {
	let processed = 0;

	for (
		let start = 0;
		start < records.length;
		start += D1_BATCH_SIZE
	) {
		const chunk =
			records.slice(
				start,
				start + D1_BATCH_SIZE,
			);

		if (chunk.length === 0) {
			continue;
		}

		const statements =
			chunk.map((record) =>
				prepareMcstUpsert(
					db,
					record,
				),
			);

		await db.batch(statements);

		processed += chunk.length;
	}

	return processed;
}


export async function replaceLookupJobs(
	db: D1Database,
): Promise<void> {
	/*
	 * Queue recreation is deliberately separate from DPO results.
	 * Existing observations are not deleted.
	 */
	await db.batch([
		db.prepare(`
			DELETE FROM lookup_jobs
		`),

		db.prepare(`
			INSERT INTO lookup_jobs (
				mcst_no,
				status,
				attempts
			)
			SELECT DISTINCT
				mcst_no,
				'pending',
				0
			FROM mcst_records
			WHERE source = 'BCA'
			ORDER BY
				CAST(mcst_no AS INTEGER)
		`),
	]);
}


/*
 * Returns one canonical/current BCA row per pending MCST.
 *
 * mcst_records can contain an older estate-name variant because the
 * source-table uniqueness includes estate_name. Selecting the latest
 * row here prevents one lookup job from being returned more than once.
 */
export async function getNextLookupJobs(
	db: D1Database,
	limit = 3,
): Promise<McstRecord[]> {
	const safeLimit =
		Math.max(
			1,
			Math.min(limit, 10),
		);

	const result =
		await db
			.prepare(`
				SELECT
					m.id,
					m.mcst_no,
					m.estate_name,
					m.uen,
					m.source,
					m.source_estate_name
				FROM lookup_jobs j
				INNER JOIN mcst_records m
					ON m.id = (
						SELECT m2.id
						FROM mcst_records m2
						WHERE
							m2.mcst_no = j.mcst_no
							AND m2.source = 'BCA'
						ORDER BY
							m2.updated_at DESC,
							m2.id DESC
						LIMIT 1
					)
				WHERE j.status = 'pending'
				ORDER BY
					CAST(j.mcst_no AS INTEGER)
				LIMIT ?
			`)
			.bind(safeLimit)
			.all<McstRecord>();

	return result.results ?? [];
}


export async function markLookupProcessing(
	db: D1Database,
	mcstNo: string,
): Promise<void> {
	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'processing',
				attempts = attempts + 1,
				started_at = CURRENT_TIMESTAMP,
				completed_at = NULL,
				last_error = NULL,
				updated_at = CURRENT_TIMESTAMP
			WHERE mcst_no = ?
				AND status = 'pending'
		`)
		.bind(
			normaliseMcstNumber(mcstNo),
		)
		.run();
}


export async function markLookupPending(
	db: D1Database,
	mcstNo: string,
	reason = '',
): Promise<void> {
	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'pending',
				last_error = ?,
				started_at = NULL,
				completed_at = NULL,
				updated_at = CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(
			reason.slice(0, 2000),
			normaliseMcstNumber(mcstNo),
		)
		.run();
}


export async function markLookupCompleted(
	db: D1Database,
	mcstNo: string,
): Promise<void> {
	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'completed',
				last_error = NULL,
				completed_at =
					CURRENT_TIMESTAMP,
				updated_at =
					CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(
			normaliseMcstNumber(mcstNo),
		)
		.run();
}


export async function markLookupFailed(
	db: D1Database,
	mcstNo: string,
	error: string,
): Promise<void> {
	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'failed',
				last_error = ?,
				completed_at = NULL,
				updated_at =
					CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(
			error.slice(0, 2000),
			normaliseMcstNumber(mcstNo),
		)
		.run();
}


export async function clearExistingDpoResults(
	db: D1Database,
	mcstNo: string,
): Promise<void> {
	await db
		.prepare(`
			DELETE FROM dpo_records
			WHERE mcst_no = ?
		`)
		.bind(
			normaliseMcstNumber(mcstNo),
		)
		.run();
}


/*
 * Records one immutable lookup observation in the audit table.
 *
 * This table is intentionally independent from dpo_records. Replacing
 * the current output for an MCST therefore does not erase the history
 * of what was previously observed in the PDPC registry.
 */
async function insertLookupAudit(
	db: D1Database,
	args: {
		mcstNo: string;
		bcaUen: string;
		estateName: string;
		searchType: string;
		searchValue: string;
		outcome: string;
		pdpcOrganisationName?: string;
		pdpcUen?: string;
		dpoName?: string;
		dpoEmail?: string;
		discrepancy?: boolean;
		discrepancyReason?: string;
	},
): Promise<void> {
	await db
		.prepare(`
			INSERT INTO pdpc_lookup_attempts (
				mcst_no,
				bca_uen,
				estate_name,
				search_type,
				search_value,
				outcome,
				pdpc_organisation_name,
				pdpc_uen,
				dpo_name,
				dpo_email,
				discrepancy,
				discrepancy_reason,
				observed_at
			)
			VALUES (
				?, ?, ?, ?, ?, ?,
				?, ?, ?, ?,
				?, ?,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			args.mcstNo,
			args.bcaUen,
			args.estateName,
			args.searchType,
			args.searchValue,
			args.outcome,
			cleanSourceText(
				args.pdpcOrganisationName,
			),
			normaliseUen(
				args.pdpcUen,
			),
			cleanSourceText(
				args.dpoName,
			),
			cleanSourceText(
				args.dpoEmail,
			),
			args.discrepancy ? 1 : 0,
			cleanSourceText(
				args.discrepancyReason,
			),
		)
		.run();
}


/**
 * Records that a completed PDPC registry search returned no DPO
 * registration.
 *
 * This means only:
 *
 * "No DPO registration was found in the PDPC registry during
 * this lookup."
 *
 * It must NOT be interpreted as proof that the MCST has not
 * appointed a DPO through some other mechanism.
 */
export async function saveNoDpoResult(
	db: D1Database,
	record: McstRecord,
	lookupStatus: string,
	lookupMethod: string,
	searchValue?: string,
): Promise<void> {
	const mcstNo =
		normaliseMcstNumber(
			record.mcst_no,
		);

	const bcaUen =
		normaliseUen(
			record.uen,
		);

	const estateName =
		cleanSourceText(
			record.estate_name,
		);

	const effectiveSearchValue =
		cleanSourceText(
			searchValue,
		) ||
		(
			lookupMethod === 'uen'
				? bcaUen
				: estateName
		);

	await db
		.prepare(`
			INSERT INTO dpo_records (
				mcst_no,
				uen,
				estate_name,
				dpo_found,
				dpo_name,
				dpo_email,
				dpo_company,
				pdpc_organisation_name,
				pdpc_uen,
				record_discrepancy,
				discrepancy_reason,
				lookup_status,
				lookup_method,
				checked_at,
				updated_at
			)
			VALUES (
				?, ?, ?, 0,
				'', '', '', '',
				'',
				0, '',
				?, ?,
				CURRENT_TIMESTAMP,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			mcstNo,
			bcaUen,
			estateName,
			lookupStatus,
			lookupMethod,
		)
		.run();

	await insertLookupAudit(
		db,
		{
			mcstNo,
			bcaUen,
			estateName,
			searchType:
				lookupMethod,
			searchValue:
				effectiveSearchValue,
			outcome:
				lookupStatus,
			discrepancy:
				false,
			discrepancyReason:
				'',
		},
	);
}


/**
 * Saves every actual PDPC DPO observation independently.
 *
 * One UEN returning two DPOs therefore creates two output rows.
 *
 * A discrepancy does NOT create an artificial second output row.
 * Instead the raw PDPC identity and discrepancy reason are preserved
 * in the row and in pdpc_lookup_attempts.
 */
export async function saveDpoObservations(
	db: D1Database,
	record: McstRecord,
	observations: DpoObservation[],
	lookupStatus: string,
	lookupMethod: string,
	searchValue?: string,
): Promise<void> {
	const mcstNo =
		normaliseMcstNumber(
			record.mcst_no,
		);

	const bcaUen =
		normaliseUen(
			record.uen,
		);

	const bcaEstate =
		cleanSourceText(
			record.estate_name,
		);

	const effectiveSearchValue =
		cleanSourceText(
			searchValue,
		) ||
		(
			lookupMethod === 'uen'
				? bcaUen
				: bcaEstate
		);

	for (const observation of observations) {
		const pdpcUen =
			normaliseUen(
				observation.uen,
			);

		const pdpcName =
			cleanSourceText(
				observation.organisationName,
			);

		const identity =
			compareIdentity({
				bcaMcstNo:
					mcstNo,
				bcaUen,
				bcaEstateName:
					bcaEstate,
				pdpcUen,
				pdpcEntityName:
					pdpcName,
			});

		/*
		 * BCA remains the canonical identity for the final output.
		 * PDPC's returned UEN is stored separately for audit.
		 *
		 * If BCA genuinely has no UEN, PDPC's UEN is retained as
		 * the best available output identifier.
		 */
		const outputUen =
			bcaUen || pdpcUen;

		await insertDpoRow(
			db,
			{
				mcstNo,
				uen:
					outputUen,
				estateName:
					bcaEstate,
				observation,
				pdpcName,
				pdpcUen,
				discrepancy:
					identity.discrepancy,
				discrepancyReason:
					identity.discrepancy
						? identity.reason
						: '',
				lookupStatus,
				lookupMethod,
			},
		);

		await insertLookupAudit(
			db,
			{
				mcstNo,
				bcaUen,
				estateName:
					bcaEstate,
				searchType:
					lookupMethod,
				searchValue:
					effectiveSearchValue,
				outcome:
					lookupStatus,
				pdpcOrganisationName:
					pdpcName,
				pdpcUen,
				dpoName:
					observation.dpoName,
				dpoEmail:
					observation.dpoEmail,
				discrepancy:
					identity.discrepancy,
				discrepancyReason:
					identity.discrepancy
						? identity.reason
						: '',
			},
		);
	}
}


interface InsertDpoRowArgs {
	mcstNo: string;
	uen: string;
	estateName: string;
	observation: DpoObservation;
	pdpcName: string;
	pdpcUen: string;
	discrepancy: boolean;
	discrepancyReason: string;
	lookupStatus: string;
	lookupMethod: string;
}


async function insertDpoRow(
	db: D1Database,
	args: InsertDpoRowArgs,
): Promise<void> {
	await db
		.prepare(`
			INSERT INTO dpo_records (
				mcst_no,
				uen,
				estate_name,
				dpo_found,
				dpo_name,
				dpo_email,
				dpo_company,
				pdpc_organisation_name,
				pdpc_uen,
				record_discrepancy,
				discrepancy_reason,
				lookup_status,
				lookup_method,
				checked_at,
				updated_at
			)
			VALUES (
				?, ?, ?, 1,
				?, ?, ?, ?,
				?,
				?, ?,
				?, ?,
				CURRENT_TIMESTAMP,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			args.mcstNo,
			args.uen,
			args.estateName,

			cleanSourceText(
				args.observation.dpoName,
			),

			cleanSourceText(
				args.observation.dpoEmail,
			),

			/*
			 * Do not infer DPO company from an email domain.
			 */
			cleanSourceText(
				args.observation.dpoCompany,
			),

			args.pdpcName,
			args.pdpcUen,
			args.discrepancy ? 1 : 0,
			args.discrepancyReason,
			args.lookupStatus,
			args.lookupMethod,
		)
		.run();
}


export async function getOutputRows(
	db: D1Database,
): Promise<OutputRow[]> {
	const result =
		await db
			.prepare(`
				SELECT
					mcst_no,
					estate_name,
					uen,
					dpo_found,
					dpo_name,
					dpo_email,
					dpo_company,
					record_discrepancy
				FROM dpo_records
				ORDER BY
					CAST(mcst_no AS INTEGER),
					estate_name,
					dpo_name,
					dpo_email
			`)
			.all<{
				mcst_no: string;
				estate_name: string;
				uen: string;
				dpo_found: number;
				dpo_name: string;
				dpo_email: string;
				dpo_company: string;
				record_discrepancy: number;
			}>();

	return (result.results ?? []).map(
		(row) => ({
			'MCST#':
				row.mcst_no ?? '',

			'Estate Name':
				row.estate_name ?? '',

			'UEN':
				row.uen ?? '',

			'DPO(Y/N)':
				row.dpo_found
					? 'Y'
					: 'N',

			'DPO Name':
				row.dpo_name ?? '',

			'DPO Email':
				row.dpo_email ?? '',

			'DPO Company':
				row.dpo_company ?? '',

			'Record Discrepancy(Y/N)':
				row.record_discrepancy
					? 'Y'
					: 'N',
		}),
	);
}


export async function getLookupProgress(
	db: D1Database,
): Promise<{
	total: number;
	pending: number;
	processing: number;
	completed: number;
	failed: number;
}> {
	const result =
		await db
			.prepare(`
				SELECT
					COUNT(*) AS total,

					SUM(
						CASE
							WHEN status = 'pending'
								THEN 1
							ELSE 0
						END
					) AS pending,

					SUM(
						CASE
							WHEN status = 'processing'
								THEN 1
							ELSE 0
						END
					) AS processing,

					SUM(
						CASE
							WHEN status = 'completed'
								THEN 1
							ELSE 0
						END
					) AS completed,

					SUM(
						CASE
							WHEN status = 'failed'
								THEN 1
							ELSE 0
						END
					) AS failed

				FROM lookup_jobs
			`)
			.first<{
				total: number;
				pending: number;
				processing: number;
				completed: number;
				failed: number;
			}>();

	return {
		total:
			Number(
				result?.total ?? 0,
			),

		pending:
			Number(
				result?.pending ?? 0,
			),

		processing:
			Number(
				result?.processing ?? 0,
			),

		completed:
			Number(
				result?.completed ?? 0,
			),

		failed:
			Number(
				result?.failed ?? 0,
			),
	};
}
