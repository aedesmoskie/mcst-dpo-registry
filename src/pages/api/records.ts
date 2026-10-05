import type { APIRoute } from 'astro';

import {
	getLookupProgress,
	getOutputRows,
} from '../../lib/db';


export const prerender = false;


/**
 * Returns the current consolidated MCST/DPO dataset together with
 * processing progress.
 *
 * The row structure is intentionally identical to the final Excel
 * structure.
 */
export const GET: APIRoute =
	async ({ locals }) => {
		try {
			const env =
				locals.runtime.env as {
					DB: D1Database;
				};

			if (!env.DB) {
				return Response.json(
					{
						ok: false,
						error:
							'D1 binding DB is not available.',
					},
					{
						status: 500,
					},
				);
			}


			const [
				rows,
				progress,
			] = await Promise.all([
				getOutputRows(env.DB),
				getLookupProgress(env.DB),
			]);


			const dpoRecords =
				rows.filter(
					(row) =>
						row['DPO(Y/N)'] === 'Y',
				).length;


			const noDpoRecords =
				rows.filter(
					(row) =>
						row['DPO(Y/N)'] === 'N',
				).length;


			const discrepancies =
				rows.filter(
					(row) =>
						row[
							'Record Discrepancy(Y/N)'
						] === 'Y',
				).length;


			const uniqueMcsts =
				new Set(
					rows.map(
						(row) =>
							row['MCST#'],
					),
				).size;


			return Response.json(
				{
					ok: true,

					summary: {
						mcsts:
							uniqueMcsts,

						rows:
							rows.length,

						dpoRecords,

						noDpoRecords,

						discrepancies,
					},

					progress,

					rows,
				},
				{
					headers: {
						'Cache-Control':
							'no-store',
					},
				},
			);
		} catch (error) {
			return Response.json(
				{
					ok: false,

					error:
						error instanceof Error
							? error.message
							: String(error),
				},
				{
					status: 500,
				},
			);
		}
	};
