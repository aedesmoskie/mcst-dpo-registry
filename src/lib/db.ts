import type {
	DpoObservation,
	McstRecord,
	OutputRow
} from './types';

import {
	cleanSourceText,
	compareIdentity,
	normaliseMcstIdentifier,
	normaliseUen
} from './normalise';


const BATCH = 75;


/*
 * Insert/update the current BCA snapshot.
 *
 * mcst_no contains the complete BCA-published identifier, including
 * subsidiary identifiers such as 01-4355.
 */
export async function upsertMcstRecords(
	db: D1Database,
	records: McstRecord[]
) {
	for (
		let i = 0;
		i < records.length;
		i += BATCH
	) {
		await db.batch(
			records
				.slice(i, i + BATCH)
				.map((record) =>
					db
						.prepare(`
							INSERT INTO mcst_records(
								mcst_no,
								estate_name,
								uen,
								source,
								source_estate_name,
								updated_at
							)
							VALUES(
								?,
								?,
								?,
								?,
								?,
								CURRENT_TIMESTAMP
							)
							ON CONFLICT(
								mcst_no,
								estate_name,
								source
							)
							DO UPDATE SET
								uen = excluded.uen,
								source_estate_name =
									excluded.source_estate_name,
								updated_at =
									CURRENT_TIMESTAMP
						`)
						.bind(
							record.mcst_no,
							record.estate_name,
							record.uen,
							record.source,
							record.source_estate_name
						)
				)
		);
	}
}


/*
 * Reconcile the lookup queue with the current BCA snapshot.
 *
 * Existing jobs are preserved so completed PDPC research is never
 * reset merely because the BCA source is synchronised again.
 *
 * - MCSTs no longer present in BCA are removed from the queue.
 * - Existing MCST jobs retain their current status and history.
 * - Newly published MCSTs are added as pending jobs.
 *
 * The complete BCA MCST identifier remains the job identity:
 *
 *   4355
 *   01-4355
 *   02-4355
 *
 * are three independent jobs.
 */
export async function replaceLookupJobs(
	db: D1Database
) {
	/*
	 * Remove queue entries whose MCST identifier no longer exists
	 * in the current BCA snapshot.
	 */
	await db
		.prepare(`
			DELETE FROM lookup_jobs
			WHERE NOT EXISTS (
				SELECT 1
				FROM mcst_records m
				WHERE
					m.source = 'BCA'
					AND m.mcst_no = lookup_jobs.mcst_no
			)
		`)
		.run();


	/*
	 * Add only MCST identifiers that do not already have a queue job.
	 *
	 * Existing pending, processing, completed or failed jobs are left
	 * untouched.
	 */
	await db
		.prepare(`
			INSERT INTO lookup_jobs(
				mcst_no,
				status
			)
			SELECT
				m.mcst_no,
				'pending'
			FROM mcst_records m
			WHERE
				m.source = 'BCA'
				AND NOT EXISTS (
					SELECT 1
					FROM lookup_jobs j
					WHERE j.mcst_no = m.mcst_no
				)
			GROUP BY m.mcst_no
			ORDER BY m.id
		`)
		.run();
}


/*
 * Return pending records in parent-MCST order.
 *
 * Subsidiaries are grouped with their parent where possible:
 *
 *   4355
 *   01-4355
 *   02-4355
 *
 * rather than relying on CAST(mcst_no AS INTEGER), which would
 * incorrectly interpret 01-4355 as numeric 1.
 */
