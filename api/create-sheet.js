import { google } from "googleapis"
import fs from "fs"
import path from "path"

export default async function handler(req, res) {
  const { checkoutSlug } = req.query

  if (!checkoutSlug) {
    return res.status(400).send("checkoutSlug ontbreekt")
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
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })

  const sheets = google.sheets({ version: "v4", auth })

  const spreadsheet = await sheets.spreadsheets.create({
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

  const sheetId = spreadsheet.data.spreadsheetId

  // sheet-config.json bijwerken
  const configPath = path.join(process.cwd(), "api", "sheet-config.json")
  const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"))

  configJson.push({
    checkoutSlug,
    sheetId,
  })

  fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2))

  res.status(200).json({ message: "Nieuwe sheet aangemaakt", sheetId })
}
