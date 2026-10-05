import type { APIRoute } from 'astro';

import {
	getLookupProgress,
	getOutputRows
} from '../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	try {
		const db =
			(locals.runtime.env as any).DB as D1Database;

		return Response.json({
			ok: true,
			rows:
				await getOutputRows(db),
			progress:
				await getLookupProgress(db)
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