export async function getNextLookupJobs(
	db: D1Database,
	limit: number
) {
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
				JOIN mcst_records m
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
				WHERE
					j.status = 'pending'
				ORDER BY
					CASE
						WHEN instr(j.mcst_no, '-') > 0
						THEN CAST(
							substr(
								j.mcst_no,
								instr(j.mcst_no, '-') + 1
							)
							AS INTEGER
						)
						ELSE CAST(
							j.mcst_no AS INTEGER
						)
					END,
					CASE
						WHEN instr(j.mcst_no, '-') = 0
						THEN 0
						ELSE 1
					END,
					j.mcst_no
				LIMIT ?
			`)
			.bind(limit)
			.all<McstRecord>();

	return result.results ?? [];
}


export async function getLookupProgress(
	db: D1Database
) {
	const queue =
		await db
			.prepare(`
				SELECT
					COUNT(*) total,
					SUM(status = 'pending') pending,
					SUM(status = 'processing') processing,
					SUM(status = 'completed') completed,
					SUM(status = 'failed') failed
				FROM lookup_jobs
			`)
			.first<any>();


	/*
	 * Registry-result statistics are calculated separately from queue
	 * state. A completed lookup with no DPO still counts as checked,
	 * while multiple DPO records for one MCST count as one MCST with
	 * DPO but remain separate DPO rows.
	 */
	const results =
		await db
			.prepare(`
				SELECT
					COUNT(
						DISTINCT mcst_no
					) AS checked_mcsts,

					COUNT(
						DISTINCT CASE
							WHEN dpo_found = 1
							THEN mcst_no
						END
					) AS mcsts_with_dpo,

					SUM(
						CASE
							WHEN dpo_found = 1
							THEN 1
							ELSE 0
						END
					) AS dpo_rows,

					SUM(
						CASE
							WHEN record_discrepancy = 1
							THEN 1
							ELSE 0
						END
					) AS discrepancies
				FROM dpo_records
			`)
			.first<any>();


	return {
		total:
			Number(
				queue?.total ?? 0
			),

		pending:
			Number(
				queue?.pending ?? 0
			),

		processing:
			Number(
				queue?.processing ?? 0
			),

		completed:
			Number(
				queue?.completed ?? 0
			),

		failed:
			Number(
				queue?.failed ?? 0
			),

		checkedMcsts:
			Number(
				results?.checked_mcsts ?? 0
			),

		mcstsWithDpo:
			Number(
				results?.mcsts_with_dpo ?? 0
			),

		dpoRows:
			Number(
				results?.dpo_rows ?? 0
			),

		discrepancies:
			Number(
				results?.discrepancies ?? 0
			)
	};
}


export async function markLookupProcessing(
	db: D1Database,
	mcstNo: string
) {
	const mcst =
		normaliseMcstIdentifier(
			mcstNo
		);

	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'processing',
				attempts = attempts + 1,
				last_error = NULL,
				started_at = CURRENT_TIMESTAMP,
				updated_at = CURRENT_TIMESTAMP
			WHERE
				mcst_no = ?
				AND status = 'pending'
		`)
		.bind(mcst)
		.run();
}


export async function markLookupPending(
	db: D1Database,
	mcstNo: string,
	error = ''
) {
	const mcst =
		normaliseMcstIdentifier(
			mcstNo
		);

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
			error,
			mcst
		)
		.run();
}


