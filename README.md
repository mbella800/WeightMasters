# Webshop MASTER Template

Dit is een herbruikbare Stripe Checkout-backend voor Framer-webshops, gebouwd voor schaalbaarheid, meertaligheid en meerdere klanten.

Gebruik deze template om snel een nieuwe checkout-omgeving te lanceren voor elke nieuwe klant zonder code aan te passen.

---

## ✅ Wat deze setup ondersteunt

- Volledige Stripe Checkout integratie
- Dynamische domeinherkenning via `referer`
- Meertalige redirects (NL / EN / etc.)
- Ondersteuning voor meerdere klanten (via `clientId`)
- Meerdere line items (producten, verzendkosten, korting)
- Optioneel: metadata en e-mail voor orderherkenning
- Webhook-ready voor orderverwerking

---

## 📂 Structuur

functions/
api/
checkout.js      → Stripe sessie aanmaken
webhook.js       → (optioneel) voor automatische orderverwerking

.env.example         → Zet hier je STRIPE_SECRET_KEY als voorbeeld
vercel.json          → Stuurt requests naar de juiste function directory
package.json         → Minimale setup voor runtime
README.md            → Deze file

---

## ⚙️ .env voorbeeld

```env
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
```


Voeg deze key toe aan het Vercel project van elke klant.

🧠 Belangrijke aandachtspunten

Meertalige redirect

Zorg dat je vanuit Framer slugs meestuurt in de payload, zoals:

{
  success_url: "/nl/bedankt",
  cancel_url: "/nl/geannuleerd"
}

De backend voegt automatisch het juiste domein toe.

Meerdere klanten

Laat Framer een clientId meesturen en pas het backend-script aan om op basis van die ID de juiste Stripe-key op te halen.

