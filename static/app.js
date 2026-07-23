const state = {
  currentIndex: 0,
  total: 0,
  completed: 0,
  dirty: false,
  loading: false,
  currentRow: null,
  displayedImage: null,
  zoomScale: 1,
  zoomX: 0,
  zoomY: 0,
  zoomDragging: false,
  zoomPointerX: 0,
  zoomPointerY: 0,
  animalFilter: null,
  filterIndices: [],
  filterPos: 0,
};

const el = (id) => document.getElementById(id);

const ANIMAL_SHORTCUTS = {
  b: "boar（イノシシ）",
  k: "bear（クマ）",
  t: "racoondog（タヌキ）",
  h: "man（ヒト）",
  c: "car（クルマ）",
  u: "maskedmusang（ハクビシン）",
  i: "dog（イヌ）",
  n: "cat（ネコ）",
  s: "deer（シカ）",
  f: "fox（キツネ）",
  w: "serow（カモシカ）",
  r: "rabbit（ウサギ）",
  o: "craw（カラス）",
  m: "monkey（サル）",
  g: "badger（アナグマ）",
  v: "racoon（アライグマ）",
  q: "?",
  x: "いない",
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "応答を読み取れませんでした。" }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function showError(target, message) {
  target.textContent = message;
  target.classList.toggle("hidden", !message);
}

function setBusy(busy) {
  state.loading = busy;
  ["browseButton", "openButton", "saveNextButton", "holdButton", "previousButton", "nextButton", "nextIncompleteButton", "nextHoldButton", "bulkConfirmButton", "bulkHoldButton"]
    .forEach((id) => { if (el(id)) el(id).disabled = busy; });
}

function updateSummary(payload) {
  state.total = payload.total;
  state.completed = payload.completed;
  el("workbookName").textContent = payload.workbook;
  el("deviceNumber").textContent = payload.deviceNumber;
  el("analysisDate").textContent = payload.analysisDate;
  const pct = payload.total ? Math.floor((payload.completed / payload.total) * 100) : 0;
  el("progressText").textContent = `${payload.completed.toLocaleString()} / ${payload.total.toLocaleString()} 件確認済み (${pct}%)`;
  el("progressBar").style.width = payload.total ? `${payload.completed / payload.total * 100}%` : "0%";
}

function renderRow(row, options = {}) {
  state.currentIndex = row.index;
  state.currentRow = row;
  state.dirty = false;
  el("positionBadge").textContent = `${(row.index + 1).toLocaleString()} / ${state.total.toLocaleString()}`;
  const statusMap = { reviewed: "確認済み", hold: "保留", pending: "未確認" };
  el("reviewBadge").textContent = statusMap[row.status] || "未確認";
  el("reviewBadge").className = `badge status ${row.status || "pending"}`;
  el("fileName").textContent = row.filename;
  el("imagePath").textContent = row.imagePath || row.pathError || "画像パスを生成できません";
  el("predictedAnimal").textContent = row.predictedAnimal || "（空欄）";
  el("predictedCount").textContent = row.predictedCount ?? "（空欄）";
  el("deviceValue").textContent = row.device || "（空欄）";
  el("animalSelect").value = row.selectedAnimal;
  el("countInput").value = row.manualCount ?? "";
  updateCountState();
  showError(el("saveError"), "");
  if (!options.keepStatus) el("saveStatus").textContent = "";

  renderContextImages(row);
  showDisplayedImage({
    displayId: "current",
    sourceUrl: `/api/image/${row.index}`,
    filename: row.filename,
    imagePath: row.imagePath,
    imageExists: row.imageExists,
    isCurrent: true,
    error: row.pathError,
  });
}

