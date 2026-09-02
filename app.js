(() => {
  'use strict';

  const STORAGE_KEY = 'heliopont-march-calculator-v1';
  const DEFAULT_SCALE = 48 / 433;
  const ROUTE_COLOR = '#f5d17d';
  const scanProfiles = {
    low: { tolerance: 28, minComponent: 16, minDiagonal: 22, maxDensity: .30, denseBox: 15, minPath: 17 },
    normal: { tolerance: 39, minComponent: 8, minDiagonal: 10, maxDensity: .60, denseBox: 20, minPath: 7 },
    high: { tolerance: 56, minComponent: 2, minDiagonal: 3, maxDensity: .98, denseBox: 34, minPath: 2.2 }
  };

  const units = {
    messenger: { label: 'Посланець', speed: 42 },
    cavalry: { label: 'Кінний загін', speed: 30 },
    detachment: { label: 'Малий загін', speed: 26 },
    army: { label: 'Основна армія', speed: 24 },
    baggage: { label: 'Армія з обозом', speed: 18 }
  };
  const marchModifiers = { normal: 1, forced: 1.25, cautious: 0.78 };
  const weathers = {
    clear: { label: 'Ясно', road: 1, offroad: 1 },
    lightRain: { label: 'Легкий дощ', road: .95, offroad: .85 },
    rain: { label: 'Дощ', road: .85, offroad: .65 },
    heavyRain: { label: 'Сильний дощ', road: .70, offroad: .45 },
    snow: { label: 'Сніг', road: .75, offroad: .55 },
    heavySnow: { label: 'Сильний сніг', road: .50, offroad: .30 }
  };
  const terrains = {
    plains: { label: 'Рівнина', modifier: .75 },
    hills: { label: 'Пагорби', modifier: .60 },
    forest: { label: 'Ліс', modifier: .50 },
    mountains: { label: 'Гори', modifier: .35 },
    swamp: { label: 'Болото', modifier: .30 }
  };
  const DEFAULT_MARKER_TYPES = [
    { id: 'fort', label: 'Форт', symbol: '♜', color: '#a95d45' },
    { id: 'city', label: 'Місто', symbol: '●', color: '#d58b38' },
    { id: 'village', label: 'Село', symbol: '⌂', color: '#86a85f' },
    { id: 'landmark', label: 'Важливе', symbol: '★', color: '#c99d42' },
    { id: 'camp', label: 'Табір', symbol: '▲', color: '#6b9f76' },
    { id: 'port', label: 'Порт', symbol: '⚓', color: '#448da5' },
    { id: 'temple', label: 'Храм', symbol: '✦', color: '#9277b5' },
    { id: 'danger', label: 'Небезпека', symbol: '!', color: '#b9473f' },
    { id: 'army', label: 'Армія', symbol: '⚔', color: '#8f5545', army: true }
  ];
  const FACTION_COLORS = ['#b86b46', '#397fbd', '#6f9b4d', '#9a62a8', '#c09535', '#3f9b8e', '#b34d69', '#74839e'];

  const canvas = document.querySelector('#mapCanvas');
  const ctx = canvas.getContext('2d');
  const viewport = document.querySelector('#mapViewport');
  const image = new Image();
  // The embedded data URL keeps pixel access available even when index.html is
  // opened directly through file://, where local images otherwise taint canvas.
  image.src = window.HELIOPONT_MAP_DATA || 'General_Map.jpg';

  const state = loadState();
  let activeTab = 'route';
  let routePoints = [];
  let routeResult = null;
  let roadDraft = [];
  let roadTool = 'draw';
  let selectedRoadId = null;
  let selectedNodeId = null;
  let selectedRoadIds = new Set();
  let selectedNodeIds = new Set();
  let selectionBox = null;
  let connectStartNodeId = null;
  let roadDrag = null;
  let markerTool = 'place';
  let selectedMarkerType = 'fort';
  let selectedMarkerId = null;
  let selectedMarkerIds = new Set();
  let markerDrag = null;
  let calibrationPoints = [];
  let calibrating = false;
  let camera = { scale: 1, x: 0, y: 0 };
  let isPanning = false;
  let spaceDown = false;
  let panOrigin = null;
  let noticeTimer = null;

  function normalizeFactionData(markers, factions) {
    const normalized = [];
    const usedIds = new Set();
    for (const faction of Array.isArray(factions) ? factions : []) {
      if (!faction || !String(faction.name || '').trim()) continue;
      let id = String(faction.id || uid('faction'));
      if (usedIds.has(id)) id = uid('faction');
      usedIds.add(id);
      normalized.push({
        id,
        name: String(faction.name).trim(),
        color: /^#[0-9a-f]{6}$/i.test(faction.color) ? faction.color : FACTION_COLORS[normalized.length % FACTION_COLORS.length]
      });
    }
    for (const marker of markers) {
      const legacyName = String(marker.faction || '').trim();
      if (!marker.factionId && legacyName) {
        let faction = normalized.find(item => item.name.localeCompare(legacyName, 'uk', { sensitivity: 'accent' }) === 0);
        if (!faction) {
          faction = { id: uid('faction'), name: legacyName, color: FACTION_COLORS[normalized.length % FACTION_COLORS.length] };
          normalized.push(faction);
        }
        marker.factionId = faction.id;
      }
      delete marker.faction;
    }
    return normalized;
  }

  function loadState() {
    const fallback = {
      scale: DEFAULT_SCALE,
      nodes: [],
      segments: [],
      markers: [],
      customMarkerTypes: [],
      factions: [],
      grid: { type: 'none', miles: 24 },
      speeds: Object.fromEntries(Object.entries(units).map(([key, unit]) => [key, unit.speed]))
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.segments)) return fallback;
      const markers = Array.isArray(saved.markers) ? saved.markers : [];
      const factions = normalizeFactionData(markers, saved.factions);
      return {
        ...fallback, ...saved,
        nodes: saved.nodes,
        segments: saved.segments,
        markers,
        customMarkerTypes: Array.isArray(saved.customMarkerTypes) ? saved.customMarkerTypes : [],
        factions,
        grid: { ...fallback.grid, ...(saved.grid || {}) },
        speeds: { ...fallback.speeds, ...(saved.speeds || {}) }
      };
    } catch { return fallback; }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function fillSelect(select, values) {
    select.innerHTML = Object.entries(values).map(([value, item]) => `<option value="${value}">${item.label}</option>`).join('');
  }

  const unitSelect = document.querySelector('#unitSelect');
  const weatherSelect = document.querySelector('#weatherSelect');
  const terrainSelect = document.querySelector('#terrainSelect');
  const gridTypeSelect = document.querySelector('#gridTypeSelect');
  const gridMilesInput = document.querySelector('#gridMilesInput');
  const markerLabelInput = document.querySelector('#markerLabelInput');
  const markerGarrisonInput = document.querySelector('#markerGarrisonInput');
  const markerLastSeenInput = document.querySelector('#markerLastSeenInput');
  const markerArmySpeedInput = document.querySelector('#markerArmySpeedInput');
  const markerArmySizeInput = document.querySelector('#markerArmySizeInput');
  const markerMovementRadiusInput = document.querySelector('#markerMovementRadiusInput');
  const markerFactionSelect = document.querySelector('#markerFactionSelect');
  const markerCommanderInput = document.querySelector('#markerCommanderInput');
  fillSelect(unitSelect, units);
  fillSelect(weatherSelect, weathers);
  fillSelect(terrainSelect, terrains);
  unitSelect.value = 'army';
  gridTypeSelect.value = state.grid.type;
  gridMilesInput.value = state.grid.miles;

  function setupSpeedSettings() {
    const holder = document.querySelector('#speedSettings');
    holder.innerHTML = Object.entries(units).map(([key, unit]) => `
      <label class="speed-row"><span>${unit.label}</span><input type="number" min="1" step="1" data-speed="${key}" value="${state.speeds[key]}"></label>
    `).join('');
    holder.oninput = event => {
      const key = event.target.dataset.speed;
      if (!key) return;
      state.speeds[key] = Math.max(1, Number(event.target.value) || units[key].speed);
      persist();
      calculateRoute();
    };
  }

  function resizeCanvas() {
    const rect = viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    draw();
  }

  function fitMap() {
    if (!image.naturalWidth) return;
    const rect = viewport.getBoundingClientRect();
    camera.scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight) * .96;
    camera.x = (rect.width - image.naturalWidth * camera.scale) / 2;
    camera.y = (rect.height - image.naturalHeight * camera.scale) / 2;
    draw();
  }

  function screenToMap(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.scale, y: (clientY - rect.top - camera.y) / camera.scale };
  }

  function rowLabel(index) {
    let label = '', value = index + 1;
    while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
    return label;
  }

  function drawGridLabel(text, x, y, cellScreenSize) {
    if (cellScreenSize < 31) return;
    const fontSize = 11 / camera.scale;
    ctx.font = `800 ${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 7 / camera.scale;
    const height = 16 / camera.scale;
    ctx.fillStyle = 'rgb(19 23 20 / 62%)';
    ctx.fillRect(x - width / 2, y - height / 2, width, height);
    ctx.fillStyle = '#fff0bd';
    ctx.fillText(text, x, y + .4 / camera.scale);
  }

  function drawGridOverlay() {
    const type = state.grid?.type || 'none';
    if (type === 'none' || !image.naturalWidth) return;
    const miles = Math.max(5, Number(state.grid.miles) || 24);
    const cell = miles / state.scale;
    if (!Number.isFinite(cell) || cell <= 0) return;
    const mapWidth = image.naturalWidth, mapHeight = image.naturalHeight;
    const screenSize = cell * camera.scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, mapWidth, mapHeight); ctx.clip();
    ctx.strokeStyle = '#f4d172'; ctx.lineWidth = 1.15 / camera.scale; ctx.globalAlpha = .56;

    if (type === 'square') {
      const columns = Math.ceil(mapWidth / cell), rows = Math.ceil(mapHeight / cell);
      ctx.beginPath();
      for (let column = 0; column <= columns; column++) { const x = Math.min(mapWidth, column * cell); ctx.moveTo(x, 0); ctx.lineTo(x, mapHeight); }
      for (let row = 0; row <= rows; row++) { const y = Math.min(mapHeight, row * cell); ctx.moveTo(0, y); ctx.lineTo(mapWidth, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      if (columns * rows <= 5000) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const cellLeft = column * cell, cellTop = row * cell;
        const x = cellLeft + Math.min(cell, mapWidth - cellLeft) / 2;
        const y = cellTop + Math.min(cell, mapHeight - cellTop) / 2;
        drawGridLabel(`${column + 1}${rowLabel(row)}`, x, y, screenSize);
      }
    }

    if (type === 'hex') {
      const radius = cell / 2;
      const hexHeight = Math.sqrt(3) * radius;
      const horizontalStep = 1.5 * radius;
      const columns = Math.ceil((mapWidth - radius) / horizontalStep) + 1;
      const rows = Math.ceil(mapHeight / hexHeight) + 1;
      const centers = [];
      ctx.beginPath();
      for (let column = 0; column < columns; column++) {
        const x = radius + column * horizontalStep;
        const offsetY = column % 2 ? hexHeight / 2 : 0;
        for (let row = 0; row < rows; row++) {
          const y = hexHeight / 2 + row * hexHeight + offsetY;
          if (x - radius > mapWidth || y - hexHeight / 2 > mapHeight) continue;
          centers.push({ x, y, column, row });
          for (let corner = 0; corner < 6; corner++) {
            const angle = corner * Math.PI / 3;
            const px = x + radius * Math.cos(angle), py = y + radius * Math.sin(angle);
            if (!corner) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
        }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      if (centers.length <= 5000) for (const center of centers) drawGridLabel(`${center.column + 1}${rowLabel(center.row)}`, center.x, center.y, screenSize);
    }
    ctx.restore();
  }

  function allMarkerTypes() {
    return [...DEFAULT_MARKER_TYPES, ...state.customMarkerTypes];
  }

  function factionForMarker(marker) {
    return state.factions.find(faction => faction.id === marker.factionId) || null;
  }

  function markerAppearance(marker) {
    const type = allMarkerTypes().find(item => item.id === marker.type);
    const faction = factionForMarker(marker);
    return {
      symbol: marker.symbol || type?.symbol || '•',
      color: faction?.color || marker.color || type?.color || '#d4a657',
      typeLabel: marker.typeLabel || type?.label || 'Позначка'
    };
  }

  function isArmyType(typeId) {
    return Boolean(allMarkerTypes().find(item => item.id === typeId)?.army || typeId === 'army');
  }

  function localDateTimeValue(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function inputDateTimeIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function elapsedText(iso, compact = false) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return 'час невідомий';
    const difference = Date.now() - time;
    if (difference < -60000) return 'вказано майбутній час';
    const minutes = Math.max(0, Math.floor(difference / 60000));
    if (minutes < 1) return 'щойно';
    if (minutes < 60) return `${minutes} хв тому`;
    const hours = Math.floor(minutes / 60), remainingMinutes = minutes % 60;
    if (hours < 24) return `${hours} год${compact || !remainingMinutes ? '' : ` ${remainingMinutes} хв`} тому`;
    const days = Math.floor(hours / 24), remainingHours = hours % 24;
    if (days < 60) return `${days} д${compact || !remainingHours ? '' : ` ${remainingHours} год`} тому`;
    const months = Math.floor(days / 30), remainingDays = days % 30;
    return `${months} міс${compact || !remainingDays ? '' : ` ${remainingDays} д`} тому`;
  }

  function exactDateTime(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return 'невідомо';
    return date.toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function drawArmyMovementRadius(marker) {
    if (!isArmyType(marker.type) || marker.showMovementRadius === false || !marker.lastSeenAt) return;
    const elapsedDays = Math.max(0, (Date.now() - Date.parse(marker.lastSeenAt)) / 86400000);
    const speed = Math.max(0, Number(marker.armySpeed) || 0);
    const radius = speed * elapsedDays / state.scale;
    if (!Number.isFinite(radius) || radius * camera.scale < 2) return;
    const { color } = markerAppearance(marker);
    ctx.save();
    ctx.beginPath(); ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha = .10; ctx.fill();
    ctx.globalAlpha = .58; ctx.strokeStyle = color; ctx.lineWidth = 1.5 / camera.scale;
    ctx.setLineDash([7 / camera.scale, 5 / camera.scale]); ctx.stroke();
    ctx.restore();
  }

  function fitCanvasText(text, maxWidth) {
    const value = String(text || '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    let fitted = value;
    while (fitted.length && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
    return `${fitted.trimEnd()}…`;
  }

  function drawMapMarker(marker, selected = false) {
    const { symbol, color, typeLabel } = markerAppearance(marker);
    const unit = 1 / camera.scale;
    const radius = 11 * unit;
    ctx.save();
    if (selected) {
      ctx.beginPath(); ctx.arc(marker.x, marker.y, 16 * unit, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(255 115 199 / 34%)'; ctx.fill();
      ctx.strokeStyle = '#ff73c7'; ctx.lineWidth = 2.5 * unit; ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(marker.x - 5 * unit, marker.y + 8 * unit);
    ctx.lineTo(marker.x, marker.y + 17 * unit);
    ctx.lineTo(marker.x + 5 * unit, marker.y + 8 * unit);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#24170f'; ctx.lineWidth = 2 * unit; ctx.stroke();
    ctx.beginPath(); ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fffaf0';
    ctx.font = `800 ${Math.min(symbol.length > 1 ? 11 : 14, 14) * unit}px "Segoe UI Symbol", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(symbol, marker.x, marker.y + .5 * unit);
    const isArmy = isArmyType(marker.type);
    const hasArmySize = isArmy && marker.armySize !== null && marker.armySize !== undefined && marker.armySize !== '';
    const hasGarrison = marker.garrison !== null && marker.garrison !== undefined && marker.garrison !== '';
    const title = marker.label || typeLabel;
    const lines = [];
    if (title) lines.push({ text: title, font: `700 ${12 * unit}px Inter, sans-serif`, color: '#fff3d6', height: 15 * unit });
    if (marker.expanded) {
      const faction = factionForMarker(marker);
      if (faction) lines.push({ text: `Фракція: ${faction.name}`, font: `600 ${10 * unit}px Inter, sans-serif`, color: faction.color, height: 12 * unit });
      if (isArmy && marker.commander) lines.push({ text: `Командир: ${marker.commander}`, font: `600 ${10 * unit}px Inter, sans-serif`, color: '#d7c8aa', height: 12 * unit });
      const strength = [];
      if (hasArmySize) strength.push(`Військо: ${Math.max(0, Math.round(Number(marker.armySize) || 0))}`);
      if (hasGarrison) strength.push(`Гарнізон: ${Math.max(0, Math.round(Number(marker.garrison) || 0))}`);
      if (strength.length) lines.push({ text: strength.join(' · '), font: `600 ${10 * unit}px Inter, sans-serif`, color: '#d7c8aa', height: 12 * unit });
      if (isArmy && marker.lastSeenAt) lines.push({ text: `Бачили: ${elapsedText(marker.lastSeenAt, true)}`, font: `600 ${10 * unit}px Inter, sans-serif`, color: '#e0bb77', height: 12 * unit });
    }
    if (lines.length) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const paddingX = 6 * unit, paddingY = 4 * unit, maxTextWidth = 220 * unit;
      let textWidth = 0;
      for (const line of lines) {
        ctx.font = line.font;
        line.text = fitCanvasText(line.text, maxTextWidth);
        textWidth = Math.max(textWidth, ctx.measureText(line.text).width);
      }
      const boxHeight = lines.reduce((sum, line) => sum + line.height, paddingY * 2);
      const left = marker.x + 15 * unit, top = marker.y - boxHeight / 2;
      ctx.fillStyle = 'rgb(24 21 16 / 88%)';
      ctx.fillRect(left, top, textWidth + paddingX * 2, boxHeight);
      ctx.strokeStyle = selected ? '#ff73c7' : 'rgb(240 219 171 / 55%)'; ctx.lineWidth = unit;
      ctx.strokeRect(left, top, textWidth + paddingX * 2, boxHeight);
      let lineTop = top + paddingY;
      for (const line of lines) {
        ctx.font = line.font; ctx.fillStyle = line.color;
        ctx.fillText(line.text, left + paddingX, lineTop + line.height / 2);
        lineTop += line.height;
      }
    }
    ctx.restore();
  }

  function drawSelectionRectangle(box) {
    const left = Math.min(box.start.x, box.current.x);
    const top = Math.min(box.start.y, box.current.y);
    const width = Math.abs(box.current.x - box.start.x);
    const height = Math.abs(box.current.y - box.start.y);
    ctx.save();
    ctx.fillStyle = 'rgb(117 242 160 / 14%)';
    ctx.strokeStyle = '#7df2a0';
    ctx.lineWidth = 2 / camera.scale;
    ctx.setLineDash([8 / camera.scale, 5 / camera.scale]);
    ctx.fillRect(left, top, width, height); ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!image.naturalWidth) return;
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);
    ctx.drawImage(image, 0, 0);
    drawGridOverlay();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const segment of state.segments) {
      strokePath(segment.points, '#54d8c8', 3.5 / camera.scale, .88);
      strokePath(segment.points, '#382519', .8 / camera.scale, .75);
    }

    for (const marker of state.markers) drawArmyMovementRadius(marker);
    for (const marker of state.markers) {
      const selected = activeTab === 'markers' && (marker.id === selectedMarkerId || selectedMarkerIds.has(marker.id));
      drawMapMarker(marker, selected);
    }

    if (activeTab === 'roads') {
      for (const node of state.nodes) {
        if (!node.auto || camera.scale > .55) drawMarker(node, '#e8b866', (node.auto ? 2.4 : 4.5) / camera.scale, false);
      }
      if (roadDraft.length) {
        strokePath(roadDraft, '#fff0ad', 3 / camera.scale, .95, [9 / camera.scale, 7 / camera.scale]);
        roadDraft.forEach((p, i) => drawMarker(p, i ? '#fff0ad' : '#70c18b', 4 / camera.scale, false));
      }
      const selectedRoad = state.segments.find(segment => segment.id === selectedRoadId);
      if (selectedRoad) {
        strokePath(selectedRoad.points, '#ff73c7', 6 / camera.scale, .92);
        strokePath(selectedRoad.points, '#4b1536', 1.2 / camera.scale, 1);
        selectedRoad.points.forEach((point, index) => drawMarker(point, index === 0 || index === selectedRoad.points.length - 1 ? '#ffb4df' : '#ffffff', 5 / camera.scale, true));
      }
      const selectedNode = state.nodes.find(node => node.id === selectedNodeId);
      if (selectedNode) drawMarker(selectedNode, '#ff73c7', 8 / camera.scale, true);
      for (const segment of state.segments) {
        if (!selectedRoadIds.has(segment.id)) continue;
        strokePath(segment.points, '#ff73c7', 6 / camera.scale, .88);
      }
      for (const node of state.nodes) {
        if (selectedNodeIds.has(node.id)) drawMarker(node, '#ff73c7', 7 / camera.scale, true);
      }
      const connectStart = state.nodes.find(node => node.id === connectStartNodeId);
      if (connectStart) drawMarker(connectStart, '#7df2a0', 9 / camera.scale, true);
      if (selectionBox) {
        drawSelectionRectangle(selectionBox);
      }
    }

    if (activeTab === 'markers' && selectionBox) drawSelectionRectangle(selectionBox);

    if (calibrationPoints.length) {
      strokePath(calibrationPoints, '#75dbff', 3 / camera.scale, 1, [8 / camera.scale, 6 / camera.scale]);
      calibrationPoints.forEach(p => drawMarker(p, '#75dbff', 6 / camera.scale, false));
    }

    if (routeResult?.points?.length) {
      strokePath(routeResult.points, '#1b120b', 8 / camera.scale, .72);
      strokePath(routeResult.points, ROUTE_COLOR, 4 / camera.scale, 1);
    } else if (routePoints.length > 1) {
      strokePath(routePoints, ROUTE_COLOR, 3 / camera.scale, 1, [9 / camera.scale, 6 / camera.scale]);
    }
    if (routePoints.length) drawMarker(routePoints[0], '#71d890', 8 / camera.scale, true);
    if (routePoints.length > 1) {
      routePoints.slice(1, -1).forEach(p => drawMarker(p, '#f0cb76', 5 / camera.scale, true));
      drawMarker(routePoints.at(-1), '#e76858', 8 / camera.scale, true);
    }
    ctx.restore();
  }

  function strokePath(points, color, width, alpha = 1, dash = []) {
    if (points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawMarker(point, color, radius, outlined) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (outlined) {
      ctx.strokeStyle = '#21150d';
      ctx.lineWidth = 3 / camera.scale;
      ctx.stroke();
    }
  }

  function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function polylineLength(points) { return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0); }

  function nearestNode(point, radiusPx = 15) {
    const radius = radiusPx / camera.scale;
    let best = null;
    for (const node of state.nodes) {
      const d = distance(point, node);
      if (d <= radius && (!best || d < best.distance)) best = { node, distance: d };
    }
    return best?.node || null;
  }

  function roadColorMask(imageData, width, height, tolerance) {
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    const ref = [90, 57, 29];
    const limit = tolerance * tolerance;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const dr = r - ref[0], dg = g - ref[1], db = b - ref[2];
      const colorDistance = .5 * dr * dr + .8 * dg * dg + .5 * db * db;
      if (colorDistance < limit && r > g + 12 && g > b + 8) mask[i] = 1;
    }

    // Remove tiny speckles before component analysis.
    const cleaned = mask.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (!mask[index]) continue;
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && mask[index + dy * width + dx]) neighbours++;
        }
        if (!neighbours) cleaned[index] = 0;
      }
    }
    return cleaned;
  }

  function retainLinearComponents(mask, width, height, profile) {
    const kept = new Uint8Array(mask.length);
    const seen = new Uint8Array(mask.length);
    const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
    let retainedComponents = 0;
    for (let start = width + 1; start < mask.length - width - 1; start++) {
      if (!mask[start] || seen[start]) continue;
      const component = [start];
      seen[start] = 1;
      let cursor = 0;
      let minX = start % width, maxX = minX, minY = Math.floor(start / width), maxY = minY;
      while (cursor < component.length) {
        const index = component[cursor++];
        const x = index % width, y = Math.floor(index / width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const offset of offsets) {
          const next = index + offset;
          if (!mask[next] || seen[next]) continue;
          const nx = next % width;
          if (Math.abs(nx - x) > 1) continue;
          seen[next] = 1; component.push(next);
        }
      }
      const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
      const diagonal = Math.hypot(boxWidth, boxHeight);
      const density = component.length / (boxWidth * boxHeight);
      const denseBlob = density > profile.maxDensity && boxWidth > profile.denseBox && boxHeight > profile.denseBox;
      // Long, thin components are likely roads. Dense brown masses are usually mountains.
      if (component.length >= profile.minComponent && diagonal >= profile.minDiagonal && !denseBlob) {
        retainedComponents++;
        component.forEach(index => kept[index] = 1);
      }
    }
    return { mask: kept, retainedComponents };
  }

  function thinMask(mask, width, height) {
    let active = [];
    for (let i = width + 1; i < mask.length - width - 1; i++) if (mask[i]) active.push(i);
    const neighbours = index => [
      mask[index - width], mask[index - width + 1], mask[index + 1], mask[index + width + 1],
      mask[index + width], mask[index + width - 1], mask[index - 1], mask[index - width - 1]
    ];
    for (let iteration = 0; iteration < 42; iteration++) {
      let removed = 0;
      for (let phase = 0; phase < 2; phase++) {
        const toRemove = [];
        for (const index of active) {
          if (!mask[index]) continue;
          const n = neighbours(index);
          const count = n.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let i = 0; i < 8; i++) if (!n[i] && n[(i + 1) % 8]) transitions++;
          if (transitions !== 1) continue;
          const conditionA = phase === 0 ? n[0] * n[2] * n[4] : n[0] * n[2] * n[6];
          const conditionB = phase === 0 ? n[2] * n[4] * n[6] : n[0] * n[4] * n[6];
          if (!conditionA && !conditionB) toRemove.push(index);
        }
        toRemove.forEach(index => mask[index] = 0);
        removed += toRemove.length;
      }
      if (!removed) break;
      active = active.filter(index => mask[index]);
    }
    return mask;
  }

  function simplifyPath(points, tolerance) {
    if (points.length <= 2) return points;
    const first = points[0], last = points.at(-1);
    const dx = last.x - first.x, dy = last.y - first.y;
    const denominator = dx * dx + dy * dy;
    let maxDistance = 0, splitAt = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const t = denominator ? Math.max(0, Math.min(1, ((points[i].x - first.x) * dx + (points[i].y - first.y) * dy) / denominator)) : 0;
      const projected = { x: first.x + t * dx, y: first.y + t * dy };
      const d = distance(points[i], projected);
      if (d > maxDistance) { maxDistance = d; splitAt = i; }
    }
    if (maxDistance <= tolerance) return [first, last];
    return [...simplifyPath(points.slice(0, splitAt + 1), tolerance).slice(0, -1), ...simplifyPath(points.slice(splitAt), tolerance)];
  }

  function vectorizeSkeleton(mask, width, height, scanScale, profile) {
    const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
    const degree = new Uint8Array(mask.length);
    for (let index = width + 1; index < mask.length - width - 1; index++) {
      if (!mask[index]) continue;
      for (const offset of offsets) if (mask[index + offset]) degree[index]++;
    }

    const clusterId = new Int32Array(mask.length); clusterId.fill(-1);
    const clusters = [];
    for (let start = width + 1; start < mask.length - width - 1; start++) {
      if (!mask[start] || degree[start] === 2 || clusterId[start] >= 0) continue;
      const id = clusters.length, pixels = [start]; clusterId[start] = id;
      let cursor = 0, sx = 0, sy = 0;
      while (cursor < pixels.length) {
        const index = pixels[cursor++], x = index % width, y = Math.floor(index / width);
        sx += x; sy += y;
        for (const offset of offsets) {
          const next = index + offset;
          if (mask[next] && degree[next] !== 2 && clusterId[next] < 0 && Math.abs(next % width - x) <= 1) {
            clusterId[next] = id; pixels.push(next);
          }
        }
      }
      clusters.push({ id, pixels, x: sx / pixels.length, y: sy / pixels.length });
    }

    const edgeKey = (a, b) => Math.min(a, b) * mask.length + Math.max(a, b);
    const visitedEdges = new Set();
    const rawSegments = [];
    for (const cluster of clusters) {
      for (const startPixel of cluster.pixels) {
        const startX = startPixel % width;
        for (const offset of offsets) {
          let current = startPixel + offset;
          if (!mask[current] || clusterId[current] === cluster.id || Math.abs(current % width - startX) > 1) continue;
          if (visitedEdges.has(edgeKey(startPixel, current))) continue;
          const path = [{ x: cluster.x, y: cluster.y }];
          let previous = startPixel, guard = 0, targetCluster = -1;
          while (guard++ < mask.length) {
            visitedEdges.add(edgeKey(previous, current));
            path.push({ x: current % width, y: Math.floor(current / width) });
            if (clusterId[current] >= 0) { targetCluster = clusterId[current]; break; }
            let next = -1;
            const cx = current % width;
            for (const nextOffset of offsets) {
              const candidate = current + nextOffset;
              if (candidate !== previous && mask[candidate] && Math.abs(candidate % width - cx) <= 1) { next = candidate; break; }
            }
            if (next < 0) break;
            previous = current; current = next;
          }
          if (targetCluster < 0 || targetCluster === cluster.id) continue;
          const target = clusters[targetCluster];
          path[path.length - 1] = { x: target.x, y: target.y };
          if (polylineLength(path) >= profile.minPath) rawSegments.push({ a: cluster.id, b: targetCluster, points: simplifyPath(path, 1.35) });
        }
      }
    }

    const usedClusters = new Set(rawSegments.flatMap(segment => [segment.a, segment.b]));
    const nodeIds = new Map();
    const nodes = clusters.filter(cluster => usedClusters.has(cluster.id)).map(cluster => {
      const id = uid('auto-node'); nodeIds.set(cluster.id, id);
      return { id, x: cluster.x / scanScale, y: cluster.y / scanScale, auto: true };
    });
    const segments = rawSegments.map(segment => ({
      id: uid('auto-road'), a: nodeIds.get(segment.a), b: nodeIds.get(segment.b), auto: true,
      points: segment.points.map(point => ({ x: point.x / scanScale, y: point.y / scanScale }))
    }));
    return { nodes, segments };
  }

  async function autoScanRoads() {
    if (state.segments.length && !confirm('Автосканування замінить поточну дорожню мережу. Продовжити?')) return;
    const button = document.querySelector('#autoScanButton');
    const status = document.querySelector('#scanStatus');
    button.disabled = true; status.hidden = false; status.classList.remove('error');
    status.textContent = 'Аналізую колір і форму ліній…';
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 20)));
    try {
      const targetWidth = 1200;
      const scanScale = Math.min(1, targetWidth / image.naturalWidth);
      const width = Math.round(image.naturalWidth * scanScale), height = Math.round(image.naturalHeight * scanScale);
      const scanCanvas = document.createElement('canvas'); scanCanvas.width = width; scanCanvas.height = height;
      const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
      scanContext.drawImage(image, 0, 0, width, height);
      const imageData = scanContext.getImageData(0, 0, width, height);
      const profileName = document.querySelector('#scanSensitivity').value;
      const profile = scanProfiles[profileName] || scanProfiles.normal;
      let mask = roadColorMask(imageData, width, height, profile.tolerance);
      const retained = retainLinearComponents(mask, width, height, profile); mask = thinMask(retained.mask, width, height);
      const result = vectorizeSkeleton(mask, width, height, scanScale, profile);
      if (!result.segments.length) throw new Error('дороги не знайдено — спробуйте вищу чутливість');
      state.nodes = result.nodes; state.segments = result.segments;
      selectedRoadId = null; selectedNodeId = null; selectedRoadIds.clear(); selectedNodeIds.clear(); connectStartNodeId = null; persist();
      routePoints = []; routeResult = null; updateRoadUI(); updateResult(); draw();
      status.textContent = `Готово (${profileName === 'high' ? 'агресивно' : profileName === 'low' ? 'обережно' : 'нормально'}): ${result.segments.length} ділянок і ${result.nodes.length} вузлів. Хибні лінії прибираються «Гумкою».`;
      showNotice(`Автосканування: знайдено ${result.segments.length} ділянок`);
    } catch (error) {
      status.classList.add('error'); status.textContent = `Помилка сканування: ${error.message}`;
    } finally { button.disabled = false; }
  }

  function finishRoad() {
    if (roadDraft.length < 2) return;
    const points = roadDraft.map(p => ({ x: p.x, y: p.y }));
    let startNode = nearestNode(points[0]);
    let endNode = nearestNode(points.at(-1));
    if (!startNode) { startNode = { id: uid('node'), ...points[0] }; state.nodes.push(startNode); }
    if (!endNode) { endNode = { id: uid('node'), ...points.at(-1) }; state.nodes.push(endNode); }
    points[0] = { x: startNode.x, y: startNode.y };
    points[points.length - 1] = { x: endNode.x, y: endNode.y };
    const segment = { id: uid('road'), a: startNode.id, b: endNode.id, points };
    state.segments.push(segment); selectedRoadId = segment.id; selectedNodeId = null;
    roadDraft = [];
    persist();
    updateRoadUI();
    draw();
    showNotice('Ділянку дороги збережено');
  }

  function projectToSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
    const projected = { x: a.x + t * dx, y: a.y + t * dy };
    return { point: projected, t, distance: distance(point, projected) };
  }

  function nearestRoadPoint(point) {
    let best = null;
    for (const segment of state.segments) {
      let cumulative = 0;
      for (let i = 0; i < segment.points.length - 1; i++) {
        const a = segment.points[i], b = segment.points[i + 1];
        const projection = projectToSegment(point, a, b);
        const along = cumulative + distance(a, b) * projection.t;
        if (!best || projection.distance < best.distance) {
          best = { ...projection, segmentId: segment.id, edgeIndex: i, along };
        }
        cumulative += distance(a, b);
      }
    }
    return best;
  }

  function nearestRoadHit(point, radiusPx = 16) {
    const nearest = nearestRoadPoint(point);
    if (!nearest || nearest.distance > radiusPx / camera.scale) return null;
    return { ...nearest, segment: state.segments.find(segment => segment.id === nearest.segmentId) };
  }

  function cleanOrphanNodes() {
    const usedNodes = new Set(state.segments.flatMap(segment => [segment.a, segment.b]));
    state.nodes = state.nodes.filter(node => usedNodes.has(node.id));
    selectedRoadIds = new Set([...selectedRoadIds].filter(id => state.segments.some(segment => segment.id === id)));
    selectedNodeIds = new Set([...selectedNodeIds].filter(id => state.nodes.some(node => node.id === id)));
  }

  function updateNodePosition(nodeId, point) {
    const node = state.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.x = point.x; node.y = point.y;
    for (const segment of state.segments) {
      if (segment.a === nodeId) segment.points[0] = { x: point.x, y: point.y };
      if (segment.b === nodeId) segment.points[segment.points.length - 1] = { x: point.x, y: point.y };
    }
  }

  function mergeNodes(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return targetId;
    const target = state.nodes.find(node => node.id === targetId);
    if (!target) return sourceId;
    for (const segment of state.segments) {
      if (segment.a === sourceId) { segment.a = targetId; segment.points[0] = { x: target.x, y: target.y }; }
      if (segment.b === sourceId) { segment.b = targetId; segment.points[segment.points.length - 1] = { x: target.x, y: target.y }; }
    }
    state.segments = state.segments.filter(segment => segment.a !== segment.b && polylineLength(segment.points) > .1);
    state.nodes = state.nodes.filter(node => node.id !== sourceId);
    selectedNodeId = targetId;
    showNotice('Ноди об’єднано');
    return targetId;
  }

  function splitRoadAt(point, quiet = false) {
    const existingNode = nearestNode(point, 11);
    if (existingNode) { selectedNodeId = existingNode.id; selectedRoadId = null; updateRoadUI(); draw(); return existingNode; }
    const hit = nearestRoadHit(point, 20);
    if (!hit?.segment) { if (!quiet) showNotice('Клацніть ближче до дороги'); return null; }
    const segment = hit.segment;
    const projection = { x: hit.point.x, y: hit.point.y };
    const first = segment.points[0], last = segment.points.at(-1);
    if (distance(projection, first) < 4 / camera.scale) return state.nodes.find(node => node.id === segment.a);
    if (distance(projection, last) < 4 / camera.scale) return state.nodes.find(node => node.id === segment.b);

    const node = { id: uid('node'), ...projection, auto: segment.auto };
    const leftPoints = segment.points.slice(0, hit.edgeIndex + 1).map(p => ({ ...p }));
    const rightPoints = segment.points.slice(hit.edgeIndex + 1).map(p => ({ ...p }));
    if (distance(leftPoints.at(-1), projection) > .01) leftPoints.push({ ...projection });
    else leftPoints[leftPoints.length - 1] = { ...projection };
    if (!rightPoints.length || distance(rightPoints[0], projection) > .01) rightPoints.unshift({ ...projection });
    else rightPoints[0] = { ...projection };
    const common = { auto: segment.auto };
    const left = { id: uid(segment.auto ? 'auto-road' : 'road'), a: segment.a, b: node.id, points: leftPoints, ...common };
    const right = { id: uid(segment.auto ? 'auto-road' : 'road'), a: node.id, b: segment.b, points: rightPoints, ...common };
    state.segments = state.segments.filter(item => item.id !== segment.id);
    state.segments.push(left, right); state.nodes.push(node);
    selectedRoadId = null; selectedNodeId = node.id;
    persist(); updateRoadUI(); draw();
    if (!quiet) showNotice('Нод додано — дорогу розділено на дві ділянки');
    return node;
  }

  function selectRoadAt(point) {
    selectedRoadIds.clear(); selectedNodeIds.clear();
    const node = nearestNode(point, 13);
    if (node) {
      selectedNodeId = node.id; selectedRoadId = null;
    } else {
      const hit = nearestRoadHit(point, 16);
      selectedRoadId = hit?.segment?.id || null; selectedNodeId = null;
    }
    updateRoadUI(); draw();
  }

  function pointInRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function lineIntersectsRect(a, b, rect) {
    if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
    const edges = [
      [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }],
      [{ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }],
      [{ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }],
      [{ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }]
    ];
    const orientation = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return edges.some(([c, d]) => orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b));
  }

  function applyBoxSelection(box) {
    const rect = {
      left: Math.min(box.start.x, box.current.x), right: Math.max(box.start.x, box.current.x),
      top: Math.min(box.start.y, box.current.y), bottom: Math.max(box.start.y, box.current.y)
    };
    if (!box.additive) { selectedRoadIds.clear(); selectedNodeIds.clear(); }
    selectedRoadId = null; selectedNodeId = null;
    for (const node of state.nodes) if (pointInRect(node, rect)) selectedNodeIds.add(node.id);
    for (const segment of state.segments) {
      let intersects = false;
      for (let i = 0; i < segment.points.length - 1 && !intersects; i++) intersects = lineIntersectsRect(segment.points[i], segment.points[i + 1], rect);
      if (intersects) selectedRoadIds.add(segment.id);
    }
    updateRoadUI(); draw();
    showNotice(`Виділено: ${selectedRoadIds.size} доріг, ${selectedNodeIds.size} нодів`);
  }

  function selectedGroupHit(point) {
    for (const node of state.nodes) if (selectedNodeIds.has(node.id) && distance(point, node) <= 15 / camera.scale) return true;
    for (const segment of state.segments) {
      if (!selectedRoadIds.has(segment.id)) continue;
      for (let i = 0; i < segment.points.length - 1; i++) if (projectToSegment(point, segment.points[i], segment.points[i + 1]).distance <= 15 / camera.scale) return true;
    }
    return false;
  }

  function createGroupDrag(point) {
    const roadIds = new Set(selectedRoadIds);
    const nodeIds = new Set(selectedNodeIds);
    for (const segment of state.segments) if (roadIds.has(segment.id)) { nodeIds.add(segment.a); nodeIds.add(segment.b); }
    return {
      type: 'group', start: point, moved: false, roadIds, nodeIds,
      nodes: new Map(state.nodes.filter(node => nodeIds.has(node.id)).map(node => [node.id, { x: node.x, y: node.y }])),
      roads: new Map(state.segments.filter(segment => roadIds.has(segment.id)).map(segment => [segment.id, segment.points.map(p => ({ ...p }))]))
    };
  }

  function moveSelectedGroup(drag, point) {
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    for (const node of state.nodes) {
      const original = drag.nodes.get(node.id);
      if (original) { node.x = original.x + dx; node.y = original.y + dy; }
    }
    for (const segment of state.segments) {
      const original = drag.roads.get(segment.id);
      if (original) segment.points = original.map(p => ({ x: p.x + dx, y: p.y + dy }));
      else {
        const startNode = drag.nodeIds.has(segment.a) ? state.nodes.find(node => node.id === segment.a) : null;
        const endNode = drag.nodeIds.has(segment.b) ? state.nodes.find(node => node.id === segment.b) : null;
        if (startNode) segment.points[0] = { x: startNode.x, y: startNode.y };
        if (endNode) segment.points[segment.points.length - 1] = { x: endNode.x, y: endNode.y };
      }
    }
  }

  function deleteSelection() {
    if (selectedRoadIds.size || selectedNodeIds.size) {
      state.segments = state.segments.filter(segment => !selectedRoadIds.has(segment.id) && !selectedNodeIds.has(segment.a) && !selectedNodeIds.has(segment.b));
      selectedRoadIds.clear(); selectedNodeIds.clear();
    } else if (selectedRoadId) {
      state.segments = state.segments.filter(segment => segment.id !== selectedRoadId);
      selectedRoadId = null;
    } else if (selectedNodeId) {
      const connected = state.segments.filter(segment => segment.a === selectedNodeId || segment.b === selectedNodeId).length;
      if (connected > 1 && !confirm(`Цей нод з’єднує ${connected} ділянок. Видалити їх усі?`)) return;
      state.segments = state.segments.filter(segment => segment.a !== selectedNodeId && segment.b !== selectedNodeId);
      selectedNodeId = null;
    } else { showNotice('Спочатку виберіть дорогу або нод'); return; }
    cleanOrphanNodes(); persist(); updateRoadUI(); draw(); showNotice('Вибране видалено');
  }

  function connectRoadAt(point) {
    const node = splitRoadAt(point, true);
    if (!node) { showNotice('Клацніть першу або другу дорогу'); return; }
    if (!connectStartNodeId) {
      connectStartNodeId = node.id; selectedNodeId = node.id;
      updateRoadUI(); draw(); return;
    }
    if (connectStartNodeId === node.id) { showNotice('Виберіть іншу дорогу'); return; }
    const start = state.nodes.find(item => item.id === connectStartNodeId);
    if (!start) { connectStartNodeId = node.id; return; }
    if (distance(start, node) < 5 / camera.scale) {
      mergeNodes(node.id, start.id);
    } else {
      const segment = { id: uid('road'), a: start.id, b: node.id, points: [{ x: start.x, y: start.y }, { x: node.x, y: node.y }] };
      state.segments.push(segment); selectedRoadId = segment.id; selectedNodeId = null;
      showNotice('Дороги з’єднано новою ділянкою');
    }
    connectStartNodeId = null; persist(); updateRoadUI(); draw();
  }

  function extensionSourceNodeId() {
    if (selectedNodeId) return selectedNodeId;
    if (selectedNodeIds.size === 1) return [...selectedNodeIds][0];
    return null;
  }

  function extendFromSelectedNode(point) {
    const sourceId = extensionSourceNodeId();
    const source = state.nodes.find(node => node.id === sourceId);
    if (!source) return false;

    let target = nearestNode(point, 13);
    if (!target) {
      const roadHit = nearestRoadHit(point, 18);
      if (roadHit) target = splitRoadAt(point, true);
    }
    if (!target) {
      target = { id: uid('node'), x: point.x, y: point.y };
      state.nodes.push(target);
    }
    if (target.id === source.id) { showNotice('Клацніть далі від вибраного нода'); return true; }

    const duplicate = state.segments.some(segment =>
      (segment.a === source.id && segment.b === target.id) || (segment.a === target.id && segment.b === source.id)
    );
    if (!duplicate) {
      state.segments.push({
        id: uid('road'), a: source.id, b: target.id,
        points: [{ x: source.x, y: source.y }, { x: target.x, y: target.y }]
      });
    }
    selectedRoadId = null; selectedRoadIds.clear(); selectedNodeIds.clear();
    selectedNodeId = target.id;
    persist(); updateRoadUI(); draw();
    showNotice(duplicate ? 'Ці ноди вже з’єднані' : 'Дорогу продовжено; новий кінцевий нод вибрано');
    return true;
  }

  function draggableRoadTarget(point) {
    const node = nearestNode(point, 13);
    if (node) return { type: 'node', nodeId: node.id };
    const selectedRoad = state.segments.find(segment => segment.id === selectedRoadId);
    if (!selectedRoad) return null;
    let best = null;
    selectedRoad.points.forEach((control, index) => {
      if (index === 0 || index === selectedRoad.points.length - 1) return;
      const d = distance(point, control);
      if (d <= 13 / camera.scale && (!best || d < best.distance)) best = { type: 'control', segmentId: selectedRoad.id, index, distance: d };
    });
    return best;
  }

  function eraseNearestRoad(point) {
    const brushRadius = 24 / camera.scale;
    const idsToErase = new Set();
    for (const segment of state.segments) {
      for (let i = 0; i < segment.points.length - 1; i++) {
        const projection = projectToSegment(point, segment.points[i], segment.points[i + 1]);
        if (projection.distance <= brushRadius) { idsToErase.add(segment.id); break; }
      }
    }
    if (!idsToErase.size) { showNotice('Поруч немає ділянки дороги'); return; }
    state.segments = state.segments.filter(segment => !idsToErase.has(segment.id));
    cleanOrphanNodes();
    if (idsToErase.has(selectedRoadId)) selectedRoadId = null;
    if (selectedNodeId && !state.nodes.some(node => node.id === selectedNodeId)) selectedNodeId = null;
    persist(); updateRoadUI(); draw(); showNotice(`Видалено ділянок: ${idsToErase.size}`);
  }

  function markerHitTest(point, marker, radiusPx = 18) {
    const unit = 1 / camera.scale;
    if (distance(point, marker) <= radiusPx * unit) return true;
    const labelLeft = marker.x + 13 * unit;
    const labelRight = labelLeft + 234 * unit;
    const halfHeight = (marker.expanded ? 43 : 14) * unit;
    return point.x >= labelLeft && point.x <= labelRight && point.y >= marker.y - halfHeight && point.y <= marker.y + halfHeight;
  }

  function nearestMapMarker(point, radiusPx = 18) {
    let best = null;
    for (const marker of state.markers) {
      const d = distance(point, marker);
      if (markerHitTest(point, marker, radiusPx) && (!best || d < best.distance)) best = { marker, distance: d };
    }
    return best?.marker || null;
  }

  function toggleMarkerExpanded(marker) {
    if (!marker) return false;
    marker.expanded = !marker.expanded;
    persist(); draw();
    return true;
  }

  function markerSnapshot(typeId = selectedMarkerType) {
    const type = allMarkerTypes().find(item => item.id === typeId) || DEFAULT_MARKER_TYPES[0];
    return { type: type.id, typeLabel: type.label, symbol: type.symbol, color: type.color };
  }

  function placeMarker(point) {
    const now = new Date().toISOString();
    const army = isArmyType(selectedMarkerType);
    const marker = {
      id: uid('marker'), x: point.x, y: point.y,
      label: markerLabelInput.value.trim(),
      garrison: army || markerGarrisonInput.value === '' ? null : Math.max(0, Math.round(Number(markerGarrisonInput.value) || 0)),
      createdAt: now,
      lastSeenAt: inputDateTimeIso(markerLastSeenInput.value) || (army ? now : null),
      factionId: markerFactionSelect.value || null,
      commander: army ? markerCommanderInput.value.trim() : '',
      armySize: army && markerArmySizeInput.value !== '' ? Math.max(0, Math.round(Number(markerArmySizeInput.value) || 0)) : null,
      armySpeed: army ? Math.max(0, Number(markerArmySpeedInput.value) || 0) : null,
      showMovementRadius: army ? markerMovementRadiusInput.checked : false,
      expanded: false,
      ...markerSnapshot()
    };
    state.markers.push(marker);
    markerLabelInput.value = ''; markerGarrisonInput.value = '';
    if (army) markerLastSeenInput.value = localDateTimeValue(now);
    persist(); updateMarkerUI(); draw();
    showNotice(`${marker.typeLabel}${marker.label ? ` «${marker.label}»` : ''} додано`);
  }

  function selectMarkerAt(point) {
    selectedMarkerIds.clear();
    const marker = nearestMapMarker(point);
    selectedMarkerId = marker?.id || null;
    if (marker) {
      selectedMarkerType = marker.type;
      populateMarkerFields(marker);
    } else {
      clearMarkerFields();
    }
    renderMarkerPalette(); updateMarkerUI(); draw();
  }

  function applyMarkerBoxSelection(box) {
    const rect = {
      left: Math.min(box.start.x, box.current.x), right: Math.max(box.start.x, box.current.x),
      top: Math.min(box.start.y, box.current.y), bottom: Math.max(box.start.y, box.current.y)
    };
    if (!box.additive) selectedMarkerIds.clear();
    selectedMarkerId = null;
    for (const marker of state.markers) if (pointInRect(marker, rect)) selectedMarkerIds.add(marker.id);
    clearMarkerFields();
    renderMarkerPalette(); updateMarkerUI(); draw();
    showNotice(`Виділено позначок: ${selectedMarkerIds.size}`);
  }

  function selectedMarkerGroupHit(point) {
    return state.markers.some(marker => selectedMarkerIds.has(marker.id) && distance(point, marker) <= 18 / camera.scale);
  }

  function createMarkerGroupDrag(point) {
    const clickedMarker = nearestMapMarker(point);
    return {
      type: 'marker-group', start: point, moved: false,
      toggleMarkerId: clickedMarker?.id || null,
      markers: new Map(state.markers.filter(marker => selectedMarkerIds.has(marker.id)).map(marker => [marker.id, { x: marker.x, y: marker.y }]))
    };
  }

  function moveMarkerDrag(drag, point) {
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    for (const marker of state.markers) {
      const original = drag.markers.get(marker.id);
      if (original) { marker.x = original.x + dx; marker.y = original.y + dy; }
    }
  }

  function deleteSelectedMarkers() {
    const ids = new Set(selectedMarkerIds);
    if (selectedMarkerId) ids.add(selectedMarkerId);
    if (!ids.size) { showNotice('Спочатку виберіть позначку'); return; }
    state.markers = state.markers.filter(marker => !ids.has(marker.id));
    selectedMarkerId = null; selectedMarkerIds.clear(); clearMarkerFields();
    persist(); updateMarkerUI(); draw(); showNotice(`Видалено позначок: ${ids.size}`);
  }

  function setMarkerType(typeId) {
    const type = allMarkerTypes().find(item => item.id === typeId);
    if (!type) return;
    selectedMarkerType = typeId;
    const ids = new Set(selectedMarkerIds);
    if (selectedMarkerId) ids.add(selectedMarkerId);
    if (ids.size) {
      for (const marker of state.markers) if (ids.has(marker.id)) {
        const wasArmy = isArmyType(marker.type);
        Object.assign(marker, markerSnapshot(typeId));
        if (isArmyType(typeId)) {
          if (!wasArmy && marker.armySize == null) marker.armySize = marker.garrison;
          if (!wasArmy) marker.garrison = null;
          marker.lastSeenAt ||= new Date().toISOString();
          marker.armySpeed ??= 24;
          marker.showMovementRadius ??= true;
        } else if (wasArmy && marker.garrison == null) {
          marker.garrison = marker.armySize;
        }
      }
      persist(); draw();
    }
    if (isArmyType(typeId) && !markerLastSeenInput.value) markerLastSeenInput.value = localDateTimeValue(new Date().toISOString());
    const selectedMarker = selectedMarkerId ? state.markers.find(marker => marker.id === selectedMarkerId) : null;
    if (selectedMarker) populateMarkerFields(selectedMarker);
    renderMarkerPalette(); updateMarkerUI();
  }

  function clearMarkerFields() {
    markerLabelInput.value = '';
    markerGarrisonInput.value = '';
    markerLastSeenInput.value = '';
    markerFactionSelect.value = '';
    markerCommanderInput.value = '';
    markerArmySizeInput.value = '';
    markerArmySpeedInput.value = 24;
    markerMovementRadiusInput.checked = true;
  }

  function populateMarkerFields(marker) {
    markerLabelInput.value = marker.label || '';
    markerGarrisonInput.value = marker.garrison ?? '';
    markerLastSeenInput.value = localDateTimeValue(marker.lastSeenAt);
    markerFactionSelect.value = marker.factionId || '';
    markerCommanderInput.value = marker.commander || '';
    markerArmySizeInput.value = marker.armySize ?? '';
    markerArmySpeedInput.value = marker.armySpeed ?? 24;
    markerMovementRadiusInput.checked = marker.showMovementRadius !== false;
  }

  function updateSelectedMarkerFromForm() {
    if (!selectedMarkerId || markerTool !== 'select') return;
    const marker = state.markers.find(item => item.id === selectedMarkerId);
    if (!marker) return;
    marker.label = markerLabelInput.value.trim();
    marker.factionId = markerFactionSelect.value || null;
    if (isArmyType(marker.type)) {
      marker.garrison = null;
      marker.lastSeenAt = inputDateTimeIso(markerLastSeenInput.value);
      marker.commander = markerCommanderInput.value.trim();
      marker.armySize = markerArmySizeInput.value === '' ? null : Math.max(0, Math.round(Number(markerArmySizeInput.value) || 0));
      marker.armySpeed = Math.max(0, Number(markerArmySpeedInput.value) || 0);
      marker.showMovementRadius = markerMovementRadiusInput.checked;
    } else {
      marker.garrison = markerGarrisonInput.value === '' ? null : Math.max(0, Math.round(Number(markerGarrisonInput.value) || 0));
    }
    persist(); updateMarkerTimeStatus(); draw();
  }

  function updateMarkerTimeStatus() {
    const status = document.querySelector('#markerTimeStatus');
    const marker = selectedMarkerId ? state.markers.find(item => item.id === selectedMarkerId) : null;
    if (markerTool !== 'select' || !marker) {
      status.textContent = isArmyType(selectedMarkerType)
        ? 'Час створення запишеться автоматично. Якщо поле спостереження порожнє, для армії буде використано поточний час.'
        : 'Час створення запишеться автоматично. Час спостереження можна вказати за потреби.';
      return;
    }
    const parts = [`Створено: <strong>${exactDateTime(marker.createdAt)}</strong>`];
    if (marker.lastSeenAt) parts.push(`Востаннє бачили: <strong>${exactDateTime(marker.lastSeenAt)}</strong> (${elapsedText(marker.lastSeenAt)})`);
    if (isArmyType(marker.type) && marker.lastSeenAt) {
      const days = Math.max(0, (Date.now() - Date.parse(marker.lastSeenAt)) / 86400000);
      const possibleMiles = Math.max(0, Number(marker.armySpeed) || 0) * days;
      parts.push(`Можливе віддалення: <strong>до ${possibleMiles.toFixed(1)} миль</strong>`);
    }
    status.innerHTML = parts.join('<br>');
  }

  function renderMarkerPalette() {
    const palette = document.querySelector('#markerPalette');
    palette.innerHTML = '';
    for (const type of allMarkerTypes()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'marker-type'; button.dataset.markerType = type.id;
      button.title = type.label;
      const symbol = document.createElement('span');
      symbol.className = 'marker-type-symbol'; symbol.style.background = type.color; symbol.textContent = type.symbol;
      const label = document.createElement('span'); label.textContent = type.label;
      button.append(symbol, label);
      button.classList.toggle('active', type.id === selectedMarkerType);
      button.addEventListener('click', () => setMarkerType(type.id));
      palette.append(button);
    }
  }

  function renderFactionSelect(preferredValue = markerFactionSelect.value) {
    markerFactionSelect.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = 'Без фракції'; markerFactionSelect.append(empty);
    for (const faction of state.factions) {
      const option = document.createElement('option');
      option.value = faction.id; option.textContent = faction.name || 'Без назви';
      markerFactionSelect.append(option);
    }
    markerFactionSelect.value = state.factions.some(faction => faction.id === preferredValue) ? preferredValue : '';
  }

  function renderFactionManager() {
    const holder = document.querySelector('#factionManagerList');
    holder.innerHTML = '';
    if (!state.factions.length) {
      const empty = document.createElement('div');
      empty.className = 'faction-manager-empty'; empty.textContent = 'Фракцій ще немає'; holder.append(empty); return;
    }
    for (const faction of state.factions) {
      let committedName = faction.name;
      const row = document.createElement('div'); row.className = 'faction-row';
      const nameInput = document.createElement('input');
      nameInput.type = 'text'; nameInput.maxLength = 60; nameInput.value = faction.name; nameInput.setAttribute('aria-label', `Назва фракції ${faction.name}`);
      const colorInput = document.createElement('input');
      colorInput.type = 'color'; colorInput.value = faction.color; colorInput.setAttribute('aria-label', `Колір фракції ${faction.name}`);
      const removeButton = document.createElement('button');
      removeButton.type = 'button'; removeButton.className = 'faction-delete'; removeButton.textContent = '×'; removeButton.title = `Видалити ${faction.name}`;
      nameInput.addEventListener('input', () => {
        faction.name = nameInput.value;
        persist(); renderFactionSelect(markerFactionSelect.value); draw();
      });
      nameInput.addEventListener('change', () => {
        const candidate = nameInput.value.trim() || 'Без назви';
        const duplicate = state.factions.some(item => item.id !== faction.id && item.name.localeCompare(candidate, 'uk', { sensitivity: 'accent' }) === 0);
        if (duplicate) {
          faction.name = committedName; nameInput.value = committedName;
          showNotice(`Фракція «${candidate}» вже є у списку`);
        } else {
          faction.name = candidate; committedName = candidate; nameInput.value = candidate;
        }
        persist(); renderFactionSelect(markerFactionSelect.value); draw();
      });
      colorInput.addEventListener('input', () => {
        faction.color = colorInput.value; persist(); draw();
      });
      removeButton.addEventListener('click', () => {
        const linked = state.markers.filter(marker => marker.factionId === faction.id).length;
        if (!confirm(`Видалити фракцію «${faction.name}»? ${linked ? `Позначки, що її використовують (${linked}), залишаться без фракції.` : ''}`)) return;
        state.factions = state.factions.filter(item => item.id !== faction.id);
        for (const marker of state.markers) if (marker.factionId === faction.id) marker.factionId = null;
        persist(); renderFactionSelect(); renderFactionManager(); updateMarkerUI(); draw();
      });
      row.append(nameInput, colorInput, removeButton); holder.append(row);
    }
  }

  function renderFactions(preferredValue = markerFactionSelect.value) {
    renderFactionSelect(preferredValue); renderFactionManager();
  }

  function updateMarkerUI() {
    const count = state.markers.length;
    document.querySelector('#markerCount').textContent = `${count} ${count === 1 ? 'позначка' : 'позначок'}`;
    document.querySelectorAll('[data-marker-tool]').forEach(button => button.classList.toggle('active', button.dataset.markerTool === markerTool));
    const selectionCount = selectedMarkerIds.size + (selectedMarkerId ? 1 : 0);
    const selectionBar = document.querySelector('#markerSelectionBar');
    selectionBar.hidden = markerTool !== 'select' || !selectionCount;
    document.querySelector('#markerSelectionText').textContent = selectionCount === 1 ? 'Вибрано одну позначку' : `Вибрано: ${selectionCount}`;
    markerLabelInput.disabled = markerTool === 'select' && selectionCount !== 1;
    [markerGarrisonInput, markerLastSeenInput, markerArmySpeedInput, markerArmySizeInput, markerMovementRadiusInput, markerFactionSelect, markerCommanderInput].forEach(input => {
      input.disabled = markerTool === 'select' && selectionCount !== 1;
    });
    document.querySelector('#markerSeenNowButton').disabled = markerTool === 'select' && selectionCount !== 1;
    const armyMode = isArmyType(selectedMarkerType);
    document.querySelector('#regularMarkerFields').hidden = armyMode;
    document.querySelector('#armyTrackingFields').hidden = !armyMode;
    markerLabelInput.placeholder = markerTool === 'select' ? (selectionCount === 1 ? 'Змініть назву вибраної позначки' : 'Виберіть одну позначку') : 'Наприклад, Форт Північний';
    const text = markerTool === 'place'
      ? 'Оберіть тип і клацніть місце на карті. Клік по наявній позначці розгортає або згортає її.'
      : selectionCount ? 'Клік розгортає подробиці; перетягування рухає позначку. Delete видаляє.' : 'Клік — вибрати й розгорнути. Протягніть рамку — групове виділення. Shift додає до вибраного.';
    document.querySelector('#markerInstruction').innerHTML = `<span class="step-number">1</span>${text}`;
    updateMarkerTimeStatus();
  }

  function setMarkerTool(tool) {
    markerTool = tool; selectionBox = null; markerDrag = null;
    if (tool === 'place') {
      selectedMarkerId = null; selectedMarkerIds.clear(); clearMarkerFields();
      if (isArmyType(selectedMarkerType)) markerLastSeenInput.value = localDateTimeValue(new Date().toISOString());
    }
    updateMarkerUI(); draw();
  }

  function buildRoadGraph(snaps) {
    const graph = new Map();
    const positions = new Map();
    const addVertex = (id, point) => { if (!graph.has(id)) graph.set(id, []); positions.set(id, point); };
    const addEdge = (a, b, miles, points) => {
      graph.get(a).push({ to: b, miles, points });
      graph.get(b).push({ to: a, miles, points: [...points].reverse() });
    };

    for (const segment of state.segments) {
      const segmentSnaps = snaps.filter(s => s.segmentId === segment.id);
      const chain = [];
      let cumulative = 0;
      chain.push({ id: `${segment.id}:0`, along: 0, point: segment.points[0] });
      for (let i = 1; i < segment.points.length; i++) {
        cumulative += distance(segment.points[i - 1], segment.points[i]);
        chain.push({ id: `${segment.id}:${i}`, along: cumulative, point: segment.points[i] });
      }
      segmentSnaps.forEach(s => chain.push({ id: s.id, along: s.along, point: s.point }));
      chain.sort((a, b) => a.along - b.along);
      const unique = chain.filter((item, i) => !i || item.id !== chain[i - 1].id);
      unique.forEach(item => addVertex(item.id, item.point));
      for (let i = 1; i < unique.length; i++) {
        const a = unique[i - 1], b = unique[i];
        addEdge(a.id, b.id, (b.along - a.along) * state.scale, [a.point, b.point]);
      }
      const startGraphId = `${segment.id}:0`;
      const endGraphId = `${segment.id}:${segment.points.length - 1}`;
      const startNodeGraphId = `node:${segment.a}`;
      const endNodeGraphId = `node:${segment.b}`;
      addVertex(startNodeGraphId, segment.points[0]);
      addVertex(endNodeGraphId, segment.points.at(-1));
      addEdge(startGraphId, startNodeGraphId, 0, [segment.points[0], segment.points[0]]);
      addEdge(endGraphId, endNodeGraphId, 0, [segment.points.at(-1), segment.points.at(-1)]);
    }
    return { graph, positions };
  }

  function fastestPath(startId, endId, graph, roadSpeed) {
    const dist = new Map();
    const previous = new Map();
    const visited = new Set();
    const heap = [];
    const push = item => {
      heap.push(item);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent].cost <= item.cost) break;
        heap[index] = heap[parent]; index = parent;
      }
      heap[index] = item;
    };
    const pop = () => {
      const root = heap[0], tail = heap.pop();
      if (heap.length && tail) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1, right = left + 1;
          if (left >= heap.length) break;
          const child = right < heap.length && heap[right].cost < heap[left].cost ? right : left;
          if (heap[child].cost >= tail.cost) break;
          heap[index] = heap[child]; index = child;
        }
        heap[index] = tail;
      }
      return root;
    };
    dist.set(startId, 0);
    push({ id: startId, cost: 0 });
    while (heap.length) {
      const entry = pop(), current = entry.id;
      if (visited.has(current) || entry.cost !== dist.get(current)) continue;
      visited.add(current);
      if (current === endId) break;
      for (const edge of graph.get(current) || []) {
        if (visited.has(edge.to)) continue;
        const candidate = dist.get(current) + edge.miles / roadSpeed;
        if (candidate < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, candidate);
          previous.set(edge.to, { from: current, edge });
          push({ id: edge.to, cost: candidate });
        }
      }
    }
    if (!Number.isFinite(dist.get(endId))) return null;
    const edges = [];
    let cursor = endId;
    while (cursor !== startId) {
      const step = previous.get(cursor);
      if (!step) return null;
      edges.unshift(step.edge);
      cursor = step.from;
    }
    return { days: dist.get(endId), edges };
  }

  function calculateRoute() {
    routeResult = null;
    const routeMode = document.querySelector('#routeModeSelect').value;
    if (routeMode === 'offroad') {
      if (routePoints.length < 2) return updateResult();
      const miles = polylineLength(routePoints) * state.scale;
      const speed = effectiveSpeed('offroad');
      routeResult = { points: [...routePoints], roadMiles: 0, offroadMiles: miles, days: miles / speed };
      updateResult(); draw(); return;
    }
    if (routePoints.length < 2 || !state.segments.length) return updateResult();
    const start = routePoints[0], end = routePoints[1];
    const startSnap = { ...nearestRoadPoint(start), id: 'route:start' };
    const endSnap = { ...nearestRoadPoint(end), id: 'route:end' };
    if (!startSnap.point || !endSnap.point) return updateResult();
    const roadSpeed = effectiveSpeed('road');
    const { graph } = buildRoadGraph([startSnap, endSnap]);
    const path = fastestPath(startSnap.id, endSnap.id, graph, roadSpeed);
    if (!path) {
      routeResult = { error: 'Між цими дорогами немає з’єднання. Додайте ділянку на перехресті.' };
      return updateResult();
    }
    const roadPoints = path.edges.flatMap((edge, i) => i ? edge.points.slice(1) : edge.points);
    const roadMiles = path.edges.reduce((sum, edge) => sum + edge.miles, 0);
    const offroadMiles = (distance(start, startSnap.point) + distance(end, endSnap.point)) * state.scale;
    const offroadDays = offroadMiles / effectiveSpeed('offroad');
    routeResult = {
      points: [start, startSnap.point, ...roadPoints, endSnap.point, end],
      roadMiles, offroadMiles, days: path.days + offroadDays,
      warning: offroadMiles > 10 ? 'Старт або фініш далеко від дороги; підхід враховано як рівнину.' : ''
    };
    updateResult(); draw();
  }

  function effectiveSpeed(kind) {
    const base = state.speeds[unitSelect.value];
    const march = marchModifiers[document.querySelector('#marchSelect').value];
    const weather = weathers[weatherSelect.value][kind];
    const terrain = kind === 'road' ? 1 : terrains[terrainSelect.value].modifier;
    return base * march * weather * terrain;
  }

  function formatDuration(days) {
    const totalHours = Math.max(0, Math.round(days * 24));
    const d = Math.floor(totalHours / 24), h = totalHours % 24;
    return d ? `${d} дн ${h} год` : `${h} год`;
  }

  function updateResult() {
    const card = document.querySelector('#resultCard');
    const placeholder = card.querySelector('.result-placeholder');
    const content = card.querySelector('.result-content');
    const warning = document.querySelector('#routeWarning');
    if (!routeResult) {
      card.classList.add('empty'); placeholder.hidden = false; content.hidden = true; return;
    }
    if (routeResult.error) {
      card.classList.remove('empty'); placeholder.hidden = true; content.hidden = false;
      document.querySelector('#resultTime').textContent = 'Маршруту немає';
      ['#resultDistance', '#resultRoad', '#resultOffroad', '#resultSpeed'].forEach(id => document.querySelector(id).textContent = '—');
      warning.hidden = false; warning.textContent = routeResult.error; return;
    }
    const totalMiles = routeResult.roadMiles + routeResult.offroadMiles;
    card.classList.remove('empty'); placeholder.hidden = true; content.hidden = false;
    document.querySelector('#resultTime').textContent = formatDuration(routeResult.days);
    document.querySelector('#resultDistance').textContent = `${totalMiles.toFixed(1)} миль`;
    document.querySelector('#resultRoad').textContent = `${routeResult.roadMiles.toFixed(1)} миль`;
    document.querySelector('#resultOffroad').textContent = `${routeResult.offroadMiles.toFixed(1)} миль`;
    document.querySelector('#resultSpeed').textContent = `${(totalMiles / routeResult.days || 0).toFixed(1)} миль/добу`;
    warning.hidden = !routeResult.warning; warning.textContent = routeResult.warning || '';
  }

  function updateRouteInstruction() {
    const element = document.querySelector('#routeInstruction');
    const mode = document.querySelector('#routeModeSelect').value;
    if (mode === 'road') {
      const text = routePoints.length === 0 ? 'Клацніть початкову точку на карті.' : routePoints.length === 1 ? 'Клацніть пункт призначення.' : 'Маршрут готовий. Клацніть ще раз, щоб почати новий.';
      element.innerHTML = `<span class="step-number">${Math.min(routePoints.length + 1, 3)}</span>${text}`;
    } else {
      element.innerHTML = `<span class="step-number">${routePoints.length + 1}</span>${routePoints.length ? 'Додавайте проміжні точки — результат оновлюється одразу.' : 'Клацніть старт ручного маршруту.'}`;
    }
  }

  function updateRoadUI() {
    const count = state.segments.length;
    document.querySelector('#roadCount').textContent = `${count} ${count === 1 ? 'ділянка' : 'ділянок'}`;
    document.querySelector('#finishRoadButton').disabled = roadDraft.length < 2;
    document.querySelector('#undoRoadButton').disabled = !roadDraft.length;
    document.querySelector('#cancelRoadButton').disabled = !roadDraft.length;
    document.querySelector('#drawControls').hidden = roadTool !== 'draw';
    document.querySelectorAll('[data-road-tool]').forEach(button => button.classList.toggle('active', button.dataset.roadTool === roadTool));
    let text = '';
    if (roadTool === 'draw') text = !roadDraft.length ? 'Клацніть початок дороги.' : roadDraft.length === 1 ? 'Проклікуйте дорогу вздовж вигинів.' : 'Продовжуйте або завершіть ділянку.';
    if (roadTool === 'select') text = selectedNodeIds.size || selectedRoadIds.size ? 'Перетягніть будь-який елемент групи, щоб перемістити все виділення.' : selectedNodeId ? 'Перетягуйте нод або продовжуйте від нього дорогу середньою кнопкою миші.' : selectedRoadId ? 'Дорогу вибрано. Перетягуйте її білі точки або видаліть всю ділянку.' : 'Клік — один елемент. Протягніть рамку по порожньому місцю — групове виділення. Shift додає до групи.';
    if (roadTool === 'add-node') text = 'Клацніть будь-де на дорозі, щоб вставити графовий нод і розділити ділянку.';
    if (roadTool === 'connect') text = connectStartNodeId ? 'Тепер клацніть другу дорогу або нод.' : 'Клацніть першу дорогу, а потім другу — між ними з’явиться з’єднання.';
    if (roadTool === 'erase') text = 'Клацайте зайві лінії. Широка гумка видаляє кілька близьких фрагментів.';
    document.querySelector('#roadInstruction').innerHTML = `<span class="step-number">${roadTool === 'connect' && connectStartNodeId ? 2 : 1}</span>${text}`;

    const selectionBar = document.querySelector('#selectionBar');
    const hasSelection = Boolean(selectedRoadId || selectedNodeId || selectedRoadIds.size || selectedNodeIds.size);
    selectionBar.hidden = roadTool !== 'select' || !hasSelection;
    if (hasSelection) {
      const segment = state.segments.find(item => item.id === selectedRoadId);
      const connected = selectedNodeId ? state.segments.filter(item => item.a === selectedNodeId || item.b === selectedNodeId).length : 0;
      document.querySelector('#selectionText').textContent = selectedRoadIds.size || selectedNodeIds.size ? `${selectedRoadIds.size} доріг · ${selectedNodeIds.size} нодів` : segment ? `Дорога · ${segment.points.length} точок` : `Нод · ${connected} з’єднань`;
    }
  }

  function setRoadTool(tool) {
    roadTool = tool;
    selectionBox = null;
    if (tool !== 'draw') roadDraft = [];
    if (tool !== 'connect') connectStartNodeId = null;
    updateRoadUI(); draw();
  }

  function updateScaleUI() {
    document.querySelector('#scaleValue').textContent = `1 px = ${state.scale.toFixed(4)} милі`;
    updateGridUI();
  }

  function updateGridUI() {
    const type = state.grid.type;
    const miles = Math.max(5, Number(state.grid.miles) || 24);
    gridTypeSelect.value = type; gridMilesInput.value = miles;
    gridMilesInput.disabled = type === 'none';
    const status = document.querySelector('#gridStatus');
    if (type === 'none') { status.textContent = 'Сітку вимкнено'; return; }
    const cellPx = miles / state.scale;
    const columns = type === 'square' ? Math.ceil(image.naturalWidth / cellPx) : Math.ceil(image.naturalWidth / (cellPx * .75));
    const rows = type === 'square' ? Math.ceil(image.naturalHeight / cellPx) : Math.ceil(image.naturalHeight / (cellPx * Math.sqrt(3) / 2));
    status.textContent = `${type === 'hex' ? 'Гекси' : 'Клітинки'}: ${miles} миль · приблизно ${columns} × ${rows}`;
  }

  function showNotice(message) {
    const notice = document.querySelector('#mapNotice');
    notice.textContent = message; notice.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.hidden = true, 2800);
  }

  function handleMapClick(point, detail) {
    if (calibrating) {
      calibrationPoints.push(point);
      if (calibrationPoints.length === 2) {
        const pixels = distance(calibrationPoints[0], calibrationPoints[1]);
        const miles = Math.max(.1, Number(document.querySelector('#scaleMilesInput').value) || 48);
        state.scale = miles / pixels; persist(); calibrating = false; updateScaleUI();
        showNotice(`Масштаб збережено: ${pixels.toFixed(0)} px = ${miles} миль`);
        setTimeout(() => { calibrationPoints = []; draw(); }, 900);
      }
      draw(); return;
    }
    const clickedMarker = nearestMapMarker(point);
    if (clickedMarker && !(activeTab === 'markers' && markerTool === 'select')) {
      toggleMarkerExpanded(clickedMarker);
      return;
    }
    if (activeTab === 'roads') {
      if (roadTool === 'erase') { eraseNearestRoad(point); return; }
      if (roadTool === 'select') { selectRoadAt(point); return; }
      if (roadTool === 'add-node') { splitRoadAt(point); return; }
      if (roadTool === 'connect') { connectRoadAt(point); return; }
      if (roadTool === 'draw') {
        if (detail === 2 && roadDraft.length >= 2 && distance(roadDraft.at(-1), point) < 6 / camera.scale) {
          finishRoad(); return;
        }
        const snap = nearestNode(point);
        roadDraft.push(snap ? { x: snap.x, y: snap.y } : point);
        updateRoadUI(); draw();
        if (detail === 2 && roadDraft.length >= 2) finishRoad();
      }
      return;
    }
    if (activeTab === 'markers') {
      if (markerTool === 'place') placeMarker(point);
      else selectMarkerAt(point);
      return;
    }
    if (activeTab !== 'route') return;
    const mode = document.querySelector('#routeModeSelect').value;
    if (mode === 'road') {
      if (routePoints.length >= 2) { routePoints = []; routeResult = null; }
      routePoints.push(point);
      if (routePoints.length === 2) calculateRoute();
    } else {
      routePoints.push(point); calculateRoute();
    }
    updateRouteInstruction(); updateResult(); draw();
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button === 1 && activeTab === 'roads' && roadTool === 'select' && extensionSourceNodeId()) {
      extendFromSelectedNode(screenToMap(event.clientX, event.clientY));
      event.preventDefault(); return;
    }
    if (event.button === 1 || spaceDown) {
      isPanning = true; panOrigin = { x: event.clientX - camera.x, y: event.clientY - camera.y };
      viewport.classList.add('panning'); canvas.setPointerCapture(event.pointerId); event.preventDefault();
      return;
    }
    if (event.button === 0 && activeTab === 'roads' && roadTool === 'select') {
      const point = screenToMap(event.clientX, event.clientY);
      if ((selectedRoadIds.size || selectedNodeIds.size) && selectedGroupHit(point)) {
        roadDrag = createGroupDrag(point);
        canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
      }
      const target = draggableRoadTarget(point);
      if (target) {
        roadDrag = { ...target, moved: false, start: point };
        if (target.type === 'node') { selectedNodeId = target.nodeId; selectedRoadId = null; }
        else { selectedRoadId = target.segmentId; selectedNodeId = null; }
        updateRoadUI(); draw(); canvas.setPointerCapture(event.pointerId); event.preventDefault();
        return;
      }
      selectionBox = { start: point, current: point, moved: false, additive: event.shiftKey };
      canvas.setPointerCapture(event.pointerId); event.preventDefault();
    }
    if (event.button === 0 && activeTab === 'markers' && markerTool === 'select') {
      const point = screenToMap(event.clientX, event.clientY);
      if (selectedMarkerIds.size && selectedMarkerGroupHit(point)) {
        markerDrag = createMarkerGroupDrag(point);
        canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
      }
      const marker = nearestMapMarker(point);
      if (marker) {
        selectedMarkerIds.clear(); selectedMarkerId = marker.id; selectedMarkerType = marker.type;
        populateMarkerFields(marker);
        markerDrag = { type: 'marker-single', start: point, moved: false, toggleMarkerId: marker.id, markers: new Map([[marker.id, { x: marker.x, y: marker.y }]]) };
        renderMarkerPalette(); updateMarkerUI(); draw();
        canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
      }
      selectionBox = { start: point, current: point, moved: false, additive: event.shiftKey };
      canvas.setPointerCapture(event.pointerId); event.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (markerDrag) {
      const point = screenToMap(event.clientX, event.clientY);
      markerDrag.moved ||= distance(markerDrag.start, point) > 1 / camera.scale;
      moveMarkerDrag(markerDrag, point); draw(); return;
    }
    if (roadDrag) {
      const point = screenToMap(event.clientX, event.clientY);
      roadDrag.moved ||= distance(roadDrag.start, point) > 1 / camera.scale;
      if (roadDrag.type === 'node') updateNodePosition(roadDrag.nodeId, point);
      if (roadDrag.type === 'group') moveSelectedGroup(roadDrag, point);
      if (roadDrag.type === 'control') {
        const segment = state.segments.find(item => item.id === roadDrag.segmentId);
        if (segment?.points[roadDrag.index]) segment.points[roadDrag.index] = { x: point.x, y: point.y };
      }
      draw(); return;
    }
    if (selectionBox) {
      selectionBox.current = screenToMap(event.clientX, event.clientY);
      selectionBox.moved ||= distance(selectionBox.start, selectionBox.current) > 5 / camera.scale;
      draw(); return;
    }
    if (!isPanning) return;
    camera.x = event.clientX - panOrigin.x; camera.y = event.clientY - panOrigin.y; draw();
  });
  canvas.addEventListener('pointerup', event => {
    if (markerDrag) {
      const drag = markerDrag; markerDrag = null;
      if (drag.moved) persist();
      else if (drag.toggleMarkerId) toggleMarkerExpanded(state.markers.find(marker => marker.id === drag.toggleMarkerId));
      updateMarkerUI(); draw(); return;
    }
    if (roadDrag) {
      if (roadDrag.type === 'node' && roadDrag.moved) {
        const movedNode = state.nodes.find(node => node.id === roadDrag.nodeId);
        let target = null;
        if (movedNode) for (const node of state.nodes) {
          if (node.id === movedNode.id) continue;
          const d = distance(movedNode, node);
          if (d <= 14 / camera.scale && (!target || d < target.distance)) target = { node, distance: d };
        }
        if (target) mergeNodes(roadDrag.nodeId, target.node.id);
      }
      persist(); roadDrag = null; updateRoadUI(); draw(); return;
    }
    if (selectionBox) {
      selectionBox.current = screenToMap(event.clientX, event.clientY);
      const box = selectionBox; selectionBox = null;
      if (box.moved && activeTab === 'markers') applyMarkerBoxSelection(box);
      else if (box.moved) applyBoxSelection(box);
      else handleMapClick(box.current, event.detail);
      return;
    }
    if (isPanning) { isPanning = false; viewport.classList.remove('panning'); return; }
    if (event.button === 0) handleMapClick(screenToMap(event.clientX, event.clientY), event.detail);
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
    const mapPoint = { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale };
    camera.scale = Math.max(.08, Math.min(5, camera.scale * Math.exp(-event.deltaY * .0012)));
    camera.x = sx - mapPoint.x * camera.scale; camera.y = sy - mapPoint.y * camera.scale; draw();
  }, { passive: false });
  canvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  window.addEventListener('keydown', event => {
    const editingText = /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable;
    if (event.code === 'Space' && !event.repeat && !editingText) { spaceDown = true; event.preventDefault(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && activeTab === 'roads' && roadTool === 'select' && !editingText) {
      event.preventDefault(); deleteSelection();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && activeTab === 'markers' && markerTool === 'select' && !editingText) {
      event.preventDefault(); deleteSelectedMarkers();
    }
  });
  window.addEventListener('keyup', event => { if (event.code === 'Space') spaceDown = false; });
  window.addEventListener('resize', resizeCanvas);

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    selectionBox = null; roadDrag = null; markerDrag = null;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
    document.querySelector(`#${activeTab}Panel`).classList.add('active'); draw();
  }));

  document.querySelector('#fitMapButton').addEventListener('click', fitMap);
  document.querySelector('#autoScanButton').addEventListener('click', autoScanRoads);
  document.querySelector('#finishRoadButton').addEventListener('click', finishRoad);
  document.querySelector('#undoRoadButton').addEventListener('click', () => { roadDraft.pop(); updateRoadUI(); draw(); });
  document.querySelector('#cancelRoadButton').addEventListener('click', () => { roadDraft = []; updateRoadUI(); draw(); });
  document.querySelectorAll('[data-road-tool]').forEach(button => button.addEventListener('click', () => setRoadTool(button.dataset.roadTool)));
  document.querySelectorAll('[data-marker-tool]').forEach(button => button.addEventListener('click', () => setMarkerTool(button.dataset.markerTool)));
  document.querySelector('#deleteSelectionButton').addEventListener('click', deleteSelection);
  document.querySelector('#deleteMarkersButton').addEventListener('click', deleteSelectedMarkers);
  [markerLabelInput, markerGarrisonInput, markerLastSeenInput, markerArmySpeedInput, markerArmySizeInput, markerCommanderInput].forEach(input => {
    input.addEventListener('input', updateSelectedMarkerFromForm);
    input.addEventListener('change', updateSelectedMarkerFromForm);
  });
  markerFactionSelect.addEventListener('change', updateSelectedMarkerFromForm);
  markerMovementRadiusInput.addEventListener('change', updateSelectedMarkerFromForm);
  document.querySelector('#markerSeenNowButton').addEventListener('click', () => {
    markerLastSeenInput.value = localDateTimeValue(new Date().toISOString());
    updateSelectedMarkerFromForm(); updateMarkerTimeStatus(); draw();
  });
  document.querySelector('#addCustomMarkerType').addEventListener('click', () => {
    const nameInput = document.querySelector('#customMarkerName');
    const symbolInput = document.querySelector('#customMarkerSymbol');
    const colorInput = document.querySelector('#customMarkerColor');
    const label = nameInput.value.trim();
    const symbol = symbolInput.value.trim();
    if (!label || !symbol) { showNotice('Вкажіть назву типу та символ'); return; }
    const type = { id: uid('marker-type'), label, symbol: Array.from(symbol).slice(0, 3).join(''), color: colorInput.value };
    state.customMarkerTypes.push(type); selectedMarkerType = type.id;
    nameInput.value = ''; symbolInput.value = '★';
    persist(); renderMarkerPalette(); updateMarkerUI(); showNotice(`Тип «${label}» додано`);
  });
  document.querySelector('#addFactionButton').addEventListener('click', () => {
    const nameInput = document.querySelector('#newFactionName');
    const colorInput = document.querySelector('#newFactionColor');
    const name = nameInput.value.trim();
    if (!name) { showNotice('Вкажіть назву фракції'); return; }
    const existing = state.factions.find(faction => faction.name.localeCompare(name, 'uk', { sensitivity: 'accent' }) === 0);
    if (existing) {
      renderFactionSelect(existing.id); updateSelectedMarkerFromForm();
      showNotice(`Фракція «${existing.name}» вже є у списку`); return;
    }
    const faction = { id: uid('faction'), name, color: colorInput.value };
    state.factions.push(faction); nameInput.value = '';
    persist(); renderFactions(faction.id); updateSelectedMarkerFromForm(); draw();
    showNotice(`Фракцію «${name}» додано`);
  });
  document.querySelector('#clearMarkersButton').addEventListener('click', () => {
    if (!state.markers.length) { showNotice('На карті немає позначок'); return; }
    if (!confirm('Видалити всі позначки з карти?')) return;
    state.markers = []; selectedMarkerId = null; selectedMarkerIds.clear(); clearMarkerFields();
    persist(); updateMarkerUI(); draw(); showNotice('Усі позначки видалено');
  });
  document.querySelector('#undoRouteButton').addEventListener('click', () => { routePoints.pop(); calculateRoute(); updateRouteInstruction(); draw(); });
  document.querySelector('#resetRouteButton').addEventListener('click', () => { routePoints = []; routeResult = null; updateRouteInstruction(); updateResult(); draw(); });
  document.querySelector('#calibrateButton').addEventListener('click', () => { calibrating = true; calibrationPoints = []; showNotice('Клацніть два кінці шкали на карті'); });
  gridTypeSelect.addEventListener('change', event => {
    state.grid.type = event.target.value; persist(); updateGridUI(); draw();
  });
  gridMilesInput.addEventListener('change', event => {
    state.grid.miles = Math.max(5, Math.min(200, Number(event.target.value) || 24));
    persist(); updateGridUI(); draw();
  });
  document.querySelector('#clearRoadsButton').addEventListener('click', () => {
    if (!confirm('Видалити всю оцифровану дорожню мережу? Спершу можна експортувати JSON.')) return;
    state.nodes = []; state.segments = []; selectedRoadId = null; selectedNodeId = null; selectedRoadIds.clear(); selectedNodeIds.clear(); connectStartNodeId = null;
    persist(); routeResult = null; updateRoadUI(); updateResult(); draw();
  });
  document.querySelector('#exportButton').addEventListener('click', () => {
    const exported = {
      version: 3,
      scale: state.scale,
      grid: state.grid,
      nodes: state.nodes,
      segments: state.segments,
      markers: state.markers,
      customMarkerTypes: state.customMarkerTypes,
      factions: state.factions,
      speeds: state.speeds
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'heliopont-map-data.json'; anchor.click(); URL.revokeObjectURL(url);
  });
  document.querySelector('#importInput').addEventListener('change', async event => {
    try {
      const data = JSON.parse(await event.target.files[0].text());
      if (!Array.isArray(data.nodes) || !Array.isArray(data.segments)) throw new Error('Невірний формат');
      state.nodes = data.nodes; state.segments = data.segments;
      if (Number.isFinite(data.scale)) state.scale = data.scale;
      if (data.grid && typeof data.grid === 'object') state.grid = { ...state.grid, ...data.grid };
      if (Array.isArray(data.markers)) state.markers = data.markers;
      if (Array.isArray(data.customMarkerTypes)) state.customMarkerTypes = data.customMarkerTypes;
      state.factions = normalizeFactionData(state.markers, Array.isArray(data.factions) ? data.factions : state.factions);
      if (data.speeds && typeof data.speeds === 'object') state.speeds = { ...state.speeds, ...data.speeds };
      selectedRoadId = null; selectedNodeId = null; selectedRoadIds.clear(); selectedNodeIds.clear(); connectStartNodeId = null;
      selectedMarkerId = null; selectedMarkerIds.clear(); clearMarkerFields();
      persist(); renderMarkerPalette(); renderFactions(); updateMarkerUI(); updateRoadUI(); updateScaleUI(); setupSpeedSettings(); draw(); showNotice('Дані карти імпортовано');
    } catch (error) { showNotice(`Не вдалося імпортувати: ${error.message}`); }
    event.target.value = '';
  });
  document.querySelector('#routeModeSelect').addEventListener('change', event => {
    document.querySelector('#terrainField').hidden = event.target.value !== 'offroad';
    routePoints = []; routeResult = null; updateRouteInstruction(); updateResult(); draw();
  });
  [unitSelect, weatherSelect, terrainSelect, document.querySelector('#marchSelect')].forEach(select => select.addEventListener('change', calculateRoute));
  const helpDialog = document.querySelector('#helpDialog');
  document.querySelector('#helpButton').addEventListener('click', () => helpDialog.showModal());
  document.querySelector('#closeHelpButton').addEventListener('click', () => helpDialog.close());

  image.addEventListener('load', () => { resizeCanvas(); fitMap(); updateGridUI(); });
  image.addEventListener('error', () => showNotice('Не знайдено файл General_Map.jpg'));
  renderMarkerPalette(); renderFactions(); setupSpeedSettings(); updateMarkerUI(); updateRoadUI(); updateRouteInstruction(); updateScaleUI(); updateResult(); resizeCanvas();
  setInterval(() => {
    if (!state.markers.length) return;
    updateMarkerTimeStatus(); draw();
  }, 60000);
})();
