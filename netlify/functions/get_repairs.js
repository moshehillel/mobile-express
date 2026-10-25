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

  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token)           return json(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });
  if (!AIRTABLE_TABLE_ID) return json(500, { ok: false, error: 'Missing AIRTABLE_REPAIRS_TABLE_ID' });

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
              `?sort[0][field]=Submitted&sort[0][direction]=desc`;

  let data;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return json(502, { ok: false, error: `Airtable error: ${text}` });
    }
    data = await resp.json();
  } catch (e) {
    return json(502, { ok: false, error: e.message });
  }

  const repairs = (data.records || []).map(r => {
    const f = r.fields;
    return {
      recordId:       r.id,
      name:           f['Name']             || '',
      phone:          f['Phone']            || '',
      email:          f['Email']            || '',
      address:        f['Shipping Address'] || '',
      street:         f['Street']           || '',
      city:           f['City']             || '',
      state:          f['State']            || '',
      zip:            f['ZIP']              || '',
      deviceMake:     f['Device Make']      || '',
      deviceModel:    f['Device Model']     || '',
      repairs:        f['Repairs']          || '',
      estimatedTotal: f['Estimated Total']  != null ? String(f['Estimated Total']) : '',
      notes:          f['Notes']            || '',
      status:         f['Status']           || 'New',
      submitted:      f['Submitted']        || '',
      tracking:       f['Tracking Number']  || '',
      labelUrl:       f['Label URL']        || '',
    };
  });

  return json(200, { ok: true, repairs });
};
