console.log("SR Dashboard: app.js loaded");

(function(){
  const $ = (id)=>document.getElementById(id);

  // --- Hard requirements (offline libs) ---
  const missing = [];
  if (typeof XLSX === "undefined") missing.push("xlsx.full.min.js");
  if (typeof Chart === "undefined") missing.push("chart.umd.min.js");

  const banner = $("missingLibsBanner");
  if (banner) banner.style.display = "none";
  if (missing.length){
    if (banner){
      banner.classList.remove("hidden");
      banner.style.display = "block";
    }
    // Disable everything except info
    ["fileInput","fDivision","fPriority","chkShowClosed"].forEach(id=>{
      const el = $(id);
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "SELECT") el.disabled = true;
      else el.setAttribute("disabled","disabled");
    });
    console.error("Missing offline libraries:", missing);
    return;
  }

  // --- UI elements ---
  const fileInput = $("fileInput");
  const fDivision = $("fDivision");
  const fPriority = $("fPriority");
  const chkShowClosed = $("chkShowClosed");

  const pillExpiring = $("pillExpiring");
  const pillCount = $("pillCount");

  const kpiExport = $("kpiExport");
  const kpiTotal = $("kpiTotal");
  const kpiPending = $("kpiPending");
  const kpiHigh = $("kpiHigh");
  const kpiUrgent = $("kpiUrgent");

// --- Tables (support either: id on <table> or id on <tbody>) ---
const tblExpiringHost = $("tblExpiring");
const tblExpiring = !tblExpiringHost
  ? null
  : (tblExpiringHost.tagName === "TBODY"
      ? tblExpiringHost
      : tblExpiringHost.querySelector("tbody"));

const tblDetailHost = $("tblDetail");
const tblDetail = !tblDetailHost
  ? null
  : (tblDetailHost.tagName === "TBODY"
      ? tblDetailHost
      : tblDetailHost.querySelector("tbody"));


  // --- State ---
  let raw = [];          // all rows
  let filtered = [];     // rows shown in SR Detail
  let exportTs = new Date();

  let chartPending = null;

  // Closed-like statuses (NO entran en categorías de prioridad)
  const CLOSEDLIKE_STATUSES = new Set([
    "closed", "concluded",
    "reject", "rejected",
    "cancelled", "canceled",
    "draft"
  ]);

  // --- Helpers ---

// dd/mm/yyyy hh:mm:ss (para validaciones/mensajes)
function fmtDMYHMS(d){
  if (!d) return "";
  const pad = (n)=>String(n).padStart(2,"0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

  function safeStr(v){
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  // dd/mm/aa hh:mm (visual)
  function fmtExportTsDMY(d){
    if (!d) return "—";
    const pad = (n)=>String(n).padStart(2,"0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${yy} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Parse "Date Export: mm/dd/aa ..." de forma segura (sin depender del locale)
  function parseDateExport(text){
    if (!text) return null;
    const s = String(text).trim();

    // mm/dd/yy [hh:mm[:ss]]
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m){
      const mm = +m[1];
      const dd = +m[2];
      let yy = +m[3];
      if (yy < 100) yy = 2000 + yy;
      const hh = m[4] ? +m[4] : 0;
      const mi = m[5] ? +m[5] : 0;
      const ss = m[6] ? +m[6] : 0;
      const d = new Date(yy, mm-1, dd, hh, mi, ss, 0);
      if (!isNaN(d.getTime())) return d;
    }

    // fallback: Date() nativo
    const d2 = new Date(s);
    if (!isNaN(d2.getTime())) return d2;

    return null;
  }

  function toDate(v){
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === "number"){
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      return new Date(d.y, d.m-1, d.d, d.H, d.M, d.S);
    }
    // dd/mm/yyyy or dd-mm-yyyy [hh:mm]
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m){
      const dd = +m[1], mm=+m[2]-1, yy = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      const hh = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0;
      return new Date(yy, mm, dd, hh, mi, 0);
    }
    const d2 = new Date(s);
    if (!isNaN(d2.getTime())) return d2;
    return null;
  }

  function hoursBetween(a,b){
    if (!a || !b) return null;
    return (b.getTime() - a.getTime()) / 36e5;
  }

  function fmtDate(d){
    if (!d) return "";
    return d.toLocaleString(undefined, {
      year:"numeric", month:"short", day:"2-digit",
      hour:"2-digit", minute:"2-digit"
    });
  }

  function priorityFromHours(h){
    if (h === null || h === undefined) return {p:"NORMAL", rank: 3};
    if (h < 0) return {p:"OVERDUE", rank: 0};
    if (h < 24) return {p:"HIGH", rank: 1};
    if (h < 48) return {p:"URGENT", rank: 2};
    return {p:"NORMAL", rank: 3};
  }

  function parseDivisionFromImplementUnit(obj){
    const impl = safeStr(obj["Implement unit"] ?? obj["Implement Unit"] ?? obj["Implement unit "] ?? obj["Implement_unit"]);
    if (!impl) return "(Blank)";
    const parts = impl.split("|").map(s=>s.trim()).filter(Boolean);
    const tail = parts.length ? parts[parts.length-1] : impl;
    return tail || "(Blank)";
  }

  function badgeHtml(p){
    if (!p) return "";
    const cls = p.toLowerCase();
    return `<span class="badge ${cls}">${p}</span>`;
  }

  function escapeHtml(s){
    return safeStr(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function unique(arr){
    return Array.from(new Set(arr.map(v=>safeStr(v)))).filter(v=>v!=="");
  }

  function setOptions(selectEl, values, addAll=true){
    selectEl.innerHTML = "";
    if (addAll){
      const opt = document.createElement("option");
      opt.value=""; opt.textContent="All";
      selectEl.appendChild(opt);
    }
    values.forEach(v=>{
      const opt = document.createElement("option");
      opt.value=v; opt.textContent=v || "(Blank)";
      selectEl.appendChild(opt);
    });
  }

  function fmtLeft(h){
    if (h === null || h === undefined) return "";
    const sign = h < 0 ? "-" : "";
    const abs = Math.abs(h);
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh)*60);
    return `${sign}${hh}h ${mm}m`;
  }

  // --- Core filters (solo selects + checkbox) ---
  function applyFilters(){
    const div = safeStr(fDivision.value);
    const pr = safeStr(fPriority.value);
    const showClosed = !!(chkShowClosed && chkShowClosed.checked);

    filtered = raw.filter(r=>{
      if (!showClosed && r.isClosed) return false; // por defecto NO mostrar cerrados
      if (div && r.division !== div) return false;
      if (pr && r.priority !== pr) return false;   // cerrados tienen priority=null, así no entran si filtras prioridad
      return true;
    });

    // Sort: priority first (solo activos), luego más urgente
    filtered.sort((a,b)=>{
      const ar = a.priorityRank ?? 99;
      const br = b.priorityRank ?? 99;
      if (ar !== br) return ar - br;
      const ah = a.leftHours ?? 999999;
      const bh = b.leftHours ?? 999999;
      return ah - bh;
    });

    renderKPIs();
    renderTables();
    buildChartPending();
    pillCount.textContent = `${filtered.length.toLocaleString()} rows`;
    pillExpiring.textContent = `${getExpiring48().length} items`;
  }

  // --- KPIs & tables ---
  function renderKPIs(){
    kpiExport.textContent = fmtExportTsDMY(exportTs);
    kpiTotal.textContent = raw.length.toLocaleString();

    const pending = raw.filter(r=>!r.isClosed).length;
    kpiPending.textContent = pending.toLocaleString();

    // HIGH/URGENT solo sobre NO cerrados
    const high = raw.filter(r=>!r.isClosed && r.priority==="HIGH").length;
    const urgent = raw.filter(r=>!r.isClosed && r.priority==="URGENT").length;
    kpiHigh.textContent = `HIGH: ${high.toLocaleString()}`;
    kpiUrgent.textContent = `URGENT: ${urgent.toLocaleString()}`;
  }

  function getExpiring48(){
    return raw
      .filter(r=>!r.isClosed && r.leftHours !== null && r.leftHours <= 48 && r.leftHours >= 0)
      .sort((a,b)=>(a.leftHours??9999)-(b.leftHours??9999));
  }

  function renderTables(){
    // Expiring 48
    const exp = getExpiring48();
    tblExpiring.innerHTML = "";
    exp.forEach(r=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${badgeHtml(r.priority)}</td>
        <td class="mono">${escapeHtml(r.sr)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.division)}</td>
        <td>${fmtDate(r.end)}</td>
        <td class="mono">${fmtLeft(r.leftHours)}</td>
        <td>${escapeHtml(r.status)}</td>
      `;
      tblExpiring.appendChild(tr);
    });

    // SR Detail (filtered)
    tblDetail.innerHTML = "";
    filtered.forEach(r=>{
      const tr = document.createElement("tr");
      if (r.priority==="HIGH") tr.classList.add("rowHigh");
      if (r.priority==="URGENT") tr.classList.add("rowUrgent");
      if (r.priority==="OVERDUE") tr.classList.add("rowOverdue");

      tr.innerHTML = `
        <td>${badgeHtml(r.priority)}</td>
        <td class="mono">${escapeHtml(r.sr)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.division)}</td>
        <td>${fmtDate(r.send)}</td>
        <td>${fmtDate(r.end)}</td>
        <td class="mono">${fmtLeft(r.leftHours)}</td>
        <td class="mono">${r.remainExecDays ?? ""}</td>
        <td>${escapeHtml(r.status)}</td>
        <td class="mono">${r.evalDeadline ?? ""}</td>
        <td class="mono">${r.replyDeadline ?? ""}</td>
      `;
      tblDetail.appendChild(tr);
    });
  }

  // --- Chart: Pending by Priority & Division (solo NO cerrados) ---
  function buildChartPending(){
    if (chartPending) chartPending.destroy();

    const ctx = document.getElementById("chartPendingDiv").getContext("2d");
    const divisions = unique(raw.map(r=>r.division)).sort();

    const pri = ["OVERDUE","HIGH","URGENT","NORMAL"];
    const priData = pri.map(p=> divisions.map(d=>
      raw.filter(r=>!r.isClosed && r.division===d && r.priority===p).length
    ));

    chartPending = new Chart(ctx, {
      type:"bar",
      data:{
        labels: divisions,
        datasets: pri.map((p,i)=>({label:p, data: priData[i]}))
      },
      options:{
        responsive:true,
        plugins:{legend:{position:"bottom"}},
        scales:{x:{stacked:true}, y:{stacked:true, beginAtZero:true}}
      }
    });
  }

  // --- Load Excel ---
  async function loadExcelFile(file){
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, {type:"array", cellDates:true});
    const wsName = wb.SheetNames.includes("REPORT SR LIST") ? "REPORT SR LIST" : wb.SheetNames[0];
    const ws = wb.Sheets[wsName];

    // Find header row
    const json = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:""});
    let headerRow = -1;
    for (let i=0;i<Math.min(60,json.length);i++){
      const row = json[i].map(x=>safeStr(x).toLowerCase());
      if (row.includes("sr code") || row.includes("sr_code") || row.includes("srcode")){
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw new Error("Header row not found (expected a column named 'SR code').");

    const headers = json[headerRow].map(h=>safeStr(h));
    const rows = json.slice(headerRow+1);

    // Export timestamp: parse Date Export (mm/dd/aa) safely
    exportTs = new Date();
    for (let i=0;i<headerRow;i++){
      const rowStr = json[i].join(" ");
      const m = rowStr.match(/Date\s*Export\s*:\s*(.+)$/i);
      if (m){
        const parsed = parseDateExport(m[1]);
        if (parsed) exportTs = parsed;
      }
    }

    raw = rows
      .filter(r=> r.some(c=>safeStr(c)!==""))
      .map(r=>{
        const obj = {};
        headers.forEach((h,idx)=> obj[h]=r[idx]);

        const sr = safeStr(obj["SR code"] ?? obj["SR Code"] ?? obj["SR"] ?? obj["SR_code"]);
        const title = safeStr(obj["Title"] ?? obj["Summary"] ?? obj["Content"] ?? obj["SR title"]);
        const status = safeStr(obj["Status"] ?? obj["State"]);

        const send = toDate(obj["Send date"] ?? obj["Send Date"] ?? obj["Arrival date"] ?? obj["Arrival Date"]);
        const end  = toDate(obj["End time"] ?? obj["End Time"] ?? obj["Expire time"] ?? obj["Expire Time"] ?? obj["Deadline"]);
        const updated = toDate(obj["Updated time"] ?? obj["Updated Time"]);

        const isClosed = CLOSEDLIKE_STATUSES.has(safeStr(status).toLowerCase());

        // Priority SOLO para NO cerrados (regla tuya)
        let leftHours = null;
        let priority = null;
        let priorityRank = 99;

        if (!isClosed){
          leftHours = end ? hoursBetween(exportTs, end) : null;
          const pr = priorityFromHours(leftHours);
          priority = pr.p;
          priorityRank = pr.rank;
        } else {
          // cerrados: se pueden mostrar si el check está activo, pero NO entran a categorías
          leftHours = end ? hoursBetween(exportTs, end) : null; // opcional (solo informativo)
        }

        const remainExecDays = safeStr(obj["Remain execution time"] ?? obj["Remain Exec Time"] ?? obj["Remain execution (day)"]);
        const evalDeadline = safeStr(obj["Evaluate execution time"] ?? obj["Evaluate execution (time)"] ?? obj["Exec deadline"]);
        const replyDeadline = safeStr(obj["Reply time"] ?? obj["Reply deadline"]);

        const division = parseDivisionFromImplementUnit(obj);

        return {
          sr, title,
          division,
          status: status || "(Blank)",
          send, end, updated,
          leftHours,
          priority,
          priorityRank,
          remainExecDays,
          evalDeadline,
          replyDeadline,
          isClosed
        };
      })
      .filter(r=>r.sr || r.title);
/* ===============================
   VALIDACIÓN DE INTEGRIDAD DEL EXCEL
   =============================== */

const CONTROL_SR = "SR_VTP_20260103_1584438";
const EXPECTED_END = new Date(2026, 0, 6, 8, 0, 0); // 06/01/2026 08:00:00

const ctrl = raw.find(r => r.sr === CONTROL_SR);

/* CASO 1: NO EXISTE EL SR DE CONTROL → DATA INCOMPLETA */
if (!ctrl) {
  alert(
    "❌ DATA INCOMPLETA\n\n" +
    "No se encontró el SR de control:\n" +
    CONTROL_SR + "\n\n" +
    "El archivo Excel está incompleto o no corresponde al período correcto."
  );
  return; // ⛔ DETIENE TODO EL PROCESAMIENTO
}

/* CASO 2: SR EXISTE PERO END TIME INCORRECTO → ERROR HORARIO */
const got = ctrl.end;
const ok =
  (got instanceof Date) &&
  !isNaN(got.getTime()) &&
  got.getTime() === EXPECTED_END.getTime();

if (!ok) {
  alert(
    "❌ REPORTE MAL EXPORTADO\n\n" +
    "Revisar uso horario al exportar el Excel.\n\n" +
    "SR control: " + CONTROL_SR + "\n" +
    "End time esperado: 06/01/2026 08:00:00\n" +
    "End time encontrado: " +
    (got ? fmtDMYHMS(got) : "(vacío o inválido)")
  );
  return; // ⛔ DETIENE TODO EL PROCESAMIENTO
}

/* ===============================
   FIN VALIDACIÓN
   =============================== */
	
    // Populate Division options
    setOptions(fDivision, unique(raw.map(r=>r.division)).sort());

    // Defaults
    fDivision.value = "";
    fPriority.value = "";
    if (chkShowClosed) chkShowClosed.checked = false;

    applyFilters();
  }

  // --- Event wiring ---
  fileInput.addEventListener("change", async (e)=>{
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try{
      await loadExcelFile(file);
    }catch(err){
      alert("Could not read this Excel file.\n\n" + (err?.message || err));
      console.error(err);
    }finally{
      fileInput.value="";
    }
  });

  [fDivision, fPriority, chkShowClosed].forEach(el=>{
    if (!el) return;
    el.addEventListener("change", applyFilters);
    el.addEventListener("input", applyFilters);
  });

})();
