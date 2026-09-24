// ============================================================
// 卡车装载规划器 - 主应用
// 整合3D渲染、算法、UI交互
// ============================================================

const App = (function() {
  'use strict';

  // ---------- 状态 ----------
  const state = {
    truckKey: 'smallVan',
    truck: { ...truckTemplates.smallVan },
    pallets: [],
    selectedId: null,
    initialPlacementSnapshot: null,
    dragState: {
      active: false,
      palletId: null,
      startX: 0,
      startZ: 0,
      offsetX: 0,
      offsetZ: 0,
      startMouseX: 0,
      startMouseY: 0,
      vertical: false,
      startY: 0,
      startMouseScreenY: 0,
      lastValidX: 0,
      lastValidZ: 0,
      startPlacement: null
    },
    undoStack: [],
    redoStack: []
  };

  // ---------- DOM 元素 ----------
  let els = {};
  let nextBatchNumber = 2;
  let activeBatchCard = null;
  let focusSelectedCargoInList = false;
  const collapsedCargoBatches = new Set();

  // ---------- 初始化 ----------

  function init() {
    cacheElements();

    // 初始化3D渲染（必须在车辆选择器之前）
    const canvasContainer = document.getElementById('canvas3d');
    Renderer.init(canvasContainer);

    setupTruckSelector();
    setupCargoPresets();
    setupEventListeners();
    setupContextMenu();
    setupKeyboardShortcuts();

    // 更新UI
    updateAll();

    // 窗口大小调整
    window.addEventListener('resize', () => {
      Renderer.onWindowResize();
    });
  }

  function cacheElements() {
    els = {
      // 车辆
      modeTransport: document.getElementById('modeTransport'),
      truckTemplate: document.getElementById('truckTemplate'),
      truckLength: document.getElementById('truckLength'),
      truckWidth: document.getElementById('truckWidth'),
      truckHeight: document.getElementById('truckHeight'),
      truckMaxWeight: document.getElementById('truckMaxWeight'),

      // 货物
      cargoPreset: document.getElementById('cargoPreset'),
      cargoLength: document.getElementById('cargoLength'),
      cargoWidth: document.getElementById('cargoWidth'),
      cargoHeight: document.getElementById('cargoHeight'),
      cargoWeight: document.getElementById('cargoWeight'),
      cargoQty: document.getElementById('cargoQty'),
      cargoColor: document.getElementById('cargoColor'),
      cargoStackable: document.getElementById('cargoStackable'),
      addCargoBtn: document.getElementById('addCargoBtn'),
      addCargoBatchBtn: document.getElementById('addCargoBatchBtn'),
      clearAllDataBtn: document.getElementById('clearAllDataBtn'),
      cargoBatchContainer: document.getElementById('cargoBatchContainer'),

      // 批量导入
      bulkInput: document.getElementById('bulkInput'),
      bulkImportBtn: document.getElementById('bulkImportBtn'),
      fileUploadBtn: document.getElementById('fileUploadBtn'),
      cargoFileInput: document.getElementById('cargoFileInput'),
      fileHint: document.getElementById('fileHint'),
      downloadTemplateBtn: document.getElementById('downloadTemplateBtn'),

      // 操作按钮
      optimizeBtn: document.getElementById('optimizeBtn'),
      clearBtn: document.getElementById('clearBtn'),
      undoBtn: document.getElementById('undoBtn'),
      redoBtn: document.getElementById('redoBtn'),
      exportBtn: document.getElementById('exportBtn'),
      mobileConfigBtn: document.getElementById('mobileConfigBtn'),
      mobileStatsBtn: document.getElementById('mobileStatsBtn'),
      mobileConfigPanel: document.getElementById('mobileConfigPanel'),
      mobileStatsPanel: document.getElementById('mobileStatsPanel'),
      mobilePanelBackdrop: document.getElementById('mobilePanelBackdrop'),

      // 视图
      viewFit: document.getElementById('viewFit'),

      // HUD
      hudTruckName: document.getElementById('hudTruckName'),
      hudCargoCount: document.getElementById('hudCargoCount'),
      hudLdm: document.getElementById('hudLdm'),
      hudWeight: document.getElementById('hudWeight'),
      hudVolume: document.getElementById('hudVolume'),

      // 装载进度条（已移到中间面板，此处保留兼容引用）
      barLdm: document.getElementById('barLdm') || {},
      barLdmPercent: document.getElementById('barLdmPercent') || {},
      barFloor: document.getElementById('barFloor') || {},
      barFloorPercent: document.getElementById('barFloorPercent') || {},
      barWeight: document.getElementById('barWeight') || {},
      barWeightPercent: document.getElementById('barWeightPercent') || {},
      barVolume: document.getElementById('barVolume') || {},
      barVolumePercent: document.getElementById('barVolumePercent') || {},

      // 右侧装载米面板
      ldmUsedText: document.getElementById('ldmUsedText'),
      ldmRemainingText: document.getElementById('ldmRemainingText'),
      ldmBarLength: document.getElementById('ldmBarLength'),
      ldmBarLengthPercent: document.getElementById('ldmBarLengthPercent'),
      ldmBarFloor: document.getElementById('ldmBarFloor'),
      ldmBarFloorPercent: document.getElementById('ldmBarFloorPercent'),
      ldmBarWeight: document.getElementById('ldmBarWeight'),
      ldmBarWeightPercent: document.getElementById('ldmBarWeightPercent'),
      ldmBarVolume: document.getElementById('ldmBarVolume'),
      ldmBarVolumePercent: document.getElementById('ldmBarVolumePercent'),

      // 右侧装载计量表
      ldmMeterValue: document.getElementById('ldmMeterValue'),
      ldmMeterBar: document.getElementById('ldmMeterBar'),

      // 评分
      scoreValue: document.getElementById('scoreValue'),
      scoreSpace: document.getElementById('scoreSpace'),
      scoreBalance: document.getElementById('scoreBalance'),
      scoreDelivery: document.getElementById('scoreDelivery'),
      scoreStacking: document.getElementById('scoreStacking'),

      // 状态
      optimizerStatus: document.getElementById('optimizerStatus'),
      warningList: document.getElementById('warningList'),
      cargoList: document.getElementById('cargoList'),
      overflowStatus: document.getElementById('overflowStatus')
    };
  }

  function setupTruckSelector() {
    const allTrucks = Object.entries(truckTemplates);

    els.truckTemplate.innerHTML = allTrucks.map(([key, t]) =>
      `<option value="${key}">${t.icon} ${t.name} — ${(t.length*100).toFixed(0)}×${(t.width*100).toFixed(0)}×${(t.height*100).toFixed(0)}cm / ${t.weightLabel || `${t.maxWeight}kg`}</option>`
    ).join('');

    els.truckTemplate.value = 'smallVan';
    selectTruck('smallVan');

    els.truckTemplate.addEventListener('change', () => selectTruck(els.truckTemplate.value));
  }

  function setupCargoPresets() {
    els.cargoPreset.innerHTML = Object.entries(cargoPresets).map(([key, p]) =>
      `<option value="${key}">${p.label} — ${(p.length*100).toFixed(0)}×${(p.width*100).toFixed(0)}×${(p.height*100).toFixed(0)}cm / ${p.weight}kg</option>`
    ).join('');

    activeBatchCard = els.cargoBatchContainer.querySelector('.cargo-batch-card');
    activeBatchCard.dataset.batchId = makeUuid();
    els.cargoPreset.addEventListener('change', () => {
      const preset = cargoPresets[els.cargoPreset.value];
      if (preset) fillCargoForm(preset);
    });
  }

  function batchField(card, field) {
    return card ? card.querySelector(`[data-field="${field}"]`) : null;
  }

  function setActiveBatch(card) {
    if (!card) return;
    els.cargoBatchContainer.querySelectorAll('.cargo-batch-card').forEach(item => {
      item.classList.toggle('active', item === card);
    });
    activeBatchCard = card;
  }

  function fillCargoForm(preset, card = activeBatchCard) {
    if (!card) return;
    batchField(card, 'length').value = preset.length * 100;
    batchField(card, 'width').value = preset.width * 100;
    batchField(card, 'height').value = preset.height * 100;
    batchField(card, 'weight').value = preset.weight;
    batchField(card, 'color').value = preset.color;
    batchField(card, 'stackable').checked = false;
  }

  const batchColorPalette = [
    '#2f80ed', '#f2994a', '#9b51e0', '#eb5757', '#27ae60', '#f2c94c',
    '#56ccf2', '#bb6bd9', '#6fcf97', '#ff7a59', '#4c6ef5', '#d97706',
    '#0ea5a4', '#e11d48', '#7c3aed', '#65a30d', '#0284c7', '#c2410c'
  ];

  function hslToHex(h, s = 68, l = 52) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return '#' + rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  function nextUnusedBatchColor() {
    const used = new Set([...els.cargoBatchContainer.querySelectorAll('[data-field="color"]')]
      .map(input => input.value.toLowerCase()));
    const paletteColor = batchColorPalette.find(color => !used.has(color));
    if (paletteColor) return paletteColor;

    let attempt = els.cargoBatchContainer.querySelectorAll('.cargo-batch-card').length;
    while (attempt < 100000) {
      const color = hslToHex((attempt * 137.508) % 360).toLowerCase();
      if (!used.has(color)) return color;
      attempt++;
    }
    return '#ffffff';
  }

  function createCargoBatchCard() {
    const batchNumber = nextBatchNumber++;
    const preset = cargoPresets[els.cargoPreset.value] || cargoPresets.custom;
    const card = document.createElement('div');
    card.className = 'cargo-batch-card';
    card.dataset.batchNumber = String(batchNumber);
    card.dataset.batchId = makeUuid();
    card.innerHTML = `
      <div class="cargo-batch-title">
        <div class="batch-title-name-row">
          <span class="batch-title-name" data-role="batch-name">批次${batchNumber}</span><span>参数</span>
          <button type="button" class="batch-title-edit" title="编辑批次名称" aria-label="编辑批次${batchNumber}名称">✎</button>
        </div>
        <button type="button" class="batch-remove-btn" title="删除此批次" aria-label="删除批次${batchNumber}">×</button>
      </div>
      <div class="form-row-3">
        <div class="form-group"><label class="form-label">长 (cm)</label><input type="number" class="form-control" data-field="length" step="1" min="1"></div>
        <div class="form-group"><label class="form-label">宽 (cm)</label><input type="number" class="form-control" data-field="width" step="1" min="1"></div>
        <div class="form-group"><label class="form-label">高 (cm)</label><input type="number" class="form-control" data-field="height" step="1" min="1"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">重量 (kg)</label><input type="number" class="form-control" data-field="weight" step="1" min="0"></div>
        <div class="form-group"><label class="form-label">数量</label><input type="number" class="form-control" data-field="qty" step="1" min="1"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">颜色</label><input type="color" class="color-input" data-field="color"></div>
        <div class="form-group batch-stackable-group"><label class="checkbox-item"><input type="checkbox" data-field="stackable">可堆叠</label></div>
      </div>`;
    els.cargoBatchContainer.appendChild(card);
    fillCargoForm(preset, card);
    batchField(card, 'length').value = '';
    batchField(card, 'width').value = '';
    batchField(card, 'height').value = '';
    batchField(card, 'qty').value = '';
    batchField(card, 'stackable').checked = false;
    batchField(card, 'color').value = nextUnusedBatchColor();
    setActiveBatch(card);
    updateBatchRemoveButtons();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateBatchRemoveButtons() {
    const cards = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')];
    cards.forEach(card => {
      const remove = card.querySelector('.batch-remove-btn');
      remove.hidden = cards.length === 1;
    });
  }

  function setupEventListeners() {
    // 添加货物
    els.addCargoBtn.addEventListener('click', addCargoFromForm);
    els.addCargoBatchBtn.addEventListener('click', createCargoBatchCard);
    els.clearAllDataBtn.addEventListener('click', clearAllData);
    els.cargoBatchContainer.addEventListener('pointerdown', (event) => {
      const card = event.target.closest('.cargo-batch-card');
      if (card) setActiveBatch(card);
    });
    els.cargoBatchContainer.addEventListener('focusin', (event) => {
      const card = event.target.closest('.cargo-batch-card');
      if (card) setActiveBatch(card);
    });
    els.cargoBatchContainer.addEventListener('click', (event) => {
      const card = event.target.closest('.cargo-batch-card');
      if (!card) return;
      if (event.target.closest('.batch-title-edit')) {
        const nameText = card.querySelector('[data-role="batch-name"]');
        nameText.contentEditable = 'true';
        nameText.classList.add('editing');
        nameText.focus();
        const selection = window.getSelection();
        selection.selectAllChildren(nameText);
      }
      if (event.target.closest('.batch-remove-btn')) {
        const wasActive = activeBatchCard === card;
        card.remove();
        const remaining = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')];
        if (wasActive) setActiveBatch(remaining[remaining.length - 1]);
        updateBatchRemoveButtons();
      }
    });
    els.cargoBatchContainer.addEventListener('focusout', (event) => {
      if (event.target.classList.contains('batch-title-name')) {
        const card = event.target.closest('.cargo-batch-card');
        event.target.textContent = event.target.textContent.trim() || `批次${card.dataset.batchNumber}`;
        event.target.contentEditable = 'false';
        event.target.classList.remove('editing');
      }
    });
    els.cargoBatchContainer.addEventListener('keydown', (event) => {
      if (event.target.classList.contains('batch-title-name') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    // 批量导入
    els.bulkImportBtn.addEventListener('click', bulkImportCargo);

    // 文件导入
    els.fileUploadBtn.addEventListener('click', function() { els.cargoFileInput.click(); });
    els.cargoFileInput.addEventListener('change', handleFileImport);
    els.downloadTemplateBtn.addEventListener('click', downloadImportTemplate);

    // 优化
    els.optimizeBtn.addEventListener('click', runOptimization);

    // 清空
    els.clearBtn.addEventListener('click', clearAllCargo);

    // 撤销重做
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', resetToInitialPlacement);

    // 导出
    els.exportBtn.addEventListener('click', exportScreenshot);

    // 窄屏侧栏
    els.mobileConfigBtn.addEventListener('click', () => toggleMobilePanel('config'));
    els.mobileStatsBtn.addEventListener('click', () => toggleMobilePanel('stats'));
    els.mobilePanelBackdrop.addEventListener('click', closeMobilePanels);

    // 自定义尺寸
    [els.truckLength, els.truckWidth, els.truckHeight, els.truckMaxWeight].forEach(el => {
      el.addEventListener('change', updateCustomTruck);
    });

    // 视图按钮
    document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Renderer.setView(btn.dataset.view);
      });
    });

    // 3D画布交互 - 使用 Pointer Events 绑定到 renderer.domElement（与原站一致）
    const canvas = Renderer.getCanvas();
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDoubleClick);
  }

  function toggleMobilePanel(panel) {
    const configOpen = panel === 'config' && !els.mobileConfigPanel.classList.contains('mobile-open');
    const statsOpen = panel === 'stats' && !els.mobileStatsPanel.classList.contains('mobile-open');
    els.mobileConfigPanel.classList.toggle('mobile-open', configOpen);
    els.mobileStatsPanel.classList.toggle('mobile-open', statsOpen);
    els.mobileConfigBtn.setAttribute('aria-expanded', String(configOpen));
    els.mobileStatsBtn.setAttribute('aria-expanded', String(statsOpen));
    els.mobilePanelBackdrop.classList.toggle('visible', configOpen || statsOpen);
  }

  function closeMobilePanels() {
    els.mobileConfigPanel.classList.remove('mobile-open');
    els.mobileStatsPanel.classList.remove('mobile-open');
    els.mobileConfigBtn.setAttribute('aria-expanded', 'false');
    els.mobileStatsBtn.setAttribute('aria-expanded', 'false');
    els.mobilePanelBackdrop.classList.remove('visible');
  }

  function setupContextMenu() {
    const menu = document.getElementById('contextMenu');

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        menu.style.display = 'none';
      }
    });

    // 旋转
    document.getElementById('ctxRotate').addEventListener('click', () => {
      if (state.selectedId) {
        saveUndoState();
        rotatePallet(state.selectedId);
        updateAll();
      }
      menu.style.display = 'none';
    });

    // 删除
    document.getElementById('ctxDelete').addEventListener('click', () => {
      if (state.selectedId) {
        saveUndoState();
        deletePallet(state.selectedId);
        state.selectedId = null;
        Renderer.clearSelection();
        updateAll();
      }
      menu.style.display = 'none';
    });

    // 复制
    document.getElementById('ctxDuplicate').addEventListener('click', () => {
      if (state.selectedId) {
        saveUndoState();
        duplicatePallet(state.selectedId);
        updateAll();
      }
      menu.style.display = 'none';
    });

    // 放到底层
    document.getElementById('ctxToFloor').addEventListener('click', () => {
      if (state.selectedId) {
        saveUndoState();
        const pallet = state.pallets.find(p => p.id === state.selectedId);
        if (pallet) {
          pallet.freeHeight = false;
          pallet.baseY = 0;
          const existing = state.pallets.filter(p => p.id !== pallet.id);
          const spot = Optimizer.findFrontFloorSpot(pallet, existing, state.truck) ||
                       Optimizer.outsideTrailerSpot(pallet, existing, state.truck);
          Optimizer.applyPlacement(pallet, spot);
        }
        updateAll();
      }
      menu.style.display = 'none';
    });

    // 放到顶层
    document.getElementById('ctxToTop').addEventListener('click', () => {
      if (state.selectedId) {
        const pallet = state.pallets.find(p => p.id === state.selectedId);
        if (pallet) {
          const existing = state.pallets.filter(p => p.id !== pallet.id);

          // 全局搜索所有可堆叠物品
          const stackableItems = existing.filter(p =>
            p.stackable && !p.doNotStack && !p.overflow
          );

          if (stackableItems.length === 0) {
            const nonStackableOnly = existing.filter(p => !p.overflow);
            if (nonStackableOnly.length > 0) {
              alert('当前只有不可堆叠物品，无法放置到顶层');
            } else {
              alert('暂无其他货物，无法放置到顶层');
            }
            menu.style.display = 'none';
            return;
          }

          // 检查是否有可堆叠物品上方高度足够
          const hasHeightOk = stackableItems.some(p => {
            const topY = (p.baseY || 0) + p.height;
            return topY + pallet.height <= state.truck.height + 0.001;
          });

          if (!hasHeightOk) {
            alert('可堆叠物品上方高度不足，无法放置当前物品');
            menu.style.display = 'none';
            return;
          }

          // 使用 findFrontStackSpot 全局搜索最佳堆叠位置
          const spot = Optimizer.findFrontStackSpot(pallet, existing, state.truck);
          if (spot) {
            saveUndoState();
            pallet.freeHeight = false;
            // 统一应用候选位置。rotation=0 是合法方向，不能用 || 回退，
            // 否则候选按 0° 验证、实际却保留 90°，会改变占地并造成重叠。
            Optimizer.applyPlacement(pallet, spot);
            Optimizer.clampPallet(pallet, state.truck);
            Optimizer.sinkPalletToSupport(pallet, state.pallets);

            // 放置后的最终兜底：若后续吸附或边界修正改变了位置，重新消解碰撞。
            Optimizer.resolvePalletOverlap(pallet, state.pallets, state.truck);
            Optimizer.sinkPalletToSupport(pallet, state.pallets);
            updateAll();
          } else {
            alert('未找到合适的堆叠位置（可能空间被占用）');
          }
        }
      }
      menu.style.display = 'none';
    });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 如果在输入框中，不处理
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (state.selectedId) {
            e.preventDefault();
            saveUndoState();
            deletePallet(state.selectedId);
            state.selectedId = null;
            Renderer.clearSelection();
            updateAll();
          }
          break;
        case 'r':
        case 'R':
        case ' ':
          if (state.selectedId) {
            e.preventDefault();
            saveUndoState();
            rotatePallet(state.selectedId);
            updateAll();
          }
          break;
        case 'z':
        case 'Z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case 'y':
        case 'Y':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            redo();
          }
          break;
        case 'ArrowUp':
          nudgeSelected(0, -0.05);
          break;
        case 'ArrowDown':
          nudgeSelected(0, 0.05);
          break;
        case 'ArrowLeft':
          nudgeSelected(-0.05, 0);
          break;
        case 'ArrowRight':
          nudgeSelected(0.05, 0);
          break;
      }
    });
  }

  // ---------- 车辆操作 ----------

  function selectTruck(key) {
    state.truckKey = key;
    state.truck = { ...truckTemplates[key] };

    // 更新尺寸显示（内部m，界面cm）
    els.truckLength.value = Math.round(state.truck.length * 100);
    els.truckWidth.value = Math.round(state.truck.width * 100);
    els.truckHeight.value = Math.round(state.truck.height * 100);
    els.truckMaxWeight.value = state.truck.maxWeight;

    // 车型变化后必须重新规划，逐件 clamp 会把货物挤到同一坐标并制造重叠
    Renderer.renderTruck(state.truck);
    repackForCurrentTruck('车型已切换');
    updateAll();
  }

  function updateCustomTruck() {
    const lengthCm = parseFloat(els.truckLength.value);
    const widthCm = parseFloat(els.truckWidth.value);
    const heightCm = parseFloat(els.truckHeight.value);
    const maxWeight = parseFloat(els.truckMaxWeight.value);
    if (![lengthCm, widthCm, heightCm, maxWeight].every(Number.isFinite) ||
        lengthCm <= 0 || widthCm <= 0 || heightCm <= 0 || maxWeight < 0) {
      showInputError('车厢长、宽、高必须大于 0，限重不得小于 0');
      els.truckLength.value = Math.round(state.truck.length * 100);
      els.truckWidth.value = Math.round(state.truck.width * 100);
      els.truckHeight.value = Math.round(state.truck.height * 100);
      els.truckMaxWeight.value = state.truck.maxWeight;
      return;
    }

    state.truck.length = lengthCm / 100;
    state.truck.width = widthCm / 100;
    state.truck.height = heightCm / 100;
    state.truck.maxWeight = maxWeight;

    Renderer.renderTruck(state.truck);
    repackForCurrentTruck('车厢尺寸已更新');
    updateAll();
  }

  function repackForCurrentTruck(messagePrefix) {
    if (!state.pallets.length) return;
    const result = Optimizer.optimize(state.pallets, state.truck);
    state.pallets = result.pallets;
    captureInitialPlacement();
    const unplaced = state.pallets.filter(p => p.overflow).length;
    const loaded = state.pallets.length - unplaced;
    els.optimizerStatus.textContent = unplaced
      ? `⚠️ ${messagePrefix}：车厢已装 ${loaded} 件，剩余 ${unplaced} 件摆放车外${result.status === 'NOT_FIT' ? '无法装入' : '暂未找到合法位置'}`
      : `✅ ${messagePrefix}：全部货物已重新规划`;
  }

  // ---------- 货物操作 ----------

  function validateCargoValues(length, width, height, weight, qty) {
    if (![length, width, height, weight, qty].every(Number.isFinite)) {
      return '请填写有效的数字';
    }
    if (length <= 0 || width <= 0 || height <= 0) {
      return '货物长、宽、高必须大于 0';
    }
    if (weight < 0) return '货物重量不得小于 0';
    if (!Number.isInteger(qty) || qty < 1) return '货物数量必须是大于 0 的整数';
    return '';
  }

  function showInputError(message) {
    els.optimizerStatus.textContent = `❌ ${message}`;
    els.optimizerStatus.classList.add('working');
    window.setTimeout(() => els.optimizerStatus.classList.remove('working'), 3000);
  }

  function optimizationStatusText(result, successPrefix) {
    const outside = result.pallets.filter(p => p.overflow).length;
    const loaded = result.pallets.length - outside;
    if (!outside) return `✅ ${successPrefix}：${loaded} 件货物已全部装入`;
    const outsideText = result.status === 'NOT_FIT' ? '无法装入' : '暂未找到合法位置';
    return `⚠️ ${successPrefix}：车厢已装 ${loaded} 件，剩余 ${outside} 件摆放车外${outsideText}`;
  }

  function captureInitialPlacement() {
    state.initialPlacementSnapshot = state.pallets.length
      ? Optimizer.capturePlacementMap(state.pallets)
      : null;
  }

  function resetToInitialPlacement() {
    if (!state.pallets.length || !state.initialPlacementSnapshot) {
      els.optimizerStatus.textContent = '当前没有可恢复的初始摆放位置';
      return;
    }
    saveUndoState();
    Optimizer.restorePlacementMap(state.pallets, state.initialPlacementSnapshot);
    state.selectedId = null;
    Renderer.clearSelection();
    updateAll();
    els.optimizerStatus.textContent = '✅ 已恢复到本轮货物的初始摆放位置';
  }

  function addCargoFromForm() {
    const cards = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')];
    const batchValues = [];
    for (const card of cards) {
      const batchNumber = card.dataset.batchNumber;
      const values = {
        batchNumber,
        name: card.querySelector('[data-role="batch-name"]').textContent.trim() || `批次${batchNumber}`,
        length: parseFloat(batchField(card, 'length').value) / 100,
        width: parseFloat(batchField(card, 'width').value) / 100,
        height: parseFloat(batchField(card, 'height').value) / 100,
        weight: parseFloat(batchField(card, 'weight').value),
        qty: Number(batchField(card, 'qty').value),
        color: batchField(card, 'color').value,
        stackable: batchField(card, 'stackable').checked,
        adr: false,
        loadLast: false,
        fragile: false
      };
      const validationError = validateCargoValues(values.length, values.width, values.height, values.weight, values.qty);
      if (validationError) {
        setActiveBatch(card);
        showInputError(`批次${batchNumber}：${validationError}`);
        return;
      }
      batchValues.push(values);
    }

    const newPallets = [];
    for (const batch of batchValues) {
      const card = cards.find(item => item.dataset.batchNumber === String(batch.batchNumber));
      const batchId = makeUuid();
      if (card) card.dataset.batchId = batchId;
      for (let i = 0; i < batch.qty; i++) {
        newPallets.push({
          id: makeUuid(),
          batchId,
          batchName: batch.name,
          name: batch.name + (batch.qty > 1 ? ` ${i + 1}` : ''),
          length: batch.length, width: batch.width, height: batch.height,
          weight: batch.weight, color: batch.color,
          stackable: batch.stackable, fragile: batch.fragile,
          adr: batch.adr, loadLast: batch.loadLast,
          x: 0, z: 0, baseY: 0,
          rotation: 0,
          overflow: true
        });
      }
    }

    saveUndoState();
    state.selectedId = null;
    Renderer.clearSelection();
    collapsedCargoBatches.clear();
    const result = Optimizer.optimize(newPallets, state.truck);
    state.pallets = result.pallets;
    captureInitialPlacement();

    updateAll();
    els.optimizerStatus.textContent = optimizationStatusText(result, `已添加 ${batchValues.length} 个批次，共 ${newPallets.length} 件货物`);
  }

  // ---------- 文件导入 ----------

  function downloadImportTemplate() {
    const link = document.createElement('a');
    link.href = './批量导入模板.xlsx';
    link.download = '批量导入模板.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    els.fileHint.textContent = '✅ 批量导入模板已保存到浏览器下载文件夹';
  }

  var fileColMap = {
    length: ['length', '长', '长度', 'l', 'len', 'longueur', 'long'],
    width: ['width', '宽', '宽度', 'w', 'wid', 'largeur', 'larg'],
    height: ['height', '高', '高度', 'h', 'hgt', 'ht', 'hauteur'],
    weight: ['weight', '重量', '重', 'wt', 'poids', 'kg'],
    qty: ['qty', 'quantity', '数量', 'count', 'num', 'nombre', 'count'],
    name: ['name', '名称', '货物名称', '包装类型', 'cargo', 'label'],
    stackable: ['stackable', '可堆叠', '堆叠', 'stack', 'B'],
    adr: ['adr', '危险品', 'dangerous', 'danger'],
    loadLast: ['loadlast', '最后装', 'last', 'lastload']
  };

  function findCol(headers, field) {
    var aliases = fileColMap[field] || [];
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].trim().toLowerCase();
      for (var j = 0; j < aliases.length; j++) {
        if (h === aliases[j].toLowerCase()) return i;
      }
    }
    // Fuzzy match: header contains alias
    for (var i2 = 0; i2 < headers.length; i2++) {
      var h2 = headers[i2].trim().toLowerCase();
      for (var j2 = 0; j2 < aliases.length; j2++) {
        if (h2.indexOf(aliases[j2].toLowerCase()) >= 0) return i2;
      }
    }
    return -1;
  }

  function parseImportBoolean(value) {
    return parseImportBooleanValue(value) === true;
  }

  function parseImportBooleanValue(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (value == null || String(value).trim() === '') return null;
    var normalized = String(value).trim().toLowerCase();
    if ([
      '1', 'true', 'yes', 'y', '是', '可堆叠', '可叠', '堆叠',
      'stackable', 'stack', 'b', '√', '对'
    ].indexOf(normalized) >= 0) return true;
    if (['0', 'false', 'no', 'n', '否', '不可堆叠', '不可叠', '×', '错'].indexOf(normalized) >= 0) return false;
    return null;
  }

  function parseFileRows(rows, headers) {
    var colLen = findCol(headers, 'length');
    var colWid = findCol(headers, 'width');
    var colHgt = findCol(headers, 'height');
    var colWt = findCol(headers, 'weight');
    var colQty = findCol(headers, 'qty');
    var colName = findCol(headers, 'name');
    var colStack = findCol(headers, 'stackable');
    var colAdr = findCol(headers, 'adr');
    var colLast = findCol(headers, 'loadLast');

    var requiredColumns = [
      { index: colLen, label: '长' },
      { index: colWid, label: '宽' },
      { index: colHgt, label: '高' },
      { index: colWt, label: '重量' },
      { index: colQty, label: '数量' },
      { index: colStack, label: '可堆叠' }
    ];
    var missingHeaders = requiredColumns.filter(function(col) { return col.index < 0; }).map(function(col) { return col.label; });
    if (missingHeaders.length) {
      throw new Error('模板缺少必填列：' + missingHeaders.join('、'));
    }

    var colors = ['#1f9d72', '#2f80ed', '#9b7bd8', '#d9a22b', '#b86b2b', '#ed8936', '#38a169', '#dd6b20'];
    var newPallets = [];
    var rowErrors = [];
    var batchIdx = 0;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.length === 0 || !row.some(function(value) { return String(value == null ? '' : value).trim() !== ''; })) continue;

      var missingFields = requiredColumns.filter(function(col) {
        return String(row[col.index] == null ? '' : row[col.index]).trim() === '';
      }).map(function(col) { return col.label; });
      if (missingFields.length) {
        rowErrors.push('第' + (r + 2) + '行缺少必填项：' + missingFields.join('、'));
        continue;
      }

      var length = colLen >= 0 ? parseFloat(row[colLen]) : NaN;
      var width = colWid >= 0 ? parseFloat(row[colWid]) : NaN;
      var height = colHgt >= 0 ? parseFloat(row[colHgt]) : NaN;
      var weight = colWt >= 0 ? parseFloat(row[colWt]) : 0;
      var qty = colQty >= 0 ? Number(row[colQty]) : 1;

      // 所有导入入口使用与手工添加一致的输入边界
      if (![length, width, height, weight, qty].every(Number.isFinite)) {
        rowErrors.push('第' + (r + 2) + '行的长、宽、高、重量或数量不是有效数字');
        continue;
      }
      if (length <= 0 || width <= 0 || height <= 0 || weight < 0 || !Number.isInteger(qty) || qty < 1) {
        rowErrors.push('第' + (r + 2) + '行数据无效：长宽高须大于0，重量不能为负数，数量须为正整数');
        continue;
      }

      var stackableValue = parseImportBooleanValue(row[colStack]);
      if (stackableValue === null) {
        rowErrors.push('第' + (r + 2) + '行“可堆叠”必须选择“是”或“否”');
        continue;
      }

      var cargoName = (colName >= 0 && String(row[colName] == null ? '' : row[colName]).trim())
        ? String(row[colName]).trim()
        : ('批次' + (r + 2));
      var color = colors[batchIdx % colors.length];
      var batchId = makeUuid();

      var stackable = stackableValue;
      var adr = false;
      if (colAdr >= 0) {
        var av = String(row[colAdr]).trim().toLowerCase();
        adr = parseImportBoolean(row[colAdr]) || av === '危险品' || av === 'adr';
      }
      var loadLast = false;
      if (colLast >= 0) {
        var lv = String(row[colLast]).trim().toLowerCase();
        loadLast = parseImportBoolean(row[colLast]) || lv === '最后装' || lv === 'last';
      }

      for (var i = 0; i < qty; i++) {
        newPallets.push({
          id: makeUuid(),
          batchId: batchId,
          batchName: cargoName,
          name: cargoName + (qty > 1 ? ' ' + (i + 1) : ''),
          length: length / 100, width: width / 100, height: height / 100,
          weight: weight, color: color,
          stackable: stackable, fragile: false,
          adr: adr, loadLast: loadLast,
          x: 0, z: 0, baseY: 0, rotation: 0, overflow: true
        });
      }
      batchIdx++;
    }
    return { pallets: newPallets, rowErrors: rowErrors };
  }

  function handleFileImport(e) {
    var file = e.target.files[0];
    if (!file) return;

    els.fileHint.textContent = '⏳ 正在解析 ' + file.name + '...';

    var reader = new FileReader();
    var ext = file.name.split('.').pop().toLowerCase();

    reader.onload = function(ev) {
      var data = ev.target.result;
      var rows = [];
      var headers = [];

      try {
        if (ext === 'csv' || ext === 'txt') {
          // Parse CSV
          var text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(new Uint8Array(data));
          var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
          if (lines.length < 2) {
            throw new Error('文件内容太少');
          }
          headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^["']|["']$/g, ''); });
          for (var i = 1; i < lines.length; i++) {
            rows.push(lines[i].split(',').map(function(c) { return c.trim().replace(/^["']|["']$/g, ''); }));
          }
        } else if (typeof XLSX !== 'undefined') {
          // Parse Excel
          var wb = XLSX.read(data, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var jsonRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (jsonRows.length < 2) {
            throw new Error('Excel内容太少');
          }
          headers = jsonRows[0].map(function(h) { return String(h).trim(); });
          for (var j = 1; j < jsonRows.length; j++) {
            rows.push(jsonRows[j]);
          }
        } else {
          throw new Error('无法解析此文件格式，请使用CSV或Excel');
        }

        var parsed = parseFileRows(rows, headers);
        var newPallets = parsed.pallets;
        if (!newPallets.length) {
          if (parsed.rowErrors.length) throw new Error(parsed.rowErrors.join('；'));
          throw new Error('未找到有效数据，请确保列名包含：长、宽、高、重量、数量');
        }

        saveUndoState();
        var allPallets = state.pallets.concat(newPallets);
        var result = Optimizer.optimize(allPallets, state.truck);
        state.pallets = result.pallets;
        captureInitialPlacement();
        updateAll();

        var skippedMessage = parsed.rowErrors.length
          ? '；已跳过 ' + parsed.rowErrors.length + ' 行：' + parsed.rowErrors.join('；')
          : '';
        els.fileHint.textContent = (parsed.rowErrors.length ? '⚠️ ' : '✅ ') + file.name + ' 导入完成，共添加 ' + newPallets.length + ' 件货物' + skippedMessage;
        els.optimizerStatus.textContent = optimizationStatusText(result, `文件导入完成，添加了 ${newPallets.length} 件货物${skippedMessage}`);
        els.optimizerStatus.classList.add('working');
        setTimeout(function() {
          els.optimizerStatus.classList.remove('working');
          els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
        }, 4000);
      } catch (err) {
        els.fileHint.textContent = '❌ ' + err.message;
        els.optimizerStatus.textContent = '❌ 文件导入失败: ' + err.message;
        els.optimizerStatus.classList.add('working');
        setTimeout(function() {
          els.optimizerStatus.classList.remove('working');
          els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
          els.fileHint.textContent = '支持CSV、Excel文件；带 * 的长/宽/高/重量/数量/可堆叠为必填项';
        }, 5000);
      }
      // Reset input so same file can be selected again
      els.cargoFileInput.value = '';
    };

    if (ext === 'csv' || ext === 'txt') {
      reader.readAsText(file, 'utf-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  function bulkImportCargo() {
    const text = els.bulkInput.value.trim();
    if (!text) {
      els.optimizerStatus.textContent = '⚠️ 请先在文本框中输入货物信息';
      els.optimizerStatus.classList.add('working');
      setTimeout(() => {
        els.optimizerStatus.classList.remove('working');
        els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
      }, 3000);
      return;
    }

    saveUndoState();

    const lines = text.split('\n').filter(l => l.trim());
    let added = 0;
    let batchIdx = 0;
    const failedLines = [];
    const newPallets = [];
    const colors = ['#1f9d72', '#2f80ed', '#9b7bd8', '#d9a22b', '#b86b2b', '#ed8936', '#38a169', '#dd6b20'];

    lines.forEach(line => {
      // 格式: 数量x 长x宽x高 重量 可选属性
      // 例如: 10x 120x80x150 450kg B stackable
      const match = line.match(/^(\d+)[x×\s*]\s*([\d.]+)[x×]([\d.]+)[x×]([\d.]+)\s+([\d.]+)\s*(kg|KG)?\s*(.*)$/i);
      if (!match) {
        failedLines.push(line);
        return;
      }

      const qty = parseInt(match[1]);
      const length = parseFloat(match[2]) / 100; // cm to m
      const width = parseFloat(match[3]) / 100;
      const height = parseFloat(match[4]) / 100;
      const weight = parseFloat(match[5]);
      const rest = match[7] || '';

      const validationError = validateCargoValues(length, width, height, weight, qty);
      if (validationError) {
        failedLines.push(`${line}（${validationError}）`);
        return;
      }

      const stackable = /stackable|可堆叠|B/i.test(rest);
      const fragile = false;
      const adr = /adr|危险品/i.test(rest);
      const loadLast = /loadlast|最后装/i.test(rest);
      const nameMatch = rest.match(/(?:name|名称)[:\s]+([^\s,]+)/i);
      const cargoName = nameMatch ? nameMatch[1] : `货物${batchIdx + 1}`;
      const color = colors[batchIdx % colors.length];
      const batchId = makeUuid();

      for (let i = 0; i < qty; i++) {
        newPallets.push({
          id: makeUuid(),
          batchId,
          batchName: cargoName,
          name: cargoName + (qty > 1 ? ` ${i + 1}` : ''),
          length, width, height, weight, color,
          stackable, fragile, adr, loadLast,
          x: 0, z: 0, baseY: 0,
          rotation: 0,
          overflow: true
        });
        added++;
      }
      batchIdx++;
    });

    if (added > 0) {
      // 用极点法一次性装箱，避免逐件放置的 O(n²) 开销
      const allPallets = [...state.pallets, ...newPallets];
      const result = Optimizer.optimize(allPallets, state.truck);
      state.pallets = result.pallets;
      captureInitialPlacement();
      updateAll();
      const importPrefix = failedLines.length
        ? `已添加 ${added} 件，跳过 ${failedLines.length} 行无效数据`
        : `批量导入成功，添加了 ${added} 件货物`;
      els.optimizerStatus.textContent = optimizationStatusText(result, importPrefix);
      els.optimizerStatus.classList.add('working');
      setTimeout(() => {
        els.optimizerStatus.classList.remove('working');
        els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
      }, 4000);
    } else {
      els.optimizerStatus.textContent = `❌ 格式不匹配，无法解析。正确格式: 数量x 长x宽x高 重量 属性（例: 2x 120x80x120 450kg stackable）`;
      els.optimizerStatus.classList.add('working');
      if (failedLines.length) {
        console.warn('解析失败的行:', failedLines);
      }
      setTimeout(() => {
        els.optimizerStatus.classList.remove('working');
        els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
      }, 6000);
    }
  }

  function deletePallet(id) {
    const idx = state.pallets.findIndex(p => p.id === id);
    if (idx >= 0) {
      const [removed] = state.pallets.splice(idx, 1);
      adjustBatchQuantity(removed, -1);
    }
  }

  function batchCardForPallet(pallet) {
    const cards = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')];
    return cards.find(card => card.dataset.batchId === pallet.batchId)
      || cards.find(card => card.querySelector('[data-role="batch-name"]').textContent.trim() === pallet.batchName);
  }

  function adjustBatchQuantity(pallet, delta) {
    const card = batchCardForPallet(pallet);
    if (!card) return;
    const field = batchField(card, 'qty');
    const current = Math.max(0, Number.parseInt(field.value, 10) || 0);
    field.value = String(Math.max(0, current + delta));
  }

  function duplicatePallet(id) {
    const original = state.pallets.find(p => p.id === id);
    if (!original) return;

    const copy = {
      ...original,
      id: makeUuid(),
      name: original.name + ' 副本',
      x: original.x + 0.1,
      z: original.z + 0.1,
      baseY: 0,
      freeHeight: false,
      overflow: false
    };

    // 找最优位置
    const spot = Optimizer.findOptimalLoadSpot(copy, state.pallets, state.truck);
    if (spot) {
      Optimizer.applyPlacement(copy, spot);
    } else {
      const overflowSpot = Optimizer.outsideTrailerSpot(copy, state.pallets, state.truck);
      Optimizer.applyPlacement(copy, overflowSpot);
    }

    state.pallets.push(copy);
    adjustBatchQuantity(copy, 1);
    state.selectedId = copy.id;
  }

  function rotatePallet(id) {
    const pallet = state.pallets.find(p => p.id === id);
    if (!pallet) return;

    pallet.rotation = pallet.rotation === 90 ? 0 : 90;

    // 旋转后检查是否冲突，如果冲突则尝试调整位置
    const existing = state.pallets.filter(p => p.id !== id);
    if (Optimizer.placementConflicts(pallet, existing, state.truck)) {
      const spot = Optimizer.findPracticalLoadSpot(pallet, existing, state.truck);
      if (spot) {
        Optimizer.applyPlacement(pallet, spot);
      }
    }

    Optimizer.clampPallet(pallet, state.truck);
  }

  function nudgeSelected(dx, dz) {
    if (!state.selectedId) return;
    const pallet = state.pallets.find(p => p.id === state.selectedId);
    if (!pallet) return;

    saveUndoState();
    pallet.x += dx;
    pallet.z += dz;
    Optimizer.clampPallet(pallet, state.truck);
    // 检测重叠并自动弹开
    Optimizer.resolvePalletOverlap(pallet, state.pallets, state.truck);
    updateAll();
  }

  function clearAllCargo() {
    if (!state.pallets.length) return;
    if (!confirm('确定要清空所有货物吗？')) return;

    saveUndoState();
    state.pallets.forEach(pallet => adjustBatchQuantity(pallet, -1));
    state.pallets = [];
    state.initialPlacementSnapshot = null;
    collapsedCargoBatches.clear();
    state.selectedId = null;
    Renderer.clearSelection();
    updateAll();
  }

  function clearAllData() {
    if (!confirm('确定清除全部批次参数、已装载货物和导入内容吗？')) return;

    const cards = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')];
    const firstCard = cards[0];
    cards.forEach((card, index) => {
      if (index > 0) card.remove();
    });
    if (firstCard) {
      firstCard.dataset.batchNumber = '1';
      firstCard.dataset.batchId = makeUuid();
      firstCard.querySelector('[data-role="batch-name"]').textContent = '批次1';
      batchField(firstCard, 'qty').value = '';
      fillCargoForm(cargoPresets[els.cargoPreset.value] || cargoPresets.custom, firstCard);
      batchField(firstCard, 'stackable').checked = false;
      setActiveBatch(firstCard);
    }
    nextBatchNumber = 2;
    updateBatchRemoveButtons();

    state.pallets = [];
    state.selectedId = null;
    state.initialPlacementSnapshot = null;
    state.undoStack = [];
    state.redoStack = [];
    collapsedCargoBatches.clear();
    els.bulkInput.value = '';
    els.cargoFileInput.value = '';
    els.fileHint.textContent = '支持CSV、Excel文件，列名包含长/宽/高/重量/数量';
    Renderer.clearSelection();
    updateAll();
    els.optimizerStatus.textContent = '✅ 已清除所有数据';
  }

  // ---------- 优化 ----------

  function runOptimization() {
    if (!state.pallets.length) return;

    saveUndoState();

    els.optimizeBtn.disabled = true;
    els.optimizerStatus.classList.add('working');
    els.optimizerStatus.textContent = '正在优化...';

    // 使用setTimeout让UI先更新
    setTimeout(() => {
      const warnings = Optimizer.validateLoad(state.pallets, state.truck);
      const result = Optimizer.optimize(state.pallets, state.truck, warnings);
      state.pallets = result.pallets;
      captureInitialPlacement();

      els.optimizerStatus.classList.remove('working');
      const unplaced = result.pallets.filter(p => p.overflow).length;
      if (result.status === 'FIT') {
        els.optimizerStatus.textContent =
          `优化完成！得分 ${result.stats.overall}/100（策略：${result.strategyName}）`;
      } else if (result.status === 'NOT_FIT') {
        els.optimizerStatus.textContent = `⚠️ 优化完成：车厢已装 ${result.pallets.length - unplaced} 件，剩余 ${unplaced} 件摆放车外无法装入`;
      } else {
        els.optimizerStatus.textContent = `⚠️ 优化完成：车厢已装 ${result.pallets.length - unplaced} 件，剩余 ${unplaced} 件摆放车外暂未找到合法位置`;
      }

      els.optimizeBtn.disabled = false;
      state.selectedId = null;
      Renderer.clearSelection();
      updateAll();

      // 3秒后清除状态消息
      setTimeout(() => {
        els.optimizerStatus.textContent = '点击"智能优化"自动排列货物';
      }, 5000);
    }, 100);
  }

  // ---------- 指针交互 ----------

  function onPointerDown(e) {
    if (e.button !== 0) return;

    const palletId = Renderer.getCargoAtMouse(e);
    if (!palletId) {
      // 点击空白处取消选择，让 OrbitControls 正常旋转
      if (state.selectedId) {
        state.selectedId = null;
        Renderer.clearSelection();
        updateCargoList();
      }
      return;
    }

    const pallet = state.pallets.find(p => p.id === palletId);
    if (!pallet) return;

    // 选中
    if (state.selectedId !== palletId) {
      if (state.selectedId) Renderer.setSelected(state.selectedId, false);
      state.selectedId = palletId;
      Renderer.setSelected(palletId, true);
      focusSelectedCargoInList = true;
      updateCargoList();
    }

    // 在 pointerdown 时立即计算偏移（与原站一致）
    const isShift = e.shiftKey;

    if (isShift) {
      // Shift+拖拽：垂直模式，记录起始高度和鼠标Y
      state.dragState.vertical = true;
      state.dragState.startY = pallet.baseY || 0;
      state.dragState.startMouseScreenY = e.clientY;
    } else {
      state.dragState.vertical = false;
      const point = Renderer.getDragPoint(e, pallet);
      if (!point) return;
      state.dragState.offsetX = pallet.x - point.x;
      state.dragState.offsetZ = pallet.z - point.z;
    }

    state.dragState.active = true;
    state.dragState.palletId = palletId;
    state.dragState.lastValidX = pallet.x;
    state.dragState.lastValidZ = pallet.z;
    state.dragState.startPlacement = {
      x: pallet.x, z: pallet.z, baseY: pallet.baseY || 0,
      rotation: pallet.rotation || 0, overflow: Boolean(pallet.overflow)
    };

    saveUndoState();

    // 禁用 OrbitControls 并捕获指针，确保拖拽时事件不丢失
    Renderer.getControls().enabled = false;
    try { Renderer.getCanvas().setPointerCapture(e.pointerId); } catch(err) {}
    document.getElementById('canvas3d').style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    if (!state.dragState.active) {
      // 非拖拽时：悬停效果
      const hoverId = Renderer.getCargoAtMouse(e);
      Renderer.setHovered(hoverId);
      document.getElementById('canvas3d').style.cursor = hoverId ? 'grab' : 'default';
      return;
    }

    const pallet = state.pallets.find(p => p.id === state.dragState.palletId);
    if (!pallet) return;

    if (state.dragState.vertical) {
      // 垂直拖拽：鼠标上下移动映射到货物高度变化
      const canvas = Renderer.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const dyPixels = state.dragState.startMouseScreenY - e.clientY;
      const pixelsPerMeter = rect.height / state.truck.height;
      var newY = state.dragState.startY + dyPixels / pixelsPerMeter;

      newY = Math.max(0, Math.min(newY, state.truck.height - pallet.height));
      pallet.baseY = newY;
    } else {
      // 水平拖拽
      const point = Renderer.getDragPoint(e, pallet);
      if (!point) return;

      // 尝试移动到鼠标位置
      pallet.x = point.x + state.dragState.offsetX;
      pallet.z = point.z + state.dragState.offsetZ;
      pallet.overflow = false;

      // 边界限制
      Optimizer.clampPallet(pallet, state.truck);

      const startedOnTop = (state.dragState.startPlacement?.baseY || 0) > 0.01;
      if (startedOnTop && !pallet.freeHeight) {
        // 顶层拖动允许鼠标路径暂时跨过其他货物；松手时再统一检查
        // 碰撞、完整承托和车厢边界。否则密集货堆中的合法空位会因
        // 中途擦碰而永远无法到达。
        // 消解成功，更新合法位置
        state.dragState.lastValidX = pallet.x;
        state.dragState.lastValidZ = pallet.z;
      } else {
        // 底板及自由高度拖动仍实时消解重叠。
        const resolved = Optimizer.resolveOverlap(pallet, state.pallets, state.truck);
        if (resolved) {
          state.dragState.lastValidX = pallet.x;
          state.dragState.lastValidZ = pallet.z;
        } else {
          pallet.x = state.dragState.lastValidX;
          pallet.z = state.dragState.lastValidZ;
        }
      }
    }

    Renderer.updateCargoPosition(pallet);
    updateStatsOnly();
  }

  function onPointerUp(e) {
    if (!state.dragState.active) return;

    const wasVertical = state.dragState.vertical;
    const startPlacement = state.dragState.startPlacement;
    state.dragState.active = false;
    state.dragState.offsetX = 0;
    state.dragState.offsetZ = 0;

    // 恢复 OrbitControls 并释放指针
    Renderer.getControls().enabled = true;
    try { Renderer.getCanvas().releasePointerCapture(e.pointerId); } catch(err) {}
    document.getElementById('canvas3d').style.cursor = 'default';

    const pallet = state.pallets.find(p => p.id === state.dragState.palletId);

    if (pallet && !wasVertical && pallet.freeHeight) {
      // 自由高度模式：保持当前高度水平移动，只处理真实碰撞。
      Optimizer.resolvePalletOverlap(pallet, state.pallets, state.truck);
    } else if (pallet && !wasVertical && (startPlacement?.baseY || 0) > 0.01) {
      // 顶层水平拖动：同一高度的连续顶面可共同承托；靠近合法位置自动吸附。
      const spot = Optimizer.findNearbyCoplanarSupportSpot(
        pallet, state.pallets, state.truck, CARGO_EDGE_SNAP_DISTANCE
      );
      if (spot) {
        Optimizer.applyPlacement(pallet, spot);
      } else if (startPlacement) {
        // 找不到完整承托位置时回到拖动前的位置，不再掉落到底板。
        Optimizer.applyPlacement(pallet, startPlacement);
      }
    } else if (pallet && !wasVertical) {
      // 底板上的水平拖动仍使用原来的碰撞消解逻辑。
      Optimizer.resolvePalletOverlap(pallet, state.pallets, state.truck);
    } else if (pallet && wasVertical) {
      // 垂直拖动为自由高度：松手后保留当前高度，后续可在该高度平移。
      pallet.freeHeight = (pallet.baseY || 0) > 0.01;
    }

    if (pallet) Renderer.updateCargoPosition(pallet);

    // 检查是否在车外
    if (pallet && Optimizer.isPalletOutsideTruck(pallet, state.truck)) {
      pallet.overflow = true;
    }

    state.dragState.palletId = null;
    state.dragState.vertical = false;
    state.dragState.startPlacement = null;
    updateAll();
  }

  function handleDragStacking(pallet) {
    // 货物不能悬空：必须贴地或落在可堆叠货物顶部
    const currentBaseY = pallet.baseY || 0;

    const others = state.pallets.filter(p => p.id !== pallet.id && !p.overflow);
    let highestSupport = 0;

    others.forEach(other => {
      const otherTop = (other.baseY || 0) + other.height;
      if (!other.stackable) return;
      if (otherTop > currentBaseY + 0.3) return;

      const pRect = Optimizer.rectFor(pallet);
      const oRect = Optimizer.rectFor(other);
      const overlap = pRect.minX < oRect.maxX - 0.05 && pRect.maxX > oRect.minX + 0.05 &&
                      pRect.minZ < oRect.maxZ - 0.05 && pRect.maxZ > oRect.minZ + 0.05;

      if (overlap && otherTop > highestSupport) {
        const supports = [other];
        const check = Optimizer.supportCoverageOk(pallet, supports);
        if (check.ok) {
          highestSupport = otherTop;
        }
      }
    });

    // 如果有支撑面且高度接近，吸附到支撑面
    if (highestSupport > 0.01 && Math.abs(currentBaseY - highestSupport) < 0.3) {
      pallet.baseY = highestSupport;
    } else if (highestSupport > 0.01) {
      // 有支撑但高度差距大，下沉到支撑面
      pallet.baseY = highestSupport;
    } else {
      // 无支撑，强制落地
      pallet.baseY = 0;
    }
  }

  function onContextMenu(e) {
    e.preventDefault();

    const palletId = Renderer.getCargoAtMouse(e);
    if (!palletId) return;

    // 选中
    if (state.selectedId !== palletId) {
      if (state.selectedId) Renderer.setSelected(state.selectedId, false);
      state.selectedId = palletId;
      Renderer.setSelected(palletId, true);
      focusSelectedCargoInList = true;
      updateCargoList();
    }

    const menu = document.getElementById('contextMenu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
  }

  function onDoubleClick(e) {
    const palletId = Renderer.getCargoAtMouse(e);
    if (palletId) return; // 双击货物不添加

    const point = Renderer.getFloorPoint(e);
    if (!point) return;

    saveUndoState();

    const card = activeBatchCard || els.cargoBatchContainer.querySelector('.cargo-batch-card');
    if (!card) return;
    const length = parseFloat(batchField(card, 'length').value) / 100;
    const width = parseFloat(batchField(card, 'width').value) / 100;
    const height = parseFloat(batchField(card, 'height').value) / 100;
    const weight = parseFloat(batchField(card, 'weight').value);
    const validationError = validateCargoValues(length, width, height, weight, 1);
    if (validationError) {
      showInputError(`当前批次：${validationError}`);
      return;
    }
    const batchName = card.querySelector('[data-role="batch-name"]').textContent.trim() || `批次${card.dataset.batchNumber}`;
    const batchId = card.dataset.batchId || makeUuid();
    card.dataset.batchId = batchId;
    const pallet = {
      id: makeUuid(),
      batchId,
      batchName,
      name: `${batchName} ${state.pallets.filter(p => p.batchId === batchId).length + 1}`,
      length,
      width,
      height,
      weight,
      color: batchField(card, 'color').value,
      stackable: batchField(card, 'stackable').checked,
      fragile: false,
      adr: false,
      loadLast: false,
      x: point.x,
      z: point.z,
      baseY: 0,
      rotation: 0,
      overflow: false
    };

    Optimizer.clampPallet(pallet, state.truck);

    // 检查是否冲突
    if (Optimizer.placementConflicts(pallet, state.pallets, state.truck)) {
      const spot = Optimizer.findPracticalLoadSpot(pallet, state.pallets, state.truck);
      if (spot) Optimizer.applyPlacement(pallet, spot);
    }

    state.pallets.push(pallet);
    adjustBatchQuantity(pallet, 1);
    state.selectedId = pallet.id;
    captureInitialPlacement();
    Renderer.clearSelection();
    Renderer.setSelected(pallet.id, true);
    updateAll();
  }

  // ---------- 撤销/重做 ----------

  function createHistorySnapshot() {
    return JSON.stringify({
      pallets: state.pallets.map(p => ({
        id: p.id, batchId: p.batchId, batchName: p.batchName, name: p.name,
        length: p.length, width: p.width, height: p.height, weight: p.weight,
        color: p.color, stackable: p.stackable, fragile: p.fragile, adr: p.adr,
        loadLast: p.loadLast, freeHeight: Boolean(p.freeHeight),
        x: p.x, z: p.z, baseY: p.baseY, rotation: p.rotation, overflow: p.overflow
      })),
      batchQuantities: [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')].map(card => ({
        batchId: card.dataset.batchId,
        quantity: Math.max(0, Number.parseInt(batchField(card, 'qty').value, 10) || 0)
      }))
    });
  }

  function restoreHistorySnapshot(snapshot) {
    const parsed = JSON.parse(snapshot);
    if (Array.isArray(parsed)) {
      state.pallets = parsed;
      return;
    }
    state.pallets = parsed.pallets || [];
    (parsed.batchQuantities || []).forEach(saved => {
      const card = [...els.cargoBatchContainer.querySelectorAll('.cargo-batch-card')]
        .find(item => item.dataset.batchId === saved.batchId);
      if (card) batchField(card, 'qty').value = String(saved.quantity);
    });
  }

  function saveUndoState() {
    const snapshot = createHistorySnapshot();
    state.undoStack.push(snapshot);
    state.redoStack = [];
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function undo() {
    if (!state.undoStack.length) return;
    const current = createHistorySnapshot();
    state.redoStack.push(current);
    const prev = state.undoStack.pop();
    restoreHistorySnapshot(prev);
    state.selectedId = null;
    Renderer.clearSelection();
    updateAll();
  }

  function redo() {
    if (!state.redoStack.length) return;
    const current = createHistorySnapshot();
    state.undoStack.push(current);
    const next = state.redoStack.pop();
    restoreHistorySnapshot(next);
    state.selectedId = null;
    Renderer.clearSelection();
    updateAll();
  }

  // ---------- 导出 ----------

  function exportScreenshot() {
    const dataUrl = Renderer.takeScreenshot();
    const link = document.createElement('a');
    link.download = `装载规划_${new Date().toLocaleDateString('zh-CN')}.jpg`;
    link.href = dataUrl;
    link.click();
  }

  // ---------- UI 更新 ----------

  function updateAll() {
    const warnings = Optimizer.validateLoad(state.pallets, state.truck);
    const stats = Optimizer.calculateOptimizationBreakdown(state.pallets, state.truck, warnings);

    updateHud(stats);
    updateLoadBars(stats);
    updateScorePanel(stats);
    updateWarnings(warnings);
    updateCargoList();
    updateOverflowStatus(stats);

    // 重新渲染3D
    Renderer.renderCargo(state.pallets, state.selectedId);
  }

  // 拖拽时只更新右侧数据面板，不重新渲染3D
  function updateStatsOnly() {
    const warnings = Optimizer.validateLoad(state.pallets, state.truck);
    const stats = Optimizer.calculateOptimizationBreakdown(state.pallets, state.truck, warnings);

    updateHud(stats);
    updateLoadBars(stats);
    updateScorePanel(stats);
    updateWarnings(warnings);
    updateOverflowStatus(stats);
  }

  function updateHud(stats) {
    els.hudTruckName.textContent = state.truck.name;
    els.hudCargoCount.textContent = `${state.pallets.length} 件`;
    els.hudLdm.textContent = `${(stats.loadingMetres * 100).toFixed(0)} / ${(state.truck.length * 100).toFixed(0)} cm`;
    els.hudWeight.textContent = formatKg(stats.totalWeight);
    els.hudVolume.textContent = `${(stats.palletVolume * 1000000).toFixed(0)} cm³`;
  }

  function updateLoadBars(stats) {
    const ldmPercent = state.truck.length ? (stats.loadingMetres / state.truck.length) * 100 : 0;
    setLoadBar(els.barLdm, els.barLdmPercent, ldmPercent);

    const floorPercent = stats.floorShare;
    setLoadBar(els.barFloor, els.barFloorPercent, floorPercent);

    const weightPercent = state.truck.maxWeight ? (stats.totalWeight / state.truck.maxWeight) * 100 : 0;
    setLoadBar(els.barWeight, els.barWeightPercent, weightPercent);

    const volumePercent = stats.volumeShare;
    setLoadBar(els.barVolume, els.barVolumePercent, volumePercent);

    // 同步右侧装载米面板
    const usedCm = Math.round(stats.loadingMetres * 100);
    const totalCm = Math.round(state.truck.length * 100);
    const remainCm = Math.max(0, totalCm - usedCm);
    els.ldmUsedText.textContent = `${usedCm} of ${totalCm} cm used`;
    els.ldmRemainingText.textContent = `${remainCm} cm remaining`;
    setLdmBar(els.ldmBarLength, els.ldmBarLengthPercent, ldmPercent);
    setLdmBar(els.ldmBarFloor, els.ldmBarFloorPercent, floorPercent);
    setLdmBar(els.ldmBarWeight, els.ldmBarWeightPercent, weightPercent);
    setLdmBar(els.ldmBarVolume, els.ldmBarVolumePercent, volumePercent);

    // 右侧装载计量表
    const meterUsed = stats.loadingMetres.toFixed(1);
    const meterTotal = state.truck.length.toFixed(1);
    els.ldmMeterValue.textContent = `${meterUsed} / ${meterTotal}`;
    const meterPercent = state.truck.length ? (stats.loadingMetres / state.truck.length) * 100 : 0;
    els.ldmMeterBar.style.width = clampNumber(meterPercent, 0, 100) + '%';
  }

  function setLdmBar(barEl, percentEl, percent) {
    const p = clampNumber(percent, 0, 100);
    barEl.style.width = p + '%';
    percentEl.textContent = Math.round(p) + '%';
  }

  function setLoadBar(barEl, percentEl, percent) {
    if (!barEl.style) return;
    barEl.style.width = clampNumber(percent, 0, 100) + '%';
    percentEl.textContent = Math.round(percent) + '%';
    barEl.className = 'load-bar-fill ' + (percent >= 100 ? 'danger' : percent >= 85 ? 'warning' : 'ok');
  }

  function updateScorePanel(stats) {
    els.scoreValue.textContent = stats.overall;

    const spaceScore = Math.round(((stats.compactness + stats.utilization + stats.cube) / 3) * 0.35);
    els.scoreSpace.textContent = `${spaceScore}/35`;

    els.scoreBalance.textContent = `${Math.round(stats.balance * 0.3)}/30`;
    els.scoreDelivery.textContent = '未评估';
    els.scoreStacking.textContent = `${Math.round(stats.stacking * 0.15)}/15`;
  }

  function updateWarnings(warnings) {
    if (!warnings.length) {
      els.warningList.innerHTML = '<div class="warning-item ok">✓ 状态良好：未发现重叠或边界问题</div>';
      return;
    }

    els.warningList.innerHTML = warnings.slice(0, 6).map(w => `
      <div class="warning-item ${w.type}">
        ${w.type === 'danger' ? '⚠️' : '⚡'} ${w.text}
      </div>
    `).join('');

    if (warnings.length > 6) {
      els.warningList.innerHTML += `<div style="font-size:11px;color:#a0aec0;padding:4px;">还有 ${warnings.length - 6} 个问题...</div>`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function cargoBatchInfo(pallet) {
    const inferredName = String(pallet.name || '货物')
      .replace(/\s+副本$/, '')
      .replace(/\s+\d+$/, '') || '货物';
    const name = pallet.batchName || inferredName;
    const key = pallet.batchId || [
      'legacy', name, pallet.length, pallet.width, pallet.height, pallet.color
    ].join('|');
    return { key, name };
  }

  function updateCargoList() {
    if (!state.pallets.length) {
      els.cargoList.innerHTML = '<div style="font-size:12px;color:#a0aec0;text-align:center;padding:12px;">暂无货物<br>点击左侧"添加货物"或双击3D视图添加</div>';
      return;
    }

    const batchMap = new Map();
    state.pallets.forEach(pallet => {
      const info = cargoBatchInfo(pallet);
      if (!batchMap.has(info.key)) batchMap.set(info.key, { ...info, pallets: [] });
      batchMap.get(info.key).pallets.push(pallet);
    });
    const batches = [...batchMap.values()];
    const selectedPallet = state.pallets.find(pallet => pallet.id === state.selectedId);
    if (selectedPallet && focusSelectedCargoInList) {
      collapsedCargoBatches.delete(cargoBatchInfo(selectedPallet).key);
    }

    els.cargoList.innerHTML = batches.map((batch, batchIndex) => {
      const collapsed = collapsedCargoBatches.has(batch.key);
      const outsideCount = batch.pallets.filter(pallet => pallet.overflow).length;
      const firstColor = batch.pallets[0]?.color || '#718096';
      const itemsHtml = batch.pallets.map(p => {
        const dims = Optimizer.footprint(p);
        const isSelected = state.selectedId === p.id;
        const stackBadge = p.stackable
          ? '<span class="badge badge-stack">可叠</span>'
          : '<span class="badge badge-nostack">不可叠</span>';
        const posText = p.overflow
          ? '<span class="badge badge-overflow">车外</span>'
          : `z=${(p.z*100).toFixed(0)}cm y=${(p.baseY*100).toFixed(0)}cm`;
        return `
          <div class="cargo-item ${isSelected ? 'selected' : ''}"
               data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}">
            <div class="cargo-color" style="background:${escapeHtml(p.color)}"></div>
            <div class="cargo-info">
              <div class="cargo-name">${escapeHtml(p.name)}</div>
              <div class="cargo-details">
                ${(dims.length*100).toFixed(0)}×${(dims.width*100).toFixed(0)}×${(p.height*100).toFixed(0)}cm · ${formatKg(p.weight)}
              </div>
              <div class="cargo-meta">
                ${stackBadge}
                ${p.adr ? '<span class="badge badge-adr">危险品</span>' : ''}
                ${p.loadLast ? '<span class="badge badge-last">最后装</span>' : ''}
              </div>
            </div>
            <div class="cargo-pos">${posText}</div>
          </div>
        `;
      }).join('');

      return `
        <section class="cargo-list-batch ${collapsed ? 'collapsed' : ''}" data-batch-index="${batchIndex}">
          <div class="cargo-list-batch-header">
            <button type="button" class="cargo-batch-toggle" data-batch-index="${batchIndex}"
                    aria-expanded="${!collapsed}" title="${collapsed ? '展开' : '收起'}${escapeHtml(batch.name)}">
              <span class="cargo-batch-chevron">▼</span>
              <span class="cargo-color" style="background:${escapeHtml(firstColor)}"></span>
              <span class="cargo-batch-summary">
                <strong>${escapeHtml(batch.name)}</strong>
                <small>${batch.pallets.length} 件${outsideCount ? ` · 车外 ${outsideCount} 件` : ''}</small>
              </span>
            </button>
            <button type="button" class="cargo-batch-delete" data-batch-index="${batchIndex}"
                    title="删除该批次 ${batch.pallets.length} 件货物" aria-label="删除${escapeHtml(batch.name)}">
              🗑️
            </button>
          </div>
          <div class="cargo-list-batch-items" ${collapsed ? 'hidden' : ''}>${itemsHtml}</div>
        </section>
      `;
    }).join('');

    els.cargoList.querySelectorAll('.cargo-batch-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const batch = batches[Number(button.dataset.batchIndex)];
        if (!batch) return;
        if (collapsedCargoBatches.has(batch.key)) collapsedCargoBatches.delete(batch.key);
        else collapsedCargoBatches.add(batch.key);
        updateCargoList();
      });
    });

    els.cargoList.querySelectorAll('.cargo-batch-delete').forEach(button => {
      button.addEventListener('click', () => {
        const batch = batches[Number(button.dataset.batchIndex)];
        if (!batch) return;
        if (!confirm(`确定删除批次“${batch.name}”的 ${batch.pallets.length} 件货物吗？`)) return;

        saveUndoState();
        const ids = new Set(batch.pallets.map(pallet => pallet.id));
        batch.pallets.forEach(pallet => adjustBatchQuantity(pallet, -1));
        state.pallets = state.pallets.filter(pallet => !ids.has(pallet.id));
        collapsedCargoBatches.delete(batch.key);
        if (state.selectedId && ids.has(state.selectedId)) {
          state.selectedId = null;
          Renderer.clearSelection();
        }
        updateAll();
        els.optimizerStatus.textContent = `✅ 已删除批次“${batch.name}”，共 ${batch.pallets.length} 件货物`;
      });
    });

    // 点击选中
    els.cargoList.querySelectorAll('.cargo-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const pallet = state.pallets.find(p => p.id === id);
        if (pallet) {
          if (state.selectedId) Renderer.setSelected(state.selectedId, false);
          state.selectedId = pallet.id;
          Renderer.setSelected(pallet.id, true);
          updateCargoList();
        }
      });
    });

    if (state.selectedId && focusSelectedCargoInList) {
      focusSelectedCargoInList = false;
      window.requestAnimationFrame(() => {
        const selectedItem = [...els.cargoList.querySelectorAll('.cargo-item')]
          .find(item => item.dataset.id === state.selectedId);
        selectedItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  function updateOverflowStatus(stats) {
    if (stats.overflowCount > 0) {
      els.overflowStatus.style.display = 'block';
      els.overflowStatus.textContent = `有 ${stats.overflowCount} 件货物在车外`;
    } else {
      els.overflowStatus.style.display = 'none';
    }
  }

  // ---------- 公共接口 ----------

  return {
    init,
    state
  };
})();

// 页面加载完成后初始化
App.init();
