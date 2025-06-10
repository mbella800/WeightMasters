const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

// Disable body parsing, we need the raw body for signature verification
const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(
      typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    );
  }
  return Buffer.concat(chunks);
}

async function sheetWebhook(event) {
  try {
    const session = event.data.object;
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    // Get customer details
    const customer_email = session.customer_details?.email || '';
    const customer_name = session.customer_details?.name || '';

    // Format line items
    const items = lineItems.data.map(item => ({
      name: item.description,
      quantity: item.quantity,
      price: (item.price.unit_amount / 100).toFixed(2)
    }));

    // Calculate totals
    const subtotal = session.amount_subtotal / 100;
    const shipping = session.total_details?.amount_shipping / 100 || 0;
    const total = session.amount_total / 100;

    // Prepare row data
    const timestamp = new Date().toISOString();
    const orderId = session.payment_intent;
    const itemsList = items.map(item => 
      `${item.name} (${item.quantity}x €${item.price})`
    ).join(', ');

    const rowData = [
      timestamp,              // Timestamp
      orderId,               // Order ID
      customer_name,         // Name
      customer_email,        // Email
      itemsList,            // Products
      subtotal.toFixed(2),  // Subtotal
      shipping.toFixed(2),  // Shipping
      total.toFixed(2),     // Total
    ];

    // Google Sheets API setup
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const range = 'Orders!A:H';

    // Append the row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData],
      },
    });

    console.log('✅ Order added to Google Sheet');
    return true;
  } catch (error) {
    console.error('❌ Error updating sheet:', error);
    throw error;
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  console.log('🔍 Debug - Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔑 Debug - Webhook Secret exists:', !!webhookSecret);
  console.log('📝 Debug - Signature:', sig);

  if (!webhookSecret) {
    console.error('❌ Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const buf = await buffer(req);
    console.log('📝 Debug - Raw body length:', buf.length);
    console.log('🔍 Debug - Raw body preview:', buf.toString().substring(0, 100));

    // Log the exact webhook secret being used
    console.log('🔑 Debug - Webhook secret length:', webhookSecret.length);
    console.log('🔑 Debug - Webhook secret preview:', webhookSecret.substring(0, 5) + '...');

    const event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);

    console.log('✅ Success: Webhook signature verified');
    console.log('Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      await sheetWebhook(event);
      console.log('📊 Google Sheet updated successfully');
      res.status(200).json({ received: true });
    } else {
      console.log('⚠️ Unhandled event type:', event.type);
      res.status(400).json({
        error: {
          message: 'Unhandled event type'
        }
      });
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Stack trace:', err.stack);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
}

module.exports = handler;
module.exports.config = config; 