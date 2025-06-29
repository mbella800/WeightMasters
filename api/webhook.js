const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buffer } = require('micro');
const { google } = require('googleapis');

// Disable body parsing, we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Zet hier de URL van je Cloud Function
const CLOUD_FUNCTION_URL = 'https://logordertosheet-351445746762.europe-west1.run.app';

function buildOrderData(session, lineItems) {
  const customer = session.customer_details;
  // Zoek verzendkosten line item
  const shippingLine = lineItems.data.find(item => item.description && item.description.toLowerCase().includes('verzendkosten'));
  const shippingFee = shippingLine ? shippingLine.amount_total || (shippingLine.amount_subtotal || 0) : 0;
  const shippingFeeStr = (shippingFee / 100).toFixed(2).replace('.', ',');

  // Bereken originele bedrag, betaald bedrag, korting en korting percentage (alleen producten, geen verzendkosten)
  let originalTotal = 0;
  let paidTotal = 0;
  let totalDiscount = 0;
  let discountPercentage = 0;
  const productLineItems = lineItems.data.filter(item => !(item.description && item.description.toLowerCase().includes('verzend')));
  productLineItems.forEach(item => {
    const quantity = item.quantity || 1;
    const original = item.price?.product?.metadata?.originalPrice ? parseFloat(item.price.product.metadata.originalPrice) : (item.price.unit_amount / 100);
    const paid = item.price.unit_amount / 100;
    originalTotal += original * quantity;
    paidTotal += paid * quantity;
  });
  totalDiscount = originalTotal - paidTotal;
  discountPercentage = originalTotal > 0 ? Math.round((totalDiscount / originalTotal) * 100) : 0;

  return {
    'Order ID': session.payment_intent,
    'Date': new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
    'Customer Name': customer.name || '',
    'Email': customer.email || '',
    'Phone': customer.phone || '',
    'Country': customer.address?.country || '',
    'City': customer.address?.city || '',
    'Postal Code': customer.address?.postal_code || '',
    'Address': `${customer.address?.line1 || ''} ${customer.address?.line2 || ''}`.trim(),
    'Original Amount': originalTotal.toFixed(2).replace('.', ','),
    'Paid Amount': paidTotal.toFixed(2).replace('.', ','),
    'Discount': totalDiscount > 0 ? totalDiscount.toFixed(2).replace('.', ',') : '',
    'Discount %': totalDiscount > 0 ? discountPercentage + '%' : '',
    'Products': productLineItems.map(item => `${item.description} (${item.quantity}x €${(item.price.unit_amount / 100).toFixed(2).replace('.', ',')})`).join(', '),
    'Subtotal': (session.amount_subtotal / 100).toFixed(2).replace('.', ','),
    'Shipping': shippingFeeStr,
    'Total': (session.amount_total / 100).toFixed(2).replace('.', ','),
    'Trackingslink': ''
  };
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
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product']
      });
      const orderData = buildOrderData(session, lineItems);

      // Google Sheets integratie direct
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_KEY);
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
      );
      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = '1OCFsr_vBZX5GodN0Bp3EPq45RHCL5PXD-g3ExkD0VAU';
      const sheetName = 'Bestellingen';
      const values = [
        orderData['Order ID'] || '',
        orderData['Date'] || '',
        orderData['Customer Name'] || '',
        orderData['Email'] || '',
        orderData['Phone'] || '',
        orderData['Country'] || '',
        orderData['City'] || '',
        orderData['Postal Code'] || '',
        orderData['Address'] || '',
        orderData['Original Amount'] || '',
        orderData['Paid Amount'] || '',
        orderData['Discount'] || '',
        orderData['Discount %'] || '',
        orderData['Products'] || '',
        orderData['Subtotal'] || '',
        orderData['Shipping'] || '',
        orderData['Total'] || '',
        orderData['Trackingslink'] || ''
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1:Z1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [values] }
      });
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