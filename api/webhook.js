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

async function sheetWebhook(session) {
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { expand: ['data.price.product'] }
    );

    // Get customer details
    const customer_email = session.customer_details?.email || '';
    const customer_name = session.customer_details?.name || '';
    const timestamp = new Date().toISOString();
    const orderId = session.metadata.orderId || session.id;
    const subtotal = session.amount_subtotal / 100;
    const shippingAmount = session.total_details?.amount_shipping / 100 || 0;
    const total = session.amount_total / 100;

    // Format line items according to Framer component structure
    const items = lineItems.data
      .filter(item => !item.description?.toLowerCase().includes('verzend'))
      .map(item => {
        const metadata = item.price?.product?.metadata || {};
        const productName = item.description?.replace(/🎉.*$/, "").trim() || "";
        const productImage = item.price?.product?.images?.[0] || "";
        const currentPrice = item.price.unit_amount / 100;
        const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice;
        const hasDiscount = originalPrice > currentPrice;
        const salePrice = hasDiscount ? currentPrice : null;
        const weight = metadata.weight || 0;
        const freeShippingThreshold = metadata.freeShippingThreshold || 50;

        return {
          "Timestamp": timestamp,
          "Order ID": orderId,
          "Customer Name": customer_name,
          "Customer Email": customer_email,
          "Product Name": productName,
          "Product Image": productImage,
          "Product Price": currentPrice.toFixed(2),
          "Sale Price Optioneel": salePrice?.toFixed(2) || "",
          "Original Price": originalPrice.toFixed(2),
          "Weight (g)": weight,
          "FreeShippingTreshold": freeShippingThreshold,
          "Quantity": item.quantity,
          "Total Product Price": (currentPrice * item.quantity).toFixed(2),
          "Has Discount": hasDiscount ? "Yes" : "No",
          "Discount Amount": hasDiscount ? (originalPrice - currentPrice).toFixed(2) : "",
          "Discount Percentage": hasDiscount ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : "",
          "Stripe Product ID": item.price.product.id,
          "Stripe Price ID": item.price.id,
          "Subtotal": subtotal.toFixed(2),
          "Shipping Amount": shippingAmount.toFixed(2),
          "Total Amount": total.toFixed(2),
          "Payment Status": session.payment_status,
          "Shipping Status": "",  // To be updated manually
          "Notes": ""  // For manual notes
        };
      });

    // Prepare rows for Google Sheets
    const headerRow = Object.keys(items[0]);
    const dataRows = items.map(item => headerRow.map(key => item[key]));

    // Google Sheets API setup
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.DEFAULT_SHEET_ID;

    // Check if headers exist
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Orders!1:1',
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      // Add headers if they don't exist
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Orders!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headerRow],
        },
      });
    }

    // Append the data rows
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Orders!A2',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: dataRows,
      },
    });

    console.log('✅ Order data added to Google Sheet');
    return true;
  } catch (error) {
    console.error('❌ Error updating Google Sheet:', error);
    throw error;
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_SHEET;

  console.log('🔍 Debug - Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔑 Debug - Webhook Secret exists:', !!webhookSecret);
  console.log('📝 Debug - Signature:', sig);

  if (!webhookSecret) {
    console.error('❌ Missing STRIPE_WEBHOOK_SECRET_SHEET environment variable');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const rawBody = await buffer(req);
    console.log('📝 Debug - Raw body length:', rawBody.length);
    console.log('🔍 Debug - Raw body preview:', rawBody.toString().substring(0, 100));

    // Log the exact webhook secret being used
    console.log('🔑 Debug - Webhook secret length:', webhookSecret.length);
    console.log('🔑 Debug - Webhook secret preview:', webhookSecret.substring(0, 5) + '...');

    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    console.log('✅ Success: Webhook signature verified');
    console.log('Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });
      await sheetWebhook(session);
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