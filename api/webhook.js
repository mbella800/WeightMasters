const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const { buffer } = require('micro');

// Disable body parsing, we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function sheetWebhook(event) {
  if (event.type === "checkout.session.completed") {
    try {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      const customer_email = session.customer_details?.email || "";
      const customer_name = session.customer_details?.name || "";
      const shippingAmount = session.total_details?.amount_shipping || 0;

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { expand: ['data.price.product'] }
      );

      const items = lineItems.data.filter(item => !item.description?.toLowerCase().includes('verzend'));

      // Add to Google Sheet
      const values = [
        [
          new Date().toISOString(),
          session.payment_intent,
          customer_email,
          customer_name,
          items.map(item => `${item.quantity}x ${item.description}`).join(", "),
          (session.amount_subtotal / 100).toFixed(2),
          (shippingAmount / 100).toFixed(2),
          (session.amount_total / 100).toFixed(2)
        ]
      ];

      console.log('📝 Adding order to Google Sheet...');
      console.log('Values to be added:', values);
      console.log('Shipping amount from session:', (shippingAmount / 100).toFixed(2));

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.DEFAULT_SHEET_ID;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Orders!A:H',
        valueInputOption: 'USER_ENTERED',
        resource: { values },
      });

      console.log('✅ Order added to Google Sheet successfully');
      return { success: true };

    } catch (error) {
      console.error('❌ Error processing order:', error);
      throw error;
    }
  }

  return { success: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('❌ Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    // Get the raw body using micro's buffer function
    const rawBody = await buffer(req);
    console.log('📝 Raw body length:', rawBody.length);
    
    // Pass the raw buffer to constructEvent
    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    console.log('✅ Sheet webhook signature verified');
    
    await sheetWebhook(event);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).json({
      error: {
        message: err.message
      }
    });
  }
} 