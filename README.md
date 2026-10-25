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

- **Öppet för alla:** Vem som helst kan läsa nyheterna, öppna inlägg, se kommentarer och profiler på filmpower.vercel.app/nyheter utan konto. Knappen **Logga in** uppe till höger behövs bara för att gilla, spara, kommentera och skriva.

- **Admin:** Gå till `/nyheter/`, välj **Admin** och logga in med din `ADMIN_CODE`. Under **Skriv nyhet** publicerar du nyheter. Under **Koder** skapar du en personlig kod till varje medlem. Koden visas bara en gång, så kopiera den och skicka den till personen.
- **Medlemmar med konto:** Går till `/nyheter/`, klickar **Skapa konto** och väljer användarnamn och lösenord. Kontot är aktivt direkt och personen loggas in automatiskt. Under fliken **Konton** kan du verifiera, spärra eller ta bort konton.
- **Bilder:** Under **Skriv nyhet** klickar du **Lägg till bild**. Bilden krymps automatiskt till max 1600 pixlar och sparas i databasen. Bara inloggade ser bilderna. Tar du bort nyheten försvinner bilden också.
- **Flödet:** Inläggen visas som på Twitter, med gilla, kommentera, visningar, spara och dela. Klicka på ett inlägg för att öppna det och läsa kommentarerna. Flikarna **Nyheter**, **Populärt** (mest gillat) och **Sparade** finns för alla. Sortera med **Nyast först** eller **Äldst först**.
- **Fästa inlägg:** Klicka på **⋯** på ett inlägg och välj **Fäst högst upp**, eller kryssa i rutan när du skriver. Där kan du också ta bort inlägget.
- **Statistik:** Fliken **Statistik** visar inlägg, visningar, gillningar, kommentarer, konton och de mest lästa inläggen.
- **Verifiering:** Under **Konton** klickar du **Verifiera** på ett konto. Personen får en grön filmklappa med bock (Film Power har en i guld) och kan publicera egna inlägg under **Skriv**. Inläggen visas med personens eget namn och profilbild. Man kan ta bort sina egna inlägg. Bara admin kan fästa inlägg.
- **Kommentarer:** Alla inloggade kan kommentera och svara på kommentarer med **Svara**.
- **Profiler:** Fliken **Medlemmar** listar alla godkända medlemmar med sökruta. Klicka på en person, eller på någons profilbild eller namn på ett inlägg eller vid en kommentar, för att se profilen och personens inlägg. Film Power har en egen profil.
- **Taggar:** Skriv @användarnamn, till exempel @filmpower, i en bio, ett inlägg eller en kommentar så blir det en länk till profilen. Bara användarnamn som finns blir länkar.
- **Affiliates:** Under **Konton** väljer du i listan vilket konto personen är affiliate till, till exempel Film Power eller ett annat konto. Personen får ett litet märke med det kontots profilbild efter sitt namn, som på Twitter. Klick på märket öppnar kontots profil.
- **Skriv med ett klick:** Admin och verifierade konton har en grön knapp nere till höger, som på Twitter. Den öppnar en ruta där du skriver ett inlägg var du än är i appen.
- **Följa:** Tryck **Följ** på en profil, till exempel Film Power. Under fliken **Följer** samlas inläggen från dem du följer. Profilerna visar antal följare.
- **Drivs av:** Företagskonton visar vilka som driver dem, med länk till deras profiler. Film Power drivs av @lattewirell och @melvin. Admin ändrar listan med **Ändra** på profilen.
- **Video i inlägg:** Under Skriv finns **Lägg till video** (MP4, WebM eller MOV, högst 100 MB). Videon laddas upp direkt till Vercel Blob med förlopp i procent och spelas upp i flödet. Kräver en publik Blob-lagring kopplad till projektet i Vercel. När ett inlägg tas bort raderas även videon.
- **@ceo:** Skriver man @ceo i ett inlägg eller en kommentar blir det en länk till Film Powers profil. Användarnamnen filmpower och ceo går inte att registrera.
- **Mitt konto:** Klicka på ditt namn uppe till höger. Profilen ser ut som på Twitter med banner, profilbild, bio och flikarna Inlägg, Gillade och Sparade. Under **Redigera profil** byter du banner (kameraknappen på bannern), profilbild (klicka på bilden), namn, bio och lösenord. När du väljer en ny bild öppnas **Justera bild**, där du drar bilden på plats, zoomar med reglaget (eller nyp med två fingrar på mobilen) och vrider den med pilknappen innan du trycker **Använd**. Med **Justera** kan du också flytta och zooma bilden du redan har. Film Power har en egen banner med loggan och kameran.
- **Anonymt läge:** Kryssa i **Logga in anonymt** vid inloggningen, eller slå på det under Redigera profil. Kommentarerna visas då som **Anonym** utan namn och bild. Admin ser fortfarande vem som skrivit. Inlägg publiceras alltid med namn.
- **Fler admins:** Låt personen skapa ett eget konto. Klicka **Gör till admin** under **Konton**. Personen loggar sedan in under **Medlem** med sitt användarnamn och lösenord och får adminverktygen automatiskt. Klicka **Ta bort admin** för att ta tillbaka behörigheten.
- **Medlemmar med kod:** Klickar **Logga in med kod** under **Medlem** och loggar in med koden de har fått. Både konto- och kodmedlemmar kan läsa men inte ändra något.
- **Spärra en kod:** Klicka på **Spärra** vid koden under **Koder**. Personen loggas ut direkt.
- **Byta adminkod:** Ändra `ADMIN_CODE` i Vercel och gör en ny Redeploy. Alla som är inloggade loggas då ut.

