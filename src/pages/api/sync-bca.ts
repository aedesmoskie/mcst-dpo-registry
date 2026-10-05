import type { APIRoute } from 'astro';

import {
	syncBcaToDatabase,
} from '../../lib/bca';


export const prerender = false;


/**
 * Synchronises the BCA MCST population into D1.
 *
 * BCA is the canonical source for:
 *
 * - MCST number
 * - development / estate name
 * - UEN
 *
 * After synchronisation, the PDPC lookup queue is rebuilt from the
 * current BCA population.
 */
export const POST: APIRoute =
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


			const result =
				await syncBcaToDatabase(
					env.DB,
				);


			if (!result.ok) {
				return Response.json(
					result,
					{
						status: 500,
					},
				);
			}


			return Response.json({
				ok: true,

				count:
					result.count,

				inserted:
					result.inserted,

				updated:
					result.updated,

				message:
					`BCA synchronisation completed for ${result.count} MCST records.`,
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


/**
 * GET is intentionally read-only and simply explains the endpoint.
 * Synchronisation requires POST so loading the URL in a browser cannot
 * accidentally rebuild the MCST population.
 */
export const GET: APIRoute =
	async () => {
		return Response.json({
			ok: true,
			endpoint: 'sync-bca',
			method: 'POST',
			description:
				'Synchronises the BCA MCST population and prepares the PDPC lookup queue.',
		});
	};
