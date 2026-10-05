import type { APIRoute } from 'astro';

export const prerender = false;

type QueryValue =
	| string
	| number;

type RegistryRow = {
	mcst_no: string;
	estate_name: string | null;
	uen: string | null;
	dpo_found: number | null;
	dpo_name: string | null;
	dpo_email: string | null;
	dpo_company: string | null;
	record_discrepancy: number | null;
	dpo_record_id: number | null;
};

type CountRow = {
	total: number;
};

const SORT_COLUMNS: Record<
	string,
	string
> = {
	mcst: 'm.mcst_no',
	estate: 'm.estate_name',
	uen: 'm.uen',
	dpo: 'd.dpo_found',
	dpoName: 'd.dpo_name',
	dpoEmail: 'd.dpo_email',
	dpoCompany: 'd.dpo_company',
	discrepancy: 'd.record_discrepancy'
};

function positiveInteger(
	value: string | null,
	fallback: number
) {
	const parsed =
		Number.parseInt(
			value ?? '',
			10
		);

	if (
		!Number.isFinite(parsed) ||
		parsed < 1
	) {
		return fallback;
	}

	return parsed;
}

function likeValue(
	value: string
) {
	return `%${value}%`;
}

export const GET: APIRoute =
	async ({
		request,
		locals
	}) => {
		try {
			const db =
				(locals.runtime.env as any)
					.DB as D1Database;

			const params =
				new URL(request.url)
					.searchParams;

			const full =
				params.get('full') === '1';

			const mcst =
				params
					.get('mcst')
					?.trim() ?? '';

			const uen =
				params
					.get('uen')
					?.trim() ?? '';

			const estate =
				params
					.get('estate')
					?.trim() ?? '';

			const dpoName =
				params
					.get('dpoName')
					?.trim() ?? '';

			const dpoEmail =
				params
					.get('dpoEmail')
					?.trim() ?? '';

			const keyword =
				params
					.get('keyword')
					?.trim() ?? '';

			const page =
				positiveInteger(
					params.get('page'),
					1
				);

			const requestedPageSize =
				positiveInteger(
					params.get(
						'pageSize'
					),
					25
				);

			const allowedPageSizes =
				new Set([
					10,
					25,
					50,
					100
				]);

			const pageSize =
				allowedPageSizes.has(
					requestedPageSize
				)
					? requestedPageSize
					: 25;

			const sort =
				params
					.get('sort')
					?.trim() ?? '';

			const direction =
				params
					.get('direction')
					?.toLowerCase() ===
				'desc'
					? 'DESC'
					: 'ASC';

			const filterMcst =
				params
					.get(
						'filter_mcst'
					)
					?.trim() ?? '';

			const filterEstate =
				params
					.get(
						'filter_estate'
					)
					?.trim() ?? '';

			const filterUen =
				params
					.get(
						'filter_uen'
					)
					?.trim() ?? '';

			const filterDpo =
				params
					.get(
						'filter_dpo'
					)
					?.trim()
					.toUpperCase() ?? '';

			const filterDpoName =
				params
					.get(
						'filter_dpoName'
					)
					?.trim() ?? '';

			const filterDpoEmail =
				params
					.get(
						'filter_dpoEmail'
					)
					?.trim() ?? '';

			const filterDpoCompany =
				params
					.get(
						'filter_dpoCompany'
					)
					?.trim() ?? '';

			const filterDiscrepancy =
				params
					.get(
						'filter_discrepancy'
					)
					?.trim()
					.toUpperCase() ?? '';

			const hasPrimarySearch =
				Boolean(
					mcst ||
					uen ||
					estate ||
					dpoName ||
					dpoEmail
				);

			if (
				!full &&
				!hasPrimarySearch
			) {
				return Response.json({
					ok: true,
					rows: [],
					total: 0,
					page: 1,
					pageSize,
					totalPages: 0
				});
			}

			const where: string[] = [
				"m.source = 'BCA'"
			];

			const bindings:
				QueryValue[] = [];

			if (mcst) {
				where.push(
					'm.mcst_no LIKE ?'
				);

				bindings.push(
					likeValue(mcst)
				);
			}

			if (uen) {
				where.push(
					`(
						m.uen LIKE ?
						OR d.uen LIKE ?
					)`
				);

				const value =
					likeValue(uen);

				bindings.push(
					value,
					value
				);
			}

			if (estate) {
				where.push(
					`(
						m.estate_name LIKE ?
						OR d.estate_name LIKE ?
					)`
				);

				const value =
					likeValue(estate);

				bindings.push(
					value,
					value
				);
			}

			if (dpoName) {
				where.push(
					'd.dpo_name LIKE ?'
				);

				bindings.push(
					likeValue(dpoName)
				);
			}

			if (dpoEmail) {
				where.push(
					'd.dpo_email LIKE ?'
				);

				bindings.push(
					likeValue(dpoEmail)
				);
			}

			if (keyword) {
				const value =
					likeValue(keyword);

				where.push(`
					(
						m.mcst_no LIKE ?
						OR m.estate_name LIKE ?
						OR m.uen LIKE ?
						OR d.estate_name LIKE ?
						OR d.uen LIKE ?
						OR d.dpo_name LIKE ?
						OR d.dpo_email LIKE ?
						OR d.dpo_company LIKE ?
						OR d.pdpc_organisation_name LIKE ?
						OR d.pdpc_uen LIKE ?
					)
				`);

				bindings.push(
					value,
					value,
					value,
					value,
					value,
					value,
					value,
					value,
					value,
					value
				);
			}

			if (filterMcst) {
				where.push(
					'm.mcst_no LIKE ?'
				);

				bindings.push(
					likeValue(
						filterMcst
					)
				);
			}

			if (filterEstate) {
				where.push(
					`(
						m.estate_name LIKE ?
						OR d.estate_name LIKE ?
					)`
				);

				const value =
					likeValue(
						filterEstate
					);

				bindings.push(
					value,
					value
				);
			}

			if (filterUen) {
				where.push(
					`(
						m.uen LIKE ?
						OR d.uen LIKE ?
					)`
				);

				const value =
					likeValue(
						filterUen
					);

				bindings.push(
					value,
					value
				);
			}

			if (
				filterDpo === 'Y'
			) {
				where.push(
					'd.id IS NOT NULL'
				);

				where.push(
					'd.dpo_found = 1'
				);
			}

			if (
				filterDpo === 'N'
			) {
				where.push(
					'd.id IS NOT NULL'
				);

				where.push(
					'd.dpo_found = 0'
				);
			}

			if (filterDpoName) {
				where.push(
					'd.dpo_name LIKE ?'
				);

				bindings.push(
					likeValue(
						filterDpoName
					)
				);
			}

			if (filterDpoEmail) {
				where.push(
					'd.dpo_email LIKE ?'
				);

				bindings.push(
					likeValue(
						filterDpoEmail
					)
				);
			}

			if (filterDpoCompany) {
				where.push(
					'd.dpo_company LIKE ?'
				);

				bindings.push(
					likeValue(
						filterDpoCompany
					)
				);
			}

			if (
				filterDiscrepancy ===
				'Y'
			) {
				where.push(
					'd.id IS NOT NULL'
				);

				where.push(
					'd.record_discrepancy = 1'
				);
			}

			if (
				filterDiscrepancy ===
				'N'
			) {
				where.push(
					'd.id IS NOT NULL'
				);

				where.push(
					'd.record_discrepancy = 0'
				);
			}

			const whereSql =
				`WHERE ${where.join(
					'\nAND '
				)}`;

			const fromSql = `
				FROM mcst_records AS m

				LEFT JOIN dpo_records AS d
					ON d.mcst_no =
						m.mcst_no
			`;

			const countResult =
				await db
					.prepare(`
						SELECT
							COUNT(*) AS total

						${fromSql}

						${whereSql}
					`)
					.bind(
						...bindings
					)
					.first<CountRow>();

			const total =
				Number(
					countResult?.total ??
						0
				);

			const totalPages =
				total > 0
					? Math.ceil(
							total /
								pageSize
						)
					: 0;

			const effectivePage =
				totalPages > 0
					? Math.min(
							page,
							totalPages
						)
					: 1;

			const offset =
				(effectivePage - 1) *
				pageSize;

			const sortColumn =
				SORT_COLUMNS[sort] ??
				'm.mcst_no';

			let orderSql: string;

			if (
				sort === 'mcst' ||
				!sort
			) {
				orderSql = `
					ORDER BY
						CASE
							WHEN instr(
								m.mcst_no,
								'-'
							) > 0
							THEN substr(
								m.mcst_no,
								instr(
									m.mcst_no,
									'-'
								) + 1
							)
							ELSE m.mcst_no
						END ${direction},

						CASE
							WHEN instr(
								m.mcst_no,
								'-'
							) > 0
							THEN 1
							ELSE 0
						END ${direction},

						m.mcst_no ${direction},

						COALESCE(
							d.id,
							0
						) ASC
				`;
			} else {
				orderSql = `
					ORDER BY
						${sortColumn}
							${direction},

						m.mcst_no ASC,

						COALESCE(
							d.id,
							0
						) ASC
				`;
			}

			const result =
				await db
					.prepare(`
						SELECT
							m.mcst_no
								AS mcst_no,

							COALESCE(
								d.estate_name,
								m.estate_name
							)
								AS estate_name,

							COALESCE(
								d.uen,
								m.uen
							)
								AS uen,

							d.dpo_found
								AS dpo_found,

							d.dpo_name
								AS dpo_name,

							d.dpo_email
								AS dpo_email,

							d.dpo_company
								AS dpo_company,

							d.record_discrepancy
								AS record_discrepancy,

							d.id
								AS dpo_record_id

						${fromSql}

						${whereSql}

						${orderSql}

						LIMIT ?
						OFFSET ?
					`)
					.bind(
						...bindings,
						pageSize,
						offset
					)
					.all<RegistryRow>();

			const rows =
				(result.results ?? [])
					.map(
						(row) => {
							const hasDpoRecord =
								row.dpo_record_id !==
								null;

							return {
								'MCST#':
									row.mcst_no,

								'Estate Name':
									row.estate_name ??
									'',

								'UEN':
									row.uen ?? '',

								'DPO(Y/N)':
									!hasDpoRecord
										? ''
										: row.dpo_found ===
												1
											? 'Y'
											: 'N',

								'DPO Name':
									row.dpo_name ??
									'',

								'DPO Email':
									row.dpo_email ??
									'',

								'DPO Company':
									row.dpo_company ??
									'',

								'Record Discrepancy(Y/N)':
									!hasDpoRecord
										? ''
										: row.record_discrepancy ===
												1
											? 'Y'
											: 'N'
							};
						}
					);

			return Response.json({
				ok: true,
				rows,
				total,
				page: effectivePage,
				pageSize,
				totalPages
			});
		} catch (e) {
			return Response.json(
				{
					ok: false,
					error:
						e instanceof Error
							? e.message
							: String(e)
				},
				{
					status: 500
				}
			);
		}
	};
