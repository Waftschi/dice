// ===== ENTWICKLUNGSMODUS FLAG =====
const DEVELOPMENT_MODE = true; // Auf false setzen für Webcam-Modus

const testImage = document.getElementById("testImage");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const loadTestImageBtn = document.getElementById("loadTestImage");
const toggleCameraBtn = document.getElementById("toggleCamera");
const saveSnapshotBtn = document.getElementById("saveSnapshot");
const detectDiceBtn = document.getElementById("detectDiceBtn");
const showDebugBtn = document.getElementById("showDebug");
const resetBtn = document.getElementById("reset");
const autoToggleBtn = document.getElementById("autoToggle");
const countEl = document.getElementById("count");
const diceCountEl = document.getElementById("diceCount");
const autoStatusEl = document.getElementById("autoStatus");
const cupStatusEl = document.getElementById("cupStatus");
const diceContainer = document.getElementById("diceContainer");

let stream;
let cvReady = false;
let autoMode = false;
let analyzeInterval = null;
let lastPips = null;
let cooldownUntil = 0;
let useTestImage = DEVELOPMENT_MODE;
let currentSource = null;

// Beim Start: Entwicklungsmodus oder Webcam
if (DEVELOPMENT_MODE) {
  // Testbild verwenden
  testImage.onload = () => {
    // Canvas an Bildgröße anpassen (aber maximal 600px)
    const maxSize = 600;
    let width = testImage.naturalWidth;
    let height = testImage.naturalHeight;

    // Skaliere runter wenn zu groß
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;

    currentSource = testImage;
    console.log(`✅ Testbild geladen: img/dices_test.jpg (${testImage.naturalWidth}x${testImage.naturalHeight} → ${width}x${height})`);
  };

  testImage.onerror = () => {
    console.error("❌ img/dices_test.jpg nicht gefunden!");
    alert("Fehler: img/dices_test.jpg konnte nicht geladen werden!\n\nBitte stellen Sie sicher, dass das Bild im img/ Ordner existiert.");
  };
} else {
  // Webcam verwenden
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;

      // Warte bis Video bereit ist
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        currentSource = video;
        console.log(`✅ Kamera-Modus aktiviert (${video.videoWidth}x${video.videoHeight})`);
      };
    } catch(err) {
      alert("Kamera konnte nicht gestartet werden: " + err.message);
      console.error("Kamera-Fehler:", err);
    }
  }
  startCamera();
}

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
const tempCtx = tempCanvas.getContext("2d");

// Globale Variable für erkannte Würfel-Bilder
let extractedDiceImages = [];

// Alte Funktion (nicht mehr verwendet - wurde durch findPurpleDiceWithWhiteDots ersetzt)
// function detectAndExtractDice() { ... }

// Funktion: Zeigt die extrahierten Würfel in der linken Liste an
function displayExtractedDice() {
  diceContainer.innerHTML = '';

  if (extractedDiceImages.length === 0) {
    diceContainer.innerHTML = '<p style="text-align:center; color:#999; font-size:14px;">Noch keine Würfel erkannt</p>';
    return;
  }

  extractedDiceImages.forEach((dice, index) => {
    const diceItem = document.createElement('div');
    diceItem.className = 'dice-item';
    diceItem.id = `dice-${dice.id}`;

    const img = document.createElement('img');
    img.src = dice.image;
    img.alt = `Würfel #${dice.id}`;

    const info = document.createElement('div');
    info.className = 'info';
    info.textContent = `Würfel #${dice.id} | ${dice.pips} Pips | ${dice.width}×${dice.height}px`;

    // Download Button
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '💾';
    downloadBtn.style.cssText = 'width:100%; margin-top:5px; padding:5px; font-size:12px;';
    downloadBtn.title = 'Würfel-Bild herunterladen';
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = dice.image;
      a.download = `wuerfel_${dice.id}.jpg`;
      a.click();
    };

    diceItem.appendChild(img);
    diceItem.appendChild(info);
    diceItem.appendChild(downloadBtn);

    // Click Handler: Würfel highlighten
    diceItem.onclick = () => {
      document.querySelectorAll('.dice-item').forEach(item => item.classList.remove('selected'));
      diceItem.classList.add('selected');
    };

    diceContainer.appendChild(diceItem);
  });
}

