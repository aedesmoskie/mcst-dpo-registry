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


/**
 * Protect values originating from external sources from being interpreted
 * as formulas when the workbook is opened in spreadsheet software.
 */
function safeCell(
	value: unknown,
): string {
	const text =
		value === null ||
		value === undefined
			? ''
			: String(value);

	if (/^[=+\-@]/.test(text)) {
		return `'${text}`;
	}

	return text;
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


			/*
			 * Dynamic import keeps the XLSX library out of routes that
			 * do not need workbook generation.
			 */
			const XLSX =
				await import('xlsx');


			const rows =
				await getOutputRows(
					env.DB,
				);


			const worksheetData:
				string[][] = [
					[...HEADERS],
				];


			for (const row of rows) {
				worksheetData.push(
					HEADERS.map(
						(header) =>
							safeCell(
								row[header],
							),
					),
				);
			}


			const worksheet =
				XLSX.utils.aoa_to_sheet(
					worksheetData,
				);


			/*
			 * Keep the final workbook practical to review manually.
			 */
			worksheet['!cols'] = [
				{ wch: 10 },
				{ wch: 36 },
				{ wch: 16 },
				{ wch: 12 },
				{ wch: 28 },
				{ wch: 38 },
				{ wch: 30 },
				{ wch: 24 },
			];


			/*
			 * Enable filtering across the complete result set.
			 */
			if (worksheetData.length > 1) {
				worksheet['!autofilter'] = {
					ref:
						`A1:H${worksheetData.length}`,
				};
			}


			const workbook =
				XLSX.utils.book_new();


			XLSX.utils.book_append_sheet(
				workbook,
				worksheet,
				'MCST DPO Registry',
			);


			const output =
				XLSX.write(
					workbook,
					{
						type: 'array',
						bookType: 'xlsx',
						compression: true,
					},
				);


			const timestamp =
				new Date()
					.toISOString()
					.slice(0, 10);


			return new Response(
				output,
				{
					status: 200,

					headers: {
						'Content-Type':
							'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

						'Content-Disposition':
							`attachment; filename="mcst-dpo-registry-${timestamp}.xlsx"`,

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
