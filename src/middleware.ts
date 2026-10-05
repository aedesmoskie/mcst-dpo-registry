import { defineMiddleware } from 'astro:middleware';

import {
	getAuthenticatedUser,
	getSessionTokenFromRequest
} from './lib/auth';


const PUBLIC_PATHS =
	new Set([
		'/login',
		'/api/auth/login'
	]);


function isPublicAsset(
	pathname: string
): boolean {
	return (
		pathname.startsWith('/_astro/') ||
		pathname === '/favicon.svg' ||
		pathname === '/favicon.ico' ||
		pathname === '/robots.txt'
	);
}


function isApiRequest(
	pathname: string
): boolean {
	return pathname.startsWith('/api/');
}


function unauthorisedApiResponse():
	Response {
	return Response.json(
		{
			ok: false,
			error:
				'Authentication required.'
		},
		{
			status: 401,
			headers: {
				'Cache-Control':
					'no-store'
			}
		}
	);
}


export const onRequest =
	defineMiddleware(
		async (
			context,
			next
		) => {
			const {
				request,
				url,
				locals
			} = context;

			const pathname =
				url.pathname;


			/*
			 * Astro-generated assets and explicitly
			 * public authentication routes do not
			 * require a session.
			 */
			if (
				PUBLIC_PATHS.has(
					pathname
				) ||
				isPublicAsset(
					pathname
				)
			) {
				return next();
			}


			/*
			 * Retrieve and validate the server-side
			 * session.
			 */
			const token =
				getSessionTokenFromRequest(
					request
				);

			let user = null;

			if (token) {
				try {
					const db =
						(
							locals.runtime
								.env as any
						).DB as D1Database;

					user =
						await getAuthenticatedUser(
							db,
							token
						);
				} catch (error) {
					console.error(
						'Authentication validation failed:',
						error
					);

					user = null;
				}
			}


			/*
			 * No valid session:
			 *
			 * API calls receive 401 rather than HTML.
			 * Browser page requests are redirected to
			 * the login page.
			 */
			if (!user) {
				if (
					isApiRequest(
						pathname
					)
				) {
					return unauthorisedApiResponse();
				}

				return context.redirect(
					'/login',
					302
				);
			}


			/*
			 * Make the authenticated identity
			 * available to pages and API routes.
			 */
			(
				locals as any
			).user = user;


			/*
			 * Sync Records changes authoritative
			 * registry data and is therefore restricted
			 * to administrators.
			 *
			 * This is enforced server-side regardless
			 * of whether the UI displays the button.
			 */
			if (
				pathname ===
					'/api/sync-bca' &&
				user.role !==
					'admin'
			) {
				return Response.json(
					{
						ok: false,
						error:
							'Administrator access required.'
					},
					{
						status: 403,
						headers: {
							'Cache-Control':
								'no-store'
						}
					}
				);
			}


			return next();
		}
	);
