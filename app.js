/* Postura Round 2
   GitHub Pages / Web Bluetooth client
   Existing ESP firmware is not modified by this app.

   IMPORTANT:
   If your packed firmware uses different UUIDs or a different payload,
   change only SERVICE_UUID / CHARACTERISTIC_UUID and parseAngle().
*/

const CONFIG = {
  SERVICE_UUID: "12345678-1234-1234-1234-1234567890ab",
  CHARACTERISTIC_UUID: "abcd1234-5678-1234-5678-abcdef123456",
  READINESS_SAMPLE_MS: 2500,
  READINESS_MAX_ANGLE: 30
};

let bleDevice = null;
let bleCharacteristic = null;
let currentAngle = null;
let currentDeviation = null;
let goodPostureAngle = 90;
let threshold = Number(localStorage.getItem("posturaThreshold") || 15);
let session = null;
let sessionTimer = null;
let sessionStart = null;
let lastBadAt = null;
let slouchSeconds = 0;
let slouchCount = 0;
let score = 100;
let readinessState = "idle";
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function showToast(message){
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function setConnection(online, text){
  $("connectionDot").className = "dot " + (online ? "online" : "offline");
  $("deviceDot").className = "dot " + (online ? "online" : "offline");
  $("connectionText").textContent = text;
  $("deviceStatus").textContent = online ? "Postura connected" : "Device offline";
}

function updateThresholdUI(){
  const goodSlider = $("goodPostureSlider");
  if(goodSlider) goodPostureAngle = Number(goodSlider.value);

  const goodValue = $("goodPostureValue");
  if(goodValue) goodValue.textContent = `${goodPostureAngle}°`;

  const readinessAngle = $("readinessThreshold");
  if(readinessAngle) readinessAngle.textContent = `${goodPostureAngle}°`;

  const thresholdSlider = $("thresholdSlider");
  if(thresholdSlider) thresholdSlider.value = String(threshold);

  const thresholdLabel = $("thresholdLabel");
  if(thresholdLabel) thresholdLabel.textContent = `Live Threshold ${threshold}°`;

  const activeThreshold = $("activeThreshold");
  if(activeThreshold) activeThreshold.textContent = `${threshold}°`;
}


function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function parsePosturaPayload(raw){
  if (typeof raw !== "string") raw = new TextDecoder().decode(raw);
  raw = raw.trim();

  // Actual packed Postura V3 firmware sends:
  // currentAngle,deviation
  // Example: 91.20,4.80
  const parts = raw.split(",");
  if (parts.length < 2) return null;

  const current = Number(parts[0]);
  const deviation = Number(parts[1]);

  if (!Number.isFinite(current) || !Number.isFinite(deviation)) return null;

  return {
    currentAngle: current,
    deviation: Math.abs(deviation)
  };
}

function updateLiveData(current, deviation){
  currentAngle = current;
  currentDeviation = Math.abs(deviation);

  $("heroAngle").textContent = `${currentAngle.toFixed(1)}°`;
  $("angleValue").textContent = `${currentAngle.toFixed(1)}°`;
  $("activeAngle").textContent = `${currentAngle.toFixed(1)}°`;
  $("readinessAngle").textContent = `${currentAngle.toFixed(1)}°`;

  const pct = clamp((currentDeviation / threshold) * 100, 0, 100);
  $("angleBar").style.width = `${pct}%`;

  const bad = currentDeviation > threshold;
  $("angleBar").style.background = bad ? "var(--red)" : "var(--green)";

  $("heroPosture").textContent = bad ? "Posture needs correction" : "Posture within threshold";
  $("postureStatus").textContent = bad ? "Poor Posture" : "Good Posture";
  $("postureStatus").className = "status-large " + (bad ? "bad" : "good");
  $("postureMessage").textContent = bad
    ? `Deviation is above your ${threshold}° threshold.`
    : `Deviation is within your ${threshold}° threshold.`;

  if(session){
    $("activePosture").textContent = bad ? "Poor Posture" : "Good Posture";
    $("activePosture").className = "status-large " + (bad ? "bad" : "good");
    $("activeMessage").textContent = bad
      ? "Correct your posture. Your wearable's existing feedback remains active."
      : "Posture is within your configured threshold.";

    if(bad){
      if(lastBadAt === null){
        lastBadAt = Date.now();
        slouchCount++;
        score = clamp(score - 3, 0, 100);
      }
    }else{
      if(lastBadAt !== null){
        slouchSeconds += Math.round((Date.now() - lastBadAt) / 1000);
        lastBadAt = null;
      }
    }
    updateSessionStats();
  }
}
function updateSessionStats(){
  $("slouchCount").textContent = slouchCount;
  $("activeSlouchCount").textContent = slouchCount;
  $("slouchTime").textContent = formatDuration(slouchSeconds);
  $("activeSlouchTime").textContent = formatDuration(slouchSeconds);
  $("scoreValue").textContent = score;
  $("activeScore").textContent = score;
}

function formatDuration(totalSeconds){
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if(h) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

async function connectPostura(){
  if(!navigator.bluetooth){
    showToast("Web Bluetooth is not available. Use Chrome or Edge on HTTPS.");
    return;
  }

  try{
    $("connectBtn").textContent = "Connecting...";
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [CONFIG.SERVICE_UUID] }]
    });

    bleDevice.addEventListener("gattserverdisconnected", onDisconnected);

    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(CONFIG.SERVICE_UUID);
    bleCharacteristic = await service.getCharacteristic(CONFIG.CHARACTERISTIC_UUID);

    await bleCharacteristic.startNotifications();
    bleCharacteristic.addEventListener("characteristicvaluechanged", handleBleValue);

    setConnection(true, bleDevice.name || "Postura connected");
    $("connectBtn").textContent = "Connected";
    showToast("Postura connected successfully.");
  }catch(err){
    console.error(err);
    $("connectBtn").textContent = "Connect Postura";
    setConnection(false, "Not connected");
    showToast(err.name === "NotFoundError" ? "Device selection cancelled." : "Could not connect to Postura.");
  }
}

