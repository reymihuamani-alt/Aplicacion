# Pulso Cúbico

Juego de plataformas rítmico (*auto-runner*) hecho con HTML5 Canvas y JavaScript puro, sin dependencias.
Un cubo avanza solo al ritmo de la música: tú decides cuándo saltar.

## Cómo jugar

Abre `index.html` en el navegador (doble clic) o sirve la carpeta:

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
```

| Acción | Teclado | Ratón / táctil |
|---|---|---|
| Saltar (mantén para saltar seguido) | `Espacio`, `↑`, `W` | clic / toque |
| Nave: subir / bajar | mantener / soltar | mantener / soltar |
| Pausa | `Esc` o `P` | botón ❚❚ |
| Reiniciar | `R` | menú de pausa |
| Silenciar | `M` | botón en el menú |
| Práctica: poner / quitar punto de control | `Z` / `X` | botones ◆+ / ◆− |

## Contenido

- **3 niveles**: *Primer Latido* (fácil), *Circuito Nocturno* (normal) y *Tormenta Prisma* (difícil).
- **Elementos**: pinchos, bloques, losas, plataformas de salto, orbes amarillos, orbes azules (invierten la gravedad),
  portales de nave/cubo y de gravedad.
- **Modo práctica** con puntos de control automáticos y manuales.
- **Música generada en tiempo real** con WebAudio (cada nivel tiene su canción).
- **Fondo propio**: elige cualquier imagen de tu dispositivo (con control para oscurecerla).
- **Música propia**: un archivo de audio tuyo (MP3, OGG, WAV, M4A…), un enlace de **YouTube** o un enlace de **Spotify**,
  con opción de empezar en un segundo concreto. Los archivos se guardan solo en tu navegador.
- Icono personalizable, récord de porcentaje e intentos guardados en el navegador.

### Música de YouTube y Spotify

- Abre el juego desde un servidor local (`python3 -m http.server`) y no con doble clic: YouTube no reproduce
  vídeos incrustados en páginas abiertas como archivo (`file://`).
- Spotify solo suena completo si has iniciado sesión en Spotify en ese navegador; si no, reproduce 30 s.
- Dentro de la vista de Claude no se pueden incrustar otras webs, así que allí solo funcionan la música
  del juego y los archivos de audio propios.

## Estructura

```
index.html        pantalla y menús
css/style.css     estilos
js/engine.js      física determinista (también se ejecuta en Node)
js/levels.js      definición de niveles en texto
js/audio.js       secuenciador / sintetizador de música
js/custom.js      fondo y música propios (archivo, YouTube, Spotify)
js/game.js        bucle de juego, dibujo, entrada y menús
tools/solve.js    verificador: comprueba que todos los niveles se pueden completar
```

## Crear niveles

Los niveles se escriben como dibujos de texto en `js/levels.js` (la leyenda está al principio del archivo).
Después de editar, comprueba que siguen siendo superables:

```bash
node tools/solve.js      # busca una solución cambiando la entrada como mucho cada 4 fotogramas
node tools/solve.js 6    # más estricto: cada 6 fotogramas (100 ms)
```
