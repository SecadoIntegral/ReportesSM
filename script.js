/* --------------------
   PRIMER SCRIPT (Dashboard principal desde GID 1945963055)
   -------------------- */
const SPREADSHEET_ID = "1lFHQO8f33dK2W9tDbg0_74_0fddNU449ooAy-WuHdvg";
const GID = "1945963055";
const URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}`;

let allData = [];

// Parse fecha robusto (dd/mm/yyyy o yyyy-mm-dd)
function parseFecha(fechaStr) {
  if (!fechaStr) return null;
  fechaStr = (''+fechaStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return new Date(fechaStr);
  const partes = fechaStr.split("/");
  if (partes.length !== 3) return null;
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1;
  const año = parseInt(partes[2], 10);
  return new Date(año, mes, dia);
}

function fmt(num, isSecadoras = false) {
  if (isSecadoras) return Math.round(Number(num || 0)).toString();
  const n = Number((num || 0).toString().replace(",", "."));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

// CSV to JSON simple (usa encabezados)
function csvToJson(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => row[h.trim()] = (cols[j] || "").trim());
    data.push(row);
  }
  return data;
}

// splitCsvLine soporta comillas
function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
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

function populateDateSelector(data) {
  const dateSelect = document.getElementById("date-select");
  while (dateSelect.options.length > 1) dateSelect.remove(1);

  const dates = [...new Set(data.map(r => r.Fecha))]
    .filter(f => f && f !== "")
    .sort((a, b) => parseFecha(b) - parseFecha(a));

  dates.forEach(date => {
    const option = document.createElement("option");
    const d = parseFecha(date);
    option.value = date;
    option.textContent = d ? d.toLocaleDateString("es-ES") : date;
    dateSelect.appendChild(option);
  });
}

function updateDashboard(data, dateFilter = "latest") {
  let row;
  if (dateFilter === "latest") {
    // Siempre usar la última fila (más reciente)
    row = data[data.length - 1];
    // También actualizar el selector para que muestre la más reciente
    const dateSelect = document.getElementById("date-select");
    if (dateSelect) {
      dateSelect.value = "latest";
    }
  } else {
    row = data.find(r => r.Fecha === dateFilter);
  }
  if (!row) return;

  const f = parseFecha(row.Fecha);
  const fechaMostrar = f ? f.toLocaleDateString("es-ES") : (row.Fecha || "");

  document.getElementById("fecha").innerText =
    "Datos de: " + fechaMostrar +
    " | Actualizado: " + new Date().toLocaleString();

  // Compatibilidad: si el CSV tiene "QQs Mojado ingresados" o "qq mojado" o "QQ Mojado"
  const qqMojadoKey = ["QQs Mojado ingresados", "qq mojado", "QQ Mojado", "QQs Mojado"].find(k => k in row);
  const totalQssKey = ["Total QQs", "Total Qss", "Total QQ"].find(k => k in row) || "Total QQs";
  const qqPresecoKey = ["qq pre-seco", "QQ Pre-Seco", "QQ Preseco"].find(k => k in row) || "qq pre-seco";

  document.getElementById("total-qss").innerText = fmt(row[totalQssKey]);
  document.getElementById("qq-preseco").innerText = fmt(row[qqPresecoKey]);
  document.getElementById("qq-mojado").innerText = fmt( qqMojadoKey ? row[qqMojadoKey] : (row["qq mojado"] || row["QQ Mojado"] || 0) );

  document.getElementById("sec-proceso").innerText = fmt(row["Secadoras En proceso"], true);
  document.getElementById("qq-proceso").innerText = fmt(row["QQ Proceso"]);
  document.getElementById("sec-pendientes").innerText = fmt(row["Secadoras Pendientes"], true);
  document.getElementById("qq-pendientes").innerText = fmt(row["QQ pendientes"]);
  document.getElementById("sec-enviadas").innerText = fmt(row["Secadoras Enviadas"], true);
  document.getElementById("qq-enviados").innerText = fmt(row["QQ Enviados"]);

  document.getElementById("loading").style.display = "none";
}

async function loadData() {
  document.getElementById("loading").style.display = "block";
  try {
    const resp = await fetch(URL + "&cachebust=" + Date.now());
    const csv = await resp.text();
    allData = csvToJson(csv);
    populateDateSelector(allData);
    // Siempre cargar la fecha más reciente
    updateDashboard(allData, "latest");
  } catch (err) {
    console.error("Error cargando primer CSV:", err);
    document.getElementById("loading").innerText = "Error cargando datos principales";
  }
}

// El botón de actualizar llamará a ambas funciones
async function refreshAllData() {
  console.log("Actualizando todas las hojas...");
  
  // Mostrar estado de carga en ambos dashboards
  document.getElementById("loading").style.display = "block";
  document.getElementById("loading").innerText = "Actualizando datos...";
  
  const loadingMetrics = document.getElementById("loading-message");
  if (loadingMetrics) {
    loadingMetrics.style.display = "block";
    loadingMetrics.textContent = "Actualizando métricas...";
    loadingMetrics.className = "loading";
  }
  
  // Actualizar ambos dashboards
  await Promise.all([
    loadData(),
    loadDataMetrics()
  ]);
  
  console.log("Actualización completa");
}

// Configurar el botón de actualizar
document.getElementById("refresh-btn").addEventListener("click", refreshAllData);
document.getElementById("date-select").addEventListener("change", function () {
  updateDashboard(allData, this.value);
});

// Cargar datos iniciales - SIEMPRE con la fecha más reciente
loadData();

/* --------------------
   SEGUNDO SCRIPT (Métricas / KPIs desde CSV_URL)
   -------------------- */

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR38uKjMSWxeJhhRHl2Up9EA3BnrQgq7ERItdJBbM4BlHDX9JNFS9afc1jvgqmONMKz_U0Tw-IiDxJ-/pub?gid=1542097113&single=true&output=csv";

let allRows = [];
let headers = [];

// Función para cargar datos de métricas (ahora exportada para poder llamarla desde refreshAllData)
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
    
    // Guardar encabezados
    headers = rows[0];
    console.log("Encabezados encontrados:", headers);
    
    // Mostrar cada encabezado con su índice
    headers.forEach((header, index) => {
      console.log(`Columna ${index}: "${header}"`);
    });
    
    // Guardar todas las filas de datos
    allRows = rows.slice(1);
    console.log(`Se cargaron ${allRows.length} filas de datos`);
    
    hideLoading();
    fillDateSelector();
    
    if (allRows.length > 0) {
      // SIEMPRE cargar la fecha más reciente automáticamente
      loadLatestDate();
    } else {
      showError("No se encontraron datos en el CSV");
    }
    
  } catch (error) {
    console.error("Error cargando datos métricas:", error);
    showError("Error cargando datos métricas: " + error.message);
  }
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
        continue;
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
  if (!valor) return "--%";
  valor = valor.toString().replace("%", "").trim();
  let num = parseFloat(valor);
  if (isNaN(num)) return "--%";
  if (num <= 1) num = num * 100;
  return num.toFixed(2) + "%";
}

function formatHoras(valor) {
  if (!valor) return "00:00:00";
  valor = valor.toString().trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(valor)) return valor;
  if (/^\d{1,2}:\d{1,2}$/.test(valor)) {
    let [h, m] = valor.split(":").map(n => parseInt(n));
    return (String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":00");
  }
  valor = valor.replace(",", ".");
  if (/^\d+\s*h\s*\d+$/.test(valor)) {
    const parts = valor.split("h");
    let h = parseInt(parts[0]);
    let m = parseInt(parts[1]);
    return (String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") + ":00");
  }
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
  
  // BUSCAR LA COLUMNA DE FECHA CORRECTAMENTE
  let fechaIndex = -1;
  
  // Buscar por nombre común de columna fecha
  const posiblesNombresFecha = ["fecha", "date", "día", "dia"];
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] ? headers[i].toLowerCase() : '';
    if (posiblesNombresFecha.some(nombre => header.includes(nombre))) {
      fechaIndex = i;
      console.log(`Encontrada columna de fecha en índice ${i}: "${headers[i]}"`);
      break;
    }
  }
  
  // Si no se encuentra, usar la última columna como fallback
  if (fechaIndex === -1) {
    fechaIndex = headers.length - 1;
    console.log(`Usando última columna (índice ${fechaIndex}) como fecha`);
  }
  
  console.log(`Índice de fecha seleccionado: ${fechaIndex}`);

  // Obtener fechas únicas
  let fechas = [];
  let fechasConIndices = []; // Para mantener el índice original
  
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.length > fechaIndex) {
      const fecha = cleanDate(row[fechaIndex]);
      if (fecha && fecha.trim() !== "") {
        fechas.push(fecha);
        fechasConIndices.push({ fecha, index: i });
      }
    }
  }
  
  console.log("Fechas encontradas:", fechas);
  
  // Eliminar duplicados manteniendo la más reciente
  const fechasUnicas = [];
  const fechasMap = new Map();
  
  // Procesar para mantener solo la más reciente de cada fecha
  for (const item of fechasConIndices) {
    fechasMap.set(item.fecha, item.index);
  }
  
  // Convertir a array de fechas únicas
  fechas = Array.from(fechasMap.keys());
  console.log("Fechas únicas:", fechas);

  if (fechas.length === 0) {
    console.warn("No se encontraron fechas válidas");
    // Usar índices como fechas
    for (let i = 0; i < allRows.length; i++) {
      fechas.push(`Registro ${i + 1}`);
    }
  }

  // Ordenar fechas de más reciente a más antigua
  // Primero intentar ordenar como fechas reales
  let fechasOrdenadas = [...fechas];
  
  if (fechas.length > 0 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(fechas[0])) {
    fechasOrdenadas.sort((a, b) => {
      try {
        const [da, ma, ya] = a.split("/").map(Number);
        const [db, mb, yb] = b.split("/").map(Number);
        return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da); // Más reciente primero
      } catch (e) {
        return 0;
      }
    });
  } else {
    // Si no son fechas reales, invertir el orden (último registro primero)
    fechasOrdenadas.reverse();
  }
  
  console.log("Fechas ordenadas (más reciente primero):", fechasOrdenadas);

  // Agregar opciones al selector
  fechasOrdenadas.forEach(fecha => {
    const option = document.createElement("option");
    option.value = fecha;
    option.textContent = fecha;
    selector.appendChild(option);
  });

  console.log(`Se agregaron ${fechasOrdenadas.length} fechas al selector`);

  // Configurar evento de cambio
  selector.addEventListener("change", () => {
    console.log("Fecha seleccionada en métricas:", selector.value);
    if (selector.value) {
      loadByDate(selector.value);
    }
  });
}

function loadLatestDate() {
  console.log("Cargando fecha más reciente para métricas...");
  const selector = document.getElementById("dateSelector");
  if (!selector || selector.options.length <= 1) {
    console.error("No hay opciones en el selector de fechas");
    return;
  }
  
  // La primera fecha después de "Seleccionar fecha" es la más reciente
  // porque las ordenamos de más reciente a más antigua
  const fechaMasReciente = selector.options[1].value;
  console.log("Fecha más reciente disponible:", fechaMasReciente);
  
  // Seleccionar automáticamente la fecha más reciente
  selector.value = fechaMasReciente;
  loadByDate(fechaMasReciente);
}

function loadByDate(fechaSeleccionada) {
  console.log(`Cargando métricas para fecha: ${fechaSeleccionada}`);
  
  if (!fechaSeleccionada || fechaSeleccionada === "") {
    console.error("Fecha no válida");
    return;
  }
  
  // Encontrar la fila correspondiente a la fecha seleccionada
  let rowIndex = -1;
  let fechaIndex = -1;
  
  // Buscar la columna de fecha
  const posiblesNombresFecha = ["fecha", "date", "día", "dia"];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] ? headers[i].toLowerCase() : '';
    if (posiblesNombresFecha.some(nombre => header.includes(nombre))) {
      fechaIndex = i;
      break;
    }
  }
  
  // Si no se encuentra, usar la última columna
  if (fechaIndex === -1) {
    fechaIndex = headers.length - 1;
  }
  
  console.log(`Buscando fecha en columna índice ${fechaIndex}`);
  
  // Buscar la fila que coincida con la fecha seleccionada
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
  
  let row;
  if (rowIndex !== -1) {
    row = allRows[rowIndex];
    console.log(`Fila encontrada en índice ${rowIndex}:`, row);
  } else {
    console.warn(`No se encontró fila para la fecha ${fechaSeleccionada}, usando la última fila`);
    // Usar la última fila (más reciente) como fallback
    row = allRows[allRows.length - 1];
  }
  
  if (!row) {
    console.error("No hay datos disponibles");
    return;
  }
  
  console.log("Encabezados disponibles:", headers);

  // Buscar índices de columnas importantes
  const findColumnIndex = (searchTerm) => {
    return headers.findIndex(h => 
      h && h.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
  };
  
  const turnosIndex = findColumnIndex("turnos");
  const parosProgIndex = findColumnIndex("paros programados");
  const parosNoProgIndex = findColumnIndex("paros no programados");
  const tiempoTotalIndex = findColumnIndex("tiempo total");
  const tiempoMuertoIndex = findColumnIndex("tiempo muerto");
  const qqsMojadoIngresadosIndex = findColumnIndex("qqs mojado ingresados");
  const procesadosIndex = findColumnIndex("procesados");
  const rechazadosIndex = findColumnIndex("rechazados");
  const disponibilidadIndex = findColumnIndex("disponibilidad");
  const desempenoIndex = findColumnIndex("desempeño");
  const calidadIndex = findColumnIndex("calidad");
  const oeeIndex = findColumnIndex("oee");
  const qqsMojadoEntradosIndex = findColumnIndex("qqs mojado entrados");
  
  console.log("Índices encontrados:", {
    turnosIndex,
    parosProgIndex,
    parosNoProgIndex,
    tiempoTotalIndex,
    tiempoMuertoIndex,
    qqsMojadoIngresadosIndex,
    procesadosIndex,
    rechazadosIndex,
    disponibilidadIndex,
    desempenoIndex,
    calidadIndex,
    oeeIndex,
    qqsMojadoEntradosIndex
  });
  
  // Obtener valores usando índices
  const getValue = (index, defaultValue = '') => {
    if (index !== -1 && row.length > index) {
      const value = row[index];
      return value !== undefined && value !== null ? value.toString().trim() : defaultValue;
    }
    return defaultValue;
  };
  
  const turnos = getValue(turnosIndex, '24 horas');
  const parosProg = getValue(parosProgIndex);
  const parosNoProg = getValue(parosNoProgIndex);
  const tiempoTotal = getValue(tiempoTotalIndex);
  const tiempoMuerto = getValue(tiempoMuertoIndex);
  const qqsMojadoIngresados = getValue(qqsMojadoIngresadosIndex, '0');
  const procesados = getValue(procesadosIndex, 'N/A');
  const rechazados = getValue(rechazadosIndex, 'N/A');
  const disponibilidad = getValue(disponibilidadIndex);
  const desempeno = getValue(desempenoIndex);
  const calidad = getValue(calidadIndex);
  const oee = getValue(oeeIndex);
  const qqsMojadoEntrados = getValue(qqsMojadoEntradosIndex);
  
  console.log("Valores obtenidos para la tabla:", {
    qqsMojadoIngresados,
    qqsMojadoEntrados,
    disponibilidad,
    desempeno,
    calidad,
    oee
  });

  // Actualizar tabla de métricas
  const tablaBody = document.getElementById("tabla-body");
  if (tablaBody) {
    tablaBody.innerHTML = `
      <tr><td>Turnos</td><td>${turnos}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Paros Programados</td><td>${formatHoras(parosProg)}</td><td><span class="status-badge warning">Planificado</span></td></tr>
      <tr><td>Paros No Programados</td><td>${formatHoras(parosNoProg)}</td><td><span class="status-badge danger">Crítico</span></td></tr>
      <tr><td>Tiempo Total</td><td>${formatHoras(tiempoTotal)}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Tiempo Muerto</td><td>${formatHoras(tiempoMuerto)}</td><td><span class="status-badge success">Excelente</span></td></tr>
      <tr><td>QQs Mojado ingresados</td><td>${qqsMojadoIngresados}</td><td><span class="status-badge info">Nuevo</span></td></tr>
      <tr><td>Procesados</td><td>${procesados}</td><td><span class="status-badge warning">Normal</span></td></tr>
      <tr><td>Rechazados</td><td>${rechazados}</td><td><span class="status-badge success">Excelente</span></td></tr>
    `;
    console.log("Tabla de métricas actualizada");
  }

  // Actualizar KPIs
  const updateKPI = (elementId, value) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = formatPercent(value);
    }
  };
  
  updateKPI("kpi-disponibilidad", disponibilidad);
  updateKPI("kpi-desempeno", desempeno);
  updateKPI("kpi-calidad", calidad);
  updateKPI("kpi-oee", oee);

  // Actualizar tarjeta QQs Mojado - USAR LA NUEVA COLUMNA "QQs Mojado entrados"
  const kpiQQsMojadoElement = document.getElementById("kpi-qqs-mojado");
  if (kpiQQsMojadoElement) {
    // Usar la nueva columna "QQs Mojado entrados" si existe, sino usar la original
    const valorParaTarjeta = qqsMojadoEntrados || qqsMojadoIngresados || '0';
    kpiQQsMojadoElement.textContent = valorParaTarjeta;
    console.log("Tarjeta QQs Mojado actualizada con valor:", valorParaTarjeta);
    console.log("Fuente del valor:", qqsMojadoEntrados ? "Nueva columna 'QQs Mojado entrados'" : "Columna original 'QQs Mojado ingresados'");
  }
  
  console.log("Dashboard de métricas actualizado correctamente para fecha:", fechaSeleccionada);
}

// Cargar datos de métricas al inicio
document.addEventListener("DOMContentLoaded", function() {
  console.log("DOM cargado, iniciando carga de métricas...");
  loadDataMetrics();
});
