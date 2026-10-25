'use strict';
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

  if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
    return json(401, { ok: false, error: 'Invalid password' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(500, { ok: false, error: 'Missing AIRTABLE_TOKEN' });

  const formula = `NOT(OR({Status} = "Shipped", {Status} = "Delivered"))`;
  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&sort[0][field]=Timestamp&sort[0][direction]=asc`;

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
  } catch (err) {
    return json(502, { ok: false, error: err.message });
  }

  const orders = (data.records || []).map(r => {
    const f = r.fields;
    return {
      orderNumber: f['Order Number'] || '',
      source:      f['Source']       || '',
      timestamp:   f['Timestamp']    || '',
      name:        f['Name']         || '',
      phone:       f['Phone']        || '',
      email:       f['Email']        || '',
      address:     f['Address']      || '',
      street:      f['Street']       || '',
      city:        f['City']         || '',
      state:       f['State']        || '',
      zip:         f['ZIP']          || '',
      details:     f['Details']      || '',
      serializedCount: Number(f['Serialized Count']) || 0,
      subtotal:    f['Subtotal'] != null ? String(f['Subtotal']) : '',
      tax:         f['Tax']      != null ? String(f['Tax'])      : '',
      total:       f['Total']    != null ? String(f['Total'])    : '',
      payment:     f['Payment']       || '',
      status:      f['Status']        || 'Processing',
      tracking:    f['Tracking Number'] || '',
      imei:        f['IMEI']          || '',
    };
  });

  return json(200, { ok: true, orders });
};
