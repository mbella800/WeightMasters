import { GoogleSpreadsheet } from 'google-spreadsheet';

const headers = [
  'Order ID',
  'Date',
  'Customer Name',
  'Email',
  'Phone',
  'Country',
  'City',
  'Postal Code',
  'Address',
  'Original Amount',
  'Paid Amount',
  'Discount',
  'Discount %',
  'Products',
  'Subtotal',
  'Shipping',
  'Total',
  'Trackingslink'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const doc = new GoogleSpreadsheet(process.env.DEFAULT_SHEET_ID);
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_KEY);
    await doc.useServiceAccountAuth(credentials);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    // Clear all rows except header
    await sheet.clear();
    await sheet.setHeaderRow(headers);

    res.status(200).json({
      success: true,
      message: 'Sheet reset successful',
      sheetId: process.env.DEFAULT_SHEET_ID
    });
  } catch (error) {
    console.error('❌ Error resetting sheet:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
} 