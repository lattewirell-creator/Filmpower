# Film Power

Webbplats och nyhetsapp för Film Power, byggd för Vercel.

- `/` är webbplatsen.
- `/nyheter/` är nyhetsappen. Där loggar man in med en kod.
- `/api/` är servern som sköter inloggning, nyheter och koder.

## Så sätter du upp den på Vercel

1. Ladda upp alla filer och mappar till GitHub-repot `filmpower` och koppla repot till Vercel.
2. **Databas:** I Vercel-projektet går du till **Storage → Create Database** och väljer **Upstash for Redis** (gratisnivån räcker). Klicka **Connect** till projektet `filmpower`. Vercel lägger själv in nycklarna.
3. **Adminkod:** Gå till **Settings → Environment Variables** och lägg till
   - `ADMIN_CODE` = en lång hemlig kod som bara du känner till, till exempel `FP-ADMIN-mitt-hemliga-ord-2026`
4. Gå till **Deployments**, klicka på de tre prickarna vid den senaste och välj **Redeploy**.

## Så används appen

- **Admin:** Gå till `/nyheter/` och logga in med din `ADMIN_CODE`. Under **Skriv nyhet** publicerar du nyheter. Under **Koder** skapar du en personlig kod till varje medlem. Koden visas bara en gång, så kopiera den och skicka den till personen.
- **Medlemmar med konto:** Går till `/nyheter/`, klickar **Skapa konto** och väljer användarnamn och lösenord. Kontot väntar sedan på godkännande. Du godkänner, spärrar eller tar bort konton under fliken **Konton**. Siffran på fliken visar hur många som väntar.
- **Medlemmar med kod:** Väljer **Kod** på inloggningssidan och loggar in med koden de har fått. Både konto- och kodmedlemmar kan läsa men inte ändra något.
- **Spärra en kod:** Klicka på **Spärra** vid koden under **Koder**. Personen loggas ut direkt.
- **Byta adminkod:** Ändra `ADMIN_CODE` i Vercel och gör en ny Redeploy. Alla som är inloggade loggas då ut.

## Säkerhet

- Koderna sparas som hashar i databasen, inte i klartext.
- Lösenord sparas med scrypt och unikt salt per konto.
- Inloggningen är begränsad till 10 försök per kvart per IP-adress.
- Sessionen ligger i en signerad, HttpOnly-cookie som gäller i 30 dagar.
