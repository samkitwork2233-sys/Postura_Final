/* POSTURA — FAR AWAY ROUND 2
   Web Bluetooth client for the existing packed POSTURA_V3 firmware.

   Firmware is NOT modified. The device continues to send:
   currentAngle,deviation

   Two independent app controls:
   1) Live Monitoring Threshold: 1°–45° -> sent to firmware as THRESHOLD:<value>
   2) Good Posture Range: 50°–100° -> app-only readiness reference
*/

const CONFIG = {
  SERVICE_UUID: "12345678-1234-1234-1234-1234567890ab",
  CHARACTERISTIC_UUID: "abcd1234-5678-1234-5678-abcdef123456",
  READINESS_SAMPLE_MS: 1200
};

let bleDevice = null;
let bleCharacteristic = null;
let currentAngle = null;
let currentDeviation = null;
let threshold = Number(localStorage.getItem("posturaThreshold") || 15);
let goodMin = Number(localStorage.getItem("posturaGoodMin") || 50);
let goodMax = Number(localStorage.getItem("posturaGoodMax") || 70);
let session = null;
let sessionTimer = null;
let sessionStart = null;
let lastBadAt = null;
let slouchSeconds = 0;
let slouchCount = 0;
let score = 100;
let readinessState = "idle";
let toastTimer = null;
let thresholdWriteTimer = null;

