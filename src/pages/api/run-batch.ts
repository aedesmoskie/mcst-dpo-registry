import type { APIRoute } from 'astro';

import {
	clearExistingDpoResults,
	getLookupProgress,
	getNextLookupJobs,
	markLookupCompleted,
	markLookupFailed,
	markLookupProcessing,
	saveDpoObservations,
	saveNoDpoResult,
} from '../../lib/db';

import type {
	PdpcLookupResponse,
} from '../../lib/pdpc/types';


export const prerender = false;


/**
 * Maximum number of MCSTs handled by one request.
 *
 * Keeping batches small makes the process resumable and prevents one
 * request from attempting the entire registry population.
 */
const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 10;


/**
 * The actual PDPC browser runner will be attached to this controller
 * in the Browser Rendering integration file.
 *
 * Until a browser session is available, this deliberately reports
 * verification/session-required rather than manufacturing results.
 */
async function performPdpcLookup(
	_mcstNo: string,
	_uen: string,
	_estateName: string,
): Promise<PdpcLookupResponse> {
	return {
		found: false,
		state: 'verification_required',
		observations: [],
		attempts: [],
		message:
			'An active verified PDPC browser session is required.',
	};
}


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
				 * Empty POST body is valid.
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


			if (jobs.length === 0) {
				const progress =
					await getLookupProgress(
						env.DB,
					);

				return Response.json({
					ok: true,
					processed: 0,
					completed: [],
					failed: [],
					paused: false,
					done:
						progress.total > 0 &&
						progress.pending === 0 &&
						progress.processing === 0 &&
						progress.failed === 0,
					progress,
				});
			}


			const completed: string[] = [];
			const failed: string[] = [];

			let processed = 0;


			for (const job of jobs) {
				const mcstNo =
					job.mcst_no;

				await markLookupProcessing(
					env.DB,
					mcstNo,
				);


				try {
					const lookup =
						await performPdpcLookup(
							mcstNo,
							job.uen,
							job.estate_name,
						);


					/*
					 * Human verification is a PAUSE condition.
					 *
					 * It is NOT:
					 * - DPO not found
					 * - a failed MCST
					 * - permission to bypass CAPTCHA
					 */
					if (
						lookup.state ===
						'verification_required'
					) {
						/*
						 * Return the job to pending so it can resume
						 * after a legitimate verified session exists.
						 */
						await env.DB
							.prepare(`
								UPDATE lookup_jobs
								SET
									status = 'pending',
									last_error = ?,
									updated_at = CURRENT_TIMESTAMP
								WHERE mcst_no = ?
							`)
							.bind(
								lookup.message ??
									'Human verification required.',
								mcstNo,
							)
							.run();


						const progress =
							await getLookupProgress(
								env.DB,
							);


						return Response.json({
							ok: true,
							processed,
							completed,
							failed,
							paused: true,

							pauseReason:
								'verification_required',

							message:
								lookup.message ??
								'PDPC requires human verification.',

							progress,
						});
					}


					if (
						lookup.state ===
						'registry_unavailable'
					) {
						throw new Error(
							lookup.message ??
								'PDPC registry unavailable.',
						);
					}


					if (
						lookup.state ===
						'parse_error'
					) {
						throw new Error(
							lookup.message ??
								'Unable to parse PDPC response.',
						);
					}


					/*
					 * Only replace the previous result after a real
					 * lookup has completed.
					 */
					await clearExistingDpoResults(
						env.DB,
						mcstNo,
					);


					if (
						lookup.found &&
						lookup.observations.length >
							0
					) {
						await saveDpoObservations(
							env.DB,
							job,
							lookup.observations,
							'found',
							lookup.matchedBy ??
								'pdpc',
						);
					} else {
						/*
						 * Only an actual completed not-found search
						 * can create a DPO=N row.
						 */
						await saveNoDpoResult(
							env.DB,
							job,
							'not_found',
							lookup.attempts
								.map(
									(item) =>
										item.searchType,
								)
								.join(',') ||
								'pdpc',
						);
					}


					await markLookupCompleted(
						env.DB,
						mcstNo,
					);

					completed.push(
						mcstNo,
					);

					processed++;
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: String(error);

					await markLookupFailed(
						env.DB,
						mcstNo,
						message,
					);

					failed.push(
						mcstNo,
					);
				}
			}


			const progress =
				await getLookupProgress(
					env.DB,
				);


			return Response.json({
				ok: true,

				processed,

				completed,

				failed,

				paused: false,

				done:
					progress.total > 0 &&
					progress.pending === 0 &&
					progress.processing === 0 &&
					progress.failed === 0,

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
