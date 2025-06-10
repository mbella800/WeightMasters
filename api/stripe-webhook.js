const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
      console.log('💳 Processing checkout session:', event.data.object.id);
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