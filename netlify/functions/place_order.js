const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { PricingError, quoteCart } = require('./lib/pricing');

const AIRTABLE_BASE_ID = 'appTpfiIE7HJNTVEx';
const AIRTABLE_TABLE_ID = 'tblWYJmi6rf9olmdj';

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

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const generateOrderNumber = () => String(crypto.randomInt(100000, 1000000));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: responseHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || '').trim();
  const payment = String(payload.payment || '').trim();
  const address = String(payload.address || '').trim();
  const street  = String(payload.street  || '').trim();
  const city    = String(payload.city    || '').trim();
  const state   = String(payload.state   || '').trim();
  const zip     = String(payload.zip     || '').trim();
  const buyerEmail = String(payload.email || '').trim();
  const clientItems = Array.isArray(payload.items) ? payload.items : [];

  let quote;
  try {
    quote = quoteCart(clientItems);
  } catch (error) {
    const status = error instanceof PricingError ? error.status : 400;
    return jsonResponse(status, { ok: false, error: error.message || 'Unable to price cart' });
  }

  const details = quote.details;
  const items = quote.lines.map((line) => {
    const match = clientItems.find((item) =>
      String(item.id) === line.id && String(item.variant || '') === String(line.variant || '')
    );
    const image = match && /^https:\/\//.test(String(match.image || '')) ? String(match.image) : '';
    const link = match && /^https:\/\//.test(String(match.link || '')) ? String(match.link) : '';
    return {
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      image,
      link,
    };
  });
  const subtotal = quote.subtotal;
  const tax = quote.tax;
  const total = quote.total;
  const serializedCount = quote.serializedCount;

  if (!phone || !details || !payment) {
    return jsonResponse(400, {
      ok: false,
      error: 'Missing required params. Need: phone, details, payment',
      got: {
        phone: !!phone,
        details: !!details,
        payment: !!payment,
        address: !!address,
        email: !!buyerEmail,
      },
    });
  }

  if (!/^pi_[A-Za-z0-9]+$/.test(payment)) {
    return jsonResponse(400, { ok: false, error: 'Invalid payment reference' });
  }

  const { GMAIL_USER, GMAIL_APP_PASS, AIRTABLE_TOKEN, STRIPE_SECRET_KEY } = process.env;
  const sellerEmail = process.env.SELLER_EMAIL || GMAIL_USER;

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse(500, { ok: false, error: 'Missing env var STRIPE_SECRET_KEY' });
  }

  try {
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(payment)}`,
      { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const paymentIntent = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return jsonResponse(402, {
        ok: false,
        error: paymentIntent.error?.message || 'Unable to verify payment',
      });
    }
    if (paymentIntent.status !== 'succeeded' || paymentIntent.currency !== 'usd' || paymentIntent.amount !== quote.totalCents) {
      return jsonResponse(402, { ok: false, error: 'Payment does not match this order' });
    }
  } catch (err) {
    return jsonResponse(502, { ok: false, error: `Payment verification failed: ${err.message}` });
  }

  if (!AIRTABLE_TOKEN) {
    return jsonResponse(500, { ok: false, error: 'Missing env var AIRTABLE_TOKEN' });
  }

  if (!GMAIL_USER || !GMAIL_APP_PASS) {
    return jsonResponse(500, { ok: false, error: 'Missing env vars GMAIL_USER and/or GMAIL_APP_PASS' });
  }

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const statusMessage = 'Order confirmed. Processing and shipping will begin shortly.';

  const paymentFormula = `{Payment} = "${payment.replace(/"/g, '')}"`;
  const existingUrl =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(paymentFormula)}&maxRecords=1`;

  try {
    const existingResp = await fetch(existingUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!existingResp.ok) {
      const text = await existingResp.text();
      return jsonResponse(502, { ok: false, error: `Failed to check existing order: ${text}` });
    }
    const existingData = await existingResp.json();
    const existing = existingData.records && existingData.records[0];
    if (existing) {
      return jsonResponse(200, {
        ok: true,
        orderNumber: String(existing.fields['Order Number'] || ''),
        wrote_to_airtable: true,
        already_saved: true,
      });
    }
  } catch (err) {
    return jsonResponse(502, { ok: false, error: `Airtable error: ${err.message}` });
  }

  const orderNumber = generateOrderNumber();

  // 1) Write to Airtable
  try {
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        },
        body: JSON.stringify({
          fields: {
            'Order Number': orderNumber,
            'Source': 'Web',
            'Timestamp': timestamp,
            'Name': name,
            'Phone': phone,
            'Email': buyerEmail,
            'Address': address,
            'Street': street,
            'City': city,
            'State': state,
            'ZIP': zip,
            'Details': details,
            'Serialized Count': serializedCount,
            'Subtotal': parseFloat(subtotal) || 0,
            'Tax': parseFloat(tax) || 0,
            'Total': parseFloat(total) || 0,
            'Payment': payment,
            'Status': 'Processing',
          },
        }),
      }
    );

    if (!airtableResponse.ok) {
      const text = await airtableResponse.text();
      return jsonResponse(502, { ok: false, error: `Failed to save order to Airtable: ${text}` });
    }
  } catch (err) {
    return jsonResponse(502, { ok: false, error: `Airtable error: ${err.message}` });
  }

  // 2) Send emails
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  });

  const safeOrderNumber = escapeHtml(orderNumber);
  const safeDetails = escapeHtml(details);
  const safeAddress = escapeHtml(address);
  const safePayment = escapeHtml(payment);
  const safeStatus = escapeHtml(statusMessage);
  const safePhone = escapeHtml(phone);
  const safeName = escapeHtml(name || 'Not provided');
  const safeBuyerEmail = escapeHtml(buyerEmail || 'Not provided');

  let buyerEmailSent = false;
  let buyerEmailMessageId = null;

  if (buyerEmail) {
    try {
      const itemRows = items && items.length ? items.map(item => `
          <tr>
            <td style="padding: 14px 0; border-bottom: 1px solid #e8eeeb;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr>
                  <td width="76" style="vertical-align: top;">
                    <img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.name || '')}" width="64" style="display:block; width:64px; height:64px; border-radius:10px; object-fit:cover; background:#eef4f1;">
                  </td>
                  <td style="vertical-align: top; padding-left: 12px;">
                    <a href="${escapeHtml(item.link || '#')}" style="color:#0d5c4b; font-size:15px; font-weight:700; text-decoration:none;">${escapeHtml(item.name || '')}</a>
                    <p style="margin:6px 0 0; color:#54615d; font-size:13px;">Quantity: ${Number(item.quantity || 1)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `).join('') : `
          <tr>
            <td style="padding: 14px 0; color:#1f2b33; border-bottom: 1px solid #e8eeeb;">${safeDetails || 'No item details provided'}</td>
          </tr>
        `;

      const buyerEmailHtml = `
          <div style="margin:0; padding:0; background:#f4f8f6;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; background:#f4f8f6;">
              <tr>
                <td align="center" style="padding:28px 14px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; max-width:640px; background:#ffffff; border:1px solid #dfe8e4; border-radius:18px; overflow:hidden; font-family:Arial, sans-serif; color:#0b1d24;">
                    <tr>
                      <td style="background:#0d5c4b; padding:28px 28px 24px; color:#ffffff;">
                        <p style="margin:0 0 8px; font-size:13px; letter-spacing:1px; text-transform:uppercase; color:#cfe7df;">Mobile Express NY</p>
                        <h1 style="margin:0; font-size:28px; line-height:1.2;">Thanks for your order</h1>
                        <p style="margin:10px 0 0; color:#edf8f5; font-size:15px;">We received it and are preparing everything for shipment.</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:24px 28px 8px;">
                        <div style="background:#ecf5f2; border:1px solid #cce1da; border-radius:14px; padding:18px;">
                          <p style="margin:0; color:#52635e; font-size:13px; text-transform:uppercase; letter-spacing:.8px;">Order number</p>
                          <p style="margin:6px 0 0; color:#0d5c4b; font-size:34px; line-height:1; font-weight:800;">${safeOrderNumber}</p>
                          <p style="margin:10px 0 0; color:#52635e; font-size:13px;">Use this 6-digit number to check your order status online.</p>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 28px 0;">
                        <h2 style="margin:0 0 12px; font-size:18px; color:#0b1d24;">Order Summary</h2>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                          <tr><td style="padding:8px 0; color:#52635e;">Order date</td><td align="right" style="padding:8px 0; color:#0b1d24; font-weight:600;">${escapeHtml(timestamp)}</td></tr>
                          <tr><td style="padding:8px 0; color:#52635e;">Subtotal</td><td align="right" style="padding:8px 0; color:#0b1d24; font-weight:600;">$${subtotal}</td></tr>
                          <tr><td style="padding:8px 0; color:#52635e;">Sales tax</td><td align="right" style="padding:8px 0; color:#0b1d24; font-weight:600;">$${tax}</td></tr>
                          <tr><td style="padding:12px 0; color:#0b1d24; font-size:18px; border-top:1px solid #e8eeeb;"><strong>Total</strong></td><td align="right" style="padding:12px 0; color:#0d5c4b; font-size:20px; font-weight:800; border-top:1px solid #e8eeeb;">$${total}</td></tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 28px 0;">
                        <h2 style="margin:0 0 6px; font-size:18px; color:#0b1d24;">Items</h2>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${itemRows}</table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:22px 28px 0;">
                        <div style="background:#fffdf8; border:1px solid #eee3ce; border-radius:14px; padding:16px;">
                          <h2 style="margin:0 0 8px; font-size:17px; color:#0b1d24;">Shipping Address</h2>
                          <p style="margin:0; color:#1f2b33; line-height:1.5;">${safeAddress || 'Not provided'}</p>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 28px 0;">
                        <div style="background:#f7fbfa; border:1px solid #dfe8e4; border-radius:14px; padding:16px;">
                          <h2 style="margin:0 0 8px; font-size:17px; color:#0b1d24;">Current Status</h2>
                          <p style="margin:0; color:#1f2b33; line-height:1.5;">${safeStatus}</p>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:22px 28px 26px;">
                        <p style="margin:0 0 12px; color:#52635e; font-size:14px; line-height:1.5;">Payment ID: ${safePayment}</p>
                        <p style="margin:0; color:#52635e; font-size:14px; line-height:1.6;">We'll send another email when your order ships. Questions? Reply to this email, write to <a href="mailto:support@mobileexpressny.com" style="color:#0d5c4b; font-weight:700;">support@mobileexpressny.com</a>, or call <a href="tel:+18456663989" style="color:#0d5c4b; font-weight:700;">(845) 666-3989</a>.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        `;

      const buyerResp = await transporter.sendMail({
        from: GMAIL_USER,
        to: buyerEmail,
        subject: `Mobile Express NY - Order Confirmation #${orderNumber}`,
        html: buyerEmailHtml,
        text: `Mobile Express NY - Order Confirmation

Order Number: ${orderNumber}
Order Date: ${timestamp}

Items:
${items && items.length ? items.map(i => `- ${i.name} x${i.quantity} - ${i.link}`).join('\n') : details}

Subtotal: $${subtotal}
Sales tax: $${tax}
Total: $${total}
Payment ID: ${payment}

Shipping Address:
${address || 'Not provided'}

Status:
${statusMessage}

We will notify you when your order ships. For questions, contact support@mobileexpressny.com or call (845) 666-3989.
`,
      });
      buyerEmailSent = true;
      buyerEmailMessageId = buyerResp.messageId;
    } catch (error) {
      console.error('Failed to send buyer email:', error);
    }
  }

  let sellerEmailSent = false;
  let sellerEmailMessageId = null;
  try {
  const sellerEmailResp = await transporter.sendMail({
    from: GMAIL_USER,
    to: sellerEmail,
    subject: `New Web Order #${orderNumber} - $${total}`,
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f15e2c;">New Web Order Received</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Customer Information</h3>
            <p><strong>Order Number:</strong> ${safeOrderNumber}</p>
            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Phone:</strong> ${safePhone}</p>
            <p><strong>Email:</strong> ${safeBuyerEmail}</p>
            <p><strong>Order Date:</strong> ${escapeHtml(timestamp)}</p>
          </div>
          <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Order Details</h3>
            <p><strong>Items:</strong> ${safeDetails}</p>
            <p><strong>Subtotal:</strong> $${subtotal}</p>
            <p><strong>Sales tax:</strong> $${tax}</p>
            <p><strong>Total:</strong> <strong style="color: #0d5c4b;">$${total}</strong></p>
            <p><strong>Payment ID:</strong> ${safePayment}</p>
          </div>
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Shipping Address</h3>
            <p>${safeAddress || 'Not provided'}</p>
          </div>
        </div>
      `,
    text: `New Web Order Received - Mobile Express NY

Order Number: ${orderNumber}
Name: ${name || 'Not provided'}
Phone: ${phone}
Email: ${buyerEmail || 'Not provided'}
Order Date: ${timestamp}

Items: ${details}
Subtotal: $${subtotal}
Sales tax: $${tax}
Total: $${total}
Payment ID: ${payment}

Shipping Address:
${address || 'Not provided'}
`,
  });
    sellerEmailSent = true;
    sellerEmailMessageId = sellerEmailResp.messageId;
  } catch (error) {
    console.error('Failed to send seller email:', error);
  }

  return jsonResponse(200, {
    ok: true,
    orderNumber,
    wrote_to_airtable: true,
    buyer_email_sent: buyerEmailSent,
    buyer_email_message_id: buyerEmailMessageId,
    seller_email_sent: sellerEmailSent,
    seller_email_message_id: sellerEmailMessageId,
    status_message: statusMessage,
  });
};
