// ============================================================
// 卡车装载规划器 - 3D渲染模块
// 使用 Three.js 实现车厢、货物的3D可视化
// ============================================================

const Renderer = (function() {
  'use strict';

  let scene, camera, renderer, controls;
  let truckGroup, cargoGroup;
  let raycaster, mouse;
  let selectedCargo = null;
  let hoveredCargo = null;
  let cargoMeshes = new Map(); // id -> mesh
  let container = null;
  let currentTruck = null;
  let animationId = null;

  // ---------- 初始化 ----------

  function init(containerElement) {
    container = containerElement;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c2028);
  scene.fog = new THREE.Fog(0x1c2028, 25, 60);

    const width = container.clientWidth;
    const height = container.clientHeight;

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(6, 5, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 轨道控制
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.1;

    // 光照
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    fillLight.position.set(-8, 6, -5);
    scene.add(fillLight);

    // 射线检测
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // 组
    truckGroup = new THREE.Group();
    cargoGroup = new THREE.Group();
    scene.add(truckGroup);
    scene.add(cargoGroup);

    // 地面
    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1c2028,
      roughness: 0.95,
      metalness: 0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    animate();
  }

  function onWindowResize() {
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  // ---------- 卡车渲染 ----------

  function renderTruck(truck) {
    currentTruck = truck;
    clearGroup(truckGroup);

    const L = truck.length;
    const W = truck.width;
    const H = truck.height;

    // 地板
    const floorGeo = new THREE.BoxGeometry(W, 0.05, L);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, 0.025, L / 2);
    floor.receiveShadow = true;
    truckGroup.add(floor);

    // 地板网格线
    const gridDivisions = Math.round(L / 0.5);
    const gridHelper = new THREE.GridHelper(L, gridDivisions, 0x3a3d45, 0x2a2d33);
    gridHelper.position.set(0, 0.052, L / 2);
    gridHelper.scale.x = W / L;
    truckGroup.add(gridHelper);

    // 前墙
    const frontWallGeo = new THREE.BoxGeometry(W, H, 0.04);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0d8,
      roughness: 0.5,
      metalness: 0.15,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const frontWall = new THREE.Mesh(frontWallGeo, wallMat);
    frontWall.position.set(0, H / 2, 0.02);
    truckGroup.add(frontWall);

    // 左墙
    const leftWallGeo = new THREE.BoxGeometry(0.04, H, L);
    const leftWall = new THREE.Mesh(leftWallGeo, wallMat);
    leftWall.position.set(-W / 2 - 0.02, H / 2, L / 2);
    truckGroup.add(leftWall);

    // 右墙
    const rightWall = new THREE.Mesh(leftWallGeo, wallMat);
    rightWall.position.set(W / 2 + 0.02, H / 2, L / 2);
    truckGroup.add(rightWall);

    // 后门框
    const doorFrameMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.5,
      metalness: 0.3
    });
    const postGeo = new THREE.BoxGeometry(0.06, H, 0.06);
    const leftPost = new THREE.Mesh(postGeo, doorFrameMat);
    leftPost.position.set(-W / 2, H / 2, L);
    truckGroup.add(leftPost);
    const rightPost = new THREE.Mesh(postGeo, doorFrameMat);
    rightPost.position.set(W / 2, H / 2, L);
    truckGroup.add(rightPost);
    const topGeo = new THREE.BoxGeometry(W, 0.06, 0.06);
    const topPost = new THREE.Mesh(topGeo, doorFrameMat);
    topPost.position.set(0, H, L);
    truckGroup.add(topPost);

    // 车顶边线框
    const ceilingEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.01, L));
    const ceilingEdgeMat = new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.3 });
    const ceilingEdges = new THREE.LineSegments(ceilingEdgeGeo, ceilingEdgeMat);
    ceilingEdges.position.set(0, H, L / 2);
    truckGroup.add(ceilingEdges);

    // 车轮
    if (truck.wheelZ && truck.wheelZ.length) {
      const wheelRadius = truck.kind === 'van' ? 0.35 : 0.5;
      const wheelWidth = 0.25;
      const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 24);
      const wheelMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.9
      });

      truck.wheelZ.forEach(zPos => {
        const leftWheel = new THREE.Mesh(wheelGeo, wheelMat);
        leftWheel.rotation.z = Math.PI / 2;
        leftWheel.position.set(-W / 2 - 0.15, -wheelRadius + 0.05, zPos);
        truckGroup.add(leftWheel);
        const rightWheel = new THREE.Mesh(wheelGeo, wheelMat);
        rightWheel.rotation.z = Math.PI / 2;
        rightWheel.position.set(W / 2 + 0.15, -wheelRadius + 0.05, zPos);
        truckGroup.add(rightWheel);
      });
    }

    fitCameraToTruck();
  }

  function fitCameraToTruck() {
    if (!currentTruck) return;
    const L = currentTruck.length;
    const W = currentTruck.width;
    const H = currentTruck.height;
    const maxDim = Math.max(L, W, H);

    controls.target.set(0, H / 2, L / 2);
    camera.position.set(
      W * 1.5 + maxDim * 0.3,
      H * 1.2 + maxDim * 0.5,
      L * 1.2
    );
    controls.update();
  }

  function fitCameraToLoad(pallets, truck) {
    if (!pallets || !pallets.length) {
      fitCameraToTruck();
      return;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    pallets.forEach(p => {
      const box = Optimizer.boxFor(p);
      minX = Math.min(minX, box.minX);
      maxX = Math.max(maxX, box.maxX);
      minY = Math.min(minY, box.minY);
      maxY = Math.max(maxY, box.maxY);
      minZ = Math.min(minZ, box.minZ);
      maxZ = Math.max(maxZ, box.maxZ);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ, 2);

    controls.target.set(centerX, centerY, centerZ);
    const dist = maxSize * 1.8;
    camera.position.set(
      centerX + dist * 0.6,
      centerY + dist * 0.5,
      centerZ + dist * 0.7
    );
    controls.update();
  }

  // ---------- 货物渲染 ----------

  function renderCargo(pallets, selectedId = null) {
    clearGroup(cargoGroup);
    cargoMeshes.clear();

    pallets.forEach(pallet => {
      const mesh = createCargoMesh(pallet);
      cargoGroup.add(mesh);
      cargoMeshes.set(pallet.id, mesh);

      if (pallet.id === selectedId) {
        setSelected(pallet.id, true);
      }
    });

    selectedCargo = selectedId;
  }

  function createCargoMesh(pallet) {
    const dims = Optimizer.footprint(pallet);
    const geo = new THREE.BoxGeometry(dims.width, pallet.height, dims.length);
    const color = new THREE.Color(pallet.color || '#1f9d72');

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.1,
      transparent: pallet.overflow ? true : false,
      opacity: pallet.overflow ? 0.5 : 1
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.palletId = pallet.id;

    // 边线
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.25,
      linewidth: 2
    });
    const line = new THREE.LineSegments(edges, lineMat);
    mesh.add(line);

    // 位置
    mesh.position.set(pallet.x, (pallet.baseY || 0) + pallet.height / 2, pallet.z);

    // 溢出标记
    if (pallet.overflow) {
      const warnGeo = new THREE.SphereGeometry(0.15, 16, 16);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
      const warn = new THREE.Mesh(warnGeo, warnMat);
      warn.position.set(0, pallet.height / 2 + 0.2, 0);
      mesh.add(warn);
    }

    return mesh;
  }

  function updateCargoPosition(pallet) {
    const mesh = cargoMeshes.get(pallet.id);
    if (!mesh) return;

    const dims = Optimizer.footprint(pallet);
    const currentW = mesh.geometry.parameters.width;
    const currentD = mesh.geometry.parameters.depth;
    if (Math.abs(currentW - dims.width) > 0.001 || Math.abs(currentD - dims.length) > 0.001) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BoxGeometry(dims.width, pallet.height, dims.length);
      if (mesh.children[0] && mesh.children[0].isLineSegments) {
        mesh.children[0].geometry.dispose();
        mesh.children[0].geometry = new THREE.EdgesGeometry(mesh.geometry);
      }
    }

    mesh.position.set(pallet.x, (pallet.baseY || 0) + pallet.height / 2, pallet.z);
    mesh.material.opacity = pallet.overflow ? 0.5 : 1;
    mesh.material.transparent = pallet.overflow;
  }

  // ---------- 选择与悬停 ----------

  function setSelected(palletId, selected) {
    const mesh = cargoMeshes.get(palletId);
    if (!mesh) return;

    if (selected) {
      mesh.material.emissive = new THREE.Color(0xffff00);
      mesh.material.emissiveIntensity = 0.3;
      selectedCargo = palletId;
    } else {
      mesh.material.emissive = new THREE.Color(0x000000);
      mesh.material.emissiveIntensity = 0;
      if (selectedCargo === palletId) selectedCargo = null;
    }
  }

  function clearSelection() {
    if (selectedCargo) {
      setSelected(selectedCargo, false);
    }
  }

  function setHovered(palletId) {
    if (hoveredCargo === palletId) return;
    if (hoveredCargo && hoveredCargo !== selectedCargo) {
      const mesh = cargoMeshes.get(hoveredCargo);
      if (mesh) {
        mesh.material.emissive = new THREE.Color(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    }
    hoveredCargo = palletId;
    if (palletId && palletId !== selectedCargo) {
      const mesh = cargoMeshes.get(palletId);
      if (mesh) {
        mesh.material.emissive = new THREE.Color(0x88ccff);
        mesh.material.emissiveIntensity = 0.2;
      }
    }
  }

  // ---------- 射线检测 ----------

  function getCargoAtMouse(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cargoGroup.children, false);

    if (intersects.length > 0) {
      return intersects[0].object.userData.palletId;
    }
    return null;
  }

  function getFloorPoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    // 用 y=0 的水平面做射线求交
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);
    return point;
  }

  function getDragPoint(event, pallet) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    // 用货物中心高度的水平面求交，拖拽更跟手
    const y = pallet ? (pallet.baseY || 0) + (pallet.height || 0) / 2 : 0;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);
    return point;
  }

  // ---------- 辅助函数 ----------

  function clearGroup(group) {
    if (!group || !group.children) return;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  function getCanvas() {
    return renderer.domElement;
  }

  function getControls() {
    return controls;
  }

  function setView(mode) {
    if (!currentTruck) return;
    const L = currentTruck.length;
    const W = currentTruck.width;
    const H = currentTruck.height;

    controls.target.set(0, H / 2, L / 2);

    switch (mode) {
      case 'front':
        camera.position.set(0, H / 2, -L * 0.8);
        break;
      case 'back':
        camera.position.set(0, H / 2, L * 1.8);
        break;
      case 'top':
        camera.position.set(0, Math.max(L, W) * 1.5, L / 2);
        break;
      case 'side':
        camera.position.set(W * 2.5, H / 2, L / 2);
        break;
      case 'iso':
      default:
        camera.position.set(W * 1.5 + L * 0.3, H * 1.2 + L * 0.3, L * 1.2);
        break;
    }
    controls.update();
  }

  function takeScreenshot() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.9);
  }

  // ---------- 导出到全局 ----------

  return {
    init,
    renderTruck,
    renderCargo,
    updateCargoPosition,
    fitCameraToTruck,
    fitCameraToLoad,
    setSelected,
    clearSelection,
    setHovered,
    getCargoAtMouse,
    getFloorPoint,
    getDragPoint,
    getCanvas,
    getControls,
    setView,
    takeScreenshot,
    onWindowResize,
    get scene() { return scene; },
    get camera() { return camera; },
    get selectedCargo() { return selectedCargo; }
  };
})();
