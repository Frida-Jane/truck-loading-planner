// ============================================================
// 卡车装载规划器 - 核心算法模块
// 包含：几何计算、碰撞检测、重量分布、评分系统、
//       多种放置策略、8种优化策略、堆叠验证、重叠消解
// ============================================================

const Optimizer = (function() {
  'use strict';

  // ---------- 几何辅助函数 ----------

  function footprint(pallet) {
    const rotated = pallet.rotation === 90;
    return {
      length: rotated ? pallet.width : pallet.length,
      width: rotated ? pallet.length : pallet.width
    };
  }

  function rectFor(pallet) {
    const dims = footprint(pallet);
    return {
      minX: pallet.x - dims.width / 2,
      maxX: pallet.x + dims.width / 2,
      minZ: pallet.z - dims.length / 2,
      maxZ: pallet.z + dims.length / 2
    };
  }

  function boxFor(pallet) {
    return {
      ...rectFor(pallet),
      minY: pallet.baseY || 0,
      maxY: (pallet.baseY || 0) + pallet.height
    };
  }

  function clampPallet(pallet, truck) {
    if (pallet.overflow) return;
    const dims = footprint(pallet);
    const minX = -truck.width / 2 + dims.width / 2;
    const maxX = truck.width / 2 - dims.width / 2;
    const minZ = dims.length / 2;
    const maxZ = truck.length - dims.length / 2;
    if (minX <= maxX) pallet.x = clampNumber(pallet.x, minX, maxX);
    if (minZ <= maxZ) pallet.z = clampNumber(pallet.z, minZ, maxZ);
  }

  function isPalletOutsideTruck(pallet, truck) {
    if (pallet.overflow) return true;
    const b = boxFor(pallet);
    return b.minX < -truck.width / 2 - 0.001 ||
           b.maxX > truck.width / 2 + 0.001 ||
           b.minZ < -0.001 ||
           b.maxZ > truck.length + 0.001 ||
           b.maxY > truck.height + 0.001;
  }

  // ---------- 碰撞检测 ----------

  function boxesConflict(first, second, clearance = PLACEMENT_CLEARANCE, yTolerance = OVERLAP_TOLERANCE) {
    const horizontalConflict =
      first.minX < second.maxX - clearance &&
      first.maxX > second.minX + clearance &&
      first.minZ < second.maxZ - clearance &&
      first.maxZ > second.minZ + clearance;
    const verticalConflict =
      first.minY < second.maxY - yTolerance &&
      first.maxY > second.minY + yTolerance;
    return horizontalConflict && verticalConflict;
  }

  function placementConflicts(pallet, existing, truck, clearance = PLACEMENT_CLEARANCE) {
    const palletBox = boxFor(pallet);
    return existing.some(item => {
      if (item.id === pallet.id) return false;
      return boxesConflict(palletBox, boxFor(item), clearance, OVERLAP_TOLERANCE);
    });
  }

  function rectsOverlap(a, b, tolerance = 0) {
    return a.minX < b.maxX - tolerance && a.maxX > b.minX + tolerance &&
           a.minZ < b.maxZ - tolerance && a.maxZ > b.minZ + tolerance;
  }

  function resolveOverlap(pallet, others, truck) {
    const gap = 0.005; // 边缘间隙
    const maxIter = 4;

    for (let iter = 0; iter < maxIter; iter++) {
      let myBox = boxFor(pallet);
      let resolved = true;

      for (const other of others) {
        if (other.id === pallet.id || other.overflow) continue;
        const oBox = boxFor(other);

        // 垂直方向不重叠则跳过（用较大容差避免擦边误判）
        const vertOverlap = myBox.minY < oBox.maxY - 0.05 && myBox.maxY > oBox.minY + 0.05;
        if (!vertOverlap) continue;

        // 水平方向有重叠才处理
        const overlapX = myBox.minX < oBox.maxX - gap && myBox.maxX > oBox.minX + gap;
        const overlapZ = myBox.minZ < oBox.maxZ - gap && myBox.maxZ > oBox.minZ + gap;
        if (!overlapX || !overlapZ) continue;

        resolved = false;

        // 计算各轴推开距离（正值=需要移动的距离）
        const pushLeft  = myBox.maxX - oBox.minX + gap;   // 向 -X 推
        const pushRight = oBox.maxX - myBox.minX + gap;    // 向 +X 推
        const pushBack  = myBox.maxZ - oBox.minZ + gap;   // 向 -Z 推
        const pushFwd   = oBox.maxZ - myBox.minZ + gap;    // 向 +Z 推

        // 选最小推开方向
        const minPush = Math.min(pushLeft, pushRight, pushBack, pushFwd);

        if (minPush === pushLeft) {
          pallet.x -= pushLeft;
        } else if (minPush === pushRight) {
          pallet.x += pushRight;
        } else if (minPush === pushBack) {
          pallet.z -= pushBack;
        } else {
          pallet.z += pushFwd;
        }

        // 更新 box
        const dims = footprint(pallet);
        myBox.minX = pallet.x - dims.width / 2;
        myBox.maxX = pallet.x + dims.width / 2;
        myBox.minZ = pallet.z - dims.length / 2;
        myBox.maxZ = pallet.z + dims.length / 2;
      }

      if (resolved) {
        return true;
      }
    }

    // 检查最终位置是否仍有重叠
    const finalBox = boxFor(pallet);
    for (const other of others) {
      if (other.id === pallet.id || other.overflow) continue;
      const oBox = boxFor(other);
      const vertOverlap = finalBox.minY < oBox.maxY - 0.05 && finalBox.maxY > oBox.minY + 0.05;
      if (!vertOverlap) continue;
      if (finalBox.minX < oBox.maxX - gap && finalBox.maxX > oBox.minX + gap &&
          finalBox.minZ < oBox.maxZ - gap && finalBox.maxZ > oBox.minZ + gap) {
        return false;
      }
    }
    return true;
  }

  function rangesNearOrOverlap(aMin, aMax, bMin, bMax, tolerance) {
    return aMin <= bMax + tolerance && aMax >= bMin - tolerance;
  }

  // ---------- 重量分布 ----------

  function getWheelPositions(truck) {
    if (truck.wheelZ && truck.wheelZ.length) return truck.wheelZ;
    if (truck.axles) return truck.axles.map(a => a.z);
    return [];
  }

  function distributePalletLoadToWheels(positions, z, weight) {
    if (!positions.length || !weight) return;
    if (positions.length === 1 || z <= positions[0].z) {
      positions[0].load += weight;
      return;
    }
    const last = positions[positions.length - 1];
    if (z >= last.z) {
      last.load += weight;
      return;
    }
    for (let i = 0; i < positions.length - 1; i++) {
      const left = positions[i];
      const right = positions[i + 1];
      if (z < left.z || z > right.z) continue;
      const span = Math.max(0.001, right.z - left.z);
      const rightShare = (z - left.z) / span;
      left.load += weight * (1 - rightShare);
      right.load += weight * rightShare;
      return;
    }
  }

  function calculateWheelStress(pallets, truck) {
    const wheelZ = getWheelPositions(truck);
    const positions = wheelZ
      .map((z, index) => ({ z: Number(z), index, load: 0 }))
      .filter(item => Number.isFinite(item.z))
      .sort((a, b) => a.z - b.z);
    if (!positions.length) return [];

    const loaded = pallets.filter(p => !isPalletOutsideTruck(p, truck));
    loaded.forEach(pallet => {
      distributePalletLoadToWheels(positions, pallet.z, pallet.weight);
    });

    const capacity = Math.max(1, truck.maxWeight / positions.length);
    return positions.map((item, index) => ({
      ...item,
      label: wheelStressLabel(item, index, positions.length, truck),
      capacity,
      percent: (item.load / capacity) * 100
    }));
  }

  function wheelStressLabel(item, index, total, truck) {
    if (truck.kind === 'trailer') {
      if (item.z < 2) return '牵引销';
      return `第${index}轴 (${item.z.toFixed(1)}m)`;
    }
    if (total <= 2) return index === 0 ? '前轮' : '后轮';
    return `${item.z.toFixed(1)}m 轮组`;
  }

  function calculateWeightedLoadCenter(pallets) {
    const totalWeight = pallets.reduce((sum, p) => sum + p.weight, 0);
    if (!totalWeight) {
      const count = Math.max(1, pallets.length);
      return {
        x: pallets.reduce((sum, p) => sum + p.x, 0) / count,
        z: pallets.reduce((sum, p) => sum + p.z, 0) / count
      };
    }
    return {
      x: pallets.reduce((sum, p) => sum + p.x * p.weight, 0) / totalWeight,
      z: pallets.reduce((sum, p) => sum + p.z * p.weight, 0) / totalWeight
    };
  }

  function loadSupportPositions(truck) {
    const axlePoints = (truck.axles || [])
      .map((axle, index) => ({ z: Number(axle.z), index, load: 0 }))
      .filter(item => Number.isFinite(item.z))
      .sort((a, b) => a.z - b.z);
    if (axlePoints.length >= 2) return axlePoints;
    return getWheelPositions(truck)
      .map((z, index) => ({ z: Number(z), index, load: 0 }))
      .filter(item => Number.isFinite(item.z))
      .sort((a, b) => a.z - b.z);
  }

  function preferredWeightCenterZ(truck) {
    const supports = loadSupportPositions(truck);
    if (supports.length >= 2) {
      return (supports[0].z + supports[supports.length - 1].z) / 2;
    }
    return truck.length * 0.5;
  }

  function calculateDistributionScore(pallets, truck) {
    const positions = loadSupportPositions(truck);
    const totalWeight = pallets.reduce((sum, p) => sum + p.weight, 0);
    if (!positions.length || !totalWeight) return 86;

    const posCopy = positions.map(p => ({ ...p, load: 0 }));
    pallets.forEach(pallet => {
      distributePalletLoadToWheels(posCopy, pallet.z, pallet.weight);
    });

    const idealLoad = totalWeight / posCopy.length;
    const averageDeviation = posCopy.reduce((sum, item) => {
      return sum + Math.abs(item.load - idealLoad);
    }, 0) / posCopy.length;
    const deviationPenalty = (averageDeviation / Math.max(1, totalWeight)) * 170;
    const capacity = Math.max(1, truck.maxWeight / posCopy.length);
    const maxPercent = Math.max(...posCopy.map(item => (item.load / capacity) * 100));
    const overloadPenalty = Math.max(0, maxPercent - 80) * 1.5;

    return clampNumber(100 - deviationPenalty - overloadPenalty, 0, 100);
  }

  // ---------- 评分系统 ----------

  function calculateBoundsForPallets(pallets) {
    if (!pallets.length) return null;
    return pallets.reduce((bounds, pallet) => {
      const box = boxFor(pallet);
      return {
        minX: Math.min(bounds.minX, box.minX),
        maxX: Math.max(bounds.maxX, box.maxX),
        minZ: Math.min(bounds.minZ, box.minZ),
        maxZ: Math.max(bounds.maxZ, box.maxZ),
        minY: Math.min(bounds.minY, box.minY),
        maxY: Math.max(bounds.maxY, box.maxY)
      };
    }, {
      minX: Infinity, maxX: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
      minY: Infinity, maxY: -Infinity
    });
  }

  function calculateFloorUsageForPallets(pallets, truck) {
    const truckFloor = Math.max(0.01, truck.length * truck.width);
    const floorArea = pallets.reduce((sum, pallet) => {
      if ((pallet.baseY || 0) > 0.01 || isPalletOutsideTruck(pallet, truck)) return sum;
      const dims = footprint(pallet);
      return sum + dims.width * dims.length;
    }, 0);
    return (floorArea / truckFloor) * 100;
  }

  function calculateEuroPalletCapacity(truck) {
    return Math.floor(truck.length / 1.2) * Math.floor(truck.width / 0.8);
  }

  function calculateOptimizationBreakdown(pallets, truck, warnings = []) {
    const loaded = pallets.filter(p => !isPalletOutsideTruck(p, truck));
    const overflowCount = pallets.length - loaded.length;

    if (!pallets.length) {
      return {
        overall: 0, fit: 0, compactness: 0, balance: 0,
        stacking: 0, payload: 0, cube: 0, spread: 0, utilization: 0,
        loadingMetres: 0, usedLoadLength: 0,
        palletFloor: 0, palletVolume: 0, totalWeight: 0,
        floorShare: 0, volumeShare: 0,
        wheelStress: calculateWheelStress([], truck),
        overflowCount: 0
      };
    }

    const palletVolume = loaded.reduce((sum, p) => sum + p.length * p.width * p.height, 0);
    const palletFloor = loaded.reduce((sum, p) => {
      if ((p.baseY || 0) > 0.01) return sum;
      const dims = footprint(p);
      return sum + dims.length * dims.width;
    }, 0);
    const truckVolume = truck.length * truck.width * truck.height;
    const truckFloor = truck.length * truck.width;
    const totalWeight = loaded.reduce((sum, p) => sum + p.weight, 0);
    const wheelStress = calculateWheelStress(loaded, truck);
    const loadBounds = calculateBoundsForPallets(loaded);
    const loadingMetres = truck.width ? palletFloor / truck.width : 0;
    const usedLoadLength = loadBounds ? Math.max(0, loadBounds.maxZ - loadBounds.minZ) : 0;
    const floorShare = truckFloor ? (palletFloor / truckFloor) * 100 : 0;
    const volumeShare = truckVolume ? (palletVolume / truckVolume) * 100 : 0;

    const dangerCount = warnings.filter(w => w.type === 'danger').length;
    const infoCount = warnings.filter(w => w.type !== 'danger').length;
    const overweightPercent = truck.maxWeight
      ? Math.max(0, ((totalWeight - truck.maxWeight) / truck.maxWeight) * 100)
      : 0;

    const fit = clampNumber(100 - dangerCount * 22 - infoCount * 4 - overweightPercent * 2, 0, 100);
    const compactness = loadingMetres && usedLoadLength
      ? clampNumber((loadingMetres / usedLoadLength) * 100, 0, 100)
      : 0;
    const loadHeight = loadBounds ? Math.max(0, loadBounds.maxY - loadBounds.minY) : 0;
    const usedCube = usedLoadLength * truck.width * Math.max(loadHeight, 0.01);
    const cubeDensity = usedCube ? (palletVolume / usedCube) * 100 : volumeShare;
    const cube = clampNumber(cubeDensity, 0, 100);

    const stressPercents = wheelStress.map(item => item.percent);
    const maxStress = stressPercents.length ? Math.max(...stressPercents) : 0;
    const minStress = stressPercents.length ? Math.min(...stressPercents) : 0;
    const stressSpread = maxStress - minStress;
    const balance = stressPercents.length && totalWeight
      ? clampNumber(100 - Math.max(0, maxStress - 80) * 2.5 - stressSpread * 0.35, 0, 100)
      : 85;

    const stackIssueCount = warnings.filter(w => /stack|support|支撑/i.test(w.text || '')).length;
    const stackedCount = pallets.filter(p => (p.baseY || 0) > 0.01).length;
    const stackableCount = pallets.filter(p => p.stackable).length;
    const stackingOpportunity = stackableCount > 1
      ? Math.min((stackedCount / Math.max(1, stackableCount - 1)) * 100, 100)
      : 100;
    const stacking = clampNumber(88 + Math.min(stackingOpportunity * 0.12, 12) - stackIssueCount * 28, 0, 100);

    const payload = clampNumber(100 - overweightPercent * 4, 0, 100);
    const spread = clampNumber(100 - Math.max(0, floorShare - 100) * 2 - Math.max(0, volumeShare - 100) * 2, 0, 100);
    const utilization = clampNumber(Math.min(floorShare, 100) * 0.55 + Math.min(volumeShare, 100) * 0.45, 0, 100);

    const overall = Math.round(
      fit * 0.28 + compactness * 0.18 + balance * 0.20 +
      stacking * 0.12 + payload * 0.08 + cube * 0.06 +
      spread * 0.04 + utilization * 0.04
    );

    return {
      overall,
      fit: Math.round(fit),
      compactness: Math.round(compactness),
      balance: Math.round(balance),
      stacking: Math.round(stacking),
      payload: Math.round(payload),
      cube: Math.round(cube),
      spread: Math.round(spread),
      utilization: Math.round(utilization),
      loadingMetres,
      usedLoadLength,
      palletFloor,
      palletVolume,
      totalWeight,
      floorShare,
      volumeShare,
      wheelStress,
      overflowCount
    };
  }

  // ---------- 候选点生成 ----------

  function optimizedGridStep(palletCount) {
    return palletCount > GRID_THRESHOLD ? GRID_STEP_LARGE : GRID_STEP_SMALL;
  }

  function denseRecoveryGridStep() {
    return GRID_STEP_SMALL * 0.5;
  }

  function addPlacementCandidate(set, value, min, max) {
    if (!Number.isFinite(value)) return;
    const clamped = clampNumber(value, min, max);
    set.add(Number(clamped.toFixed(4)));
    set.add(Number(snap(clamped).toFixed(4)));
  }

  function candidateRotations(pallet) {
    const rotations = [pallet.rotation || 0, (pallet.rotation || 0) === 90 ? 0 : 90];
    const seen = new Set();
    return rotations.filter(rotation => {
      const dims = footprint({ ...pallet, rotation });
      const key = `${rotation}:${dims.width.toFixed(3)}:${dims.length.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function collectFloorSpotCandidates(pallet, existing, truck, options = {}) {
    const dims = footprint(pallet);
    const minX = -truck.width / 2 + dims.width / 2;
    const maxX = truck.width / 2 - dims.width / 2;
    const minZ = dims.length / 2;
    const maxZ = truck.length - dims.length / 2;

    if (minX > maxX || minZ > maxZ || pallet.height > truck.height + 0.001) return [];

    const step = options.dense ? denseRecoveryGridStep() : optimizedGridStep(existing.length);
    const xCandidates = new Set();
    const zCandidates = new Set();
    const preferredZ = preferredWeightCenterZ(truck);

    addPlacementCandidate(xCandidates, 0, minX, maxX);
    addPlacementCandidate(xCandidates, minX, minX, maxX);
    addPlacementCandidate(xCandidates, maxX, minX, maxX);
    addPlacementCandidate(zCandidates, minZ, minZ, maxZ);
    addPlacementCandidate(zCandidates, preferredZ, minZ, maxZ);
    addPlacementCandidate(zCandidates, preferredZ - dims.length / 2, minZ, maxZ);
    addPlacementCandidate(zCandidates, preferredZ + dims.length / 2, minZ, maxZ);

    for (let x = minX; x <= maxX + 0.001; x += step) {
      addPlacementCandidate(xCandidates, x, minX, maxX);
    }
    for (let z = minZ; z <= maxZ + 0.001; z += step) {
      addPlacementCandidate(zCandidates, z, minZ, maxZ);
    }

    existing.forEach(item => {
      const rect = rectFor(item);
      const gap = options.clearance ?? PLACEMENT_CLEARANCE;
      addPlacementCandidate(xCandidates, rect.minX - gap - dims.width / 2, minX, maxX);
      addPlacementCandidate(xCandidates, rect.maxX + gap + dims.width / 2, minX, maxX);
      addPlacementCandidate(xCandidates, item.x, minX, maxX);
      addPlacementCandidate(xCandidates, -item.x, minX, maxX);
      addPlacementCandidate(zCandidates, rect.minZ - gap - dims.length / 2, minZ, maxZ);
      addPlacementCandidate(zCandidates, rect.maxZ + gap + dims.length / 2, minZ, maxZ);
      addPlacementCandidate(zCandidates, item.z, minZ, maxZ);
    });

    const spots = [];
    const sortedX = [...xCandidates].sort((a, b) => a - b);
    const sortedZ = [...zCandidates].sort((a, b) => a - b);

    for (const z of sortedZ) {
      for (const x of sortedX) {
        spots.push({ x, z, baseY: 0 });
      }
    }
    return spots;
  }

  // ---------- 堆叠候选点 ----------

  function groupSupportsByHeight(supports) {
    const heightMap = new Map();
    supports.forEach(support => {
      const topY = (support.baseY || 0) + support.height;
      const key = Number(topY.toFixed(3));
      if (!heightMap.has(key)) heightMap.set(key, []);
      heightMap.get(key).push(support);
    });
    return [...heightMap.entries()].sort((a, b) => a[0] - b[0]);
  }

  function unionRect(rects) {
    return {
      minX: Math.min(...rects.map(r => r.minX)),
      maxX: Math.max(...rects.map(r => r.maxX)),
      minZ: Math.min(...rects.map(r => r.minZ)),
      maxZ: Math.max(...rects.map(r => r.maxZ))
    };
  }

  function supportCoverageOk(pallet, supports) {
    // 同一高度且彼此连续的多个顶面视为一个完整承托平面。
    // 仍要求底面覆盖率至少 99.5%，有缝隙或局部悬空的组合不会通过。
    return coplanarSupportCoverageOk(pallet, supports);
  }

  // 手工拖动时，同一高度的多个连续顶面可共同承托货物。
  // 与智能优化的单件完整承托规则分开，避免改变自动装载策略。
  function coplanarSupportCoverageOk(pallet, supports, tolerance = 0.005) {
    if (!supports.length) return { ok: false, reason: 'no_supports', coverage: 0 };

    const palletRect = rectFor(pallet);
    const palletArea = Math.max(0.001,
      (palletRect.maxX - palletRect.minX) * (palletRect.maxZ - palletRect.minZ));
    const clipped = [];

    supports.forEach(support => {
      const rect = rectFor(support);
      const minX = Math.max(palletRect.minX, rect.minX - tolerance);
      const maxX = Math.min(palletRect.maxX, rect.maxX + tolerance);
      const minZ = Math.max(palletRect.minZ, rect.minZ - tolerance);
      const maxZ = Math.min(palletRect.maxZ, rect.maxZ + tolerance);
      if (maxX > minX && maxZ > minZ) clipped.push({ minX, maxX, minZ, maxZ });
    });

    if (!clipped.length) return { ok: false, reason: 'no_coverage', coverage: 0 };

    // 平面扫描计算矩形并集，避免相邻承托面的重叠面积被重复累计。
    const xs = [...new Set(clipped.flatMap(rect => [rect.minX, rect.maxX]))].sort((a, b) => a - b);
    let supportArea = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const x1 = xs[i];
      const x2 = xs[i + 1];
      if (x2 <= x1) continue;
      const midX = (x1 + x2) / 2;
      const intervals = clipped
        .filter(rect => midX >= rect.minX && midX <= rect.maxX)
        .map(rect => [rect.minZ, rect.maxZ])
        .sort((a, b) => a[0] - b[0]);
      if (!intervals.length) continue;

      let coveredZ = 0;
      let start = intervals[0][0];
      let end = intervals[0][1];
      for (let j = 1; j < intervals.length; j++) {
        if (intervals[j][0] <= end + tolerance) {
          end = Math.max(end, intervals[j][1]);
        } else {
          coveredZ += end - start;
          start = intervals[j][0];
          end = intervals[j][1];
        }
      }
      coveredZ += end - start;
      supportArea += (x2 - x1) * coveredZ;
    }

    const coverage = Math.min(1, supportArea / palletArea);
    return { ok: coverage >= 0.995, coverage, supportArea, palletArea };
  }

  function getStackSupports(pallet, allPallets) {
    const palletBox = boxFor(pallet);
    const baseY = pallet.baseY || 0;
    if (baseY < 0.01) return [];

    return allPallets.filter(support => {
      if (support.id === pallet.id) return false;
      if (!support.stackable) return false;
      const sBox = boxFor(support);
      if (Math.abs(sBox.maxY - baseY) > 0.005) return false;
      return rectsOverlap(rectFor(pallet), rectFor(support), 0.02);
    });
  }

  // 在松手点附近寻找同一承托平面上的最近合法位置；当前位置合法时保持自由位置。
  function findNearbyCoplanarSupportSpot(pallet, allPallets, truck, snapDistance = CARGO_EDGE_SNAP_DISTANCE) {
    if (!pallet || (pallet.baseY || 0) < 0.01) return null;

    const others = allPallets.filter(item => item.id !== pallet.id && !item.overflow);
    const currentBaseY = pallet.baseY || 0;
    const groups = groupSupportsByHeight(others.filter(item => item.stackable && !item.doNotStack));
    let best = null;

    groups.forEach(([topY, supports]) => {
      if (Math.abs(topY - currentBaseY) > 0.3) return;
      if (topY + pallet.height > truck.height + 0.001) return;

      const dims = footprint(pallet);
      // 大件货物从重叠预览位置吸附到合法边缘时，中心点位移可能超过
      // 固定的 18cm；吸附范围随货物占地适度放宽，但上限保持在 75cm。
      const effectiveSnapDistance = Math.max(
        snapDistance,
        Math.min(0.75, Math.max(dims.width, dims.length) / 2)
      );
      const xs = new Set([pallet.x]);
      const zs = new Set([pallet.z]);
      supports.forEach(support => {
        const rect = rectFor(support);
        xs.add(support.x);
        xs.add(rect.minX + dims.width / 2);
        xs.add(rect.maxX - dims.width / 2);
        zs.add(support.z);
        zs.add(rect.minZ + dims.length / 2);
        zs.add(rect.maxZ - dims.length / 2);
      });

      // 同层货物的外边缘也是重要候选点：松手点略有重叠时，可自动
      // 贴到相邻货物旁边，而不是直接判定失败并回到原位。
      others
        .filter(item => Math.abs((item.baseY || 0) - topY) < 0.005)
        .forEach(item => {
          const rect = rectFor(item);
          xs.add(rect.minX - dims.width / 2);
          xs.add(rect.maxX + dims.width / 2);
          zs.add(rect.minZ - dims.length / 2);
          zs.add(rect.maxZ + dims.length / 2);
        });

      xs.forEach(x => zs.forEach(z => {
        const candidate = { ...pallet, x, z, baseY: topY, overflow: false };
        if (isPalletOutsideTruck(candidate, truck)) return;
        if (placementConflicts(candidate, others, truck, PLACEMENT_CLEARANCE)) return;
        if (!coplanarSupportCoverageOk(candidate, supports).ok) return;

        const distance = Math.hypot(x - pallet.x, z - pallet.z);
        if (distance > effectiveSnapDistance + 0.001) return;
        if (!best || distance < best.distance) {
          best = { x, z, baseY: topY, rotation: pallet.rotation || 0, overflow: false, distance };
        }
      }));
    });

    return best;
  }

  function collectStackSpotCandidates(pallet, existing, truck) {
    // 不可堆叠物品也可以放在可堆叠物品上方
    const spots = [];
    const seen = new Set();
    const step = denseRecoveryGridStep();
    const supportsByHeight = groupSupportsByHeight(
      existing.filter(s => s.stackable && !isPalletOutsideTruck(s, truck))
    );

    supportsByHeight.forEach(([baseY, supports]) => {
      const palletDims = footprint(pallet);

      const addSpot = (x, z) => {
        const key = [x.toFixed(3), z.toFixed(3), baseY.toFixed(3)].join(':');
        if (seen.has(key)) return;
        seen.add(key);
        spots.push({ x, z, baseY });
      };

      // 在每个支撑物顶面生成网格候选点（密集网格，确保物品能放满支撑面）
      supports.forEach(support => {
        const sRect = rectFor(support);
        const sDims = footprint(support);

        // 计算可放置范围
        const minX = sRect.minX + palletDims.width / 2;
        const maxX = sRect.maxX - palletDims.width / 2;
        const minZ = sRect.minZ + palletDims.length / 2;
        const maxZ = sRect.maxZ - palletDims.length / 2;

        if (minX > maxX + 0.001 || minZ > maxZ + 0.001) {
          // 支撑物太小，至少试试中心位置
            addSpot(support.x, support.z);
          return;
        }

        // 生成网格候选点
        for (let x = minX; x <= maxX + 0.001; x += step) {
          for (let z = minZ; z <= maxZ + 0.001; z += step) {
            const sx = Math.min(Math.max(x, minX), maxX);
            const sz = Math.min(Math.max(z, minZ), maxZ);
            addSpot(sx, sz);
          }
        }

        // 边缘对齐位置：四角和四边中心
        const edgePositions = [
          { x: minX, z: (minZ + maxZ) / 2 },
          { x: maxX, z: (minZ + maxZ) / 2 },
          { x: (minX + maxX) / 2, z: minZ },
          { x: (minX + maxX) / 2, z: maxZ },
          { x: minX, z: minZ },
          { x: maxX, z: minZ },
          { x: minX, z: maxZ },
          { x: maxX, z: maxZ }
        ];
        edgePositions.forEach(pos => {
          addSpot(pos.x, pos.z);
        });
      });

      // 多个支撑物联合表面的候选（两个相邻支撑物之间的位置）
      for (let i = 0; i < supports.length; i++) {
        for (let j = i + 1; j < supports.length; j++) {
          const u = unionRect([rectFor(supports[i]), rectFor(supports[j])]);
          const minX = u.minX + palletDims.width / 2;
          const maxX = u.maxX - palletDims.width / 2;
          const minZ = u.minZ + palletDims.length / 2;
          const maxZ = u.maxZ - palletDims.length / 2;
          if (minX > maxX + 0.001 || minZ > maxZ + 0.001) continue;

          const cx = snap((u.minX + u.maxX) / 2);
          const cz = snap((u.minZ + u.maxZ) / 2);
          addSpot(cx, cz);
        }
      }

      // 将所有连续承托面的边缘，以及当前层已有货物的外边缘，组合成候选点。
      // 这样既能利用多件底货拼出的完整顶面，也能紧贴同层货物继续填充空位。
      const xCandidates = new Set();
      const zCandidates = new Set();
      supports.forEach(support => {
        const rect = rectFor(support);
        [rect.minX + palletDims.width / 2, rect.maxX - palletDims.width / 2]
          .forEach(value => xCandidates.add(Number(value.toFixed(3))));
        [rect.minZ + palletDims.length / 2, rect.maxZ - palletDims.length / 2]
          .forEach(value => zCandidates.add(Number(value.toFixed(3))));
      });
      existing
        .filter(item => Math.abs((item.baseY || 0) - baseY) < 0.005 && item.id !== pallet.id)
        .forEach(item => {
          const rect = rectFor(item);
          [rect.minX - palletDims.width / 2, rect.maxX + palletDims.width / 2]
            .forEach(value => xCandidates.add(Number(value.toFixed(3))));
          [rect.minZ - palletDims.length / 2, rect.maxZ + palletDims.length / 2]
            .forEach(value => zCandidates.add(Number(value.toFixed(3))));
        });
      let combined = 0;
      for (const x of xCandidates) {
        for (const z of zCandidates) {
          addSpot(x, z);
          combined++;
          if (combined >= 6000) break;
        }
        if (combined >= 6000) break;
      }
    });

    return spots
      .map(spot => {
        const candidate = { ...pallet, x: spot.x, z: spot.z, baseY: spot.baseY || 0 };
        if (candidate.baseY + candidate.height > truck.height + 0.001) return null;
        if (isPalletOutsideTruck(candidate, truck)) return null;
        const supports = existing.filter(s => {
          if (s.id === pallet.id) return false;
          const sBox = boxFor(s);
          return Math.abs(sBox.maxY - candidate.baseY) < 0.005 &&
                 rectsOverlap(rectFor(candidate), rectFor(s), 0.02) &&
                 s.stackable;
        });
        if (!coplanarSupportCoverageOk(candidate, supports).ok) return null;
        return spot;
      })
      .filter(Boolean);
  }

  // ---------- 车外放置 ----------

  function outsideTrailerSpot(pallet, existing, truck) {
    const dims = footprint(pallet);
    const overflowItems = existing.filter(item => item.overflow || isPalletOutsideTruck(item, truck));
    const index = overflowItems.length;
    const lane = index % 3;
    const row = Math.floor(index / 3);
    const x = truck.width / 2 + dims.width / 2 + 0.55 + lane * (dims.width + 0.22);
    const z = Math.min(truck.length + dims.length / 2 + 0.35 + row * (dims.length + 0.18), truck.length + 7);
    return {
      x: snap(x),
      z: snap(z),
      baseY: 0,
      rotation: pallet.rotation || 0,
      overflow: true
    };
  }

  // ---------- 评分函数：Front-First ----------

  function scoreFrontFloorPlacement(candidate, existing, truck) {
    const candidateBox = boxFor(candidate);
    const planned = [...existing, candidate];
    const bounds = calculateBoundsForPallets(planned);
    const loadEnd = bounds ? bounds.maxZ : candidateBox.maxZ;
    const frontScore = clampNumber(100 - (loadEnd / Math.max(0.01, truck.length)) * 100, 0, 100);
    const rowScore = clampNumber(100 - (candidateBox.minZ / Math.max(0.01, truck.length)) * 100, 0, 100);
    const leftFillScore = clampNumber(
      100 - ((candidateBox.minX + truck.width / 2) / Math.max(0.01, truck.width)) * 18,
      82, 100
    );
    const xBalanceScore = clampNumber(
      100 - (Math.abs(calculateWeightedLoadCenter(planned).x) / Math.max(0.01, truck.width / 2)) * 100,
      0, 100
    );
    const weightScore = calculateDistributionScore(planned, truck);
    const rotationScore = candidate.rotation === 90 ? 94 : 100;

    return frontScore * 5.6 + rowScore * 1.9 + leftFillScore * 1.2 +
           xBalanceScore * 0.65 + weightScore * 0.55 + rotationScore * 0.35;
  }

  function scoreFrontStackPlacement(candidate, existing, truck) {
    const candidateBox = boxFor(candidate);
    const planned = [...existing, candidate];
    const bounds = calculateBoundsForPallets(planned);
    const loadEnd = bounds ? bounds.maxZ : candidateBox.maxZ;
    const frontScore = clampNumber(100 - (loadEnd / Math.max(0.01, truck.length)) * 100, 0, 100);
    const xBalanceScore = clampNumber(
      100 - (Math.abs(calculateWeightedLoadCenter(planned).x) / Math.max(0.01, truck.width / 2)) * 100,
      0, 100
    );
    const heightScore = clampNumber(
      100 - ((candidate.baseY + candidate.height) / Math.max(0.01, truck.height)) * 100,
      0, 100
    );
    const weightScore = calculateDistributionScore(planned, truck);
    const isRestrictedItem = !candidate.stackable || candidate.doNotStack || candidate.fragile || candidate.adr;
    // 不可堆叠物品堆叠：额外奖励（节省地面空间）
    const restrictedBonus = isRestrictedItem && candidate.baseY > 0.01 ? 80 : 0;

    return frontScore * 3.7 + xBalanceScore * 1.2 + heightScore * 1.2 +
           weightScore * 0.75 + restrictedBonus;
  }

  // ---------- 评分函数：Fit-First ----------

  function cargoContactScore(candidate, existing, truck) {
    const rect = rectFor(candidate);
    let score = 0;
    const sideTolerance = 0.035;

    if (Math.abs(rect.minX + truck.width / 2) <= sideTolerance) score += 2.4;
    if (Math.abs(rect.maxX - truck.width / 2) <= sideTolerance) score += 2.4;
    if (Math.abs(rect.minZ) <= sideTolerance) score += 1.6;

    existing.forEach(item => {
      const other = rectFor(item);
      const zOverlap = rangesNearOrOverlap(rect.minZ, rect.maxZ, other.minZ, other.maxZ, -0.01);
      const xOverlap = rangesNearOrOverlap(rect.minX, rect.maxX, other.minX, other.maxX, -0.01);

      if (zOverlap && Math.abs(rect.minX - other.maxX) <= sideTolerance) score += 1.9;
      if (zOverlap && Math.abs(rect.maxX - other.minX) <= sideTolerance) score += 1.9;
      if (xOverlap && Math.abs(rect.minZ - other.maxZ) <= sideTolerance) score += 1.4;
      if (xOverlap && Math.abs(rect.maxZ - other.minZ) <= sideTolerance) score += 0.7;
    });
    return score;
  }

  // 计算同一行中货物间的间隙总量（仅货物之间，不含墙壁间隙）
  function calculateRowGap(existing, candidate, truck) {
    const cRect = rectFor(candidate);
    const rowItems = existing.filter(p => {
      if ((p.baseY || 0) > 0.01) return false;
      const pDims = footprint(p);
      const pMinZ = p.z - pDims.length / 2;
      const pMaxZ = p.z + pDims.length / 2;
      return cRect.minZ < pMaxZ - 0.01 && cRect.maxZ > pMinZ + 0.01;
    }).map(p => rectFor(p));
    rowItems.push(cRect);
    rowItems.sort((a, b) => a.minX - b.minX);

    let gap = 0;
    for (let i = 1; i < rowItems.length; i++) {
      const g = rowItems[i].minX - rowItems[i - 1].maxX;
      if (g > 0.001) gap += g;
    }
    return gap;
  }

  // 计算同一行中从左墙到最右边缘的占用宽度（鼓励从左到右紧凑排列）
  function calculateRowPackedWidth(existing, candidate, truck) {
    const cRect = rectFor(candidate);
    const rowItems = existing.filter(p => {
      if ((p.baseY || 0) > 0.01) return false;
      const pDims = footprint(p);
      const pMinZ = p.z - pDims.length / 2;
      const pMaxZ = p.z + pDims.length / 2;
      return cRect.minZ < pMaxZ - 0.01 && cRect.maxZ > pMinZ + 0.01;
    }).map(p => rectFor(p));
    rowItems.push(cRect);
    const rightEdge = Math.max(...rowItems.map(r => r.maxX));
    return rightEdge - (-truck.width / 2);
  }

  // 计算同一x列中货物间z方向的间隙总量（惩罚前后方向空隙）
  function calculateColumnGap(existing, candidate, truck) {
    const cRect = rectFor(candidate);
    const colItems = existing.filter(p => {
      if ((p.baseY || 0) > 0.01) return false;
      const pRect = rectFor(p);
      return cRect.minX < pRect.maxX - 0.01 && cRect.maxX > pRect.minX + 0.01;
    }).map(p => rectFor(p));
    colItems.push(cRect);
    colItems.sort((a, b) => a.minZ - b.minZ);

    let gap = 0;
    for (let i = 1; i < colItems.length; i++) {
      const g = colItems[i].minZ - colItems[i - 1].maxZ;
      if (g > 0.001) gap += g;
    }
    return gap;
  }

  function scoreFitFirstPlacement(candidate, existing, truck) {
    const candidateBox = boxFor(candidate);
    const planned = [...existing, candidate];
    const bounds = calculateBoundsForPallets(planned);
    const loadEnd = bounds ? bounds.maxZ : candidateBox.maxZ;
    const loadSpan = bounds ? Math.max(0, bounds.maxZ - bounds.minZ) : candidateBox.maxZ - candidateBox.minZ;
    const weightedCenter = calculateWeightedLoadCenter(planned);

    const fitScore = (truck.length - loadEnd) * 260;
    const spanScore = (truck.length - loadSpan) * 160;
    const frontScore = (truck.length - candidateBox.minZ) * 28;
    const contactScore = cargoContactScore(candidate, existing, truck) * 42;
    const balanceScore = calculateDistributionScore(planned, truck) * 2.1;
    const xBalanceScore = clampNumber(
      100 - (Math.abs(weightedCenter.x) / Math.max(0.01, truck.width / 2)) * 100,
      0, 100
    ) * 1.2;
    const isRestrictedItem = !candidate.stackable || candidate.doNotStack || candidate.fragile || candidate.adr;
    const isStacked = candidate.baseY > 0.01;
    // 不可堆叠物品堆叠：高奖励（节省地面空间）
    // 可堆叠物品堆叠：低奖励（地面优先当底座）
    const stackScore = isStacked ? (isRestrictedItem ? 300 : 92) : 74;
    const floorSafetyScore = isStacked ? (isRestrictedItem ? 80 : 42) : 100;
    const restrictedPenalty = 0;

    return fitScore + spanScore + frontScore + contactScore +
           balanceScore + xBalanceScore + stackScore +
           floorSafetyScore - restrictedPenalty;
  }

  // ---------- Front-First 放置算法 ----------

  function shouldTryStackBeforeFloor(pallet, existing, truck) {
    if (pallet.loadLast) return false;

    const isStackableItem = pallet.stackable && !pallet.doNotStack && !pallet.fragile && !pallet.adr;
    const hasStackableOnFloor = existing.some(p =>
      p.stackable && (p.baseY || 0) < 0.01 && !isPalletOutsideTruck(p, truck));

    if (isStackableItem) {
      // 可堆叠物品：地面使用率低时优先地面当底座
      const floorUsage = calculateFloorUsageForPallets(existing, truck);
      if (floorUsage < 58) return false;
      return true;
    } else {
      // 不可堆叠/易碎/危险品：有可堆叠底座时优先堆叠
      if (hasStackableOnFloor) {
        const topFloor = existing.filter(p => (p.baseY || 0) < 0.01 && !p.overflow)
          .reduce((max, p) => Math.max(max, p.height), 0);
        if (topFloor + pallet.height <= truck.height + 0.001) return true;
      }
      // 无底座时放地面
      return false;
    }
  }

  function findFrontFloorSpot(pallet, existing, truck) {
    const candidates = [];
    const seen = new Set();

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };
      collectFloorSpotCandidates(rotated, existing, truck).forEach(spot => {
        const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: 0 };
        clampPallet(candidate, truck);
        const key = `${candidate.rotation || 0}:${candidate.x.toFixed(3)}:${candidate.z.toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;
        candidates.push({
          x: candidate.x, z: candidate.z, baseY: 0,
          rotation: candidate.rotation || 0,
          score: scoreFrontFloorPlacement(candidate, existing, truck)
        });
      });
    });
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function findFrontStackSpot(pallet, existing, truck) {
    const candidates = [];
    const seen = new Set();

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };
      collectStackSpotCandidates(rotated, existing, truck).forEach(spot => {
        const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: spot.baseY || 0 };
        clampPallet(candidate, truck);
        const key = [candidate.rotation || 0, candidate.x.toFixed(3),
                     candidate.z.toFixed(3), candidate.baseY.toFixed(3)].join(':');
        if (seen.has(key)) return;
        seen.add(key);
        if (candidate.baseY + candidate.height > truck.height + 0.001) return;
        if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;
        candidates.push({
          x: candidate.x, z: candidate.z, baseY: candidate.baseY,
          rotation: candidate.rotation || 0,
          score: scoreFrontStackPlacement(candidate, existing, truck)
        });
      });
    });
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function findPracticalLoadSpot(pallet, existing, truck) {
    if (shouldTryStackBeforeFloor(pallet, existing, truck)) {
      return findFrontStackSpot(pallet, existing, truck) || findFrontFloorSpot(pallet, existing, truck);
    }
    return findFrontFloorSpot(pallet, existing, truck) || findFrontStackSpot(pallet, existing, truck);
  }

  // ---------- Fit-First 放置算法 ----------

  function shouldForceFloorForFitFirst(pallet, existing, truck) {
    if (pallet.loadLast) return true;

    const isStackableItem = pallet.stackable && !pallet.doNotStack && !pallet.fragile && !pallet.adr;

    // 可堆叠物品：地面使用率低于阈值时强制地面（先铺底座）
    if (isStackableItem) {
      const floorUsage = calculateFloorUsageForPallets(existing, truck);
      if (floorUsage < 82) return true;
      return false;
    }

    // 不可堆叠/易碎/危险品：有可堆叠底座时优先堆叠
    const hasStackableOnFloor = existing.some(p =>
      p.stackable && (p.baseY || 0) < 0.01 && !isPalletOutsideTruck(p, truck));
    if (hasStackableOnFloor) {
      const topFloor = existing.filter(p => (p.baseY || 0) < 0.01 && !p.overflow)
        .reduce((max, p) => Math.max(max, p.height), 0);
      if (topFloor + pallet.height <= truck.height + 0.001) return false;
    }

    // 无底座或高度不够时放地面
    return true;
  }

  function addFitFirstCandidate(candidates, seen, pallet, existing, spot, truck) {
    const candidate = {
      ...pallet,
      x: spot.x, z: spot.z, baseY: spot.baseY || 0
    };
    clampPallet(candidate, truck);

    const key = [
      candidate.rotation || 0,
      candidate.x.toFixed(3),
      candidate.z.toFixed(3),
      candidate.baseY.toFixed(3)
    ].join(':');

    if (seen.has(key)) return;
    seen.add(key);
    if (candidate.baseY + candidate.height > truck.height + 0.001) return;
    if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;

    candidates.push({
      x: candidate.x, z: candidate.z, baseY: candidate.baseY,
      rotation: candidate.rotation || 0,
      score: scoreFitFirstPlacement(candidate, existing, truck)
    });
  }

  function collectFitFirstPlacementCandidates(pallet, existing, truck, options = {}) {
    const candidates = [];
    const seen = new Set();
    const includeFloor = options.includeFloor !== false;
    const includeStack = options.includeStack !== false;

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };
      if (includeFloor) {
        collectFloorSpotCandidates(rotated, existing, truck, { dense: true, clearance: RECOVERY_CLEARANCE })
          .forEach(spot => addFitFirstCandidate(candidates, seen, rotated, existing, spot, truck));
      }
      if (includeStack) {
        collectStackSpotCandidates(rotated, existing, truck)
          .forEach(spot => addFitFirstCandidate(candidates, seen, rotated, existing, spot, truck));
      }
    });
    return candidates.sort((a, b) => b.score - a.score);
  }

  function findFitFirstLoadSpot(pallet, existing, truck) {
    const floorCandidates = collectFitFirstPlacementCandidates(pallet, existing, truck, { includeStack: false });
    const stackCandidates = collectFitFirstPlacementCandidates(pallet, existing, truck, { includeFloor: false });
    const floorUsage = calculateFloorUsageForPallets(existing, truck);

    if (floorCandidates.length && shouldForceFloorForFitFirst(pallet, existing, truck)) {
        return floorCandidates[0];
    }
    const candidates = [...floorCandidates, ...stackCandidates].sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  // ---------- 紧凑地面排列：优先不旋转填满宽度，再堆叠 ----------
  function findCompactFloorSpot(pallet, existing, truck) {
    const candidates = [];
    const seen = new Set();

    // 优先尝试不旋转（rotation=0）的地面位置
    const rotations = [0, 90];
    for (const rotation of rotations) {
      const rotated = { ...pallet, rotation };
      const dims = footprint(rotated);
      if (dims.width > truck.width + 0.001) continue;

      collectFloorSpotCandidates(rotated, existing, truck, { dense: true, clearance: RECOVERY_CLEARANCE })
        .forEach(spot => {
          const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: 0 };
          clampPallet(candidate, truck);
          const key = [candidate.rotation, candidate.x.toFixed(3), candidate.z.toFixed(3)].join(':');
          if (seen.has(key)) return;
          seen.add(key);
          if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;

          const planned = [...existing, candidate];
          const bounds = calculateBoundsForPallets(planned);
          const loadEnd = bounds ? bounds.maxZ : candidate.x + dims.length / 2;
          const loadSpan = bounds ? Math.max(0, bounds.maxZ - bounds.minZ) : dims.length;
          const contact = cargoContactScore(candidate, existing, truck);
          const rowGap = calculateRowGap(existing, candidate, truck);
          const colGap = calculateColumnGap(existing, candidate, truck);
          const packedWidth = calculateRowPackedWidth(existing, candidate, truck);
          // 紧凑评分：不旋转优先 + 接触（高权重）+ 间隙惩罚 + 低loadEnd + 紧凑宽度
          const rotationBonus = rotation === 0 ? 800 : 0;
          const score = rotationBonus + contact * 50 + (truck.length - loadEnd) * 80 +
                        (truck.length - loadSpan) * 120 - rowGap * 500 - colGap * 400 - packedWidth * 350;
          candidates.push({
            x: candidate.x, z: candidate.z, baseY: 0,
            rotation: candidate.rotation,
            score
          });
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function findCompactLoadSpot(pallet, existing, truck) {
    const candidates = [];
    const seen = new Set();

    // 收集所有地面和堆叠候选，统一评分
    const rotations = [0, 90];
    for (const rotation of rotations) {
      const rotated = { ...pallet, rotation };
      const dims = footprint(rotated);
      if (dims.width > truck.width + 0.001) continue;

      // 地面候选
      collectFloorSpotCandidates(rotated, existing, truck, { dense: true, clearance: RECOVERY_CLEARANCE })
        .forEach(spot => {
          const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: 0 };
          clampPallet(candidate, truck);
          const key = [candidate.rotation, candidate.x.toFixed(3), candidate.z.toFixed(3), '0'].join(':');
          if (seen.has(key)) return;
          seen.add(key);
          if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;

          const score = scoreCompactPlacement(candidate, existing, truck);
          candidates.push({
            x: candidate.x, z: candidate.z, baseY: 0,
            rotation: candidate.rotation,
            score
          });
        });

      // 堆叠候选（不可堆叠物品也可放在可堆叠物品上方）
      collectStackSpotCandidates(rotated, existing, truck)
        .forEach(spot => {
          const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: spot.baseY || 0 };
          clampPallet(candidate, truck);
          const key = [candidate.rotation, candidate.x.toFixed(3), candidate.z.toFixed(3), candidate.baseY.toFixed(3)].join(':');
          if (seen.has(key)) return;
          seen.add(key);
          if (candidate.baseY + candidate.height > truck.height + 0.001) return;
          if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;

          const score = scoreCompactPlacement(candidate, existing, truck);
          candidates.push({
            x: candidate.x, z: candidate.z, baseY: candidate.baseY,
            rotation: candidate.rotation,
            score
          });
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length > 0) return candidates[0];

    // 没有可行位置，返回车外
    return outsideTrailerSpot(pallet, existing, truck);
  }

  // 紧凑放置评分：核心目标是最小化地面占用长度
  function scoreCompactPlacement(candidate, existing, truck) {
    const planned = [...existing, candidate];
    const bounds = calculateBoundsForPallets(planned);
    const loadEnd = bounds ? bounds.maxZ : 0;
    const loadSpan = bounds ? Math.max(0, bounds.maxZ - bounds.minZ) : 0;
    const contact = cargoContactScore(candidate, existing, truck);
    const rowGap = calculateRowGap(existing, candidate, truck);
    const colGap = calculateColumnGap(existing, candidate, truck);
    const packedWidth = calculateRowPackedWidth(existing, candidate, truck);
    const isStacked = candidate.baseY > 0.01;

    // 堆叠加分：不可堆叠物品堆叠奖励很高（节省地面）
    // 可堆叠物品：地面有空间时不堆叠（先铺底座），地面满了才堆叠
    const isStackableItem = candidate.stackable && !candidate.doNotStack && !candidate.fragile && !candidate.adr;
    const floorUsage = calculateFloorUsageForPallets(existing, truck);
    let stackBonus = 0;
    if (isStacked) {
      if (isStackableItem) {
        // 可堆叠物品：地面使用率 > 80% 才给堆叠奖励（允许堆叠）
        // 地面使用率低时给负分，强制地面
        stackBonus = floorUsage > 80 ? 400 : -1000;
      } else {
        // 不可堆叠物品：高奖励，优先堆叠
        stackBonus = 1500;
      }
    }
    // 不旋转加分（保持尺寸一致）
    const rotationBonus = candidate.rotation === 0 ? 200 : 0;

    // 核心：最小化占用长度（loadSpan权重最高）
    // packedWidth惩罚降低：填满一行宽度是好事，不是坏事
    // 只有当行内有间隙时才惩罚（rowGap/colGap已经管了）
    return stackBonus + rotationBonus + contact * 60 +
           (truck.length - loadEnd) * 120 + (truck.length - loadSpan) * 250 -
           rowGap * 600 - colGap * 500 - packedWidth * 100;
  }

  // ---------- Dense Recovery 放置算法 ----------

  function findDenseRecoverySpot(pallet, existing, truck) {
    const candidates = [];
    const seen = new Set();

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };
      collectFloorSpotCandidates(rotated, existing, truck, { dense: true, clearance: RECOVERY_CLEARANCE })
        .forEach(spot => addDenseRecoveryCandidate(candidates, seen, rotated, existing, spot, truck));
      collectStackSpotCandidates(rotated, existing, truck)
        .forEach(spot => addDenseRecoveryCandidate(candidates, seen, rotated, existing, spot, truck));
    });

    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function addDenseRecoveryCandidate(candidates, seen, pallet, existing, spot, truck) {
    const candidate = {
      ...pallet,
      x: spot.x, z: spot.z, baseY: spot.baseY || 0
    };
    clampPallet(candidate, truck);

    const key = [
      candidate.rotation || 0,
      candidate.x.toFixed(3),
      candidate.z.toFixed(3),
      (candidate.baseY || 0).toFixed(3)
    ].join(':');

    if (seen.has(key)) return;
    seen.add(key);
    if (candidate.baseY + candidate.height > truck.height + 0.001) return;
    if (placementConflicts(candidate, existing, truck, RECOVERY_CLEARANCE)) return;

    candidates.push({
      x: candidate.x, z: candidate.z, baseY: candidate.baseY,
      rotation: candidate.rotation || 0,
      score: scoreDenseRecoveryPlacement(candidate, existing, truck)
    });
  }

  function scoreDenseRecoveryPlacement(candidate, existing, truck) {
    const candidateBox = boxFor(candidate);
    const planned = [...existing, candidate];
    const bounds = calculateBoundsForPallets(planned);
    const supportPoints = loadSupportPositions(truck);
    const preferredZ = supportPoints.length >= 2
      ? (supportPoints[0].z + supportPoints[supportPoints.length - 1].z) / 2
      : truck.length * 0.5;
    const loadEnd = bounds ? bounds.maxZ : candidateBox.maxZ;
    const weightedCenter = calculateWeightedLoadCenter(planned);
    const balanceScore = calculateDistributionScore(planned, truck);
    const compactScore = clampNumber(100 - (loadEnd / Math.max(0.01, truck.length)) * 100, 0, 100);
    const centerScore = clampNumber(
      100 - (Math.abs(weightedCenter.x) / Math.max(0.01, truck.width / 2)) * 100,
      0, 100
    );
    const targetScore = clampNumber(
      100 - (Math.abs(weightedCenter.z - preferredZ) / Math.max(0.01, truck.length * 0.42)) * 100,
      0, 100
    );
    const headboardScore = clampNumber(
      100 - (candidateBox.maxZ / Math.max(0.01, truck.length)) * 100,
      0, 100
    );
    const floorBonus = candidate.baseY > 0.01 ? 0 : 18;
    const isRestrictedItem = !candidate.stackable || candidate.doNotStack || candidate.fragile || candidate.adr;
    // 不可堆叠物品堆叠：额外奖励（节省地面空间）
    const stackBonus = candidate.baseY > 0.01 && isRestrictedItem ? 60 : 0;

    return compactScore * 2.4 + balanceScore * 1.65 + centerScore * 1.15 +
           targetScore + headboardScore * 1.25 + floorBonus + stackBonus;
  }

  // ---------- 应用放置 ----------

  function applyPlacement(pallet, spot) {
    if (!spot) return;
    if (typeof spot.rotation === 'number') pallet.rotation = spot.rotation;
    pallet.x = spot.x;
    pallet.z = spot.z;
    pallet.baseY = spot.baseY || 0;
    pallet.overflow = Boolean(spot.overflow);
  }

  // ---------- 排序策略 ----------

  function baseRiskOrder(a, b) {
    return Number(Boolean(a.doNotStack || a.fragile || a.adr)) -
           Number(Boolean(b.doNotStack || b.fragile || b.adr));
  }

  function compareCargoForFitFirstOptimization(a, b) {
    const accessOrder =
      Number(Boolean(a.loadLast)) - Number(Boolean(b.loadLast)) ||
      (Number(b.deliverySequence) || 0) - (Number(a.deliverySequence) || 0);
    if (accessOrder) return accessOrder;

    const supportOrder =
      Number(Boolean(b.stackable && !b.doNotStack && !b.fragile && !b.adr)) -
      Number(Boolean(a.stackable && !a.doNotStack && !a.fragile && !a.adr));
    if (supportOrder) return supportOrder;

    const restrictedOrder =
      Number(Boolean(b.doNotStack || b.fragile || b.adr)) -
      Number(Boolean(a.doNotStack || a.fragile || a.adr));
    if (restrictedOrder) return restrictedOrder;

    const areaOrder = b.length * b.width - a.length * a.width;
    if (areaOrder) return areaOrder;

    const weightOrder = b.weight - a.weight;
    if (weightOrder) return weightOrder;

    return a.height - b.height;
  }

  function compareCargoForBalancedOptimization(a, b) {
    const restrictedOrder =
      Number(Boolean(a.doNotStack || a.fragile || a.adr)) -
      Number(Boolean(b.doNotStack || b.fragile || b.adr));
    if (restrictedOrder) return restrictedOrder;

    const accessOrder =
      Number(Boolean(a.loadLast)) - Number(Boolean(b.loadLast)) ||
      (Number(b.deliverySequence) || 0) - (Number(a.deliverySequence) || 0);
    if (accessOrder) return accessOrder;

    const dropOrder = String(b.group || '').localeCompare(String(a.group || ''));
    if (dropOrder) return dropOrder;

    const floorOrder = b.length * b.width - a.length * a.width;
    if (floorOrder) return floorOrder;

    const weightOrder = b.weight - a.weight;
    if (weightOrder) return weightOrder;

    return b.height - a.height;
  }

  function stableSort(pallets, comparator) {
    return pallets
      .map((pallet, index) => ({ pallet, index }))
      .sort((a, b) => comparator(a.pallet, b.pallet) || a.index - b.index)
      .map(item => item.pallet);
  }

  function buildOptimizationStrategies(pallets, truck) {
    return [
      {
        name: '最合适优先',
        arrange: 'fitFirst',
        sorted: stableSort(pallets, compareCargoForFitFirstOptimization)
      },
      {
        name: '重货优先',
        arrange: 'fitFirst',
        sorted: stableSort(pallets, (a, b) =>
          Number(Boolean(a.loadLast)) - Number(Boolean(b.loadLast)) ||
          b.weight - a.weight ||
          b.length * b.width - a.length * a.width
        )
      },
      {
        name: '矮货优先',
        arrange: 'fitFirst',
        sorted: stableSort(pallets, (a, b) =>
          Number(Boolean(a.loadLast)) - Number(Boolean(b.loadLast)) ||
          a.height - b.height ||
          b.length * b.width - a.length * a.width
        )
      },
      {
        name: '平衡优化',
        arrange: 'denseRecovery',
        sorted: stableSort(pallets, compareCargoForBalancedOptimization)
      },
      {
        name: '底面积优先',
        arrange: 'denseRecovery',
        sorted: stableSort(pallets, (a, b) =>
          baseRiskOrder(a, b) ||
          b.length * b.width - a.length * a.width ||
          b.weight - a.weight
        )
      },
      {
        name: '重量优先',
        arrange: 'denseRecovery',
        sorted: stableSort(pallets, (a, b) =>
          baseRiskOrder(a, b) ||
          b.weight - a.weight ||
          b.length * b.width - a.length * a.width
        )
      },
      {
        name: '体积优先',
        arrange: 'denseRecovery',
        sorted: stableSort(pallets, (a, b) =>
          baseRiskOrder(a, b) ||
          b.length * b.width * b.height - a.length * a.width * a.height ||
          b.weight - a.weight
        )
      },
      {
        name: '高度优先',
        arrange: 'denseRecovery',
        sorted: stableSort(pallets, (a, b) =>
          baseRiskOrder(a, b) ||
          a.height - b.height ||
          b.length * b.width - a.length * a.width
        )
      }
    ];
  }

  // ---------- 排列函数 ----------

  function arrangeCargo(sortedPallets, truck, mode = 'frontFirst') {
    const planned = [];
    sortedPallets.forEach(pallet => {
      pallet.baseY = 0;
      pallet.overflow = false;
    });

    sortedPallets.forEach(pallet => {
      let spot;
      if (mode === 'fitFirst') {
        spot = findFitFirstLoadSpot(pallet, planned, truck);
      } else if (mode === 'denseRecovery') {
        spot = findPracticalLoadSpot(pallet, planned, truck) ||
               findDenseRecoverySpot(pallet, planned, truck);
      } else {
        spot = findPracticalLoadSpot(pallet, planned, truck);
      }
      if (!spot) spot = outsideTrailerSpot(pallet, planned, truck);
      applyPlacement(pallet, spot);
      planned.push(pallet);
    });
    return planned;
  }

  // ---------- 重叠检测与修复 ----------

  function findOverlapPair(pallets, truck) {
    for (let i = 0; i < pallets.length; i++) {
      for (let j = i + 1; j < pallets.length; j++) {
        if (boxesConflict(boxFor(pallets[i]), boxFor(pallets[j]), PLACEMENT_CLEARANCE, OVERLAP_TOLERANCE)) {
          return [pallets[i], pallets[j]];
        }
      }
    }
    return null;
  }

  function countOverflowPallets(pallets, truck) {
    return pallets.filter(p => isPalletOutsideTruck(p, truck)).length;
  }

  function resolveRemainingOverlaps(pallets, truck, maxPasses = OVERLAP_RESOLVE_PASSES) {
    for (let pass = 0; pass < maxPasses; pass++) {
      const pair = findOverlapPair(pallets, truck);
      if (!pair) break;

      const [a, b] = pair;
      const existing = pallets.filter(p => p.id !== b.id);
      const spot = findPracticalLoadSpot(b, existing, truck) ||
                   findDenseRecoverySpot(b, existing, truck);
      if (spot) {
        applyPlacement(b, spot);
      } else {
        const overflowSpot = outsideTrailerSpot(b, existing, truck);
        applyPlacement(b, overflowSpot);
      }

      if (!findOverlapPair(pallets, truck)) break;
    }
  }

  // 检查单个货物是否与其他货物重叠
  function hasPalletOverlap(pallet, existing, truck) {
    const others = existing.filter(p => p.id !== pallet.id);
    for (const other of others) {
      if (boxesConflict(boxFor(pallet), boxFor(other), PLACEMENT_CLEARANCE, OVERLAP_TOLERANCE)) {
        return true;
      }
    }
    return false;
  }

  // 单个货物重叠自动弹开到旁边空闲位置
  function resolvePalletOverlap(pallet, existing, truck) {
    if (!hasPalletOverlap(pallet, existing, truck)) return false;

    const others = existing.filter(p => p.id !== pallet.id);
    const stackFirst = shouldTryStackBeforeFloor(pallet, others, truck);

    if (stackFirst) {
      // 优先堆叠（不可堆叠物品、或地面使用率高的可堆叠物品）
      // 1. 就近堆叠搜索
      const nearStackSpot = findNearbyStackSpot(pallet, others, truck);
      if (nearStackSpot) {
        applyPlacement(pallet, nearStackSpot);
        return true;
      }
      // 2. 全局堆叠搜索
      const stackSpot = findFrontStackSpot(pallet, others, truck);
      if (stackSpot) {
        applyPlacement(pallet, stackSpot);
        return true;
      }
      // 3. 就近地面搜索
      const nearSpot = findNearbyFloorSpot(pallet, others, truck);
      if (nearSpot) {
        applyPlacement(pallet, nearSpot);
        return true;
      }
      // 4. 全局地面搜索
      const floorSpot = findFrontFloorSpot(pallet, others, truck) ||
                        findDenseRecoverySpot(pallet, others, truck);
      if (floorSpot) {
        applyPlacement(pallet, floorSpot);
        return true;
      }
    } else {
      // 优先地面（可堆叠物品且地面使用率低）
      // 1. 就近地面搜索：从当前位置向外螺旋搜索
      const nearSpot = findNearbyFloorSpot(pallet, others, truck);
      if (nearSpot) {
        applyPlacement(pallet, nearSpot);
        return true;
      }
      // 2. 全局搜索最佳地面位置
      const floorSpot = findFrontFloorSpot(pallet, others, truck) ||
                        findDenseRecoverySpot(pallet, others, truck);
      if (floorSpot) {
        applyPlacement(pallet, floorSpot);
        return true;
      }
      // 3. 堆叠兜底
      const stackSpot = findFrontStackSpot(pallet, others, truck);
      if (stackSpot) {
        applyPlacement(pallet, stackSpot);
        return true;
      }
    }

    // 最后兜底：放到车外
    const overflowSpot = outsideTrailerSpot(pallet, others, truck);
    applyPlacement(pallet, overflowSpot);
    return true;
  }

  // 在当前位置附近搜索堆叠位置
  function findNearbyStackSpot(pallet, existing, truck) {
    const best = { spot: null, dist: Infinity };
    const origX = pallet.x;
    const origZ = pallet.z;
    const maxDist = 2.0;

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };

      // 遍历所有可堆叠物品的顶部
      existing.forEach(support => {
        if (!support.stackable || support.overflow) return;
        const supportTop = (support.baseY || 0) + support.height;
        if (supportTop + rotated.height > truck.height + 0.001) return;

        // 在支撑物顶部生成候选位置（中心 + 边缘对齐）
        const candidates = collectStackSpotCandidatesOnSupport(rotated, support, truck);
        candidates.forEach(spot => {
          const candidate = { ...rotated, x: spot.x, z: spot.z, baseY: supportTop };
          const dist = Math.abs(candidate.x - origX) + Math.abs(candidate.z - origZ);
          if (dist > maxDist) return;
          if (placementConflicts(candidate, existing, truck, PLACEMENT_CLEARANCE)) return;

          if (dist < best.dist) {
            best.dist = dist;
            best.spot = { x: candidate.x, z: candidate.z, baseY: supportTop, rotation: candidate.rotation || 0 };
          }
        });
      });
    });

    return best.spot;
  }

  // 在单个支撑物顶部生成候选堆叠位置
  function collectStackSpotCandidatesOnSupport(pallet, support, truck) {
    const spots = [];
    const halfL = pallet.length / 2;
    const halfW = pallet.width / 2;

    const sMinX = (support.x || 0) - support.width / 2;
    const sMaxX = (support.x || 0) + support.width / 2;
    const sMinZ = (support.z || 0) - support.length / 2;
    const sMaxZ = (support.z || 0) + support.length / 2;

    // 中心
    spots.push({ x: support.x, z: support.z });

    // 四角对齐
    spots.push({ x: sMinX + halfW, z: sMinZ + halfL });
    spots.push({ x: sMaxX - halfW, z: sMinZ + halfL });
    spots.push({ x: sMinX + halfW, z: sMaxZ - halfL });
    spots.push({ x: sMaxX - halfW, z: sMaxZ - halfL });

    // 边中点
    spots.push({ x: support.x, z: sMinZ + halfL });
    spots.push({ x: support.x, z: sMaxZ - halfL });
    spots.push({ x: sMinX + halfW, z: support.z });
    spots.push({ x: sMaxX - halfW, z: support.z });

    return spots;
  }

  // 最优放置：尝试多种策略，选综合评分最高的位置
  function findOptimalLoadSpot(pallet, existing, truck) {
    const candidates = [];
    const others = existing.filter(p => p.id !== pallet.id);

    // 策略1：front-first 地面
    const frontFloor = findFrontFloorSpot(pallet, others, truck);
    if (frontFloor) {
      const score = evaluatePlacementScore(pallet, { ...frontFloor }, others, truck);
      candidates.push({ spot: frontFloor, score, strategy: 'frontFloor' });
    }

    // 策略2：front-first 堆叠
    const frontStack = findFrontStackSpot(pallet, others, truck);
    if (frontStack) {
      const score = evaluatePlacementScore(pallet, { ...frontStack }, others, truck);
      candidates.push({ spot: frontStack, score, strategy: 'frontStack' });
    }

    // 策略3：fit-first
    const fitFirst = findFitFirstLoadSpot(pallet, others, truck);
    if (fitFirst) {
      const score = evaluatePlacementScore(pallet, { ...fitFirst }, others, truck);
      candidates.push({ spot: fitFirst, score, strategy: 'fitFirst' });
    }

    // 策略4：dense recovery
    const dense = findDenseRecoverySpot(pallet, others, truck);
    if (dense) {
      const score = evaluatePlacementScore(pallet, { ...dense }, others, truck);
      candidates.push({ spot: dense, score, strategy: 'denseRecovery' });
    }

    if (candidates.length === 0) return null;

    // 按综合评分降序，取最高
    candidates.sort((a, b) => b.score.overall - a.score.overall);
    return candidates[0].spot;
  }

  // 评估放置后的综合评分（用于比较不同位置）
  function evaluatePlacementScore(pallet, placement, existing, truck) {
    const testPallet = { ...pallet, ...placement };
    const testPallets = [...existing.filter(p => p.id !== pallet.id), testPallet];
    return calculateOptimizationBreakdown(testPallets, truck);
  }

  // 在当前位置附近搜索空闲地面位置（螺旋式向外）
  function findNearbyFloorSpot(pallet, existing, truck) {
    const step = 0.05;
    const maxRadius = 2.0;
    const best = { spot: null, dist: Infinity };

    const origX = pallet.x;
    const origZ = pallet.z;

    candidateRotations(pallet).forEach(rotation => {
      const rotated = { ...pallet, rotation };
      const halfL = rotated.length / 2;
      const halfW = rotated.width / 2;

      for (let r = 0; r <= maxRadius; r += step) {
        if (r === 0) {
          const candidate = { ...rotated, x: origX, z: origZ, baseY: 0 };
          clampPallet(candidate, truck);
          if (!placementConflicts(candidate, existing, truck, PLACEMENT_CLEARANCE)) {
            const dist = Math.abs(candidate.x - origX) + Math.abs(candidate.z - origZ);
            if (dist < best.dist) {
              best.dist = dist;
              best.spot = { x: candidate.x, z: candidate.z, baseY: 0, rotation: candidate.rotation || 0 };
            }
          }
          continue;
        }

        const dirs = [
          [0, r], [0, -r], [r, 0], [-r, 0],
          [r, r], [r, -r], [-r, r], [-r, -r]
        ];

        for (const [dx, dz] of dirs) {
          const candidate = { ...rotated, x: origX + dx, z: origZ + dz, baseY: 0 };
          clampPallet(candidate, truck);
          if (candidate.x - halfW < -truck.width / 2 - 0.001) continue;
          if (candidate.x + halfW > truck.width / 2 + 0.001) continue;
          if (candidate.z - halfL < -0.001) continue;
          if (candidate.z + halfL > truck.length + 0.001) continue;

          if (!placementConflicts(candidate, existing, truck, PLACEMENT_CLEARANCE)) {
            const dist = Math.abs(candidate.x - origX) + Math.abs(candidate.z - origZ);
            if (dist < best.dist) {
              best.dist = dist;
              best.spot = { x: candidate.x, z: candidate.z, baseY: 0, rotation: candidate.rotation || 0 };
            }
          }
        }

        if (best.spot && best.dist <= r + step * 0.5) break;
      }
    });

    return best.spot;
  }

  // ---------- 堆叠修复 ----------

  function repairUnsupportedStacks(pallets, truck) {
    const stacked = pallets
      .filter(p => (p.baseY || 0) > 0.01)
      .sort((a, b) => (a.baseY || 0) - (b.baseY || 0));

    stacked.forEach(pallet => {
      const supports = getStackSupports(pallet, pallets).filter(s => s.stackable);
      const supported = pallet.stackable && supports.length &&
                        supportCoverageOk(pallet, supports).ok;

      if (supported && pallet.baseY + pallet.height <= truck.height + 0.001) return;

      const existing = pallets.filter(p => p.id !== pallet.id);
      const stackSpot = findFrontStackSpot(pallet, existing, truck);
      const floorSpot = findFrontFloorSpot(pallet, existing, truck);
      const spot = stackSpot || floorSpot;
      if (spot) applyPlacement(pallet, spot);
    });
  }

  // ---------- 溢出恢复 ----------

  function recoverOptimizerOverflow(sortedPallets, truck) {
    const overflowBefore = countOverflowPallets(sortedPallets, truck);
    if (!overflowBefore) return false;

    const beforeMap = capturePlacementMap(sortedPallets);
    arrangeCargo(sortedPallets.map(p => ({ ...p })), truck, 'denseRecovery');

    const overflowAfter = countOverflowPallets(sortedPallets, truck);
    const hasOverlapAfter = Boolean(findOverlapPair(sortedPallets, truck));

    if (hasOverlapAfter || overflowAfter >= overflowBefore) {
      restorePlacementMap(sortedPallets, beforeMap);
      return false;
    }

    repairUnsupportedStacks(sortedPallets, truck);
    resolveRemainingOverlaps(sortedPallets, truck, 8);

    if (findOverlapPair(sortedPallets, truck) ||
        countOverflowPallets(sortedPallets, truck) > overflowAfter) {
      restorePlacementMap(sortedPallets, beforeMap);
      return false;
    }
    return countOverflowPallets(sortedPallets, truck) < overflowBefore;
  }

  // ---------- 布局快照 ----------

  function capturePlacementMap(pallets) {
    return new Map(pallets.map(pallet => [
      pallet.id,
      {
        x: pallet.x, z: pallet.z, baseY: pallet.baseY || 0,
        rotation: pallet.rotation || 0, overflow: Boolean(pallet.overflow)
      }
    ]));
  }

  function restorePlacementMap(pallets, map) {
    pallets.forEach(pallet => {
      const placement = map.get(pallet.id);
      if (!placement) return;
      pallet.x = placement.x;
      pallet.z = placement.z;
      pallet.baseY = placement.baseY;
      pallet.rotation = placement.rotation;
      pallet.overflow = placement.overflow;
    });
  }

  // ---------- 最优方案选择 ----------

  function isBetterCandidate(candidate, current) {
    if (candidate.hasOverlap !== current.hasOverlap) return !candidate.hasOverlap;
    if (candidate.overflowCount !== current.overflowCount) {
      return candidate.overflowCount < current.overflowCount;
    }
    // 优先比较装载米数（地面占用面积/车厢宽度）
    if (Math.abs(candidate.loadingMetres - current.loadingMetres) > 0.05) {
      return candidate.loadingMetres < current.loadingMetres;
    }
    // 再比较实际占用长度
    if (Math.abs(candidate.usedLoadLength - current.usedLoadLength) > 0.05) {
      return candidate.usedLoadLength < current.usedLoadLength;
    }
    if (candidate.overallScore !== current.overallScore) {
      return candidate.overallScore > current.overallScore;
    }
    return candidate.balance > current.balance;
  }

  // ---------- 极点法装箱算法（来自3D装载演示） ----------

  function getOrientations(batch) {
    const seen = new Set();
    const oris = [];
    const perms = [[batch.l, batch.w, batch.h], [batch.w, batch.l, batch.h]];
    for (const ori of perms) {
      const key = ori.join(',');
      if (!seen.has(key)) { seen.add(key); oris.push(ori); }
    }
    return oris;
  }

  function createSpatialHash(truck, cellSize) {
    const cs = cellSize || 50;
    const cells = {};
    return {
      cs,
      add(box, index) {
        const x0 = Math.floor(box.x / cs);
        const y0 = Math.floor(box.y / cs);
        const z0 = Math.floor(box.z / cs);
        const x1 = Math.floor((box.x + box.l - 0.01) / cs);
        const y1 = Math.floor((box.y + box.w - 0.01) / cs);
        const z1 = Math.floor((box.z + box.h - 0.01) / cs);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gy = y0; gy <= y1; gy++) {
            for (let gz = z0; gz <= z1; gz++) {
              const key = gx * 100000 + gy * 1000 + gz;
              if (!cells[key]) cells[key] = [];
              cells[key].push(index);
            }
          }
        }
      },
      checkCollision(x, y, z, l, w, h, placedBoxes) {
        const x0 = Math.floor(x / cs);
        const y0 = Math.floor(y / cs);
        const z0 = Math.floor(z / cs);
        const x1 = Math.floor((x + l - 0.01) / cs);
        const y1 = Math.floor((y + w - 0.01) / cs);
        const z1 = Math.floor((z + h - 0.01) / cs);
        const checked = new Set();
        for (let gx = x0; gx <= x1; gx++) {
          for (let gy = y0; gy <= y1; gy++) {
            for (let gz = z0; gz <= z1; gz++) {
              const list = cells[gx * 100000 + gy * 1000 + gz];
              if (!list) continue;
              for (let i = 0; i < list.length; i++) {
                const bi = list[i];
                if (checked.has(bi)) continue;
                checked.add(bi);
                const box = placedBoxes[bi];
                if (x < box.x + box.l - 0.01 && x + l > box.x + 0.01 &&
                    y < box.y + box.w - 0.01 && y + w > box.y + 0.01 &&
                    z < box.z + box.h - 0.01 && z + h > box.z + 0.01) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      }
    };
  }

  function findAllPositions(truck, placedBoxes, l, w, h, stackable, spatialHash) {
    const points = [];
    const seen = new Set();
    const sh = spatialHash || null;

    function fullyContainedBy(box, x, y, z) {
      const tolerance = 0.5; // 极点算法使用厘米，允许 5mm 数值误差
      return box.stackable &&
        Math.abs((box.z + box.h) - z) <= tolerance &&
        x >= box.x - tolerance && x + l <= box.x + box.l + tolerance &&
        y >= box.y - tolerance && y + w <= box.y + box.w + tolerance;
    }

    function hasFullSupport(x, y, z, supportHint) {
      if (z <= 0.01) return true;
      if (supportHint && fullyContainedBy(supportHint, x, y, z)) return true;
      if (placedBoxes.some(box => box !== supportHint && fullyContainedBy(box, x, y, z))) return true;

      // 同一高度的多个可堆叠货物可以共同形成连续承托面。
      // 用矩形并集验证整个底面，避免候选点只能锁在单个底座中心而产生无意义空隙。
      const tolerance = 0.5;
      const x2 = x + l;
      const y2 = y + w;
      const supports = placedBoxes.filter(box =>
        box.stackable &&
        Math.abs((box.z + box.h) - z) <= tolerance &&
        box.x < x2 - 0.01 && box.x + box.l > x + 0.01 &&
        box.y < y2 - 0.01 && box.y + box.w > y + 0.01
      );
      if (!supports.length) return false;

      const xCuts = [x, x2];
      supports.forEach(box => {
        xCuts.push(Math.max(x, box.x), Math.min(x2, box.x + box.l));
      });
      const cuts = [...new Set(xCuts.map(value => Number(value.toFixed(6))))].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const left = cuts[i];
        const right = cuts[i + 1];
        if (right - left <= 0.001) continue;
        const midX = (left + right) / 2;
        const intervals = supports
          .filter(box => midX >= box.x - tolerance && midX <= box.x + box.l + tolerance)
          .map(box => [Math.max(y, box.y), Math.min(y2, box.y + box.w)])
          .filter(interval => interval[1] > interval[0] + 0.001)
          .sort((a, b) => a[0] - b[0]);
        let coveredTo = y;
        for (const interval of intervals) {
          if (interval[0] > coveredTo + tolerance) break;
          coveredTo = Math.max(coveredTo, interval[1]);
          if (coveredTo >= y2 - tolerance) break;
        }
        if (coveredTo < y2 - tolerance) return false;
      }
      return true;
    }

    function tryAdd(x, y, z, supportHint = null) {
      if (x < -0.01 || x + l > truck.L + 0.01) return;
      if (y < -0.01 || y + w > truck.W + 0.01) return;
      if (z < -0.01 || z + h > truck.H + 0.01) return;
      const key = Math.round(x * 100) + '|' + Math.round(y * 100) + '|' + Math.round(z * 100);
      if (seen.has(key)) return;
      seen.add(key);
      if (!hasFullSupport(x, y, z, supportHint)) return;
      const collides = sh
        ? sh.checkCollision(x, y, z, l, w, h, placedBoxes)
        : checkCollisionLinear(x, y, z, l, w, h, placedBoxes);
      if (!collides) points.push({ x, y, z });
    }

    // 所有货物都可以放在可堆叠承托物上方；stackable 只表示该货物还能否继续承托上层货物。
    tryAdd(0, 0, 0);

    for (let i = 0; i < placedBoxes.length; i++) {
      const box = placedBoxes[i];
      if (box.stackable) {
        const topZ = box.z + box.h;
        if (topZ + h <= truck.H + 0.01) {
          // 完全叠放在 box 上方（覆盖率高）
          tryAdd(box.x, box.y, topZ, box);
          if (l <= box.l) {
            tryAdd(Math.max(0, box.x + box.l - l), box.y, topZ, box);
          }
          if (w <= box.w) {
            tryAdd(box.x, Math.max(0, box.y + box.w - w), topZ, box);
          }
          if (l <= box.l && w <= box.w) {
            tryAdd(Math.max(0, box.x + box.l - l), Math.max(0, box.y + box.w - w), topZ, box);
          }
        }
      }
      // 已有顶层货物的四周也是候选极点。同一平面的货物优先从这些贴边点继续铺排，
      // 不再机械地各自对齐到底座中心，从而消除顶层货物之间可避免的间隙。
      if (box.z > 0.01) {
        tryAdd(box.x + box.l, box.y, box.z);
        tryAdd(box.x - l, box.y, box.z);
        tryAdd(box.x, box.y + box.w, box.z);
        tryAdd(box.x, box.y - w, box.z);
        tryAdd(box.x + box.l, box.y + box.w, box.z);
        tryAdd(box.x - l, box.y + box.w, box.z);
        tryAdd(box.x + box.l, box.y - w, box.z);
        tryAdd(box.x - l, box.y - w, box.z);
      }
      // 地面旁边位置始终保留为合法兜底。
      tryAdd(Math.max(0, box.x + box.l), box.y, 0);
      tryAdd(box.x, Math.max(0, box.y + box.w), 0);
      tryAdd(Math.max(0, box.x + box.l), Math.max(0, box.y + box.w), 0);
    }
    return points;
  }

  function checkCollisionLinear(x, y, z, l, w, h, placedBoxes) {
    for (let i = 0; i < placedBoxes.length; i++) {
      const box = placedBoxes[i];
      if (x < box.x + box.l - 0.01 && x + l > box.x + 0.01 &&
          y < box.y + box.w - 0.01 && y + w > box.y + 0.01 &&
          z < box.z + box.h - 0.01 && z + h > box.z + 0.01) {
        return true;
      }
    }
    return false;
  }

  function floorEnvelopeArea(placedBoxes, candidate = null) {
    const floorBoxes = placedBoxes.filter(box => box.z < 0.01);
    if (candidate && candidate.z < 0.01) floorBoxes.push(candidate);
    if (!floorBoxes.length) return 0;
    const maxX = Math.max(...floorBoxes.map(box => box.x + box.l));
    const maxY = Math.max(...floorBoxes.map(box => box.y + box.w));
    return maxX * maxY;
  }

  function layerCompactScore(boxes, layerZ) {
    const layer = boxes.filter(box => Math.abs(box.z - layerZ) < 0.01);
    if (!layer.length) return 0;
    const minX = Math.min(...layer.map(box => box.x));
    const maxX = Math.max(...layer.map(box => box.x + box.l));
    const minY = Math.min(...layer.map(box => box.y));
    const maxY = Math.max(...layer.map(box => box.y + box.w));
    const envelopeArea = (maxX - minX) * (maxY - minY);
    const coordinateSum = layer.reduce((sum, box) => sum + box.x + box.y, 0);
    return envelopeArea * 1000000 + coordinateSum * 1000 + maxX + maxY;
  }

  // 装箱搜索找到可行解后，再整理最高层货物。可行解搜索重视“全部装入”，
  // 这里负责把同层货物继续向已有空洞收拢，避免找到 FIT 后保留 U 形空白。
  function compactTopLayers(truck, placedBoxes) {
    if (!Array.isArray(placedBoxes) || placedBoxes.length > 250) return placedBoxes;
    const layers = [...new Set(placedBoxes
      .filter(box => box.z > 0.01)
      .map(box => Number(box.z.toFixed(3))))]
      .sort((a, b) => b - a);

    layers.forEach(layerZ => {
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        const movable = placedBoxes
          .filter(box => Math.abs(box.z - layerZ) < 0.01)
          .filter(box => !placedBoxes.some(other =>
            other !== box &&
            Math.abs(other.z - (box.z + box.h)) < 0.01 &&
            other.x < box.x + box.l - 0.01 && other.x + other.l > box.x + 0.01 &&
            other.y < box.y + box.w - 0.01 && other.y + other.w > box.y + 0.01
          ))
          .sort((a, b) => (b.x + b.y) - (a.x + a.y));

        for (const box of movable) {
          const others = placedBoxes.filter(item => item !== box);
          const currentScore = layerCompactScore(placedBoxes, layerZ);
          let best = null;
          let bestScore = currentScore;
          const positions = findAllPositions(truck, others, box.l, box.w, box.h, box.stackable, null)
            .filter(pos => Math.abs(pos.z - layerZ) < 0.01);
          for (const pos of positions) {
            if (Math.abs(pos.x - box.x) < 0.01 && Math.abs(pos.y - box.y) < 0.01) continue;
            const candidate = { ...box, x: pos.x, y: pos.y, z: layerZ };
            const score = layerCompactScore([...others, candidate], layerZ);
            if (score < bestScore - 0.01) {
              bestScore = score;
              best = pos;
            }
          }
          if (best) {
            box.x = best.x;
            box.y = best.y;
            changed = true;
          }
        }
        if (!changed) break;
      }
    });
    return placedBoxes;
  }

  function findPosition(truck, batch, placedBoxes, spatialHash, options = {}) {
    const orientations = getOrientations(batch);
    const candidates = [];
    for (const [l, w, h] of orientations) {
      const positions = findAllPositions(truck, placedBoxes, l, w, h, batch.stackable, spatialHash);
      positions.forEach(pos => {
        if (options.forceFloor && pos.z > 0.01) return;
        candidates.push({ ...pos, l, w, h, stackable: batch.stackable });
      });
    }
    candidates.sort((a, b) => {
      // 所有货物优先使用已有合法顶面；不可堆叠货物占据顶层后不会再承托其他货物。
      if ((a.z > 0.01) !== (b.z > 0.01)) return a.z > 0.01 ? -1 : 1;
      const areaOrder = floorEnvelopeArea(placedBoxes, a) - floorEnvelopeArea(placedBoxes, b);
      if (Math.abs(areaOrder) > 0.01) return areaOrder;
      if (a.x + a.l !== b.x + b.l) return (a.x + a.l) - (b.x + b.l);
      if (a.y + a.w !== b.y + b.w) return (a.y + a.w) - (b.y + b.w);
      if (a.z !== b.z) return b.z - a.z;
      return (a.l * a.w) - (b.l * b.w);
    });
    return candidates[0] || null;
  }

  function greedyPack(truck, batches) {
    const placed = [];
    const sorted = [...batches].sort((a, b) => {
      if (a.stackable !== b.stackable) return a.stackable ? -1 : 1;
      return (b.l * b.w * b.h) - (a.l * a.w * a.h);
    });
    const sh = createSpatialHash(truck, 50);
    const restrictedCount = batches.filter(batch => !batch.stackable).reduce((sum, batch) => sum + batch.q, 0);
    const stackableCount = batches.filter(batch => batch.stackable).reduce((sum, batch) => sum + batch.q, 0);
    const baseSupportsNeeded = Math.min(restrictedCount, stackableCount);
    let stackablePlaced = 0;
    for (const batch of sorted) {
      for (let i = 0; i < batch.q; i++) {
        const pos = findPosition(truck, batch, placed, sh, {
          forceFloor: batch.stackable && stackablePlaced < baseSupportsNeeded
        });
        if (pos) {
          const entry = { ...pos, batchId: batch.id, instanceId: i + 1 };
          placed.push(entry);
          sh.add(entry, placed.length - 1);
          if (batch.stackable) stackablePlaced++;
        }
      }
    }
    return placed;
  }

  function greedyPackEnhanced(truck, batches) {
    const placed = [];
    const sorted = [...batches].sort((a, b) => {
      if (a.stackable !== b.stackable) return a.stackable ? -1 : 1;
      return (b.l * b.w * b.h) - (a.l * a.w * a.h);
    });
    const sh = createSpatialHash(truck, 50);
    const restrictedCount = batches.filter(batch => !batch.stackable).reduce((sum, batch) => sum + batch.q, 0);
    const stackableCount = batches.filter(batch => batch.stackable).reduce((sum, batch) => sum + batch.q, 0);
    const baseSupportsNeeded = Math.min(restrictedCount, stackableCount);
    let stackablePlaced = 0;
    for (const batch of sorted) {
      const orientations = getOrientations(batch);
      for (let i = 0; i < batch.q; i++) {
        let bestPos = null, bestScore = Infinity, bestL = Infinity;
        for (const [l, w, h] of orientations) {
          const positions = findAllPositions(truck, placed, l, w, h, batch.stackable, sh);
          for (const pos of positions) {
            if (batch.stackable && stackablePlaced < baseSupportsNeeded && pos.z > 0.01) continue;
            const verticalScore = pos.z > 0.01 ? -1000000000 - pos.z * 1000 : 0;
            const candidate = { ...pos, l, w, h };
            const score = verticalScore + floorEnvelopeArea(placed, candidate) * 1000000 +
              (pos.x + l) * 1000 + (pos.y + w);
            if (score < bestScore || (score === bestScore && l < bestL)) {
              bestScore = score; bestL = l;
              bestPos = { ...pos, l, w, h, stackable: batch.stackable };
            }
          }
        }
        if (bestPos) {
          const entry = { ...bestPos, batchId: batch.id, instanceId: i + 1 };
          placed.push(entry);
          sh.add(entry, placed.length - 1);
          if (batch.stackable) stackablePlaced++;
        }
      }
    }
    return placed;
  }

  function foundationFirstPack(truck, batches, mode = 'large-footprint', supportFactor = 1.12) {
    const placed = [];
    const sh = createSpatialHash(truck, 50);
    const restrictedInstances = [];
    const supportInstances = [];
    const remainingInstances = [];

    batches.forEach(batch => {
      for (let instanceId = 1; instanceId <= batch.q; instanceId++) {
        const instance = { batch, instanceId };
        if (!batch.stackable) restrictedInstances.push(instance);
        else supportInstances.push(instance);
      }
    });
    if (!restrictedInstances.length || !supportInstances.length) return [];

    restrictedInstances.sort((a, b) =>
      (b.batch.l * b.batch.w) - (a.batch.l * a.batch.w) ||
      b.batch.h - a.batch.h
    );
    const minRestrictedHeight = Math.min(...restrictedInstances.map(item => item.batch.h));
    const viableSupports = supportInstances.filter(item =>
      item.batch.h + minRestrictedHeight <= truck.H + 0.01
    );
    if (!viableSupports.length) return [];

    viableSupports.sort((a, b) => {
      if (mode === 'low-platform') {
        return a.batch.h - b.batch.h ||
          (b.batch.l * b.batch.w) - (a.batch.l * a.batch.w);
      }
      return (b.batch.l * b.batch.w) - (a.batch.l * a.batch.w) ||
        a.batch.h - b.batch.h;
    });

    const restrictedArea = restrictedInstances.reduce(
      (sum, item) => sum + item.batch.l * item.batch.w, 0
    );
    const targetSupportArea = restrictedArea * supportFactor;
    const selectedSupports = [];
    let selectedArea = 0;
    for (const instance of viableSupports) {
      selectedSupports.push(instance);
      selectedArea += instance.batch.l * instance.batch.w;
      if (selectedArea >= targetSupportArea) break;
    }

    const selectedKeys = new Set(selectedSupports.map(item => `${item.batch.id}|${item.instanceId}`));
    supportInstances.forEach(instance => {
      if (!selectedKeys.has(`${instance.batch.id}|${instance.instanceId}`)) remainingInstances.push(instance);
    });

    function place(instance, forceFloor) {
      const pos = findPosition(truck, instance.batch, placed, sh, { forceFloor });
      if (!pos) return false;
      const entry = {
        ...pos,
        batchId: instance.batch.id,
        instanceId: instance.instanceId,
        stackable: instance.batch.stackable
      };
      placed.push(entry);
      sh.add(entry, placed.length - 1);
      return true;
    }

    function placeRemainingInColumns(instances) {
      const groups = new Map();
      instances.forEach(instance => {
        if (!groups.has(instance.batch.id)) groups.set(instance.batch.id, []);
        groups.get(instance.batch.id).push(instance);
      });

      groups.forEach(group => {
        const batch = group[0].batch;
        const levels = Math.max(1, Math.floor((truck.H + 0.01) / batch.h));
        const columnCount = Math.ceil(group.length / levels);
        const seeds = [];
        let index = 0;
        for (; index < columnCount && index < group.length; index++) {
          const before = placed.length;
          if (place(group[index], true)) seeds.push(placed[placed.length - 1]);
          else if (placed.length === before) place(group[index], false);
        }

        for (let level = 1; level < levels && index < group.length; level++) {
          for (const seed of seeds) {
            if (index >= group.length) break;
            const instance = group[index++];
            const candidate = {
              x: seed.x,
              y: seed.y,
              z: seed.z + level * batch.h,
              l: seed.l,
              w: seed.w,
              h: batch.h,
              batchId: batch.id,
              instanceId: instance.instanceId,
              stackable: true
            };
            const fits = candidate.z + candidate.h <= truck.H + 0.01 &&
              !checkCollisionLinear(candidate.x, candidate.y, candidate.z,
                candidate.l, candidate.w, candidate.h, placed);
            if (fits) {
              placed.push(candidate);
              sh.add(candidate, placed.length - 1);
            } else {
              place(instance, false);
            }
          }
        }
        while (index < group.length) place(group[index++], false);
      });
    }

    // 先搭平台；剩余可堆叠货单独组成满高列，避免占用预留平台顶面。
    // 最后再放不可堆叠顶货，使平台区域保持连续且净高充足。
    selectedSupports.forEach(instance => place(instance, true));
    placeRemainingInColumns(remainingInstances.sort((a, b) =>
      (b.batch.l * b.batch.w * b.batch.h) - (a.batch.l * a.batch.w * a.batch.h)
    ));
    restrictedInstances.forEach(instance => place(instance, false));
    return placed;
  }

  function computeFragmentScore(truck, placedBoxes, remainingBatches) {
    if (remainingBatches.length === 0) return 0;
    const remainingDims = [];
    for (const batch of remainingBatches) {
      for (const ori of getOrientations(batch)) remainingDims.push(ori);
    }
    if (remainingDims.length === 0) return 0;

    const xSet = new Set([0, truck.L]);
    const ySet = new Set([0, truck.W]);
    const zSet = new Set([0, truck.H]);
    for (const box of placedBoxes) {
      xSet.add(box.x); xSet.add(box.x + box.l);
      ySet.add(box.y); ySet.add(box.y + box.w);
      zSet.add(box.z); zSet.add(box.z + box.h);
    }
    const xs = [...xSet].sort((a, b) => a - b);
    const ys = [...ySet].sort((a, b) => a - b);
    const zs = [...zSet].sort((a, b) => a - b);

    if (xs.length > 40 || ys.length > 40 || zs.length > 40) {
      const usedX = placedBoxes.length ? Math.max(...placedBoxes.map(b => b.x + b.l)) : 0;
      const usedY = placedBoxes.length ? Math.max(...placedBoxes.map(b => b.y + b.w)) : 0;
      const usedZ = placedBoxes.length ? Math.max(...placedBoxes.map(b => b.z + b.h)) : 0;
      const usedVol = usedX * usedY * usedZ;
      const placedVol = placedBoxes.reduce((s, b) => s + b.l * b.w * b.h, 0);
      return Math.max(0, usedVol - placedVol);
    }

    let fragmentVol = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const dx = xs[i + 1] - xs[i];
      for (let j = 0; j < ys.length - 1; j++) {
        const dy = ys[j + 1] - ys[j];
        for (let k = 0; k < zs.length - 1; k++) {
          const dz = zs[k + 1] - zs[k];
          const cx = xs[i], cy = ys[j], cz = zs[k];
          let occupied = false;
          for (const box of placedBoxes) {
            if (cx >= box.x - 0.01 && cx < box.x + box.l - 0.01 &&
                cy >= box.y - 0.01 && cy < box.y + box.w - 0.01 &&
                cz >= box.z - 0.01 && cz < box.z + box.h - 0.01) {
              occupied = true; break;
            }
          }
          if (occupied) continue;
          const canFit = remainingDims.some(d =>
            d[0] <= dx + 0.01 && d[1] <= dy + 0.01 && d[2] <= dz + 0.01
          );
          if (!canFit) fragmentVol += dx * dy * dz;
        }
      }
    }
    return fragmentVol;
  }

  function gapFillPlaced(truck, batches, currentPlaced) {
    const placed = currentPlaced.map(p => ({ ...p }));
    const placedCounts = {};
    for (const p of placed) placedCounts[p.batchId] = (placedCounts[p.batchId] || 0) + 1;

    const unplaced = [];
    for (const batch of batches) {
      const cnt = placedCounts[batch.id] || 0;
      for (let i = cnt; i < batch.q; i++) {
        unplaced.push({ batch, instanceId: i + 1 });
      }
    }
    if (unplaced.length === 0) return placed;

    unplaced.sort((a, b) => (b.batch.l * b.batch.w * b.batch.h) - (a.batch.l * a.batch.w * a.batch.h));

    const sh = createSpatialHash(truck, 50);
    for (let k = 0; k < placed.length; k++) sh.add(placed[k], k);

    for (const { batch, instanceId } of unplaced) {
      const orientations = getOrientations(batch);
      let bestPos = null, bestScore = Infinity, bestL = Infinity;
      for (const [l, w, h] of orientations) {
        const positions = findAllPositions(truck, placed, l, w, h, batch.stackable, sh);
        for (const pos of positions) {
          const verticalScore = pos.z > 0.01 ? -1000000000 - pos.z * 1000 : 0;
          const score = verticalScore + (pos.x + l) * 1000000 + (pos.y + w) * 1000;
          if (score < bestScore || (score === bestScore && l < bestL)) {
            bestScore = score; bestL = l;
            bestPos = { ...pos, l, w, h, stackable: batch.stackable };
          }
        }
      }
      if (bestPos) {
        const entry = { ...bestPos, batchId: batch.id, instanceId, stackable: batch.stackable };
        placed.push(entry);
        sh.add(entry, placed.length - 1);
      }
    }
    return placed;
  }

  function backtrackPackBatch(truck, batches) {
    const batchInfos = batches.map(batch => ({
      batch,
      orientations: getOrientations(batch),
      totalVol: batch.l * batch.w * batch.h * batch.q
    }));
    batchInfos.sort((a, b) => {
      if (a.batch.stackable !== b.batch.stackable) return a.batch.stackable ? -1 : 1;
      return b.totalVol - a.totalVol;
    });

    const totalItems = batches.reduce((s, b) => s + b.q, 0);
    let bestPlaced = [];
    let nodesVisited = 0;
    const MAX_NODES = 20000;

    function placeBatch(currentPlaced, batchInfo, orientation) {
      const [l, w, h] = orientation;
      const placed = currentPlaced.map(p => ({ ...p }));
      const sh = createSpatialHash(truck, 50);
      for (let k = 0; k < placed.length; k++) sh.add(placed[k], k);
      let placedCount = 0;
      for (let i = 0; i < batchInfo.batch.q; i++) {
        const positions = findAllPositions(truck, placed, l, w, h, batchInfo.batch.stackable, sh);
        if (positions.length === 0) break;
        positions.sort((a, b) => {
          if (a.z !== b.z) return b.z - a.z;
          if (a.y !== b.y) return a.y - b.y;
          return a.x - b.x;
        });
        const pos = positions[0];
        const entry = {
          x: pos.x, y: pos.y, z: pos.z, l, w, h,
          batchId: batchInfo.batch.id,
          instanceId: i + 1,
          stackable: batchInfo.batch.stackable
        };
        placed.push(entry);
        sh.add(entry, placed.length - 1);
        placedCount++;
      }
      return { placed, placedCount };
    }

    function dfs(batchIndex, currentPlaced) {
      nodesVisited++;
      if (nodesVisited > MAX_NODES) return;

      const filled = gapFillPlaced(truck, batches, currentPlaced);
      if (filled.length > bestPlaced.length) bestPlaced = filled.map(p => ({ ...p }));

      if (batchIndex >= batchInfos.length) return;

      const remainingItems = batchInfos.slice(batchIndex).reduce((s, bi) => s + bi.batch.q, 0);
      if (currentPlaced.length + remainingItems <= bestPlaced.length) return;

      const batchInfo = batchInfos[batchIndex];
      const remainingBatches = batchInfos.slice(batchIndex + 1).map(bi => bi.batch);
      const placedCounts = {};
      for (const p of currentPlaced) placedCounts[p.batchId] = (placedCounts[p.batchId] || 0) + 1;
      const unplacedBatches = [];
      for (let bi = 0; bi < batchIndex; bi++) {
        const bInfo = batchInfos[bi];
        const cnt = placedCounts[bInfo.batch.id] || 0;
        if (cnt < bInfo.batch.q) {
          unplacedBatches.push({ ...bInfo.batch, q: bInfo.batch.q - cnt });
        }
      }
      const allRemaining = [...remainingBatches, ...unplacedBatches];

      const oriResults = batchInfo.orientations.map(ori => {
        const result = placeBatch(currentPlaced, batchInfo, ori);
        const fragment = computeFragmentScore(truck, result.placed, allRemaining);
        return { ori, result, fragment };
      });
      oriResults.sort((a, b) => {
        if (b.result.placedCount !== a.result.placedCount) return b.result.placedCount - a.result.placedCount;
        return a.fragment - b.fragment;
      });

      for (const { result } of oriResults) {
        dfs(batchIndex + 1, result.placed);
      }
    }

    dfs(0, []);
    return bestPlaced;
  }

  function backtrackPackDeep(truck, batches) {
    const items = [];
    for (const batch of batches) {
      const orientations = getOrientations(batch);
      for (let i = 0; i < batch.q; i++) {
        items.push({
          batchId: batch.id, instanceId: i + 1,
          stackable: batch.stackable, orientations,
          volume: batch.l * batch.w * batch.h, name: batch.name
        });
      }
    }
    items.sort((a, b) => {
      if (a.stackable !== b.stackable) return a.stackable ? -1 : 1;
      return b.volume - a.volume;
    });

    let bestPlaced = [];
    let nodesVisited = 0;
    const MAX_NODES = 200000;

    function dfs(index, currentPlaced) {
      nodesVisited++;
      if (nodesVisited > MAX_NODES) return;
      if (currentPlaced.length > bestPlaced.length) {
        bestPlaced = currentPlaced.map(p => ({...p}));
      }
      if (index >= items.length) return;
      const remaining = items.length - index;
      if (currentPlaced.length + remaining <= bestPlaced.length) return;

      const item = items[index];
      const sh = createSpatialHash(truck, 50);
      for (let k = 0; k < currentPlaced.length; k++) sh.add(currentPlaced[k], k);

      const candidatesPerOri = [];
      for (let oi = 0; oi < item.orientations.length; oi++) {
        const [l, w, h] = item.orientations[oi];
        const positions = findAllPositions(truck, currentPlaced, l, w, h, item.stackable, sh);
        const sorted = positions.map(pos => ({ ...pos, oi, l, w, h }))
          .sort((a, b) => {
            if (a.z !== b.z) return b.z - a.z;
            if (a.y !== b.y) return a.y - b.y;
            return a.x - b.x;
          });
        candidatesPerOri.push(sorted);
      }

      const candidates = [];
      const maxLen = Math.max(...candidatesPerOri.map(c => c.length));
      for (let rank = 0; rank < maxLen; rank++) {
        for (let oi = 0; oi < candidatesPerOri.length; oi++) {
          if (rank < candidatesPerOri[oi].length) {
            candidates.push(candidatesPerOri[oi][rank]);
          }
        }
      }

      const MAX_CANDIDATES = 60;
      const limitedCands = candidates.slice(0, MAX_CANDIDATES);
      for (const cand of limitedCands) {
        currentPlaced.push({
          x: cand.x, y: cand.y, z: cand.z,
          l: cand.l, w: cand.w, h: cand.h,
          batchId: item.batchId, instanceId: item.instanceId,
          stackable: item.stackable
        });
        dfs(index + 1, currentPlaced);
        currentPlaced.pop();
      }
      dfs(index + 1, currentPlaced);
    }

    dfs(0, []);
    return bestPlaced;
  }

  // 大批量单一尺寸采用规则列式装载：每一列从底板连续叠到允许高度，
  // 可在保持完整承托的同时避免通用极点搜索的平方级候选开销。
  function bulkPackSingleBatch(truck, batch) {
    const candidates = getOrientations(batch).map(([l, w, h]) => {
      const levels = batch.stackable ? Math.floor((truck.H + 0.01) / h) : 1;
      const countX = Math.floor((truck.L + 0.01) / l);
      const countY = Math.floor((truck.W + 0.01) / w);
      const capacity = Math.max(0, levels * countX * countY);
      const target = Math.min(batch.q, capacity);
      const floorColumns = Math.ceil(target / Math.max(1, levels));
      const usedLength = Math.ceil(floorColumns / Math.max(1, countY)) * l;
      return { l, w, h, levels, countX, countY, capacity, target, floorColumns, usedLength };
    }).sort((a, b) =>
      b.target - a.target ||
      a.floorColumns - b.floorColumns ||
      a.usedLength - b.usedLength ||
      (a.l * a.w) - (b.l * b.w)
    );

    const best = candidates[0];
    if (!best || best.target <= 0) return [];
    const placed = [];
    let instanceId = 1;
    for (let ix = 0; ix < best.countX && instanceId <= best.target; ix++) {
      for (let iy = 0; iy < best.countY && instanceId <= best.target; iy++) {
        for (let level = 0; level < best.levels && instanceId <= best.target; level++) {
          placed.push({
            x: ix * best.l,
            y: iy * best.w,
            z: level * best.h,
            l: best.l,
            w: best.w,
            h: best.h,
            batchId: batch.id,
            instanceId,
            stackable: batch.stackable
          });
          instanceId++;
        }
      }
    }
    return placed;
  }

  function validateAndPack(truck, batches) {
    const result = { status: null, reason: '', placements: [], usedBacktrack: false };
    const truckVol = truck.L * truck.W * truck.H;

    if (truck.L <= 0 || truck.W <= 0 || truck.H <= 0) {
      result.status = 'INVALID_INPUT'; result.reason = '车厢尺寸须为正数';
      return result;
    }
    for (const b of batches) {
      if (b.l <= 0 || b.w <= 0 || b.h <= 0 || b.q <= 0) {
        result.status = 'INVALID_INPUT'; result.reason = `${b.name} 尺寸或数量须为正数`;
        return result;
      }
    }

    const deterministicReasons = [];
    const individuallyUnfit = [];
    for (const b of batches) {
      const orientations = getOrientations(b);
      const canFit = orientations.some(([l, w, h]) =>
        l <= truck.L && w <= truck.W && h <= truck.H
      );
      if (!canFit) individuallyUnfit.push(b.name || '货物');
    }
    if (individuallyUnfit.length) deterministicReasons.push(`${individuallyUnfit.length} 个批次存在单件尺寸超限`);

    let totalVol = 0;
    for (const b of batches) totalVol += b.l * b.w * b.h * b.q;
    if (totalVol > truckVol) {
      deterministicReasons.push('货物总体积超过车厢体积');
    }

    const totalQ = batches.reduce((s, b) => s + b.q, 0);

    const SKIP_ENHANCED_THRESHOLD = 500;
    const SKIP_BATCH_BT_THRESHOLD = 200;
    const SKIP_DEEP_BT_THRESHOLD = 80;
    const TIME_BUDGET_MS = 15000;
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    function timeLeft() { return TIME_BUDGET_MS - ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime); }

    const useBulkSingleBatch = batches.length === 1 && totalQ >= 300;
    const greedyPlaced = useBulkSingleBatch
      ? bulkPackSingleBatch(truck, batches[0])
      : greedyPack(truck, batches);
    let finalPlaced = greedyPlaced;

    function placedFloorArea(items) {
      return items.filter(item => item.z < 0.01).reduce((sum, item) => sum + item.l * item.w, 0);
    }

    function isBetterPacking(candidate, current) {
      if (candidate.length !== current.length) return candidate.length > current.length;
      const candidateEnvelope = floorEnvelopeArea(candidate);
      const currentEnvelope = floorEnvelopeArea(current);
      if (Math.abs(candidateEnvelope - currentEnvelope) > 0.01) {
        return candidateEnvelope < currentEnvelope;
      }
      const candidateFloor = placedFloorArea(candidate);
      const currentFloor = placedFloorArea(current);
      return candidateFloor < currentFloor - 0.01;
    }

    if (totalQ <= SKIP_ENHANCED_THRESHOLD && timeLeft() > 2000) {
      const enhancedPlaced = greedyPackEnhanced(truck, batches);
      if (isBetterPacking(enhancedPlaced, finalPlaced)) {
        finalPlaced = enhancedPlaced;
      }
    }

    const hasRestricted = batches.some(batch => !batch.stackable);
    const hasStackable = batches.some(batch => batch.stackable);
    if (hasRestricted && hasStackable && totalQ <= 240 && timeLeft() > 2500) {
      for (const mode of ['large-footprint', 'low-platform']) {
        for (const factor of [0.9, 1, 1.12, 1.25, 1.4]) {
          const foundationPlaced = foundationFirstPack(truck, batches, mode, factor);
          if (isBetterPacking(foundationPlaced, finalPlaced)) {
            finalPlaced = foundationPlaced;
          }
        }
      }
    }

    if (finalPlaced.length < totalQ && totalQ <= SKIP_BATCH_BT_THRESHOLD && timeLeft() > 3000) {
      const batchPlaced = backtrackPackBatch(truck, batches);
      if (isBetterPacking(batchPlaced, finalPlaced)) {
        finalPlaced = batchPlaced;
        result.usedBacktrack = true;
      }
    }

    if (finalPlaced.length < totalQ && totalQ <= SKIP_DEEP_BT_THRESHOLD && timeLeft() > 3000) {
      const deepPlaced = backtrackPackDeep(truck, batches);
      if (isBetterPacking(deepPlaced, finalPlaced)) {
        finalPlaced = deepPlaced;
        result.usedBacktrack = true;
      }
    }

    compactTopLayers(truck, finalPlaced);

    result.placements = finalPlaced;
    if (finalPlaced.length === totalQ) {
      result.status = 'FIT';
    } else {
      const outsideCount = totalQ - finalPlaced.length;
      result.status = deterministicReasons.length ? 'NOT_FIT' : 'UNRESOLVED';
      result.reason = `车内已装 ${finalPlaced.length} 件，车外剩余 ${outsideCount} 件` +
        (deterministicReasons.length ? `；${deterministicReasons.join('；')}` : '；当前搜索未找到其余货物的合法位置');
    }
    return result;
  }

  function palletsToBatches(pallets) {
    const groups = {};
    for (const p of pallets) {
      const isStackable = p.stackable && !p.doNotStack && !p.fragile && !p.adr;
      const key = `${p.length}|${p.width}|${p.height}|${isStackable}|${p.weight}`;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          name: p.name || '货物',
          l: Math.round(p.length * 100),
          w: Math.round(p.width * 100),
          h: Math.round(p.height * 100),
          q: 0,
          stackable: isStackable,
          _originalPallets: []
        };
      }
      groups[key].q++;
      groups[key]._originalPallets.push(p);
    }
    return Object.values(groups);
  }

  function placementsToPallets(placements, batches, originalPallets, truck) {
    const batchMap = {};
    for (const b of batches) {
      batchMap[b.id] = b;
      b._usedCount = 0;
    }

    const result = [];

    for (const placement of placements) {
      const batch = batchMap[placement.batchId];
      if (!batch) continue;

      const isRotated = placement.l !== batch.l;

      const idx = batch._usedCount;
      if (idx < batch._originalPallets.length) {
        const matchedPallet = batch._originalPallets[idx];
        batch._usedCount++;
        const newPallet = { ...matchedPallet };
        newPallet.rotation = isRotated ? 90 : 0;
        // 装箱算法: x=左边缘(长度方向), y=左边缘(宽度方向), z=底部(高度方向)
        // 我们的系统: x=中心(宽度方向), z=中心(长度方向), baseY=底部(高度方向)
        const placementLengthM = placement.l / 100;
        const placementWidthM = placement.w / 100;
        newPallet.z = (placement.x + placement.l / 2) / 100;
        newPallet.x = (placement.y + placement.w / 2) / 100 - truck.width / 2;
        newPallet.baseY = placement.z / 100;
        newPallet.freeHeight = false;
        newPallet.overflow = false;
        result.push(newPallet);
      }
    }

    const placedIds = new Set(result.map(p => p.id));
    for (const p of originalPallets) {
      if (!placedIds.has(p.id)) {
        const unplaced = { ...p };
        const spot = outsideTrailerSpot(unplaced, result, truck);
        if (spot) applyPlacement(unplaced, spot);
        unplaced.overflow = true;
        result.push(unplaced);
      }
    }

    return result;
  }

  // ---------- 不可堆叠物品下沉到可堆叠物品上方 ----------

  function settleNonStackableOnStacks(pallets, truck) {
    const nonStackable = pallets.filter(p =>
      !p.stackable && !p.overflow && (p.baseY || 0) > 0.01
    );

    for (const item of nonStackable) {
      const fp = footprint(item);
      const itemX1 = item.x - fp.width / 2;
      const itemX2 = item.x + fp.width / 2;
      const itemZ1 = item.z - fp.length / 2;
      const itemZ2 = item.z + fp.length / 2;
      const itemBottom = item.baseY || 0;

      let supportTop = 0;

      for (const other of pallets) {
        if (other.id === item.id) continue;
        if (!other.stackable) continue;
        if (other.overflow) continue;

        const ofp = footprint(other);
        const ox1 = other.x - ofp.width / 2;
        const ox2 = other.x + ofp.width / 2;
        const oz1 = other.z - ofp.length / 2;
        const oz2 = other.z + ofp.length / 2;
        const otop = (other.baseY || 0) + other.height;

        if (otop > itemBottom + 0.001) continue;

        const overlapX = Math.min(itemX2, ox2) - Math.max(itemX1, ox1);
        const overlapZ = Math.min(itemZ2, oz2) - Math.max(itemZ1, oz1);

        if (overlapX > 0.01 && overlapZ > 0.01) {
          if (otop > supportTop) supportTop = otop;
        }
      }

      if (supportTop < itemBottom - 0.001) {
        item.baseY = supportTop;
      }
    }
  }

  function findHighestFullSupportTop(item, pallets, maxTop) {
    let bestTop = 0;
    const groups = groupSupportsByHeight(
      pallets.filter(other => other.id !== item.id && !other.overflow && other.stackable)
    );
    for (const [top, supports] of groups) {
      if (top > maxTop + 0.001 || top <= bestTop + 0.001) continue;
      const candidate = { ...item, baseY: top };
      if (coplanarSupportCoverageOk(candidate, supports).ok) bestTop = top;
    }
    return bestTop;
  }

  // 所有货物下沉到完全承托面；找不到完整顶面时必须回到底板
  function settleAllFloating(pallets, truck) {
    // 多轮迭代，确保链式下沉到位（A→B→C 逐级沉到位）
    var maxPasses = 5;
    for (var pass = 0; pass < maxPasses; pass++) {
      var changed = false;

      // 从低到高处理，确保下方的先沉到位
      const floating = pallets
        .filter(p => !p.overflow && (p.baseY || 0) > 0.01)
        .sort((a, b) => (a.baseY || 0) - (b.baseY || 0));

      for (const item of floating) {
        const itemBottom = item.baseY || 0;

        // 当前底面已经完整贴合一个承托面时保持不动
        const supports = getStackSupports(item, pallets);
        const check = supportCoverageOk(item, supports);
        if (check.ok) continue;

        const bestSupportTop = findHighestFullSupportTop(item, pallets, itemBottom);
        if (Math.abs(bestSupportTop - itemBottom) > 0.001) {
          item.baseY = bestSupportTop;
          changed = true;
        }
      }

      if (!changed) break; // 稳定了，退出
    }
  }

  // ---------- 单货物下沉到支撑面（拖拽后调用） ----------

  function sinkPalletToSupport(pallet, allPallets) {
    if (!pallet || pallet.overflow) return;
    var baseY = pallet.baseY || 0;
    if (baseY < 0.01) return;

    // 先检查当前底面是否完整贴合单个承托面
    var supports = getStackSupports(pallet, allPallets);
    var check = supportCoverageOk(pallet, supports);
    if (check.ok) return;

    pallet.baseY = findHighestFullSupportTop(pallet, allPallets, baseY);
  }

  // ---------- 主优化函数 ----------

  function optimize(pallets, truck, warnings = []) {
    const CM_TRUCK = {
      L: Math.round(truck.length * 100),
      W: Math.round(truck.width * 100),
      H: Math.round(truck.height * 100)
    };

    const batches = palletsToBatches(pallets);
    const packResult = validateAndPack(CM_TRUCK, batches);

    const finalPallets = placementsToPallets(packResult.placements, batches, pallets, truck);

    // 多轮后处理：下沉 → 解决重叠 → 再下沉，直到稳定
    for (var pass = 0; pass < 3; pass++) {
      var changed = false;

      // 1. 所有悬空货物下沉到支撑面
      settleAllFloating(finalPallets, truck);

      // 2. 逐个检测并解决重叠 + 防悬空
      for (var pi = 0; pi < finalPallets.length; pi++) {
        var p = finalPallets[pi];
        if (p.overflow) continue;

        // 检测并解决重叠
        if (resolvePalletOverlap(p, finalPallets, truck)) {
          changed = true;
        }
        // 防悬空
        var oldY = p.baseY || 0;
        sinkPalletToSupport(p, finalPallets);
        if (Math.abs((p.baseY || 0) - oldY) > 0.001) {
          changed = true;
        }
        clampPallet(p, truck);
      }

      if (!changed) break;
    }

    // 最终再沉一次确保稳定
    settleAllFloating(finalPallets, truck);

    const finalStats = calculateOptimizationBreakdown(finalPallets, truck, warnings);
    return {
      pallets: finalPallets,
      strategyName: packResult.usedBacktrack ? '极点法+回溯' : '极点法装箱',
      status: packResult.status,
      reason: packResult.reason,
      stats: finalStats
    };
  }

  // ---------- 验证警告 ----------

  function validateLoad(pallets, truck) {
    const warnings = [];

    // 重叠检测（空间哈希加速，避免 O(n²)）
    const cellSize = 0.5; // 50cm 网格
    const grid = new Map();
    const validPallets = pallets.filter(p => !p.overflow);
    for (const p of validPallets) {
      const fp = footprint(p);
      const x1 = p.x - fp.width / 2, x2 = p.x + fp.width / 2;
      const z1 = p.z - fp.length / 2, z2 = p.z + fp.length / 2;
      const y1 = p.baseY || 0, y2 = y1 + p.height;
      for (let cx = Math.floor(x1 / cellSize); cx <= Math.floor(x2 / cellSize); cx++) {
        for (let cz = Math.floor(z1 / cellSize); cz <= Math.floor(z2 / cellSize); cz++) {
          for (let cy = Math.floor(y1 / cellSize); cy <= Math.floor(y2 / cellSize); cy++) {
            const key = cx + ',' + cy + ',' + cz;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(p);
          }
        }
      }
    }
    const checked = new Set();
    for (const [, list] of grid) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const pairKey = list[i].id < list[j].id ? list[i].id + '|' + list[j].id : list[j].id + '|' + list[i].id;
          if (checked.has(pairKey)) continue;
          checked.add(pairKey);
          if (boxesConflict(boxFor(list[i]), boxFor(list[j]), PLACEMENT_CLEARANCE, OVERLAP_TOLERANCE)) {
            warnings.push({
              type: 'danger',
            text: `货物重叠：${list[i].name || '#'+list[i].id.slice(0,6)} 与 ${list[j].name || '#'+list[j].id.slice(0,6)}`,
            palletId: list[i].id
          });
        }
      }
    }
    }

    // 边界检测
    pallets.forEach(pallet => {
      if (isPalletOutsideTruck(pallet, truck)) {
        warnings.push({
          type: 'warning',
          text: `${pallet.name || '货物'} 在车辆外部`,
          palletId: pallet.id
        });
      }
      const topY = (pallet.baseY || 0) + pallet.height;
      if (topY > truck.height + 0.001 && !pallet.overflow) {
        warnings.push({
          type: 'danger',
          text: `${pallet.name || '货物'} 超出内部高度限制`,
          palletId: pallet.id
        });
      }
    });

    // 堆叠支撑检测
    pallets.forEach(pallet => {
      if ((pallet.baseY || 0) > 0.01) {
        const supports = getStackSupports(pallet, pallets);
        const check = coplanarSupportCoverageOk(pallet, supports);
        if (!check.ok) {
          warnings.push({
            type: 'warning',
            text: `${pallet.name || '货物'} 底面未完全贴合承托面 (单件支撑覆盖率 ${(check.coverage*100).toFixed(0)}%)`,
            palletId: pallet.id
          });
        }
      }
    });

    // 超重检测
    const totalWeight = pallets
      .filter(p => !isPalletOutsideTruck(p, truck))
      .reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight > truck.maxWeight) {
      warnings.push({
        type: 'danger',
        text: `总重量 ${formatKg(totalWeight)} 超过限重 ${formatKg(truck.maxWeight)}`
      });
    }

    // 轮压检测
    const wheelStress = calculateWheelStress(pallets, truck);
    wheelStress.forEach(ws => {
      if (ws.percent >= 100) {
        warnings.push({
          type: 'danger',
          text: `${ws.label} 载荷 ${ws.percent.toFixed(0)}% 超载`
        });
      } else if (ws.percent >= 85) {
        warnings.push({
          type: 'warning',
          text: `${ws.label} 载荷 ${ws.percent.toFixed(0)}% 接近上限`
        });
      }
    });

    return warnings;
  }

  // ---------- 导出公共接口 ----------

  return {
    // 几何
    footprint, rectFor, boxFor, clampPallet, isPalletOutsideTruck,
    // 碰撞
    boxesConflict, placementConflicts, rectsOverlap, resolveOverlap,
    // 重量
    calculateWheelStress, calculateWeightedLoadCenter, calculateDistributionScore,
    preferredWeightCenterZ, loadSupportPositions,
    // 评分
    calculateOptimizationBreakdown, calculateBoundsForPallets,
    calculateFloorUsageForPallets, calculateEuroPalletCapacity,
    // 候选点
    collectFloorSpotCandidates, collectStackSpotCandidates,
    candidateRotations, optimizedGridStep,
    // 堆叠
    getStackSupports, supportCoverageOk, coplanarSupportCoverageOk,
    findNearbyCoplanarSupportSpot, groupSupportsByHeight,
    repairUnsupportedStacks,
    // 放置
    findPracticalLoadSpot, findOptimalLoadSpot, findFitFirstLoadSpot, findDenseRecoverySpot,
    findFrontFloorSpot, findFrontStackSpot, outsideTrailerSpot,
    findCompactLoadSpot, findCompactFloorSpot,
    calculateRowPackedWidth, calculateColumnGap, compactTopLayers, foundationFirstPack,
    applyPlacement,
    // 重叠
    findOverlapPair, resolveRemainingOverlaps, countOverflowPallets,
    hasPalletOverlap, resolvePalletOverlap,
    // 优化
    optimize, buildOptimizationStrategies, arrangeCargo,
    compareCargoForBalancedOptimization, compareCargoForFitFirstOptimization,
    // 极点法装箱（测试用）
    greedyPack, greedyPackEnhanced, bulkPackSingleBatch, validateAndPack,
    palletsToBatches, placementsToPallets, settleNonStackableOnStacks, settleAllFloating,
    getOrientations, createSpatialHash, findAllPositions, sinkPalletToSupport,
    // 验证
    validateLoad,
    // 快照
    capturePlacementMap, restorePlacementMap
  };
})();
