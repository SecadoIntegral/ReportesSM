/* ==========================================================================
   DASHBOARD SECADO MECÁNICO Y REPORTE DE OEE
   ========================================================================== */

const SPREADSHEET_ID = "1lFHQO8f33dK2W9tDbg0_74_0fddNU449ooAy-WuHdvg";
const GID_DASHBOARD = "1945963055"; // Hoja 1: Secado Mecánico
const GID_METRICS = "1542097113";   // Hoja 2: Métricas de Proceso / OEE

const URL_DASHBOARD_CSV = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID_DASHBOARD}`;
const URL_METRICS_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR38uKjMSWxeJhhRHl2Up9EA3BnrQgq7ERItdJBbM4BlHDX9JNFS9afc1jvgqmONMKz_U0Tw-IiDxJ-/pub?gid=1542097113&single=true&output=csv";

// Estado global
let allData = []; // Datos de Hoja 1 (Dashboard)
let allRows = []; // Filas de Hoja 2 (Métricas)
let headers = []; // Encabezados de Hoja 2
let parsedDateRows = []; // Filas parseadas de Hoja 2: { rowIndex, dateStr, dateObj, row }

// Modos de visualización
let topMojadoMode = "day"; // 'day' o 'range'
let metricsMode = "single"; // 'single' o 'range'
let selectedSingleDate = "";
let trendGranularity = "day";

// Mapeo dinámico de índices de columnas (Hoja 2)
let colIndices = {
  turnos: 0,
  parosProgramados: 1,
  parosNoProgramados: 2,
  tiempoTotal: 3,
  tiempoMuerto: 4,
  qqsMojadoIngresados: 5,
  procesados: 6,
  rechazados: 7,
  disponibilidad: 8,
  desempeno: 9,
  calidad: 10,
  oee: 11,
  fecha: 12,
  qqsMojadoEntrados: 13
};


/* ==========================================================================
   CARGADOR UNIVERSAL (JSONP / FETCH / LOCAL STORAGE)
   Evita bloqueos de CORS al abrir localmente (file:/// y localhost)
   ========================================================================== */

function loadViaJsonp(spreadsheetId, gid) {
  return new Promise((resolve, reject) => {
    const callbackName = "gvizCb_" + gid + "_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const script = document.createElement("script");
    script.id = callbackName;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout al consultar Google Sheets via JSONP"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      const el = document.getElementById(callbackName);
      if (el) el.remove();
    }

    window[callbackName] = function (response) {
      cleanup();
      try {
        if (!response || !response.table) {
          reject(new Error("Formato de respuesta inválido de Google Sheets"));
          return;
        }
        const hdrs = response.table.cols.map(c => (c.label || "").trim());
        const rows = response.table.rows.map(r => {
          return r.c.map(cell => {
            if (!cell) return "";
            if (cell.f !== undefined && cell.f !== null) return cell.f;
            if (cell.v !== undefined && cell.v !== null) return String(cell.v);
            return "";
          });
        });
        resolve({ headers: hdrs, rows: rows });
      } catch (err) {
        reject(err);
      }
    };

    script.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${callbackName}&gid=${gid}&_=${Date.now()}`;
    script.onerror = function () {
      cleanup();
      reject(new Error("Error de red cargando script JSONP"));
    };

    document.head.appendChild(script);
  });
}

