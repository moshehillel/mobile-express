const { PricingError, quoteCart } = require('./lib/pricing');

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
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

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return jsonResponse(500, { error: 'Stripe secret key is not configured' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  let quote;
  try {
    quote = quoteCart(payload.items);
  } catch (error) {
    const status = error instanceof PricingError ? error.status : 400;
    return jsonResponse(status, { error: error.message || 'Unable to price cart' });
  }

  const stripePayload = new URLSearchParams({
    amount: String(quote.totalCents),
    currency: 'usd',
    'automatic_payment_methods[enabled]': 'true',
  });

  if (payload.email) {
    stripePayload.set('receipt_email', String(payload.email));
  }

  try {
    const stripeResponse = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripePayload,
    });

    const stripeData = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return jsonResponse(stripeResponse.status, {
        error: stripeData.error?.message || 'Unable to create payment intent',
      });
    }

    return jsonResponse(200, {
      clientSecret: stripeData.client_secret,
      paymentIntentId: stripeData.id,
      amount: quote.totalCents,
      subtotal: quote.subtotal,
      tax: quote.tax,
      total: quote.total,
      serializedCount: quote.serializedCount,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error.message || 'Unable to reach Stripe',
    });
  }
};
