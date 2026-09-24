// ============================================================
// 卡车装载规划器 - 配置文件
// 车辆模板、货物预设、全局常量
// ============================================================

// ---------- 全局常量 ----------
const PLACEMENT_CLEARANCE = 0.003;           // 正常放置间隙 (米) - 3mm，紧贴摆放
const RECOVERY_CLEARANCE = 0.004;            // 恢复模式间隙 (米)
const OVERLAP_TOLERANCE = 0.01;              // 垂直重叠容忍度 (米)
const CARGO_EDGE_SNAP_DISTANCE = 0.18;       // 货物边缘吸附距离 (米)
const OPTIMIZE_PASSES = 4;                   // 优化迭代轮数
const OVERLAP_RESOLVE_PASSES = 8;            // 重叠消解最大轮数
const GRID_STEP_SMALL = 0.1;                 // 小批量网格步长
const GRID_STEP_LARGE = 0.2;                 // 大批量网格步长
const GRID_THRESHOLD = 60;                   // 大批量阈值 (件数)

// ---------- 车辆模板 ----------
const truckTemplates = {
  smallVan: {
    name: "小型厢式货车(Van)",
    mode: "road",
    kind: "van",
    icon: "🚐",
    length: 1.8,
    width: 1.5,
    height: 1.2,
    maxWeight: 800,
    weightLabel: "500~800kg",
    axles: [
      { label: "前轴", z: 0.4 },
      { label: "后轴", z: 1.35 }
    ],
    wheelZ: [0.4, 1.35]
  },
  mediumVan: {
    name: "中型厢式货车(Van)",
    mode: "road",
    kind: "van",
    icon: "🚐",
    length: 2.3,
    width: 1.9,
    height: 1.9,
    maxWeight: 1200,
    weightLabel: "900~1200kg",
    axles: [
      { label: "前轴", z: 0.5 },
      { label: "后轴", z: 1.75 }
    ],
    wheelZ: [0.5, 1.75]
  },
  largeVan35t: {
    name: "大型厢式货车(Van)/3.5T",
    mode: "road",
    kind: "van",
    icon: "🚐",
    length: 2.6,
    width: 1.7,
    height: 1.6,
    maxWeight: 1600,
    weightLabel: "1200~1600kg",
    axles: [
      { label: "前轴", z: 0.55 },
      { label: "后轴", z: 1.95 }
    ],
    wheelZ: [0.55, 1.95]
  },
  largeVan4m: {
    name: "FTL-直达厢式车 Large VAN (4m)",
    mode: "road",
    kind: "van",
    icon: "🚐",
    length: 4.2,
    width: 2.0,
    height: 1.8,
    maxWeight: 1000,
    weightLabel: "1000kg",
    axles: [
      { label: "前轴", z: 0.7 },
      { label: "后轴", z: 3.15 }
    ],
    wheelZ: [0.7, 3.15]
  },
  curtainVan48m: {
    name: "FTL-直达侧帘车 Curtain VAN(4.8m)",
    mode: "road",
    kind: "van",
    icon: "🚐",
    length: 4.2,
    width: 2.1,
    height: 2.1,
    maxWeight: 1000,
    weightLabel: "1000kg",
    axles: [
      { label: "前轴", z: 0.7 },
      { label: "后轴", z: 3.15 }
    ],
    wheelZ: [0.7, 3.15]
  },
  mediumTruck75t: {
    name: "中型卡车(7.5t，6.1m)",
    mode: "road",
    kind: "rigid",
    icon: "🚚",
    length: 6.0,
    width: 2.4,
    height: 2.3,
    maxWeight: 3000,
    weightLabel: "2300~3000kg",
    axles: [
      { label: "前轴", z: 0.85 },
      { label: "后轴", z: 4.4 }
    ],
    wheelZ: [0.85, 4.4]
  },
  mediumTruck12t: {
    name: "中型卡车(12t，7.2m)",
    mode: "road",
    kind: "rigid",
    icon: "🚚",
    length: 7.2,
    width: 2.45,
    height: 2.5,
    maxWeight: 6000,
    weightLabel: "5000~6000kg",
    axles: [
      { label: "前轴", z: 0.9 },
      { label: "后轴", z: 5.3 }
    ],
    wheelZ: [0.9, 5.3]
  },
  semiTrailer40t: {
    name: "40T半挂车(13.6m，Semi-trailer)",
    mode: "road",
    kind: "trailer",
    icon: "🚛",
    length: 13.6,
    width: 2.45,
    height: 2.7,
    maxWeight: 24000,
    weightLabel: "24000kg",
    axles: [
      { label: "牵引销", z: 1.25 },
      { label: "后桥组", z: 10.85 }
    ],
    wheelZ: [10.15, 10.85, 11.55]
  },
};

// ---------- 货物预设 ----------
const cargoPresets = {
  euro: { label: "欧洲托盘", length: 1.2, width: 0.8, height: 1.2, weight: 450, color: "#1f9d72", stackable: true },
  uk: { label: "英国托盘", length: 1.2, width: 1.0, height: 1.2, weight: 520, color: "#2f80ed", stackable: true },
  half: { label: "半托盘", length: 0.8, width: 0.6, height: 0.9, weight: 220, color: "#39a66a", stackable: true },
  industrial: { label: "工业托盘", length: 1.2, width: 1.2, height: 1.1, weight: 620, color: "#d9a22b", stackable: true },
  carton: { label: "纸箱", length: 0.6, width: 0.4, height: 0.4, weight: 25, color: "#9b7bd8", stackable: true },
  crate: { label: "板条箱", length: 1.0, width: 1.0, height: 0.9, weight: 350, color: "#b86b2b", stackable: true },
  chep: { label: "CHEP托盘", length: 1.2, width: 1.0, height: 1.25, weight: 550, color: "#2268b8", stackable: true },
  custom: { label: "自定义货物", length: 1.2, width: 0.8, height: 1.2, weight: 450, color: "#1f9d72", stackable: true }
};

// ---------- 工具函数 ----------
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function formatMeters(meters) {
  if (meters >= 10) return meters.toFixed(1) + 'm';
  return meters.toFixed(2) + 'm';
}

function formatKg(kg) {
  return Math.round(kg) + 'kg';
}

function snap(value, step = 0.001) {
  return Math.round(value / step) * step;
}