// Hauptfunktion: Pips analysieren mit Bildvergrößerung
function detectPips(drawResult = false) {
  if (!cvReady) return null;
  if (!currentSource) return null;

  const targetCtx = drawResult ? ctx : tempCtx;
  const targetCanvas = drawResult ? canvas : tempCanvas;

  // TempCanvas an aktuelle Canvas-Größe anpassen
  if (!drawResult) {
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
  }

  // Frame/Bild ins Canvas zeichnen
  targetCtx.drawImage(currentSource, 0, 0, targetCanvas.width, targetCanvas.height);

  // ---- OpenCV Verarbeitung ----
  const src = cv.imread(targetCanvas);

  // SCHRITT 1: Gesamtes Bild vergrößern für bessere Pip-Erkennung
  const scaleFactor = 2.0; // 2x Vergrößerung
  const enlarged = new cv.Mat();
  const newSize = new cv.Size(src.cols * scaleFactor, src.rows * scaleFactor);
  cv.resize(src, enlarged, newSize, 0, 0, cv.INTER_CUBIC);

  // SCHRITT 2: Verarbeitung auf vergrößertem Bild
  const gray = new cv.Mat();
  cv.cvtColor(enlarged, gray, cv.COLOR_RGBA2GRAY);

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

  // SCHRITT 3: Analysiere alle Pips im vergrößerten Bild
  let pipsData = { count: 0, positions: [] };

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    // Pips im vergrößerten Bild (Größen mit scaleFactor multipliziert)
    const minArea = 80 * (scaleFactor * scaleFactor);
    const maxArea = 5000 * (scaleFactor * scaleFactor);

    if (area < minArea || area > maxArea) continue;

    const peri = cv.arcLength(cnt, true);
    if (peri <= 0) continue;

    const circularity = (4 * Math.PI * area) / (peri * peri);

    // Muss einigermaßen kreisförmig sein (kann auch Shapes sein)
    if (circularity < 0.35) continue;

    const moments = cv.moments(cnt);
    const cx = moments.m10 / moments.m00;
    const cy = moments.m01 / moments.m00;

    // Zurück auf Original-Koordinaten skalieren
    const origX = Math.round(cx / scaleFactor);
    const origY = Math.round(cy / scaleFactor);

    pipsData.count++;
    pipsData.positions.push({ x: origX, y: origY });

    if (drawResult) {
      const rect = cv.boundingRect(cnt);
      // Zeichne auf Original-Größe zurückskaliert
      targetCtx.strokeStyle = "lime";
      targetCtx.lineWidth = 3;
      targetCtx.strokeRect(
        rect.x / scaleFactor,
        rect.y / scaleFactor,
        rect.width / scaleFactor,
        rect.height / scaleFactor
      );
    }
  }

  // Speicher freigeben
  src.delete();
  enlarged.delete();
  gray.delete();
  blurred.delete();
  bin.delete();
  cleaned.delete();
  contours.delete();
  hierarchy.delete();

  console.log(`Gefunden: ${pipsData.count} Pips`);

  return pipsData;
}

// Debug-Funktion: Zeigt die Lila-Maske
function showDebugView() {
  if (!cvReady) return alert("OpenCV lädt noch...");
  if (!currentSource) return;

  ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);

  const src = cv.imread(canvas);

  // Konvertiere zu HSV
  const hsv = new cv.Mat();
  cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);

  // Lila-Maske (GLEICHE Parameter wie Hauptfunktion!)
  const lowerPurple = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [110, 20, 20, 0]);
  const upperPurple = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [170, 255, 255, 255]);
  const purpleMask = new cv.Mat();
  cv.inRange(hsv, lowerPurple, upperPurple, purpleMask);

  // Zeige Lila-Maske auf Canvas
  cv.imshow(canvas, purpleMask);

  console.log(`🔍 Debug: Lila-Maske angezeigt`);
  console.log(`   HSV-Werte: H=110-170, S=20-255, V=20-255`);
  console.log(`   Weiße Bereiche = lila erkannt`);
  console.log(`   Schwarze Bereiche = nicht lila`);

  // Cleanup
  src.delete();
  hsv.delete();
  lowerPurple.delete();
  upperPurple.delete();
  purpleMask.delete();
}

// === EVENT HANDLERS ===

// Debug-Ansicht Button
showDebugBtn.addEventListener("click", () => {
  showDebugView();
});

