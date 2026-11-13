(function () {
  "use strict";

  function endpoint() {
    const config = window.WARDROBE_CONFIG;
    return config && typeof config.tryOnEndpoint === "string"
      ? config.tryOnEndpoint.trim()
      : "";
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(",");
    const match = parts[0].match(/data:(.*?);base64/);
    if (!match) throw new Error("Immagine del capo non valida.");
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] });
  }

  async function generate(input) {
    const url = endpoint();
    if (!url) throw new Error("Virtual Try-On non configurato. Imposta WARDROBE_CONFIG.tryOnEndpoint in index.html.");
    if (!input.personFile || !input.garmentDataUrl) throw new Error("Servono una foto della persona e un capo caricato.");

    const payload = new FormData();
    payload.append("person", input.personFile, input.personFile.name || "person.jpg");
    const garment = dataUrlToBlob(input.garmentDataUrl);
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[garment.type];
    if (!extension) throw new Error("Formato immagine del capo non supportato.");
    payload.append("garment", garment, `garment.${extension}`);
    payload.append("category", input.category);

    const response = await fetch(url, { method: "POST", body: payload });
    if (!response.ok) {
      throw new Error(`Il servizio Virtual Try-On ha risposto con errore (${response.status}).`);
    }

    const result = await response.json();
    let image = result && result.result_image;
    if (!image && result && result.result_image_base64) {
      image = `data:image/png;base64,${result.result_image_base64}`;
    }
    if (typeof image !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(image)) {
      throw new Error("La risposta del servizio non contiene un’immagine valida nel campo result_image.");
    }
    return image;
  }

  window.WardrobeTryOnService = {
    isConfigured: function () { return endpoint().length > 0; },
    generate: generate
  };
})();
