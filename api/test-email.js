export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    console.log("📧 Testing Brevo email without template...")

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "WeightMasters Test",
          email: "vsnryweb@gmail.com",
        },
        to: [{ 
          email: "vsnryweb@gmail.com", 
          name: "Test User" 
        }],
        subject: "Test Email - WeightMasters",
        htmlContent: `
          <h1>Test Email</h1>
          <p>Als je deze email ontvangt, werkt Brevo correct!</p>
          <p>Tijd: ${new Date().toISOString()}</p>
        `,
      }),
    })

    console.log("📬 Test email response status:", response.status)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error("❌ Test email error:", errorText)
      return res.status(400).json({ error: errorText })
    } else {
      const responseData = await response.text()
      console.log("✅ Test email success:", responseData)
      return res.status(200).json({ success: true, response: responseData })
    }
  } catch (err) {
    console.error("❌ Test email exception:", err)
    return res.status(500).json({ error: err.message })
  }
} 