const $ = id => document.getElementById(id);

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function showToast(message){
  const el = $("toast");
  if(!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function setConnection(online, text){
  if($("connectionDot")) $("connectionDot").className = "dot " + (online ? "online" : "offline");
  if($("deviceDot")) $("deviceDot").className = "dot " + (online ? "online" : "offline");
  if($("connectionText")) $("connectionText").textContent = text;
  if($("deviceStatus")) $("deviceStatus").textContent = online ? "Postura connected" : "Device offline";
}

function updateSettingsUI(){
  threshold = clamp(threshold, 1, 45);
  goodMin = clamp(goodMin, 50, 100);
  goodMax = clamp(goodMax, 50, 100);
  if(goodMin > goodMax) goodMax = goodMin;

  if($("liveThresholdSlider")) $("liveThresholdSlider").value = threshold;
  if($("liveThresholdValue")) $("liveThresholdValue").textContent = `${threshold}°`;
  if($("thresholdLabel")) $("thresholdLabel").textContent = `Live Threshold ${threshold}°`;

  if($("goodMinSlider")) $("goodMinSlider").value = goodMin;
  if($("goodMaxSlider")) $("goodMaxSlider").value = goodMax;
  if($("goodMinValue")) $("goodMinValue").textContent = `${goodMin}°`;
  if($("goodMaxValue")) $("goodMaxValue").textContent = `${goodMax}°`;
  if($("goodRangeValue")) $("goodRangeValue").textContent = `${goodMin}°–${goodMax}°`;
  if($("goodPostureRange")) $("goodPostureRange").textContent = `${goodMin}°–${goodMax}°`;

  if($("activeThreshold")) $("activeThreshold").textContent = `${threshold}°`;
}

function saveSettings(){
  localStorage.setItem("posturaThreshold", String(threshold));
  localStorage.setItem("posturaGoodMin", String(goodMin));
  localStorage.setItem("posturaGoodMax", String(goodMax));
}

function parsePosturaPayload(raw){
  if(typeof raw !== "string") raw = new TextDecoder().decode(raw);
  raw = raw.trim();
  const parts = raw.split(",");
  if(parts.length < 2) return null;
  const current = Number(parts[0]);
  const deviation = Number(parts[1]);
  if(!Number.isFinite(current) || !Number.isFinite(deviation)) return null;
  return { currentAngle: current, deviation: Math.abs(deviation) };
}

function isInGoodRange(angle){
  return angle >= goodMin && angle <= goodMax;
}

function updateReadinessLive(){
  if(currentAngle === null) return;
  const ready = isInGoodRange(currentAngle);
  if($("readinessLiveStatus")){
    $("readinessLiveStatus").textContent = ready ? "Within range" : "Outside range";
    $("readinessLiveStatus").className = ready ? "mini-status good" : "mini-status bad";
  }
}

function updateLiveData(angle, deviation){
  currentAngle = Number(angle);
  currentDeviation = Number(deviation);

  if($("angleValue")) $("angleValue").textContent = `${currentAngle.toFixed(1)}°`;
  if($("heroAngle")) $("heroAngle").textContent = `${currentAngle.toFixed(1)}°`;
  if($("readinessAngle")) $("readinessAngle").textContent = `${currentAngle.toFixed(1)}°`;
  if($("currentAngleCard")) $("currentAngleCard").textContent = `${currentAngle.toFixed(1)}°`;
  if($("currentDeviation")) $("currentDeviation").textContent = `${currentDeviation.toFixed(1)}°`;

  const liveGood = currentDeviation <= threshold;
  if($("postureStatus")){
    $("postureStatus").textContent = liveGood ? "Good posture" : "Poor posture";
    $("postureStatus").className = "status-large " + (liveGood ? "good" : "bad");
  }
  if($("postureMessage")){
    $("postureMessage").textContent = liveGood
      ? `Deviation ${currentDeviation.toFixed(1)}° is within the ${threshold}° threshold.`
      : `Deviation ${currentDeviation.toFixed(1)}° exceeds the ${threshold}° threshold.`;
  }
  if($("heroPosture")) $("heroPosture").textContent = liveGood ? "Good posture" : "Posture needs correction";
  if($("angleBar")) $("angleBar").style.width = `${clamp((currentDeviation / 45) * 100, 0, 100)}%`;

  updateReadinessLive();

  if(session){
    $("activeAngle").textContent = `${currentAngle.toFixed(1)}°`;
    $("activePosture").textContent = liveGood ? "Good posture" : "Poor posture";
    $("activePosture").className = "status-large " + (liveGood ? "good" : "bad");
    $("activeMessage").textContent = liveGood ? "Posture is within the live threshold." : "Posture deviation is above the live threshold.";
    updateSessionTracking(liveGood);
  }
}

function updateSessionTracking(liveGood){
  if(!session || !sessionStart) return;
  if(!liveGood){
    if(lastBadAt === null){
      lastBadAt = Date.now();
      slouchCount += 1;
    }
  }else if(lastBadAt !== null){
    slouchSeconds += Math.round((Date.now() - lastBadAt) / 1000);
    lastBadAt = null;
  }
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const activeBad = lastBadAt !== null ? Math.floor((Date.now() - lastBadAt) / 1000) : 0;
  const totalBad = slouchSeconds + activeBad;
  score = clamp(100 - Math.round((totalBad / Math.max(elapsed, 1)) * 100), 0, 100);
  updateSessionStats(totalBad);
}

function updateSessionStats(totalBad = slouchSeconds){
  if($("slouchCount")) $("slouchCount").textContent = slouchCount;
  if($("activeSlouchCount")) $("activeSlouchCount").textContent = slouchCount;
  if($("slouchTime")) $("slouchTime").textContent = formatDuration(totalBad);
  if($("activeSlouchTime")) $("activeSlouchTime").textContent = formatDuration(totalBad);
  if($("scoreValue")) $("scoreValue").textContent = score;
  if($("activeScore")) $("activeScore").textContent = score;
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
    bleDevice = await navigator.bluetooth.requestDevice({filters:[{services:[CONFIG.SERVICE_UUID]}]});
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
  if(data) updateLiveData(data.currentAngle, data.deviation);
}

function stableAngleRead(){
  return new Promise(resolve => {
    const samples = [];
    const started = Date.now();
    const collect = () => {
      if(currentAngle !== null) samples.push(currentAngle);
      if(Date.now() - started >= CONFIG.READINESS_SAMPLE_MS){
        if(!samples.length){ resolve(null); return; }
        samples.sort((a,b)=>a-b);
        const mid = Math.floor(samples.length / 2);
        resolve(samples.length % 2 ? samples[mid] : (samples[mid-1] + samples[mid]) / 2);
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
  updateReadinessLive();
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
  const ready = isInGoodRange(angle);

  $("readinessAngle").textContent = `${angle.toFixed(1)}°`;
  $("goodPostureRange").textContent = `${goodMin}°–${goodMax}°`;

  if(!ready){
    readinessState = "conflict";
    $("readinessBadge").textContent = "Conflict detected";
    $("readinessBadge").className = "badge bad";
    $("readinessStatusText").textContent = angle < goodMin
      ? "Current angle is below the good posture range"
      : "Current angle is above the good posture range";
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
    if(isRecheck) $("resolutionPanel").classList.remove("hidden"); else $("resolutionPanel").classList.add("hidden");
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
    threshold,
    goodMin,
    goodMax
  };
  $("plannedActivity").textContent = activity;
  $("plannedDuration").textContent = `${duration} minutes`;
  showReadinessCard();
  resetReadinessUI();
  $("readiness").scrollIntoView({behavior:"smooth"});
}

function startSession(proceededAnyway=false){
  if(!session) return;
  session.readinessStatus = proceededAnyway ? "proceeded_with_conflict" : "passed";
  session.initialAngle = currentAngle;
  session.threshold = threshold;
  session.goodMin = goodMin;
  session.goodMax = goodMax;
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
  updateSettingsUI();
  updateSessionStats();
  $("activeSession").scrollIntoView({behavior:"smooth"});

  clearInterval(sessionTimer);
  sessionTimer = setInterval(updateSessionClock, 1000);
  updateSessionClock();
  showToast("Session started.");
}

function updateSessionClock(){
  if(!sessionStart) return;
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  $("sessionClock").textContent = formatDuration(elapsed);
  if(currentDeviation !== null) updateSessionTracking(currentDeviation <= threshold);
}

function endSession(){
  if(!session) return;
  if(lastBadAt !== null){
    slouchSeconds += Math.round((Date.now() - lastBadAt) / 1000);
    lastBadAt = null;
  }
  const durationSeconds = Math.floor((Date.now() - sessionStart) / 1000);
  const record = {
    id: Date.now(),
    activity: session.activity,
    plannedMinutes: session.plannedMinutes,
    durationSeconds,
    slouchCount,
    slouchSeconds,
    score,
    readinessStatus: session.readinessStatus,
    initialAngle: session.initialAngle,
    recheckAngle: session.recheckAngle,
    threshold: session.threshold,
    goodMin: session.goodMin,
    goodMax: session.goodMax,
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
    const range = item.goodMin != null ? `${item.goodMin}°–${item.goodMax}° range` : "Range not recorded";
    return `<div class="history-item">
      <div><strong>${escapeHtml(item.activity)}</strong><br><span>${formatDuration(item.durationSeconds)}</span></div>
      <div><span>Posture score</span><br><strong>${item.score}/100</strong></div>
      <div><span>Slouches</span><br><strong>${item.slouchCount}</strong></div>
      <div><span class="history-badge ${statusGood ? "good" : "warn"}">${readinessText}</span><br><span>Readiness ${range} · Live threshold ${item.threshold}°</span></div>
    </div>`;
  }).join("");
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
}

function openModal(){ $("sessionModal").classList.remove("hidden"); }
function closeModal(){ $("sessionModal").classList.add("hidden"); }

// Live threshold slider — independent from readiness range.
$("liveThresholdSlider").addEventListener("input", e => {
  threshold = Number(e.target.value);
  saveSettings();
  updateSettingsUI();
  if(currentAngle !== null && currentDeviation !== null) updateLiveData(currentAngle, currentDeviation);
  clearTimeout(thresholdWriteTimer);
  thresholdWriteTimer = setTimeout(async () => {
    if(!bleCharacteristic) return;
    try{
      await bleCharacteristic.writeValue(new TextEncoder().encode(`THRESHOLD:${threshold}`));
      showToast(`Live threshold set to ${threshold}°`);
    }catch(err){
      console.error(err);
      showToast("Could not update the device threshold.");
    }
  }, 180);
});

// Good posture range — app-only readiness settings.
$("goodMinSlider").addEventListener("input", e => {
  goodMin = Number(e.target.value);
  if(goodMin > goodMax) goodMax = goodMin;
  saveSettings();
  updateSettingsUI();
  updateReadinessLive();
});

$("goodMaxSlider").addEventListener("input", e => {
  goodMax = Number(e.target.value);
  if(goodMax < goodMin) goodMin = goodMax;
  saveSettings();
  updateSettingsUI();
  updateReadinessLive();
});

$("connectBtn").addEventListener("click", connectPostura);
$("newSessionBtn").addEventListener("click", openModal);
$("emptyNewSessionBtn").addEventListener("click", openModal);
$("closeModalBtn").addEventListener("click", closeModal);
$("sessionModal").querySelector(".modal-backdrop").addEventListener("click", closeModal);
$("modalCreateBtn").addEventListener("click", () => { createSession($("modalActivity").value, $("modalDuration").value); closeModal(); });
$("createSessionBtn").addEventListener("click", () => createSession($("activitySelect").value, $("durationSelect").value));
$("checkReadinessBtn").addEventListener("click", () => runReadinessCheck(false));
$("recheckBtn").addEventListener("click", async () => {
  await runReadinessCheck(true);
  if(session && readinessState === "resolved"){
    session.readinessStatus = "conflict_resolved";
    session.recheckAngle = currentAngle;
  }
});
$("proceedBtn").addEventListener("click", () => { if(session){ session.readinessStatus = "proceeded_with_conflict"; startSession(true); } });
$("startSessionBtn").addEventListener("click", () => startSession(false));
$("cancelSessionBtn").addEventListener("click", () => { session = null; $("readinessCard").classList.add("hidden"); $("readinessEmpty").classList.remove("hidden"); });
$("endSessionBtn").addEventListener("click", endSession);
$("scrollMonitorBtn").addEventListener("click", () => $("monitor").scrollIntoView({behavior:"smooth"}));

updateSettingsUI();
renderHistory();
setConnection(false, "Not connected");
