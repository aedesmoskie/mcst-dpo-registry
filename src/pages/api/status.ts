import type { APIRoute } from 'astro';
import { getLookupProgress } from '../../lib/db';

export const prerender = false;

type LastSyncRow = {
	last_sync: string | null;
};

export const GET: APIRoute =
	async ({ locals }) => {
		try {
			const db =
				(locals.runtime.env as any)
					.DB as D1Database;

			/*
			 * Existing lookup/research statistics.
			 *
			 * getLookupProgress() remains the canonical
			 * source for these values so we do not
			 * duplicate the existing calculation logic.
			 */
			const progress =
				await getLookupProgress(db);

			/*
			 * Current BCA population.
			 *
			 * MCST# is the canonical identity, including
			 * subsidiary identifiers such as 01-4355.
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
					.first<{
						total_mcsts: number;
					}>();

			const totalMcsts =
				Number(
					populationResult
						?.total_mcsts ?? 0
				);

			/*
			 * Until dedicated sync metadata is introduced,
			 * MAX(updated_at) is our best available marker
			 * for the most recent successful BCA population
			 * update.
			 *
			 * This is read-only and requires no schema
			 * migration.
			 */
			const lastSyncResult =
				await db
					.prepare(`
						SELECT
							MAX(updated_at)
								AS last_sync
						FROM mcst_records
						WHERE source = 'BCA'
					`)
					.first<LastSyncRow>();

			const lastSync =
				lastSyncResult?.last_sync ??
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
