import type { APIRoute } from 'astro';


export const prerender = false;


/**
 * Returns failed lookup jobs to the pending queue.
 *
 * Completed jobs and existing DPO results are left untouched.
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


			const before =
				await env.DB
					.prepare(`
						SELECT
							COUNT(*) AS count
						FROM lookup_jobs
						WHERE status = 'failed'
					`)
					.first<{
						count: number;
					}>();


			const failedCount =
				Number(
					before?.count ?? 0,
				);


			if (failedCount === 0) {
				return Response.json({
					ok: true,
					retried: 0,
					message:
						'There are no failed lookup jobs to retry.',
				});
			}


			await env.DB
				.prepare(`
					UPDATE lookup_jobs
					SET
						status = 'pending',
						last_error = NULL,
						started_at = NULL,
						completed_at = NULL,
						updated_at = CURRENT_TIMESTAMP
					WHERE status = 'failed'
				`)
				.run();


			return Response.json({
				ok: true,

				retried:
					failedCount,

				message:
					`${failedCount} failed lookup job${failedCount === 1 ? '' : 's'} returned to the pending queue.`,
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
