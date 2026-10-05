import type { APIRoute } from 'astro';

import { getOutputRows } from '../../lib/db';

export const prerender = false;

const headers = [
	'MCST#',
	'Estate Name',
	'UEN',
	'DPO(Y/N)',
	'DPO Name',
	'DPO Email',
	'DPO Company',
	'Record Discrepancy(Y/N)'
];

const esc = (v: any) => {
	let s =
		String(v ?? '');

	if (/^[=+\-@]/.test(s)) {
		s = `'${s}`;
	}

	return `"${s.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ locals }) => {
	const rows =
		await getOutputRows(
			(locals.runtime.env as any).DB
		);

	const csv =
		'\uFEFF' +
		headers
			.map(esc)
			.join(',') +
		'\r\n' +
		rows
			.map(
				(r) =>
					headers
						.map(
							(h) =>
								esc(
									(r as any)[h]
								)
						)
						.join(',')
			)
			.join('\r\n');

	return new Response(
		csv,
		{
			headers: {
				'content-type':
					'text/csv; charset=utf-8',

				'content-disposition':
					'attachment; filename="mcst-dpo-registry.csv"'
			}
		}
	);
};
