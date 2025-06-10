const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const SibApiV3Sdk = require('sib-api-v3-sdk');

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

async function sendOrderConfirmationEmail(session) {
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { expand: ['data.price.product'] }
    );

    // Format items for email template
    const items = lineItems.data
      .filter(item => !item.description?.toLowerCase().includes('verzend'))
      .map(item => {
        const metadata = item.price?.product?.metadata || {};
        const productName = item.description?.replace(/🎉.*$/, "").trim() || "";
        const productImage = item.price?.product?.images?.[0] || "";
        const currentPrice = item.price.unit_amount / 100;
        const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice;
        const hasDiscount = originalPrice > currentPrice;
        const quantity = item.quantity || 1;

        return {
          productName,
          productImage,
          quantity,
          productPrice: currentPrice.toFixed(2),
          totalPrice: (currentPrice * quantity).toFixed(2),
          discountPercentage: hasDiscount ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : null
        };
      });

    // Calculate totals
    const subtotal = session.amount_subtotal / 100;
    const shippingAmount = session.total_details?.amount_shipping / 100 || 0;
    const total = session.amount_total / 100;

    // Format discount items if any discounts exist
    const discountItems = items
      .filter(item => item.discountPercentage)
      .map(item => ({
        productName: item.productName,
        originalPrice: ((item.productPrice * 100) / (100 - item.discountPercentage)).toFixed(2),
        newPrice: item.productPrice,
        discountPercentage: item.discountPercentage,
        quantity: item.quantity,
        totalSaved: (((item.productPrice * 100) / (100 - item.discountPercentage) - item.productPrice) * item.quantity).toFixed(2)
      }));

    const totalSaved = discountItems.reduce((sum, item) => sum + parseFloat(item.totalSaved), 0).toFixed(2);

    // Configure Brevo
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    // Prepare email data
    sendSmtpEmail.templateId = parseInt(process.env.BREVO_TEMPLATE_ID);
    sendSmtpEmail.to = [{
      email: session.customer_details.email,
      name: session.customer_details.name
    }];
    sendSmtpEmail.params = {
      name: session.customer_details.name,
      orderId: session.metadata.orderId,
      items,
      subtotal: subtotal.toFixed(2),
      shippingAmount: shippingAmount.toFixed(2),
      total: total.toFixed(2),
      hasDiscount: discountItems.length > 0,
      discountItems,
      totalSaved
    };

    // Send the email
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('✅ Order confirmation email sent:', result);
    return true;
  } catch (error) {
    console.error('❌ Error sending order confirmation email:', error);
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
      console.log('💳 Processing checkout session:', session.id);
      
      // Send order confirmation email
      await sendOrderConfirmationEmail(session);
      
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