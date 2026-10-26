// netlify/functions/payfast-sign.js
//
// Signs a PayFast checkout so PayFast accepts it even when a passphrase is
// set on the merchant account. The passphrase lives only in Netlify's
// environment variables (PAYFAST_PASSPHRASE) — never in the browser.
// If no passphrase is set, a plain signature is still valid.

const crypto = require('crypto');

// PHP-style urlencode, which is what PayFast uses to build signatures.
function pfEncode(value) {
  return encodeURIComponent(String(value).trim())
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  let fields;
  try {
    fields = JSON.parse(event.body || '{}').fields;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  if (!fields || typeof fields !== 'object') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  // Order matters: keep the same order the fields are posted in. Skip blanks.
  const parts = Object.entries(fields)
    .filter(([k, v]) => k !== 'signature' && v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${pfEncode(v)}`);

  let base = parts.join('&');
  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (passphrase) base += `&passphrase=${pfEncode(passphrase)}`;

  const signature = crypto.createHash('md5').update(base).digest('hex');
  return { statusCode: 200, headers, body: JSON.stringify({ signature }) };
};
