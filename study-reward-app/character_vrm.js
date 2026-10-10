// 3D 版キャラクター（VRM）。three.js + @pixiv/three-vrm（assets/lib/three-vrm.iife.js、初回 mount 時に読み込む）。
// モデル: assets/vrm/chara.vrm（VRoid β Ver AvatarSample_4 を tools/vrm/build_vrm.mjs で加工。水着は体テクスチャに焼き込み済み）
//
// 公開グローバル: CharacterVRM = { LAYERS, OUTFITS, supported(), mount(container, { colors }) → view }
//   view = { ready: Promise, setStage(stage, { animate }), setExpr(expr), react(kind), setColors(c), dispose() }
//   expr: normal | happy | shy | sad | pout     kind: correct | wrong | pass | away
//
// 衣装段階（stage = 外した枚数。ラベルは CharacterVRM.LAYERS / OUTFITS。2D とは別）
//   0 全部（モデルの服＋ベレー帽とマフラー）/ 1 ベレー帽とマフラーを外す / 2 袖を外す（ノースリーブのブラウス）
//   3 ブラウスを外す（ビキニのトップ＋スカート）/ 4 スカートを外す → ビキニ、ニーハイも外して素足
//   ベレー帽・マフラーは three.js で追加（髪と服の形を測ってフィットさせる）。ビキニは体テクスチャに焼き込み、色は swim 設定で置き換え。
// 体は常に水着が焼き込まれたテクスチャで描くため、どの段階・途中状態でも素肌の体は描画されない。
const CharacterVRM = (() => {
  "use strict";
  const LIB_URL = "assets/lib/three-vrm.iife.js";
  const MODEL_URL = "assets/vrm/chara.vrm";
  // 3D 用の段階ラベル（モデル本来の服を順に外す）。LAYERS[i] = 次の合格で外すもの、OUTFITS[s] = 段階 s でいちばん外側のもの
  const LAYERS = [
    { id: "accessory", label: "ベレー帽とマフラー" },
    { id: "sleeves", label: "袖" },
    { id: "blouse", label: "ブラウス" },
    { id: "skirt", label: "スカート" },
  ];
  const OUTFITS = ["ベレー帽とマフラー", "袖", "ブラウス", "スカート", "ビキニ"];
  const MAX_DPR = 2;

  function supported() {
    try {
      const c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch { return false; }
  }

  // ---------------- 読み込み（file:// / WKWebView でも動くよう script タグと XHR） ----------------
  let libPromise = null;
  function loadLib() {
    if (window.VRMLib) return Promise.resolve(window.VRMLib);
    if (libPromise) return libPromise;
    libPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LIB_URL;
      s.onload = () => (window.VRMLib ? res(window.VRMLib) : rej(new Error("VRMLib missing")));
      s.onerror = () => { libPromise = null; rej(new Error("lib load failed")); };
      document.head.appendChild(s);
    });
    return libPromise;
  }
  let bufPromise = null;
  function loadModel(url) {
    if (url) bufPromise = null; // 検査用に別のファイルを読むとき（tools/vrm/verify_render.mjs）
    if (bufPromise) return bufPromise;
    bufPromise = new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open("GET", url || MODEL_URL);
      x.responseType = "arraybuffer";
      x.onload = () => ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength > 1000 ? res(x.response) : rej(new Error("model status " + x.status)));
      x.onerror = () => rej(new Error("model load failed"));
      x.send();
    }).catch((e) => { bufPromise = null; throw e; });
    return bufPromise;
  }

  const EXPR = {
    normal: {},
    happy: { happy: 0.7 },
    shy: { relaxed: 0.45, happy: 0.2 },
    sad: { sad: 0.65 },
    pout: { angry: 0.45 },
  };
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

  function mount(container, opts = {}) {
    let disposed = false, raf = 0, T = null, renderer, scene, camera, vrm, clock, ro;
    let colors = { ...(opts.colors || {}) };
    let stage = 0, expr = "normal";
    const parts = {};          // name → [Object3D]
    const fades = [];          // { objs, from, to, t0, dur, done }
    const sparkles = [];
    let bodyMats = [], bodyMap = null, bareMap = null;
    const exprW = {};          // 現在の表情ウェイト
    let tempExpr = null, tempUntil = 0;
    let reactKind = null, reactT0 = 0;
    let blinkNext = 1.5, blinkT = -1;
    const look = { x: 0, y: 0, tx: 0, ty: 0, idleNext: 2 };
    let lookTarget;
    let pointerAt = 0;

    const canvasBox = document.createElement("div");
    canvasBox.className = "vrm-canvas";
    container.appendChild(canvasBox);

    const onPointer = (e) => {
      const r = container.getBoundingClientRect();
      if (!r.width) return;
      look.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      look.ty = Math.max(-1, Math.min(1, -((e.clientY - r.top) / r.height - 0.22) * 2));
      pointerAt = performance.now();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });

    const ready = (async () => {
      const L = await loadLib();
      const buf = await loadModel(opts.modelUrl);
      if (disposed) throw new Error("disposed");
      T = L;
      renderer = new L.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power", premultipliedAlpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
      renderer.outputColorSpace = L.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      canvasBox.appendChild(renderer.domElement);
      scene = new L.Scene();
      camera = new L.PerspectiveCamera(20, 0.5, 0.1, 20);
      const sun = new L.DirectionalLight(0xffffff, 2.4); sun.position.set(0.6, 1.6, 2.2); scene.add(sun);
      scene.add(new L.AmbientLight(0xffffff, 0.9));

      const loader = new L.GLTFLoader();
      loader.register((parser) => new L.VRMLoaderPlugin(parser));
      const gltf = await new Promise((res, rej) => loader.parse(buf, "", res, rej));
      if (disposed) throw new Error("disposed");
      vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("not a VRM");
      L.VRMUtils.removeUnnecessaryVertices(gltf.scene);
      L.VRMUtils.combineSkeletons(gltf.scene);
      L.VRMUtils.rotateVRM0(vrm);
      scene.add(vrm.scene);
      vrm.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

      // 部位をマテリアル名で集める
      const matName = (o) => [].concat(o.material).map((m) => (m && m.name) || "").join("|");
      vrm.scene.traverse((o) => {
        if (!o.isMesh) return;
        const n = matName(o);
        const add = (k) => (parts[k] = parts[k] || []).push(o);
        if (/_Sleeves/.test(n)) add("sleeves");
        else if (/_Ties/.test(n)) add("ties");
        else if (/_Blouse/.test(n)) add("blouse");
        else if (/_Skirt/.test(n)) add("skirt");
        else if (/Body_00_SKIN/.test(n)) { add("body"); [].concat(o.material).forEach((m) => m && m.map && bodyMats.push(m)); }
      });
      if (!parts.blouse || !parts.skirt || !parts.sleeves || !bodyMats.length) throw new Error("model parts missing");
      bodyMap = bodyMats[0].map;
      // 体の縁の照り返し（マットキャップ）を弱める。輪郭に沿った白っぽい筋が、脚の間などで線に見えるのを防ぐ
      bodyMats.forEach((m) => { if (m.matcapFactor) m.matcapFactor.multiplyScalar(0.3); if (m.parametricRimColorFactor) m.parametricRimColorFactor.multiplyScalar(0.3); });
      const ext = gltf.parser.json.extras && gltf.parser.json.extras.studyReward;
      if (!ext || !ext.swimsuitBaked) throw new Error("swimsuit not baked"); // 加工前の VRM は使わない
      bareMap = await gltf.parser.getDependency("texture", ext.bareLegsTexture);
      bareMap.colorSpace = L.SRGBColorSpace; bareMap.flipY = false;

      const H = vrm.humanoid;
      const raw = (b) => H.getRawBoneNode(b);
      buildAccessories(L, raw);
      buildBikiniTrims(L, raw);
      if (ext.swimMaskTexture !== undefined) {
        const maskTex = await gltf.parser.getDependency("texture", ext.swimMaskTexture);
        swimInfo = { maskTex, base: ext.swimBaseColor || [236, 128, 160], trim: ext.swimTrimColor || [150, 52, 92], orig: [bodyMap, bareMap] };
        applySwimColor();
      }
      lookTarget = new L.Object3D(); scene.add(lookTarget);
      if (vrm.lookAt) vrm.lookAt.target = lookTarget;
      // 胸の揺れものは加工時に削除済み。髪・スカート・袖の揺れはそのまま。
      setPose(0);
      applyStage(stage, false);
      clock = new L.Clock();
      ro = new ResizeObserver(resize); ro.observe(canvasBox); resize();
      vrm.update(0);
      if (vrm.springBoneManager) vrm.springBoneManager.reset();
      loop();
      return api;
    })();
    ready.catch(() => {});

    // ---------------- 小物（ベレー帽・マフラー）。髪と服の形を測って、頭・首に沿わせる ----------------
    function toon(L, col, extra = {}) {
      return new L.MToonMaterial({ color: new L.Color(col), shadeColorFactor: new L.Color(col).multiplyScalar(0.68), shadingToonyFactor: 0.9, shadingShiftFactor: -0.1, side: L.DoubleSide, ...extra });
    }
    // 輪郭線（裏面を少し大きく描く。モデル本体の線に合わせる）
    function outlined(L, geo, mat, w = 0.0022) {
      const g = new L.Group();
      const m = new L.Mesh(geo, mat);
      const lineGeo = geo.clone();
      const p = lineGeo.attributes.position, n = lineGeo.attributes.normal;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * w, p.getY(i) + n.getY(i) * w, p.getZ(i) + n.getZ(i) * w);
      const line = new L.Mesh(lineGeo, new L.MeshBasicMaterial({ color: 0x3a2a33, side: L.BackSide }));
      m.userData.tint = true;
      g.add(m, line);
      return g;
    }
    // メッシュの頂点（バインド姿勢）をワールド座標で集める
    function worldPoints(L, meshes, filter) {
      const out = [], v = new L.Vector3();
      for (const m of meshes) {
        const p = m.geometry.attributes.position, idx = m.geometry.index;
        const used = idx ? new Uint8Array(p.count) : null;
        if (idx) for (const i of idx.array) used[i] = 1;
        for (let i = 0; i < p.count; i++) {
          if (used && !used[i]) continue;
          v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
          if (!filter || filter(v)) out.push(v.clone());
        }
      }
      return out;
    }
    function buildAccessories(L, raw) {
      vrm.scene.updateMatrixWorld(true);
      const head = raw("head"), neck = raw("neck");
      const hairMeshes = [];
      vrm.scene.traverse((o) => { if (o.isMesh && /HAIR/.test([].concat(o.material).map((m) => m.name).join("|"))) hairMeshes.push(o); });
      const hp = head.getWorldPosition(new L.Vector3());
      const hair = worldPoints(L, hairMeshes, (v) => v.y > hp.y + 0.05 && Math.abs(v.x - hp.x) < 0.16 && Math.abs(v.z - hp.z) < 0.16);
      // (x, z) の真上の髪の高さ
      const hairH = (x, z, r = 0.022) => { let h = -1; for (const v of hair) if ((v.x - x) ** 2 + (v.z - z) ** 2 < r * r && v.y > h) h = v.y; return h; };

      // ---- ベレー帽（平たいドーム＋ふち＋小さな軸）。少し横に傾けてかぶせる
      const R = 0.112, band = 0.094;
      const prof = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 0.5; prof.push(new L.Vector2(Math.sin(a) * R, Math.cos(a) * 0.05)); } // 上面（0 → R）
      prof.push(new L.Vector2(R * 0.985, -0.006), new L.Vector2(R * 0.93, -0.013), new L.Vector2(band + 0.006, -0.016), new L.Vector2(band, -0.02), new L.Vector2(band - 0.002, -0.03));
      const beretGeo = new L.LatheGeometry(prof.reverse(), 48); beretGeo.computeVertexNormals();
      const beret = new L.Group();
      beret.add(outlined(L, beretGeo, toon(L, colors.beret || "#8a3550")));
      const stem = new L.Mesh(new L.CylinderGeometry(0.005, 0.008, 0.016, 10), toon(L, colors.beret || "#8a3550"));
      stem.position.y = 0.056; stem.userData.tint = true; beret.add(stem);
      const tilt = new L.Euler(-0.16, 0, 0.34); // 画面の左（キャラの右）へ傾ける
      const q = new L.Quaternion().setFromEuler(tilt);
      const cx = hp.x - 0.022, cz = hp.z - 0.012;
      // ふち（帯）の各点が髪の表面に少し沈むように高さを決める
      let base = Infinity;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const pnt = new L.Vector3(Math.cos(a) * band, -0.024, Math.sin(a) * band).applyQuaternion(q);
        const h = hairH(cx + pnt.x, cz + pnt.z, 0.03);
        if (h > 0) base = Math.min(base, h - pnt.y - 0.022); // 2cm ほど髪に沈めて頭にかぶせる
      }
      const topH = hairH(cx, cz, 0.07); // ふちの内側でいちばん高い髪
      if (!isFinite(base)) base = topH;
      // ドームの内側が髪のてっぺんに当たらないよう、必要なら少し高くする
      const crown = new L.Vector3(0, 0.05, 0).applyQuaternion(q).y + base;
      if (crown < topH + 0.012) beret.children[0].scale.y = 1 + (topH + 0.012 - crown) / 0.05;
      dbgInfo.beret = { hp: hp.toArray(), topH, base, crown, nHair: hair.length, cx, cz };
      beret.position.copy(head.worldToLocal(new L.Vector3(cx, base, cz)));
      beret.quaternion.copy(q);
      head.add(beret);

      // ---- マフラー: 襟の上にふんわり2重に巻いたスヌード
      const np = neck.getWorldPosition(new L.Vector3());
      const collar = worldPoints(L, parts.blouse, (v) => v.y > np.y - 0.01 && v.y < np.y + 0.045);
      let rx = 0.06, rz = 0.055, zc = np.z;
      if (collar.length) {
        let zmin = Infinity, zmax = -Infinity; for (const v of collar) { zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z); rx = Math.max(rx, Math.abs(v.x - np.x)); }
        zc = (zmin + zmax) / 2; rz = Math.max(rz, (zmax - zmin) / 2);
      }
      const col = colors.accent || "#e85d8a";
      const mat = toon(L, col), matDark = toon(L, new L.Color(col).multiplyScalar(0.85));
      const ring = (y, grow, thick, m, tiltX) => {
        const pts = [];
        for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(new L.Vector3(np.x + Math.sin(a) * (rx + grow), y + Math.cos(a) * tiltX, zc + Math.cos(a) * (rz + grow))); }
        const geo = new L.TubeGeometry(new L.CatmullRomCurve3(pts, true), 80, thick, 10, true);
        return outlined(L, geo, m, 0.0012);
      };
      const rings = [ring(np.y + 0.008, 0.02, 0.021, mat, 0.008), ring(np.y + 0.038, 0.014, 0.019, matDark, -0.005)];
      // 首の輪は首に付ける（ワールド座標で作ったので attach で位置を保つ）。垂れる端は平たい板に見えるので付けない（スヌード風）
      rings.forEach((r) => neck.attach(r));
      parts.accessory = [beret, ...rings];
    }
    // ---------------- ビキニの飾り（アンダーバンド中央と、ボトム両サイドの白いリボン）。体の表面を測って沿わせる ----------------
    function makeBow(L) {
      // 厚み方向が ±X（体の横向き）。正面に付けるときは Y 軸で 90 度回す
      const bow = new L.Group(), mat = toon(L, "#fff7fa");
      const wing = (dir) => { const g = new L.SphereGeometry(1, 16, 10); g.scale(0.0032, 0.0075, 0.012); const m = outlined(L, g, mat, 0.0007); m.position.set(0, 0.002, dir * 0.0125); m.rotation.x = dir * 0.55; return m; };
      bow.add(wing(-1), wing(1), outlined(L, new L.SphereGeometry(0.0058, 12, 8), mat, 0.0008));
      for (const dir of [-1, 1]) {
        const t = outlined(L, new L.BoxGeometry(0.0022, 0.022, 0.0055), mat, 0.0006);
        t.position.set(0, -0.012, dir * 0.005); t.rotation.x = dir * 0.3; bow.add(t);
      }
      return bow;
    }
    function buildBikiniTrims(L, raw) {
      vrm.scene.updateMatrixWorld(true);
      const chest = raw("upperChest") || raw("chest"), hips = raw("hips");
      const body = worldPoints(L, parts.body || []);
      // トップ: アンダーバンド中央（y 1.192）の前に小さなリボン
      let fz = -Infinity; for (const v of body) if (Math.abs(v.x) < 0.012 && Math.abs(v.y - 1.192) < 0.01 && v.z > fz) fz = v.z;
      if (isFinite(fz)) {
        const bow = makeBow(L); bow.scale.setScalar(1.15); bow.rotation.y = Math.PI / 2;
        bow.position.set(0, 1.194, fz + 0.006);
        chest.attach(bow);
        parts.bikiniTop = [bow];
      }
      // ボトム: 腰の左右（サイドの細い部分、y 0.955）
      const bows = [];
      for (const side of [-1, 1]) {
        let sx = 0, sz = 0;
        for (const v of body) if (Math.abs(v.y - 0.955) < 0.012 && Math.sign(v.x) === side && Math.abs(v.x) > Math.abs(sx)) { sx = v.x; sz = v.z; }
        if (!sx) continue;
        const bow = makeBow(L);
        bow.scale.setScalar(1.7);
        bow.position.set(sx + side * 0.012, 0.956, sz);
        bow.rotation.z = side * 0.12;
        hips.attach(bow);
        bows.push(bow);
      }
      parts.bikiniBottom = bows;
    }
    // ---------------- 水着の色（キャラ設定の swim 色）。マスクの範囲だけ色を置き換える ----------------
    const SKINS = [[253, 218, 199], [255, 241, 227]];
    function safeSwim(hex) {
      // 肌に近い色（明るく彩度の低い暖色）は使わない。明るさと彩度を制限し、肌から十分離れているか確認する。
      if (!hex) return null; // 未設定なら焼き込みの色のまま
      const c = new T.Color(hex), hsl = {}; c.getHSL(hsl);
      if (hsl.s < 0.12) hsl.l = Math.min(Math.max(hsl.l, 0.12), 0.38); // 白・グレーは濃いチャコールに（明るい無彩色は影で肌色に見える）
      else { hsl.s = Math.max(hsl.s, 0.4); hsl.l = Math.min(Math.max(hsl.l, 0.2), 0.68); }
      // 肌と同じ暖色の系統（赤〜黄）は、はっきり濃く・鮮やかにする
      if (hsl.s >= 0.12 && hsl.h * 360 >= 8 && hsl.h * 360 <= 55) { hsl.s = Math.max(hsl.s, 0.6); hsl.l = Math.min(hsl.l, 0.5); }
      c.setHSL(hsl.h, hsl.s, hsl.l);
      const rgb = [c.r * 255, c.g * 255, c.b * 255];
      if (SKINS.some((s) => Math.hypot(rgb[0] - s[0], rgb[1] - s[1], rgb[2] - s[2]) < 110)) return null;
      return rgb;
    }
    let maskData = null, swimApplied = null;
    const baseImg = new Map(); // texture → 元の画像
    function recolor(tex, rgb, base, trimBase) {
      const dark = rgb.map((v) => v * 0.62); // 縁取り・水玉は地色の濃い色
      const img = baseImg.get(tex) || tex.image; baseImg.set(tex, img);
      const W = img.width, H = img.height;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H), px = d.data, mk = maskData;
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        if (!mk[j]) continue;
        const b = mk[j] === 255 ? base : trimBase, c = mk[j] === 255 ? rgb : dark;
        const f = (px[i] / b[0] + px[i + 1] / b[1] + px[i + 2] / b[2]) / 3;
        px[i] = Math.min(255, c[0] * f); px[i + 1] = Math.min(255, c[1] * f); px[i + 2] = Math.min(255, c[2] * f);
      }
      cx.putImageData(d, 0, 0);
      const t = new T.CanvasTexture(cv);
      t.flipY = false; t.colorSpace = T.SRGBColorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
      return t;
    }
    let swimInfo = null; // { maskTex, base }
    function applySwimColor() {
      if (!swimInfo || !T) return;
      const rgb = safeSwim(colors.swim);
      const key = rgb ? rgb.map(Math.round).join(",") : "default";
      if (key === swimApplied) return;
      try {
        if (!maskData) {
          const img = swimInfo.maskTex.image, cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, img.width, img.height).data; maskData = new Uint8Array(d.length / 4);
          for (let i = 0; i < maskData.length; i++) maskData[i] = d[i * 4] > 230 ? 255 : d[i * 4] > 60 ? 128 : 0;
        }
        const old = [bodyMap, bareMap];
        if (rgb) { bodyMap = recolor(swimInfo.orig[0], rgb, swimInfo.base, swimInfo.trim); bareMap = recolor(swimInfo.orig[1], rgb, swimInfo.base, swimInfo.trim); }
        else { bodyMap = swimInfo.orig[0]; bareMap = swimInfo.orig[1]; }
        old.forEach((t) => { if (t && !swimInfo.orig.includes(t) && t !== bodyMap && t !== bareMap) t.dispose(); });
        bodyMats.forEach((m) => { m.map = null; });
        setBodyBare(stage >= 4 && !pendingBare);
        swimApplied = key;
      } catch (e) { console.warn("水着の色を変えられませんでした", e); }
    }
    function setColors(c) {
      colors = { ...colors, ...c };
      if (!T) return;
      const paint = (objs, hex) => objs && objs.forEach((root) => root.traverse((o) => {
        if (!o.isMesh || !o.userData.tint || !hex) return;
        const base = new T.Color(hex);
        if (o.material.color) o.material.color.copy(base);
        if (o.material.shadeColorFactor) o.material.shadeColorFactor.copy(base.clone().multiplyScalar(0.68));
      }));
      if (parts.accessory) { paint([parts.accessory[0]], colors.beret); paint(parts.accessory.slice(1), colors.accent); }
      applySwimColor();
    }

    // ---------------- 衣装段階 ----------------
    function visibleAt(name, s) {
      switch (name) {
        case "accessory": return s < 1;
        case "sleeves": return s < 2;
        case "blouse": case "ties": return s < 3;
        case "skirt": return s < 4;
        case "bikiniTop": return s >= 3;
        case "bikiniBottom": return s >= 4;
      }
      return true;
    }
    const NAMES = ["accessory", "sleeves", "blouse", "ties", "skirt", "bikiniTop", "bikiniBottom"];
    function matsOf(objs) {
      const ms = [];
      objs.forEach((root) => root.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m && ms.push(m)); }));
      return ms;
    }
    function setOpacity(objs, a) {
      matsOf(objs).forEach((m) => {
        if (m.userData.baseTransparent === undefined) { m.userData.baseTransparent = m.transparent; m.userData.baseDepthWrite = m.depthWrite; }
        const fading = a < 0.999;
        if (m.transparent !== (fading || m.userData.baseTransparent)) { m.transparent = fading || m.userData.baseTransparent; m.needsUpdate = true; }
        m.depthWrite = fading ? false : m.userData.baseDepthWrite;
        m.opacity = a;
      });
    }
    let pendingBare = false;
    const dbgInfo = {};
    function setBodyBare(on) {
      const map = on ? bareMap : bodyMap;
      bodyMats.forEach((m) => {
        if (m.map !== map) { m.map = map; if ("shadeMultiplyTexture" in m && m.shadeMultiplyTexture) m.shadeMultiplyTexture = map; m.needsUpdate = true; }
      });
    }
    function applyStage(s, animate) {
      if (!vrm) return;
      const now = performance.now();
      for (const n of NAMES) {
        const objs = parts[n]; if (!objs) continue;
        const want = visibleAt(n, s);
        const shown = objs[0].visible && !objs[0].userData.fadingOut;
        if (want === shown) continue;
        if (!animate) { objs.forEach((o) => { o.visible = want; o.userData.fadingOut = false; }); setOpacity(objs, 1); continue; }
        if (want) { objs.forEach((o) => { o.visible = true; o.userData.fadingOut = false; }); setOpacity(objs, 0); fades.push({ objs, from: 0, to: 1, t0: now, dur: 650 }); }
        else { objs.forEach((o) => (o.userData.fadingOut = true)); fades.push({ objs, from: 1, to: 0, t0: now + 120, dur: 750 }); burst(n); }
      }
      // 素足（ニーハイを外す）は最終段階。アニメーション中はスカートが消えきってから切り替える。
      if (animate && s >= 4) { pendingBare = true; setTimeout(() => { pendingBare = false; if (!disposed && stage >= 4) setBodyBare(true); }, 520); }
      else setBodyBare(s >= 4);
    }
    // 衣装が外れるときのやわらかい光の粒
    let sparkTex = null;
    function burst(name) {
      if (!T) return;
      if (!sparkTex) {
        const c = document.createElement("canvas"); c.width = c.height = 64;
        const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,240,215,.85)"); g.addColorStop(1, "rgba(255,220,180,0)");
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        sparkTex = new T.CanvasTexture(c);
      }
      const yr = { accessory: [1.35, 1.75], blouse: [1.0, 1.45], sleeves: [1.0, 1.4], skirt: [0.75, 1.05] }[name] || [0.8, 1.4];
      for (let i = 0; i < 16; i++) {
        const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: sparkTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        const a = Math.random() * Math.PI * 2, r = 0.12 + Math.random() * 0.16;
        m.position.set(Math.cos(a) * r, yr[0] + Math.random() * (yr[1] - yr[0]), 0.25 + Math.sin(a) * 0.08);
        const s = 0.03 + Math.random() * 0.05; m.scale.set(s, s, s);
        m.userData = { t0: performance.now() + Math.random() * 250, life: 900 + Math.random() * 500, vx: Math.cos(a) * 0.06, vy: 0.08 + Math.random() * 0.12, s };
        scene.add(m); sparkles.push(m);
      }
    }

    // ---------------- ポーズ・アイドル ----------------
    const D2R = Math.PI / 180;
    function bone(n) { return vrm.humanoid.getNormalizedBoneNode(n); }
    function setPose(t) {
      const br = Math.sin(t * 1.25);              // 呼吸
      const sway = Math.sin(t * 0.55);
      const B = (n) => bone(n) || { rotation: { set() {} }, position: {} };
      B("leftUpperArm").rotation.set(0, 0, (72 - br * 0.6) * D2R);
      B("rightUpperArm").rotation.set(0, 0, (-72 + br * 0.6) * D2R);
      B("leftLowerArm").rotation.set(0, -14 * D2R, 6 * D2R);
      B("rightLowerArm").rotation.set(0, 14 * D2R, -6 * D2R);
      B("leftHand").rotation.set(0, 0, 6 * D2R);
      B("rightHand").rotation.set(0, 0, -6 * D2R);
      for (const side of ["left", "right"]) {
        const s = side === "left" ? 1 : -1;
        for (const f of ["Index", "Middle", "Ring", "Little"]) for (const j of ["Proximal", "Intermediate", "Distal"]) {
          const b = bone(side + f + j); if (b) b.rotation.set(0, 0, s * (j === "Proximal" ? 10 : 18) * D2R);
        }
        for (const j of ["Proximal", "Intermediate", "Distal"]) { const b = bone(side + "Thumb" + j); if (b) b.rotation.set(0, s * 12 * D2R, 0); }
      }
      B("spine").rotation.set(br * 0.6 * D2R, 0, sway * 0.5 * D2R);
      B("chest").rotation.set(br * 0.8 * D2R, 0, 0);
      B("hips").rotation.set(0, sway * 1.2 * D2R, -sway * 0.6 * D2R);
      B("leftUpperLeg").rotation.set(0, 0, 1.2 * D2R);
      B("rightUpperLeg").rotation.set(0, 0, -1.2 * D2R);
    }
    function idle(t, dt) {
      setPose(t);
      const now = performance.now();
      // リアクション
      let hop = 0, droop = 0, turn = 0;
      if (reactKind) {
        const e = (now - reactT0) / 1000;
        if (reactKind === "correct" || reactKind === "pass") {
          const d = reactKind === "pass" ? 0.9 : 0.55, h = reactKind === "pass" ? 0.07 : 0.045;
          hop = e < d ? Math.sin((e / d) * Math.PI) * h * (reactKind === "pass" ? 1 : 1 - e / d * 0.3) : 0;
          if (e > 1.1) reactKind = null;
        } else if (reactKind === "wrong") {
          droop = e < 1.4 ? Math.sin(Math.min(1, e / 1.4) * Math.PI) : 0;
          if (e > 1.5) reactKind = null;
        } else if (reactKind === "away") {
          turn = e < 2 ? Math.sin(Math.min(1, e / 2) * Math.PI) : 0;
          if (e > 2.1) reactKind = null;
        }
      }
      const hips = bone("hips");
      if (hips) hips.position.y = (hips.userData.y0 ?? (hips.userData.y0 = hips.position.y)) + hop - droop * 0.012;
      // 首・頭（ゆっくり揺れる＋視線の方向へ少し向く）
      if (now - pointerAt > 4000) {
        look.idleNext -= dt;
        if (look.idleNext <= 0) { look.tx = (Math.random() - 0.5) * 0.5; look.ty = (Math.random() - 0.3) * 0.3; look.idleNext = 2.5 + Math.random() * 3; }
      }
      const shy = expr === "shy" ? 1 : 0;
      look.x += (look.tx - look.x) * Math.min(1, dt * 4);
      look.y += (look.ty - look.y) * Math.min(1, dt * 4);
      const neck = bone("neck"), head = bone("head");
      const ny = look.x * 9 + Math.sin(t * 0.43) * 2.2 + turn * 28;
      const nx = -look.y * 5 + Math.sin(t * 0.31) * 1.2 + droop * 14 + shy * 6 + (expr === "sad" ? 5 : 0);
      const nz = Math.sin(t * 0.37) * 2 + shy * 7 - (expr === "happy" ? 4 : 0);
      if (neck) neck.rotation.set(nx * 0.5 * D2R, ny * 0.5 * D2R, nz * 0.5 * D2R);
      if (head) head.rotation.set(nx * 0.5 * D2R, ny * 0.5 * D2R, nz * 0.5 * D2R);
      // 視線
      if (lookTarget && camera) {
        lookTarget.position.set(camera.position.x + look.x * 0.6 + turn * 1.6, 1.42 + look.y * 0.35 - shy * 0.35 - droop * 0.3, camera.position.z);
      }
      // 表情（一時的なリアクション表情 → 基本表情）
      const base = tempExpr && now < tempUntil ? tempExpr : expr;
      if (tempExpr && now >= tempUntil) tempExpr = null;
      const target = EXPR[base] || {};
      const em = vrm.expressionManager;
      if (em) {
        for (const k of ["happy", "relaxed", "sad", "angry"]) {
          const w = exprW[k] || 0, to = target[k] || 0;
          exprW[k] = w + (to - w) * Math.min(1, dt * 7);
          em.setValue(k, exprW[k]);
        }
        // まばたき（笑顔で目を閉じている分は弱める）
        blinkNext -= dt;
        if (blinkNext <= 0 && blinkT < 0) { blinkT = 0; blinkNext = 2 + Math.random() * 3.5; }
        let bl = 0;
        if (blinkT >= 0) { blinkT += dt; bl = blinkT < 0.07 ? blinkT / 0.07 : blinkT < 0.16 ? 1 - (blinkT - 0.07) / 0.09 : 0; if (blinkT >= 0.16) blinkT = -1; }
        em.setValue("blink", bl * Math.max(0, 1 - (exprW.happy || 0) * 1.4));
      }
    }

    // ---------------- 描画ループ ----------------
    function resize() {
      if (!renderer) return;
      const w = Math.max(1, canvasBox.clientWidth), h = Math.max(1, canvasBox.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 全身（頭頂 1.80m 〜 足元 -0.02m）が縦に収まる距離
      const top = 1.8, bottom = -0.02, cy = (top + bottom) / 2;
      const half = (top - bottom) / 2 * 1.02;
      const fovV = camera.fov * D2R;
      let dist = half / Math.tan(fovV / 2);
      const halfW = 0.36; // 腕・髪の横幅
      const needW = halfW / (Math.tan(fovV / 2) * camera.aspect);
      dist = Math.max(dist, needW);
      camera.position.set(0, cy, dist);
      camera.lookAt(0, cy, 0);
      camera.updateProjectionMatrix();
    }
    function loop() {
      raf = requestAnimationFrame(loop);
      if (document.hidden || !canvasBox.offsetParent) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const t = clock.elapsedTime;
      idle(t, dt);
      const now = performance.now();
      for (let i = fades.length - 1; i >= 0; i--) {
        const f = fades[i], k = ease((now - f.t0) / f.dur);
        setOpacity(f.objs, f.from + (f.to - f.from) * k);
        if (k >= 1) { if (f.to === 0) f.objs.forEach((o) => { o.visible = false; o.userData.fadingOut = false; }); setOpacity(f.objs, 1); fades.splice(i, 1); }
      }
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const m = sparkles[i], u = m.userData, e = (now - u.t0) / u.life;
        if (e < 0) { m.visible = false; continue; }
        m.visible = true;
        m.position.x += u.vx * dt; m.position.y += u.vy * dt;
        const a = e < 0.2 ? e / 0.2 : 1 - (e - 0.2) / 0.8;
        m.material.opacity = Math.max(0, a); m.quaternion.copy(camera.quaternion);
        if (e >= 1) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); sparkles.splice(i, 1); }
      }
      vrm.update(dt);
      renderer.render(scene, camera);
    }

    const api = {
      ready,
      setStage(s, { animate = false } = {}) {
        s = Math.max(0, Math.min(LAYERS.length, s | 0));
        const prev = stage; stage = s;
        if (vrm) applyStage(s, animate && s !== prev);
      },
      setExpr(e) { if (EXPR[e]) expr = e; },
      react(kind) {
        reactKind = kind; reactT0 = performance.now();
        tempExpr = kind === "correct" || kind === "pass" ? "happy" : kind === "wrong" ? "sad" : kind === "away" ? "pout" : null;
        tempUntil = performance.now() + (kind === "pass" ? 1800 : 1200);
      },
      setColors,
      _dbg: () => ({ vrm, camera, scene, renderer, info: dbgInfo, parts }),
      dispose() {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("pointerdown", onPointer);
        if (ro) ro.disconnect();
        try { if (vrm && T) T.VRMUtils.deepDispose(vrm.scene); } catch {}
        try { if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } } catch {}
        canvasBox.remove();
      },
    };
    return api;
  }

  return { LAYERS, OUTFITS, supported, mount };
})();