function showDisplayedImage(item) {
  state.displayedImage = item;
  const image = el("animalImage");
  const imageError = el("imageError");
  const source = `${item.sourceUrl}?v=${Date.now()}`;
  image.classList.toggle("hidden", !item.imageExists);
  imageError.classList.toggle("hidden", item.imageExists);
  el("referenceBadge").classList.toggle("hidden", item.isCurrent);
  el("returnCurrentButton").classList.toggle("hidden", item.isCurrent);
  el("zoomFileName").textContent = item.filename;
  if (item.imageExists) {
    image.src = source;
    el("zoomImage").src = source;
  } else {
    image.removeAttribute("src");
    el("zoomImage").removeAttribute("src");
    el("imageErrorText").textContent = item.error || item.imagePath;
  }
  document.querySelectorAll(".context-thumb").forEach((button) => {
    button.classList.toggle("active", button.dataset.displayId === item.displayId);
  });
  resetZoom();
}

function renderContextImages(row) {
  const panel = el("contextPanel");
  const container = el("contextImages");
  const items = row.contextImages || [];
  container.replaceChildren();
  panel.classList.toggle("hidden", items.length <= 1);
  if (items.length <= 1) return;

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `context-thumb${item.isCurrent ? " active" : ""}`;
    button.dataset.displayId = item.isCurrent ? "current" : `context-${item.contextPosition}`;
    button.title = item.filename;

    const image = document.createElement("img");
    image.alt = `${item.capturedAt} フレーム ${item.frame}`;
    const sourceUrl = `/api/context-image/${row.index}/${item.contextPosition}`;
    if (item.imageExists) image.src = sourceUrl;
    const label = document.createElement("span");
    label.textContent = item.filename;
    const frame = document.createElement("small");
    const status = item.detected ? "" : "未検出 ";
    frame.textContent = item.isCurrent ? `対象 ${item.capturedAt}` : `${status}${item.capturedAt}`;
    button.append(image, label, frame);
    button.addEventListener("click", () => showDisplayedImage({
      ...item,
      displayId: item.isCurrent ? "current" : `context-${item.contextPosition}`,
      sourceUrl,
    }));
    container.append(button);
  });
}

function showCurrentImage() {
  if (!state.currentRow) return;
  showDisplayedImage({
    displayId: "current",
    sourceUrl: `/api/image/${state.currentRow.index}`,
    filename: state.currentRow.filename,
    imagePath: state.currentRow.imagePath,
    imageExists: state.currentRow.imageExists,
    isCurrent: true,
    error: state.currentRow.pathError,
  });
}

function applyZoom() {
  el("zoomImage").style.transform = `translate(${state.zoomX}px, ${state.zoomY}px) scale(${state.zoomScale})`;
  el("zoomValue").textContent = `${Math.round(state.zoomScale * 100)}%`;
}

function resetZoom() {
  state.zoomScale = 1;
  state.zoomX = 0;
  state.zoomY = 0;
  applyZoom();
}

function changeZoom(amount) {
  state.zoomScale = Math.max(1, Math.min(6, state.zoomScale + amount));
  if (state.zoomScale === 1) {
    state.zoomX = 0;
    state.zoomY = 0;
  }
  applyZoom();
}

function updateCountState() {
  const absent = el("animalSelect").value === "いない";
  el("countInput").disabled = absent;
  if (absent) el("countInput").value = "";
  el("countHint").textContent = absent
    ? "「いない」のため、目視による数は空欄で保存されます。"
    : "0以上の整数を入力してください。";
}

async function chooseFolder() {
  setBusy(true);
  showError(el("setupError"), "");
  try {
    const payload = await api("/api/choose-folder", { method: "POST", body: "{}" });
    if (payload.path) el("folderPath").value = payload.path;
  } catch (error) {
    showError(el("setupError"), error.message);
  } finally {
    setBusy(false);
  }
}

async function openFolder() {
  const path = el("folderPath").value.trim();
  if (!path) return showError(el("setupError"), "解析結果フォルダを指定してください。");
  setBusy(true);
  showError(el("setupError"), "");
  try {
    const payload = await api("/api/open", { method: "POST", body: JSON.stringify({ path }) });
    const select = el("animalSelect");
    select.innerHTML = "";
    payload.animals.forEach((animal) => select.add(new Option(animal, animal)));
    const bulkSelect = el("bulkAnimalSelect");
    bulkSelect.innerHTML = '<option value="">(AI予測のまま)</option>';
    payload.animals.forEach((animal) => bulkSelect.add(new Option(animal, animal)));
    updateSummary(payload);
    renderRow(payload.row);
    clearAnimalFilter();
    el("setupPanel").classList.add("hidden");
    el("reviewPanel").classList.remove("hidden");
    el("progressBlock").classList.remove("hidden");
  } catch (error) {
    showError(el("setupError"), error.message);
  } finally {
    setBusy(false);
  }
}

