import type { APIRoute } from 'astro';
import { getLookupProgress } from '../../lib/db';

export const prerender = false;


type PopulationRow = {
	total_mcsts: number;
};


type LastSyncRow = {
	completed_at: string | null;
};


export const GET: APIRoute =
	async ({ locals }) => {
		try {
			const db =
				(locals.runtime.env as any)
					.DB as D1Database;


			/*
			 * Existing DPO research statistics.
			 */
			const progress =
				await getLookupProgress(db);


			/*
			 * Current authoritative BCA population.
			 *
			 * The complete MCST identifier remains the
			 * canonical identity, including subsidiary
			 * identifiers such as 01-4355.
			 */
			const populationResult =
				await db
					.prepare(`
						SELECT
							COUNT(
								DISTINCT mcst_no
							) AS total_mcsts
						FROM mcst_records
						WHERE source = 'BCA'
					`)
					.first<PopulationRow>();


			const totalMcsts =
				Number(
					populationResult
						?.total_mcsts ?? 0
				);


			/*
			 * Last Sync means the most recent successfully
			 * completed explicit BCA synchronisation.
			 *
			 * Failed or currently running attempts do not
			 * replace the last known successful sync time.
			 */
			const lastSyncResult =
				await db
					.prepare(`
						SELECT
							completed_at
						FROM sync_history
						WHERE
							source = 'BCA'
							AND status = 'completed'
							AND completed_at IS NOT NULL
						ORDER BY
							completed_at DESC,
							id DESC
						LIMIT 1
					`)
					.first<LastSyncRow>();


			const lastSync =
				lastSyncResult
					?.completed_at ??
				null;


			return Response.json({
				ok: true,

				population: {
					totalMcsts
				},

				results: {
					checkedMcsts:
						Number(
							progress
								.checkedMcsts ??
								0
						),

					mcstsWithDpo:
						Number(
							progress
								.mcstsWithDpo ??
								0
						),

					dpoRows:
						Number(
							progress
								.dpoRows ??
								0
						),

					discrepancies:
						Number(
							progress
								.discrepancies ??
								0
						)
				},

				lastSync
			});

		} catch (e) {

			return Response.json(
				{
					ok: false,

					error:
						e instanceof Error
							? e.message
							: String(e)
				},
				{
					status: 500
				}
			);
		}
	};
