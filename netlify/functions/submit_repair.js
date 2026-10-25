const AIRTABLE_BASE_ID  = 'appTpfiIE7HJNTVEx';
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_REPAIRS_TABLE_ID || 'tblREPLACE_WITH_REPAIRS_TABLE_ID';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const json = (code, body) => ({ statusCode: code, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let data;
  try { data = JSON.parse(event.body); }
  catch { return json(400, { ok: false, error: 'Invalid request body' }); }

  const { name, phone, email, address, street, city, state, zip, deviceMake, deviceModel, repairs, estimatedTotal, notes } = data;

  if (!name || !phone || !email || !address || !deviceMake || !deviceModel || !repairs) {
    return json(400, { ok: false, error: 'Missing required fields' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(500, { ok: false, error: 'Server configuration error' });

  const record = {
    fields: {
      'Name':            name,
      'Phone':           phone,
      'Email':           email,
      'Shipping Address': address,
      'Street':          street  || '',
      'City':            city    || '',
      'State':           state   || '',
      'ZIP':             zip     || '',
      'Device Make':     deviceMake,
      'Device Model':    deviceModel,
      'Repairs':         repairs,
      'Estimated Total': estimatedTotal ? Number(estimatedTotal) : 0,
      'Notes':           notes || '',
      'Status':          'New',
      'Submitted':       new Date().toISOString(),
    }
  };

  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [record] }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('Airtable error:', err);
    return json(500, { ok: false, error: 'Failed to save repair request' });
  }

  return json(200, { ok: true });
};
