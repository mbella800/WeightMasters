import Stripe from "stripe"
import { buffer } from "micro"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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

  const sig = req.headers["stripe-signature"]
  const buf = await buffer(req)

  let event

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error("❌ Webhook signature mismatch:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === "checkout.session.completed") {
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
      // ✅ PARSE ITEMS MET DISCOUNT INFO
      const itemsWithDiscountInfo = JSON.parse(metadata.itemsWithDiscountInfo || "[]")
      
      if (Array.isArray(itemsWithDiscountInfo)) {
        items = itemsWithDiscountInfo.map((item) => ({
          productName: item["Product Name"] || item.title || "",
          productImage:
            typeof item["Product Image"] === "object" && item["Product Image"]?.url
              ? item["Product Image"].url
              : item["Product Image"] || "",
          productPrice: item.effectivePrice.toFixed(2), // ✅ Effectieve prijs (met korting)
          originalPrice: item.originalPrice.toFixed(2), // ✅ Originele prijs
          salePrice: item.hasDiscount ? item.salePrice.toFixed(2) : null, // ✅ Sale prijs
          hasDiscount: item.hasDiscount, // ✅ Of er korting is
          discountPercentage: item.discountPercentage, // ✅ Korting percentage
          itemSavings: item.itemSavings.toFixed(2), // ✅ Besparing per item
          quantity: item.quantity || 1,
          totalPrice: (item.effectivePrice * (item.quantity || 1)).toFixed(2),
          totalOriginalPrice: (item.originalPrice * (item.quantity || 1)).toFixed(2), // ✅ Totale originele prijs
        }))

        // ✅ APART ARRAY VOOR ITEMS MET KORTING (voor template)
        itemsWithDiscount = items.filter(item => item.hasDiscount)
      }
    } catch (err) {
      console.error("❌ Kon items niet parsen uit metadata:", err.message)
      
      // ✅ FALLBACK NAAR OUDE METHODE
      try {
        const parsed = JSON.parse(metadata.items)
        if (Array.isArray(parsed)) {
          items = parsed.map((item) => ({
            productName: item.ProductName || item.title || "",
            productImage:
              typeof item.productImage === "object" && item.productImage?.url
                ? item.productImage.url
                : item.productImage || "",
            productPrice: parseFloat(item.productPrice).toFixed(2),
            quantity: item.quantity || 1,
            totalPrice: (parseFloat(item.productPrice || 0) * (item.quantity || 1)).toFixed(2),
            hasDiscount: false,
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
      total: (parseFloat(metadata.total) / 100).toFixed(2),
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
  }

  res.status(200).json({ received: true })
}
