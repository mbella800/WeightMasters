const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

// Disable body parsing, we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function sheetWebhook(event) {
  try {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['line_items.data.price.product']
    });

    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { expand: ['data.price.product'] }
    );

    const items = lineItems.data
      .filter(item => !item.description?.toLowerCase().includes('verzend'))
      .map(item => {
        const productName = item.description?.replace(/🎉.*$/, "").trim() || "";
        const productImage = item.price?.product?.images?.[0] || "";
        const metadata = item.price?.product?.metadata || {};
        const currentPrice = item.price.unit_amount / 100;
        const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice;
        const hasDiscount = originalPrice > currentPrice;

        return {
          "Product Name": productName,
          "Product Image": productImage,
          "Product Price": currentPrice.toFixed(2).replace('.', ','),
          "Sale Price Optioneel": hasDiscount ? currentPrice.toFixed(2).replace('.', ',') : null,
          quantity: item.quantity,
          totalPrice: (currentPrice * item.quantity).toFixed(2).replace('.', ',')
        };
      });

    const subtotal = session.amount_subtotal;
    const shippingAmount = session.total_details?.amount_shipping || 0;
    const total = session.amount_total;

    // Get the Google Sheets credentials and spreadsheet ID
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    // Prepare the row data
    const orderData = items.map(item => [
      new Date().toISOString(),                    // Timestamp
      session.payment_intent,                      // Order ID
      session.customer_details?.name || "",        // Customer Name
      session.customer_details?.email || "",       // Customer Email
      item["Product Name"],                        // Product Name
      item.quantity,                               // Quantity
      item["Product Price"],                       // Product Price
      item["Sale Price Optioneel"] || "",         // Sale Price
      item.totalPrice,                            // Total Price
      (shippingAmount / 100).toFixed(2).replace('.', ','), // Shipping Cost
      (total / 100).toFixed(2).replace('.', ',')  // Total Amount
    ]);

    // Append the data to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Orders!A:K',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: orderData
      },
    });

    console.log('✅ Order data added to Google Sheet');
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

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('❌ Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    // Get the raw request body as a string
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    console.log('📝 Raw body length:', rawBody.length);

    // Construct and verify the event using the raw string
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );

    console.log('✅ Success: Webhook signature verified');
    console.log('Event type:', event.type);

    // Handle the event
    await sheetWebhook(event);
    
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
} 