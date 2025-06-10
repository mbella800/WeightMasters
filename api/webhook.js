const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const { buffer } = require('micro');
const { GoogleSpreadsheet } = require('google-spreadsheet');

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

  try {
    const rawBody = await buffer(req);
    const sig = req.headers['stripe-signature'];

    console.log('🔍 Debug - Headers:', req.headers);
    console.log('🔑 Debug - Sheet Webhook Secret exists:', !!process.env.STRIPE_WEBHOOK_SECRET_SHEET);
    console.log('📝 Debug - Signature:', sig);
    console.log('📝 Debug - Raw body length:', rawBody.length);
    console.log('🔍 Debug - Raw body preview:', rawBody.toString().substring(0, 200));

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_SHEET
    );

    console.log('Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      await updateGoogleSheet(session);
      res.json({ received: true });
    } else {
      res.status(400).json({
        error: {
          message: 'Unhandled event type'
        }
      });
    }
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(400).json({
      error: {
        message: err.message
      }
    });
  }
} 