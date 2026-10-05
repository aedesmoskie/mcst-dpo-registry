import type { APIRoute } from 'astro';

import {
	clearSessionCookie,
	deleteSession,
	getSessionTokenFromRequest
} from '../../../lib/auth';


export const prerender = false;


export const POST: APIRoute =
	async ({
		request,
		locals
	}) => {
		try {
			const db =
				(locals.runtime.env as any)
					.DB as D1Database;


			/*
			 * Obtain the current session token from the
			 * secure HttpOnly cookie.
			 */
			const token =
				getSessionTokenFromRequest(
					request
				);


			/*
			 * Delete the server-side session first.
			 *
			 * Once removed from D1, the token cannot
			 * authenticate again even if somebody has
			 * retained a copy of the cookie.
			 */
			if (token) {
				await deleteSession(
					db,
					token
				);
			}


			return Response.json(
				{
					ok: true
				},
				{
					status: 200,

					headers: {
						'Set-Cookie':
							clearSessionCookie(),

						'Cache-Control':
							'no-store'
					}
				}
			);

		} catch (error) {

			console.error(
				'Logout failed:',
				error
			);


			/*
			 * Clear the browser cookie even if D1
			 * encounters an error while deleting the
			 * server-side session.
			 */
			return Response.json(
				{
					ok: false,
					error:
						'Unable to complete logout.'
				},
				{
					status: 500,

					headers: {
						'Set-Cookie':
							clearSessionCookie(),

						'Cache-Control':
							'no-store'
					}
				}
			);
		}
	};
