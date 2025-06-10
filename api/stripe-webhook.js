const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { buffer } = require('micro');

// Disable body parsing, we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize Brevo API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

function capitalizeWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

async function sendOrderConfirmationEmail(session) {
  try {
    console.log('📧 Sending order confirmation email...');
    
    // Get shipping amount from session
    const shippingAmount = session.total_details?.amount_shipping || 0;
    const isFreeShipping = shippingAmount === 0;

    // Format shipping amount with comma
    const formattedShippingAmount = (shippingAmount / 100).toFixed(2).replace('.', ',');
    
    // Prepare email template data
    const emailData = {
      to: [{ email: session.customer_details.email }],
      templateId: 1,
      params: {
        customerName: capitalizeWords(session.customer_details.name),
        orderAmount: (session.amount_total / 100).toFixed(2).replace('.', ','),
        shippingAmount: formattedShippingAmount,
        isFreeShipping: isFreeShipping,
        // Add other template variables as needed
      }
    };

    // Send the email
    await apiInstance.sendTransacEmail(emailData);
    console.log('✅ Order confirmation email sent successfully');
  } catch (error) {
    console.error('❌ Error sending order confirmation email:', error);
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
    // Get the raw body as a buffer
    const rawBody = await buffer(req);
    console.log('📝 Raw body length:', rawBody.length);

    // Construct and verify the event using the raw buffer
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );

    console.log('✅ Success: Webhook signature verified');
    console.log('Event type:', event.type);

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await sendOrderConfirmationEmail(session);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
}