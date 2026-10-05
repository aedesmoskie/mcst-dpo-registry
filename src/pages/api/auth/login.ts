import type { APIRoute } from 'astro';

import {
	createSession,
	sessionCookie,
	verifyPassword
} from '../../../lib/auth';


export const prerender = false;


type UserRow = {
	id: number;
	email: string;
	password_hash: string;
	role: 'admin' | 'editor' | 'viewer';
	active: number;
};


const MAX_EMAIL_LENGTH =
	254;

const MAX_PASSWORD_LENGTH =
	256;


function jsonError(
	message: string,
	status: number
): Response {
	return Response.json(
		{
			ok: false,
			error: message
		},
		{
			status,
			headers: {
				'Cache-Control':
					'no-store'
			}
		}
	);
}


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
			 * Only accept JSON from our login form/API.
			 */
			const contentType =
				request.headers
					.get('content-type') ??
				'';

			if (
				!contentType
					.toLowerCase()
					.includes(
						'application/json'
					)
			) {
				return jsonError(
					'Invalid login request.',
					415
				);
			}


			let body: {
				email?: unknown;
				password?: unknown;
			};

			try {
				body =
					await request.json();
			} catch {
				return jsonError(
					'Invalid login request.',
					400
				);
			}


			const email =
				typeof body.email ===
				'string'
					? body.email
							.trim()
							.toLowerCase()
					: '';

			const password =
				typeof body.password ===
				'string'
					? body.password
					: '';


			if (
				!email ||
				!password ||
				email.length >
					MAX_EMAIL_LENGTH ||
				password.length >
					MAX_PASSWORD_LENGTH
			) {
				return jsonError(
					'Invalid email or password.',
					401
				);
			}


			/*
			 * Retrieve the account by its unique,
			 * case-insensitive email address.
			 */
			const user =
				await db
					.prepare(`
						SELECT
							id,
							email,
							password_hash,
							role,
							active
						FROM users
						WHERE email = ?
						LIMIT 1
					`)
					.bind(email)
					.first<UserRow>();


			/*
			 * Unknown accounts and inactive accounts
			 * deliberately receive the same public
			 * response as an incorrect password.
			 */
			if (
				!user ||
				user.active !== 1
			) {
				return jsonError(
					'Invalid email or password.',
					401
				);
			}


			const passwordValid =
				await verifyPassword(
					password,
					user.password_hash
				);


			if (!passwordValid) {
				return jsonError(
					'Invalid email or password.',
					401
				);
			}


			/*
			 * Remove expired sessions for this user.
			 *
			 * This is housekeeping only and does not
			 * affect valid sessions.
			 */
			await db
				.prepare(`
					DELETE FROM sessions
					WHERE
						user_id = ?
						AND expires_at <= ?
				`)
				.bind(
					user.id,
					new Date()
						.toISOString()
				)
				.run();


			const session =
				await createSession(
					db,
					user.id
				);


			return Response.json(
				{
					ok: true,

					user: {
						email:
							user.email,

						role:
							user.role
					}
				},
				{
					status: 200,

					headers: {
						'Set-Cookie':
							sessionCookie(
								session.token,
								session
									.expiresAt
							),

						'Cache-Control':
							'no-store'
					}
				}
			);

		} catch (error) {

			console.error(
				'Login failed:',
				error
			);

			return jsonError(
				'Unable to sign in.',
				500
			);
		}
	};
