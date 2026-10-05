import type { APIRoute } from 'astro';

import {
	getOutputRows,
} from '../../lib/db';


export const prerender = false;


const HEADERS = [
	'MCST#',
	'Estate Name',
	'UEN',
	'DPO(Y/N)',
	'DPO Name',
	'DPO Email',
	'DPO Company',
	'Record Discrepancy(Y/N)',
] as const;


function escapeCsv(
	value: unknown,
): string {
	const text =
		value === null ||
		value === undefined
			? ''
			: String(value);

	/*
	 * Protect spreadsheet users from CSV formula injection.
	 *
	 * This matters because some source values originate outside
	 * our application.
	 */
	const protectedValue =
		/^[=+\-@]/.test(text)
			? `'${text}`
			: text;

	return `"${protectedValue.replace(/"/g, '""')}"`;
}


export const GET: APIRoute =
	async ({ locals }) => {
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


			const rows =
				await getOutputRows(
					env.DB,
				);


			const lines: string[] = [];


			lines.push(
				HEADERS
					.map(escapeCsv)
					.join(','),
			);


			for (const row of rows) {
				lines.push(
					HEADERS
						.map(
							(header) =>
								escapeCsv(
									row[header],
								),
						)
						.join(','),
				);
			}


			/*
			 * UTF-8 BOM improves compatibility when the CSV is opened
			 * directly in Microsoft Excel.
			 */
			const csv =
				'\uFEFF' +
				lines.join('\r\n');


			const timestamp =
				new Date()
					.toISOString()
					.replace(
						/[:.]/g,
						'-',
					);


			return new Response(
				csv,
				{
					status: 200,

					headers: {
						'Content-Type':
							'text/csv; charset=utf-8',

						'Content-Disposition':
							`attachment; filename="mcst-dpo-registry-${timestamp}.csv"`,

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
