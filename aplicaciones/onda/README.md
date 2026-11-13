# Pulso Onda

Juego de ritmo con gráficos vectoriales: **cada canción genera un mundo distinto** y los obstáculos
siguen su música. Está dentro de la colección de aplicaciones de este repositorio y enlazado desde el
menú de *Pulso Cúbico*.

## Cómo abrirlo

```bash
python3 -m http.server 8000      # desde la raíz del repositorio
# abre http://localhost:8000/aplicaciones/onda/
```

Hace falta un servidor local (y no doble clic) para que funcionen los reproductores de Spotify y YouTube.

## Cómo se juega

Un personaje avanza por una cinta de luz. Cada figura se supera con su tecla, justo cuando llega:

| Figura | Tecla (J1) | J2 | Viene de… |
|---|---|---|---|
| Bloque | `A` / `←` | `J` | golpes medios (caja) |
| Bucle | `S` / `↓` | `K` | melodía sostenida |
| Onda | `D` / `↑` | `L` | agudos (platillos) |
| Foso | `F` / `→` | `Ñ` | graves (bombo, bajo) |

- **Perfecto / Bien / Fallo** según tu precisión. La energía cambia la forma del personaje
  (Chispa → Trazo → Estrella → Prisma); si llega a cero, el mundo se apaga (salvo con «Sin derrota»).
- **Resonancia** (`Espacio`, J2 `Enter`): se carga con aciertos; dobla los puntos durante 8 s.
- **Tu constelación**: cada acierto perfecto deja una estrella en el cielo. Al final ves el dibujo que hiciste.
- `[` y `]` ajustan el ritmo en plena partida si notas desfase.

## Modos

- **Cinta**: el modo clásico.
- **Fusión**: la cinta arriba y una autopista de 4 carriles abajo (estilo guitarra), con las mismas teclas.
- **Jam · Duelo**: dos jugadores en el mismo dispositivo, el mismo mapa, gana quien sume más.
- **Jam · Dúo**: cooperativo, la canción se reparte (J1 graves y golpes, J2 melodía y agudos).
- **Jam en línea**: varias personas, cada una en su dispositivo, juegan la misma canción a la vez.
  Quien crea la sala comparte un código de 5 letras; al pulsar «Empezar ronda para todos», todos arrancan
  con el mismo mundo. En partida ves a los demás como fantasmas en tu cinta y un marcador en directo, y
  tu Resonancia les manda una **interferencia** (su cinta tiembla 3 s). Al final, clasificación de la sala.
  - Dentro de Claude usa la sala compartida de la página: los amigos deben tener la página compartida.
  - En un navegador normal usa conexión directa entre navegadores (WebRTC con PeerJS y su servidor
    público de señalización); no hace falta servidor propio.
  - Para que todos oigan lo mismo, en sala se usa «Generador», Spotify o YouTube (no archivos propios).
- **Código de Jam**: un texto `ONDA-…` que reproduce exactamente el mismo mundo y mapa en otro equipo.

## De dónde sale el mapa

| Fuente | Qué se analiza |
|---|---|
| **Generador** | Compone una canción con semilla; los obstáculos salen de sus instrumentos (bombo → foso, caja → bloque, melodía → bucle, platillos → onda). |
| **Mi archivo** | Análisis real en el navegador: separa graves/medios/agudos, detecta golpes, tempo y fase, y mide la energía para las secciones. |
| **Spotify / YouTube** | Sus reproductores no permiten leer el audio, así que el mundo se crea con el enlace y la duración de la canción, y el ritmo con el tempo que marques («Toca el ritmo»). |
| **Gira** | Varios enlaces seguidos: cada canción, un mundo. Las listas de Spotify cambian de mundo al cambiar de pista. |

Cada sección de la canción (intro, verso, subida, drop…) cambia el paisaje: cordillera, metrópolis,
túnel, mar de ondas o constelación, con colores propios de cada canción.

## Archivos

```
index.html, style.css
js/util.js       utilidades, enlaces, códigos de Jam
js/synth.js      compositor y sintetizador
js/analysis.js   análisis de audio (golpes, tempo, secciones)
js/chart.js      mapa por dificultad y generación de mundos
js/sources.js    fuentes: generador, archivo, Spotify, YouTube
js/render.js     dibujo vectorial
js/jam.js        jam en línea (sala de Claude o WebRTC)
js/game.js       juego, juicio, modos y estudio
```
