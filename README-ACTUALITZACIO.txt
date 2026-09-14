ACTUALITZACIÓ FASE 2 — DIGITALITZACIÓ 4ESO

Substitueix NOMÉS aquestes carpetes/fitxers al repositori GitHub:
- public/app.js
- public/style.css
- public/index.html
- src/worker.js

NO substitueixis wrangler.toml.
NO cal tocar la base de dades D1 per aquesta actualització.

Novetats:
- Errors API més clars si Cloudflare retorna HTML o una resposta inesperada.
- Els exercicis carreguen ara els tests_json des de l'endpoint complet.
- Panell de professor per veure entregues.
- Visualització del codi i feedback de la IA.
- Validació manual de la nota final (0–10).
- Millores visuals i d'estat de les entregues.

Per convertir un usuari existent en professor, a D1 Console executa:
UPDATE users SET role='teacher' WHERE email='EL_TEU_CORREU';

Canvia EL_TEU_CORREU pel correu del teu compte.
