const AIRTABLE_BASE_ID  = 'appTpfiIE7HJNTVEx';
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_REPAIRS_TABLE_ID || '';

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

  const { password, recordId, status, notes, street, city, state, zip, tracking, labelUrl } = body;

  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  if (!recordId) return json(400, { ok: false, error: 'recordId required' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token)             return json(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });
  if (!AIRTABLE_TABLE_ID) return json(500, { ok: false, error: 'Missing AIRTABLE_REPAIRS_TABLE_ID' });

  const fields = {};
  if (status   != null) fields['Status']           = status;
  if (notes    != null) fields['Notes']            = notes;
  if (street   != null) fields['Street']           = street;
  if (city     != null) fields['City']             = city;
  if (state    != null) fields['State']            = state;
  if (zip      != null) fields['ZIP']              = zip;
  if (tracking != null) fields['Tracking Number']  = tracking;
  if (labelUrl != null) fields['Label URL']        = labelUrl;

  if (!Object.keys(fields).length) return json(400, { ok: false, error: 'Nothing to update' });

  const patchResp = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  );

  if (!patchResp.ok) {
    const err = await patchResp.text();
    return json(502, { ok: false, error: `Airtable update error: ${err}` });
  }

  return json(200, { ok: true });
};