async function loadRow(index) {
  if (state.loading || state.total === 0) return;
  const bounded = Math.max(0, Math.min(index, state.total - 1));
  setBusy(true);
  try {
    const payload = await api(`/api/row/${bounded}`);
    updateSummary(payload);
    renderRow(payload.row);
    if (state.animalFilter) {
      const pos = state.filterIndices.indexOf(bounded);
      if (pos === -1) {
        clearAnimalFilter();
      } else {
        state.filterPos = pos;
      }
    }
  } catch (error) {
    showError(el("saveError"), error.message);
  } finally {
    setBusy(false);
  }
}

async function stepImage(delta) {
  if (state.animalFilter) {
    const newPos = state.filterPos + delta;
    if (newPos < 0 || newPos >= state.filterIndices.length) return;
    await moveTo(state.filterIndices[newPos]);
  } else {
    await moveTo(state.currentIndex + delta);
  }
}

async function activateAnimalFilter(animalName) {
  if (state.loading) return;
  if (state.dirty) {
    const saved = await saveCurrent(false);
    if (!saved) return;
  }
  setBusy(true);
  try {
    const payload = await api(`/api/animal-indices/${encodeURIComponent(animalName)}`);
    if (payload.indices.length === 0) {
      setBusy(false);
      showError(el("saveError"), `${animalName} の画像はありません。`);
      return;
    }
    state.animalFilter = animalName;
    state.filterIndices = payload.indices;
    state.filterPos = 0;
    updateFilterBadge();
    setBusy(false);
    await loadRow(state.filterIndices[0]);
  } catch (error) {
    setBusy(false);
    showError(el("saveError"), error.message);
  }
}

function clearAnimalFilter() {
  state.animalFilter = null;
  state.filterIndices = [];
  state.filterPos = 0;
  updateFilterBadge();
}

