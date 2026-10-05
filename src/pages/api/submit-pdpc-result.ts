import type { APIRoute } from 'astro';

import {
	clearExistingDpoResults,
	markLookupCompleted,
	markLookupPending,
	markLookupProcessing,
	saveDpoObservations,
	saveNoDpoResult
} from '../../lib/db';

import type {
	DpoObservation,
	McstRecord
} from '../../lib/types';

import {
	cleanSourceText,
	normaliseMcstIdentifier,
	normaliseUen
} from '../../lib/normalise';


export const prerender = false;


export const POST: APIRoute =
	async ({ request, locals }) => {
		try {
			const db =
				(locals.runtime.env as any)
					.DB as D1Database;

			const body: any =
				await request.json();


			/*
			 * Preserve the complete BCA MCST identifier.
			 *
			 * Examples:
			 *
			 *   4355
			 *   01-4355
			 *   02-4355
			 *
			 * must remain independent records.
			 */
			const mcst =
				normaliseMcstIdentifier(
					body.mcstNo
				);


			if (!mcst) {
				return Response.json(
					{
						ok: false,
						error:
							'A valid MCST number is required.'
					},
					{
						status: 400
					}
				);
			}


			/*
			 * Resolve the exact BCA entity by its complete MCST
			 * identifier.
			 */
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
					.bind(mcst)
					.first<McstRecord>();


			if (!record) {
				return Response.json(
					{
						ok: false,
						error:
							`MCST ${mcst} was not found.`
					},
					{
						status: 404
					}
				);
			}


			/*
			 * Verification/cancel states do not create a final DPO
			 * result. Return the MCST to the pending queue.
			 */
			if (
				body.status ===
					'verification_required' ||
				body.status ===
					'cancelled'
			) {
				await markLookupPending(
					db,
					mcst,
					body.status
				);

				return Response.json({
					ok: true,
					completed: false,
					status: body.status,
					mcstNo: mcst
				});
			}


			if (
				body.status !== 'found' &&
				body.status !== 'not_found'
			) {
				return Response.json(
					{
						ok: false,
						error:
							'Invalid PDPC lookup status.'
					},
					{
						status: 400
					}
				);
			}


			/*
			 * UEN remains the primary PDPC search value where BCA
			 * supplies one.
			 *
			 * It is NOT the unique application record identifier.
			 */
			const searchType =
				body.searchType ===
					'estate_name'
					? 'estate_name'
					: 'uen';


			const searchValue =
				searchType === 'uen'
					? normaliseUen(
							body.searchValue ||
							record.uen
						)
					: cleanSourceText(
							body.searchValue ||
							record.estate_name
						);


			if (!searchValue) {
				return Response.json(
					{
						ok: false,
						error:
							'The PDPC search value used is required.'
					},
					{
						status: 400
					}
				);
			}


			await markLookupProcessing(
				db,
				mcst
			);


			if (body.status === 'found') {
				const observations:
					DpoObservation[] =
					(
						Array.isArray(
							body.observations
						)
							? body.observations
							: []
					)
						.map(
							(observation: any) => ({
								organisationName:
									cleanSourceText(
										observation
											.organisationName
									),

								/*
								 * Preserve the actual UEN returned
								 * by PDPC independently from the
								 * BCA UEN.
								 */
								uen:
									normaliseUen(
										observation.uen
									),

								dpoName:
									cleanSourceText(
										observation
											.dpoName
									),

								dpoEmail:
									cleanSourceText(
										observation
											.dpoEmail
									),

								/*
								 * PDPC currently does not provide a
								 * separate DPO Company field in the
								 * registry results. Do not infer one
								 * from the email address.
								 */
								dpoCompany:
									cleanSourceText(
										observation
											.dpoCompany
									)
							})
						)
						.filter(
							(observation) =>
								observation
									.organisationName ||
								observation.uen ||
								observation.dpoName ||
								observation.dpoEmail ||
								observation.dpoCompany
						);


				if (!observations.length) {
					await markLookupPending(
						db,
						mcst,
						'Found result submitted without observations.'
					);

					return Response.json(
						{
							ok: false,
							error:
								'A found result must contain at least one observation.'
						},
						{
							status: 400
						}
					);
				}


				/*
				 * Replace only this MCST entity's previous result.
				 *
				 * A main MCST and subsidiary MCST sharing the same
				 * UEN therefore remain completely independent.
				 */
				await clearExistingDpoResults(
					db,
					mcst
				);


				await saveDpoObservations(
					db,
					record,
					observations,
					'found',
					searchType,
					searchValue
				);
			} else {
				await clearExistingDpoResults(
					db,
					mcst
				);


				await saveNoDpoResult(
					db,
					record,
					'not_found',
					searchType,
					searchValue
				);
			}


			await markLookupCompleted(
				db,
				mcst
			);


			return Response.json({
				ok: true,
				completed: true,
				status: body.status,
				mcstNo: mcst
			});
		} catch (error) {
			return Response.json(
				{
					ok: false,
					error:
						error instanceof Error
							? error.message
							: String(error)
				},
				{
					status: 500
				}
			);
		}
	};