function onDisconnected(){
  setConnection(false, "Disconnected");
  $("connectBtn").textContent = "Connect Postura";
  bleCharacteristic = null;
  showToast("Postura disconnected.");
}

function handleBleValue(event){
  const raw = new TextDecoder().decode(event.target.value);
  const data = parsePosturaPayload(raw);
  if(data !== null) updateLiveData(data.currentAngle, data.deviation);
}

function stableAngleRead(){
  return new Promise((resolve) => {
    const samples = [];
    const started = Date.now();

    const collect = () => {
      if(currentDeviation !== null) samples.push(currentDeviation);
      if(Date.now() - started >= CONFIG.READINESS_SAMPLE_MS){
        if(!samples.length){
          resolve(null);
          return;
        }
        samples.sort((a,b)=>a-b);
        const mid = Math.floor(samples.length/2);
        const median = samples.length % 2 ? samples[mid] : (samples[mid-1]+samples[mid])/2;
        resolve(median);
        return;
      }
      requestAnimationFrame(collect);
    };
    collect();
  });
}

function showReadinessCard(){
  $("readinessEmpty").classList.add("hidden");
  $("readinessCard").classList.remove("hidden");
}

function resetReadinessUI(){
  readinessState = "idle";
  $("readinessBadge").textContent = "Not checked";
  $("readinessBadge").className = "badge neutral";
  $("readinessStatusText").textContent = "Ready to check";
  $("conflictPanel").classList.add("hidden");
  $("resolutionPanel").classList.add("hidden");
  $("checkReadinessBtn").classList.remove("hidden");
  $("recheckBtn").classList.add("hidden");
  $("proceedBtn").classList.add("hidden");
  $("startSessionBtn").classList.add("hidden");
}

