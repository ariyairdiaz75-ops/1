# Backend de MrROBUX

Este es el servidor que hace que los **usuarios registrados**, el **login** y la
**ruleta de participantes** sean los mismos para todos los visitantes de tu
página web (antes solo funcionaba en el navegador de cada quien).

Guarda todo en archivos JSON dentro de la carpeta `data/` (se crea sola la
primera vez que arranca). No necesitas instalar ninguna base de datos aparte.

## Qué hace

- `POST /api/register` — crea una cuenta (usuario, contraseña, edad, género).
  La contraseña se guarda cifrada (nunca en texto plano).
- `POST /api/login` — solo deja entrar si el usuario existe y la contraseña
  coincide.
- `GET /api/state` — devuelve la lista de participantes actual y el último
  sorteo, para que la ruleta se vea igual en cualquier dispositivo.
- `POST /api/participar` — añade a alguien a la ruleta (rebanada de pizza).
- `POST /api/spin` — hace el sorteo. Está diseñado para que, aunque varias
  personas tengan la página abierta a la misma hora programada, **solo se
  elija un ganador real** y todos vean el mismo resultado.

## Probarlo en tu computadora (opcional, antes de subirlo)

Necesitas tener [Node.js](https://nodejs.org) instalado (versión 18 o más
nueva).

```bash
cd mrrobux-backend
npm install
npm start
```

Debería decir `MrROBUX backend escuchando en el puerto 3000`. Puedes probarlo
con `curl http://localhost:3000/api/state`.

## Subirlo a internet (para que sea real y "global")

La forma más simple, gratis y sin tarjeta de crédito es **Render**:

1. Crea una cuenta en https://render.com (puedes entrar con tu cuenta de
   GitHub).
2. Sube esta carpeta (`mrrobux-backend`) a un repositorio de GitHub. Si no
   sabes cómo, dímelo y te ayudo a hacerlo desde aquí.
3. En Render: **New +** → **Web Service** → conecta ese repositorio.
4. Configuración:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - Plan: **Free**
5. Dale a **Create Web Service** y espera a que termine de desplegar (unos
   minutos). Al terminar, Render te da una URL como:
   `https://mrrobux-backend-xxxx.onrender.com`

6. Abre tu archivo `MrROBUX_12.html`, busca esta línea casi al final (dentro
   de la etiqueta `<script>`):

   ```js
   var API_BASE = 'https://TU-BACKEND-AQUI.onrender.com';
   ```

   y cambia esa URL por la que te dio Render. Guarda el archivo y ya tu
   página web va a leer y guardar todo (usuarios, login, ruleta) desde el
   servidor real, compartido para cualquiera que la visite.

### Cosas a tener en cuenta con el plan gratis de Render

- El servidor "se duerme" si nadie lo usa por un rato, y tarda unos segundos
  en despertar en la primera visita del día — es normal, no es un error.
- El disco donde se guardan los archivos de `data/` **no es permanente**: si
  Render reinicia o vuelve a desplegar el servicio, esos datos se pueden
  perder. Para un sitio real con muchos usuarios, el siguiente paso sería
  agregarle un disco persistente (Render lo ofrece de pago) o pasar los datos
  a una base de datos de verdad (por ejemplo Postgres, que Render también
  ofrece gratis). Dime si quieres que lo dejemos así de robusto y lo hacemos.

## Estructura

```
mrrobux-backend/
  server.js       <- toda la lógica del servidor
  package.json    <- dependencias (express, cors, bcryptjs)
  data/           <- se crea sola: users.json, participants.json, lastSpin.json
```
