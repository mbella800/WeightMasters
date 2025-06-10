const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

app.post('/', async (req, res) => {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_KEY);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = '1OCFsr_vBZX5GodN0Bp3EPq45RHCL5PXD-g3ExkD0VAU';
    const sheetName = 'Bestellingen';
    const values = [
      req.body['Order ID'] || '',
      req.body['Date'] || '',
      req.body['Customer Name'] || '',
      req.body['Email'] || '',
      req.body['Phone'] || '',
      req.body['Country'] || '',
      req.body['City'] || '',
      req.body['Postal Code'] || '',
      req.body['Address'] || '',
      req.body['Original Amount'] || '',
      req.body['Paid Amount'] || '',
      req.body['Discount'] || '',
      req.body['Discount %'] || '',
      req.body['Products'] || '',
      req.body['Subtotal'] || '',
      req.body['Shipping'] || '',
      req.body['Total'] || '',
      req.body['Trackingslink'] || ''
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] }
    });

    res.status(200).send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('OK');
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
}); 