async function runReadinessCheck(isRecheck=false){
  if(currentAngle === null){
    showToast("Connect Postura and wait for a live angle before checking readiness.");
    return;
  }

  const actionBtn = isRecheck ? $("recheckBtn") : $("checkReadinessBtn");
  actionBtn.disabled = true;
  actionBtn.textContent = isRecheck ? "Rechecking..." : "Checking...";

  const measured = await stableAngleRead();
  const angle = measured === null ? currentAngle : measured;

  $("readinessAngle").textContent = `${angle.toFixed(1)}°`;
  $("readinessThreshold").textContent = `${goodPostureAngle}°`;

  const conflict = angle > goodPostureAngle;

  if(conflict){
    readinessState = "conflict";
    $("readinessBadge").textContent = "Conflict detected";
    $("readinessBadge").className = "badge bad";
    $("readinessStatusText").textContent = "Action requires posture correction";
    $("conflictPanel").classList.remove("hidden");
    $("resolutionPanel").classList.add("hidden");
    $("checkReadinessBtn").classList.add("hidden");
    $("recheckBtn").classList.remove("hidden");
    $("proceedBtn").classList.remove("hidden");
    $("startSessionBtn").classList.add("hidden");
  }else{
    readinessState = "resolved";
    $("readinessBadge").textContent = isRecheck ? "Conflict resolved" : "Ready";
    $("readinessBadge").className = "badge good";
    $("readinessStatusText").textContent = isRecheck ? "Ready after recheck" : "Ready to start";
    $("conflictPanel").classList.add("hidden");
    if(isRecheck) $("resolutionPanel").classList.remove("hidden");
    else $("resolutionPanel").classList.add("hidden");
    $("checkReadinessBtn").classList.add("hidden");
    $("recheckBtn").classList.add("hidden");
    $("proceedBtn").classList.add("hidden");
    $("startSessionBtn").classList.remove("hidden");
  }

  actionBtn.disabled = false;
  actionBtn.textContent = isRecheck ? "Recheck Posture" : "Check Readiness";
}

function createSession(activity, duration){
  session = {
    activity,
    plannedMinutes: Number(duration),
    readinessStatus: "not_checked",
    initialAngle: null,
    recheckAngle: null,
    threshold
  };
  $("plannedActivity").textContent = activity;
  $("plannedDuration").textContent = `${duration} minutes`;
  showReadinessCard();
  resetReadinessUI();
  document.querySelector("#readiness").scrollIntoView({behavior:"smooth"});
}

function startSession(proceededAnyway=false){
  if(!session) return;
  session.readinessStatus = proceededAnyway ? "proceeded_with_conflict" : "passed";
  session.initialAngle = currentAngle;
  session.threshold = threshold;
  session.startedAt = Date.now();

  if(readinessState === "resolved") session.readinessStatus = "conflict_resolved";

  sessionStart = Date.now();
  slouchSeconds = 0;
  slouchCount = 0;
  score = 100;
  lastBadAt = null;

  $("activeActivity").textContent = session.activity;
  $("activeSession").classList.remove("hidden");
  $("sessions").classList.add("hidden");
  $("history").classList.add("hidden");

  updateSessionStats();
  $("activeSession").scrollIntoView({behavior:"smooth"});

  clearInterval(sessionTimer);
  sessionTimer = setInterval(updateSessionClock, 1000);
  updateSessionClock();
  showToast("Session started.");
}

function updateSessionClock(){
  if(!sessionStart) return;
  $("sessionClock").textContent = formatDuration(Math.floor((Date.now()-sessionStart)/1000));
}

function endSession(){
  if(!session) return;

  if(lastBadAt !== null){
    slouchSeconds += Math.round((Date.now()-lastBadAt)/1000);
    lastBadAt = null;
  }

  const record = {
    id: Date.now(),
    activity: session.activity,
    plannedMinutes: session.plannedMinutes,
    durationSeconds: Math.floor((Date.now()-sessionStart)/1000),
    slouchCount,
    slouchSeconds,
    score,
    readinessStatus: session.readinessStatus,
    initialAngle: session.initialAngle,
    recheckAngle: session.recheckAngle,
    threshold: session.threshold,
    completedAt: new Date().toISOString()
  };

  const history = JSON.parse(localStorage.getItem("posturaHistory") || "[]");
  history.unshift(record);
  localStorage.setItem("posturaHistory", JSON.stringify(history.slice(0,30)));

  clearInterval(sessionTimer);
  sessionTimer = null;
  sessionStart = null;
  session = null;

  $("activeSession").classList.add("hidden");
  $("sessions").classList.remove("hidden");
  $("history").classList.remove("hidden");
  $("readinessCard").classList.add("hidden");
  $("readinessEmpty").classList.remove("hidden");

  renderHistory();
  showToast("Session saved.");
  $("history").scrollIntoView({behavior:"smooth"});
}

