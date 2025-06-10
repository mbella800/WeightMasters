const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const SibApiV3Sdk = require('sib-api-v3-sdk');

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
    
    const customer_email = session.customer_details?.email;
    if (!customer_email) {
      throw new Error('No customer email found in session');
    }

    const customer_name = session.customer_details?.name || "";

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
        const discountPercentage = hasDiscount ? 
          Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0;

        return {
          "Product Name": productName,
          "Product Image": productImage,
          "Product Price": currentPrice.toFixed(2).replace('.', ','),
          "Sale Price Optioneel": hasDiscount ? currentPrice.toFixed(2).replace('.', ',') : null,
          hasDiscount,
          discountPercentage,
          itemSavings: hasDiscount ? (originalPrice - currentPrice).toFixed(2).replace('.', ',') : "0,00",
          quantity: item.quantity,
          totalPrice: (currentPrice * item.quantity).toFixed(2).replace('.', ','),
          totalOriginalPrice: (originalPrice * item.quantity).toFixed(2).replace('.', ',')
        };
      });

    const itemsWithDiscount = items.filter(item => item.hasDiscount);
    const subtotal = session.amount_subtotal;
    const shippingAmount = session.total_details?.amount_shipping || 0;
    const total = session.amount_total;

    console.log('💰 Order details:', {
      subtotal: (subtotal / 100).toFixed(2),
      shipping: (shippingAmount / 100).toFixed(2),
      total: (total / 100).toFixed(2)
    });

    // Check if shipping is free based on the actual shipping amount from Stripe
    const isFreeShipping = shippingAmount === 0;
    const shippingCost = (shippingAmount / 100).toFixed(2).replace('.', ',');
    
    // Only show free shipping text if shipping amount is actually 0
    const shippingInfo = isFreeShipping ? 
      "🎉 Gratis verzending" : 
      `Verzendkosten (incl. BTW): €${shippingCost}`;

    console.log('📦 Shipping info:', { 
      isFreeShipping, 
      shippingAmount, 
      shippingCost,
      shippingInfo 
    });

    const emailPayload = {
      sender: {
        name: "Weightmasters",
        email: process.env.BREVO_FROM_EMAIL || "mailweightmasters@gmail.com"
      },
      to: [{
        email: customer_email,
        name: customer_name || "Klant"
      }],
      templateId: parseInt(process.env.BREVO_TEMPLATE_ID),
      params: {
        name: capitalizeWords(customer_name) || "Klant",
        email: customer_email,
        orderId: session.payment_intent,
        subtotal: (subtotal / 100).toFixed(2).replace('.', ','),
        shippingAmount: shippingCost,
        tax: "0,00",
        total: (total / 100).toFixed(2).replace('.', ','),
        shopName: "Weightmasters",
        items: items.map(item => ({
          productName: item["Product Name"],
          productImage: item["Product Image"],
          productPrice: item["Product Price"],
          quantity: item.quantity,
          originalPrice: item.hasDiscount ? item.totalOriginalPrice : null,
          discountPercentage: item.hasDiscount ? item.discountPercentage : null,
          totalPrice: item.totalPrice,
          totalOriginalPrice: item.hasDiscount ? item.totalOriginalPrice : null
        })),
        hasDiscount: itemsWithDiscount.length > 0,
        discountItems: itemsWithDiscount.map(item => ({
          productName: item["Product Name"],
          originalPrice: item.totalOriginalPrice,
          newPrice: item.totalPrice,
          savedAmount: item.itemSavings,
          discountPercentage: item.discountPercentage,
          quantity: item.quantity,
          totalSaved: (parseFloat(item.itemSavings.replace(',', '.')) * item.quantity).toFixed(2).replace('.', ',')
        })),
        totalSaved: itemsWithDiscount.reduce((sum, item) => 
          sum + (parseFloat(item.itemSavings.replace(',', '.')) * item.quantity), 0).toFixed(2).replace('.', ','),
        shippingInfo: shippingInfo,
        isFreeShipping: isFreeShipping
      }
    };

    await apiInstance.sendTransacEmail(emailPayload);
    console.log('✅ Order confirmation email sent successfully');
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
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
    // Get the raw request body as a buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);
    console.log('📝 Raw body length:', rawBody.length);

    // Construct and verify the event using the raw buffer
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );

    console.log('✅ Success: Webhook signature verified');
    console.log('Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      await sendOrderConfirmationEmail(session);
      res.status(200).json({ received: true });
    } else {
      res.status(400).json({
        error: {
          message: 'Unhandled event type'
        }
      });
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
}