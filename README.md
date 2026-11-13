# Atelier · Virtual Wardrobe

Interfaccia web responsive per organizzare capi, comporre outfit su un avatar 3D e salvare i propri look.

## Modalità locale

L’app si apre direttamente, senza account, schermate di login/registrazione o credenziali email/password. Guardaroba, look, stato lavanderia e archivio vengono salvati in `localStorage` e restano su questo browser/dispositivo. Non vengono sincronizzati né condivisi; feed, recensioni e cerchie sociali non sono disponibili in modalità locale. I vecchi hash di accesso salvati dall’app vengono rimossi all’avvio; i dati del guardaroba già presenti nella cache locale vengono mantenuti.

## Avvio locale

Avvia `serve.ps1` e apri `http://127.0.0.1:8765/`. Il server è statico e non gestisce account o dati remoti. Three.js, OrbitControls e GLTFLoader vengono caricati da CDN con URL di riserva; la connessione internet è necessaria per la scena 3D e i modelli vengono precaricati prima di abilitare il selettore.

I modelli `assets/manichino-maschio.glb` e `assets/manichino donna.glb` sono i file usati dall’app. La scena ne normalizza altezza e punto d’appoggio, applica materiali opachi uniformi e abilita le ombre su entrambi. Le geometrie dimostrative dei capi si adattano alle sezioni del corpo misurate nel modello selezionato; quando coesistono top e capospalla, il capospalla viene costruito sopra il top con un volume esterno maggiorato. Questa è una vestizione volumetrica semplificata, non una simulazione realistica del tessuto.

## Stato lavanderia e drop anatomici

Lo stato `inLavaggio` viene salvato nel browser. La pagina Lavatrice usa un carosello touch; confermando il lavaggio il capo torna subito disponibile. Le hitbox per torso/spalle, bacino/gambe, piedi, testa e polsi sono invisibili per impostazione predefinita e accettano i drop in base alla categoria. Per mostrarle temporaneamente a scopo di debug, impostare `window.WARDROBE_DEBUG_HITBOXES = true` prima del caricamento di `src/avatar3d.js`.

## Archivio

La sezione Archivio conserva localmente la cronologia dei capi rimossi. I dati restano disponibili solo finché non vengono cancellati i dati del sito dal browser.

## Carosello e vestibilità

Il carosello sotto il manichino usa le immagini del guardaroba con prospettiva Cover Flow e spaziatura ampia; si scorre trascinando orizzontalmente con il mouse o con un gesto touch, senza frecce. Trascina un capo sul modello o seleziona il capo centrale per indossarlo; un secondo clic sul capo nel pannello laterale lo rimuove. La vestibilità dei capi si regola dal cursore desktop o con il pinch a due dita sul manichino.

## Foto dei capi

Per aggiungere un capo scegli Galleria, File oppure Scatta foto. La fotocamera richiede il permesso del browser e una pagina su `localhost` o HTTPS; si può annullare in qualsiasi momento e lo stream viene chiuso dopo lo scatto, l’annullamento o l’uscita dalla pagina. Sono supportati JPG, PNG e WEBP fino a 10 MB. Le immagini vengono ridotte e analizzate nel browser prima di essere salvate: i pixel chiari e neutri collegati ai bordi vengono resi trasparenti con Canvas, preservando il capo e i dettagli opachi. L’elaborazione non invia immagini a servizi esterni; sfondi colorati, complessi o non riconosciuti restano nell’immagine originale.

## Virtual Try-On

La scena 3D mostra capi demo come geometrie volumetriche semplificate. Non simula ancora tessuti, pieghe o vestibilità reale. Per questo serve un servizio AI e un backend che protegga credenziali e gestisca le immagini.

Per collegare un backend, imposta la sua URL in `window.WARDROBE_CONFIG` prima del caricamento di `src/app.js` in `index.html`:

```html
<script>
  window.WARDROBE_CONFIG = {
    tryOnEndpoint: "https://tuo-backend.example/api/try-on"
  };
</script>
<script src="./src/app.js" defer></script>
```

Il browser invia una richiesta `POST` multipart al backend solo dopo la selezione esplicita di una foto della persona e la conferma del consenso. I campi sono:

- `person`: foto della persona scelta per il try-on;
- `garment`: foto del capo selezionato dal guardaroba;
- `category`: categoria del capo.

Il backend deve rispondere con JSON contenente `result_image` come data URI immagine Base64 (`data:image/png;base64,...`, JPEG o WEBP), oppure `result_image_base64` con i soli dati Base64 di un PNG. La risposta viene mostrata come anteprima AI separata: non viene presentata come tessuto applicato alla mesh 3D.

## Struttura

- `index.html` e `INDEX ward.html`: layout e punti di ingresso delle integrazioni;
- `styles.css`: tema Minimal Boutique e layout responsive;
- `src/avatar3d.js`: scena Three.js, caricamento GLB, controlli orbitali, hitbox per i drop e geometrie dei capi demo;
- `src/tryon-service.js`: client del contratto HTTP Virtual Try-On;
- `src/app.js`: guardaroba locale, lavatrice, archivio, caricamento immagini e interazioni;
- `serve.ps1`: server statico locale limitato a `127.0.0.1:8765`.
