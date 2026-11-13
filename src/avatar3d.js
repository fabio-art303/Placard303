(function () {
  "use strict";

  const THREE = window.THREE;
  const MODEL_URLS = {
    man: "./assets/manichino-maschio.glb",
    woman: "./assets/manichino%20donna.glb"
  };
  const GARMENT_COLORS = {
    top: "#aaa58f",
    bottom: "#44484b",
    outerwear: "#77756e",
    shoes: "#ddd8c9",
    head: "#655a4e",
    accessory: "#92786a"
  };

  function makeMaterial(color, options) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color || "#8f8a7b",
      roughness: 0.82,
      metalness: 0.015
    }, options || {}));
  }

  function applyMatteModelMaterials(model) {
    const materialCache = new Map();
    function matteMaterial(source) {
      if (!source || typeof source.clone !== "function") return source;
      if (materialCache.has(source)) return materialCache.get(source);
      const material = source.clone();
      material.metalness = 0;
      material.roughness = 1;
      material.envMapIntensity = 0;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      if ("reflectivity" in material) material.reflectivity = 0;
      if ("clearcoat" in material) material.clearcoat = 0;
      if ("clearcoatRoughness" in material) material.clearcoatRoughness = 1;
      if ("specularIntensity" in material) material.specularIntensity = 0;
      material.needsUpdate = true;
      materialCache.set(source, material);
      return material;
    }

    model.traverse(function (object) {
      if (!object.isMesh) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(matteMaterial)
        : matteMaterial(object.material);
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }

  function makeLathe(profile, material, depthScale) {
    const points = profile.map(function (entry) {
      return new THREE.Vector3(entry[1], entry[0], 0);
    });
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.16);
    const smooth = curve.getPoints(Math.max(32, profile.length * 8)).map(function (point) {
      return new THREE.Vector2(Math.max(0.001, point.x), point.y);
    });
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(smooth, 48), material);
    mesh.scale.z = depthScale || 0.76;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function makeFittedShell(profile, material, sizing, side, fallbackDepth, clearance) {
    const segments = 32;
    const positions = [];
    const indices = [];
    const rows = profile.map(function (entry) {
      const section = sizing && sizing.profile
        ? profileSection(sizing.profile, entry[0], side)
        : null;
      const fallbackRadius = entry[1];
      const radiusX = section
        ? Math.max(0.015, (section.maxX - section.minX) / (2 * sizing.width) * clearance)
        : fallbackRadius;
      const radiusZ = section
        ? Math.max(0.015, (section.maxZ - section.minZ) / (2 * sizing.depth) * clearance)
        : fallbackRadius * fallbackDepth;
      const centerX = section ? (section.minX + section.maxX) / (2 * sizing.width) : 0;
      const centerZ = section ? (section.minZ + section.maxZ) / (2 * sizing.depth) : 0;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        positions.push(
          centerX + Math.cos(angle) * radiusX,
          entry[0],
          centerZ + Math.sin(angle) * radiusZ
        );
      }
      return positions.length / 3;
    });

    for (let row = 0; row < rows.length - 1; row += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        const currentTop = rows[row] + segment;
        const nextTop = rows[row] + next;
        const currentBottom = rows[row + 1] + segment;
        const nextBottom = rows[row + 1] + next;
        indices.push(currentTop, currentBottom, nextTop, nextTop, currentBottom, nextBottom);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function profileSection(profile, y, side) {
    if (!profile || !profile.length) return null;
    const index = Math.max(0, Math.min(profile.length - 1, Math.round(y / profile.step)));
    let before = index;
    let after = index;
    while (before >= 0 && !profile[before][side]) before -= 1;
    while (after < profile.length && !profile[after][side]) after += 1;
    if (before < 0 && after >= profile.length) return null;
    if (before < 0) return profile[after][side];
    if (after >= profile.length) return profile[before][side];
    if (before === after) return profile[before][side];
    const beforeSection = profile[before][side];
    const afterSection = profile[after][side];
    const weight = (y - before * profile.step) / ((after - before) * profile.step);
    return {
      minX: beforeSection.minX + (afterSection.minX - beforeSection.minX) * weight,
      maxX: beforeSection.maxX + (afterSection.maxX - beforeSection.maxX) * weight,
      minZ: beforeSection.minZ + (afterSection.minZ - beforeSection.minZ) * weight,
      maxZ: beforeSection.maxZ + (afterSection.maxZ - beforeSection.maxZ) * weight
    };
  }

  function measureAvatarProfile(model) {
    const step = 0.05;
    const profile = Array.from({ length: 61 }, function () {
      return {
        body: null,
        left: Object.create(null),
        right: Object.create(null)
      };
    });

    model.updateMatrixWorld(true);
    model.traverse(function (object) {
      if (!object.isMesh || !object.geometry || !object.geometry.attributes.position) return;
      const attribute = object.geometry.attributes.position;
      const point = new THREE.Vector3();
      for (let vertex = 0; vertex < attribute.count; vertex += 1) {
        point.fromBufferAttribute(attribute, vertex).applyMatrix4(object.matrixWorld);
        if (point.y < 0 || point.y > 3) continue;
        const index = Math.min(profile.length - 1, Math.round(point.y / step));
        const side = point.x < 0 ? "left" : "right";
        const sideBins = profile[index][side];
        const xIndex = Math.floor(Math.abs(point.x) / 0.01);
        const section = sideBins[xIndex] || {
          minX: point.x,
          maxX: point.x,
          minZ: point.z,
          maxZ: point.z
        };
        section.minX = Math.min(section.minX, point.x);
        section.maxX = Math.max(section.maxX, point.x);
        section.minZ = Math.min(section.minZ, point.z);
        section.maxZ = Math.max(section.maxZ, point.z);
        sideBins[xIndex] = section;
      }
    });

    profile.forEach(function (entry) {
      ["left", "right"].forEach(function (side) {
        const bins = entry[side];
        const indices = Object.keys(bins).map(Number).sort(function (a, b) { return a - b; });
        if (!indices.length) {
          entry[side] = null;
          return;
        }
        let lastIndex = indices[0];
        for (let index = 1; index < indices.length; index += 1) {
          if (indices[index] - lastIndex > 2) break;
          lastIndex = indices[index];
        }
        const core = indices.filter(function (index) { return index <= lastIndex; })
          .map(function (index) { return bins[index]; });
        entry[side] = core.reduce(function (bounds, section) {
          if (!bounds) return Object.assign({}, section);
          bounds.minX = Math.min(bounds.minX, section.minX);
          bounds.maxX = Math.max(bounds.maxX, section.maxX);
          bounds.minZ = Math.min(bounds.minZ, section.minZ);
          bounds.maxZ = Math.max(bounds.maxZ, section.maxZ);
          return bounds;
        }, null);
      });
      if (entry.left && entry.right) {
        entry.body = {
          minX: entry.left.minX,
          maxX: entry.right.maxX,
          minZ: Math.min(entry.left.minZ, entry.right.minZ),
          maxZ: Math.max(entry.left.maxZ, entry.right.maxZ)
        };
      } else {
        entry.body = entry.left || entry.right;
      }
    });
    profile.step = step;
    return profile;
  }

  function addEllipsoid(parent, position, scale, material, segments) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, segments || 28, Math.max(16, (segments || 28) - 8)),
      material
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addLimb(parent, start, end, radiusStart, radiusEnd, material) {
    const from = new THREE.Vector3(start[0], start[1], start[2]);
    const to = new THREE.Vector3(end[0], end[1], end[2]);
    const direction = new THREE.Vector3().subVectors(to, from);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), 24, 1, false),
      material
    );
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    addEllipsoid(parent, start, [radiusStart, radiusStart, radiusStart], material, 20);
    addEllipsoid(parent, end, [radiusEnd, radiusEnd, radiusEnd], material, 20);
  }

  function addShirt(color, isOuterwear, sizing) {
    const material = makeMaterial(color || GARMENT_COLORS[isOuterwear ? "outerwear" : "top"], {
      roughness: isOuterwear ? 0.9 : 0.78,
      polygonOffset: isOuterwear,
      polygonOffsetFactor: isOuterwear ? -1 : 0,
      polygonOffsetUnits: isOuterwear ? -1 : 0
    });
    const depthScale = isOuterwear ? 0.86 : 0.76;
    const profile = isOuterwear
      ? [[1.34, 0.232], [1.49, 0.245], [1.69, 0.218], [1.88, 0.22], [2.09, 0.265], [2.29, 0.315], [2.4, 0.292], [2.46, 0.19]]
      : [[1.48, 0.214], [1.59, 0.22], [1.74, 0.194], [1.91, 0.21], [2.1, 0.249], [2.29, 0.31], [2.4, 0.285], [2.455, 0.18]];
    const garment = new THREE.Group();
    garment.position.z = isOuterwear ? 0.012 : 0;
    garment.add(makeFittedShell(profile, material, sizing, "body", depthScale, isOuterwear ? 1.1 : 1.045));
    const shoulder = sizing && sizing.profile ? profileSection(sizing.profile, 2.34, "body") : null;
    const shoulderX = shoulder
      ? Math.max(Math.abs(shoulder.minX), Math.abs(shoulder.maxX)) / sizing.width * 0.76
      : 0.283;
    [-1, 1].forEach(function (side) {
      addLimb(
        garment,
        [side * shoulderX, 2.34, isOuterwear ? 0.012 : 0],
        [side * (shoulderX + 0.092), isOuterwear ? 1.64 : 2.055, isOuterwear ? 0.02 : 0.008],
        0.103 * (isOuterwear ? 1.08 : 1),
        (isOuterwear ? 0.067 : 0.085) * (isOuterwear ? 1.08 : 1),
        material
      );
      if (isOuterwear) {
        addEllipsoid(garment, [side * (shoulderX + 0.172), 1.53, 0.025], [0.076, 0.119, 0.079], material, 20);
      }
    });
    return garment;
  }

  function addPants(color, sizing) {
    const fabric = makeMaterial(color || GARMENT_COLORS.bottom, { roughness: 0.88 });
    const pants = new THREE.Group();
    pants.add(makeFittedShell([
      [1.39, 0.17], [1.47, 0.235], [1.57, 0.233], [1.67, 0.201], [1.76, 0.178]
    ], fabric, sizing, "body", 0.78, 1.045));
    [-1, 1].forEach(function (side) {
      const profile = [
        [0.18, 0.066], [0.32, 0.073], [0.52, 0.083], [0.74, 0.094], [0.94, 0.116], [1.13, 0.128], [1.41, 0.122]
      ];
      pants.add(makeFittedShell(profile, fabric, sizing, side < 0 ? "left" : "right", 0.78, 1.045));
    });
    return pants;
  }

  function addShoes(color, sizing) {
    const shoes = new THREE.Group();
    const leather = makeMaterial(color || GARMENT_COLORS.shoes, { roughness: 0.48 });
    [-1, 1].forEach(function (side) {
      const section = sizing && sizing.profile
        ? profileSection(sizing.profile, 0.1, side < 0 ? "left" : "right")
        : null;
      const shoeX = section ? (section.minX + section.maxX) / (2 * sizing.width) : side * 0.15;
      const shoeZ = section ? (section.minZ + section.maxZ) / (2 * sizing.depth) : 0.11;
      const shoeWidth = section ? Math.max(0.045, (section.maxX - section.minX) / (2 * sizing.width) * 1.1) : 0.092;
      const shoeDepth = section ? Math.max(0.09, (section.maxZ - section.minZ) / (2 * sizing.depth) * 1.1) : 0.2;
      const shoe = addEllipsoid(shoes, [shoeX, 0.105, shoeZ], [shoeWidth, 0.074, shoeDepth], leather, 28);
      shoe.rotation.x = -0.05;
      const sole = addEllipsoid(
        shoes,
        [shoeX, 0.061, shoeZ],
        [shoeWidth * 1.04, 0.025, shoeDepth * 0.96],
        makeMaterial("#292927", { roughness: 0.72 }),
        24
      );
      sole.rotation.x = -0.05;
    });
    return shoes;
  }

  function addHeadwear(color, sizing) {
    const fabric = makeMaterial(color || GARMENT_COLORS.head, { roughness: 0.7 });
    const hat = new THREE.Group();
    const head = sizing && sizing.profile ? profileSection(sizing.profile, 2.94, "body") : null;
    const radiusX = head ? Math.max(0.09, (head.maxX - head.minX) / (2 * sizing.width) * 1.04) : 0.15;
    const radiusZ = head ? Math.max(0.09, (head.maxZ - head.minZ) / (2 * sizing.depth) * 1.04) : 0.15;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(radiusX * 0.87, radiusX, 0.11, 40), fabric);
    crown.scale.z = radiusZ / radiusX;
    crown.position.set(0, 3.065, head ? (head.minZ + head.maxZ) / (2 * sizing.depth) : -0.005);
    crown.castShadow = true;
    hat.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(radiusX * 1.3, radiusX * 1.3, 0.018, 48), fabric);
    brim.scale.z = radiusZ / radiusX;
    brim.position.set(0, 3.018, head ? (head.minZ + head.maxZ) / (2 * sizing.depth) : 0.008);
    brim.castShadow = true;
    hat.add(brim);
    return hat;
  }

  function addAccessory(color, sizing) {
    const leather = makeMaterial(color || GARMENT_COLORS.accessory, { roughness: 0.58 });
    const bag = new THREE.Group();
    const torso = sizing && sizing.profile ? profileSection(sizing.profile, 1.55, "right") : null;
    const halfWidth = torso ? (torso.maxX - torso.minX) / (2 * sizing.width) : 0.14;
    const halfDepth = torso ? (torso.maxZ - torso.minZ) / (2 * sizing.depth) : 0.09;
    const bodyX = torso ? torso.maxX / sizing.width + halfWidth * 0.3 : 0.39;
    const bodyZ = torso ? (torso.minZ + torso.maxZ) / (2 * sizing.depth) + halfDepth * 0.3 : 0.1;
    const body = addEllipsoid(bag, [bodyX, 1.55, bodyZ], [halfWidth * 0.6, 0.17, halfDepth * 0.8], leather, 28);
    body.rotation.z = -0.08;
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.012, 8, 40, Math.PI * 1.12),
      makeMaterial("#bda98a", { roughness: 0.58 })
    );
    strap.scale.x = Math.max(0.65, halfWidth / 0.14);
    strap.position.set(bodyX - halfWidth * 0.85, 1.76, bodyZ - halfDepth * 0.75);
    strap.rotation.z = 0.1;
    strap.castShadow = true;
    bag.add(strap);
    return bag;
  }

  function buildGarments(outfit, sizing, fitScale) {
    const group = new THREE.Group();
    const renderOrder = {
      bottom: 1,
      shoes: 2,
      top: 3,
      accessory: 4,
      outerwear: 5,
      head: 6
    };
    ["bottom", "shoes", "top", "accessory", "outerwear", "head"].forEach(function (slot) {
      const item = outfit[slot];
      if (!item) return;
      let garment;
      if (slot === "top") garment = addShirt(item.color, false, sizing);
      if (slot === "outerwear") garment = addShirt(item.color, true, sizing);
      if (slot === "bottom") garment = addPants(item.color, sizing);
      if (slot === "shoes") garment = addShoes(item.color, sizing);
      if (slot === "head") garment = addHeadwear(item.color, sizing);
      if (slot === "accessory") garment = addAccessory(item.color, sizing);
      if (!garment) return;
      garment.traverse(function (object) {
        if (object.isMesh) object.renderOrder = renderOrder[slot];
      });
      group.add(garment);
    });
    if (sizing) {
      group.position.y = sizing.minY;
      group.scale.set(sizing.width * fitScale, sizing.height, sizing.depth * fitScale);
    }
    return group;
  }

  function disposeTree(root) {
    root.traverse(function (object) {
      if (!object.isMesh) return;
      if (object.geometry) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(function (material) {
        if (!material) return;
        Object.keys(material).forEach(function (key) {
          if (material[key] && material[key].isTexture) material[key].dispose();
        });
        material.dispose();
      });
    });
  }

  function fitModelToAvatar(model) {
    model.updateMatrixWorld(true);
    const initialBounds = new THREE.Box3().setFromObject(model);
    const initialSize = initialBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) {
      throw new Error("Il file GLB non contiene un modello con altezza valida.");
    }

    model.scale.multiplyScalar(3 / initialSize.y);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= bounds.min.y;
    model.position.z -= center.z;
    model.updateMatrixWorld(true);
  }

  function createDropZones(sizing) {
    const root = new THREE.Group();
    root.name = "InvisibleDropZones";
    const zones = [];
    const debugVisible = window.WARDROBE_DEBUG_HITBOXES === true;

    function addZone(name, categories, minY, maxY, centerX, widthFactor, minWidth, depthFactor, minDepth) {
      let width = minWidth;
      let depth = minDepth;
      let centerZ = 0;
      for (let y = minY; y <= maxY; y += 0.05) {
        const section = profileSection(sizing.profile, y, "body");
        if (!section) continue;
        width = Math.max(width, (section.maxX - section.minX) * widthFactor);
        depth = Math.max(depth, (section.maxZ - section.minZ) * depthFactor);
        centerZ = (section.minZ + section.maxZ) / 2;
      }
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, maxY - minY, depth),
        new THREE.MeshBasicMaterial({
          color: 0x4f87c4,
          transparent: true,
          opacity: debugVisible ? 0.2 : 0,
          depthWrite: false
        })
      );
      mesh.name = name;
      mesh.position.set(centerX, (minY + maxY) / 2, centerZ);
      mesh.userData.dropCategories = categories;
      root.add(mesh);
      zones.push(mesh);
    }

    addZone("TorsoSpalle", ["top", "outerwear"], 1.12, 1.86, 0, 1.18, 0.34, 1.24, 0.28);
    addZone("BacinoGambe", ["bottom"], 0.34, 1.22, 0, 1.16, 0.3, 1.22, 0.25);
    addZone("Piedi", ["shoes"], 0.015, 0.34, 0, 1.2, 0.28, 1.4, 0.34);
    addZone("Testa", ["head", "accessory"], 2.34, 2.98, 0, 1.25, 0.3, 1.35, 0.28);
    const armSection = profileSection(sizing.profile, 1.12, "body");
    const wristOffset = armSection ? Math.max(0.3, armSection.maxX * 0.78) : 0.42;
    [-1, 1].forEach(function (side) {
      addZone("Polso", ["accessory", "head"], 0.84, 1.32, side * wristOffset, 0.3, 0.22, 1.2, 0.24);
    });
    root.userData.dropZones = zones;
    return root;
  }

  function createAvatar(canvas, onFitScaleChange) {
    if (!THREE || !THREE.OrbitControls || !THREE.GLTFLoader) {
      throw new Error("Three.js, OrbitControls o GLTFLoader non disponibili.");
    }

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf9f8f6, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9f8f6);
    scene.fog = new THREE.FogExp2(0xf9f8f6, 0.012);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.set(0, 1.72, 5.25);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b8b2, 1.75));
    const key = new THREE.DirectionalLight(0xffffff, 2.15);
    key.position.set(-2.6, 4.2, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -1;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x64748b, 0.75);
    rim.position.set(2.4, 2.8, -2.8);
    scene.add(rim);
    const fill = new THREE.PointLight(0xffffff, 0.45, 8);
    fill.position.set(1.7, 1.3, 2.4);
    scene.add(fill);

    const contactCanvas = document.createElement("canvas");
    contactCanvas.width = 128;
    contactCanvas.height = 128;
    const context = contactCanvas.getContext("2d");
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(24,24,27,.18)");
    gradient.addColorStop(1, "rgba(24,24,27,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.75),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(contactCanvas), transparent: true, depthWrite: false })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.015, 0.02);
    scene.add(contactShadow);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 3.6;
    controls.maxDistance = 7;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI * 0.83;
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.85;

    const loader = new THREE.GLTFLoader();
    const models = Object.create(null);
    const modelSizing = Object.create(null);
    const dropZones = Object.create(null);
    const dropRaycaster = new THREE.Raycaster();
    const dropPointer = new THREE.Vector2();
    const loading = Object.create(null);
    let activeGender = null;
    let currentOutfit = {};
    let fitScale = 1;
    let garments = new THREE.Group();
    garments.visible = false;
    scene.add(garments);
    let frameId;
    let disposed = false;

    function resize() {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function replaceGarments() {
      scene.remove(garments);
      disposeTree(garments);
      garments = buildGarments(currentOutfit, activeGender ? modelSizing[activeGender] : null, fitScale);
      garments.visible = Boolean(activeGender);
      scene.add(garments);
    }

    const touchPointers = new Map();
    let pinchStartDistance = 0;
    let pinchStartScale = fitScale;
    let pinchActive = false;

    function touchDistance() {
      const points = Array.from(touchPointers.values());
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    function updateGarmentScale(value, committed) {
      if (!Number.isFinite(value)) return;
      fitScale = THREE.MathUtils.clamp(value, 0.8, 1.2);
      const sizing = activeGender ? modelSizing[activeGender] : null;
      if (sizing) {
        garments.scale.x = sizing.width * fitScale;
        garments.scale.z = sizing.depth * fitScale;
        renderer.render(scene, camera);
      }
      if (onFitScaleChange) onFitScaleChange(Math.round(fitScale * 100), Boolean(committed));
    }

    function handleTouchPointerDown(event) {
      if (event.pointerType !== "touch") return;
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.size === 2) {
        pinchActive = true;
        pinchStartDistance = touchDistance();
        pinchStartScale = fitScale;
        controls.enabled = false;
        event.preventDefault();
      }
    }

    function handleTouchPointerMove(event) {
      if (!touchPointers.has(event.pointerId)) return;
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!pinchActive) return;
      const distance = touchDistance();
      if (pinchStartDistance > 0) {
        updateGarmentScale(pinchStartScale * distance / pinchStartDistance, false);
      }
      event.preventDefault();
    }

    function handleTouchPointerEnd(event) {
      if (!touchPointers.delete(event.pointerId) || !pinchActive || touchPointers.size >= 2) return;
      pinchActive = false;
      controls.enabled = true;
      if (onFitScaleChange) onFitScaleChange(Math.round(fitScale * 100), true);
    }

    canvas.addEventListener("pointerdown", handleTouchPointerDown, { passive: false });
    canvas.addEventListener("pointermove", handleTouchPointerMove, { passive: false });
    canvas.addEventListener("pointerup", handleTouchPointerEnd);
    canvas.addEventListener("pointercancel", handleTouchPointerEnd);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function renderFrame() {
      if (disposed) return;
      frameId = window.requestAnimationFrame(renderFrame);
      controls.update();
      renderer.render(scene, camera);
    }
    renderer.render(scene, camera);
    renderFrame();

    function loadModel(gender, onProgress) {
      if (models[gender]) return Promise.resolve(models[gender]);
      if (loading[gender]) return loading[gender];
      loading[gender] = new Promise(function (resolve, reject) {
        loader.load(MODEL_URLS[gender], function (gltf) {
          const model = gltf.scene;
          try {
            fitModelToAvatar(model);
            applyMatteModelMaterials(model);
            const bounds = new THREE.Box3().setFromObject(model);
            const size = bounds.getSize(new THREE.Vector3());
            modelSizing[gender] = {
              minY: bounds.min.y,
              width: THREE.MathUtils.clamp(size.x / 0.84, 0.72, 1.38),
              height: THREE.MathUtils.clamp(size.y / 3, 0.85, 1.2),
              depth: THREE.MathUtils.clamp(size.z / 0.5, 0.72, 1.45),
              profile: measureAvatarProfile(model)
            };
            dropZones[gender] = createDropZones(modelSizing[gender]);
            dropZones[gender].visible = false;
            scene.add(dropZones[gender]);
            scene.add(model);
            renderer.compile(scene, camera);
            model.visible = false;
            models[gender] = model;
            resolve(model);
          } catch (error) {
            disposeTree(model);
            reject(error);
          }
        }, function (event) {
          if (onProgress) {
            onProgress({
              gender: gender,
              loaded: event.loaded,
              total: event.total,
              lengthComputable: event.lengthComputable
            });
          }
        }, reject);
      }).finally(function () {
        delete loading[gender];
      });
      return loading[gender];
    }

    return {
      preloadModels: function (onProgress) {
        return Promise.all(Object.keys(MODEL_URLS).map(function (gender) {
          return loadModel(gender, onProgress).then(function () {
            return { gender: gender, loaded: true };
          }, function (error) {
            return { gender: gender, loaded: false, error: error };
          });
        }));
      },
      hasModel: function (gender) {
        return Boolean(models[gender]);
      },
      setGender: function (gender) {
        if (!models[gender]) return false;
        Object.keys(models).forEach(function (key) {
          models[key].visible = key === gender;
          if (dropZones[key]) dropZones[key].visible = key === gender;
        });
        garments.visible = true;
        activeGender = gender;
        replaceGarments();
        controls.update();
        renderer.render(scene, camera);
        return true;
      },
      setOutfit: function (outfit) {
        currentOutfit = outfit || {};
        replaceGarments();
      },
      hitTestDrop: function (clientX, clientY, category) {
        if (!activeGender || !dropZones[activeGender]) return false;
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height || clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return false;
        dropPointer.set(
          ((clientX - bounds.left) / bounds.width) * 2 - 1,
          -((clientY - bounds.top) / bounds.height) * 2 + 1
        );
        dropRaycaster.setFromCamera(dropPointer, camera);
        const intersections = dropRaycaster.intersectObjects(dropZones[activeGender].userData.dropZones, false);
        return intersections.some(function (intersection) {
          return intersection.object.userData.dropCategories.indexOf(category) !== -1;
        });
      },
      setDebugHitboxes: function (enabled) {
        Object.keys(dropZones).forEach(function (gender) {
          dropZones[gender].userData.dropZones.forEach(function (zone) {
            zone.material.opacity = enabled ? 0.2 : 0;
          });
        });
      },
      setGarmentScale: function (value) {
        updateGarmentScale(value, false);
      },
      resetView: function () {
        controls.autoRotate = false;
        controls.target.set(0, 1.5, 0);
        camera.position.set(0, 1.72, 5.25);
        controls.update();
        renderer.render(scene, camera);
      },
      toggleRotation: function () {
        controls.autoRotate = !controls.autoRotate;
        return controls.autoRotate;
      },
      dispose: function () {
        disposed = true;
        window.cancelAnimationFrame(frameId);
        observer.disconnect();
        canvas.removeEventListener("pointerdown", handleTouchPointerDown);
        canvas.removeEventListener("pointermove", handleTouchPointerMove);
        canvas.removeEventListener("pointerup", handleTouchPointerEnd);
        canvas.removeEventListener("pointercancel", handleTouchPointerEnd);
        controls.dispose();
        Object.keys(models).forEach(function (gender) {
          disposeTree(models[gender]);
          if (dropZones[gender]) disposeTree(dropZones[gender]);
        });
        disposeTree(garments);
        renderer.dispose();
      }
    };
  }

  window.WardrobeAvatar3D = { create: createAvatar };
})();
