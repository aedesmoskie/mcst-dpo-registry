import type { APIRoute } from 'astro';

import {
	getLookupProgress,
} from '../../lib/db';


export const prerender = false;


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
				population,
				results,
				progress,
			] = await Promise.all([
				env.DB
					.prepare(`
						SELECT
							COUNT(DISTINCT mcst_no) AS total,
							SUM(
								CASE
									WHEN uen IS NOT NULL
										AND TRIM(uen) <> ''
									THEN 1
									ELSE 0
								END
							) AS with_uen
						FROM mcst_records
						WHERE source = 'BCA'
					`)
					.first<{
						total: number;
						with_uen: number;
					}>(),

				env.DB
					.prepare(`
						SELECT
							COUNT(*) AS rows,

							COUNT(
								DISTINCT mcst_no
							) AS checked_mcsts,

							SUM(
								CASE
									WHEN dpo_found = 1
									THEN 1
									ELSE 0
								END
							) AS dpo_rows,

							COUNT(
								DISTINCT CASE
									WHEN dpo_found = 1
									THEN mcst_no
								END
							) AS mcsts_with_dpo,

							COUNT(
								DISTINCT CASE
									WHEN dpo_found = 0
									THEN mcst_no
								END
							) AS mcsts_without_registry_result,

							SUM(
								CASE
									WHEN record_discrepancy = 1
									THEN 1
									ELSE 0
								END
							) AS discrepancies

						FROM dpo_records
					`)
					.first<{
						rows: number;
						checked_mcsts: number;
						dpo_rows: number;
						mcsts_with_dpo: number;
						mcsts_without_registry_result: number;
						discrepancies: number;
					}>(),

				getLookupProgress(
					env.DB,
				),
			]);


			const totalMcsts =
				Number(
					population?.total ?? 0,
				);

			const withUen =
				Number(
					population?.with_uen ?? 0,
				);

			const completed =
				Number(
					progress.completed ?? 0,
				);

			const completionPercent =
				totalMcsts > 0
					? Math.round(
							(
								completed /
								totalMcsts
							) *
								10000,
						) / 100
					: 0;


			return Response.json(
				{
					ok: true,

					population: {
						totalMcsts,

						withUen,

						withoutUen:
							Math.max(
								0,
								totalMcsts -
									withUen,
							),
					},

					results: {
						rows:
							Number(
								results?.rows ??
									0,
							),

						checkedMcsts:
							Number(
								results?.checked_mcsts ??
									0,
							),

						dpoRows:
							Number(
								results?.dpo_rows ??
									0,
							),

						mcstsWithDpo:
							Number(
								results?.mcsts_with_dpo ??
									0,
							),

						mcstsWithoutRegistryResult:
							Number(
								results?.mcsts_without_registry_result ??
									0,
							),

						discrepancies:
							Number(
								results?.discrepancies ??
									0,
							),
					},

					queue: {
						...progress,

						completionPercent,
					},
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
