import { google } from "googleapis"
const fs = require("fs")
const path = require("path")

const sheetConfigPath = path.join(__dirname, "sheet-config.json")
const sheetConfig = JSON.parse(fs.readFileSync(sheetConfigPath, "utf-8"))

export default async function handler(req, res) {
  const { checkoutSlug } = req.query
  if (!checkoutSlug) return res.status(400).send("checkoutSlug is verplicht")

  const sheetId = sheetConfig.find(entry => entry.checkoutSlug === checkoutSlug)?.sheetId
  if (!sheetId) return res.status(404).send("Sheet ID niet gevonden voor deze slug")

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

    // Check of tabblad bestaat
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId })
    const existingSheet = spreadsheet.data.sheets.find(
      (sheet) => sheet.properties.title === "Bestellingen"
    )

    // Als het tabblad niet bestaat, aanmaken
    if (!existingSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: "Bestellingen" },
              },
            },
          ],
        },
      })
      console.log("📄 Tabblad 'Bestellingen' aangemaakt")
    }

    const headers = [
      "Datum", "Ordernummer", "Naam", "E-mail", "Telefoon",
      "Land", "Stad", "Postcode", "Adres",
      "Totaalbedrag", "Subtotaal", "Verzendkosten", "BTW",
      "Order verwerkt", "Bevestigingsmail verzonden", "Track & Trace",
      "Verzendmethode", "Bestelde producten"
    ]

    // Sheet leegmaken
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: "'Bestellingen'!A1:R1",
    })

    // Headers opnieuw toevoegen
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "'Bestellingen'!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] },
    })

    console.log("✅ Sheet gereset met correcte headers")
    res.status(200).send("Sheet is succesvol gereset")
  } catch (err) {
    console.error("❌ Fout bij resetten van sheet:", err.message)
    res.status(500).send("Fout bij resetten van sheet")
  }
}
