import type { APIRoute } from 'astro';

import {
	replaceLookupJobs,
} from '../../lib/db';


export const prerender = false;


/**
 * Rebuilds the PDPC lookup queue from the current BCA population.
 *
 * By default existing DPO observations are preserved.
 *
 * Passing:
 *
 *     { "clearResults": true }
 *
 * also removes previous PDPC results before rebuilding the queue.
 */
export const POST: APIRoute =
	async ({ request, locals }) => {
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


			let clearResults = false;

			try {
				const body =
					(await request.json()) as {
						clearResults?: boolean;
					};

				clearResults =
					body.clearResults === true;
			} catch {
				/*
				 * Empty request body is valid.
				 */
			}


			if (clearResults) {
				await env.DB
					.prepare(`
						DELETE FROM dpo_records
					`)
					.run();
			}


			await replaceLookupJobs(
				env.DB,
			);


			const result =
				await env.DB
					.prepare(`
						SELECT
							COUNT(*) AS total
						FROM lookup_jobs
					`)
					.first<{
						total: number;
					}>();


			return Response.json({
				ok: true,

				queueSize:
					Number(
						result?.total ?? 0,
					),

				resultsCleared:
					clearResults,

				message:
					clearResults
						? 'Lookup queue rebuilt and previous PDPC results cleared.'
						: 'Lookup queue rebuilt. Previous PDPC results preserved.',
			});
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
