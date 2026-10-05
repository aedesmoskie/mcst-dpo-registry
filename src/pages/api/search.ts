import type { APIRoute } from 'astro';


export const prerender = false;


const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;


export const GET: APIRoute =
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


			const url =
				new URL(request.url);

			const query =
				(
					url.searchParams.get('q') ??
					''
				).trim();

			const requestedLimit =
				Number(
					url.searchParams.get(
						'limit',
					) ?? DEFAULT_LIMIT,
				);

			const limit =
				Math.max(
					1,
					Math.min(
						MAX_LIMIT,
						Number.isFinite(
							requestedLimit,
						)
							? Math.floor(
									requestedLimit,
								)
							: DEFAULT_LIMIT,
					),
				);


			if (!query) {
				return Response.json(
					{
						ok: true,
						query: '',
						count: 0,
						rows: [],
					},
					{
						headers: {
							'Cache-Control':
								'no-store',
						},
					},
				);
			}


			const pattern =
				`%${query}%`;


			const result =
				await env.DB
					.prepare(`
						SELECT
							mcst_no,
							estate_name,
							uen,
							dpo_found,
							dpo_name,
							dpo_email,
							dpo_company,
							record_discrepancy
						FROM dpo_records
						WHERE
							mcst_no LIKE ?
							OR estate_name LIKE ?
							OR uen LIKE ?
							OR dpo_name LIKE ?
							OR dpo_email LIKE ?
							OR dpo_company LIKE ?
							OR pdpc_organisation_name LIKE ?
						ORDER BY
							CAST(mcst_no AS INTEGER),
							estate_name,
							dpo_name
						LIMIT ?
					`)
					.bind(
						pattern,
						pattern,
						pattern,
						pattern,
						pattern,
						pattern,
						pattern,
						limit,
					)
					.all<{
						mcst_no: string;
						estate_name: string;
						uen: string;
						dpo_found: number;
						dpo_name: string;
						dpo_email: string;
						dpo_company: string;
						record_discrepancy: number;
					}>();


			const rows =
				(
					result.results ?? []
				).map((row) => ({
					'MCST#':
						row.mcst_no ?? '',

					'Estate Name':
						row.estate_name ?? '',

					'UEN':
						row.uen ?? '',

					'DPO(Y/N)':
						row.dpo_found
							? 'Y'
							: 'N',

					'DPO Name':
						row.dpo_name ?? '',

					'DPO Email':
						row.dpo_email ?? '',

					'DPO Company':
						row.dpo_company ?? '',

					'Record Discrepancy(Y/N)':
						row.record_discrepancy
							? 'Y'
							: 'N',
				}));


			return Response.json(
				{
					ok: true,
					query,
					count:
						rows.length,
					limit,
					rows,
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