function updateFilterBadge() {
  const badge = el("filterBadge");
  if (state.animalFilter) {
    badge.textContent = `絞り込み中: ${state.animalFilter}（Escで解除）`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function saveCurrent(advance = false) {
  if (state.loading || state.total === 0) return false;
  setBusy(true);
  showError(el("saveError"), "");
  el("saveStatus").textContent = "保存中…";
  try {
    const payload = await api("/api/save", {
      method: "POST",
      body: JSON.stringify({
        index: state.currentIndex,
        animal: el("animalSelect").value,
        count: el("countInput").value,
      }),
    });
    state.dirty = false;
    updateSummary(payload);
    el("saveStatus").textContent = "Excelへ保存しました。";
    if (advance && state.currentIndex < state.total - 1) {
      const nextIndex = state.currentIndex + 1;
      setBusy(false);
      await loadRow(nextIndex);
    } else {
      renderRow(payload.row, { keepStatus: true });
    }
    return true;
  } catch (error) {
    el("saveStatus").textContent = "";
    showError(el("saveError"), error.message);
    return false;
  } finally {
    setBusy(false);
  }
}

async function moveTo(index) {
  if (state.dirty) {
    const saved = await saveCurrent(false);
    if (!saved) return;
  }
  await loadRow(index);
}

async function nextIncomplete() {
  if (state.dirty) {
    const saved = await saveCurrent(false);
    if (!saved) return;
  }
  setBusy(true);
  try {
    const payload = await api(`/api/next-unreviewed/${state.currentIndex}`);
    updateSummary(payload);
    if (payload.index === null) {
      el("saveStatus").textContent = "すべて確認済みです。";
    } else {
      setBusy(false);
      await loadRow(payload.index);
    }
  } catch (error) {
    showError(el("saveError"), error.message);
  } finally {
    setBusy(false);
  }
}

async function holdCurrent(advance = false) {
  if (state.loading || state.total === 0) return false;
  setBusy(true);
  showError(el("saveError"), "");
  el("saveStatus").textContent = "保存中…";
  try {
    const payload = await api("/api/hold", {
      method: "POST",
      body: JSON.stringify({
        indices: [state.currentIndex]
      }),
    });
    state.dirty = false;
    updateSummary(payload);
    el("saveStatus").textContent = "保留として保存しました。";
    if (advance && state.currentIndex < state.total - 1) {
      const nextIndex = state.currentIndex + 1;
      setBusy(false);
      await loadRow(nextIndex);
    } else {
      setBusy(false);
      await loadRow(state.currentIndex);
    }
    return true;
  } catch (error) {
    el("saveStatus").textContent = "";
    showError(el("saveError"), error.message);
    return false;
  } finally {
    setBusy(false);
  }
}

async function nextHold() {
  if (state.dirty) {
    const saved = await saveCurrent(false);
    if (!saved) return;
  }
  setBusy(true);
  try {
    const payload = await api(`/api/next-hold/${state.currentIndex}`);
    updateSummary(payload);
    if (payload.index === null) {
      el("saveStatus").textContent = "保留の画像はありません。";
    } else {
      setBusy(false);
      await loadRow(payload.index);
    }
  } catch (error) {
    showError(el("saveError"), error.message);
  } finally {
    setBusy(false);
  }
}

el("browseButton").addEventListener("click", chooseFolder);
el("openButton").addEventListener("click", openFolder);
el("folderPath").addEventListener("keydown", (event) => { if (event.key === "Enter") openFolder(); });
el("changeFolderButton").addEventListener("click", () => {
  if (state.dirty && !confirm("未保存の入力があります。フォルダ選択へ戻りますか？")) return;
  el("reviewPanel").classList.add("hidden");
  el("progressBlock").classList.add("hidden");
  el("setupPanel").classList.remove("hidden");
});
el("animalSelect").addEventListener("change", () => { state.dirty = true; updateCountState(); });
el("countInput").addEventListener("input", () => { state.dirty = true; });

function updateBulkCountState() {
  const absent = el("bulkAnimalSelect").value === "いない";
  el("bulkCountInput").disabled = absent;
  if (absent) el("bulkCountInput").value = "";
  el("bulkCountHint").textContent = absent
    ? "「いない」のため、目視による数は空欄で保存されます。"
    : "空欄の場合はAI予測の数が保存されます。";
}
el("bulkAnimalSelect").addEventListener("change", updateBulkCountState);

el("saveNextButton").addEventListener("click", () => saveCurrent(true));
el("previousButton").addEventListener("click", () => stepImage(-1));
el("nextButton").addEventListener("click", () => stepImage(1));
el("nextIncompleteButton").addEventListener("click", nextIncomplete);
el("nextHoldButton").addEventListener("click", nextHold);
el("returnCurrentButton").addEventListener("click", showCurrentImage);
el("zoomButton").addEventListener("click", () => {
  if (!el("zoomImage").src) return;
  resetZoom();
  el("zoomDialog").showModal();
});
el("closeZoomButton").addEventListener("click", () => el("zoomDialog").close());
el("zoomInButton").addEventListener("click", () => changeZoom(0.5));
el("zoomOutButton").addEventListener("click", () => changeZoom(-0.5));
el("zoomResetButton").addEventListener("click", resetZoom);
el("zoomViewport").addEventListener("wheel", (event) => {
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 0.5 : -0.5);
}, { passive: false });
el("zoomViewport").addEventListener("dblclick", () => {
  if (state.zoomScale === 1) changeZoom(1);
  else resetZoom();
});
el("zoomViewport").addEventListener("pointerdown", (event) => {
  if (state.zoomScale === 1) return;
  state.zoomDragging = true;
  state.zoomPointerX = event.clientX;
  state.zoomPointerY = event.clientY;
  el("zoomViewport").classList.add("dragging");
  el("zoomViewport").setPointerCapture(event.pointerId);
});
el("zoomViewport").addEventListener("pointermove", (event) => {
  if (!state.zoomDragging) return;
  state.zoomX += event.clientX - state.zoomPointerX;
  state.zoomY += event.clientY - state.zoomPointerY;
  state.zoomPointerX = event.clientX;
  state.zoomPointerY = event.clientY;
  applyZoom();
});
function stopZoomDrag() {
  state.zoomDragging = false;
  el("zoomViewport").classList.remove("dragging");
}
el("zoomViewport").addEventListener("pointerup", stopZoomDrag);
el("zoomViewport").addEventListener("pointercancel", stopZoomDrag);

document.addEventListener("keydown", (event) => {
  if (el("reviewPanel").classList.contains("hidden") || state.loading) return;
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveCurrent(false);
  } else if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
    event.preventDefault();
    saveCurrent(true);
  } else if (["ArrowLeft", "a", "A"].includes(event.key) && !["INPUT", "SELECT"].includes(event.target.tagName)) {
    stepImage(-1);
  } else if (["ArrowRight", "d", "D"].includes(event.key) && !["INPUT", "SELECT"].includes(event.target.tagName)) {
    stepImage(1);
  } else if (
    !el("singleMode").classList.contains("hidden") &&
    !el("zoomDialog").open &&
    !event.ctrlKey && !event.metaKey && !event.altKey &&
    !["INPUT", "SELECT"].includes(event.target.tagName) &&
    ANIMAL_SHORTCUTS[event.key.toLowerCase()]
  ) {
    activateAnimalFilter(ANIMAL_SHORTCUTS[event.key.toLowerCase()]);
  } else if (event.key === "Escape" && el("zoomDialog").open) {
    el("zoomDialog").close();
  } else if (event.key === "Escape" && state.animalFilter) {
    clearAnimalFilter();
  } else if (event.key === "Escape" && !el("gridMode").classList.contains("hidden")) {
    gridState.checkedIndices.clear();
    document.querySelectorAll(".grid-card").forEach(c => c.classList.remove("checked"));
    updateBulkButtonLabel();
  } else if (el("zoomDialog").open && (event.key === "+" || event.key === "=")) {
    changeZoom(0.5);
  } else if (el("zoomDialog").open && event.key === "-") {
    changeZoom(-0.5);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

/* ── Grid View Logic ── */

const gridState = {
  currentAnimal: null,
  currentPage: 0,
  totalPages: 0,
  checkedIndices: new Set(),
  gridRows: [],
  loading: false,
};

function switchMode(mode) {
  const isSingle = mode === "single";
  el("tabSingle").classList.toggle("active", isSingle);
  el("tabGrid").classList.toggle("active", !isSingle);
  el("singleMode").classList.toggle("hidden", !isSingle);
  el("gridMode").classList.toggle("hidden", isSingle);
  if (!isSingle) {
    loadAnimalSidebar();
  }
}

el("tabSingle").addEventListener("click", () => switchMode("single"));
el("tabGrid").addEventListener("click", () => switchMode("grid"));

async function loadAnimalSidebar() {
  try {
    const payload = await api("/api/animals");
    updateSummary(payload);
    renderAnimalSidebar(payload.gridAnimals);
    if (payload.gridAnimals.length > 0 && !gridState.currentAnimal) {
      gridState.currentAnimal = payload.gridAnimals[0].name;
      highlightSidebarItem(gridState.currentAnimal);
      await loadGrid(gridState.currentAnimal, 0);
    } else if (gridState.currentAnimal) {
      highlightSidebarItem(gridState.currentAnimal);
      await loadGrid(gridState.currentAnimal, gridState.currentPage);
    }
  } catch (error) {
    showError(el("gridError"), error.message);
  }
}

function renderAnimalSidebar(animals) {
  const sidebar = el("animalSidebar");
  sidebar.replaceChildren();
  animals.forEach((animal) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "animal-sidebar-item";
    button.dataset.animal = animal.name;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = animal.name;

    const countSpan = document.createElement("span");
    countSpan.className = "animal-count";
    countSpan.innerHTML = `<span class="done">${animal.reviewed}</span>/${animal.total}`;

    button.append(nameSpan, countSpan);
    button.addEventListener("click", () => {
      gridState.currentAnimal = animal.name;
      gridState.checkedIndices.clear();
      highlightSidebarItem(animal.name);
      loadGrid(animal.name, 0);
    });
    sidebar.append(button);
  });
}

function highlightSidebarItem(animalName) {
  document.querySelectorAll(".animal-sidebar-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.animal === animalName);
  });
}

