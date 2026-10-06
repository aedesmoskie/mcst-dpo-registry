import {
	createHash,
} from 'node:crypto';

import {
	createInterface,
} from 'node:readline';


const MIN_PASSWORD_LENGTH = 12;


function hashPassword(password) {
	return createHash('sha256')
		.update(password, 'utf8')
		.digest('hex');
}


const readline = createInterface({
	input: process.stdin,
	output: process.stdout,
});


function ask(question) {
	return new Promise((resolve) => {
		readline.question(
			question,
			resolve
		);
	});
}


try {
	const password =
		await ask('Password: ');

	if (
		password.length <
		MIN_PASSWORD_LENGTH
	) {
		throw new Error(
			`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`
		);
	}


	const confirmation =
		await ask(
			'Confirm password: '
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
		hashPassword(password);


	console.log(
		'\nPassword hash:\n'
	);

	console.log(
		passwordHash
	);

	console.log(
		'\nHash length:',
		passwordHash.length
	);

} catch (error) {
	console.error(
		'\nUnable to create password hash.'
	);

	console.error(
		error instanceof Error
			? error.message
			: String(error)
	);

	process.exitCode = 1;

} finally {
	readline.close();
}