## Bygg med AI (för admin)

När du är inloggad som admin finns knappen **Bygg med AI** i hemsidans sidomeny (på mobil som en ikon bredvid menyknappen) och i bloggens sidhuvud bredvid Logga ut. Beskriv vad du vill ändra eller bygga, till exempel "Lägg till en sektion med kundomdömen under priserna" eller "Gör en knapp för att dela inlägg på Instagram". AI:n letar upp rätt ställe i koden, gör ändringarna och kan också skriva, ta bort och fästa blogginlägg.

Utöver att ändra sidorna kan AI:n bygga helt nya sidor (de visas på `/sida/namn`), hitta fria bilder och spara dem hos sajten, använda bilder du laddar upp med bildknappen i panelen, läsa andra webbsidor, visa statistik och godkänna, blockera eller verifiera konton. Bilderna sparas i Vercel Blob om den är kopplad, annars i databasen.

AI:n kräver en kod utöver admin-inloggningen. Panelen frågar efter den första gången i varje flik. Efter 10 fel koder låses AI:n i 15 minuter. Vill du byta kod, lägg in en ny som `AI_CODE` under Environment Variables på Vercel och gör en redeploy.

- **Inget går ut förrän du trycker Publicera.** Du ser vilka filer som ändrats och kan öppna **Förhandsgranska** för att se sidan i en ny flik först. Vill du justera något skriver du det innan du publicerar.
- **Kontroll innan publicering:** trasig JavaScript, trasig serverkod eller en sida som tömts stoppas automatiskt.
- **Ångra:** den senaste AI-ändringen kan ångras med ett klick i panelen. Hela historiken finns också på GitHub.
- **Låsta filer:** inloggning, sessioner och AI-panelen själv (api/_lib.js, api/_agent.js, api/users.js, api/login.js, api/logout.js, api/me.js, vendor/, vercel.json och package.json). Då kan en ändring aldrig låsa ute dig eller stoppa Ångra.
- I fullt läge blir varje publicering en deploy på Vercel. Samla gärna flera ändringar i samma uppdrag.

**Två lägen**

- **Med bara `GROQ_API_KEY` (som nu):** AI:n ändrar hemsidan och bloggen (text, design och funktioner i sidorna) och blogginläggen. Ändringarna sparas i databasen och syns några sekunder efter Publicera, utan deploy. Varje sida har ett litet skript överst i `<head>` som visar AI-versionen om det finns en. Ändras själva sidfilen senare (en ny deploy) slutar AI-versionen gälla, så den döljer aldrig nyare ändringar. Då ber man AI:n göra om ändringen.
- **Med även `GITHUB_TOKEN`:** AI:n sparar ändringarna i GitHub-repot och kan också ändra serverkoden och skapa nya filer. Varje publicering blir en deploy.

**Valfritt: en GitHub-nyckel för fullt läge**

