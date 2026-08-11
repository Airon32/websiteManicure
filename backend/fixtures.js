const crypto = require('node:crypto');

function createTestCredential() {
    return crypto.randomBytes(32).toString('base64url');
}

module.exports = { createTestCredential };