// Parser CSV robusto con soporte para comillas y saltos de línea dentro de campos
function robustParseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      currentRow.push(currentField.trim());
      if (currentRow.length > 0 && currentRow.some(f => f !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Cargar hoja con reintentos: 1. JSONP (sin CORS), 2. Fetch directo, 3. Cache local
async function fetchGoogleSheet(spreadsheetId, gid, csvUrl, cacheKey) {
  let cachedData = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cachedData = JSON.parse(raw);
  } catch (e) {}

  // 1. Intentar JSONP (funciona 100% en file:/// y no tiene restricciones CORS)
  try {
    const jsonpRes = await loadViaJsonp(spreadsheetId, gid);
    if (jsonpRes && jsonpRes.rows && jsonpRes.rows.length > 0) {
      try { localStorage.setItem(cacheKey, JSON.stringify(jsonpRes)); } catch (e) {}
      return jsonpRes;
    }
  } catch (errJsonp) {
    console.warn("JSONP no disponible o bloqueado, probando fetch:", errJsonp.message);
  }

  // 2. Intentar fetch directo
  try {
    const resp = await fetch(csvUrl + (csvUrl.includes("?") ? "&" : "?") + "_=" + Date.now());
    if (resp.ok) {
      const text = await resp.text();
      const parsed = robustParseCSV(text);
      if (parsed.length > 0) {
        const hdrs = parsed[0].map(h => cleanHeader(h));
        const dataRows = parsed.slice(1);
        const result = { headers: hdrs, rows: dataRows };
        try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch (e) {}
        return result;
      }
    }
  } catch (errFetch) {
    console.warn("Fetch directo falló:", errFetch.message);
  }

  // 3. Fallback a datos en caché local si existen
  if (cachedData && cachedData.rows && cachedData.rows.length > 0) {
    console.info("Cargando datos desde caché local para:", cacheKey);
    return cachedData;
  }

  throw new Error("No se pudo conectar a Google Sheets. Verifica tu conexión.");
}


/* ==========================================================================
   UTILIDADES (FECHAS, HORAS, PORCENTAJES)
   ========================================================================== */

function parseFecha(fechaStr) {
  if (!fechaStr) return null;
  fechaStr = ("" + fechaStr).replace(/"/g, "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    const [y, m, d] = fechaStr.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const partes = fechaStr.split("/");
  if (partes.length === 3) {
    const d = parseInt(partes[0], 10);
    const m = parseInt(partes[1], 10) - 1;
    const y = parseInt(partes[2], 10);
    return new Date(y, m, d, 0, 0, 0, 0);
  }
  return null;
}

function formatFechaInput(date) {
  if (!date || isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatFechaDisplay(date) {
  if (!date || isNaN(date.getTime())) return "";
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function cleanDate(str) {
  if (!str) return "";
  return str.replace(/\r/g, "").replace(/\n/g, "").replace(/\s+/g, " ").replace(/"/g, "").trim();
}

function cleanHeader(header) {
  if (!header) return "";
  return header.replace(/"/g, "").replace(/\r/g, "").replace(/\n/g, "").trim();
}

function getSheetColumnValue(row, columnName) {
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const target = normalize(columnName);
  const key = Object.keys(row || {}).find(name => normalize(name) === target);
  return key ? row[key] : "";
}

function parseLocaleNumber(stringNumber) {
  if (stringNumber === null || stringNumber === undefined || stringNumber === "") return 0;
  if (typeof stringNumber === "number") return isNaN(stringNumber) ? 0 : stringNumber;
  let text = stringNumber.toString().trim();
  if (!text) return 0;
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  }
  const n = parseFloat(text);
  return isNaN(n) ? 0 : n;
}

function fmt(value, isSecadoras = false) {
  if (isSecadoras) {
    if (value === null || value === undefined || value === "") return "";
    const num = parseLocaleNumber(value);
    return Math.round(num).toString();
  }
  const n = parseLocaleNumber(value);
  return n.toFixed(2);
}

function parseTimeToHours(valor) {
  if (valor === null || valor === undefined || valor === "" || valor === "0" || valor === 0) return 0;
  valor = valor.toString().trim();

  const matchHms = valor.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (matchHms) {
    return parseInt(matchHms[1], 10) + parseInt(matchHms[2], 10) / 60 + parseInt(matchHms[3], 10) / 3600;
  }

  const matchHm = valor.match(/^(\d+):(\d{1,2})$/);
  if (matchHm) {
    return parseInt(matchHm[1], 10) + parseInt(matchHm[2], 10) / 60;
  }

  const num = parseFloat(valor.replace(",", "."));
  if (isNaN(num)) return 0;
  if (num > 0 && num < 1) {
    return num * 24;
  }
  return num;
}

function formatHoursToTime(totalHours) {
  if (isNaN(totalHours) || totalHours <= 0) return "00:00:00";
  const totalSeconds = Math.round(totalHours * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHoras(valor) {
  if (!valor || valor === "" || valor === "0" || valor === 0) return "00:00:00";
  valor = valor.toString().trim();
  if (/^\d+:\d{2}:\d{2}$/.test(valor)) return valor;
  if (/^\d+:\d{1,2}$/.test(valor)) {
    let [h, m] = valor.split(":").map(n => parseInt(n, 10) || 0);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00";
  }
  const totalHours = parseTimeToHours(valor);
  return formatHoursToTime(totalHours);
}

function parsePercent(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  const str = valor.toString().trim();
  const hasPercent = str.includes("%");
  const cleanStr = str.replace("%", "").replace(",", ".").trim();
  let num = parseFloat(cleanStr);
  if (isNaN(num)) return 0;
  if (!hasPercent && num > 0 && num <= 1) {
    num = num * 100;
  }
  return num;
}

function formatPercent(valor) {
  if (valor === null || valor === undefined || valor === "") return "--%";
  const p = parsePercent(valor);
  return p.toFixed(2) + "%";
}

function getOeeBadgeHtml(valPercent) {
  const p = parseFloat(valPercent) || 0;
  let cssClass = "low";
  if (p >= 85) cssClass = "high";
  else if (p >= 65) cssClass = "medium";
  return `<span class="oee-badge ${cssClass}">${p.toFixed(2)}%</span>`;
}

function getOeeColor(valPercent) {
  const p = parseFloat(valPercent) || 0;
  if (p >= 85) return "var(--Moja, #1ea356)";
  if (p >= 65) return "var(--warning, #f39c12)";
  return "var(--danger, #e74c3c)";
}


/* ==========================================================================
   DASHBOARD 1: SECADO MECÁNICO
   ========================================================================== */

function populateDateSelector(data) {
  const select = document.getElementById("date-select");
  if (!select) return;
  select.innerHTML = '<option value="latest">Última línea</option>';

  const dates = [...new Set(data.map(r => r.Fecha))]
    .filter(Boolean)
    .sort((a, b) => {
      const da = parseFecha(a);
      const db = parseFecha(b);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

  dates.forEach(date => {
    const opt = document.createElement("option");
    opt.value = date;
    const d = parseFecha(date);
    opt.textContent = d ? d.toLocaleDateString("es-ES") : date;
    select.appendChild(opt);
  });
}

function updateDashboard(data, dateFilter = "latest") {
  if (!data || data.length === 0) return;
  let row = dateFilter === "latest" ? data[data.length - 1] : data.find(r => r.Fecha === dateFilter);
  if (!row) return;

  const f = parseFecha(row.Fecha);
  const fechaEl = document.getElementById("fecha");
  if (fechaEl) {
    fechaEl.innerText =
      "Datos de: " +
      (f ? f.toLocaleDateString("es-ES") : row.Fecha) +
      " | Actualizado: " +
      new Date().toLocaleString();
  }

  // Claves dinámicas
  const totalQssKey = ["Total QQs", "Total Qss", "Total QQ"].find(k => k in row);
  const qqPresecoKey = ["qq pre-seco", "QQ Pre-Seco", "QQ Preseco"].find(k => k in row);
  const qqMojadoKey = ["QQs Mojado ingresados", "qq mojado", "QQ Mojado", "QQs Mojado"].find(k => k in row);
  const qqHumedoKey = ["QQ Humedo", "qq humedo", "QQs Humedo"].find(k => k in row);

  // Tarjetas principales
  const totalEl = document.getElementById("total-qss");
  if (totalEl) totalEl.innerText = fmt(row[totalQssKey]);
  if (topMojadoMode === "day") {
    const preEl = document.getElementById("qq-preseco");
    if (preEl) preEl.innerText = fmt(row[qqPresecoKey]);
    const mojEl = document.getElementById("qq-mojado");
    if (mojEl) mojEl.innerText = fmt(qqMojadoKey ? row[qqMojadoKey] : 0);
    const humEl = document.getElementById("qq-humedo");
    if (humEl) humEl.innerText = fmt(qqHumedoKey ? row[qqHumedoKey] : 0);
  }

  const sheetCards = [
    ["humedad-promedio-dentro", "Humedad promedio dentro del rango permitido"],
    ["cantidad-qq-dentro", "Cantidad (QQ) dentro de rango"],
    ["humedad-promedio-fuera", "Humedad promedio fuera del rango permitido"],
    ["cantidad-qq-fuera", "Cantidad (QQ) fuera de rango"]
  ];
  sheetCards.forEach(([elementId, columnName]) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    const value = getSheetColumnValue(row, columnName);
    element.textContent = value === "" ? "--" : fmt(value);
  });
  updateDashboardCharts({ updateProduction: topMojadoMode === "day" });

  // Secadoras
  const secProc = document.getElementById("sec-proceso");
  if (secProc) secProc.innerText = fmt(row["Secadoras En proceso"], true);
  const qqProc = document.getElementById("qq-proceso");
  if (qqProc) qqProc.innerText = fmt(row["QQ Proceso"]);
  const secPend = document.getElementById("sec-pendientes");
  if (secPend) secPend.innerText = fmt(row["Secadoras Pendientes"], true);
  const qqPend = document.getElementById("qq-pendientes");
  if (qqPend) qqPend.innerText = fmt(row["QQ pendientes"]);
  const secEnv = document.getElementById("sec-enviadas");
  if (secEnv) secEnv.innerText = fmt(row["Secadoras Enviadas"], true);
  const qqEnv = document.getElementById("qq-enviados");
  if (qqEnv) qqEnv.innerText = fmt(row["QQ Enviados"]);

  // Verticales
  const vertProc = document.getElementById("vert-proceso");
  if (vertProc) vertProc.innerText = fmt(row["Verticales en proceso"], true);
  const qqVert = document.getElementById("qq-vert-proceso");
  if (qqVert) qqVert.innerText = fmt(row["QQ Verticales"]);

  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "none";

  // Actualizar también la tarjeta superior de QQs Mojado si está en modo día
  if (topMojadoMode === "day") {
    updateTopMojadoForDate(row.Fecha || dateFilter);
  }
}

function updateDashboardCharts({ updatePie = true, updateProduction = true } = {}) {
  const readValue = id => {
    const element = document.getElementById(id);
    if (!element) return 0;
    return parseFloat(element.textContent.replace(/,/g, "")) || 0;
  };
  const setBarWidth = (barId, value, max) => {
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = `${max > 0 ? Math.max(0, value / max * 100) : 0}%`;
  };

  if (updatePie) {
    const inside = readValue("cantidad-qq-dentro");
    const outside = readValue("cantidad-qq-fuera");
    const pieTotal = inside + outside;
    const insidePercentage = pieTotal > 0 ? inside / pieTotal * 100 : 0;
    const outsidePercentage = pieTotal > 0 ? outside / pieTotal * 100 : 0;
    const formatPercentage = value => value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const placePieLabel = (id, startFraction, endFraction, percentage) => {
      const label = document.getElementById(id);
      if (!label) return;
      const fraction = endFraction - startFraction;
      if (fraction <= 0) { label.textContent = ""; return; }
      const angle = (startFraction + fraction / 2) * Math.PI * 2 - Math.PI / 2;
      const radius = 62;
      label.setAttribute("x", String(110 + radius * Math.cos(angle)));
      label.setAttribute("y", String(110 + radius * Math.sin(angle)));
      label.textContent = `${formatPercentage(percentage)}%`;
    };
    placePieLabel("pie-label-inside", 0, pieTotal > 0 ? inside / pieTotal : 0, insidePercentage);
    placePieLabel("pie-label-outside", pieTotal > 0 ? inside / pieTotal : 0, 1, outsidePercentage);
    const pieSlicePath = (startFraction, endFraction) => {
    const center = 110;
    const radius = 94;
    const fraction = endFraction - startFraction;
    if (fraction <= 0) return "";
    if (fraction >= 0.999999) {
      return `M ${center - radius} ${center} A ${radius} ${radius} 0 1 0 ${center + radius} ${center} A ${radius} ${radius} 0 1 0 ${center - radius} ${center} Z`;
    }
    const startAngle = startFraction * Math.PI * 2 - Math.PI / 2;
    const endAngle = endFraction * Math.PI * 2 - Math.PI / 2;
    const startX = center + radius * Math.cos(startAngle);
    const startY = center + radius * Math.sin(startAngle);
    const endX = center + radius * Math.cos(endAngle);
    const endY = center + radius * Math.sin(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    return `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
    };
    const pieInside = document.getElementById("pie-segment-inside");
    const pieOutside = document.getElementById("pie-segment-outside");
    if (pieInside) pieInside.setAttribute("d", pieTotal > 0 ? pieSlicePath(0, inside / pieTotal) : "");
    if (pieOutside) pieOutside.setAttribute("d", pieTotal > 0 ? pieSlicePath(inside / pieTotal, 1) : "");
    const pieTotalLabel = document.getElementById("humidity-pie-total");
    if (pieTotalLabel) pieTotalLabel.textContent = pieTotal.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pie = document.getElementById("humidity-pie");
    if (pie) pie.setAttribute("aria-label", `Dentro del rango de humedad: ${inside.toFixed(2)} QQ (${formatPercentage(insidePercentage)} por ciento del total), humedad promedio ${readValue("humedad-promedio-dentro").toFixed(2)} por ciento. Fuera del rango: ${outside.toFixed(2)} QQ (${formatPercentage(outsidePercentage)} por ciento del total), humedad promedio ${readValue("humedad-promedio-fuera").toFixed(2)} por ciento.`);
  }

  if (updateProduction) {
    const production = [
      ["qq-mojado", "bar-qq-mojado"],
      ["qq-humedo", "bar-qq-humedo"],
      ["qq-preseco", "bar-qq-preseco"]
    ].map(([valueId, barId]) => ({ value: readValue(valueId), barId }));
    const productionMax = Math.max(...production.map(item => item.value));
    production.forEach(item => setBarWidth(item.barId, item.value, productionMax));

    const productionChart = document.querySelector(".production-chart[role='img']");
    if (productionChart) productionChart.setAttribute("aria-label", `QQ Mojado ${production[0].value.toFixed(2)}, QQ Húmedo ${production[1].value.toFixed(2)}, QQ Ingresados Pre-Seco ${production[2].value.toFixed(2)}.`);
  }
}

async function loadData() {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "block";

  try {
    const res = await fetchGoogleSheet(SPREADSHEET_ID, GID_DASHBOARD, URL_DASHBOARD_CSV, "cache_dashboard_sm");
    // Convertir matriz de filas en lista de objetos
    allData = res.rows.map(r => {
      const obj = {};
      res.headers.forEach((h, i) => {
        if (h) obj[h] = (r[i] || "").trim();
      });
      return obj;
    });

    populateDateSelector(allData);
    updateDashboard(allData, "latest");
    renderDailyTrendChart();
    initTopMojadoControls();
  } catch (err) {
    console.error("Error en loadData:", err);
    if (loadingEl) loadingEl.innerText = "Error cargando datos principales: " + err.message;
  }
}

function getIsoWeekStart(date) {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - weekday);
  return weekStart;
}

function getIsoWeekNumber(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
}

function getIsoWeekYear(date) {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
  return thursday.getFullYear();
}

function renderDailyTrendChart() {
  const chart = document.getElementById("daily-chart-bars");
  if (!chart) return;
  const empty = document.getElementById("daily-chart-empty");
  const summary = document.getElementById("trend-total");
  const periodLabel = document.getElementById("trend-period-label");
  const totalKeyNames = ["Total QQs", "Total Qss", "Total QQ"];
  const dailyTotals = new Map();

  allData.forEach(row => {
    const date = parseFecha(row.Fecha);
    const totalKey = totalKeyNames.find(key => key in row);
    if (!date || !totalKey) return;
    const key = formatFechaInput(date);
    const value = parseFloat(fmt(row[totalKey])) || 0;
    const existing = dailyTotals.get(key);
    if (existing) existing.value += value;
    else dailyTotals.set(key, { date, value });
  });

  const dailyEntries = [...dailyTotals.entries()]
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => a.date - b.date);
  const grouped = new Map();
  dailyEntries.forEach(entry => {
    let key;
    let label;
    let title;
    if (trendGranularity === "week") {
      const weekStart = getIsoWeekStart(entry.date);
      const weekNumber = getIsoWeekNumber(entry.date);
      const weekYear = getIsoWeekYear(entry.date);
      key = formatFechaInput(weekStart);
      label = `S${String(weekNumber).padStart(2, "0")}/${String(weekYear).slice(-2)}`;
      title = `Semana ${weekNumber} · ${weekYear}`;
    } else if (trendGranularity === "month") {
      key = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, "0")}`;
      label = entry.date.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }).replace(".", "");
      title = entry.date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    } else if (trendGranularity === "year") {
      key = String(entry.date.getFullYear());
      label = key;
      title = key;
    } else {
      key = entry.key;
      label = `${String(entry.date.getDate()).padStart(2, "0")}/${String(entry.date.getMonth() + 1).padStart(2, "0")}${dailyEntries[0].date.getFullYear() !== dailyEntries[dailyEntries.length - 1].date.getFullYear() ? `/${String(entry.date.getFullYear()).slice(-2)}` : ""}`;
      title = formatFechaDisplay(entry.date);
    }

    if (grouped.has(key)) grouped.get(key).value += entry.value;
    else grouped.set(key, { key, label, title, value: entry.value, date: entry.date });
  });

  const entries = [...grouped.values()].sort((a, b) => a.date - b.date);
  chart.replaceChildren();
  if (!entries.length) {
    if (empty) empty.hidden = false;
    if (summary) summary.textContent = "Total: 0.00 QQ";
    chart.style.minWidth = "100%";
    return;
  }

  if (empty) empty.hidden = true;
  const maximum = Math.max(...entries.map(entry => entry.value));
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (summary) summary.textContent = `Total: ${total.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ`;
  if (periodLabel) {
    const labels = { day: "diaria", week: "semanal", month: "mensual", year: "anual" };
    periodLabel.textContent = `Vista ${labels[trendGranularity]} · ${entries.length} ${trendGranularity === "day" ? "días" : "periodos"}`;
  }
  chart.style.minWidth = `${Math.max(100, entries.length * 72)}px`;
  chart.setAttribute("aria-label", `Gráfico ${trendGranularity === "day" ? "diario" : trendGranularity === "week" ? "semanal" : trendGranularity === "month" ? "mensual" : "anual"} con ${entries.length} periodos y ${total.toFixed(2)} QQ en total.`);

  entries.forEach((entry, index) => {
    const column = document.createElement("div");
    column.className = "trend-bar-column";
    column.title = `${entry.title}: ${entry.value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ`;
    const value = document.createElement("span");
    value.className = "trend-bar-value";
    const qqValue = document.createElement("span");
    qqValue.textContent = `${entry.value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ`;
    let periodCapacity = 7000;
    if (trendGranularity === "week") {
      periodCapacity = 7000 * 7;
    } else if (trendGranularity === "month") {
      const daysInMonth = new Date(entry.date.getFullYear(), entry.date.getMonth() + 1, 0).getDate();
      periodCapacity = 7000 * daysInMonth;
    } else if (trendGranularity === "year") {
      const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      periodCapacity = 7000 * (isLeap(entry.date.getFullYear()) ? 366 : 365);
    }
    const capPercent = periodCapacity > 0 ? (entry.value / periodCapacity * 100) : 0;
    const capacityValue = document.createElement("span");
    capacityValue.textContent = `${capPercent.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% capacidad`;
    value.append(qqValue, capacityValue);
    const bar = document.createElement("div");
    bar.className = `trend-bar${entry.value === maximum && maximum > 0 ? " peak" : ""}`;
    bar.style.height = `${maximum > 0 ? Math.max(2, entry.value / maximum * 100) : 0}%`;
    const plot = document.createElement("div");
    plot.className = "trend-bar-plot";
    plot.appendChild(bar);
    const label = document.createElement("span");
    label.className = "trend-bar-label";
    label.textContent = entry.label;
    column.append(value, plot, label);
    chart.appendChild(column);
    const plotHeight = Math.max(0, column.clientHeight - 43);
    const barHeight = maximum > 0 ? Math.max(2, entry.value / maximum * plotHeight) : 2;
    value.style.bottom = `${15 + barHeight + 2}px`;
  });

  if (entries.length > 1) {
    const chartRect = chart.getBoundingClientRect();
    const columns = [...chart.querySelectorAll(".trend-bar-column")];
    const points = columns.map((column, index) => {
      const columnRect = column.getBoundingClientRect();
      const plotRect = column.querySelector(".trend-bar-plot").getBoundingClientRect();
      const heightRatio = maximum > 0 ? entries[index].value / maximum : 0;
      return {
        x: columnRect.left - chartRect.left + columnRect.width / 2,
        y: plotRect.bottom - chartRect.top - heightRatio * plotRect.height,
        value: entries[index].value
      };
    });
    const svgNS = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(svgNS, "svg");
    overlay.classList.add("trend-line-overlay");
    overlay.setAttribute("viewBox", `0 0 ${chart.clientWidth} ${chart.clientHeight}`);
    overlay.setAttribute("width", String(chart.clientWidth));
    overlay.setAttribute("height", String(chart.clientHeight));
    overlay.setAttribute("aria-hidden", "true");

    points.slice(1).forEach((point, index) => {
      const previous = points[index];
      const direction = point.value > previous.value ? "rising" : point.value < previous.value ? "falling" : "steady";
      const line = document.createElementNS(svgNS, "path");
      line.setAttribute("d", `M ${previous.x} ${previous.y} L ${point.x} ${point.y}`);
      line.classList.add("trend-line-segment", direction);
      const length = Math.hypot(point.x - previous.x, point.y - previous.y);
      line.style.strokeDasharray = String(length);
      line.style.strokeDashoffset = String(length);
      line.style.animationDelay = `${Math.round(index / Math.max(1, points.length - 2) * 900)}ms`;
      overlay.appendChild(line);
    });

    points.forEach((point, index) => {
      const marker = document.createElementNS(svgNS, "circle");
      marker.setAttribute("cx", String(point.x));
      marker.setAttribute("cy", String(point.y));
      marker.setAttribute("r", "3");
      marker.classList.add("trend-line-marker");
      marker.classList.add(index === 0 || point.value === points[index - 1].value
        ? "steady"
        : point.value > points[index - 1].value ? "rising" : "falling");
      marker.style.animationDelay = `${Math.round(index / Math.max(1, points.length - 1) * 900)}ms`;
      overlay.appendChild(marker);
    });
    chart.appendChild(overlay);
  }
}

function setupTrendChartControls() {
  const buttons = document.querySelectorAll("[data-trend-period]");
  buttons.forEach(button => {
    button.addEventListener("click", () => {
      trendGranularity = button.dataset.trendPeriod;
      buttons.forEach(option => {
        const selected = option === button;
        option.classList.toggle("active", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
      renderDailyTrendChart();
    });
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderDailyTrendChart, 150);
  });
}


/* ==========================================================================
   MÓDULO SUPERIOR: QQs MOJADO INGRESADOS (DÍA O RANGO DE SUMA)
   ========================================================================== */

function setupTopMojadoListeners() {
  const btnDay = document.getElementById("btn-top-mojado-day");
  const btnRange = document.getElementById("btn-top-mojado-range");
  const btnCalc = document.getElementById("btn-top-mojado-calc");

  if (btnDay) {
    btnDay.onclick = () => setTopMojadoMode("day");
  }
  if (btnRange) {
    btnRange.onclick = () => setTopMojadoMode("range");
  }
  if (btnCalc) {
    btnCalc.onclick = () => calculateTopMojadoRange();
  }

    const startInput = document.getElementById("top-mojado-date-start");
    const endInput = document.getElementById("top-mojado-date-end");
    if (startInput) startInput.onchange = () => calculateTopMojadoRange();
    if (endInput) endInput.onchange = () => calculateTopMojadoRange();
  // Atajos de rango
  const presetChips = document.querySelectorAll("[data-mojado-preset]");
  presetChips.forEach(chip => {
    chip.onclick = () => {
      presetChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const preset = chip.getAttribute("data-mojado-preset");
      applyTopMojadoPreset(preset);
    };
  });
}

function setTopMojadoMode(mode) {
  topMojadoMode = mode;
  const btnDay = document.getElementById("btn-top-mojado-day");
  const btnRange = document.getElementById("btn-top-mojado-range");
  const rangePanel = document.getElementById("top-mojado-range-controls");
  const badge = document.getElementById("top-mojado-badge");
  const desc = document.getElementById("top-mojado-detail");

  if (mode === "day") {
    if (btnDay) btnDay.classList.add("active");
    if (btnRange) btnRange.classList.remove("active");
    if (rangePanel) rangePanel.style.display = "none";
    if (badge) badge.textContent = "Día seleccionado";
    if (desc) desc.textContent = "Mostrando el total de quintales consolidado del día seleccionado";

    const dateSelect = document.getElementById("date-select");
    const chosenDate = dateSelect ? dateSelect.value : "latest";
    if (allData.length) updateDashboard(allData, chosenDate);
    else updateTopMojadoForDate(chosenDate);
  } else {
    if (btnDay) btnDay.classList.remove("active");
    if (btnRange) btnRange.classList.add("active");
    if (rangePanel) rangePanel.style.display = "block";
    if (badge) badge.textContent = "Total por rango";

    calculateTopMojadoRange();
  }
}

function updateTopMojadoForDate(fechaTarget) {
  const valEl = document.getElementById("top-mojado-valor");
  const desc = document.getElementById("top-mojado-detail");
  if (!valEl) return;

  let valor = 0;
  let fechaLabel = fechaTarget;
  let row = null;

  // 1. Prioridad: Buscar en allData (Hoja 1: Secado Mecánico - Total QQs)
  if (allData && allData.length > 0) {
    if (fechaTarget === "latest") {
      row = allData[allData.length - 1];
    } else {
      row = allData.find(r => r.Fecha === fechaTarget);
      if (!row) {
        const targetDate = parseFecha(fechaTarget);
        if (targetDate) {
          row = allData.find(r => {
            const d = parseFecha(r.Fecha);
            return d && d.getTime() === targetDate.getTime();
          });
        }
      }
    }
  }

  if (row) {
    fechaLabel = row.Fecha;
    const totalKey = ["Total QQs", "Total Qss", "Total QQ"].find(k => k in row);
    const rawVal = totalKey ? row[totalKey] : 0;
    valor = parseLocaleNumber(rawVal);

    const mojKey = ["qq mojado", "QQ Mojado", "QQs Mojado"].find(k => k in row);
    const humKey = ["qq humedo", "QQ Humedo", "QQs Humedo"].find(k => k in row);
    const mojVal = parseLocaleNumber(row[mojKey] || 0);
    const humVal = parseLocaleNumber(row[humKey] || 0);

    valEl.textContent = valor.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (desc) {
      const f = parseFecha(fechaLabel);
      const fStr = f ? formatFechaDisplay(f) : fechaLabel;
      desc.textContent = `Total consolidado al ${fStr} (Mojado: ${mojVal.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ | Húmedo: ${humVal.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ)`;
    }
    return;
  }

  // 2. Fallback temporal si aún no ha cargado allData pero parsedDateRows está listo
  if (parsedDateRows && parsedDateRows.length > 0) {
    let item = null;
    if (fechaTarget === "latest") {
      item = parsedDateRows[parsedDateRows.length - 1];
    } else {
      item = parsedDateRows.find(p => p.dateStr === fechaTarget);
    }
    if (item) {
      fechaLabel = item.dateStr;
      valor = parseLocaleNumber(item.row[colIndices.qqsMojadoEntrados]) || parseLocaleNumber(item.row[colIndices.qqsMojadoIngresados]);
    }
  }

  valEl.textContent = valor.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (desc) {
    desc.textContent = `Total de quintales del ${fechaLabel || "día seleccionado"}`;
  }
}

function applyTopMojadoPreset(preset) {
  const dates = getAvailableDateObjects();
  const startInput = document.getElementById("top-mojado-date-start");
  const endInput = document.getElementById("top-mojado-date-end");
  if (!startInput || !endInput || dates.length === 0) return;
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  if (preset === "all") {
    startInput.value = formatFechaInput(earliest);
  } else {
    const days = parseInt(preset, 10) || 7;
    const target = new Date(latest.getTime() - (days - 1) * 86400000);
    startInput.value = formatFechaInput(target < earliest ? earliest : target);
  }
  endInput.value = formatFechaInput(latest);
  calculateTopMojadoRange();
}

function calculateTopMojadoRange() {
  const startInput = document.getElementById("top-mojado-date-start");
  const endInput = document.getElementById("top-mojado-date-end");
  const valEl = document.getElementById("top-mojado-valor");
  const banner = document.getElementById("top-mojado-summary-banner");
  const desc = document.getElementById("top-mojado-detail");
  if (!startInput || !endInput || !valEl || !startInput.value || !endInput.value) return;
  let start = parseFecha(startInput.value);
  let end = parseFecha(endInput.value);
  if (!start || !end) return;
  if (start > end) [start, end] = [end, start];
  const parseNumber = value => parseLocaleNumber(value);
  const totalSumKey = ["Total QQs", "Total Qss", "Total QQ"];
  const productionTotals = [
    { id: "qq-mojado", keys: ["QQs Mojado ingresados", "qq mojado", "QQ Mojado", "QQs Mojado"] },
    { id: "qq-humedo", keys: ["QQ Humedo", "qq humedo", "QQs Humedo"] },
    { id: "qq-preseco", keys: ["qq pre-seco", "QQ Pre-Seco", "QQ Preseco"] }
  ];
  productionTotals.forEach(item => { item.total = 0; });
  const rows = allData.map((row, index) => ({ row, index, date: parseFecha(row.Fecha) }))
    .filter(item => item.date)
    .sort((a, b) => a.date - b.date || a.index - b.index);
  const inRange = rows.filter(item => item.date >= start && item.date <= end);
  let total = 0;
  inRange.forEach(item => {
    const totalKey = totalSumKey.find(key => key in item.row);
    if (totalKey) total += parseNumber(item.row[totalKey]);
    productionTotals.forEach(component => {
      const key = component.keys.find(name => name in item.row);
      if (key) component.total += parseNumber(item.row[key]);
    });
  });
  productionTotals.forEach(component => {
    const element = document.getElementById(component.id);
    if (element) element.textContent = component.total.toFixed(2);
  });
  updateDashboardCharts({ updatePie: false, updateProduction: true });
  const totalText = total.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  valEl.textContent = totalText;
  if (desc) desc.textContent = `Suma de QQs del ${formatFechaDisplay(start)} al ${formatFechaDisplay(end)} (${inRange.length} registros)`;
  if (banner) {
    banner.style.display = inRange.length ? "flex" : "none";
    banner.textContent = inRange.length
      ? `Suma de la columna Total QQs: ${totalText} QQs (${inRange.length} registros en el periodo).`
      : "";
  }
}

function getAvailableDateObjects() {
  if (allData.length > 0) {
    const dates = allData.map(r => parseFecha(r.Fecha)).filter(Boolean).sort((a, b) => a - b);
    if (dates.length > 0) return dates;
  }
  if (parsedDateRows.length > 0) {
    return parsedDateRows.map(p => p.dateObj);
  }
  return [];
}


/* ==========================================================================
   DASHBOARD 2: MÉTRICAS DE PROCESO Y OEE (INDIVIDUAL Y RANGO)
   ========================================================================== */

async function loadDataMetrics() {
  const loadingElement = document.getElementById("loading-message");
  if (loadingElement) {
    loadingElement.className = "loading";
    loadingElement.textContent = "Cargando métricas de proceso...";
    loadingElement.style.display = "block";
  }

  try {
    const res = await fetchGoogleSheet(SPREADSHEET_ID, GID_METRICS, URL_METRICS_CSV, "cache_metrics_oee");
    headers = res.headers.map(h => cleanHeader(h));
    allRows = res.rows;

    const findCol = (regex, fallback) => {
      const idx = headers.findIndex(h => regex.test(h.toLowerCase()));
      return idx !== -1 ? idx : fallback;
    };

    colIndices = {
      turnos: findCol(/turno/, 0),
      parosProgramados: findCol(/paros?\s+programado/i, 1),
      parosNoProgramados: findCol(/no\s+programado/i, 2),
      tiempoTotal: findCol(/tiempo\s+total/i, 3),
      tiempoMuerto: findCol(/tiempo\s+muerto/i, 4),
      qqsMojadoIngresados: findCol(/mojado\s+ingresado/i, 5),
      procesados: findCol(/procesado/i, 6),
      rechazados: findCol(/rechazado/i, 7),
      disponibilidad: findCol(/disponib/i, 8),
      desempeno: findCol(/desempe/i, 9),
      calidad: findCol(/calidad/i, 10),
      oee: findCol(/oee/i, 11),
      fecha: findCol(/fecha/i, 12),
      qqsMojadoEntrados: findCol(/mojado\s+entrado/i, 13)
    };

    parsedDateRows = [];
    allRows.forEach((r, idx) => {
      if (r.length > colIndices.fecha) {
        const fStr = cleanDate(r[colIndices.fecha]);
        const dObj = parseFecha(fStr);
        if (dObj) {
          parsedDateRows.push({
            rowIndex: idx,
            dateStr: fStr,
            dateObj: dObj,
            row: r
          });
        }
      }
    });

    parsedDateRows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    hideLoadingMetrics();
    initMetricsControls();
    initTopMojadoControls();

    if (metricsMode === "range") {
      applyCurrentRange();
    } else {
      loadLatestDate();
    }

  } catch (error) {
    console.error("Error en loadDataMetrics:", error);
    showErrorMetrics("Error cargando datos de métricas: " + error.message);
  }
}

function hideLoadingMetrics() {
  const loadingElement = document.getElementById("loading-message");
  if (loadingElement) loadingElement.style.display = "none";
  const tbl = document.querySelector(".table-container table");
  if (tbl) tbl.style.display = "table";
}

function showErrorMetrics(message) {
  const loadingElement = document.getElementById("loading-message");
  if (loadingElement) {
    loadingElement.className = "error";
    loadingElement.textContent = message;
    loadingElement.style.display = "block";
  }
}

function initMetricsControls() {
  const selector = document.getElementById("dateSelector");
  if (selector) {
    selector.innerHTML = "<option value=''>Seleccionar fecha</option>";
    const uniqueDates = [...new Set(parsedDateRows.map(p => p.dateStr))];
    uniqueDates.sort((a, b) => {
      const da = parseFecha(a);
      const db = parseFecha(b);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    uniqueDates.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      selector.appendChild(opt);
    });

    selector.onchange = () => {
      if (selector.value) loadByDate(selector.value);
    };
  }

  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  if (startInput && endInput && parsedDateRows.length > 0) {
    const earliest = parsedDateRows[0].dateObj;
    const latest = parsedDateRows[parsedDateRows.length - 1].dateObj;
    startInput.min = formatFechaInput(earliest);
    startInput.max = formatFechaInput(latest);
    endInput.min = formatFechaInput(earliest);
    endInput.max = formatFechaInput(latest);

    if (!startInput.value || !endInput.value) {
      endInput.value = formatFechaInput(latest);
      const sevenDaysAgo = new Date(latest.getTime() - 6 * 24 * 60 * 60 * 1000);
      startInput.value = formatFechaInput(sevenDaysAgo < earliest ? earliest : sevenDaysAgo);
    }
  }

  setupMetricsEventListeners();
}

function initTopMojadoControls() {
  const startInput = document.getElementById("top-mojado-date-start");
  const endInput = document.getElementById("top-mojado-date-end");
  const dates = getAvailableDateObjects();
  if (startInput && endInput && dates.length > 0) {
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    startInput.min = formatFechaInput(earliest);
    startInput.max = formatFechaInput(latest);
    endInput.min = formatFechaInput(earliest);
    endInput.max = formatFechaInput(latest);

    if (!startInput.value || !endInput.value) {
      endInput.value = formatFechaInput(latest);
      const sevenDaysAgo = new Date(latest.getTime() - 6 * 24 * 60 * 60 * 1000);
      startInput.value = formatFechaInput(sevenDaysAgo < earliest ? earliest : sevenDaysAgo);
    }
  }
  if (topMojadoMode === "day") {
    const dateSelect = document.getElementById("date-select");
    updateTopMojadoForDate(dateSelect ? dateSelect.value : "latest");
  } else {
    calculateTopMojadoRange();
  }
}

function setupMetricsEventListeners() {
  const btnSingle = document.getElementById("btn-mode-single");
  const btnRange = document.getElementById("btn-mode-range");
  if (btnSingle) btnSingle.onclick = () => setMetricsMode("single");
  if (btnRange) btnRange.onclick = () => setMetricsMode("range");

  const btnApply = document.getElementById("btn-apply-range");
  if (btnApply) btnApply.onclick = () => applyCurrentRange();

  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  if (startInput) startInput.onchange = () => applyCurrentRange();
  if (endInput) endInput.onchange = () => applyCurrentRange();

  const presets = document.querySelectorAll(".preset-chip[data-preset]");
  presets.forEach(p => {
    p.onclick = () => {
      presets.forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      applyOeePreset(p.getAttribute("data-preset"));
    };
  });
}

function setMetricsMode(mode) {
  metricsMode = mode;
  const btnSingle = document.getElementById("btn-mode-single");
  const btnRange = document.getElementById("btn-mode-range");
  const singleBox = document.getElementById("single-date-box");
  const rangeBox = document.getElementById("range-date-box");
  const rangeBanner = document.getElementById("range-info-banner");
  const breakdownSec = document.getElementById("range-breakdown-section");

  if (mode === "single") {
    if (btnSingle) btnSingle.classList.add("active");
    if (btnRange) btnRange.classList.remove("active");
    if (singleBox) singleBox.style.display = "flex";
    if (rangeBox) rangeBox.style.display = "none";
    if (rangeBanner) rangeBanner.style.display = "none";
    if (breakdownSec) breakdownSec.style.display = "none";

    ["kpi-disponibilidad-sub", "kpi-desempeño-sub", "kpi-calidad-sub", "kpi-oee-sub"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });

    const selector = document.getElementById("dateSelector");
    if (selector && selector.value) {
      loadByDate(selector.value);
    } else {
      loadLatestDate();
    }
  } else {
    if (btnSingle) btnSingle.classList.remove("active");
    if (btnRange) btnRange.classList.add("active");
    if (singleBox) singleBox.style.display = "none";
    if (rangeBox) rangeBox.style.display = "flex";

    applyCurrentRange();
  }
}

function applyOeePreset(preset) {
  if (parsedDateRows.length === 0) return;
  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  const earliest = parsedDateRows[0].dateObj;
  const latest = parsedDateRows[parsedDateRows.length - 1].dateObj;

  if (preset === "all") {
    startInput.value = formatFechaInput(earliest);
    endInput.value = formatFechaInput(latest);
  } else {
    const days = parseInt(preset, 10) || 7;
    const target = new Date(latest.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    startInput.value = formatFechaInput(target < earliest ? earliest : target);
    endInput.value = formatFechaInput(latest);
  }

  applyCurrentRange();
}

function loadLatestDate() {
  const selector = document.getElementById("dateSelector");
  if (!selector || selector.options.length <= 1) return;
  const latest = selector.options[1].value;
  selector.value = latest;
  loadByDate(latest);
}

function loadByDate(fechaSeleccionada) {
  if (!fechaSeleccionada) return;
  selectedSingleDate = fechaSeleccionada;

  const item = parsedDateRows.find(p => p.dateStr === fechaSeleccionada);
  if (!item) {
    showErrorMetrics(`No se encontraron datos para la fecha ${fechaSeleccionada}`);
    return;
  }

  const row = item.row;
  const getVal = idx => (row.length > idx && row[idx] !== undefined && row[idx] !== null ? row[idx].toString().trim() : "");

  const valores = {
    turnos: getVal(colIndices.turnos) || "24:00:00",
    parosProgramados: getVal(colIndices.parosProgramados),
    parosNoProgramados: getVal(colIndices.parosNoProgramados),
    tiempoTotal: getVal(colIndices.tiempoTotal),
    tiempoMuerto: getVal(colIndices.tiempoMuerto),
    qqsMojadoIngresados: getVal(colIndices.qqsMojadoIngresados) || "0",
    qqsMojadoEntrados: getVal(colIndices.qqsMojadoEntrados) || "0",
    procesados: getVal(colIndices.procesados) || "N/A",
    rechazados: getVal(colIndices.rechazados) || "N/A",
    disponibilidad: getVal(colIndices.disponibilidad),
    desempeno: getVal(colIndices.desempeno),
    calidad: getVal(colIndices.calidad),
    oee: getVal(colIndices.oee)
  };

  const tablaBody = document.getElementById("tabla-body");
  if (tablaBody) {
    tablaBody.innerHTML = `
      <tr><td>Turnos</td><td>${valores.turnos}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Paros Programados</td><td>${formatHoras(valores.parosProgramados)}</td><td><span class="status-badge warning">Planificado</span></td></tr>
      <tr><td>Paros No Programados</td><td>${formatHoras(valores.parosNoProgramados)}</td><td><span class="status-badge danger">Crítico</span></td></tr>
      <tr><td>Tiempo Total</td><td>${formatHoras(valores.tiempoTotal)}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Tiempo Muerto</td><td>${formatHoras(valores.tiempoMuerto)}</td><td><span class="status-badge success">Excelente</span></td></tr>
      <tr><td>QQs Mojado Recibidos en Planta</td><td>${valores.qqsMojadoEntrados}</td><td><span class="status-badge info">Entrados</span></td></tr>
      <tr><td>QQs Enviados</td><td>${valores.qqsMojadoIngresados}</td><td><span class="status-badge info">Registrado</span></td></tr>
      <tr><td>QQs Oro Bruto Procesados</td><td>${valores.procesados}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Rechazados</td><td>${valores.rechazados}</td><td><span class="status-badge success">Controlado</span></td></tr>
    `;
  }

  const dispEl = document.getElementById("kpi-disponibilidad");
  if (dispEl) dispEl.textContent = formatPercent(valores.disponibilidad);

  const desEl = document.getElementById("kpi-desempeño");
  if (desEl) desEl.textContent = formatPercent(valores.desempeno);

  const calEl = document.getElementById("kpi-calidad");
  if (calEl) calEl.textContent = formatPercent(valores.calidad);

  const oeeEl = document.getElementById("kpi-oee");
  if (oeeEl) {
    oeeEl.textContent = formatPercent(valores.oee);
    oeeEl.style.color = getOeeColor(parsePercent(valores.oee));
  }

  ["kpi-disponibilidad-sub", "kpi-desempeño-sub", "kpi-calidad-sub", "kpi-oee-sub"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const tablaTitulo = document.getElementById("tabla-metricas-titulo");
  if (tablaTitulo) tablaTitulo.textContent = `Detalle de Operación - ${fechaSeleccionada}`;

  const breakdown = document.getElementById("range-breakdown-section");
  if (breakdown) breakdown.style.display = "none";

  const banner = document.getElementById("range-info-banner");
  if (banner) banner.style.display = "none";
}

function applyCurrentRange() {
  const startInput = document.getElementById("range-start");
  const endInput = document.getElementById("range-end");
  const banner = document.getElementById("range-info-banner");
  if (!startInput || !endInput || !startInput.value || !endInput.value) return;

  let s = parseFecha(startInput.value);
  let e = parseFecha(endInput.value);
  if (!s || !e) return;

  if (s > e) {
    const t = s; s = e; e = t;
    startInput.value = formatFechaInput(s);
    endInput.value = formatFechaInput(e);
  }

  const matched = parsedDateRows.filter(p => p.dateObj >= s && p.dateObj <= e);
  if (matched.length === 0) {
    if (banner) {
      banner.className = "range-info-banner warning";
      banner.style.display = "flex";
      banner.innerHTML = `No se encontraron registros de datos entre <strong>${formatFechaDisplay(s)}</strong> y <strong>${formatFechaDisplay(e)}</strong>.`;
    }
    resetKpisToEmpty();
    return;
  }

  calculateAndRenderOeeRange(matched, s, e);
}

function calculateAndRenderOeeRange(rowsList, startDate, endDate) {
  let totalTurnos = 0;
  let totalParosProg = 0;
  let totalParosNoProg = 0;
  let totalTiempoTotal = 0;
  let totalTiempoMuerto = 0;
  let totalQqsMojado = 0;
  let totalQqsEntrados = 0;
  let totalProcesados = 0;

  let sumWeightedDesempeno = 0;
  let sumWeightedCalidad = 0;
  let totalWeightCalidad = 0;
  let sumOee = 0;
  let sumDisp = 0;

  const dailyDetails = [];

  rowsList.forEach(item => {
    const r = item.row;
    const getVal = idx => (r.length > idx && r[idx] !== undefined && r[idx] !== null ? r[idx].toString().trim() : "");

    const turnosH = parseTimeToHours(getVal(colIndices.turnos)) || 24;
    const parosProgH = parseTimeToHours(getVal(colIndices.parosProgramados));
    const parosNoProgH = parseTimeToHours(getVal(colIndices.parosNoProgramados));
    const tiempoTotalH = parseTimeToHours(getVal(colIndices.tiempoTotal));
    const tiempoMuertoH = parseTimeToHours(getVal(colIndices.tiempoMuerto));
    const qqsMojado = parseLocaleNumber(getVal(colIndices.qqsMojadoIngresados));
    const qqsEntrados = parseLocaleNumber(getVal(colIndices.qqsMojadoEntrados));
    const procesados = parseLocaleNumber(getVal(colIndices.procesados));

    const disp = parsePercent(getVal(colIndices.disponibilidad));
    const desemp = parsePercent(getVal(colIndices.desempeno));
    const cal = parsePercent(getVal(colIndices.calidad));
    const oee = parsePercent(getVal(colIndices.oee));

    totalTurnos += turnosH;
    totalParosProg += parosProgH;
    totalParosNoProg += parosNoProgH;
    totalTiempoTotal += tiempoTotalH;
    totalTiempoMuerto += tiempoMuertoH;
    totalQqsMojado += qqsMojado;
    totalQqsEntrados += qqsEntrados;
    totalProcesados += procesados;

    sumWeightedDesempeno += desemp * tiempoTotalH;
    if (qqsMojado > 0) {
      sumWeightedCalidad += cal * qqsMojado;
      totalWeightCalidad += qqsMojado;
    }
    sumOee += oee;
    sumDisp += disp;

    dailyDetails.push({
      fecha: item.dateStr,
      turnosStr: getVal(colIndices.turnos) || "24:00:00",
      tiempoTotalStr: formatHoras(getVal(colIndices.tiempoTotal)),
      qqsMojado: qqsMojado.toFixed(2),
      disponibilidad: disp,
      desempeno: desemp,
      calidad: cal,
      oee: oee
    });
  });

  const N = rowsList.length;
  const dispRange = totalTurnos > 0 ? (totalTiempoTotal / totalTurnos) * 100 : (N > 0 ? sumDisp / N : 0);
  const desempRange = totalTiempoTotal > 0 ? (sumWeightedDesempeno / totalTiempoTotal) : (N > 0 ? sumWeightedDesempeno / N : 0);
  const calRange = totalWeightCalidad > 0 ? (sumWeightedCalidad / totalWeightCalidad) : (N > 0 ? sumDisp / N : 100);
  const oeeRange = (dispRange / 100) * (desempRange / 100) * (calRange / 100) * 100;
  const oeeAvg = N > 0 ? sumOee / N : 0;

  const banner = document.getElementById("range-info-banner");
  if (banner) {
    banner.className = "range-info-banner";
    banner.style.display = "flex";
    banner.innerHTML = `
      <span>Consolidado del <strong>${formatFechaDisplay(startDate)}</strong> al <strong>${formatFechaDisplay(endDate)}</strong> (${N} día${N > 1 ? "s" : ""} evaluado${N > 1 ? "s" : ""})</span>
      <span style="font-size: 13px; font-weight: 600;">OEE Ponderado: ${oeeRange.toFixed(2)}%</span>
    `;
  }

  const dispEl = document.getElementById("kpi-disponibilidad");
  if (dispEl) dispEl.textContent = dispRange.toFixed(2) + "%";
  const dispSub = document.getElementById("kpi-disponibilidad-sub");
  if (dispSub) {
    dispSub.style.display = "block";
    dispSub.textContent = `${formatHoursToTime(totalTiempoTotal)} / ${formatHoursToTime(totalTurnos)}`;
  }

  const desEl = document.getElementById("kpi-desempeño");
  if (desEl) desEl.textContent = desempRange.toFixed(2) + "%";
  const desSub = document.getElementById("kpi-desempeño-sub");
  if (desSub) {
    desSub.style.display = "block";
    desSub.textContent = `Ponderado en ${formatHoursToTime(totalTiempoTotal)}`;
  }

  const calEl = document.getElementById("kpi-calidad");
  if (calEl) calEl.textContent = calRange.toFixed(2) + "%";
  const calSub = document.getElementById("kpi-calidad-sub");
  if (calSub) {
    calSub.style.display = "block";
    calSub.textContent = "Eficiencia de calidad";
  }

  const oeeEl = document.getElementById("kpi-oee");
  if (oeeEl) {
    oeeEl.textContent = oeeRange.toFixed(2) + "%";
    oeeEl.style.color = getOeeColor(oeeRange);
  }
  const oeeSub = document.getElementById("kpi-oee-sub");
  if (oeeSub) {
    oeeSub.style.display = "block";
    oeeSub.textContent = `Promedio diario: ${oeeAvg.toFixed(2)}%`;
  }

  const tablaTitulo = document.getElementById("tabla-metricas-titulo");
  if (tablaTitulo) tablaTitulo.textContent = `Totales Operativos del Periodo (${N} días)`;

  const tablaBody = document.getElementById("tabla-body");
  if (tablaBody) {
    tablaBody.innerHTML = `
      <tr><td>Turnos Totales</td><td>${formatHoursToTime(totalTurnos)}</td><td><span class="status-badge warning">${N} días</span></td></tr>
      <tr><td>Paros Programados</td><td>${formatHoursToTime(totalParosProg)}</td><td><span class="status-badge warning">Acumulado</span></td></tr>
      <tr><td>Paros No Programados</td><td>${formatHoursToTime(totalParosNoProg)}</td><td><span class="status-badge danger">Crítico</span></td></tr>
      <tr><td>Tiempo Total Operativo</td><td>${formatHoursToTime(totalTiempoTotal)}</td><td><span class="status-badge success">En Marcha</span></td></tr>
      <tr><td>Tiempo Muerto</td><td>${formatHoursToTime(totalTiempoMuerto)}</td><td><span class="status-badge success">Controlado</span></td></tr>
      <tr><td>QQs Mojado Recibidos en Planta</td><td>${totalQqsEntrados.toFixed(2)}</td><td><span class="status-badge info">Total Entrados</span></td></tr>
      <tr><td>QQs Mojado a Secadoras (OEE)</td><td>${totalQqsMojado.toFixed(2)}</td><td><span class="status-badge info">Total Secado</span></td></tr>
      <tr><td>QQs Oro Bruto Procesados</td><td>${totalProcesados.toFixed(2)}</td><td><span class="status-badge warning">Total Oro</span></td></tr>
      <tr><td>Tasa de Rechazo estimada</td><td>${(100 - calRange).toFixed(2)}%</td><td><span class="status-badge success">Calidad</span></td></tr>
    `;
  }

  const breakdownSection = document.getElementById("range-breakdown-section");
  const breakdownBody = document.getElementById("breakdown-table-body");
  const totalDaysBadge = document.getElementById("breakdown-total-days");

  if (breakdownSection && breakdownBody) {
    breakdownSection.style.display = "block";
    if (totalDaysBadge) totalDaysBadge.textContent = `${N} días registrados`;

    breakdownBody.innerHTML = dailyDetails.map(d => `
      <tr>
        <td><strong>${d.fecha}</strong></td>
        <td>${d.turnosStr}</td>
        <td>${d.tiempoTotalStr}</td>
        <td>${d.qqsMojado}</td>
        <td>${d.disponibilidad.toFixed(2)}%</td>
        <td>${d.desempeno.toFixed(2)}%</td>
        <td>${d.calidad.toFixed(2)}%</td>
        <td>${getOeeBadgeHtml(d.oee)}</td>
        <td>
          <button type="button" class="btn-mini-view" onclick="viewSingleDayFromBreakdown('${d.fecha}')">Ver día</button>
        </td>
      </tr>
    `).join("");
  }
}

function viewSingleDayFromBreakdown(fecha) {
  setMetricsMode("single");
  const selector = document.getElementById("dateSelector");
  if (selector) selector.value = fecha;
  loadByDate(fecha);
}
window.viewSingleDayFromBreakdown = viewSingleDayFromBreakdown;

function resetKpisToEmpty() {
  ["kpi-disponibilidad", "kpi-desempeño", "kpi-calidad", "kpi-oee"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "--%";
  });
  const tablaBody = document.getElementById("tabla-body");
  if (tablaBody) tablaBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--gray);">Sin datos en el rango seleccionado</td></tr>`;
  const breakdown = document.getElementById("range-breakdown-section");
  if (breakdown) breakdown.style.display = "none";
}


/* ==========================================================================
   ACTUALIZACIÓN UNIFICADA Y EVENTOS GLOBALES
   ========================================================================== */

async function refreshAllData() {
  console.log("Refrescando todos los datos...");
  if (document.body.dataset.page === "metrics") {
    await loadDataMetrics();
    return;
  }
  const loading1 = document.getElementById("loading");
  if (loading1) {
    loading1.style.display = "block";
    loading1.innerText = "Actualizando datos...";
  }

  const loading2 = document.getElementById("loading-message");
  if (loading2) {
    loading2.className = "loading";
    loading2.textContent = "Actualizando métricas...";
    loading2.style.display = "block";
  }

  await loadData();
}

window.refreshAllData = refreshAllData;

document.addEventListener("DOMContentLoaded", function () {
  console.log("Inicializando aplicación de reportes...");

  // Configurar listeners del módulo superior de QQs Mojado
  setupTopMojadoListeners();
  setupTrendChartControls();

  // Las métricas se cargan en su página independiente.
  if (document.body.dataset.page === "metrics") loadDataMetrics();

  // Listener para actualizar
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshAllData);
  }

  // Listener selector fecha dashboard 1
  const dateSelect = document.getElementById("date-select");
  if (dateSelect) {
    dateSelect.addEventListener("change", function () {
      updateDashboard(allData, this.value);
    });
  }
});

// Cargar solo los datos del módulo que corresponde a esta página.
if (document.body.dataset.page !== "metrics") loadData();