1. På github.com: klicka på din profilbild, sedan **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens** och **Generate new token**.
2. Namn: `filmpower-ai`. Välj hur länge den ska gälla, t.ex. ett år.
3. Under **Repository access**: välj **Only select repositories** och sedan **Filmpower**.
4. Under **Permissions**, **Repository permissions**: sätt **Contents** till **Read and write**.
5. Klicka **Generate token** och kopiera nyckeln (den visas bara en gång).
6. I Vercel: **Settings**, **Environment Variables**, lägg till `GITHUB_TOKEN` med nyckeln som värde. Gör sedan en **Redeploy**.

AI:n använder samma `GROQ_API_KEY` som nyhetsboten.

## Filmguiden på startsidan

Knappen **Fråga Filmguiden** nere till höger på startsidan öppnar en AI-chatt som föreslår filmset (kamera, ljud, ljus, stativ) inom besökarens budget och ger råd för olika projekt, från YouTube-videor till större filmer. Den använder samma AI-nyckel som nyhetsboten (`GROQ_API_KEY` eller `ANTHROPIC_API_KEY`) och tillåter högst 40 frågor i timmen per besökare.

## Nyhetsboten

Varje morgon runt klockan 06–07 hämtar boten färska filmnyheter från Variety, IndieWire, Deadline, The Hollywood Reporter, No Film School och DiscussingFilm och publicerar dem som Film Power, med artikelbild och länken "Källa: Variety" till originalartikeln. Den tar bara nyheter från de senaste två dygnen och publicerar aldrig samma nyhet två gånger.

- **Svenska texter:** Lägg till miljövariabeln `ANTHROPIC_API_KEY` (en API-nyckel från console.anthropic.com) på Vercel och gör en redeploy. Då väljer Claude ut de bästa nyheterna för filmskapare och skriver rubrik och text på svenska. Det går lika bra med en gratis Groq-nyckel från console.groq.com: lägg in den som `GROQ_API_KEY` i stället (modellen kan väljas med `GROQ_MODEL`). Finns båda används Claude. AI:n väljer först vilka nyheter som är bäst. Sedan skrivs varje nyhet för sig, bara utifrån sin egen rubrik och ingress, så att text, länk och bild alltid hör till samma artikel. En text som innehåller siffror som inte står i källan underkänns och skrivs om. Äldre inlägg skrivs om på samma sätt vid nästa körning. Med en AI-nyckel publiceras aldrig något på engelska. Svarar inte AI:n står felet i rutan **Nyhetsboten** under Statistik. Nyheter som publicerats på engelska innan nyckeln fanns översätts till svenska vid nästa körning, eller direkt med **Hämta nyheter nu**. Utan nyckel publiceras originalrubrik och ingress på engelska.
- **Antal per dag:** Standard är 3. Ändra med miljövariabeln `BOT_POSTS_PER_DAY` (1–10).
- **Testa källorna:** Under **Actions** på GitHub kör **Testa nyhetsboten** och visar vad varje källa ger just nu.
- **Ta bort felaktiga nyheter:** Knappen bredvid **Hämta nyheter nu** tar bort botens nyheter som skrevs med den gamla metoden och inte är kontrollerade mot källan. Boten kan sedan skriva samma nyheter rätt.
- **Köra direkt:** Admin hittar **Nyhetsboten** under **Statistik** med knappen **Hämta nyheter nu** och status för senaste körningen.
- **Extra skydd (valfritt):** Sätt `CRON_SECRET` på Vercel, så tar boten bara emot schemalagda anrop som bär den hemligheten.
- **Egna källor (valfritt):** `BOT_FEEDS` ersätter listan, till exempel `Variety|https://variety.com/v/film/feed/,IndieWire|https://www.indiewire.com/feed/`.

## Säkerhet

- Koderna sparas som hashar i databasen, inte i klartext.
- Lösenord sparas med scrypt och unikt salt per konto.
- Efter 10 felaktiga inloggningsförsök på en kvart spärras IP-adressen i 15 minuter. Lyckade inloggningar räknas inte.
- Sessionen ligger i en signerad, HttpOnly-cookie som gäller i 30 dagar.

## Felsökning

- **Kolla inställningarna:** Öppna `/api/me`. Under `setup` ser du om databas och adminkod är inställda i den miljö som körs.
- **Ändrat en variabel i Vercel?** Ändringen syns först efter en ny deployment. Klicka **⋯** på den översta raden under **Deployments** (inte menyn uppe till höger) och välj **Redeploy**. En ny rad ska dyka upp överst.
- **Bytt adminkod:** Alla som var inloggade som admin loggas ut när den nya koden har slagit igenom.
