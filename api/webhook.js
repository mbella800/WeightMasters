import { buffer } from "micro"
import Stripe from "stripe"
import { google } from "googleapis"
const fs = require("fs")
const path = require("path")

export const config = { api: { bodyParser: false } }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const sheetConfigPath = path.join(__dirname, "sheet-config.json")
const sheetConfig = JSON.parse(fs.readFileSync(sheetConfigPath, "utf-8"))

const formatEuro = (value) =>
  typeof value === "string" || typeof value === "number"
    ? `€${(parseFloat(value) / 100).toFixed(2).replace(".", ",")}`
    : ""

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed")

  const sig = req.headers["stripe-signature"]
  const buf = await buffer(req)

  let event
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_SHEET
    )
  } catch (err) {
    console.error("❌ Webhook signature mismatch:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object
    const metadata = session.metadata || {}
    const checkoutSlug = metadata.checkoutSlug || "default"

    const sheetId = sheetConfig.find(
      (entry) => entry.checkoutSlug === checkoutSlug
    )?.sheetId
    if (!sheetId) {
      console.error("❌ Geen sheetId gevonden voor:", checkoutSlug)
      return res.status(400).send("Geen sheetId gevonden")
    }

    try {
      const key = JSON.parse(process.env.GOOGLE_SERVICE_KEY)
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: key.client_email,
          private_key: key.private_key,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      })

      const sheets = google.sheets({ version: "v4", auth })
      const customer = session.customer_details || {}
      const date = new Date().toLocaleString("nl-NL", {
        timeZone: "Europe/Amsterdam",
      })

      const items = JSON.parse(metadata.items || "[]")
      const itemList = items
        .map(
          (item) =>
            `${item.title || item.ProductName} (€${parseFloat(item.productPrice).toFixed(2)} × ${item.quantity})`
        )
        .join(", ")

      const row = [
        date,
        metadata.orderId || session.payment_intent || "",
        customer.name || "",
        customer.email || "",
        customer.phone || "",
        customer.address?.country || "",
        customer.address?.city || "",
        customer.address?.postal_code || "",
        customer.address?.line1 || "",
        formatEuro(metadata.total),
        formatEuro(metadata.subtotal),
        formatEuro(metadata.shippingFee),
        formatEuro(metadata.tax),
        "", // Order verwerkt
        "✅", // Bevestigingsmail verzonden
        "", // Track & Trace
        metadata.shippingMethod || "",
        itemList,
      ]

      console.log("👉 Row contents:", row)

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: "'Bestellingen'!A2:R",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      })

      console.log("✅ Bestelling gelogd in Google Sheet")
    } catch (err) {
      console.error("❌ Google Sheets fout:", err.message)
      return res.status(500).send("Google Sheets fout")
    }
  }

  res.status(200).json({ received: true })
}