function renderHistory(){
  const list = $("historyList");
  const history = JSON.parse(localStorage.getItem("posturaHistory") || "[]");

  if(!history.length){
    list.innerHTML = `<div class="empty-state"><h3>No sessions yet</h3><p>Completed sessions will appear here.</p></div>`;
    return;
  }

  list.innerHTML = history.map(item => {
    const statusGood = item.readinessStatus === "passed" || item.readinessStatus === "conflict_resolved";
    const readinessText = item.readinessStatus === "conflict_resolved"
      ? "✓ Conflict resolved"
      : item.readinessStatus === "proceeded_with_conflict"
        ? "⚠ Proceeded with conflict"
        : "✓ Passed";

    return `
      <div class="history-item">
        <div><strong>${escapeHtml(item.activity)}</strong><br><span>${formatDuration(item.durationSeconds)}</span></div>
        <div><span>Posture score</span><br><strong>${item.score}/100</strong></div>
        <div><span>Slouches</span><br><strong>${item.slouchCount}</strong></div>
        <div><span class="history-badge ${statusGood ? "good" : "warn"}">${readinessText}</span><br><span>${item.initialAngle != null ? item.initialAngle.toFixed(1) : "--"}° deviation → ${item.threshold}° threshold</span></div>
      </div>`;
  }).join("");
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function openModal(){
  $("sessionModal").classList.remove("hidden");
}
function closeModal(){
  $("sessionModal").classList.add("hidden");
}

$("connectBtn").addEventListener("click", connectPostura);

let thresholdWriteTimer = null;

$("thresholdSlider").addEventListener("input", e => {
  threshold = Number(e.target.value);
  localStorage.setItem("posturaThreshold", String(threshold));
  updateThresholdUI();

  if(currentAngle !== null && currentDeviation !== null){
    updateLiveData(currentAngle, currentDeviation);
  }

  clearTimeout(thresholdWriteTimer);
  thresholdWriteTimer = setTimeout(async () => {
    if(!bleCharacteristic) return;
    try{
      const command = `THRESHOLD:${threshold}`;
      await bleCharacteristic.writeValue(new TextEncoder().encode(command));
      showToast(`Live threshold set to ${threshold}°`);
    }catch(err){
      console.error(err);
      showToast("Could not update the device threshold.");
    }
  }, 180);
});

$("goodPostureSlider").addEventListener("input", e => {
  goodPostureAngle = Number(e.target.value);
  updateThresholdUI();

  if(currentAngle !== null && currentDeviation !== null){
    updateLiveData(currentAngle, currentDeviation);
  }
});

$("newSessionBtn").addEventListener("click", openModal);
$("emptyNewSessionBtn").addEventListener("click", openModal);
$("closeModalBtn").addEventListener("click", closeModal);
$("sessionModal").querySelector(".modal-backdrop").addEventListener("click", closeModal);

$("modalCreateBtn").addEventListener("click", () => {
  createSession($("modalActivity").value, $("modalDuration").value);
  closeModal();
});

$("createSessionBtn").addEventListener("click", () => {
  createSession($("activitySelect").value, $("durationSelect").value);
});

$("checkReadinessBtn").addEventListener("click", () => {
  runReadinessCheck(false);
});

$("recheckBtn").addEventListener("click", async () => {
  await runReadinessCheck(true);
  if(session && readinessState === "resolved"){
    session.readinessStatus = "conflict_resolved";
    session.recheckAngle = currentAngle;
  }
});

$("proceedBtn").addEventListener("click", () => {
  if(!session) return;
  session.readinessStatus = "proceeded_with_conflict";
  startSession(true);
});

$("startSessionBtn").addEventListener("click", () => {
  startSession(false);
});

$("cancelSessionBtn").addEventListener("click", () => {
  session = null;
  $("readinessCard").classList.add("hidden");
  $("readinessEmpty").classList.remove("hidden");
});

$("endSessionBtn").addEventListener("click", endSession);

$("scrollMonitorBtn").addEventListener("click", () => {
  $("monitor").scrollIntoView({behavior:"smooth"});
});

updateThresholdUI();
renderHistory();
setConnection(false, "Not connected");
