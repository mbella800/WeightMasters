import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// ✅ VERCEL-FRIENDLY CONFIG
export const config = {
  api: {
    bodyParser: false,
  },
}

// Hulpfunctie om afzendernaam netjes te maken
function capitalizeWords(str) {
  return str.replace(/\b\w/g, (char) => char.toUpperCase())
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed")
  }

  // ✅ VERBETERDE SIGNATURE HANDLING VOOR VERCEL
  const sig = req.headers['stripe-signature'] || req.headers['Stripe-Signature']
  
  let body
  let event

  try {
    // ✅ RAW BODY KRIJGEN OP VERCEL-VRIENDELIJKE MANIER
    if (req.body && typeof req.body === 'string') {
      body = req.body
    } else if (req.body && Buffer.isBuffer(req.body)) {
      body = req.body
    } else {
      // Fallback voor micro buffer
      const { buffer } = await import("micro")
      body = await buffer(req)
    }

    // ✅ SIGNATURE VERIFICATIE MET BETERE ERROR HANDLING
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
    console.log("✅ Webhook signature verified successfully")
    
  } catch (err) {
    console.error("❌ Webhook signature mismatch:", err.message)
    console.error("Headers:", JSON.stringify(req.headers, null, 2))
    console.error("Body type:", typeof body)
    console.error("Body length:", body?.length || 'undefined')
    console.error("Signature:", sig)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === "checkout.session.completed") {
    console.log("🎯 Processing checkout.session.completed event")
    
    const session = event.data.object
    const metadata = session.metadata || {}

    const customer_email = session.customer_details?.email || ""
    const customer_name = session.customer_details?.name || ""
    const shipping = session.total_details?.amount_shipping || metadata.shippingFee || 0

    // ✅ DISCOUNT INFORMATIE UIT METADATA
    const totalOriginalValue = parseFloat(metadata.totalOriginalValue || 0) / 100
    const totalSavedAmount = parseFloat(metadata.totalSavedAmount || 0) / 100
    const totalDiscountPercentage = parseInt(metadata.totalDiscountPercentage || 0)
    const hasAnyDiscount = metadata.hasAnyDiscount === "true"

    let items = []
    let itemsWithDiscount = []

    try {
      // ✅ KRIJG ITEMS UIT STRIPE LINE_ITEMS IN PLAATS VAN METADATA
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product']
      })
      
      items = lineItems.data
        .filter(item => {
          // Filter out BTW, shipping, and discount summary items
          const name = item.price?.product?.name || item.description || ""
          return !name.includes("BTW") && 
                 !name.includes("Verzendkosten") && 
                 !name.includes("Gratis verzending") &&
                 !name.includes("Totaal bespaard")
        })
        .map((item) => {
          const productName = item.price?.product?.name || item.description || ""
          const productImage = item.price?.product?.images?.[0] || ""
          const unitAmount = item.price?.unit_amount || 0
          const quantity = item.quantity || 1
          
          // ✅ DETECTEER KORTING UIT PRODUCTNAAM
          const hasDiscount = productName.includes("🎉") && productName.includes("was €")
          let originalPrice = unitAmount / 100
          let discountPercentage = 0
          let itemSavings = 0
          
          if (hasDiscount) {
            // Probeer originele prijs uit naam te extraheren: "Product 🎉 -13% (was €79.95)"
            const wasMatch = productName.match(/was €([\d.]+)\)/)
            if (wasMatch) {
              originalPrice = parseFloat(wasMatch[1])
              itemSavings = (originalPrice - (unitAmount / 100)) * quantity
              discountPercentage = Math.round(((originalPrice - (unitAmount / 100)) / originalPrice) * 100)
            }
          }
          
          return {
            productName: productName.replace(/🎉.*$/, '').trim(), // Clean product name
            productImage,
            productPrice: (unitAmount / 100).toFixed(2),
            originalPrice: originalPrice.toFixed(2),
            hasDiscount,
            discountPercentage,
            itemSavings: itemSavings.toFixed(2),
            quantity,
            totalPrice: ((unitAmount / 100) * quantity).toFixed(2),
            totalOriginalPrice: (originalPrice * quantity).toFixed(2),
          }
        })

      // ✅ ITEMS MET KORTING VOOR TEMPLATE
      itemsWithDiscount = items.filter(item => item.hasDiscount)
      
    } catch (err) {
      console.error("❌ Kon line items niet ophalen:", err.message)
      
      // ✅ FALLBACK: simpele items uit productNames metadata
      try {
        const productNames = metadata.productNames || ""
        if (productNames) {
          const names = productNames.split(", ")
          items = names.map(name => ({
            productName: name,
            productImage: "",
            productPrice: "0.00",
            originalPrice: "0.00",
            hasDiscount: false,
            discountPercentage: 0,
            itemSavings: "0.00",
            quantity: 1,
            totalPrice: "0.00",
            totalOriginalPrice: "0.00",
          }))
        }
      } catch (fallbackErr) {
        console.error("❌ Fallback parsing ook gefaald:", fallbackErr.message)
      }
    }

    // ✅ UITGEBREIDE DATA VOOR BREVO TEMPLATE
    const data = {
      name: customer_name,
      email: customer_email,
      orderId: session.payment_intent,
      subtotal: (parseFloat(metadata.subtotal) / 100).toFixed(2),
      shipping: (parseFloat(shipping) / 100).toFixed(2),
      tax: (parseFloat(metadata.tax) / 100).toFixed(2),
      total: (session.amount_total / 100).toFixed(2),
      shopName: capitalizeWords((metadata.checkoutSlug || "Webshop").replace(/-/g, " ")),
      items,
      
      // ✅ NIEUWE DISCOUNT VARIABELEN VOOR BREVO TEMPLATE
      hasAnyDiscount,
      totalOriginalValue: totalOriginalValue.toFixed(2),
      totalSavedAmount: totalSavedAmount.toFixed(2),
      totalDiscountPercentage,
      itemsWithDiscount,
      
      // ✅ EXTRA HANDIGE VARIABELEN
      savingsText: hasAnyDiscount ? `Je totale besparing: €${totalSavedAmount.toFixed(2)}` : "",
      discountSummary: hasAnyDiscount ? 
        `${totalDiscountPercentage}% korting - €${totalSavedAmount.toFixed(2)} bespaard!` : 
        "",
    }

    console.log("📧 Sending email to:", customer_email)

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: data.shopName,
            email: "vsnryweb@gmail.com", // <- GEFORCEERD EMAILadres zonder .env
          },
          to: [{ email: data.email, name: data.name }],
          templateId: parseInt(process.env.BREVO_TEMPLATE_ID),
          params: data,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("❌ Brevo response fout:", response.status, errorText)
      } else {
        console.log("✅ Bevestigingsmail verzonden naar", data.email)
        // ✅ DEBUG: Log discount info
        if (hasAnyDiscount) {
          console.log(`💰 Korting verwerkt: ${totalDiscountPercentage}% (€${totalSavedAmount.toFixed(2)} bespaard)`)
        }
      }
    } catch (err) {
      console.error("❌ Fout bij verzenden mail via Brevo:", err.message)
    }
  } else {
    console.log(`ℹ️ Onhandled event type: ${event.type}`)
  }

  res.status(200).json({ received: true })
}