// Hilfsfunktion: Finde das grüne Brett
function findGreenBoard(src) {
  const hsv = new cv.Mat();
  cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);

  // Grün/Türkis in HSV: H ~80-100 (Grün-Cyan)
  const lowerGreen = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [70, 40, 40, 0]);
  const upperGreen = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [110, 255, 255, 255]);
  const greenMask = new cv.Mat();
  cv.inRange(hsv, lowerGreen, upperGreen, greenMask);

  // Morphologie um Lücken zu schließen
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15,15));
  const cleaned = new cv.Mat();
  cv.morphologyEx(greenMask, cleaned, cv.MORPH_CLOSE, kernel);

  // Finde größte Kontur (das Brett)
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let largestArea = 0;
  let boardRect = null;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area > largestArea && area > 10000) { // Brett muss groß sein
      largestArea = area;
      boardRect = cv.boundingRect(cnt);
    }
  }

  // Cleanup
  hsv.delete();
  lowerGreen.delete();
  upperGreen.delete();
  greenMask.delete();
  kernel.delete();
  cleaned.delete();
  contours.delete();
  hierarchy.delete();

  if (boardRect) {
    console.log(`🟢 Brett gefunden: ${boardRect.width}x${boardRect.height} bei (${boardRect.x}, ${boardRect.y})`);
  }

  return boardRect;
}

