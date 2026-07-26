#!/usr/bin/env bash
# Monta un escritorio virtual ligero + noVNC dentro de Google Cloud Shell
# para poder ver y controlar un Chromium con interfaz gráfica desde el
# navegador (incluido el del móvil), sin necesitar un PC.
#
# Uso (dentro de Cloud Shell):
#   bash scripts/cloud-shell-gui-login.sh
#
# Después, en la MISMA terminal, sigue con:
#   export DISPLAY=:99
#   npm run gemini:login
#
# Y abre la vista previa web de Cloud Shell en el puerto 8080 (botón
# "Vista previa en la Web" / "Web Preview") para ver el escritorio.
set -euo pipefail

echo "Instalando escritorio virtual + noVNC (puede tardar 1-2 min)…"
sudo apt-get update -qq
sudo apt-get install -y -qq xvfb x11vnc fluxbox novnc websockify >/dev/null

export DISPLAY=:99
pkill -f "Xvfb :99" 2>/dev/null || true
pkill -f "x11vnc" 2>/dev/null || true
pkill -f "websockify" 2>/dev/null || true

Xvfb :99 -screen 0 1360x768x24 -nolisten tcp &
sleep 2

fluxbox >/dev/null 2>&1 &
sleep 1

x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet >/dev/null 2>&1 &
sleep 1

# Sirve la interfaz de noVNC como página raíz para poder abrirla directo
# desde la vista previa de Cloud Shell sin tener que escribir /vnc.html.
sudo ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

websockify --web=/usr/share/novnc/ 8080 localhost:5900 >/dev/null 2>&1 &

cat <<'EOF'

============================================================
Listo. Ahora:

1. En Cloud Shell, pulsa el botón "Vista previa en la Web" (icono de ojo,
   arriba a la derecha) -> "Cambiar puerto" -> escribe 8080 -> Vista previa.
   Se abrirá una pestaña nueva con un escritorio virtual (fondo gris).
   Si te pide conectar, pulsa "Connect" (sin contraseña).

2. Vuelve a ESTA terminal y ejecuta:
     export DISPLAY=:99
     npm run gemini:login

3. Cambia a la pestaña del escritorio virtual: ahí aparecerá Chromium.
   Inicia sesión con tu cuenta de Google normalmente (toca los campos,
   usa el teclado de tu móvil).

4. Cuando veas el chat de Gemini cargado, vuelve a ESTA terminal y pulsa
   ENTER para guardar la sesión.
============================================================
EOF
