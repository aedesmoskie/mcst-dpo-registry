import type { APIRoute } from 'astro';

import {
	getLookupProgress,
	getNextLookupJobs,
} from '../../lib/db';


export const prerender = false;

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;


/**
 * Returns the next pending MCST records that require a PDPC lookup.
 *
 * This endpoint deliberately DOES NOT access or automate the PDPC
 * website.
 *
 * The actual PDPC lookup is performed through the assisted workflow
 * in the user's normal browser. A separate submission endpoint will
 * validate and persist the observed PDPC result.
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


			let requestedBatchSize =
				DEFAULT_BATCH_SIZE;

			try {
				const body =
					(await request.json()) as {
						batchSize?: number;
					};

				if (
					Number.isFinite(
						body.batchSize,
					)
				) {
					requestedBatchSize =
						Number(
							body.batchSize,
						);
				}
			} catch {
				/*
				 * An empty POST body is valid.
				 */
			}


			const batchSize =
				Math.max(
					1,
					Math.min(
						MAX_BATCH_SIZE,
						Math.floor(
							requestedBatchSize,
						),
					),
				);


			const jobs =
				await getNextLookupJobs(
					env.DB,
					batchSize,
				);


			const progress =
				await getLookupProgress(
					env.DB,
				);


			if (jobs.length === 0) {
				return Response.json({
					ok: true,

					jobs: [],

					done:
						progress.total > 0 &&
						progress.pending === 0 &&
						progress.processing === 0,

					progress,
				});
			}


			return Response.json({
				ok: true,

				jobs:
					jobs.map(
						(job) => ({
							mcstNo:
								job.mcst_no,

							uen:
								job.uen ?? '',

							estateName:
								job.estate_name ??
								'',

							source:
								job.source,

							pdpcRegistryUrl:
								'https://www.pdpc.gov.sg/individuals/e-services/data-protection-officers-dpo-registry',
						}),
					),

				done: false,

				progress,
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
