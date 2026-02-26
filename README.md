# Würfel-Erkennung (Dance Point)

Automatische Erkennung und Zählung von lila Würfeln mit weißen Pips mittels OpenCV.js.

## Installation

```bash
npm install
```

## Server starten

### Option 1: Einfacher Node.js Server (Empfohlen)

```bash
npm run serve
```

Der Server läuft auf `http://localhost:3000`

### Option 2: Webpack Dev Server

```bash
npm start
```

### Production Build erstellen

```bash
npm run build
```

## Verwendung

1. Server starten mit `npm run serve`
2. Browser öffnen: `http://localhost:3000`
3. Im **Entwicklungsmodus** wird automatisch `img/dices_test.jpg` geladen
4. Button klicken: **"🟣 Lila Würfel mit weißen Dots finden"**

### Buttons

- **🟣 Lila Würfel mit weißen Dots finden**: Startet die Würfelerkennung
- **🖼️ Debug: Lila-Maske**: Zeigt die HSV-Maske (weiß = lila erkannt)
- **🔄 Reset**: Löscht Canvas und Ergebnisse

### Ergebnisse

- **Linke Seitenleiste**: Ausgeschnittene Würfel mit markierten Pips
  - Links: Original-Würfel mit rotem Crop-Rahmen (90% zentral)
  - Rechts: Binär-Bild (Schwarz-Weiß Debug-Ansicht)
  - Grüne Kreise: Erkannte Pips

- **Rechts**: Originalbild mit Markierungen
  - Gelb: Grünes Brett-Bereich
  - Lime/Orange: Erkannte Würfel mit Pip-Anzahl

## Entwicklungsmodus

In `js/app.js` Zeile 2:
```javascript
const DEVELOPMENT_MODE = true; // true = Testbild, false = Webcam
```

## Algorithmus

1. **Grünes Brett finden** (HSV: H=70-110)
2. **Lila-Maske erstellen** (HSV: H=110-170, S=20-255, V=20-255)
3. **Morphologie**: Erosion + Dilation zur Würfel-Trennung
4. **Würfel filtern**: Größe, Aspect Ratio, Position im Brett
5. **Einzelbild-Analyse**:
   - Würfel ausschneiden
   - Zentral-Crop (90%) = nur Oberseite
   - Threshold (120) für weiße Pips
   - Pip-Zählung mit Größen- und Zirkularitätsfilter

## Technologien

- OpenCV.js (Computer Vision)
- Vanilla JavaScript
- Node.js (Server)
- Webpack (Build)
