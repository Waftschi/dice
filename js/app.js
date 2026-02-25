const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const autoToggleBtn = document.getElementById("autoToggle");
const snapBtn = document.getElementById("snap");
const resetBtn = document.getElementById("reset");
const countEl = document.getElementById("count");
const autoStatusEl = document.getElementById("autoStatus");
const cupStatusEl = document.getElementById("cupStatus");

let stream;
let cvReady = false;
let autoMode = false;
let analyzeInterval = null;
let lastPips = null; // Speichert {count: X, positions: [{x, y}, ...]}
let cooldownUntil = 0; // Timestamp für Cooldown

// Kamera starten
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
}
startCamera();

// Warten bis OpenCV bereit ist
function waitForCV() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof cv !== "undefined" && cv.Mat) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}
waitForCV().then(() => cvReady = true);

// Temporäres Canvas für Analyse (ohne Zeichnung)
const tempCanvas = document.createElement("canvas");
tempCanvas.width = canvas.width;
tempCanvas.height = canvas.height;
const tempCtx = tempCanvas.getContext("2d");

// Hauptfunktion: Pips analysieren
function detectPips(drawResult = false) {
  if (!cvReady) return null;

  const targetCtx = drawResult ? ctx : tempCtx;
  const targetCanvas = drawResult ? canvas : tempCanvas;

  // Frame ins Canvas zeichnen
  targetCtx.drawImage(video, 0, 0, targetCanvas.width, targetCanvas.height);

  // ---- OpenCV Verarbeitung ----
  const src = cv.imread(targetCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(7,7), 0);

  const bin = new cv.Mat();
  cv.threshold(blurred, bin, 0, 255,
          cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const kernel = cv.getStructuringElement(
          cv.MORPH_ELLIPSE,
          new cv.Size(5,5)
  );
  const cleaned = new cv.Mat();
  cv.morphologyEx(bin, cleaned, cv.MORPH_OPEN, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
          cleaned,
          contours,
          hierarchy,
          cv.RETR_EXTERNAL,
          cv.CHAIN_APPROX_SIMPLE
  );

  // Analysiere alle Pips im gesamten Bild
  let pipsData = { count: 0, positions: [] };

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    // Pips: kleine bis mittlere Objekte
    if (area < 80 || area > 5000) continue;

    const peri = cv.arcLength(cnt, true);
    if (peri <= 0) continue;

    const circularity = (4 * Math.PI * area) / (peri * peri);

    // Muss einigermaßen kreisförmig sein (kann auch Shapes sein)
    if (circularity < 0.4) continue;

    const moments = cv.moments(cnt);
    const cx = moments.m10 / moments.m00;
    const cy = moments.m01 / moments.m00;

    pipsData.count++;
    pipsData.positions.push({ x: Math.round(cx), y: Math.round(cy) });

    if (drawResult) {
      const rect = cv.boundingRect(cnt);
      targetCtx.strokeStyle = "lime";
      targetCtx.lineWidth = 3;
      targetCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Speicher freigeben
  src.delete();
  gray.delete();
  blurred.delete();
  bin.delete();
  cleaned.delete();
  contours.delete();
  hierarchy.delete();

  return pipsData;
}

// Vergleicht aktuelle mit letzten Pips (Position + Count)
function hasChanged(newPips) {
  if (!lastPips) return true;

  // Wenn Count unterschiedlich ist, definitiv geändert
  if (lastPips.count !== newPips.count) return true;

  // Wenn keine Pips, nichts zu vergleichen
  if (newPips.count === 0) return false;

  // Vergleiche Positionen (mit Toleranz von 30 Pixeln)
  let matchCount = 0;
  for (let newPos of newPips.positions) {
    for (let oldPos of lastPips.positions) {
      const dist = Math.sqrt(Math.pow(newPos.x - oldPos.x, 2) + Math.pow(newPos.y - oldPos.y, 2));
      if (dist < 30) {
        matchCount++;
        break;
      }
    }
  }

  // Wenn weniger als 70% der Positionen übereinstimmen, hat sich etwas geändert
  const matchPercentage = matchCount / newPips.count;
  return matchPercentage < 0.7;
}

// Auto-Analyse Loop
function startAutoDetection() {
  if (analyzeInterval) return;

  analyzeInterval = setInterval(() => {
    // Prüfe Cooldown
    const now = Date.now();
    if (now < cooldownUntil) {
      return; // Noch in Cooldown
    }

    const pipsData = detectPips(false);

    if (pipsData && pipsData.count > 0) {
      cupStatusEl.style.display = "inline-block";
      cupStatusEl.className = "status detected";
      cupStatusEl.textContent = `🎲 ${pipsData.count} Pips erkannt`;

      // Prüfe ob sich etwas geändert hat
      if (hasChanged(pipsData)) {
        console.log("Änderung erkannt! Neue Pips:", pipsData.count);

        // Auto-Snapshot mit Zeichnung
        const finalResult = detectPips(true);
        countEl.textContent = finalResult.count;

        // Update lastPips und setze Cooldown
        lastPips = JSON.parse(JSON.stringify(finalResult)); // Deep copy
        cooldownUntil = Date.now() + 2000; // 2 Sekunden Cooldown

        // Visuelles Feedback
        cupStatusEl.textContent = "✅ Snapshot!";
        setTimeout(() => {
          if (autoMode && lastPips) cupStatusEl.textContent = `🎲 ${lastPips.count} Pips erkannt`;
        }, 1000);
      }
    } else {
      // Keine Pips mehr im Bild
      if (lastPips !== null && now > cooldownUntil) {
        cupStatusEl.style.display = "none";
        lastPips = null;
        console.log("Keine Pips mehr, reset lastPips");
      }
    }
  }, 200); // Alle 200ms analysieren
}

function stopAutoDetection() {
  if (analyzeInterval) {
    clearInterval(analyzeInterval);
    analyzeInterval = null;
  }
  cupStatusEl.style.display = "none";
}

// Auto-Toggle Button
autoToggleBtn.addEventListener("click", () => {
  if (!cvReady) return alert("OpenCV lädt noch...");

  autoMode = !autoMode;

  if (autoMode) {
    autoToggleBtn.textContent = "Auto-Erkennung AUS";
    autoStatusEl.className = "status active";
    autoStatusEl.textContent = "Auto-Modus: AN";
    startAutoDetection();
  } else {
    autoToggleBtn.textContent = "Auto-Erkennung AN";
    autoStatusEl.className = "status inactive";
    autoStatusEl.textContent = "Auto-Modus: AUS";
    stopAutoDetection();
  }
});

// Manueller Snapshot
snapBtn.addEventListener("click", () => {
  if (!cvReady) return alert("OpenCV lädt noch...");

  const pipsData = detectPips(true);
  if (pipsData) {
    countEl.textContent = pipsData.count;
    lastPips = pipsData;
  }
});

// Reset
resetBtn.addEventListener("click", () => {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  countEl.textContent = "-";
  lastPips = null;
  cooldownUntil = 0;
  console.log("Reset: lastPips und Cooldown zurückgesetzt");
});