el("gridRows").addEventListener("change", () => {
  el("imageGrid").style.setProperty('--grid-rows', el("gridRows").value);
  if (gridState.currentAnimal) loadGrid(gridState.currentAnimal, 0);
});
el("gridCols").addEventListener("change", () => {
  el("imageGrid").style.setProperty('--grid-cols', el("gridCols").value);
  if (gridState.currentAnimal) loadGrid(gridState.currentAnimal, 0);
});
el("backToGridButton").addEventListener("click", () => {
  switchMode("grid");
  if (gridState.currentAnimal) loadGrid(gridState.currentAnimal, gridState.currentPage);
  el("backToGridButton").classList.add("hidden");
});

async function loadGrid(animalName, page) {
  if (gridState.loading) return;
  gridState.loading = true;
  showError(el("gridError"), "");
  try {
    const perPage = parseInt(el("gridRows").value) * parseInt(el("gridCols").value);
    const payload = await api(`/api/grid/${encodeURIComponent(animalName)}?page=${page}&per_page=${perPage}`);
    updateSummary(payload);
    gridState.currentAnimal = payload.animal;
    gridState.currentPage = payload.page;
    gridState.totalPages = payload.totalPages;
    gridState.gridRows = payload.rows;
    gridState.checkedIndices.clear();

    el("gridInfo").textContent = `${payload.animal} の画像（${payload.totalImages}枚）`;
    renderImageGrid(payload.rows);
    renderPagination(payload.page, payload.totalPages);
  } catch (error) {
    showError(el("gridError"), error.message);
  } finally {
    gridState.loading = false;
  }
}

