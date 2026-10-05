import {
	pbkdf2Sync,
	randomBytes
} from 'node:crypto';

import {
	createInterface
} from 'node:readline/promises';

import {
	stdin as input,
	stdout as output
} from 'node:process';


const PBKDF2_ITERATIONS =
	210000;

const SALT_BYTES =
	16;

const MIN_PASSWORD_LENGTH =
	12;


function hashPassword(password) {
	const salt =
		randomBytes(
			SALT_BYTES
		);

	const derivedKey =
		pbkdf2Sync(
			password,
			salt,
			PBKDF2_ITERATIONS,
			32,
			'sha256'
		);

	return [
		'pbkdf2-sha256',
		String(
			PBKDF2_ITERATIONS
		),
		salt.toString(
			'base64'
		),
		derivedKey.toString(
			'base64'
		)
	].join('$');
}


const readline =
	createInterface({
		input,
		output
	});


try {
	const password =
		await readline.question(
			'Enter administrator password: '
		);


	if (
		password.length <
		MIN_PASSWORD_LENGTH
	) {
		throw new Error(
			`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`
		);
	}


	const confirmation =
		await readline.question(
			'Confirm administrator password: '
		);


	if (
		password !==
		confirmation
	) {
		throw new Error(
			'Passwords do not match.'
		);
	}


	const passwordHash =
		hashPassword(
			password
		);


	console.log(
		'\nPassword hash:\n'
	);

	console.log(
		passwordHash
	);

	console.log(
		'\nStore this hash in the users.password_hash column.'
	);

	console.log(
		'Do not store the plaintext password.'
	);

} catch (error) {

	console.error(
		`\nError: ${
			error instanceof Error
				? error.message
				: 'Unable to create password hash.'
		}`
	);

	process.exitCode = 1;

} finally {

	readline.close();
}
