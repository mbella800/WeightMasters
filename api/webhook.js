const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buffer } = require('micro');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// Disable body parsing, we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getGoogleSheetClient() {
  try {
    const doc = new GoogleSpreadsheet(process.env.DEFAULT_SHEET_ID);
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_KEY);
    await doc.useServiceAccountAuth(credentials);
    await doc.loadInfo();
    return doc;
  } catch (error) {
    console.error('Error initializing Google Sheets:', error);
    return null;
  }
}

async function updateGoogleSheet(session) {
  try {
    const doc = await getGoogleSheetClient();
    if (!doc) {
      throw new Error('Failed to initialize Google Sheets client');
    }

    const sheet = doc.sheetsByIndex[0];
    const customer = session.customer_details;
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product']
    });

    const items = lineItems.data.map(item => ({
      name: item.description,
      quantity: item.quantity,
      price: (item.price.unit_amount / 100).toFixed(2).replace('.', ',')
    }));

    // Zoek verzendkosten line item
    const shippingLine = lineItems.data.find(item => item.description && item.description.toLowerCase().includes('verzendkosten'));
    const shippingFee = shippingLine ? shippingLine.amount_total || (shippingLine.amount_subtotal || 0) : 0;
    const shippingFeeStr = (shippingFee / 100).toFixed(2).replace('.', ',');
    console.log('📦 SHIPPING DEBUG SHEET-WEBHOOK (line item):', { shippingFee, shippingFeeStr });

    const orderData = {
      'Order ID': session.payment_intent,
      'Date': new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
      'Customer Name': customer.name || '',
      'Email': customer.email || '',
      'Address': `${customer.address?.line1 || ''} ${customer.address?.line2 || ''}`,
      'City': customer.address?.city || '',
      'Postal Code': customer.address?.postal_code || '',
      'Country': customer.address?.country || '',
      'Products': items.map(item => `${item.name} (${item.quantity}x €${item.price})`).join(', '),
      'Subtotal': (session.amount_subtotal / 100).toFixed(2).replace('.', ','),
      'Shipping': shippingFeeStr,
      'Total': (session.amount_total / 100).toFixed(2).replace('.', ',')
    };

    await sheet.addRow(orderData);
    console.log('✅ Order added to Google Sheet');
    return true;
  } catch (error) {
    console.error('❌ Error updating Google Sheet:', error);
    throw error;
  }
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