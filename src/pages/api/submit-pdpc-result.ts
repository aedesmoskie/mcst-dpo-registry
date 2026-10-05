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


type SearchType =
	| 'uen'
	| 'estate_name';


interface SubmissionBody {
	mcstNo?: string;

	status?: SubmissionStatus;

	searchType?: SearchType;

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
				ORDER BY
					updated_at DESC,
					id DESC
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

				/*
				 * Preserve the PDPC-returned identity independently
				 * from the canonical BCA UEN.
				 */
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

				/*
				 * PDPC currently does not expose a separate DPO
				 * company field in the registry result used by this
				 * workflow. Do not infer one from the email domain.
				 */
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
					item.dpoEmail ||
					item.dpoCompany,
				),
		);
}


function resolveSearchType(
	body: SubmissionBody,
	record: McstRecord,
): SearchType {
	if (
		body.searchType === 'uen' ||
		body.searchType === 'estate_name'
	) {
		return body.searchType;
	}

	/*
	 * UEN is the primary identifier.
	 *
	 * If BCA has no UEN, fall back to the estate/entity name rather
	 * than constructing an invalid empty UEN search.
	 */
	return normaliseUen(record.uen)
		? 'uen'
		: 'estate_name';
}


function resolveSearchValue(
	body: SubmissionBody,
	record: McstRecord,
	searchType: SearchType,
): string {
	if (searchType === 'uen') {
		return normaliseUen(
			body.searchValue ||
				record.uen,
		);
	}

	return cleanSourceText(
		body.searchValue ||
			record.estate_name,
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
			 * Verification/cancellation never creates, replaces,
			 * or deletes a DPO result.
			 *
			 * The MCST simply remains pending so the lookup can be
			 * resumed later.
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
				resolveSearchType(
					body,
					record,
				);

			const searchValue =
				resolveSearchValue(
					body,
					record,
					searchType,
				);

			if (!searchValue) {
				return jsonError(
					'The completed lookup must identify the PDPC search value used.',
				);
			}


			/*
			 * The lookup becomes processing only when a completed
			 * human-assisted result is submitted.
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
				 * IMPORTANT:
				 *
				 * Do not reject an observation merely because the
				 * PDPC-returned UEN differs from the BCA UEN.
				 *
				 * A conflicting authoritative identifier is itself
				 * evidence that must be preserved. The database layer
				 * compares BCA and PDPC identity, stores the returned
				 * PDPC UEN independently, and flags the row with the
				 * appropriate discrepancy reason.
				 *
				 * Multiple actual DPO observations are also retained
				 * as multiple rows.
				 */


				/*
				 * Replace only the current final-output rows.
				 *
				 * Historical lookup evidence in
				 * pdpc_lookup_attempts is deliberately retained.
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
					searchValue,
				);

				await markLookupCompleted(
					env.DB,
					mcstNo,
				);


				return Response.json({
					ok: true,

					completed: true,

					status:
						'found',

					mcstNo,

					searchType,

					searchValue,

					observationCount:
						observations.length,
				});
			}


			/*
			 * DPO=N is written ONLY when the user explicitly submits
			 * a completed "not found" PDPC registry search.
			 *
			 * It means:
			 *
			 * "No DPO registration was found in the PDPC registry
			 * for this completed search."
			 *
			 * It does NOT assert that the MCST has no appointed DPO.
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
					searchValue,
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

					searchType,

					searchValue,

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
