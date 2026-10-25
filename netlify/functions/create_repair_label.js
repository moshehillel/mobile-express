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

  const { password, recordId, name, phone, street, city, state, zip } = body;

  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  const shippoKey     = process.env.SHIPPO_API_KEY;
  const airtableToken = process.env.AIRTABLE_TOKEN;

  if (!shippoKey)       return json(500, { ok: false, error: 'Missing SHIPPO_API_KEY' });
  if (!airtableToken)   return json(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });
  if (!AIRTABLE_TABLE_ID) return json(500, { ok: false, error: 'Missing AIRTABLE_REPAIRS_TABLE_ID' });
  if (!recordId || !street || !city || !state || !zip) {
    return json(400, { ok: false, error: 'Missing required fields' });
  }

  const shippoHeaders = {
    Authorization: `ShippoToken ${shippoKey}`,
    'Content-Type': 'application/json',
  };

  // Return label: FROM warehouse → TO customer
  const shipmentResp = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers: shippoHeaders,
    body: JSON.stringify({
      address_from: {
        name:    process.env.SENDER_NAME   || 'Mobile Express NY',
        street1: process.env.SENDER_STREET || '',
        city:    process.env.SENDER_CITY   || '',
        state:   process.env.SENDER_STATE  || '',
        zip:     process.env.SENDER_ZIP    || '',
        country: 'US',
        phone:   process.env.SENDER_PHONE  || '',
        email:   process.env.SENDER_EMAIL  || '',
      },
      address_to: {
        name:    name || 'Customer',
        street1: street,
        city,
        state,
        zip,
        country: 'US',
        phone:   phone || '',
      },
      parcels: [{
        length: '10',
        width:  '7',
        height: '2',
        distance_unit: 'in',
        weight: '1',
        mass_unit: 'lb',
      }],
      async: false,
    }),
  });

  if (!shipmentResp.ok) {
    const err = await shipmentResp.text();
    return json(502, { ok: false, error: `Shippo shipment error: ${err}` });
  }

  const shipment   = await shipmentResp.json();
  const validRates = (shipment.rates || []).filter(r => r.object_status === 'VALID');
  if (!validRates.length) return json(502, { ok: false, error: 'No valid shipping rates for this address' });

  validRates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
  const rate = validRates[0];

  const txResp = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers: shippoHeaders,
    body: JSON.stringify({ rate: rate.object_id, label_file_type: 'PDF', async: false }),
  });

  if (!txResp.ok) {
    const err = await txResp.text();
    return json(502, { ok: false, error: `Shippo transaction error: ${err}` });
  }

  const tx = await txResp.json();
  if (tx.status !== 'SUCCESS') {
    const msgs = (tx.messages || []).map(m => m.text).join('; ');
    return json(502, { ok: false, error: `Label failed: ${msgs || tx.status}` });
  }

  const trackingNumber = tx.tracking_number;
  const labelUrl       = tx.label_url;
  const carrier        = rate.provider || '';
  const service        = (rate.servicelevel && rate.servicelevel.name) || '';

  // Update Airtable repair record
  const patchResp = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${airtableToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          'Status':          'Shipped Back',
          'Tracking Number': trackingNumber,
          'Label URL':       labelUrl,
          'Street':          street,
          'City':            city,
          'State':           state,
          'ZIP':             zip,
        },
      }),
    }
  );

  if (!patchResp.ok) {
    const err = await patchResp.text();
    return json(502, { ok: false, error: `Airtable update error: ${err}` });
  }

  return json(200, { ok: true, trackingNumber, labelUrl, carrier, service });
};
