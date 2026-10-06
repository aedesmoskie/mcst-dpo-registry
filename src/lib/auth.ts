export type UserRole =
	| 'admin'
	| 'editor'
	| 'viewer';


export type AuthUser = {
	id: number;
	email: string;
	role: UserRole;
};


type SessionRow = {
	session_id: number;
	user_id: number;
	email: string;
	role: UserRole;
	active: number;
	expires_at: string;
};


const SESSION_COOKIE =
	'mcst_registry_session';


const SESSION_DURATION_SECONDS =
	60 * 60 * 12;


const SESSION_TOKEN_BYTES =
	32;


function bytesToBase64(
	bytes: Uint8Array
): string {
	let binary = '';

	for (const byte of bytes) {
		binary +=
			String.fromCharCode(byte);
	}

	return btoa(binary);
}


function bytesToHex(
	bytes: Uint8Array
): string {
	return Array.from(bytes)
		.map(
			(byte) =>
				byte
					.toString(16)
					.padStart(2, '0')
		)
		.join('');
}


function randomBytes(
	length: number
): Uint8Array {
	const bytes =
		new Uint8Array(length);

	crypto.getRandomValues(bytes);

	return bytes;
}


async function sha256(
	value: string
): Promise<string> {
	const data =
		new TextEncoder()
			.encode(value);

	const digest =
		await crypto.subtle.digest(
			'SHA-256',
			data
		);

	return bytesToHex(
		new Uint8Array(digest)
	);
}


/*
 * Password hashing follows the same Cloudflare
 * Web Crypto SHA-256 mechanism used by WAYPOINT.
 *
 * The plaintext password is never stored.
 */
export async function hashPassword(
	password: string
): Promise<string> {
	if (password.length < 12) {
		throw new Error(
			'Password must contain at least 12 characters.'
		);
	}

	return sha256(password);
}


export async function verifyPassword(
	password: string,
	storedHash: string
): Promise<boolean> {
	try {
		const actualHash =
			await sha256(password);

		const expectedHash =
			storedHash
				.trim()
				.toLowerCase();

		if (
			actualHash.length !==
			expectedHash.length
		) {
			return false;
		}

		let difference = 0;

		for (
			let i = 0;
			i < actualHash.length;
			i++
		) {
			difference |=
				actualHash.charCodeAt(i) ^
				expectedHash.charCodeAt(i);
		}

		return difference === 0;

	} catch {
		return false;
	}
}


async function hashSessionToken(
	token: string
): Promise<string> {
	return sha256(token);
}


export function generateSessionToken():
	string {
	return bytesToBase64(
		randomBytes(
			SESSION_TOKEN_BYTES
		)
	)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}


export async function createSession(
	db: D1Database,
	userId: number
): Promise<{
	token: string;
	expiresAt: Date;
}> {
	const token =
		generateSessionToken();

	const tokenHash =
		await hashSessionToken(
			token
		);

	const expiresAt =
		new Date(
			Date.now() +
			SESSION_DURATION_SECONDS *
				1000
		);

	await db
		.prepare(`
			INSERT INTO sessions (
				user_id,
				token_hash,
				expires_at,
				created_at,
				last_seen_at
			)
			VALUES (
				?,
				?,
				?,
				CURRENT_TIMESTAMP,
				CURRENT_TIMESTAMP
			)
		`)
		.bind(
			userId,
			tokenHash,
			expiresAt.toISOString()
		)
		.run();

	return {
		token,
		expiresAt
	};
}


export async function deleteSession(
	db: D1Database,
	token: string
): Promise<void> {
	if (!token) {
		return;
	}

	const tokenHash =
		await hashSessionToken(
			token
		);

	await db
		.prepare(`
			DELETE FROM sessions
			WHERE token_hash = ?
		`)
		.bind(tokenHash)
		.run();
}


export async function getAuthenticatedUser(
	db: D1Database,
	token: string | null | undefined
): Promise<AuthUser | null> {
	if (!token) {
		return null;
	}

	const tokenHash =
		await hashSessionToken(
			token
		);

	const session =
		await db
			.prepare(`
				SELECT
					s.id
						AS session_id,

					u.id
						AS user_id,

					u.email
						AS email,

					u.role
						AS role,

					u.active
						AS active,

					s.expires_at
						AS expires_at

				FROM sessions AS s

				INNER JOIN users AS u
					ON u.id =
						s.user_id

				WHERE
					s.token_hash = ?

				LIMIT 1
			`)
			.bind(tokenHash)
			.first<SessionRow>();


	if (!session) {
		return null;
	}


	if (session.active !== 1) {
		await db
			.prepare(`
				DELETE FROM sessions
				WHERE id = ?
			`)
			.bind(
				session.session_id
			)
			.run();

		return null;
	}


	const expiresAt =
		new Date(
			session.expires_at
		);

	if (
		Number.isNaN(
			expiresAt.getTime()
		) ||
		expiresAt.getTime() <=
			Date.now()
	) {
		await db
			.prepare(`
				DELETE FROM sessions
				WHERE id = ?
			`)
			.bind(
				session.session_id
			)
			.run();

		return null;
	}


	return {
		id:
			session.user_id,

		email:
			session.email,

		role:
			session.role
	};
}


export function getSessionTokenFromRequest(
	request: Request
): string | null {
	const cookieHeader =
		request.headers.get(
			'cookie'
		);

	if (!cookieHeader) {
		return null;
	}

	for (
		const part
		of cookieHeader.split(';')
	) {
		const [
			rawName,
			...rawValue
		] = part.trim().split('=');

		if (
			rawName ===
			SESSION_COOKIE
		) {
			return decodeURIComponent(
				rawValue.join('=')
			);
		}
	}

	return null;
}


export function sessionCookie(
	token: string,
	expiresAt: Date
): string {
	return [
		`${SESSION_COOKIE}=${encodeURIComponent(
			token
		)}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		`Expires=${expiresAt.toUTCString()}`
	].join('; ');
}


export function clearSessionCookie():
	string {
	return [
		`${SESSION_COOKIE}=`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		'Max-Age=0'
	].join('; ');
}


export function hasRole(
	user: AuthUser,
	...roles: UserRole[]
): boolean {
	return roles.includes(
		user.role
	);
}
