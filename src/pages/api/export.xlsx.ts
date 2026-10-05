import type { APIRoute } from 'astro';

import { getOutputRows } from '../../lib/db';

export const prerender = false;

const safe = (v: string) =>
	/^[=+\-@]/.test(v)
		? `'${v}`
		: v;

export const GET: APIRoute = async ({ locals }) => {
	try {
		const db =
			(locals.runtime.env as any).DB as D1Database;

		const rows =
			(await getOutputRows(db)).map(
				(r) =>
					Object.fromEntries(
						Object.entries(r).map(
							([k, v]) => [
								k,
								safe(
									String(v ?? '')
								)
							]
						)
					)
			);

		const XLSX =
			await import('xlsx');

		const wb =
			XLSX.utils.book_new();

		const ws =
			XLSX.utils.json_to_sheet(
				rows,
				{
					header: [
						'MCST#',
						'Estate Name',
						'UEN',
						'DPO(Y/N)',
						'DPO Name',
						'DPO Email',
						'DPO Company',
						'Record Discrepancy(Y/N)'
					]
				}
			);

		ws['!cols'] = [
			{ wch: 10 },
			{ wch: 38 },
			{ wch: 18 },
			{ wch: 10 },
			{ wch: 28 },
			{ wch: 36 },
			{ wch: 28 },
			{ wch: 25 }
		];

		if (ws['!ref']) {
			ws['!autofilter'] = {
				ref: ws['!ref']
			};
		}

		XLSX.utils.book_append_sheet(
			wb,
			ws,
			'MCST DPO Registry'
		);

		const out =
			XLSX.write(
				wb,
				{
					type: 'array',
					bookType: 'xlsx'
				}
			);

		return new Response(
			out,
			{
				headers: {
					'content-type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

					'content-disposition':
						'attachment; filename="mcst-dpo-registry.xlsx"'
				}
			}
		);
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
