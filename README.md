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

----

EXTRA README 

README: WeightMaster Webshop Setup (op basis van Webshop Master Template)
Stap 1 - Clone & Setup
- Dupliceer het project via GitHub + Vercel.
- Zet Framer live als `weightmaster.framer.website`.
- Update in Vercel:
- checkoutSlug op basis van projectnaam
- .env met Stripe keys van WeightMaster
- sheet-config.json met juiste Google Sheet ID
Stap 2 - CMS Invullen in Framer
Productvelden:
- Product Name
- Product Image
- Product Price
- Stripe Price ID
- Stripe Product Id
- Checkout Slug
- Weight (g)
- Free Shipping Treshold
- (Optioneel) Discount Code / Amount
Stap 3 - Checkout URL
https://weightmaster-checkout.vercel.app/api/checkout
Stap 4 - Ordermail
- Brevo-template instellen
- API key in .env
- SPF/DKIM via klantdomein
Stap 5 - Google Sheet Logging
- Logging in tab 'Bestelde producten'
- Keuze via checkoutSlug > sheet-config.json
Stap 6 - Kortingscodes via CMS (optioneel)
1. Voeg toe in CMS:
- Discount Code
- Discount Amount
- Discount Type (percentage / fixed)
2. Voeg toe aan cartItem in AddToCartButton
3. Verwerk in checkout.js
4. Toon in mail + sheet als metadata
Bestandstructuur
- /api/checkout.js = Stripe sessie + metadata
- /api/webhook.js = Logging naar Google Sheets
- /api/stripe-webhook.js = Ordermail via Brevo
- /emails/OrderEmail.js = (niet actief)
Stel gerust vragen voor uitbreiding zoals:
- Automatische kortingen
- Banners of kortingsmelding