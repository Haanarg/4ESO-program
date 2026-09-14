# Digitalització 4ESO — MVP Cloudflare

Aquesta versió està preparada per desplegar-la **sense instal·lar Node.js al teu ordinador**.
La via recomanada és pujar el projecte a GitHub des del navegador i connectar el repositori amb Cloudflare Workers Builds.

## Què inclou

- registre d'alumnes
- inici de sessió
- curs amb capítols 1 i 2
- activitats 1.1–1.3 i 2.1–2.4
- editor Python al navegador amb Pyodide
- execució i resultats
- enviament d'entregues
- historial d'entregues
- proposta de correcció IA
- API de professor per validar notes
- Cloudflare Workers + D1

## Desplegament sense Node.js

### 1. Crear un repositori a GitHub

Des de github.com, crea un repositori nou, per exemple:

`digitalitzacio-4eso`

No cal instal·lar Git. GitHub permet pujar els fitxers des del navegador.

Després, a **Add file → Upload files**, arrossega el contingut d'aquesta carpeta (no el ZIP dins d'un altre ZIP).

### 2. Crear la base de dades D1

Al tauler de Cloudflare:

**Workers & Pages → D1 → Create database**

Nom recomanat:

`digitalitzacio-4eso`

Guarda l'identificador de la base de dades.

### 3. Posar l'ID de D1 al projecte

A GitHub obre `wrangler.toml` i canvia:

`REPLACE_WITH_D1_DATABASE_ID`

pel valor real de `database_id` que t'ha donat Cloudflare.

Desa el canvi.

### 4. Crear les taules

Al tauler de Cloudflare obre la base D1 i entra a l'eina de consulta SQL.

Obre el fitxer:

`migrations/0001_initial.sql`

Copia'n el contingut a la consulta SQL i executa'l.

Això crea les taules d'usuaris, sessions, exercicis i entregues.

### 5. Connectar GitHub amb Cloudflare

Al tauler de Cloudflare:

**Workers & Pages → Create application → Workers → Import from Git / Connect to Git**

Selecciona el repositori `digitalitzacio-4eso`.

Configuració:

- Build command: `npm run deploy`
- Root directory: `/`
- Production branch: la branca principal (`main` habitualment)

Cloudflare farà la instal·lació de Wrangler i el desplegament al seu propi entorn. **No cal Node.js local.**

### 6. Configurar la clau de la IA

Al Worker, ves a **Settings → Variables and Secrets** i crea un secret:

`OPENAI_API_KEY`

amb la teva clau de l'API del proveïdor que vulguis utilitzar.

La clau no ha d'anar mai dins de `public/app.js`.

> Nota: el nom del model és configurable amb `AI_MODEL`. Abans de producció cal posar-hi el model que realment tinguis disponible al teu proveïdor d'IA.

### 7. Domini propi

Quan el Worker funcioni, a **Settings → Domains & Routes → Custom Domains** pots afegir el teu domini o un subdomini, per exemple:

`curs.elteudomini.cat`

Si el domini encara no utilitza els DNS de Cloudflare, Cloudflare et mostrarà els passos necessaris per configurar-los.

## Important

Aquesta és una primera versió funcional de desenvolupament. Abans de donar-la als alumnes cal reforçar:

- recuperació de contrasenya
- verificació de correu si la vols
- protecció contra intents de login
- validació més estricta de les entregues
- tests ocults reals per activitat
- panell de professor complet
- revisió de la política de privacitat i dades d'alumnes
- sandbox addicional per als exercicis que necessitin executar Python al servidor

## Estructura

- `public/` — interfície web
- `src/worker.js` — API i Worker
- `migrations/` — SQL de D1
- `wrangler.toml` — configuració Cloudflare
- `package.json` — permet que Cloudflare instal·li Wrangler durant el desplegament
