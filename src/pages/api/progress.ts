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


			const progress =
				await getLookupProgress(
					env.DB,
				);


			const remaining =
				progress.pending +
				progress.processing +
				progress.failed;


			const processed =
				progress.completed;


			const percent =
				progress.total > 0
					? Math.round(
							(
								processed /
								progress.total
							) *
								10000,
						) / 100
					: 0;


			return Response.json(
				{
					ok: true,

					progress: {
						...progress,

						processed,

						remaining,

						percent,

						done:
							progress.total > 0 &&
							remaining === 0,
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
