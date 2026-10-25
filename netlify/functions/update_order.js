const AIRTABLE_BASE_ID = 'appTpfiIE7HJNTVEx';
const AIRTABLE_TABLE_ID = 'tblWYJmi6rf9olmdj';

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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const { password, verify, orderNumber, status, imei, tracking } = body;

  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  // Login verify — just check password, no update needed
  if (verify) return json(200, { ok: true });

  if (!orderNumber) return json(400, { ok: false, error: 'orderNumber required' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });

  // Look up the Airtable record ID by order number
  const formula = `{Order Number} = "${orderNumber.replace(/"/g, '')}"`;
  const searchUrl =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!searchResp.ok) {
    const text = await searchResp.text();
    return json(502, { ok: false, error: `Airtable search error: ${text}` });
  }

  const searchData = await searchResp.json();
  if (!searchData.records || searchData.records.length === 0) {
    return json(200, { ok: false, error: 'Order not found' });
  }

  const recordId = searchData.records[0].id;

  // Only update the fields that were provided
  const fields = {};
  if (status !== undefined && status !== null) fields['Status'] = status;
  if (imei !== undefined && imei !== null) fields['IMEI'] = imei;
  if (tracking !== undefined && tracking !== null) fields['Tracking Number'] = tracking;

  if (Object.keys(fields).length === 0) {
    return json(400, { ok: false, error: 'Nothing to update' });
  }

  const patchUrl =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`;

  const patchResp = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (!patchResp.ok) {
    const text = await patchResp.text();
    return json(502, { ok: false, error: `Airtable update error: ${text}` });
  }

  return json(200, { ok: true });
};
