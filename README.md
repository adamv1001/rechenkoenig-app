# Rechenkönig

Offlinefähige Rechenübungen für die zweite Klasse: Zahlenraum 20 (Start), 50 oder 100, Plus, Minus oder Gemischt.

Gemischt stellt häufiger Minus als Plus. Viele Aufgaben gehen über den Zehner. Die Antwort wird nur über die Tipptasten eingegeben. Hinweise zeigen kleine Rechenschritte. Es gibt Üben ohne Zeit und ein Zeitrennen von 60 Sekunden. Töne gibt es nicht.

Die Auswahl wird lokal gespeichert, wenn der Browser Speicher erlaubt. Eine laufende Runde wird nicht gespeichert.

## Dateien

`index.html`, `app.js`, `sw.js`, `manifest.webmanifest` und die PNG-Icons liegen im Repository-Wurzelverzeichnis. Verweise auf Dateien sind relativ. `start_url` und `scope` im Manifest sind `/rechenkoenig-app/`.

Der Service Worker speichert nur diese App und löscht beim Aktualisieren ausschließlich Caches mit dem Präfix `rechenkoenig-app-`.

## Lokal prüfen

```bash
node --test tests/logic.test.mjs
```

`tests/browser.test.mjs` prüft in Chrome Layout, Tipptasten, Punkte, Zeit und den Offline-Start. Ein Test auf echten Apple-Geräten ist nicht Teil dieses Repositorys.

## Seiten

Die Adresse dieser Projektseite ist `https://adamv1001.github.io/rechenkoenig-app/`. Der Workflow `.github/workflows/pages.yml` veröffentlicht den Stand von `main`. Der erste Aufruf braucht Netz, bis unten „Bereit für offline auf diesem Gerät“ steht. Danach laden Startseite und `index.html` aus dem Speicher dieser App.
