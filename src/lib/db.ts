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


export async function upsertMcstRecord(
	db: D1Database,
	record: McstRecord,
): Promise<void> {
	const mcstNo = normaliseMcstNumber(record.mcst_no);

	if (!mcstNo) {
		throw new Error(
			'Cannot store MCST record without a valid MCST number.',
		);
	}

	const estateName = cleanSourceText(record.estate_name);
	const uen = normaliseUen(record.uen);
	const source = cleanSourceText(record.source) || 'BCA';
	const sourceEstateName =
		cleanSourceText(record.source_estate_name) || estateName;

	await db
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
				source_estate_name = excluded.source_estate_name,
				updated_at = CURRENT_TIMESTAMP
		`)
		.bind(
			mcstNo,
			estateName,
			uen,
			source,
			sourceEstateName,
		)
		.run();
}


export async function replaceLookupJobs(
	db: D1Database,
): Promise<void> {
	await db.prepare('DELETE FROM lookup_jobs').run();

	await db
		.prepare(`
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
			ORDER BY CAST(mcst_no AS INTEGER)
		`)
		.run();
}


export async function getNextLookupJobs(
	db: D1Database,
	limit = 3,
): Promise<McstRecord[]> {
	const safeLimit = Math.max(
		1,
		Math.min(limit, 10),
	);

	const result = await db
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
				ON m.mcst_no = j.mcst_no
				AND m.source = 'BCA'
			WHERE j.status IN ('pending', 'failed')
			ORDER BY
				CAST(m.mcst_no AS INTEGER),
				m.id
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
				last_error = NULL,
				updated_at = CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(normaliseMcstNumber(mcstNo))
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
				completed_at = CURRENT_TIMESTAMP,
				updated_at = CURRENT_TIMESTAMP
			WHERE mcst_no = ?
		`)
		.bind(normaliseMcstNumber(mcstNo))
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
				updated_at = CURRENT_TIMESTAMP
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
		.bind(normaliseMcstNumber(mcstNo))
		.run();
}


/**
 * Records that the PDPC registry returned no DPO result.
 *
 * This means only:
 *
 * "No DPO registration was found in the PDPC registry during this lookup."
 *
 * It must NOT be interpreted as proof that the MCST has not appointed
 * a DPO through some other mechanism.
 */
export async function saveNoDpoResult(
	db: D1Database,
	record: McstRecord,
	lookupStatus: string,
	lookupMethod: string,
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
				record_discrepancy,
				lookup_status,
				lookup_method,
				checked_at,
				updated_at
			)
			VALUES (
				?, ?, ?, 0,
				'', '', '', '',
				0, ?, ?,
				CURRENT_TIMESTAMP,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			normaliseMcstNumber(record.mcst_no),
			normaliseUen(record.uen),
			cleanSourceText(record.estate_name),
			lookupStatus,
			lookupMethod,
		)
		.run();
}


/**
 * Saves every PDPC DPO observation independently.
 *
 * Multiple DPOs for the same UEN therefore become multiple output rows.
 */
export async function saveDpoObservations(
	db: D1Database,
	record: McstRecord,
	observations: DpoObservation[],
	lookupStatus: string,
	lookupMethod: string,
): Promise<void> {
	const mcstNo =
		normaliseMcstNumber(record.mcst_no);

	const bcaUen =
		normaliseUen(record.uen);

	const bcaEstate =
		cleanSourceText(record.estate_name);

	for (const observation of observations) {
		const pdpcUen =
			normaliseUen(observation.uen);

		const pdpcName =
			cleanSourceText(
				observation.organisationName,
			);

		const identity = compareIdentity({
			bcaMcstNo: mcstNo,
			bcaUen,
			bcaEstateName: bcaEstate,
			pdpcUen,
			pdpcEntityName: pdpcName,
		});

		/*
		 * The canonical output UEN remains the BCA UEN where available.
		 *
		 * If BCA has no UEN, retain the UEN returned by PDPC.
		 */
		const outputUen =
			bcaUen || pdpcUen;

		await insertDpoRow(db, {
			mcstNo,
			uen: outputUen,
			estateName: bcaEstate,
			observation,
			pdpcName,
			discrepancy: identity.discrepancy,
			lookupStatus,
			lookupMethod,
		});


		/*
		 * A genuine identity conflict is preserved visibly.
		 *
		 * If PDPC points to a conflicting identity/name, create an
		 * additional row rather than silently overwriting BCA data.
		 */
		if (
			identity.discrepancy &&
			pdpcName &&
			pdpcName !== bcaEstate
		) {
			await insertDpoRow(db, {
				mcstNo,
				uen: pdpcUen || outputUen,
				estateName: pdpcName,
				observation,
				pdpcName,
				discrepancy: true,
				lookupStatus,
				lookupMethod,
			});
		}
	}
}


interface InsertDpoRowArgs {
	mcstNo: string;
	uen: string;
	estateName: string;
	observation: DpoObservation;
	pdpcName: string;
	discrepancy: boolean;
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
				record_discrepancy,
				lookup_status,
				lookup_method,
				checked_at,
				updated_at
			)
			VALUES (
				?, ?, ?, 1,
				?, ?, ?, ?,
				?, ?, ?,
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
			 * Do not infer a company from the DPO's email domain.
			 * PDPC does not expose a separate company field in the
			 * registry result shown to us.
			 */
			cleanSourceText(
				args.observation.dpoCompany,
			),

			args.pdpcName,
			args.discrepancy ? 1 : 0,
			args.lookupStatus,
			args.lookupMethod,
		)
		.run();
}


export async function getOutputRows(
	db: D1Database,
): Promise<OutputRow[]> {
	const result = await db
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
				row.dpo_found ? 'Y' : 'N',

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
	const result = await db
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
		total: Number(result?.total ?? 0),
		pending: Number(result?.pending ?? 0),
		processing:
			Number(result?.processing ?? 0),
		completed:
			Number(result?.completed ?? 0),
		failed: Number(result?.failed ?? 0),
	};
}
