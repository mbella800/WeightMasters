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
  if (!str) return '';
  return str.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());
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
        const currentPrice = item.price.unit_amount / 100;
        
        const metadata = item.price?.product?.metadata || {};
        const originalPrice = metadata.originalPrice ? 
          parseFloat(metadata.originalPrice) : 
          parseFloat(metadata.Product_Price || currentPrice);
        
        const hasDiscount = originalPrice > currentPrice;
        const discountPercentage = hasDiscount ? 
          Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0;
          
          return {
          productName,
            productImage,
          productPrice: currentPrice.toFixed(2).replace('.', ','),
          originalPrice: originalPrice.toFixed(2).replace('.', ','),
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
    const shippingFee = session.total_details?.amount_shipping || 0;
    const total = session.amount_total;

    // shippingFee altijd als string met 2 decimalen en komma
    const shippingFeeStr = (shippingFee / 100).toFixed(2).replace('.', ',');

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
        shippingFee: shippingFeeStr,
        tax: "0,00",
        total: (total / 100).toFixed(2).replace('.', ','),
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
          totalSaved: (parseFloat(item.itemSavings.replace(',', '.')) * item.quantity).toFixed(2).replace('.', ',')
        })),
        totalSaved: itemsWithDiscount.reduce((sum, item) => 
          sum + (parseFloat(item.itemSavings.replace(',', '.')) * item.quantity), 0).toFixed(2).replace('.', ',')
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

  try {
    // Get the raw body as a buffer
    const rawBody = await buffer(req);
    const sig = req.headers['stripe-signature'];

    console.log('🔍 Debug - Headers:', req.headers);
    console.log('🔑 Debug - Webhook Secret exists:', !!process.env.STRIPE_WEBHOOK_SECRET);
    console.log('📝 Debug - Signature:', sig);
    console.log('📝 Debug - Raw body length:', rawBody.length);
    console.log('🔍 Debug - Raw body preview:', rawBody.toString().substring(0, 200));
    console.log('🔑 Debug - Webhook secret length:', process.env.STRIPE_WEBHOOK_SECRET?.length);
    console.log('🔑 Debug - Webhook secret preview:', process.env.STRIPE_WEBHOOK_SECRET ? `whsec...` : 'undefined');

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log('Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      await sendOrderConfirmationEmail(session);
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
    console.error('Stack trace:', err.stack);
    res.status(400).json({
      error: {
        message: err.message
      }
    });
  }
}