export async function markLookupCompleted(
	db: D1Database,
	mcstNo: string
) {
	const mcst =
		normaliseMcstIdentifier(
			mcstNo
		);

	await db
		.prepare(`
			UPDATE lookup_jobs
			SET
				status = 'completed',
				last_error = NULL,
				completed_at = CURRENT_TIMESTAMP,
				updated_at = CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(mcst)
		.run();
}


export async function clearExistingDpoResults(
	db: D1Database,
	mcstNo: string
) {
	const mcst =
		normaliseMcstIdentifier(
			mcstNo
		);

	await db
		.prepare(`
			DELETE FROM dpo_records
			WHERE mcst_no = ?
		`)
		.bind(mcst)
		.run();
}


/*
 * Preserve every PDPC lookup attempt for auditability.
 */
async function audit(
	db: D1Database,
	attempt: any
) {
	await db
		.prepare(`
			INSERT INTO pdpc_lookup_attempts(
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
				discrepancy_reason
			)
			VALUES(
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				?,
				?
			)
		`)
		.bind(
			attempt.mcst,
			attempt.bcaUen,
			attempt.estate,
			attempt.type,
			attempt.value,
			attempt.outcome,
			attempt.org,
			attempt.pdpcUen,
			attempt.name,
			attempt.email,
			attempt.disc ? 1 : 0,
			attempt.reason
		)
		.run();
}


export async function saveNoDpoResult(
	db: D1Database,
	record: McstRecord,
	status: string,
	method: string,
	value = ''
) {
	const mcst =
		normaliseMcstIdentifier(
			record.mcst_no
		);

	const uen =
		normaliseUen(
			record.uen
		);

	const estate =
		cleanSourceText(
			record.estate_name
		);

	const searchValue =
		value ||
		(
			method === 'uen'
				? uen
				: estate
		);


	await db
		.prepare(`
			INSERT INTO dpo_records(
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
				checked_at
			)
			VALUES(
				?,
				?,
				?,
				0,
				'',
				'',
				'',
				'',
				'',
				0,
				'',
				?,
				?,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			mcst,
			uen,
			estate,
			status,
			method
		)
		.run();


	await audit(
		db,
		{
			mcst,
			bcaUen: uen,
			estate,
			type: method,
			value: searchValue,
			outcome: status,
			org: '',
			pdpcUen: '',
			name: '',
			email: '',
			disc: false,
			reason: ''
		}
	);
}


export async function saveDpoObservations(
	db: D1Database,
	record: McstRecord,
	observations: DpoObservation[],
	status: string,
	method: string,
	value = ''
) {
	const mcst =
		normaliseMcstIdentifier(
			record.mcst_no
		);

	const bcaUen =
		normaliseUen(
			record.uen
		);

	const estate =
		cleanSourceText(
			record.estate_name
		);

	const searchValue =
		value ||
		(
			method === 'uen'
				? bcaUen
				: estate
		);


	for (const observation of observations) {
		const organisation =
			cleanSourceText(
				observation.organisationName
			);

		const pdpcUen =
			normaliseUen(
				observation.uen
			);

		const comparison =
			compareIdentity(
				{
					bcaMcstNo: mcst,
					bcaUen,
					bcaEstateName:
						estate,
					pdpcUen,
					pdpcEntityName:
						organisation
				}
			);


		await db
			.prepare(`
				INSERT INTO dpo_records(
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
					checked_at
				)
				VALUES(
					?,
					?,
					?,
					1,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					CURRENT_TIMESTAMP
				)
			`)
			.bind(
				mcst,
				bcaUen || pdpcUen,
				estate,
				cleanSourceText(
					observation.dpoName
				),
				cleanSourceText(
					observation.dpoEmail
				),
				cleanSourceText(
					observation.dpoCompany
				),
				organisation,
				pdpcUen,
				comparison.discrepancy
					? 1
					: 0,
				comparison.reason,
				status,
				method
			)
			.run();


		await audit(
			db,
			{
				mcst,
				bcaUen,
				estate,
				type: method,
				value: searchValue,
				outcome: status,
				org: organisation,
				pdpcUen,
				name:
					cleanSourceText(
						observation.dpoName
					),
				email:
					cleanSourceText(
						observation.dpoEmail
					),
				disc:
					comparison.discrepancy,
				reason:
					comparison.reason
			}
		);
	}
}


/*
 * Exact export schema required by the project.
 *
 * BCA is the canonical MCST population.
 *
 * Every BCA MCST is exported even when no PDPC lookup result
 * has yet been recorded. Multiple DPO records for the same
 * MCST remain separate export rows.
 *
 * DPO(Y/N) semantics:
 *
 * - Y     = a stored lookup result found a DPO registration
 * - N     = a stored completed lookup result found no DPO registration
 * - blank = no stored DPO lookup result exists for this MCST
 */
export async function getOutputRows(
	db: D1Database
): Promise<OutputRow[]> {
	const result =
		await db
			.prepare(`
				SELECT
					m.mcst_no,
					m.estate_name,
					m.uen,

					CASE
						WHEN d.id IS NULL
							THEN NULL
						ELSE d.dpo_found
					END AS dpo_found,

					CASE
						WHEN d.id IS NULL
							THEN ''
						ELSE COALESCE(
							d.dpo_name,
							''
						)
					END AS dpo_name,

					CASE
						WHEN d.id IS NULL
							THEN ''
						ELSE COALESCE(
							d.dpo_email,
							''
						)
					END AS dpo_email,

					CASE
						WHEN d.id IS NULL
							THEN ''
						ELSE COALESCE(
							d.dpo_company,
							''
						)
					END AS dpo_company,

					CASE
						WHEN d.id IS NULL
							THEN NULL
						ELSE d.record_discrepancy
					END AS record_discrepancy

				FROM mcst_records m

				LEFT JOIN dpo_records d
					ON d.mcst_no = m.mcst_no

				WHERE
					m.source = 'BCA'

				ORDER BY
					CASE
						WHEN instr(
							m.mcst_no,
							'-'
						) > 0
						THEN CAST(
							substr(
								m.mcst_no,
								instr(
									m.mcst_no,
									'-'
								) + 1
							)
							AS INTEGER
						)
						ELSE CAST(
							m.mcst_no AS INTEGER
						)
					END,

					CASE
						WHEN instr(
							m.mcst_no,
							'-'
						) = 0
							THEN 0
							ELSE 1
					END,

					m.mcst_no,
					d.id
			`)
			.all<any>();


	return (
		result.results ?? []
	).map(
		(row) => ({
			'MCST#':
				row.mcst_no,

			'Estate Name':
				row.estate_name ?? '',

			'UEN':
				row.uen ?? '',

			'DPO(Y/N)':
				row.dpo_found === null ||
				row.dpo_found === undefined
					? ''
					: row.dpo_found
						? 'Y'
						: 'N',

			'DPO Name':
				row.dpo_name ?? '',

			'DPO Email':
				row.dpo_email ?? '',

			'DPO Company':
				row.dpo_company ?? '',

			'Record Discrepancy(Y/N)':
				row.record_discrepancy === null ||
				row.record_discrepancy === undefined
					? ''
					: row.record_discrepancy
						? 'Y'
						: 'N'
		})
	);
}