function renderImageGrid(rows) {
  const container = el("imageGrid");
  container.replaceChildren();

  rows.forEach((row) => {
    const card = document.createElement("div");
    const isReviewed = row.status === "reviewed";
    const isHold = row.status === "hold";
    card.className = `grid-card${isReviewed ? " already-reviewed" : ""}${isHold ? " on-hold" : ""}`;
    card.dataset.index = row.index;

    // Image
    if (row.imageExists) {
      const img = document.createElement("img");
      img.className = "grid-card-image";
      img.alt = row.filename;
      img.src = `/api/image/${row.index}`;
      img.loading = "lazy";
      card.append(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "grid-card-noimage";
      placeholder.textContent = "画像なし";
      card.append(placeholder);
    }

    // Check overlay
    const overlay = document.createElement("div");
    overlay.className = "grid-card-overlay";
    const checkCircle = document.createElement("div");
    checkCircle.className = "grid-card-check";
    checkCircle.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    overlay.append(checkCircle);
    card.append(overlay);

    // Checkbox (top-left)
    const checkbox = document.createElement("div");
    checkbox.className = "grid-card-checkbox";
    checkbox.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    card.append(checkbox);

    // Badge
    if (isReviewed) {
      const badge = document.createElement("span");
      badge.className = "grid-card-badge reviewed-badge";
      badge.textContent = "確認済み";
      card.append(badge);
    } else if (isHold) {
      const badge = document.createElement("span");
      badge.className = "grid-card-badge hold-badge";
      badge.textContent = "保留";
      card.append(badge);
    }

    // Info bar
    const info = document.createElement("div");
    info.className = "grid-card-info";
    const animalSpan = document.createElement("span");
    animalSpan.className = "grid-card-animal";
    animalSpan.textContent = row.predictedAnimal || "（空欄）";
    animalSpan.title = row.predictedAnimal || "（空欄）";
    const countSpan = document.createElement("span");
    countSpan.className = "grid-card-count";
    countSpan.textContent = `数: ${row.predictedCount ?? "?"}`;
    info.append(animalSpan, countSpan);
    card.append(info);

    // Single click = toggle check
    card.addEventListener("click", (e) => {
      if (gridState.isDragging) return; // Ignore clicks if dragging
      if (e.detail >= 2) return; // Ignore double-click
      toggleCardCheck(card, row.index);
    });

    // Double click = zoom
    card.addEventListener("dblclick", () => {
      switchMode("single");
      el("backToGridButton").classList.remove("hidden");
      moveTo(row.index);
    });

    container.append(card);
  });
}

function toggleCardCheck(card, index) {
  if (gridState.checkedIndices.has(index)) {
    gridState.checkedIndices.delete(index);
    card.classList.remove("checked");
  } else {
    gridState.checkedIndices.add(index);
    card.classList.add("checked");
  }
  updateBulkButtonLabel();
}

function updateBulkButtonLabel() {
  const count = gridState.checkedIndices.size;
  el("bulkConfirmButton").textContent = count > 0
    ? `チェック済みを一括保存（${count}件）`
    : "チェック済みを一括保存";
}

function renderPagination(currentPage, totalPages) {
  const container = el("gridPagination");
  container.replaceChildren();
  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "page-btn";
  prevBtn.textContent = "← 前";
  prevBtn.disabled = currentPage === 0;
  prevBtn.addEventListener("click", () => loadGrid(gridState.currentAnimal, currentPage - 1));
  container.append(prevBtn);

  const infoSpan = document.createElement("span");
  infoSpan.className = "page-info";
  infoSpan.textContent = `${currentPage + 1} / ${totalPages}`;
  container.append(infoSpan);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "page-btn";
  nextBtn.textContent = "次 →";
  nextBtn.disabled = currentPage >= totalPages - 1;
  nextBtn.addEventListener("click", () => loadGrid(gridState.currentAnimal, currentPage + 1));
  container.append(nextBtn);
}

// Select all / Deselect all
el("selectAllButton").addEventListener("click", () => {
  document.querySelectorAll(".grid-card").forEach((card) => {
    const index = parseInt(card.dataset.index);
    if (!gridState.checkedIndices.has(index)) {
      gridState.checkedIndices.add(index);
      card.classList.add("checked");
    }
  });
  updateBulkButtonLabel();
});

el("deselectAllButton").addEventListener("click", () => {
  gridState.checkedIndices.clear();
  document.querySelectorAll(".grid-card").forEach((card) => {
    card.classList.remove("checked");
  });
  updateBulkButtonLabel();
});

// Bulk confirm
el("bulkConfirmButton").addEventListener("click", async () => {
  if (gridState.checkedIndices.size === 0) {
    showError(el("gridError"), "確認する画像を選択してください。");
    return;
  }
  showError(el("gridError"), "");
  el("gridStatus").textContent = "保存中…";

  const bodyData = { indices: [...gridState.checkedIndices] };
  const bulkAnimal = el("bulkAnimalSelect").value;
  const bulkCount = el("bulkCountInput").value;
  
  if (bulkAnimal !== "") {
    bodyData.animal = bulkAnimal;
    bodyData.count = bulkCount;
  }

  try {
    const payload = await api("/api/confirm", {
      method: "POST",
      body: JSON.stringify(bodyData),
    });
    updateSummary(payload);
    el("gridStatus").textContent = `${payload.confirmed}件をExcelへ保存しました。`;
    gridState.checkedIndices.clear();
    await loadAnimalSidebar();
  } catch (error) {
    el("gridStatus").textContent = "";
    showError(el("gridError"), error.message);
  }
});

el("bulkHoldButton").addEventListener("click", async () => {
  if (gridState.checkedIndices.size === 0) {
    showError(el("gridError"), "保留にする画像を選択してください。");
    return;
  }
  showError(el("gridError"), "");
  el("gridStatus").textContent = "保存中…";

  try {
    const payload = await api("/api/hold", {
      method: "POST",
      body: JSON.stringify({ indices: [...gridState.checkedIndices] }),
    });
    updateSummary(payload);
    el("gridStatus").textContent = `${payload.confirmed}件を保留にしました。`;
    gridState.checkedIndices.clear();
    await loadAnimalSidebar();
  } catch (error) {
    el("gridStatus").textContent = "";
    showError(el("gridError"), error.message);
  }
});

// Drag to select
gridState.selectionBox = null;
gridState.dragStartX = 0;
gridState.dragStartY = 0;
gridState.isSelecting = false;
gridState.isDragging = false;
gridState.initialCheckedState = new Map();

el("imageGrid").addEventListener("pointerdown", (e) => {
  if (e.target.closest(".grid-card-checkbox") || e.button !== 0) return;

  gridState.isSelecting = true;
  gridState.isDragging = false;
  gridState.dragStartX = e.pageX;
  gridState.dragStartY = e.pageY;
  
  gridState.initialCheckedState.clear();
  document.querySelectorAll(".grid-card").forEach(card => {
    gridState.initialCheckedState.set(parseInt(card.dataset.index), gridState.checkedIndices.has(parseInt(card.dataset.index)));
  });
  
  if (!gridState.selectionBox) {
    gridState.selectionBox = document.createElement("div");
    gridState.selectionBox.className = "selection-box";
    document.body.appendChild(gridState.selectionBox);
  }
  
  gridState.selectionBox.style.left = `${gridState.dragStartX}px`;
  gridState.selectionBox.style.top = `${gridState.dragStartY}px`;
  gridState.selectionBox.style.width = "0px";
  gridState.selectionBox.style.height = "0px";
  gridState.selectionBox.classList.remove("hidden");
  
  e.preventDefault();
});

document.addEventListener("pointermove", (e) => {
  if (!gridState.isSelecting || !gridState.selectionBox) return;

  if (Math.abs(e.pageX - gridState.dragStartX) > 4 || Math.abs(e.pageY - gridState.dragStartY) > 4) {
    gridState.isDragging = true;
  }
  if (!gridState.isDragging) return;

  const currentX = e.pageX;
  const currentY = e.pageY;
  
  const left = Math.min(gridState.dragStartX, currentX);
  const top = Math.min(gridState.dragStartY, currentY);
  const width = Math.abs(currentX - gridState.dragStartX);
  const height = Math.abs(currentY - gridState.dragStartY);
  
  gridState.selectionBox.style.left = `${left}px`;
  gridState.selectionBox.style.top = `${top}px`;
  gridState.selectionBox.style.width = `${width}px`;
  gridState.selectionBox.style.height = `${height}px`;

  const boxRect = gridState.selectionBox.getBoundingClientRect();
  
  document.querySelectorAll(".grid-card").forEach((card) => {
    const cardRect = card.getBoundingClientRect();
    const isIntersecting = !(
      boxRect.right < cardRect.left ||
      boxRect.left > cardRect.right ||
      boxRect.bottom < cardRect.top ||
      boxRect.top > cardRect.bottom
    );
    
    const index = parseInt(card.dataset.index);
    const initialState = gridState.initialCheckedState.get(index) || false;
    
    if (isIntersecting) {
      card.classList.add("selecting");
      card.classList.toggle("checked", !initialState);
    } else {
      card.classList.remove("selecting");
      card.classList.toggle("checked", initialState);
    }
  });
});

document.addEventListener("pointerup", () => {
  if (gridState.isSelecting) {
    gridState.isSelecting = false;
    if (gridState.selectionBox) gridState.selectionBox.classList.add("hidden");
    
    // Apply checked state to all cards
    gridState.checkedIndices.clear();
    document.querySelectorAll(".grid-card").forEach(card => {
      if (card.classList.contains("checked")) {
        gridState.checkedIndices.add(parseInt(card.dataset.index));
      }
      card.classList.remove("selecting");
    });
    
    updateBulkButtonLabel();
    setTimeout(() => { gridState.isDragging = false; }, 0);
  }
});

