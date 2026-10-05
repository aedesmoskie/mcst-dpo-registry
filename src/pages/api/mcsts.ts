import type { APIRoute } from 'astro';

export const prerender = false;


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

			const search =
				(url.searchParams.get('search') ?? '')
					.trim();

			const limit =
				Math.max(
					1,
					Math.min(
						5000,
						Number(
							url.searchParams.get(
								'limit',
							) ?? 5000,
						) || 5000,
					),
				);


			let statement;

			if (search) {
				const pattern =
					`%${search}%`;

				statement =
					env.DB
						.prepare(`
							SELECT
								mcst_no,
								estate_name,
								uen,
								source,
								source_estate_name
							FROM mcst_records
							WHERE
								source = 'BCA'
								AND (
									mcst_no LIKE ?
									OR estate_name LIKE ?
									OR uen LIKE ?
								)
							ORDER BY
								CAST(mcst_no AS INTEGER)
							LIMIT ?
						`)
						.bind(
							pattern,
							pattern,
							pattern,
							limit,
						);
			} else {
				statement =
					env.DB
						.prepare(`
							SELECT
								mcst_no,
								estate_name,
								uen,
								source,
								source_estate_name
							FROM mcst_records
							WHERE source = 'BCA'
							ORDER BY
								CAST(mcst_no AS INTEGER)
							LIMIT ?
						`)
						.bind(limit);
			}


			const result =
				await statement.all<{
					mcst_no: string;
					estate_name: string;
					uen: string;
					source: string;
					source_estate_name: string;
				}>();


			const countResult =
				await env.DB
					.prepare(`
						SELECT
							COUNT(*) AS count
						FROM mcst_records
						WHERE source = 'BCA'
					`)
					.first<{
						count: number;
					}>();


			return Response.json(
				{
					ok: true,

					total:
						Number(
							countResult?.count ?? 0,
						),

					count:
						result.results?.length ?? 0,

					records:
						result.results ?? [],
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
