const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const SibApiV3Sdk = require('sib-api-v3-sdk');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Webhook secret voor email notifications
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
if (!WEBHOOK_SECRET) {
  console.error("❌ Missing STRIPE_WEBHOOK_SECRET environment variable")
}

// ✅ VERCEL-SPECIFIEKE CONFIG
exports.config = {
  api: {
    bodyParser: false,
  },
}

function capitalizeWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Hulpfunctie om raw body te lezen
async function getRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const calculateShippingCost = (items) => {
  // Calculate total weight
  const totalWeight = items.reduce((total, item) => {
    const weight = parseFloat(item.price?.product?.metadata?.weight || 0);
    return total + (weight * item.quantity);
  }, 0);

  // Shipping cost calculation based on weight in grams
  if (totalWeight <= 20) return 100; // €1,00 briefpost
  if (totalWeight <= 50) return 200; // €2,00
  if (totalWeight <= 500) return 410; // €4,10 brievenbuspakje
  if (totalWeight <= 2000) return 695; // €6,95 standaard pakket
  return 995; // €9,95 zwaar pakket (>2000g)
};

async function sendOrderConfirmationEmail(session) {
  try {
    console.log('📧 Sending order confirmation email...');

    const customer_email = session.customer_details?.email;
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
          productName,
          productImage,
          productPrice: currentPrice.toFixed(2),
          originalPrice: originalPrice.toFixed(2),
          hasDiscount,
          discountPercentage,
          itemSavings: hasDiscount ? (originalPrice - currentPrice).toFixed(2) : "0.00",
          quantity: item.quantity,
          totalPrice: (currentPrice * item.quantity).toFixed(2),
          totalOriginalPrice: (originalPrice * item.quantity).toFixed(2)
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

    // Check if shipping is free based on the actual shipping amount
    const isFreeShipping = shippingAmount === 0;

    const emailPayload = {
      sender: {
        name: "Weightmasters",
        email: "mailweightmasters@gmail.com"
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
        subtotal: (subtotal / 100).toFixed(2),
        shipping: (shippingAmount / 100).toFixed(2),
        tax: "0.00",
        total: (total / 100).toFixed(2),
        shopName: "Weightmasters",
        items: items.map(item => ({
          productName: item.productName.replace(' (incl. BTW)', ''),
          productImage: item.productImage,
          productPrice: item.productPrice,
          quantity: item.quantity,
          originalPrice: item.hasDiscount ? item.originalPrice : null,
          discountPercentage: item.hasDiscount ? item.discountPercentage : null,
          totalPrice: item.totalPrice,
          totalOriginalPrice: item.hasDiscount ? item.totalOriginalPrice : null
        })),
        hasDiscount: itemsWithDiscount.length > 0,
        discountItems: itemsWithDiscount.map(item => ({
          productName: item.productName.replace(' (incl. BTW)', ''),
          originalPrice: item.originalPrice,
          newPrice: item.productPrice,
          savedAmount: item.itemSavings,
          discountPercentage: item.discountPercentage,
          quantity: item.quantity,
          totalSaved: (parseFloat(item.itemSavings) * item.quantity).toFixed(2)
        })),
        totalSaved: itemsWithDiscount.reduce((sum, item) => 
          sum + (parseFloat(item.itemSavings) * item.quantity), 0).toFixed(2),
        shippingInfo: isFreeShipping ? 
          "🎉 Gratis verzending" : 
          `Verzendkosten (incl. BTW): €${(shippingAmount / 100).toFixed(2)}`
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

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const sig = req.headers['stripe-signature'];
    const rawBody = req.rawBody; // Next.js provides this

    console.log('🔍 Verifying email webhook signature...');

    try {
      const event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET_EMAIL
      );

      console.log('✅ Email webhook signature verified');

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
      console.error('❌ Webhook error:', err.message);
      res.status(400).json({
        error: {
          message: err.message
        }
      });
    }
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
  }
};