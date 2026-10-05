import type { APIRoute } from 'astro';

import {
	clearExistingDpoResults,
	markLookupCompleted,
	markLookupPending,
	markLookupProcessing,
	saveDpoObservations,
	saveNoDpoResult,
} from '../../lib/db';

import type {
	DpoObservation,
	McstRecord,
} from '../../lib/types';

import {
	cleanSourceText,
	normaliseMcstNumber,
	normaliseUen,
} from '../../lib/normalise';


export const prerender = false;


type SubmissionStatus =
	| 'found'
	| 'not_found'
	| 'verification_required'
	| 'cancelled';


interface SubmissionBody {
	mcstNo?: string;

	status?: SubmissionStatus;

	searchType?: 'uen' | 'estate_name';

	searchValue?: string;

	observations?: Array<{
		organisationName?: string;
		uen?: string;
		dpoName?: string;
		dpoEmail?: string;
		dpoCompany?: string;
	}>;
}


function jsonError(
	message: string,
	status = 400,
): Response {
	return Response.json(
		{
			ok: false,
			error: message,
		},
		{
			status,
		},
	);
}


async function getBcaRecord(
	db: D1Database,
	mcstNo: string,
): Promise<McstRecord | null> {
	const record =
		await db
			.prepare(`
				SELECT
					id,
					mcst_no,
					estate_name,
					uen,
					source,
					source_estate_name
				FROM mcst_records
				WHERE
					mcst_no = ?
					AND source = 'BCA'
				ORDER BY id DESC
				LIMIT 1
			`)
			.bind(mcstNo)
			.first<McstRecord>();

	return record ?? null;
}


function normaliseObservations(
	input:
		| SubmissionBody['observations']
		| undefined,
): DpoObservation[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.map(
			(item): DpoObservation => ({
				organisationName:
					cleanSourceText(
						item.organisationName,
					),

				uen:
					normaliseUen(
						item.uen,
					),

				dpoName:
					cleanSourceText(
						item.dpoName,
					),

				dpoEmail:
					cleanSourceText(
						item.dpoEmail,
					),

				dpoCompany:
					cleanSourceText(
						item.dpoCompany,
					),
			}),
		)
		.filter(
			(item) =>
				Boolean(
					item.organisationName ||
					item.uen ||
					item.dpoName ||
					item.dpoEmail,
				),
		);
}


export const POST: APIRoute =
	async ({ request, locals }) => {
		try {
			const env =
				locals.runtime.env as {
					DB: D1Database;
				};

			if (!env.DB) {
				return jsonError(
					'D1 binding DB is not available.',
					500,
				);
			}


			let body: SubmissionBody;

			try {
				body =
					(await request.json()) as
						SubmissionBody;
			} catch {
				return jsonError(
					'Request body must be valid JSON.',
				);
			}


			const mcstNo =
				normaliseMcstNumber(
					body.mcstNo,
				);

			if (!mcstNo) {
				return jsonError(
					'A valid MCST number is required.',
				);
			}


			const allowedStatuses:
				SubmissionStatus[] = [
					'found',
					'not_found',
					'verification_required',
					'cancelled',
				];

			if (
				!body.status ||
				!allowedStatuses.includes(
					body.status,
				)
			) {
				return jsonError(
					'Invalid PDPC lookup status.',
				);
			}


			const record =
				await getBcaRecord(
					env.DB,
					mcstNo,
				);

			if (!record) {
				return jsonError(
					`MCST ${mcstNo} was not found in the BCA population.`,
					404,
				);
			}


			/*
			 * Verification/cancellation never creates or changes
			 * a DPO result.
			 *
			 * The MCST simply remains pending.
			 */
			if (
				body.status ===
					'verification_required' ||
				body.status === 'cancelled'
			) {
				await markLookupPending(
					env.DB,
					mcstNo,
					body.status ===
						'verification_required'
						? 'PDPC human verification required.'
						: 'PDPC lookup cancelled before completion.',
				);

				return Response.json({
					ok: true,

					completed: false,

					status:
						body.status,

					mcstNo,

					message:
						'No DPO result was written. The MCST remains pending.',
				});
			}


			const searchType =
				body.searchType ===
					'estate_name'
					? 'estate_name'
					: 'uen';

			const searchValue =
				searchType === 'uen'
					? normaliseUen(
							body.searchValue ||
								record.uen,
						)
					: cleanSourceText(
							body.searchValue ||
								record.estate_name,
						);

			if (!searchValue) {
				return jsonError(
					'The completed lookup must identify the PDPC search value used.',
				);
			}


			/*
			 * Mark processing only once we have received a completed
			 * human-assisted lookup submission.
			 */
			await markLookupProcessing(
				env.DB,
				mcstNo,
			);


			if (body.status === 'found') {
				const observations =
					normaliseObservations(
						body.observations,
					);

				if (
					observations.length === 0
				) {
					await markLookupPending(
						env.DB,
						mcstNo,
						'Found result submitted without any DPO observations.',
					);

					return jsonError(
						'A found result must contain at least one PDPC DPO observation.',
					);
				}


				/*
				 * For a UEN lookup, reject a submitted result when
				 * every returned observation points to a different
				 * UEN.
				 *
				 * Genuine conflicts can still be preserved where at
				 * least one observation corresponds to the requested
				 * identity.
				 */
				if (searchType === 'uen') {
					const requestedUen =
						normaliseUen(
							searchValue,
						);

					const hasMatchingUen =
						observations.some(
							(item) =>
								normaliseUen(
									item.uen,
								) ===
								requestedUen,
						);

					if (!hasMatchingUen) {
						await markLookupPending(
							env.DB,
							mcstNo,
							'Submitted PDPC result did not contain the searched UEN.',
						);

						return jsonError(
							'The submitted PDPC result does not contain the searched UEN.',
						);
					}
				}


				/*
				 * Previous observations are replaced only after the
				 * submitted lookup has passed validation.
				 */
				await clearExistingDpoResults(
					env.DB,
					mcstNo,
				);

				await saveDpoObservations(
					env.DB,
					record,
					observations,
					'found',
					searchType,
				);

				await markLookupCompleted(
					env.DB,
					mcstNo,
				);


				return Response.json({
					ok: true,

					completed: true,

					status: 'found',

					mcstNo,

					observationCount:
						observations.length,
				});
			}


			/*
			 * DPO=N is written ONLY when the user explicitly submits
			 * a completed "not found" PDPC registry search.
			 *
			 * It means no registration was found in the registry.
			 * It does not assert that the MCST has no appointed DPO.
			 */
			if (body.status === 'not_found') {
				await clearExistingDpoResults(
					env.DB,
					mcstNo,
				);

				await saveNoDpoResult(
					env.DB,
					record,
					'not_found',
					searchType,
				);

				await markLookupCompleted(
					env.DB,
					mcstNo,
				);


				return Response.json({
					ok: true,

					completed: true,

					status:
						'not_found',

					mcstNo,

					message:
						'No PDPC registry result was recorded for this completed lookup.',
				});
			}


			return jsonError(
				'Unsupported lookup result.',
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
