// netlify/functions/shipping-rate.js
//
// Server-side proxy to the Shiplogic API (the platform behind The Courier Guy).
// Keeps the API key out of the browser. Called from only-fans/index.html.
//
// Set SHIPLOGIC_API_KEY as an environment variable in Netlify (Site settings →
// Environment variables) instead of leaving it in this file long-term if you
// want extra safety — but it works as-is below too.

const SHIPLOGIC_API_KEY = process.env.SHIPLOGIC_API_KEY;
const SHIPLOGIC_URL = 'https://api.shiplogic.com/v2/rates';

// TODO: confirm this against your exact PUDO locker / collection address —
// street_address and code (postal code) especially affect quote accuracy.
const COLLECTION_ADDRESS = {
  type: 'business',
  company: 'Lifestyle Alchemist — Only Fans',
  street_address: 'PUDO Locker, Equestria',
  local_area: 'Equestria',
  city: 'Pretoria',
  zone: 'Gauteng',
  country: 'ZA',
  code: '0184' // TODO: verify exact postal code for this collection point
};

exports.handler = async (event) => {
  if (!SHIPLOGIC_API_KEY) {
    console.error('shipping-rate: SHIPLOGIC_API_KEY environment variable is missing.');
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { street_address, local_area, city, zone, code, quantity } = payload;

  if (!code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Delivery postal code (code) is required' }) };
  }

  const qty = Math.max(1, Math.min(Number(quantity) || 1, 5));
  const parcel = {
    submitted_length_cm: 65,
    submitted_width_cm: 12,
    submitted_height_cm: 12,
    submitted_weight_kg: Math.min(0.3 * qty, 3)
  };

  const requestBody = {
    collection_address: COLLECTION_ADDRESS,
    delivery_address: {
      type: 'residential',
      company: '',
      street_address: street_address || '',
      local_area: local_area || '',
      city: city || '',
      zone: zone || '',
      country: 'ZA',
      code: code
    },
    parcels: [parcel]
  };

  try {
    const response = await fetch(SHIPLOGIC_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPLOGIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Shiplogic API error', details: data }) };
    }

    const rates = (data.rates || []).sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
    const cheapest = rates[0] || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cheapest: cheapest ? { rate: parseFloat(cheapest.rate), service: cheapest.service_level?.name || 'Courier Guy' } : null,
        rates: rates.map(r => ({ rate: parseFloat(r.rate), service: r.service_level?.name || 'Courier Guy' }))
      })
    };
  } catch (err) {
    console.error('shipping-rate function error:', err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to reach Shiplogic API', details: err.message }) };
  }
};
