(function () {
  "use strict";

  const STORAGE_KEY = "atelier-wardrobe-v1";
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const CATEGORY_LABELS = {
    top: "Parte superiore",
    bottom: "Parte inferiore",
    outerwear: "Capospalla",
    shoes: "Scarpe",
    head: "Accessori · testa",
    accessory: "Accessori · altro"
  };
  const CATEGORY_ICONS = {
    top: "◒",
    bottom: "╱",
    outerwear: "◇",
    shoes: "⌁",
    head: "⌃",
    accessory: "◌"
  };
  const DEMO_ITEMS = [
    { id: "atelier-demo-top", name: "Maglia in cashmere", category: "top", color: "#b7aa91", demo: true },
    { id: "atelier-demo-trousers", name: "Pantalone sartoriale", category: "bottom", color: "#555a5a", demo: true },
    { id: "atelier-demo-coat", name: "Cappotto doppiopetto", category: "outerwear", color: "#80796d", demo: true },
    { id: "atelier-demo-shoes", name: "Mocassino in pelle", category: "shoes", color: "#d0c6b5", demo: true },
    { id: "atelier-demo-hat", name: "Cappello in feltro", category: "head", color: "#625d51", demo: true },
    { id: "atelier-demo-bag", name: "Borsa mini", category: "accessory", color: "#8f7466", demo: true }
  ];

  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const grid = $("#clothingGrid");
  const savedList = $("#savedList");
  const uploadArea = $("#uploadArea");
  const galleryInput = $("#galleryInput");
  const fileInput = $("#fileInput");
  const toast = $("#toast");
  let state = null;
  let filter = "all";
  let carouselCategory = "top";
  let carouselIndex = 0;
  let carouselSignature = "";
  let avatar = null;
  let toastTimer = 0;
  let tryOnItemId = null;
  let washingItemId = null;
  let cameraStream = null;
  let activeScreen = "wardrobe";

  function defaultState() {
    return {
      items: DEMO_ITEMS.map(function (item) { return Object.assign({}, item); }),
      outfit: {},
      saved: [],
      archived: [],
      fitScale: 100
    };
  }

  function readState() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const legacyKeys = Object.keys(localStorage).filter(function (key) {
          return key.indexOf(`${STORAGE_KEY}:`) === 0;
        });
        if (legacyKeys.length === 1) {
          raw = localStorage.getItem(legacyKeys[0]);
          if (raw) localStorage.setItem(STORAGE_KEY, raw);
        } else if (legacyKeys.length > 1) {
          showToast("Trovati più guardaroba locali precedenti. I dati originali restano conservati.");
        }
      }
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed.items) ? parsed.items.map(function (item) {
        return Object.assign({}, item, { inLavaggio: item.inLavaggio === true });
      }) : DEMO_ITEMS.map(function (item) { return Object.assign({}, item, { inLavaggio: false }); });
      const outfit = parsed.outfit && typeof parsed.outfit === "object" ? Object.assign({}, parsed.outfit) : {};
      Object.keys(outfit).forEach(function (slot) {
        const item = items.find(function (candidate) { return candidate.id === outfit[slot]; });
        if (!item || item.inLavaggio) delete outfit[slot];
      });
      return {
        items: items,
        outfit: outfit,
        saved: Array.isArray(parsed.saved) ? parsed.saved : [],
        archived: Array.isArray(parsed.archived) ? parsed.archived : [],
        fitScale: Number.isFinite(parsed.fitScale) ? Math.min(120, Math.max(80, parsed.fitScale)) : 100,
        currentLookName: typeof parsed.currentLookName === "string" ? parsed.currentLookName : ""
      };
    } catch (error) {
      console.error("Impossibile leggere il guardaroba salvato:", error);
      showToast("Impossibile leggere il guardaroba salvato. È stata caricata una collezione vuota.");
      return { items: [], outfit: {}, saved: [], fitScale: 100 };
    }
  }

  function persist() {
    if (!state) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Impossibile salvare il guardaroba:", error);
      showToast("Spazio browser esaurito. Rimuovi qualche foto e riprova.");
      return false;
    }
    return true;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove("visible"); }, 3000);
  }

  function initializeLocalApp() {
    try {
      localStorage.removeItem("atelier-accounts-v1");
    } catch (error) {
      console.error("Impossibile rimuovere i dati di accesso legacy:", error);
    }
    state = readState();
    state.archived = Array.isArray(state.archived) ? state.archived : [];
    activeScreen = "wardrobe";
    showScreen("wardrobe");
    initializeAvatar();
    render();
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || "Accessori";
  }

  function safeImageSource(source) {
    return typeof source === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(source)
      ? source
      : "";
  }

  function garmentIllustration(category, color) {
    const fill = escapeHtml(color || "#aaa18c");
    const paths = {
      top: '<path d="m35 18 13-7 8 6 8-6 13 7 11 11-8 9-8-6 3 35H34l3-35-8 6-8-9 14-11Z"/><path d="m48 11 8 10 8-10" fill="none" stroke="#262622" stroke-opacity=".38" stroke-width="1.5"/>',
      bottom: '<path d="M31 13h38l-3 22-4 34H45l-1-26-2 26H28l5-34-2-22Z"/><path d="M31 19h38" fill="none" stroke="#242521" stroke-opacity=".4" stroke-width="1.5"/>',
      outerwear: '<path d="m34 14 14-5 8 8 8-8 14 5 9 15-9 7-6-8 4 41H34l4-41-6 8-9-7 11-15Z"/><path d="m48 9 8 12 8-12-5 22 5 10-8-5-8 5 5-10-5-22Z" fill="#262622" fill-opacity=".12"/>',
      shoes: '<path d="M22 51c9 0 16-2 21-7l10-15 9 2c2 12 7 20 17 24 6 2 9 7 8 13-1 4-5 6-11 6H29c-8 0-12-4-12-10 0-7 2-11 5-13Z"/><path d="M18 65h68" fill="none" stroke="#282720" stroke-opacity=".5" stroke-width="2"/>',
      head: '<path d="M23 51c2-20 15-34 34-34s32 14 34 34H23Z"/><path d="M16 52h82v9H16z" opacity=".74"/>',
      accessory: '<path d="M29 36h48l5 37H24l5-37Z"/><path d="M40 36c0-12 5-19 13-19s13 7 13 19" fill="none" stroke="' + fill + '" stroke-width="5"/><path d="M29 45h53" fill="none" stroke="#292622" stroke-opacity=".35" stroke-width="1.5"/>'
    };
    return `<svg width="86" height="84" viewBox="0 0 112 86" role="img" aria-label="${escapeHtml(categoryLabel(category))}" style="color:${fill};fill:${fill}">${paths[category] || paths.accessory}</svg>`;
  }

  function renderCloset() {
    const items = state.items.filter(function (item) {
      if (filter === "all") return true;
      if (filter === "accessories") return item.category === "head" || item.category === "accessory";
      return item.category === filter;
    });
    const worn = Object.keys(state.outfit).map(function (slot) { return state.outfit[slot]; });
    $("#itemCount").textContent = `${state.items.length} ${state.items.length === 1 ? "capo" : "capi"}`;

    if (!items.length) {
      grid.innerHTML = '<p class="closet-empty">Nessun capo in questa selezione.<br>Carica una foto per ampliare la collezione.</p>';
      return;
    }

    grid.innerHTML = items.map(function (item) {
      const imageSource = safeImageSource(item.src);
      const image = imageSource
        ? `<img src="${imageSource}" alt="${escapeHtml(item.name)}">`
        : garmentIllustration(item.category, item.color);
      const isWorn = worn.indexOf(item.id) !== -1;
      const isWashing = item.inLavaggio === true;
      return `
        <article class="garment-card${isWorn ? " is-worn" : ""}${isWashing ? " is-washing" : ""}" draggable="${!isWashing}" data-item-id="${escapeHtml(item.id)}">
          ${isWashing ? '<span class="washing-badge" aria-label="In lavaggio">In lavaggio</span>' : ""}
          <button class="garment-select" type="button" data-wear-id="${escapeHtml(item.id)}" aria-label="${isWashing ? "Conferma capo lavato" : isWorn ? "Rimuovi" : "Indossa"} ${escapeHtml(item.name)} ${isWorn && !isWashing ? "dal manichino" : ""}">
            <div class="garment-art" style="--garment-color:${escapeHtml(item.color || "#aaa18c")}">${image}</div>
            <div class="garment-meta">
              <p class="garment-name">${escapeHtml(item.name)}</p>
              <p class="garment-type">${escapeHtml(categoryLabel(item.category))}</p>
            </div>
          </button>
          <button class="wash-item" type="button" data-wash-id="${escapeHtml(item.id)}">${isWashing ? "Segna come lavato" : "Metti in lavatrice"}</button>
          <button class="remove-garment" type="button" data-remove-id="${escapeHtml(item.id)}" aria-label="Rimuovi ${escapeHtml(item.name)}">×</button>
        </article>`;
    }).join("");
  }

  function getCarouselItems() {
    return state.items.filter(function (item) {
      return carouselCategory === "accessories"
        ? item.category === "head" || item.category === "accessory"
        : item.category === carouselCategory;
    });
  }

  function updateCarouselPositions(items) {
    if (!items.length) return;
    carouselIndex = ((carouselIndex % items.length) + items.length) % items.length;
    const worn = Object.keys(state.outfit).map(function (slot) { return state.outfit[slot]; });
    const step = Math.max(180, Math.min(228, $("#carouselTrack").clientWidth * 0.29));
    items.forEach(function (item, index) {
      const button = $("#carouselTrack").querySelector(`[data-carousel-id="${CSS.escape(item.id)}"]`);
      if (!button) return;
      let offset = index - carouselIndex;
      if (offset > items.length / 2) offset -= items.length;
      if (offset < -items.length / 2) offset += items.length;
      const distance = Math.abs(offset);
      const scale = Math.max(.48, 1.12 - distance * .2);
      const opacity = Math.max(0, 1 - distance * .34);
      const isCenter = offset === 0;
      const isWorn = worn.indexOf(item.id) !== -1;
      const isWashing = item.inLavaggio === true;
      button.classList.toggle("is-center", isCenter);
      button.classList.toggle("is-worn", isWorn);
      button.classList.toggle("is-washing", isWashing);
      button.setAttribute("aria-label", `${item.name}${isWashing ? ", in lavaggio" : isWorn ? ", indossato" : ""}`);
      button.setAttribute("draggable", isWashing ? "false" : "true");
      button.setAttribute("aria-pressed", isCenter ? "true" : "false");
      button.style.transform = `translate(-50%,-50%) translateX(${offset * step}px) translateZ(${-distance * 78}px) scale(${scale})`;
      button.style.opacity = String(opacity);
      button.style.zIndex = String(10 - distance);
      button.style.pointerEvents = distance > 2.5 ? "none" : "auto";
      button.querySelector(".carousel-worn-mark").hidden = !isWorn;
      button.querySelector(".carousel-washing-mark").hidden = !isWashing;
    });
  }

  function renderCarousel() {
    const items = getCarouselItems();
    document.querySelectorAll(".carousel-category").forEach(function (button) {
      const selected = button.dataset.carouselCategory === carouselCategory;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    if (!items.length) {
      carouselIndex = 0;
      carouselSignature = "";
      $("#carouselTrack").innerHTML = '<span class="carousel-empty">Nessun capo in questa categoria</span>';
      return;
    }

    const signature = `${carouselCategory}:${items.map(function (item) { return item.id; }).join("|")}`;
    if (signature === carouselSignature) {
        updateCarouselPositions(items);
        return;
    }

    carouselSignature = signature;
    carouselIndex = 0;
    $("#carouselTrack").innerHTML = items.map(function (item, index) {
      const imageSource = safeImageSource(item.src);
      const image = imageSource
        ? `<img src="${imageSource}" alt="" draggable="false">`
        : garmentIllustration(item.category, item.color);
      return `
        <button class="carousel-item"
          type="button" data-carousel-id="${escapeHtml(item.id)}" data-carousel-index="${index}"
          aria-label="${escapeHtml(item.name)}" aria-pressed="false" draggable="${!item.inLavaggio}"
          style="transform:translate(-50%,-50%) translateZ(-180px) scale(.48);opacity:0;z-index:0;pointer-events:none">
          <span class="carousel-art">${image}</span><span class="carousel-worn-mark" aria-hidden="true" hidden>✓</span><span class="carousel-washing-mark" aria-label="In lavaggio" hidden>In lavaggio</span>
        </button>`;
    }).join("");
    window.requestAnimationFrame(function () {
      if (carouselSignature === signature) updateCarouselPositions(getCarouselItems());
    });
  }

  function renderLook() {
    const slots = ["head", "top", "outerwear", "bottom", "shoes", "accessory"];
    const wornItems = slots.map(function (slot) {
      const id = state.outfit[slot];
      return id ? state.items.find(function (item) { return item.id === id; }) : null;
    }).filter(Boolean);

    $("#lookCaption").textContent = wornItems.length
      ? `${wornItems.length} ${wornItems.length === 1 ? "capo selezionato" : "capi selezionati"} · anteprima 3D dimostrativa`
      : "Seleziona un capo dal guardaroba per iniziare la composizione.";
    $("#lookName").textContent = state.currentLookName || "Senza titolo";
    $("#clearLook").disabled = wornItems.length === 0;

    $("#outfitList").innerHTML = `
      <div class="outfit-heading"><span>Elementi del look</span><span>${wornItems.length.toString().padStart(2, "0")}</span></div>
      ${slots.map(function (slot) {
        const item = state.items.find(function (candidate) { return candidate.id === state.outfit[slot]; });
        return `
          <div class="outfit-slot">
            <span class="slot-icon" aria-hidden="true">${CATEGORY_ICONS[slot]}</span>
            <div class="slot-copy">
              <p class="slot-label">${escapeHtml(categoryLabel(slot))}</p>
              <p class="slot-name${item ? "" : " is-empty"}">${item ? escapeHtml(item.name) : "Nessun capo"}</p>
            </div>
            ${item ? `<button class="slot-remove" type="button" data-clear-slot="${slot}" aria-label="Rimuovi ${escapeHtml(item.name)} dal look">×</button>` : ""}
          </div>`;
      }).join("")}`;
  }

  function renderSaved() {
    if (!state.saved.length) {
      savedList.innerHTML = '<span class="saved-empty">Le tue composizioni salvate compariranno qui.</span>';
      return;
    }
    savedList.innerHTML = state.saved.map(function (look) {
      return `
        <div class="saved-look">
          <button class="button-text" type="button" data-load-look="${escapeHtml(look.id)}" title="Carica ${escapeHtml(look.name)}">${escapeHtml(look.name)}</button>
          <button class="saved-delete" type="button" data-delete-look="${escapeHtml(look.id)}" aria-label="Elimina ${escapeHtml(look.name)}">×</button>
        </div>`;
    }).join("");
  }

  let laundryCarouselIndex = 0;

  function layoutLaundryCarousel(items, position) {
    const track = $("#laundryCarouselTrack");
    if (!items.length) return;
    const center = ((position % items.length) + items.length) % items.length;
    const step = Math.max(168, Math.min(220, track.clientWidth * 0.27));
    items.forEach(function (item, index) {
      const button = track.querySelector(`[data-laundry-id="${CSS.escape(item.id)}"]`);
      if (!button) return;
      let offset = index - center;
      if (offset > items.length / 2) offset -= items.length;
      if (offset < -items.length / 2) offset += items.length;
      const distance = Math.abs(offset);
      button.style.transform = `translate(-50%,-50%) translateX(${offset * step}px) translateZ(${-distance * 76}px) scale(${Math.max(.5, 1.08 - distance * .19)})`;
      button.style.opacity = String(Math.max(0, 1 - distance * .34));
      button.style.zIndex = String(10 - distance);
      button.style.pointerEvents = distance > 2.5 ? "none" : "auto";
    });
  }

  function renderLaundryCarousel() {
    if (!state) return;
    const items = state.items.filter(function (item) { return item.inLavaggio === true; });
    $("#laundryCount").textContent = `${items.length} ${items.length === 1 ? "capo" : "capi"}`;
    if (!items.length) {
      laundryCarouselIndex = 0;
      $("#laundryCarouselTrack").dataset.signature = "";
      $("#laundryCarouselTrack").innerHTML = '<span class="carousel-empty">La lavatrice è vuota · scegli i capi dal guardaroba</span>';
      return;
    }
    const signature = items.map(function (item) { return item.id; }).join("|");
    if ($("#laundryCarouselTrack").dataset.signature !== signature) {
      $("#laundryCarouselTrack").dataset.signature = signature;
      laundryCarouselIndex = 0;
      $("#laundryCarouselTrack").innerHTML = items.map(function (item, index) {
        const source = safeImageSource(item.src);
        const art = source
          ? `<img src="${source}" alt="">`
          : garmentIllustration(item.category, item.color);
        return `<button class="carousel-item is-washing" type="button" data-laundry-id="${escapeHtml(item.id)}" data-laundry-index="${index}" aria-label="Conferma lavaggio di ${escapeHtml(item.name)}" draggable="false"><span class="carousel-art">${art}</span><span class="carousel-washing-mark">In lavaggio</span></button>`;
      }).join("");
    }
    laundryCarouselIndex = ((laundryCarouselIndex % items.length) + items.length) % items.length;
    layoutLaundryCarousel(items, laundryCarouselIndex);
  }

  function renderArchive() {
    if (!state) return;
    $("#archiveCount").textContent = String(state.archived.length);
    if (!state.archived.length) {
      $("#archiveList").innerHTML = '<p class="form-help">I capi rimossi compariranno qui con data e dettagli.</p>';
      return;
    }
    $("#archiveList").innerHTML = state.archived.map(function (item) {
      const source = safeImageSource(item.src);
      const art = source ? `<img src="${source}" alt="">` : `<span class="archive-glyph">${escapeHtml(CATEGORY_ICONS[item.category] || "◌")}</span>`;
      const date = item.removedAt ? new Date(item.removedAt).toLocaleDateString("it-IT") : "Data non disponibile";
      return `<div class="archive-row">${art}<span>${escapeHtml(item.name)}<small>${escapeHtml(categoryLabel(item.category))}</small></span><time>${escapeHtml(date)}</time></div>`;
    }).join("");
  }

  function showScreen(screen) {
    const validScreens = ["wardrobe", "laundry", "archive"];
    if (validScreens.indexOf(screen) === -1) return;
    activeScreen = screen;
    document.querySelectorAll("[data-screen-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.screenPanel !== screen;
    });
    document.querySelectorAll("[data-screen-target]").forEach(function (button) {
      const selected = button.dataset.screenTarget === screen;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    if (screen === "laundry") renderLaundryCarousel();
  }

  function updateAvatar() {
    if (!avatar) return;
    const itemsBySlot = {};
    Object.keys(state.outfit).forEach(function (slot) {
      const item = state.items.find(function (candidate) { return candidate.id === state.outfit[slot]; });
      if (item && !item.inLavaggio) itemsBySlot[slot] = item;
    });
    avatar.setOutfit(itemsBySlot);
  }

  function render() {
    renderCloset();
    renderLook();
    renderSaved();
    renderCarousel();
    renderLaundryCarousel();
    renderArchive();
    $("#garmentScale").value = String(state.fitScale);
    $("#garmentScaleValue").value = `${state.fitScale}%`;
    updateAvatar();
  }

  function wearItem(id, toggleExisting) {
    const item = state.items.find(function (candidate) { return candidate.id === id; });
    if (!item) return;
    if (item.inLavaggio) {
      openWashConfirmation(item);
      return;
    }
    if (state.outfit[item.category] === id) {
      if (!toggleExisting) return;
      delete state.outfit[item.category];
      state.currentLookName = "";
      if (persist()) {
        render();
        showToast(`${item.name} rimosso dal manichino.`);
      }
      return;
    }
    state.outfit[item.category] = id;
    state.currentLookName = "";
    if (persist()) {
      render();
      showToast(`${item.name} aggiunto alla composizione.`);
    }
  }

  function openWashConfirmation(item) {
    washingItemId = item.id;
    $("#washingItemName").textContent = item.name;
    $("#washingDialog").showModal();
  }

  function toggleWashing(id) {
    const item = state.items.find(function (candidate) { return candidate.id === id; });
    if (!item) return;
    if (item.inLavaggio) {
      openWashConfirmation(item);
      return;
    }
    const previousOutfit = Object.assign({}, state.outfit);
    const previousLookName = state.currentLookName;
    item.inLavaggio = true;
    Object.keys(state.outfit).forEach(function (slot) {
      if (state.outfit[slot] === id) delete state.outfit[slot];
    });
    state.currentLookName = "";
    if (persist()) {
      render();
      showToast(`${item.name} messo in lavatrice.`);
    } else {
      item.inLavaggio = false;
      state.outfit = previousOutfit;
      state.currentLookName = previousLookName;
      render();
    }
  }

  function confirmWashedItem() {
    const item = state.items.find(function (candidate) { return candidate.id === washingItemId; });
    if (!item || !item.inLavaggio) {
      $("#washingDialog").close();
      washingItemId = null;
      return;
    }
    item.inLavaggio = false;
    if (persist()) {
      $("#washingDialog").close();
      washingItemId = null;
      render();
      if (activeScreen === "laundry") showScreen("wardrobe");
      showToast(`${item.name} è pulito e disponibile.`);
    } else {
      item.inLavaggio = true;
      render();
    }
  }

  function removeItem(id) {
    const item = state.items.find(function (candidate) { return candidate.id === id; });
    if (!item) return;
    state.archived.unshift(Object.assign({}, item, { removedAt: new Date().toISOString() }));
    state.items = state.items.filter(function (candidate) { return candidate.id !== id; });
    Object.keys(state.outfit).forEach(function (slot) {
      if (state.outfit[slot] === id) delete state.outfit[slot];
    });
    if (persist()) {
      render();
      showToast(`${item.name} rimosso dal guardaroba e archiviato.`);
    }
  }

  function clearLook() {
    if (!Object.keys(state.outfit).length) return;
    state.outfit = {};
    state.currentLookName = "";
    if (persist()) {
      render();
      showToast("Composizione azzerata.");
    }
  }

  function resizeAndSample(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Lettura della foto non riuscita.")); };
      reader.onload = function () {
        const image = new Image();
        image.onerror = function () { reject(new Error("Il file selezionato non è un’immagine valida.")); };
        image.onload = function () {
          const scale = Math.min(1, 850 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) {
            reject(new Error("Il browser non può elaborare questa immagine."));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = imageData.data;
          const width = canvas.width;
          const height = canvas.height;
          const pixelCount = width * height;
          const edgeColors = [];

          function isNeutralLight(index) {
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            return Math.max(red, green, blue) - Math.min(red, green, blue) <= 48
              && (red + green + blue) / 3 >= 145;
          }

          for (let x = 0; x < width; x += 2) {
            [x, ((height - 1) * width + x)].forEach(function (pixel) {
              const index = pixel * 4;
              if (isNeutralLight(index)) edgeColors.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
            });
          }
          for (let y = 1; y < height - 1; y += 2) {
            [y * width, y * width + width - 1].forEach(function (pixel) {
              const index = pixel * 4;
              if (isNeutralLight(index)) edgeColors.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
            });
          }

          let backgroundRemoved = false;
          if (edgeColors.length >= Math.max(12, Math.floor((width + height) * 0.25))) {
            const channels = [0, 1, 2].map(function (channel) {
              const values = edgeColors.map(function (color) { return color[channel]; }).sort(function (a, b) { return a - b; });
              return values[Math.floor(values.length / 2)];
            });
            const backgroundLuminance = (channels[0] + channels[1] + channels[2]) / 3;
            const visited = new Uint8Array(pixelCount);
            const queue = new Uint32Array(pixelCount);
            let queueStart = 0;
            let queueEnd = 0;

            function isBackground(pixel) {
              const index = pixel * 4;
              const red = pixels[index];
              const green = pixels[index + 1];
              const blue = pixels[index + 2];
              const luminance = (red + green + blue) / 3;
              const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
              const distance = Math.sqrt(
                Math.pow(red - channels[0], 2)
                + Math.pow(green - channels[1], 2)
                + Math.pow(blue - channels[2], 2)
              );
              return chroma <= 58 && luminance >= Math.max(105, backgroundLuminance - 85) && distance <= 105;
            }

            function enqueue(pixel) {
              if (visited[pixel] || !isBackground(pixel)) return;
              visited[pixel] = 1;
              queue[queueEnd++] = pixel;
            }

            for (let x = 0; x < width; x++) {
              enqueue(x);
              enqueue((height - 1) * width + x);
            }
            for (let y = 1; y < height - 1; y++) {
              enqueue(y * width);
              enqueue(y * width + width - 1);
            }
            while (queueStart < queueEnd) {
              const pixel = queue[queueStart++];
              const x = pixel % width;
              if (x > 0) enqueue(pixel - 1);
              if (x + 1 < width) enqueue(pixel + 1);
              if (pixel >= width) enqueue(pixel - width);
              if (pixel + width < pixelCount) enqueue(pixel + width);
            }

            if (queueEnd > 0) {
              for (let pixel = 0; pixel < pixelCount; pixel++) {
                if (visited[pixel]) pixels[pixel * 4 + 3] = 0;
              }
              for (let pixel = 0; pixel < pixelCount; pixel++) {
                if (visited[pixel]) continue;
                const x = pixel % width;
                const touchesBackground = (x > 0 && visited[pixel - 1])
                  || (x + 1 < width && visited[pixel + 1])
                  || (pixel >= width && visited[pixel - width])
                  || (pixel + width < pixelCount && visited[pixel + width]);
                if (!touchesBackground || !isNeutralLight(pixel * 4)) continue;
                const index = pixel * 4;
                const distance = Math.sqrt(
                  Math.pow(pixels[index] - channels[0], 2)
                  + Math.pow(pixels[index + 1] - channels[1], 2)
                  + Math.pow(pixels[index + 2] - channels[2], 2)
                );
                pixels[index + 3] = Math.min(255, Math.max(0, Math.round((distance - 8) * 5)));
              }
              context.putImageData(imageData, 0, 0);
              backgroundRemoved = true;
            }
          }

          let red = 0;
          let green = 0;
          let blue = 0;
          let count = 0;
          const stride = Math.max(4, Math.floor(pixelCount / 3600) * 4);
          for (let index = 0; index < pixels.length; index += stride) {
            if (pixels[index + 3] < 128) continue;
            red += pixels[index];
            green += pixels[index + 1];
            blue += pixels[index + 2];
            count += 1;
          }
          if (!count) {
            reject(new Error("Nell’immagine non è stato trovato un capo visibile."));
            return;
          }
          const hex = [red, green, blue].map(function (channel) {
            return Math.round(channel / count).toString(16).padStart(2, "0");
          }).join("");
          resolve({ src: canvas.toDataURL("image/webp", .9), color: `#${hex}`, backgroundRemoved: backgroundRemoved });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const category = $("#uploadCategory").value;
    let added = 0;
    let backgroundsRemoved = 0;
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showToast(`${file.name}: formato non supportato. Usa JPG, PNG o WEBP.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name}: supera il limite di 10 MB.`);
        continue;
      }
      try {
        const image = await resizeAndSample(file);
        state.items.unshift({
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 38) || "Nuovo capo",
          category: category,
          src: image.src,
          color: image.color,
          demo: false
        });
        if (image.backgroundRemoved) backgroundsRemoved += 1;
        added += 1;
      } catch (error) {
        console.error("Impossibile aggiungere la foto:", error);
        showToast(`${file.name}: ${error.message}`);
      }
    }
    if (added && persist()) {
      filter = "all";
      document.querySelectorAll(".category-tab").forEach(function (button) {
        button.classList.toggle("active", button.dataset.filter === "all");
      });
      render();
      const message = `${added} ${added === 1 ? "capo aggiunto" : "capi aggiunti"} alla collezione.`;
      const backgroundMessage = backgroundsRemoved === added
        ? "Sfondo neutro rimosso dalle foto."
        : backgroundsRemoved
          ? `Sfondo rimosso da ${backgroundsRemoved} foto; per le altre non è stato rilevato uno sfondo neutro.`
          : "Non è stato rilevato uno sfondo neutro da rimuovere.";
      showToast(`${message} ${backgroundMessage}`);
    }
    galleryInput.value = "";
    fileInput.value = "";
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) { track.stop(); });
      cameraStream = null;
    }
    const preview = $("#cameraPreview");
    preview.pause();
    preview.srcObject = null;
    $("#capturePhoto").disabled = true;
  }

  async function openCamera() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      showToast("La fotocamera non è disponibile. Apri l’app da localhost o da una connessione HTTPS.");
      return;
    }

    const dialog = $("#cameraDialog");
    const status = $("#cameraStatus");
    const preview = $("#cameraPreview");
    const captureButton = $("#capturePhoto");
    status.textContent = "Richiesta accesso alla fotocamera…";
    captureButton.disabled = true;
    dialog.showModal();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      if (!dialog.open) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }

      cameraStream = stream;
      preview.addEventListener("loadedmetadata", function () {
        if (!cameraStream) return;
        captureButton.disabled = !preview.videoWidth || !preview.videoHeight;
        if (!captureButton.disabled) status.textContent = "Inquadra il capo e scatta.";
      }, { once: true });
      preview.srcObject = stream;
      await preview.play();
      if (!dialog.open) {
        stopCamera();
        return;
      }
      captureButton.disabled = !preview.videoWidth || !preview.videoHeight;
      if (!captureButton.disabled) status.textContent = "Inquadra il capo e scatta.";
    } catch (error) {
      if (!dialog.open) {
        stopCamera();
        return;
      }
      console.error("Avvio della fotocamera non riuscito:", error);
      stopCamera();
      status.textContent = "Fotocamera non disponibile.";
      const message = error.name === "NotAllowedError"
        ? "Consenti l’accesso alla fotocamera nelle impostazioni del browser."
        : error.name === "NotFoundError"
          ? "Non è stata trovata una fotocamera su questo dispositivo."
          : error.message || "Impossibile avviare la fotocamera.";
      status.textContent = message;
      showToast(message);
    }
  }

  async function captureCameraPhoto() {
    const preview = $("#cameraPreview");
    const captureButton = $("#capturePhoto");
    if (!cameraStream || !preview.videoWidth || !preview.videoHeight) {
      showToast("Attendi che l’anteprima della fotocamera sia pronta.");
      return;
    }

    captureButton.disabled = true;
    try {
      const scale = Math.min(1, 1600 / Math.max(preview.videoWidth, preview.videoHeight));
      const canvas = $("#cameraCanvas");
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Il browser non può acquisire la foto.");
      context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, "image/jpeg", 0.88);
      });
      if (!blob) throw new Error("La foto non è stata generata.");

      const photo = new File([blob], `capo-${Date.now()}.jpg`, { type: "image/jpeg" });
      $("#cameraDialog").close();
      stopCamera();
      await addFiles([photo]);
    } catch (error) {
      console.error("Acquisizione della foto non riuscita:", error);
      captureButton.disabled = !cameraStream || !preview.videoWidth || !preview.videoHeight;
      showToast(error.message || "Impossibile acquisire la foto.");
    }
  }

  function openTryOn() {
    if (!Object.keys(state.outfit).length) {
      showToast("Aggiungi almeno un capo al look.");
      return;
    }
    if (!window.WardrobeTryOnService || !window.WardrobeTryOnService.isConfigured()) {
      showToast("Prova AI non attiva: collega il backend Virtual Try-On nella configurazione.");
      return;
    }
    const selectedItem = Object.keys(state.outfit).map(function (slot) {
      return state.items.find(function (item) { return item.id === state.outfit[slot]; });
    }).find(function (item) { return item && safeImageSource(item.src); });
    if (!selectedItem) {
      showToast("Per la prova AI, carica una foto del capo e aggiungila al look.");
      return;
    }
    tryOnItemId = selectedItem.id;
    $("#personPhoto").value = "";
    $("#tryOnConsent").checked = false;
    $("#tryOnDialog").showModal();
  }

  function selectGender(gender) {
    const genderNames = { man: "Man", woman: "Woman" };
    if (!avatar || !genderNames[gender] || !avatar.hasModel(gender)) return;

    document.querySelectorAll(".gender-button").forEach(function (button) {
      const selected = button.dataset.gender === gender;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    $("#avatarError").hidden = true;
    avatar.resetView();
    avatar.setGender(gender);
    $("#modelStatus").textContent = `${genderNames[gender]} · pronto`;
  }

  function fileToObjectUrl(file) {
    return URL.createObjectURL(file);
  }

  function bindEvents() {
    document.querySelectorAll("[data-screen-target]").forEach(function (button) {
      button.addEventListener("click", function () { showScreen(button.dataset.screenTarget); });
    });

    $("#categoryList").addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      filter = button.dataset.filter;
      document.querySelectorAll(".category-tab").forEach(function (tab) {
        tab.classList.toggle("active", tab === button);
      });
      renderCloset();
    });

    $("#carouselCategories").addEventListener("click", function (event) {
      const button = event.target.closest("[data-carousel-category]");
      if (!button) return;
      carouselCategory = button.dataset.carouselCategory;
      carouselIndex = 0;
      renderCarousel();
    });

    let carouselDragged = false;
    $("#carouselTrack").addEventListener("click", function (event) {
      if (carouselDragged) {
        carouselDragged = false;
        event.preventDefault();
        return;
      }
      const button = event.target.closest("[data-carousel-id]");
      if (!button) return;
      const selectedItem = state.items.find(function (item) { return item.id === button.dataset.carouselId; });
      if (selectedItem && selectedItem.inLavaggio) {
        openWashConfirmation(selectedItem);
        return;
      }
      const index = Number(button.dataset.carouselIndex);
      if (!button.classList.contains("is-center")) {
        carouselIndex = index;
        renderCarousel();
        return;
      }
      wearItem(button.dataset.carouselId, false);
    });

    const carouselFrame = $("#carouselFrame");
    let carouselPointerStart = null;
    let carouselDragDistance = 0;
    carouselFrame.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || (event.pointerType === "mouse" && event.target.closest(".carousel-item"))) return;
      carouselPointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        index: carouselIndex
      };
      carouselDragDistance = 0;
      carouselFrame.setPointerCapture(event.pointerId);
    });

    carouselFrame.addEventListener("pointermove", function (event) {
      if (!carouselPointerStart || carouselPointerStart.id !== event.pointerId) return;
      const deltaX = event.clientX - carouselPointerStart.x;
      const deltaY = event.clientY - carouselPointerStart.y;
      if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;
      if (Math.abs(deltaY) > Math.abs(deltaX) && !carouselFrame.classList.contains("is-dragging")) return;
      carouselDragDistance = deltaX;
      carouselFrame.classList.add("is-dragging");
      const items = getCarouselItems();
      if (!items.length) return;
      const step = Math.max(180, Math.min(228, $("#carouselTrack").clientWidth * 0.29));
      const dragOffset = deltaX / step;
      const worn = Object.keys(state.outfit).map(function (slot) { return state.outfit[slot]; });
      items.forEach(function (item, index) {
        const button = $("#carouselTrack").querySelector(`[data-carousel-id="${CSS.escape(item.id)}"]`);
        if (!button) return;
        let offset = index - carouselPointerStart.index + dragOffset;
        if (offset > items.length / 2) offset -= items.length;
        if (offset < -items.length / 2) offset += items.length;
        const distance = Math.abs(offset);
        const scale = Math.max(.48, 1.12 - distance * .2);
        const isWorn = worn.indexOf(item.id) !== -1;
        const isWashing = item.inLavaggio === true;
        button.classList.toggle("is-center", distance < 0.5);
        button.classList.toggle("is-washing", isWashing);
        button.setAttribute("aria-pressed", distance < 0.5 ? "true" : "false");
        button.style.transform = `translate(-50%,-50%) translateX(${offset * step}px) translateZ(${-distance * 78}px) scale(${scale})`;
        button.style.opacity = String(Math.max(0, 1 - distance * .34));
        button.style.zIndex = String(10 - distance);
        button.style.pointerEvents = distance > 2.5 ? "none" : "auto";
        button.querySelector(".carousel-worn-mark").hidden = !isWorn;
        button.querySelector(".carousel-washing-mark").hidden = !isWashing;
      });
      event.preventDefault();
    });

    function finishCarouselDrag(event) {
      if (!carouselPointerStart || carouselPointerStart.id !== event.pointerId) return;
      const moved = Math.abs(carouselDragDistance) >= 8;
      if (moved) {
        const items = getCarouselItems();
        const step = Math.max(180, Math.min(228, $("#carouselTrack").clientWidth * 0.29));
        carouselIndex = items.length
          ? (carouselPointerStart.index - Math.round(carouselDragDistance / step) + items.length * 2) % items.length
          : 0;
        carouselDragged = true;
        window.setTimeout(function () { carouselDragged = false; }, 0);
      }
      carouselPointerStart = null;
      carouselFrame.classList.remove("is-dragging");
      if (moved) renderCarousel();
    }

    carouselFrame.addEventListener("pointerup", finishCarouselDrag);
    carouselFrame.addEventListener("pointercancel", finishCarouselDrag);

    const laundryFrame = $("#laundryCarouselFrame");
    let laundryPointer = null;
    let laundryDelta = 0;
    let laundryWasDragged = false;
    laundryFrame.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      laundryPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, index: laundryCarouselIndex };
      laundryDelta = 0;
      laundryFrame.setPointerCapture(event.pointerId);
    });
    laundryFrame.addEventListener("pointermove", function (event) {
      if (!laundryPointer || laundryPointer.id !== event.pointerId) return;
      const deltaX = event.clientX - laundryPointer.x;
      const deltaY = event.clientY - laundryPointer.y;
      if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      laundryDelta = deltaX;
      laundryFrame.classList.add("is-dragging");
      const items = state.items.filter(function (item) { return item.inLavaggio === true; });
      const step = Math.max(168, Math.min(220, $("#laundryCarouselTrack").clientWidth * 0.27));
      layoutLaundryCarousel(items, laundryPointer.index - deltaX / step);
      event.preventDefault();
    });
    function finishLaundryDrag(event) {
      if (!laundryPointer || laundryPointer.id !== event.pointerId) return;
      const moved = Math.abs(laundryDelta) >= 8;
      if (moved) {
        const items = state.items.filter(function (item) { return item.inLavaggio === true; });
        const step = Math.max(168, Math.min(220, $("#laundryCarouselTrack").clientWidth * 0.27));
        laundryCarouselIndex = items.length
          ? (laundryPointer.index - Math.round(laundryDelta / step) + items.length * 2) % items.length
          : 0;
        laundryWasDragged = true;
      }
      laundryPointer = null;
      laundryFrame.classList.remove("is-dragging");
      if (moved) {
        renderLaundryCarousel();
        window.setTimeout(function () { laundryWasDragged = false; }, 0);
      }
    }
    laundryFrame.addEventListener("pointerup", finishLaundryDrag);
    laundryFrame.addEventListener("pointercancel", finishLaundryDrag);
    $("#laundryCarouselTrack").addEventListener("click", function (event) {
      if (laundryWasDragged) {
        event.preventDefault();
        return;
      }
      const button = event.target.closest("[data-laundry-id]");
      if (!button) return;
      const item = state.items.find(function (candidate) { return candidate.id === button.dataset.laundryId; });
      if (item && item.inLavaggio) openWashConfirmation(item);
    });

    $("#carouselTrack").addEventListener("dragstart", function (event) {
      const item = event.target.closest("[data-carousel-id]");
      if (!item || !event.dataTransfer) return;
      const garment = state.items.find(function (candidate) { return candidate.id === item.dataset.carouselId; });
      if (!garment || garment.inLavaggio) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", item.dataset.carouselId);
    });

    grid.addEventListener("click", function (event) {
      const removeButton = event.target.closest("[data-remove-id]");
      if (removeButton) {
        removeItem(removeButton.dataset.removeId);
        return;
      }
      const selectButton = event.target.closest("[data-wear-id]");
      if (selectButton) {
        wearItem(selectButton.dataset.wearId, true);
        return;
      }
      const washButton = event.target.closest("[data-wash-id]");
      if (washButton) toggleWashing(washButton.dataset.washId);
    });

    grid.addEventListener("dragstart", function (event) {
      const card = event.target.closest("[data-item-id]");
      const item = card && state.items.find(function (candidate) { return candidate.id === card.dataset.itemId; });
      if (!card || !event.dataTransfer || !item || item.inLavaggio) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", card.dataset.itemId);
    });

    $("#viewport").addEventListener("dragover", function (event) {
      if (event.dataTransfer && event.dataTransfer.types.indexOf("text/plain") !== -1) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });

    $("#viewport").addEventListener("drop", function (event) {
      event.preventDefault();
      const id = event.dataTransfer && event.dataTransfer.getData("text/plain");
      const item = state.items.find(function (candidate) { return candidate.id === id; });
      if (!item) return;
      if (item.inLavaggio) {
        openWashConfirmation(item);
        return;
      }
      if (avatar && avatar.hitTestDrop(event.clientX, event.clientY, item.category)) {
        wearItem(id, false);
      } else {
        showToast("Rilascia il capo sulla zona corrispondente del manichino.");
      }
    });

    uploadArea.addEventListener("dragover", function (event) {
      event.preventDefault();
      uploadArea.classList.add("is-dragging");
    });
    uploadArea.addEventListener("dragleave", function (event) {
      if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove("is-dragging");
    });
    uploadArea.addEventListener("drop", function (event) {
      event.preventDefault();
      uploadArea.classList.remove("is-dragging");
      addFiles(event.dataTransfer.files);
    });
    galleryInput.addEventListener("change", function () { addFiles(galleryInput.files); });
    fileInput.addEventListener("change", function () { addFiles(fileInput.files); });
    $("#openCamera").addEventListener("click", openCamera);
    $("#closeCamera").addEventListener("click", function () { $("#cameraDialog").close(); });
    $("#capturePhoto").addEventListener("click", captureCameraPhoto);
    $("#cameraDialog").addEventListener("close", stopCamera);

    $("#outfitList").addEventListener("click", function (event) {
      const button = event.target.closest("[data-clear-slot]");
      if (!button) return;
      delete state.outfit[button.dataset.clearSlot];
      state.currentLookName = "";
      if (persist()) render();
    });

    $("#clearLook").addEventListener("click", clearLook);
    $("#washingDialogCancel").addEventListener("click", function () {
      $("#washingDialog").close();
      washingItemId = null;
    });
    $("#washingDialogConfirm").addEventListener("click", confirmWashedItem);
    $("#garmentScale").addEventListener("input", function () {
      const scale = Math.min(120, Math.max(80, Number($("#garmentScale").value)));
      state.fitScale = scale;
      $("#garmentScaleValue").value = `${scale}%`;
      if (avatar) avatar.setGarmentScale(scale / 100);
    });
    $("#garmentScale").addEventListener("change", function () {
      if (persist()) showToast("Vestibilità aggiornata.");
    });

    document.querySelectorAll(".gender-button").forEach(function (button) {
      button.addEventListener("click", function () {
        selectGender(button.dataset.gender);
      });
    });
    $("#frontView").addEventListener("click", function () {
      if (avatar) avatar.resetView();
    });
    $("#rotateView").addEventListener("click", function () {
      if (!avatar) return;
      const rotating = avatar.toggleRotation();
      $("#rotateView").setAttribute("aria-label", rotating ? "Ferma rotazione automatica" : "Attiva rotazione automatica");
      showToast(rotating ? "Rotazione automatica attivata." : "Rotazione automatica fermata.");
    });

    $("#saveLookButton").addEventListener("click", function () {
      if (!Object.keys(state.outfit).length) {
        showToast("Aggiungi almeno un capo prima di salvare il look.");
        return;
      }
      $("#lookNameInput").value = "";
      $("#saveDialog").showModal();
      $("#lookNameInput").focus();
    });

    $("#cancelSave").addEventListener("click", function () { $("#saveDialog").close(); });
    $("#saveForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const name = $("#lookNameInput").value.trim();
      if (!name) return;
      const look = {
        id: `look-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name,
        outfit: Object.assign({}, state.outfit)
      };
      state.saved.unshift(look);
      state.currentLookName = name;
      if (persist()) {
        renderLook();
        renderSaved();
        $("#saveDialog").close();
        showToast(`“${name}” salvato su questo dispositivo.`);
      }
    });

    savedList.addEventListener("click", function (event) {
      const deleteButton = event.target.closest("[data-delete-look]");
      if (deleteButton) {
        state.saved = state.saved.filter(function (candidate) { return candidate.id !== deleteButton.dataset.deleteLook; });
        if (persist()) renderSaved();
        return;
      }
      const loadButton = event.target.closest("[data-load-look]");
      if (!loadButton) return;
      const look = state.saved.find(function (candidate) { return candidate.id === loadButton.dataset.loadLook; });
      if (!look) return;
      const nextOutfit = {};
      let washingOmittedCount = 0;
      Object.keys(look.outfit || {}).forEach(function (slot) {
        const item = state.items.find(function (candidate) { return candidate.id === look.outfit[slot]; });
        if (!item || item.category !== slot) return;
        if (item.inLavaggio) {
          washingOmittedCount += 1;
          return;
        }
        nextOutfit[slot] = item.id;
      });
      state.outfit = nextOutfit;
      state.currentLookName = look.name;
      if (persist()) {
        render();
        showToast(washingOmittedCount
          ? `Look “${look.name}” caricato; ${washingOmittedCount} ${washingOmittedCount === 1 ? "capo in lavaggio escluso" : "capi in lavaggio esclusi"}.`
          : `Look “${look.name}” caricato.`);
      }
    });

    $("#tryOnButton").addEventListener("click", openTryOn);
    $("#cancelTryOn").addEventListener("click", function () { $("#tryOnDialog").close(); });
    $("#tryOnForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      const personFile = $("#personPhoto").files[0];
      const consent = $("#tryOnConsent").checked;
      if (!personFile || !consent) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(personFile.type) || personFile.size > MAX_FILE_SIZE) {
        showToast("Scegli una foto JPG, PNG o WEBP di massimo 10 MB.");
        return;
      }
      const garment = state.items.find(function (item) { return item.id === tryOnItemId; });
      if (!garment || !safeImageSource(garment.src)) {
        showToast("La foto del capo non è più disponibile.");
        return;
      }
      const button = $("#generateTryOn");
      button.disabled = true;
      button.textContent = "Elaborazione…";
      try {
        const resultImage = await window.WardrobeTryOnService.generate({
          personFile: personFile,
          garmentDataUrl: safeImageSource(garment.src),
          category: garment.category
        });
        $("#tryOnImage").src = resultImage;
        $("#tryOnResult").hidden = false;
        $("#tryOnDialog").close();
        showToast("Anteprima AI pronta. È visualizzata separatamente dalla scena 3D.");
      } catch (error) {
        console.error("Errore nella generazione Virtual Try-On:", error);
        showToast(error.message || "Il servizio Virtual Try-On non è riuscito.");
      } finally {
        button.disabled = false;
        button.textContent = "Genera anteprima";
      }
    });

    $("#closeResult").addEventListener("click", function () {
      $("#tryOnResult").hidden = true;
      $("#tryOnImage").removeAttribute("src");
    });

    window.addEventListener("resize", function () {
      if (state) renderCarousel();
      if (state && activeScreen === "laundry") renderLaundryCarousel();
    });
  }

  function initializeAvatar() {
    try {
      avatar = window.WardrobeAvatar3D.create($("#avatarCanvas"), function (scale, committed) {
        if (!state) return;
        state.fitScale = scale;
        $("#garmentScale").value = String(scale);
        $("#garmentScaleValue").value = `${scale}%`;
        if (committed) persist();
      });
      const instance = avatar;
      avatar.setGarmentScale(state.fitScale / 100);
      $("#avatarLoading").hidden = false;
      $("#modelStatus").textContent = "Caricamento modelli…";
      document.querySelectorAll(".gender-button").forEach(function (button) {
        button.disabled = true;
      });
      instance.preloadModels(function (progress) {
        if (!progress.lengthComputable || !progress.total) return;
        const genderName = progress.gender === "man" ? "Man" : "Woman";
        const percent = Math.round(progress.loaded / progress.total * 100);
        $("#modelStatus").textContent = `Caricamento ${genderName} · ${percent}%`;
        $("#avatarLoadingText").textContent = `Caricamento ${genderName} · ${percent}%`;
      }).then(function (results) {
        if (avatar !== instance) return;
        const loaded = results.filter(function (result) { return result.loaded; });
        document.querySelectorAll(".gender-button").forEach(function (button) {
          button.disabled = !avatar.hasModel(button.dataset.gender);
        });
        $("#avatarLoading").hidden = true;

        if (!loaded.length) {
          $("#modelStatus").textContent = "Modelli non disponibili";
          $("#avatarError").textContent = "Non è stato possibile caricare i modelli GLB. Avvia l’app da un server locale e verifica la connessione.";
          $("#avatarError").hidden = false;
          return;
        }

        const initialGender = avatar.hasModel("woman") ? "woman" : "man";
        selectGender(initialGender);
        if (loaded.length !== results.length) {
          const failed = results.filter(function (result) { return !result.loaded; })[0];
          $("#avatarError").textContent = `Il modello ${failed.gender === "man" ? "Man" : "Woman"} non è disponibile.`;
          $("#avatarError").hidden = false;
        }
      });
    } catch (error) {
      console.error("Inizializzazione avatar 3D non riuscita:", error);
      $("#modelStatus").textContent = "3D non disponibile";
      $("#avatarLoading").hidden = true;
      $("#avatarError").hidden = false;
    }
  }

  bindEvents();
  initializeLocalApp();
  window.addEventListener("pagehide", function () {
    stopCamera();
    if (avatar) avatar.dispose();
  });
})();
