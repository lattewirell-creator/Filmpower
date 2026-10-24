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

- **Admin:** Gå till `/nyheter/`, välj **Admin** och logga in med din `ADMIN_CODE`. Under **Skriv nyhet** publicerar du nyheter. Under **Koder** skapar du en personlig kod till varje medlem. Koden visas bara en gång, så kopiera den och skicka den till personen.
- **Medlemmar med konto:** Går till `/nyheter/`, klickar **Skapa konto** och väljer användarnamn och lösenord. Kontot väntar sedan på godkännande. Du godkänner, spärrar eller tar bort konton under fliken **Konton**. Siffran på fliken visar hur många som väntar.
- **Bilder:** Under **Skriv nyhet** klickar du **Lägg till bild**. Bilden krymps automatiskt till max 1600 pixlar och sparas i databasen. Bara inloggade ser bilderna. Tar du bort nyheten försvinner bilden också.
- **Flödet:** Inläggen visas som på Twitter, med gilla, kommentera, visningar, spara och dela. Klicka på ett inlägg för att öppna det och läsa kommentarerna. Flikarna **Nyheter**, **Populärt** (mest gillat) och **Sparade** finns för alla. Sortera med **Nyast först** eller **Äldst först**.
- **Fästa inlägg:** Klicka på **⋯** på ett inlägg och välj **Fäst högst upp**, eller kryssa i rutan när du skriver. Där kan du också ta bort inlägget.
- **Statistik:** Fliken **Statistik** visar inlägg, visningar, gillningar, kommentarer, konton och de mest lästa inläggen.
- **Verifiering:** Under **Konton** klickar du **Verifiera** på ett godkänt konto. Personen får en grön bock och kan publicera egna inlägg under **Skriv**. Inläggen visas med personens eget namn och profilbild. Man kan ta bort sina egna inlägg. Bara admin kan fästa inlägg.
- **Kommentarer:** Alla inloggade kan kommentera och svara på kommentarer med **Svara**.
- **Mitt konto:** Klicka på ditt namn uppe till höger. Där byter du profilbild, visningsnamn och lösenord. Ändringarna syns även på gamla inlägg och kommentarer.
- **Fler admins:** Låt personen skapa ett eget konto. Godkänn det under **Konton** och klicka **Gör till admin**. Personen loggar sedan in under **Medlem** med sitt användarnamn och lösenord och får adminverktygen automatiskt. Klicka **Ta bort admin** för att ta tillbaka behörigheten.
- **Medlemmar med kod:** Klickar **Logga in med kod** under **Medlem** och loggar in med koden de har fått. Både konto- och kodmedlemmar kan läsa men inte ändra något.
- **Spärra en kod:** Klicka på **Spärra** vid koden under **Koder**. Personen loggas ut direkt.
- **Byta adminkod:** Ändra `ADMIN_CODE` i Vercel och gör en ny Redeploy. Alla som är inloggade loggas då ut.

## Säkerhet

- Koderna sparas som hashar i databasen, inte i klartext.
- Lösenord sparas med scrypt och unikt salt per konto.
- Efter 10 felaktiga inloggningsförsök på en kvart spärras IP-adressen i 15 minuter. Lyckade inloggningar räknas inte.
- Sessionen ligger i en signerad, HttpOnly-cookie som gäller i 30 dagar.

## Felsökning

- **Kolla inställningarna:** Öppna `/api/me`. Under `setup` ser du om databas och adminkod är inställda i den miljö som körs.
- **Ändrat en variabel i Vercel?** Ändringen syns först efter en ny deployment. Klicka **⋯** på den översta raden under **Deployments** (inte menyn uppe till höger) och välj **Redeploy**. En ny rad ska dyka upp överst.
- **Bytt adminkod:** Alla som var inloggade som admin loggas ut när den nya koden har slagit igenom.
