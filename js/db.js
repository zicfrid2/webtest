import { DB_NAME, STORE_NAME, IMAGE_KEY, META_KEY, TARGET_W, TARGET_H } from "./constants.js";

export async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export async function getFromDB(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
  });
}

export async function loadSourceData(state, dom) {
  state.sourceBlob = await getFromDB(IMAGE_KEY);
  state.sourceMeta = await getFromDB(META_KEY);

  if (!state.sourceBlob) {
    throw new Error("capturedImage가 없습니다.");
  }
  if (!state.sourceMeta || !Array.isArray(state.sourceMeta.landmarks)) {
    throw new Error("capturedMeta.landmarks가 없습니다.");
  }

  state.sourceImageBitmap = await createImageBitmap(state.sourceBlob);

  if (
    state.sourceImageBitmap.width !== TARGET_W ||
    state.sourceImageBitmap.height !== TARGET_H
  ) {
    const temp = document.createElement("canvas");
    temp.width = TARGET_W;
    temp.height = TARGET_H;
    const tctx = temp.getContext("2d");
    tctx.drawImage(state.sourceImageBitmap, 0, 0, TARGET_W, TARGET_H);
    state.sourceImageBitmap.close();
    state.sourceImageBitmap = await createImageBitmap(temp);
  }

  dom.statusEl.textContent = "이미지와 랜드마크를 불러왔습니다.";
  dom.infoBadge.textContent = "로딩 완료";
}

export async function savePreviewToFile(dom) {
  const canvas = dom.canvas.previewCanvas;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas.toBlob failed");

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `facefx_preview_${Date.now()}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}
