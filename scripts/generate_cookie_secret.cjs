const crypto = require('crypto');
const secret = crypto
	.randomBytes(32)
	.toString('base64')
	.replace(/=/g, '')
	.replace(/\+/g, '-')
	.replace(/\//g, '_');
console.log(secret);
