/* --------------------
   DASHBOARD PRINCIPAL
   -------------------- */

const SPREADSHEET_ID = "1lFHQO8f33dK2W9tDbg0_74_0fddNU449ooAy-WuHdvg";
const GID = "1945963055";
const URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`;

let allData = [];

/* ---------- UTILIDADES ---------- */

// Parse fecha robusto (dd/mm/yyyy o yyyy-mm-dd)
function parseFecha(fechaStr) {
  if (!fechaStr) return null;
  fechaStr = ("" + fechaStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return new Date(fechaStr);
  const partes = fechaStr.split("/");
  if (partes.length !== 3) return null;
  return new Date(
    parseInt(partes[2], 10),
    parseInt(partes[1], 10) - 1,
    parseInt(partes[0], 10)
  );
}

// Formato de valores
function fmt(value, isSecadoras = false) {
  if (isSecadoras) {
    if (value === null || value === undefined) return "";
    const num = Number(value);
    if (isNaN(num)) return value.toString().trim();
    return Math.round(num).toString();
  }
  const n = Number((value || "0").toString().replace(",", "."));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

// CSV → JSON
function csvToJson(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = (cols[i] || "").trim());
    return row;
  });
}

// Split CSV con soporte de comillas
function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  result.push(cur);
  return result;
}

/* ---------- SELECTOR FECHAS ---------- */

function populateDateSelector(data) {
  const select = document.getElementById("date-select");
  while (select.options.length > 1) select.remove(1);

  [...new Set(data.map(r => r.Fecha))]
    .filter(Boolean)
    .sort((a, b) => parseFecha(b) - parseFecha(a))
    .forEach(date => {
      const opt = document.createElement("option");
      opt.value = date;
      const d = parseFecha(date);
      opt.textContent = d ? d.toLocaleDateString("es-ES") : date;
      select.appendChild(opt);
    });
}

/* ---------- DASHBOARD ---------- */

function updateDashboard(data, dateFilter = "latest") {
  let row =
    dateFilter === "latest"
      ? data[data.length - 1]
      : data.find(r => r.Fecha === dateFilter);

  if (!row) return;

  const f = parseFecha(row.Fecha);
  document.getElementById("fecha").innerText =
    "Datos de: " +
    (f ? f.toLocaleDateString("es-ES") : row.Fecha) +
    " | Actualizado: " +
    new Date().toLocaleString();

  // Claves dinámicas
  const totalQssKey = ["Total QQs", "Total Qss", "Total QQ"].find(k => k in row);
  const qqPresecoKey = ["qq pre-seco", "QQ Pre-Seco", "QQ Preseco"].find(k => k in row);
  const qqMojadoKey = ["QQs Mojado ingresados", "qq mojado", "QQ Mojado", "QQs Mojado"].find(k => k in row);
  const qqHumedoKey = ["QQ Humedo", "qq humedo", "QQs Humedo"].find(k => k in row);

  // PRINCIPALES
  document.getElementById("total-qss").innerText = fmt(row[totalQssKey]);
  document.getElementById("qq-preseco").innerText = fmt(row[qqPresecoKey]);
  document.getElementById("qq-mojado").innerText = fmt(qqMojadoKey ? row[qqMojadoKey] : 0);
  document.getElementById("qq-humedo").innerText = fmt(qqHumedoKey ? row[qqHumedoKey] : 0);

  // SECADORAS
  document.getElementById("sec-proceso").innerText = fmt(row["Secadoras En proceso"], true);
  document.getElementById("qq-proceso").innerText = fmt(row["QQ Proceso"]);
  document.getElementById("sec-pendientes").innerText = fmt(row["Secadoras Pendientes"], true);
  document.getElementById("qq-pendientes").innerText = fmt(row["QQ pendientes"]);
  document.getElementById("sec-enviadas").innerText = fmt(row["Secadoras Enviadas"], true);
  document.getElementById("qq-enviados").innerText = fmt(row["QQ Enviados"]);

  // VERTICALES
  document.getElementById("vert-proceso").innerText = fmt(row["Verticales en proceso"], true);
  document.getElementById("qq-vert-proceso").innerText = fmt(row["QQ Verticales"]);

  document.getElementById("loading").style.display = "none";
}

/* ---------- CARGA DATOS ---------- */

async function loadData() {
  document.getElementById("loading").style.display = "block";
  try {
    const resp = await fetch(URL + "&_=" + Date.now());
    const csv = await resp.text();
    allData = csvToJson(csv);
    populateDateSelector(allData);
    updateDashboard(allData, "latest");
  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerText = "Error cargando datos";
  }
}

/* ---------- REFRESH ---------- */

async function refreshAllData() {
  document.getElementById("loading").style.display = "block";
  document.getElementById("loading").innerText = "Actualizando datos...";
  await loadData();
}

/* ---------- EVENTOS ---------- */

document.getElementById("refresh-btn").addEventListener("click", refreshAllData);
document.getElementById("date-select").addEventListener("change", function () {
  updateDashboard(allData, this.value);
});

// Carga inicial
loadData();


/* --------------------
   SEGUNDO SCRIPT (Métricas / KPIs desde CSV_URL)
   -------------------- */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR38uKjMSWxeJhhRHl2Up9EA3BnrQgq7ERItdJBbM4BlHDX9JNFS9afc1jvgqmONMKz_U0Tw-IiDxJ-/pub?gid=1542097113&single=true&output=csv";

let allRows = [];
let headers = [];

// Función para cargar datos de métricas
async function loadDataMetrics() {
  try {
    console.log("Iniciando carga de datos métricas desde:", CSV_URL);
    const timestamp = Date.now();
    const response = await fetch(CSV_URL + "&timestamp=" + timestamp);
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log("Respuesta CSV recibida");
    
    if (!text || text.trim().length === 0) {
      throw new Error("El CSV está vacío");
    }
    
    const rows = parseCSV(text);
    console.log(`Número total de filas parseadas: ${rows.length}`);
    
    if (rows.length < 2) {
      throw new Error("No hay suficientes datos en el CSV (mínimo 2 filas necesarias)");
    }
    
    // Guardar encabezados - limpiarlos
    headers = rows[0].map(header => cleanHeader(header));
    console.log("ENCABEZADOS LIMPIOS (con índices):");
    headers.forEach((header, index) => {
      console.log(`[${index}] "${header}"`);
    });
    
    // Guardar todas las filas de datos
    allRows = rows.slice(1);
    console.log(`Se cargaron ${allRows.length} filas de datos`);
    
    hideLoading();
    fillDateSelector();
    
    if (allRows.length > 0) {
      loadLatestDate();
    } else {
      showError("No se encontraron datos en el CSV");
    }
    
  } catch (error) {
    console.error("Error cargando datos métricas:", error);
    showError("Error cargando datos métricas: " + error.message);
  }
}

function cleanHeader(header) {
  if (!header) return "";
  // Remover comillas, saltos de línea y espacios extra
  return header
    .replace(/"/g, "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim();
}

function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim() !== '');
  
  const result = lines.map((line) => {
    const rowResult = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        rowResult.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Añadir el último campo
    rowResult.push(current.trim());
    
    return rowResult;
  });
  
  return result;
}

function hideLoading() {
  const loadingElement = document.getElementById('loading-message');
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }
  
  const tbl = document.querySelector('.table-container table');
  if (tbl) {
    tbl.style.display = 'table';
  }
}

function showError(message) {
  const loadingElement = document.getElementById('loading-message');
  if (loadingElement) {
    loadingElement.className = 'error';
    loadingElement.textContent = message;
    loadingElement.style.display = 'block';
  }
}

function cleanDate(str) {
  if (!str) return "";
  return str
      .replace(/\r/g, "")
      .replace(/\n/g, "")
      .replace(/\s+/g, " ")
      .replace(/"/g, "")
      .trim();
}

function formatPercent(valor) {
  if (!valor || valor === "") return "--%";
  valor = valor.toString().replace("%", "").replace(",", ".").trim();
  let num = parseFloat(valor);
  if (isNaN(num)) return "--%";
  if (num <= 1 && num > 0) num = num * 100;
  if (num > 100) num = 100; // Limitar a 100%
  return num.toFixed(2) + "%";
}

function formatHoras(valor) {
  if (!valor || valor === "") return "00:00:00";
  valor = valor.toString().trim();
  
  // Si ya está en formato HH:MM:SS
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(valor)) return valor;
  
  // Si está en formato HH:MM
  if (/^\d{1,2}:\d{1,2}$/.test(valor)) {
    let [h, m] = valor.split(":").map(n => parseInt(n) || 0);
    return (String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":00");
  }
  
  // Si es un número decimal (como 0.95, 0.96)
  if (/^\d+\.\d+$/.test(valor)) {
    let num = parseFloat(valor);
    if (!isNaN(num)) {
      let hours = Math.floor(num * 24); // Convertir fracción de día a horas
      let minutes = Math.round(((num * 24) - hours) * 60);
      return (String(hours).padStart(2,"0") + ":" + String(minutes).padStart(2,"0") + ":00");
    }
  }
  
  // Si es solo un número (horas)
  let num = parseFloat(valor);
  if (!isNaN(num)) {
    let hours = Math.floor(num);
    let minutes = Math.round((num - hours) * 60);
    return (String(hours).padStart(2,"0") + ":" + String(minutes).padStart(2,"0") + ":00");
  }
  
  return "00:00:00";
}

function fillDateSelector() {
  console.log("Llenando selector de fechas para métricas...");
  const selector = document.getElementById("dateSelector");
  if (!selector) {
    console.error("No se encontró el elemento dateSelector");
    return;
  }
  
  selector.innerHTML = "<option value=''>Seleccionar fecha</option>";

  if (allRows.length === 0) {
    console.error("No hay filas de datos para llenar el selector");
    return;
  }
  
  // Buscar la columna de FECHA - es el índice 12 según tus datos
  let fechaIndex = headers.findIndex(h => h.toLowerCase().includes("fecha"));
  if (fechaIndex === -1) {
    fechaIndex = 12; // Índice fijo basado en tu estructura
  }
  
  console.log(`Índice de fecha: ${fechaIndex} (${headers[fechaIndex]})`);

  // Obtener fechas únicas
  let fechasMap = new Map();
  
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.length > fechaIndex) {
      const fecha = cleanDate(row[fechaIndex]);
      if (fecha && fecha.trim() !== "") {
        fechasMap.set(fecha, i);
      }
    }
  }
  
  let fechas = Array.from(fechasMap.keys());
  console.log("Fechas encontradas:", fechas);

  if (fechas.length === 0) {
    console.warn("No se encontraron fechas válidas");
    return;
  }

  // Ordenar fechas de más reciente a más antigua (formato DD/MM/YYYY)
  fechas.sort((a, b) => {
    try {
      const [da, ma, ya] = a.split("/").map(Number);
      const [db, mb, yb] = b.split("/").map(Number);
      return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
    } catch (e) {
      return 0;
    }
  });
  
  console.log("Fechas ordenadas (más reciente primero):", fechas);

  // Agregar opciones al selector
  fechas.forEach(fecha => {
    const option = document.createElement("option");
    option.value = fecha;
    option.textContent = fecha;
    selector.appendChild(option);
  });

  console.log(`Se agregaron ${fechas.length} fechas al selector`);

  // Configurar evento de cambio
  selector.addEventListener("change", () => {
    console.log("Fecha seleccionada:", selector.value);
    if (selector.value) {
      loadByDate(selector.value);
    }
  });
}

function loadLatestDate() {
  console.log("Cargando fecha más reciente...");
  const selector = document.getElementById("dateSelector");
  if (!selector || selector.options.length <= 1) {
    console.error("No hay opciones en el selector de fechas");
    return;
  }
  
  const fechaMasReciente = selector.options[1].value;
  console.log("Fecha más reciente:", fechaMasReciente);
  
  selector.value = fechaMasReciente;
  loadByDate(fechaMasReciente);
}

function loadByDate(fechaSeleccionada) {
  console.log(`Cargando datos para fecha: ${fechaSeleccionada}`);
  
  if (!fechaSeleccionada || fechaSeleccionada === "") {
    console.error("Fecha no válida");
    return;
  }
  
  // Encontrar la fila correspondiente
  let rowIndex = -1;
  let fechaIndex = headers.findIndex(h => h.toLowerCase().includes("fecha"));
  if (fechaIndex === -1) fechaIndex = 12;
  
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.length > fechaIndex) {
      const fechaEnFila = cleanDate(row[fechaIndex]);
      if (fechaEnFila === fechaSeleccionada) {
        rowIndex = i;
        break;
      }
    }
  }
  
  if (rowIndex === -1) {
    console.error(`No se encontró fila para la fecha ${fechaSeleccionada}`);
    showError(`No se encontraron datos para la fecha ${fechaSeleccionada}`);
    return;
  }
  
  const row = allRows[rowIndex];
  console.log(`Fila encontrada en índice ${rowIndex}:`, row);
  
  // DEFINIR ÍNDICES FIJOS BASADOS EN TU ESTRUCTURA
  const indices = {
    turnos: 0,                    // "Turnos"
    parosProgramados: 1,          // "Paros Programado"
    parosNoProgramados: 2,        // "Paros no Programados"
    tiempoTotal: 3,               // "Tiempo Total"
    tiempoMuerto: 4,              // "Tiempo Muerto"
    qqsMojadoIngresados: 5,       // "QQs Mojado ingresados"
    procesados: 6,                // "Procesados"
    rechazados: 7,                // "Rechazados"
    disponibilidad: 8,            // "Disponibilidad"
    desempeno: 9,                 // "Desempeño"
    calidad: 10,                  // "Calidad"
    oee: 11,                      // "OEE"
    fecha: 12,                    // "Fecha"
    qqsMojadoEntrados: 13         // "QQs Mojado entrados"
  };
  
  console.log("Índices fijos usados:", indices);
  
  // Función para obtener valores
  const getValue = (index, defaultValue = '') => {
    if (row.length > index && row[index] !== undefined && row[index] !== null) {
      return row[index].toString().trim();
    }
    return defaultValue;
  };
  
  // Obtener todos los valores
  const valores = {
    turnos: getValue(indices.turnos, '24:00:00'),
    parosProgramados: getValue(indices.parosProgramados),
    parosNoProgramados: getValue(indices.parosNoProgramados),
    tiempoTotal: getValue(indices.tiempoTotal),
    tiempoMuerto: getValue(indices.tiempoMuerto),
    qqsMojadoIngresados: getValue(indices.qqsMojadoIngresados, '0'),
    procesados: getValue(indices.procesados, 'N/A'),
    rechazados: getValue(indices.rechazados, 'N/A'),
    disponibilidad: getValue(indices.disponibilidad),
    desempeno: getValue(indices.desempeno),
    calidad: getValue(indices.calidad),
    oee: getValue(indices.oee),
    qqsMojadoEntrados: getValue(indices.qqsMojadoEntrados, '0')
  };
  
  console.log("Valores obtenidos:", valores);
  
  // ACTUALIZAR TABLA DE MÉTRICAS
  const tablaBody = document.getElementById("tabla-body");
  if (tablaBody) {
    tablaBody.innerHTML = `
      <tr><td>Turnos</td><td>${valores.turnos}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Paros Programados</td><td>${formatHoras(valores.parosProgramados)}</td><td><span class="status-badge warning">Planificado</span></td></tr>
      <tr><td>Paros No Programados</td><td>${formatHoras(valores.parosNoProgramados)}</td><td><span class="status-badge danger">Crítico</span></td></tr>
      <tr><td>Tiempo Total</td><td>${formatHoras(valores.tiempoTotal)}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Tiempo Muerto</td><td>${formatHoras(valores.tiempoMuerto)}</td><td><span class="status-badge success">Excelente</span></td></tr>
      <tr><td>QQs Mojado procesados</td><td>${valores.qqsMojadoIngresados}</td><td><span class="status-badge info">Nuevo</span></td></tr>
      <tr><td>QQs Oro Bruto Procesados</td><td>${valores.procesados}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Rechazados</td><td>${valores.rechazados}</td><td><span class="status-badge success">Excelente</span></td></tr>
    `;
    console.log("Tabla de métricas actualizada");
  }
  
  // ACTUALIZAR KPIs
  const kpiElements = {
    "kpi-disponibilidad": valores.disponibilidad,
    "kpi-desempeño": valores.desempeno,
    "kpi-calidad": valores.calidad,
    "kpi-oee": valores.oee
  };
  
  Object.entries(kpiElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = formatPercent(value);
      console.log(`KPI ${id} actualizado a: ${formatPercent(value)}`);
    }
  });
  
  // ACTUALIZAR TARJETA QQS MOJADO
  const kpiQQsMojadoElement = document.getElementById("kpi-qqs-mojado");
  if (kpiQQsMojadoElement) {
    const valor = valores.qqsMojadoEntrados || valores.qqsMojadoIngresados || '0';
    kpiQQsMojadoElement.textContent = parseFloat(valor).toFixed(2);
    console.log(`Tarjeta QQs Mojado actualizada a: ${valor}`);
  }
  
  // Actualizar título de métricas con fecha
  const tituloMetricas = document.querySelector(".header-content h1");
  if (tituloMetricas) {
    tituloMetricas.textContent = `Métricas de Proceso - ${fechaSeleccionada}`;
  }
  
  console.log("Dashboard actualizado correctamente para fecha:", fechaSeleccionada);
}

// Función para refrescar todos los datos
function refreshAllData() {
  console.log("Refrescando todos los datos...");
  const loadingElement = document.getElementById('loading-message');
  if (loadingElement) {
    loadingElement.className = 'loading';
    loadingElement.textContent = 'Cargando datos...';
    loadingElement.style.display = 'block';
  }
  loadDataMetrics();
}

// Cargar datos al inicio
document.addEventListener("DOMContentLoaded", function() {
  console.log("DOM cargado, iniciando carga de métricas...");
  loadDataMetrics();
  
  // Agregar botón de refresh si es necesario
  const refreshButton = document.getElementById('refresh-button');
  if (refreshButton) {
    refreshButton.addEventListener('click', refreshAllData);
  }
});

// Hacer refreshAllData disponible globalmente
window.refreshAllData = refreshAllData;


