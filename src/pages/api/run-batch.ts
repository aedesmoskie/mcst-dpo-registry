import type { APIRoute } from 'astro';

import {
	getLookupProgress,
	getNextLookupJobs,
} from '../../lib/db';


export const prerender = false;

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;

const PDPC_REGISTRY_URL =
	'https://www.pdpc.gov.sg/individuals/e-services/data-protection-officers-dpo-registry';


/**
 * Returns the next pending MCST records that require a PDPC lookup.
 *
 * This endpoint deliberately DOES NOT access or automate the PDPC
 * website.
 *
 * The actual PDPC lookup is performed through the assisted workflow
 * in the user's normal browser. The submission endpoint validates
 * and persists the observed PDPC result.
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


			/*
			 * A queue is complete only when every job has completed.
			 *
			 * Failed jobs are intentionally excluded from
			 * getNextLookupJobs() until the operator explicitly
			 * retries them, so they must be considered here.
			 */
			const done =
				progress.total > 0 &&
				progress.pending === 0 &&
				progress.processing === 0 &&
				progress.failed === 0 &&
				progress.completed ===
					progress.total;


			if (jobs.length === 0) {
				return Response.json({
					ok: true,

					jobs: [],

					done,

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
								PDPC_REGISTRY_URL,
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