// Funktion: Finde lila Würfel mit weißen Punkten NUR AUF DEM BRETT
function findPurpleDiceWithWhiteDots() {
  if (!cvReady) return null;
  if (!currentSource) return null;

  // Canvas vorbereiten
  ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);

  const src = cv.imread(canvas);

  // 1. Finde das grüne Brett auf Original-Bild
  const boardRect = findGreenBoard(src);

  if (!boardRect) {
    console.log("❌ Kein grünes Brett gefunden!");
    alert("Grünes Brett konnte nicht gefunden werden!");
    src.delete();
    return 0;
  }

  // Zeichne Brett-Bereich zur Visualisierung
  ctx.strokeStyle = "yellow";
  ctx.lineWidth = 4;
  ctx.strokeRect(boardRect.x, boardRect.y, boardRect.width, boardRect.height);

  // Konvertiere zu HSV für bessere Farberkennung
  const hsv = new cv.Mat();
  cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);

  // SEHR BREITER Lila-Bereich zum Testen
  // HSV: H=0-179, S=0-255, V=0-255
  const lowerPurple1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [110, 20, 20, 0]);  // Sehr breit
  const upperPurple1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [170, 255, 255, 255]); // Sehr breit
  const purpleMask = new cv.Mat();
  cv.inRange(hsv, lowerPurple1, upperPurple1, purpleMask);

  // Morphologische Operationen um Rauschen zu entfernen UND Würfel zu trennen
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3,3));
  const cleanedPurple = new cv.Mat();

  // 1. OPEN: Entfernt Rauschen
  cv.morphologyEx(purpleMask, cleanedPurple, cv.MORPH_OPEN, kernel);

  // 2. SANFTE EROSION: Trennt nur die engsten Verbindungen
  const erodeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(4,4));
  const eroded = new cv.Mat();
  cv.erode(cleanedPurple, eroded, erodeKernel, new cv.Point(-1, -1), 1); // Nur 1 Iteration

  // 3. STÄRKERE DILATION: Stellt Würfel wieder her
  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5,5));
  const finalMask = new cv.Mat();
  cv.dilate(eroded, finalMask, dilateKernel, new cv.Point(-1, -1), 2); // 2 Iterationen

  // Cleanup
  cleanedPurple.delete();
  eroded.delete();

  console.log("🟣 Lila-Maske erstellt mit HSV: H=110-170, S=20-255, V=20-255");
  console.log("   + Zweistufige Erosion: 1) Sanft (4x4, 1x) 2) Stark (6x6, 2x) für bessere Trennung");

  // ZWEITE RUNDE: Verarbeite finalMask nochmal mit stärkerer Erosion für hartnäckige Verbindungen
  const strongErodeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(6,6));
  const strongEroded = new cv.Mat();
  cv.erode(finalMask, strongEroded, strongErodeKernel, new cv.Point(-1, -1), 2); // Stärkere 2. Runde

  const strongDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5,5));
  const finalMask2 = new cv.Mat();
  cv.dilate(strongEroded, finalMask2, strongDilateKernel, new cv.Point(-1, -1), 2);

  // Finde Konturen in lila Bereichen (mit 2. Runde)
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(finalMask2, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  console.log(`🔍 Lila Konturen gefunden: ${contours.size()}`);

  let diceFound = 0;
  let totalChecked = 0;
  let kontourNr = 0;
  let totalPips = 0; // Gesamtzahl aller Pips
  const totalContours = contours.size(); // Speichern vor dem Loop
  const detectedDice = []; // Array zum Speichern aller erkannten Würfel

  // Cleanup der 2. Runde
  strongEroded.delete();
  finalMask2.delete();
  strongErodeKernel.delete();
  strongDilateKernel.delete();

  // PHASE 1: Sammle alle potenziellen Würfel-Rechtecke
  const candidateDice = [];

  for (let i = 0; i < totalContours; i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    const rect = cv.boundingRect(cnt);

    totalChecked++;
    kontourNr++;

    console.log(`\n[Kontur ${kontourNr}] Fläche=${Math.round(area)}px, Pos=(${rect.x},${rect.y}), Größe=${rect.width}x${rect.height}`);

    // WICHTIG: Prüfe ob Würfel INNERHALB des Bretts liegt
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    const insideBoard = (
      centerX >= boardRect.x &&
      centerX <= boardRect.x + boardRect.width &&
      centerY >= boardRect.y &&
      centerY <= boardRect.y + boardRect.height
    );

    if (!insideBoard) {
      console.log(`[Kontur ${kontourNr}] → ❌ GEFILTERT: Außerhalb des Bretts!`);
      continue;
    }

    // Größenfilter
    if (area < 20) {
      console.log(`[Kontur ${kontourNr}] → Gefiltert: Zu klein (${Math.round(area)}px < 20px)`);
      continue;
    }

    if (area > 50000) {
      console.log(`[Kontur ${kontourNr}] → Gefiltert: Zu groß (${Math.round(area)}px > 50000px)`);
      continue;
    }

    // Warnung bei verdächtig großen Würfeln
    if (area > 3000) {
      console.log(`[Kontur ${kontourNr}] ⚠️ WARNUNG: Verdächtig groß (${Math.round(area)}px) - könnte mehrere Würfel sein!`);
    }

    // NUR quadratische/würfelartige Formen (Aspect Ratio nahe 1.0)
    const aspectRatio = rect.width / rect.height;
    if (aspectRatio < 0.65 || aspectRatio > 1.5) {
      console.log(`[Kontur ${kontourNr}] → Gefiltert: Aspect Ratio ${aspectRatio.toFixed(2)} nicht quadratisch (muss 0.65-1.5 sein)`);
      continue;
    }

    // Extrahiere Region mit großzügigem Padding (15% auf jeder Seite)
    const padding = 0.15;
    const padX = Math.round(rect.width * padding);
    const padY = Math.round(rect.height * padding);

    const x = Math.max(0, rect.x - padX);
    const y = Math.max(0, rect.y - padY);
    const w = Math.min(src.cols - x, rect.width + 2 * padX);
    const h = Math.min(src.rows - y, rect.height + 2 * padY);

    if (w <= 0 || h <= 0) continue;

    try {
      const roi = src.roi(new cv.Rect(x, y, w, h));
      const roiGray = new cv.Mat();
      cv.cvtColor(roi, roiGray, cv.COLOR_RGB2GRAY);

      // Suche nach weißen Punkten in diesem Bereich
      const whiteMask = new cv.Mat();
      cv.threshold(roiGray, whiteMask, 180, 255, cv.THRESH_BINARY);

      // Zähle weiße Pixel
      const whitePixels = cv.countNonZero(whiteMask);
      const whitePercent = (whitePixels / (w * h)) * 100;

      console.log(`[Kontur ${kontourNr}] → Weiße Pixel: ${whitePercent.toFixed(1)}%`);

      // NUR Würfel mit deutlichen weißen Punkten (2-25%)
      if (whitePercent > 2.0 && whitePercent < 25) {
        diceFound++;

        // Speichere Würfel-Kandidat für Pip-Analyse
        candidateDice.push({
          rect: rect,
          extendedRect: { x: x, y: y, w: w, h: h },
          kontourNumber: kontourNr,
          area: area,
          whitePercent: whitePercent
        });

        console.log(`[Kontur ${kontourNr}] ✅ WÜRFEL-KANDIDAT #${diceFound}: ${Math.round(area)}px, ${whitePercent.toFixed(1)}% weiß`);
      } else {
        console.log(`[Kontur ${kontourNr}] → Gefiltert: Weiße Pixel ${whitePercent.toFixed(1)}% außerhalb 2-25% (keine deutlichen Punkte)`);
      }

      roi.delete();
      roiGray.delete();
      whiteMask.delete();
    } catch(e) {
      console.error('Fehler bei ROI-Verarbeitung:', e);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 PHASE 1 - Würfel-Kandidaten gefunden: ${candidateDice.length}`);
  console.log(`${'='.repeat(60)}\n`);

  // PHASE 2: Analysiere jeden Würfel-Kandidaten einzeln mit ADAPTIVE THRESHOLDING
  diceFound = 0; // Reset für finale Zählung
  extractedDiceImages = []; // Reset der Würfel-Bilder

  for (let candidate of candidateDice) {
    diceFound++;
    const { rect, extendedRect, kontourNumber, area, whitePercent } = candidate;

    console.log(`\n[WÜRFEL #${diceFound}] Analysiere ausgeschnittenes Bild (${extendedRect.w}x${extendedRect.h}px)...`);

    try {
      // Schneide Würfel aus (vollständig für Anzeige)
      const diceROI = src.roi(new cv.Rect(extendedRect.x, extendedRect.y, extendedRect.w, extendedRect.h));

      // ZENTRAL-CROP: Nehme nur innere 90% für Pip-Analyse (nur Oberseite)
      const cropPercent = 0.90; // 90% des Bereichs (vergrößert von 75%)
      const cropMargin = (1 - cropPercent) / 2; // 5% Rand auf jeder Seite

      const cropX = Math.round(extendedRect.w * cropMargin);
      const cropY = Math.round(extendedRect.h * cropMargin);
      const cropW = Math.round(extendedRect.w * cropPercent);
      const cropH = Math.round(extendedRect.h * cropPercent);

      console.log(`   → Zentral-Crop: ${cropW}x${cropH}px (${Math.round(cropPercent*100)}% des Würfels, nur Oberseite)`);

      // Schneide zentralen Bereich aus
      const topFaceROI = diceROI.roi(new cv.Rect(cropX, cropY, cropW, cropH));
      const diceGray = new cv.Mat();
      cv.cvtColor(topFaceROI, diceGray, cv.COLOR_RGBA2GRAY);

      // EINFACHES THRESHOLDING für WEISSE Pips (nicht invertiert!)
      const whiteBinary = new cv.Mat();
      cv.threshold(
        diceGray,
        whiteBinary,
        120, // Threshold: Alles heller als 120 wird als Pip erkannt (gesenkt von 150)
        255,
        cv.THRESH_BINARY // NICHT invertiert - weiße Bereiche bleiben weiß
      );

      console.log(`   → Threshold: 120 (helle Bereiche = weiße Pips)`);

      // DEBUG: Zähle weiße Pixel im binären Bild
      const whitePixelsInBinary = cv.countNonZero(whiteBinary);
      const binaryPercent = (whitePixelsInBinary / (cropW * cropH)) * 100;
      console.log(`   → Binär-Bild: ${binaryPercent.toFixed(1)}% weiße Pixel (${whitePixelsInBinary} von ${cropW * cropH})`);

      // Morphologie zur Rauschunterdrückung
      const morphKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
      const cleanedBinary = new cv.Mat();
      cv.morphologyEx(whiteBinary, cleanedBinary, cv.MORPH_OPEN, morphKernel);

      // Finde Pip-Konturen
      const pipContours = new cv.MatVector();
      const pipHierarchy = new cv.Mat();
      cv.findContours(cleanedBinary, pipContours, pipHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let pipCount = 0;
      const minPipArea = 15; // Gesenkt von 20 auf 15
      const maxPipArea = 2000; // Erhöht von 1200 auf 2000
      const pipPositions = []; // Speichere Pip-Positionen zum Zeichnen

      console.log(`   → Gefundene Konturen im Binär-Bild: ${pipContours.size()}`);

      for (let p = 0; p < pipContours.size(); p++) {
        const pipCnt = pipContours.get(p);
        const pipArea = cv.contourArea(pipCnt);

        if (pipArea < minPipArea) {
          console.log(`      Kontur ${p}: Area=${Math.round(pipArea)} → Zu klein (< ${minPipArea})`);
          continue;
        }

        if (pipArea > maxPipArea) {
          console.log(`      Kontur ${p}: Area=${Math.round(pipArea)} → Zu groß (> ${maxPipArea})`);
          continue;
        }

        const pipPeri = cv.arcLength(pipCnt, true);
        if (pipPeri <= 0) continue;

        const pipCircularity = (4 * Math.PI * pipArea) / (pipPeri * pipPeri);

        if (pipCircularity < 0.25) { // Gesenkt von 0.3 auf 0.25
          console.log(`      Kontur ${p}: Area=${Math.round(pipArea)} Circ=${pipCircularity.toFixed(2)} → Zu eckig (< 0.25)`);
          continue;
        }

        pipCount++;

        // Speichere Pip-Position (relativ zum Crop-Bereich)
        const pipRect = cv.boundingRect(pipCnt);
        pipPositions.push({
          x: pipRect.x + pipRect.width / 2,
          y: pipRect.y + pipRect.height / 2,
          width: pipRect.width,
          height: pipRect.height
        });

        console.log(`      ✓ Pip ${pipCount}: Area=${Math.round(pipArea)} Circ=${pipCircularity.toFixed(2)}`);
      }

      console.log(`   → Resultat: ${pipCount} Pips erkannt`);
      totalPips += pipCount;

      // ERSTELLE MARKIERTES WÜRFEL-BILD für Seitenleiste (Side-by-Side)
      const markedCanvas = document.createElement('canvas');
      markedCanvas.width = extendedRect.w * 2 + 10; // 2x breiter + 10px Abstand
      markedCanvas.height = extendedRect.h;
      const markedCtx = markedCanvas.getContext('2d');

      // Hintergrund weiß
      markedCtx.fillStyle = "white";
      markedCtx.fillRect(0, 0, markedCanvas.width, markedCanvas.height);

      // Linke Hälfte: Original-Würfel
      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = extendedRect.w;
      originalCanvas.height = extendedRect.h;
      cv.imshow(originalCanvas, diceROI);
      markedCtx.drawImage(originalCanvas, 0, 0);

      // Rechte Hälfte: Binär-Bild (Debug) - skaliert auf volle Würfelgröße
      const binaryCanvas = document.createElement('canvas');
      binaryCanvas.width = cropW;
      binaryCanvas.height = cropH;
      cv.imshow(binaryCanvas, cleanedBinary);

      // Zeichne Binär-Bild rechts (skaliert auf Würfelgröße)
      const offsetX = extendedRect.w + 5; // 5px Abstand
      const offsetY = (extendedRect.h - cropH) / 2;
      markedCtx.drawImage(binaryCanvas, offsetX, offsetY, cropW, cropH);

      // Zeichne Crop-Bereich auf linker Seite (rot gestrichelt)
      markedCtx.strokeStyle = "red";
      markedCtx.lineWidth = 2;
      markedCtx.setLineDash([5, 5]);
      markedCtx.strokeRect(cropX, cropY, cropW, cropH);
      markedCtx.setLineDash([]);

      // Markiere alle erkannten Pips (grüne Kreise)
      markedCtx.strokeStyle = "lime";
      markedCtx.fillStyle = "rgba(0, 255, 0, 0.3)";
      markedCtx.lineWidth = 2;

      for (let pip of pipPositions) {
        // Pip-Position ist relativ zum Crop-Bereich, konvertiere zu vollem Würfel-Bild
        const pipX = cropX + pip.x;
        const pipY = cropY + pip.y;
        const radius = Math.max(pip.width, pip.height) / 2 + 2;

        // Zeichne Kreis um Pip
        markedCtx.beginPath();
        markedCtx.arc(pipX, pipY, radius, 0, 2 * Math.PI);
        markedCtx.fill();
        markedCtx.stroke();
      }

      // Pip-Anzahl oben links
      markedCtx.fillStyle = "lime";
      markedCtx.font = "bold 16px Arial";
      markedCtx.strokeStyle = "black";
      markedCtx.lineWidth = 3;
      markedCtx.strokeText(`${pipCount} Pips`, 5, 20);
      markedCtx.fillText(`${pipCount} Pips`, 5, 20);

      const diceImageURL = markedCanvas.toDataURL('image/png');

      // Speichere für Zeichnen
      let color = "lime";
      if (area > 3000) {
        color = "orange";
      }

      detectedDice.push({
        rect: rect,
        extendedRect: extendedRect,
        pipCount: pipCount,
        diceNumber: diceFound,
        kontourNumber: kontourNumber,
        area: area,
        color: color
      });

      // Speichere markiertes Würfel-Bild für die Seitenleiste
      extractedDiceImages.push({
        id: diceFound,
        image: diceImageURL,
        width: extendedRect.w,
        height: extendedRect.h,
        pips: pipCount
      });

      console.log(`[WÜRFEL #${diceFound}] ✅ Fertig: ${pipCount} Pips`);

      // Cleanup
      diceROI.delete();
      topFaceROI.delete();
      diceGray.delete();
      whiteBinary.delete();
      cleanedBinary.delete();
      morphKernel.delete();
      pipContours.delete();
      pipHierarchy.delete();

    } catch(e) {
      console.error(`Fehler bei Würfel #${diceFound} Analyse:`, e);
    }
  }

  // JETZT: Zeichne alles auf dem ORIGINALBILD
  // Zeichne Originalbild nochmal auf Canvas
  ctx.drawImage(currentSource, 0, 0, canvas.width, canvas.height);

  // Zeichne Brett-Rechteck (gelb)
  ctx.strokeStyle = "yellow";
  ctx.lineWidth = 4;
  ctx.strokeRect(boardRect.x, boardRect.y, boardRect.width, boardRect.height);

  // Zeichne alle erkannten Würfel
  for (let dice of detectedDice) {
    // Erweiterten Bereich (gestrichelt cyan)
    ctx.strokeStyle = "cyan";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(dice.extendedRect.x, dice.extendedRect.y, dice.extendedRect.w, dice.extendedRect.h);
    ctx.setLineDash([]);

    // Originalen Würfel-Bereich (lime/orange)
    ctx.strokeStyle = dice.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(dice.rect.x, dice.rect.y, dice.rect.width, dice.rect.height);

    // Label mit Würfel-Nummer und PIP-COUNT
    ctx.fillStyle = dice.color;
    ctx.font = "bold 20px Arial";
    ctx.fillText(`#${dice.diceNumber} [${dice.pipCount}]`, dice.rect.x + 5, dice.rect.y + 25);
    ctx.font = "10px Arial";
    ctx.fillText(`K${dice.kontourNumber} ${Math.round(dice.area)}px`, dice.rect.x + 5, dice.rect.y + dice.rect.height - 5);
  }

  // Cleanup
  src.delete();
  hsv.delete();
  lowerPurple1.delete();
  upperPurple1.delete();
  purpleMask.delete();
  kernel.delete();
  erodeKernel.delete();
  dilateKernel.delete();
  finalMask.delete();
  contours.delete();
  hierarchy.delete();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ZUSAMMENFASSUNG:`);
  console.log(`   Lila Konturen gefunden: ${totalContours}`);
  console.log(`   Davon geprüft: ${totalChecked}`);
  console.log(`   🎲 Würfel erkannt: ${diceFound}`);
  console.log(`   🔢 Gesamt Pips: ${totalPips}`);
  console.log(`${'='.repeat(60)}\n`);

  if (diceFound === 0) {
    console.log(`⚠️ KEINE WÜRFEL ERKANNT!`);
    console.log(`Tipps:`);
    console.log(`1. Klicken Sie auf "🖼️ Debug: Lila-Maske" - sehen Sie weiße Bereiche?`);
    console.log(`2. Wenn Debug schwarz ist: HSV-Werte anpassen`);
    console.log(`3. Console zeigt Details zu jeder Kontur`);
  }

  diceCountEl.textContent = diceFound;
  countEl.textContent = totalPips;

  // Zeige extrahierte Würfel in der Seitenleiste
  displayExtractedDice();

  return diceFound;
}

// Würfel erkennen und ausschneiden Button
detectDiceBtn.addEventListener("click", () => {
  if (!cvReady) return alert("OpenCV lädt noch...");

  // Suche lila Würfel mit weißen Dots
  findPurpleDiceWithWhiteDots();
});

// Reset Button
resetBtn.addEventListener("click", () => {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  countEl.textContent = "-";
  diceCountEl.textContent = "-";
  extractedDiceImages = [];
  diceContainer.innerHTML = '<p style="text-align:center; color:#999; font-size:14px;">Noch keine Würfel erkannt</p>';
  lastPips = null;
  cooldownUntil = 0;
  console.log("Canvas und Würfel-Liste zurückgesetzt");
});

// ===== WEBCAM-MODUS EVENT HANDLERS (nur aktiv wenn DEVELOPMENT_MODE = false) =====

if (!DEVELOPMENT_MODE) {
  // Testbild laden Button
  loadTestImageBtn.addEventListener("click", () => {
    testImage.onload = () => {
      // Canvas an Bildgröße anpassen
      const maxSize = 600;
      let width = testImage.naturalWidth;
      let height = testImage.naturalHeight;

      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      currentSource = testImage;
      useTestImage = true;
      console.log(`✅ Testbild-Modus aktiviert: img/dices_test.jpg (${testImage.naturalWidth}x${testImage.naturalHeight} → ${width}x${height})`);
    };
    testImage.onerror = () => {
      console.error("❌ img/dices_test.jpg nicht gefunden!");
      alert("img/dices_test.jpg nicht gefunden!\n\nBitte stellen Sie sicher, dass das Bild im img/ Ordner existiert.");
    };
    testImage.src = "img/dices_test.jpg?" + Date.now();
  });

  // Zur Kamera wechseln Button
  toggleCameraBtn.addEventListener("click", () => {
    if (useTestImage) {
      async function startCam() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
          video.srcObject = stream;

          video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            currentSource = video;
            useTestImage = false;
            console.log(`✅ Kamera-Modus aktiviert (${video.videoWidth}x${video.videoHeight})`);
          };
        } catch(err) {
          alert("Kamera konnte nicht gestartet werden: " + err.message);
        }
      }
      startCam();
    } else {
      loadTestImageBtn.click();
    }
  });

  // Screenshot speichern Button
  saveSnapshotBtn.addEventListener("click", () => {
    if (!currentSource) {
      alert("Keine Bildquelle verfügbar!");
      return;
    }

    const saveCanvas = document.createElement("canvas");
    // Verwende Originalauflösung der Quelle
    if (useTestImage) {
      saveCanvas.width = testImage.naturalWidth;
      saveCanvas.height = testImage.naturalHeight;
    } else {
      saveCanvas.width = video.videoWidth;
      saveCanvas.height = video.videoHeight;
    }
    const saveCtx = saveCanvas.getContext("2d");
    saveCtx.drawImage(currentSource, 0, 0, saveCanvas.width, saveCanvas.height);

    saveCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dices_test.jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert("Bild wurde heruntergeladen!\n\nBitte speichern Sie es als 'dices_test.jpg' im img/ Ordner des Projekts.");
    }, "image/jpeg", 0.95);
  });

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

  // Auto-Analyse Funktionen
  function hasChanged(newPips) {
    if (!lastPips) return true;
    if (lastPips.count !== newPips.count) return true;
    if (newPips.count === 0) return false;

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

    const matchPercentage = matchCount / newPips.count;
    return matchPercentage < 0.7;
  }

  function startAutoDetection() {
    if (analyzeInterval) return;

    analyzeInterval = setInterval(() => {
      const now = Date.now();
      if (now < cooldownUntil) return;

      const pipsData = detectPips(false);

      if (pipsData && pipsData.count > 0) {
        cupStatusEl.style.display = "inline-block";
        cupStatusEl.className = "status detected";
        cupStatusEl.textContent = `🎲 ${pipsData.count} Pips erkannt`;

        if (hasChanged(pipsData)) {
          console.log("Änderung erkannt! Neue Pips:", pipsData.count);
          const finalResult = detectPips(true);
          countEl.textContent = finalResult.count;
          lastPips = JSON.parse(JSON.stringify(finalResult));
          cooldownUntil = Date.now() + 2000;
          cupStatusEl.textContent = "✅ Snapshot!";
          setTimeout(() => {
            if (autoMode && lastPips) cupStatusEl.textContent = `🎲 ${lastPips.count} Pips erkannt`;
          }, 1000);
        }
      } else {
        if (lastPips !== null && now > cooldownUntil) {
          cupStatusEl.style.display = "none";
          lastPips = null;
          console.log("Keine Pips mehr, reset lastPips");
        }
      }
    }, 200);
  }

  function stopAutoDetection() {
    if (analyzeInterval) {
      clearInterval(analyzeInterval);
      analyzeInterval = null;
    }
    cupStatusEl.style.display = "none";
  }
}
