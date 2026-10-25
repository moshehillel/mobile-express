const AIRTABLE_BASE_ID = 'appTpfiIE7HJNTVEx';
const AIRTABLE_TABLE_ID = 'tblWYJmi6rf9olmdj';

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  const params = event.queryStringParameters || {};
  const phone = (params.phone || '').trim();
  const orderNumber = (params.orderNumber || '').trim();

  if (!phone && !orderNumber) {
    return jsonResponse(400, { ok: false, error: 'Provide phone or orderNumber' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    return jsonResponse(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });
  }

  let formula;
  if (orderNumber) {
    formula = `{Order Number} = "${orderNumber.replace(/"/g, '')}"`;
  } else {
    // Normalize: strip non-digits, take last 10 digits to match any format (+1..., 1..., plain 10-digit)
    const digits = phone.replace(/\D/g, '').slice(-10);
    formula = `RIGHT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Phone}, "+", ""), "-", ""), " ", ""), 10) = "${digits}"`;
  }

  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&sort[0][field]=Timestamp&sort[0][direction]=desc&maxRecords=10`;

  let data;
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return jsonResponse(502, { ok: false, error: `Airtable error: ${text}` });
    }
    data = await resp.json();
  } catch (err) {
    return jsonResponse(502, { ok: false, error: err.message });
  }

  if (!data.records || data.records.length === 0) {
    return jsonResponse(200, { ok: true, found: false });
  }

  const orders = data.records.map((r) => {
    const f = r.fields;
    return {
      orderNumber: f['Order Number'] || '',
      source: f['Source'] || '',
      timestamp: f['Timestamp'] || '',
      name: f['Name'] || '',
      phone: f['Phone'] || '',
      email: f['Email'] || '',
      address: f['Address'] || '',
      street:  f['Street']  || '',
      city:    f['City']    || '',
      state:   f['State']   || '',
      zip:     f['ZIP']     || '',
      details: f['Details'] || '',
      serializedCount: Number(f['Serialized Count']) || 0,
      subtotal: f['Subtotal'] != null ? String(f['Subtotal']) : '',
      tax: f['Tax'] != null ? String(f['Tax']) : '',
      total: f['Total'] != null ? String(f['Total']) : '',
      payment: f['Payment'] || '',
      status: f['Status'] || 'Processing',
      tracking: f['Tracking Number'] || '',
      imei: f['IMEI'] || '',
    };
  });

  // Flat fields for Twilio Studio say_play_2 widget compatibility
  const first = orders[0];
  const ttsStatus = first.tracking
    ? `${first.status}. Your tracking number is ${first.tracking}`
    : first.status;

  // Spoken summary of every order on file, newest first (for the IVR readback)
  const ordinal = (n) => ['most recent', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] || `number ${n + 1}`;
  const orderLine = (o, i) => {
    const which = orders.length === 1 ? 'Your order' : `Your ${ordinal(i)} order`;
    const track = o.tracking ? `, tracking number ${o.tracking}` : '';
    return `${which}, for ${o.details || 'your items'}, total ${o.total} dollars, is ${o.status}${track}.`;
  };
  const summary =
    (orders.length === 1
      ? 'You have one order on file. '
      : `You have ${orders.length} orders on file. `) +
    orders.map(orderLine).join(' ');

  return jsonResponse(200, {
    ok: true,
    found: true,
    orders,
    // used by Twilio Studio {{widgets.http_1.parsed.X}}
    summary,
    details: first.details,
    total: first.total,
    status: ttsStatus,
  });
};
