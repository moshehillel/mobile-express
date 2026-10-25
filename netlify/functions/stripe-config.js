const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: responseHeaders,
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: responseHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const publishableKey = String(process.env.STRIPE_PUBLISHABLE_KEY || '');
  if (!publishableKey.startsWith('pk_')) {
    return jsonResponse(500, { error: 'Stripe publishable key is not configured' });
  }

  return jsonResponse(200, { publishableKey });
};
