// netlify/functions/payfast-notify.js
//
// PayFast calls this URL server-to-server the moment a payment completes
// (the "ITN" — Instant Transaction Notification). We validate it's a real,
// completed PayFast payment, then email:
//   1. You (order details, for fulfilment)
//   2. The customer (a simple invoice/receipt)
//
// Set RESEND_API_KEY as a Netlify environment variable for extra safety —
// works as-is below too.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = 'Lifestyle Alchemist <orders@lifestylealchemist.co.za>';
const OWNER_EMAIL = 'tumiyoriko@outlook.com';

async function sendEmail({ to, subject, html }) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // PayFast posts application/x-www-form-urlencoded data.
  const params = new URLSearchParams(event.body);
  const data = Object.fromEntries(params.entries());

  // Validate this ITN is genuinely from PayFast before trusting it or
  // sending any email — otherwise anyone could POST fake "paid" data here.
  try {
    const validateRes = await fetch('https://www.payfast.co.za/eng/query/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: event.body
    });
    const validateText = (await validateRes.text()).trim();
    if (validateText !== 'VALID') {
      return { statusCode: 400, body: 'Invalid ITN' };
    }
  } catch (err) {
    return { statusCode: 502, body: 'Could not validate ITN' };
  }

  if (data.payment_status !== 'COMPLETE') {
    // Payment failed/cancelled/pending — acknowledge, but don't email anyone.
    return { statusCode: 200, body: 'OK — non-complete status ignored' };
  }

  const {
    pf_payment_id,
    amount_gross,
    item_name,
    name_first,
    name_last,
    email_address,
    custom_str1: phone,
    custom_str2: address,
    custom_str3: shippingNote
  } = data;

  const customerName = [name_first, name_last].filter(Boolean).join(' ');
  const orderDate = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

  // --- Email to you: order to fulfil ---
  const ownerHtml = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#4a2b3d;">New Only Fans order 🪭</h2>
      <p><strong>Payment ID:</strong> ${pf_payment_id}</p>
      <p><strong>Amount paid:</strong> R${amount_gross}</p>
      <p><strong>Order:</strong> ${item_name}</p>
      <p><strong>${shippingNote || ''}</strong></p>
      <hr>
      <h3>Customer details</h3>
      <p><strong>Name:</strong> ${customerName}</p>
      <p><strong>Phone:</strong> ${phone || '—'}</p>
      <p><strong>Email:</strong> ${email_address}</p>
      <p><strong>Delivery address:</strong> ${address || '—'}</p>
      <p style="color:#999;font-size:12px;margin-top:24px;">Received ${orderDate}</p>
    </div>
  `;

  // --- Email to customer: invoice/receipt ---
  const customerHtml = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fdfaf8;">
      <h2 style="color:#4a2b3d;">Thank you for your order, ${name_first || 'there'}! 🪭</h2>
      <p style="color:#555;">Here's your receipt from Lifestyle Alchemist — Only Fans.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td style="padding:8px 0;color:#777;">Order</td><td style="padding:8px 0;text-align:right;">${item_name}</td></tr>
        <tr><td style="padding:8px 0;color:#777;">${shippingNote || 'Shipping'}</td><td style="padding:8px 0;text-align:right;"></td></tr>
        <tr style="border-top:1px solid #e8def0;"><td style="padding:8px 0;font-weight:bold;">Total Paid</td><td style="padding:8px 0;text-align:right;font-weight:bold;">R${amount_gross}</td></tr>
      </table>
      <p style="margin-top:20px;color:#555;">Delivering to: ${address || '—'}</p>
      <p style="color:#555;">Payment reference: ${pf_payment_id}</p>
      <p style="margin-top:24px;color:#555;">We'll be in touch on WhatsApp to confirm collection or delivery details. Questions? Message us at
        <a href="https://wa.me/27794998013" style="color:#c9995f;">wa.me/27794998013</a>.
      </p>
      <p style="color:#999;font-size:12px;margin-top:30px;">Lifestyle Alchemist — Pretoria, South Africa</p>
    </div>
  `;

  try {
    await Promise.all([
      sendEmail({ to: OWNER_EMAIL, subject: `New order — R${amount_gross} — ${customerName}`, html: ownerHtml }),
      email_address ? sendEmail({ to: email_address, subject: 'Your Lifestyle Alchemist receipt', html: customerHtml }) : Promise.resolve()
    ]);
  } catch (err) {
    // Even if email sending fails, acknowledge the ITN so PayFast doesn't retry endlessly.
    console.error('Email send failed:', err);
  }

  return { statusCode: 200, body: 'OK' };
};
