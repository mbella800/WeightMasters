import { google } from "googleapis"
import fs from "fs"
import path from "path"

export default async function handler(req, res) {
  const { checkoutSlug } = req.query

  if (!checkoutSlug) {
    return res.status(400).send("❌ checkoutSlug ontbreekt")
  }

  let serviceKey
  try {
    serviceKey = JSON.parse(process.env.GOOGLE_SERVICE_KEY)
  } catch (err) {
    console.error("❌ GOOGLE_SERVICE_KEY parsing error:", err.message)
    return res.status(500).send("GOOGLE_SERVICE_KEY parsing error")
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceKey.client_email,
      private_key: serviceKey.private_key.replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  })

  const sheets = google.sheets({ version: "v4", auth })

  let spreadsheet
  try {
    spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Orders - ${checkoutSlug}`,
        },
        sheets: [
          {
            properties: { title: "Bestellingen" },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  {
                    values: [
                      { userEnteredValue: { stringValue: "Datum" } },
                      { userEnteredValue: { stringValue: "Ordernummer" } },
                      { userEnteredValue: { stringValue: "Naam" } },
                      { userEnteredValue: { stringValue: "E-mail" } },
                      { userEnteredValue: { stringValue: "Telefoon" } },
                      { userEnteredValue: { stringValue: "Land" } },
                      { userEnteredValue: { stringValue: "Stad" } },
                      { userEnteredValue: { stringValue: "Postcode" } },
                      { userEnteredValue: { stringValue: "Adres" } },
                      { userEnteredValue: { stringValue: "Totaalbedrag" } },
                      { userEnteredValue: { stringValue: "Subtotaal" } },
                      { userEnteredValue: { stringValue: "Verzendkosten" } },
                      { userEnteredValue: { stringValue: "BTW" } },
                      { userEnteredValue: { stringValue: "Order verwerkt" } },
                      { userEnteredValue: { stringValue: "Bevestigingsmail verzonden" } },
                      { userEnteredValue: { stringValue: "Track & Trace" } },
                      { userEnteredValue: { stringValue: "Verzendmethode" } },
                      { userEnteredValue: { stringValue: "Bestelde producten" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  } catch (err) {
    console.error("❌ Spreadsheet aanmaken mislukt:", err.message)
    return res.status(500).send("Spreadsheet aanmaken mislukt")
  }

  const sheetId = spreadsheet.data.spreadsheetId

  // ✅ Deel de sheet automatisch zodat iedereen met de link deze kan bekijken
  try {
    const drive = google.drive({ version: "v3", auth })
    await drive.permissions.create({
      fileId: sheetId,
      requestBody: {
        role: "reader", // alleen-lezen
        type: "anyone", // iedereen met de link
        allowFileDiscovery: false, // verborgen in zoekresultaten
      },
    })

    // ✅ Geef opgegeven editor-email schrijfrechten
    const editorEmail = process.env.SHEET_EDITOR_EMAIL || "mailweightmasters@gmail.com"
    if (editorEmail) {
      await drive.permissions.create({
        fileId: sheetId,
        requestBody: {
          role: "writer",
          type: "user",
          emailAddress: editorEmail,
        },
        sendNotificationEmail: false, // geen email spam
      })
      console.log(`✍️  Schrijfrechten gegeven aan ${editorEmail}`)
    }

    console.log("🔓 Sheet permissies ingesteld op 'iedereen met link (viewer)'")
  } catch (permErr) {
    console.error("⚠️ Kon permissies niet instellen:", permErr.message)
  }

  const sheetLink = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`

  console.log(`✅ Nieuwe sheet aangemaakt voor ${checkoutSlug}: ${sheetId}`)
  res.status(200).json({
    message: "Nieuwe sheet aangemaakt en gedeeld als 'everyone with link - viewer'. Zet deze ID in de Vercel ENV als DEFAULT_SHEET_ID of voeg hem toe aan sheet-config.json.",
    sheetId,
    sheetLink,
  })
}
