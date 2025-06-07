// Simple test script for Brevo emails
const handler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const testEmailPayload = {
    sender: {
      name: "Weightmasters Test",
      email: "mailweightmasters@gmail.com"
    },
    to: [{
      email: req.body.email || "vsnryweb@gmail.com", // Default test email
      name: "Test User"
    }],
    subject: "Test Email van Weightmasters",
    htmlContent: "<p>Dit is een test email om te controleren of Brevo correct werkt.</p>"
  }

  try {
    console.log("📧 Sending test email...")
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(testEmailPayload)
    })

    console.log("📬 Brevo response status:", response.status)
    const responseText = await response.text()
    console.log("📬 Brevo response:", responseText)

    if (!response.ok) {
      throw new Error(`Failed to send email: ${responseText}`)
    }

    return res.status(200).json({ 
      success: true, 
      message: "Test email sent successfully" 
    })

  } catch (error) {
    console.error("❌ Error sending test email:", error)
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    })
  }
}

module.exports = handler 