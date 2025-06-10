# Reference Templates

Deze map bevat template bestanden die als referentie dienen en NIET verwijderd mogen worden.

## Inhoud

### brevo-email-template.html
- Template voor Brevo email service
- Moet handmatig worden toegevoegd in Brevo dashboard
- Bevat de HTML structuur voor order bevestigings-emails

### Framer Components
- AddToCartButton.tsx - Referentie implementatie van de winkelwagen knop
- CartList.tsx - Referentie implementatie van de winkelwagen lijst
- CartShippingEstimate.tsx - Referentie implementatie van verzendkosten berekening
- CartSubtotal.tsx - Referentie implementatie van subtotaal berekening
- FreeShippingNotice.tsx - Referentie implementatie van gratis verzending melding
- StripeCartCheckout.tsx - Referentie implementatie van Stripe checkout integratie 

## Environment Variables

### Email Webhook (api/stripe-webhook.js)
- `BREVO_API_KEY` - API key voor Brevo email service
- `BREVO_TEMPLATE_ID` - Template ID in Brevo dashboard
- `BREVO_FROM_EMAIL` - Afzender email adres
- `STRIPE_WEBHOOK_SECRET` - Webhook secret voor email notificaties

### Google Sheets Webhook (api/webhook.js)
- `STRIPE_WEBHOOK_SECRET_SHEET` - Webhook secret voor Google Sheets logging
- `DEFAULT_SHEET_ID` - ID van het Google Sheet voor order logging
- `GOOGLE_SERVICE_KEY` - Google Service Account credentials voor Sheets API

### Stripe API
- `STRIPE_SECRET_KEY` - Stripe API secret key voor betalingen 