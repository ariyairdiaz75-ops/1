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
  elija un ganador real** y todos vean el mismo resultado. Cuando hay un
  ganador, manda un correo de aviso (ver sección de abajo).

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

## Correo cuando alguien gana la ruleta

Cada vez que se hace un sorteo real (no cuando se repite el mismo resultado a
otro visitante), el servidor manda un correo a **ariyairdiaz75@gmail.com**
avisando quién ganó.

Para que esto funcione necesitas darle al servidor una cuenta de Gmail desde
la que enviar el correo (puede ser la misma tuya). Como Google no deja usar
tu contraseña normal para esto, hay que crear una "Contraseña de aplicación":

1. Entra a tu cuenta de Google → **Seguridad** → activa la
   **Verificación en dos pasos** (si no la tienes activada, tienes que
   activarla primero, es obligatorio para el siguiente paso).
2. Ve a https://myaccount.google.com/apppasswords
3. Ponle un nombre (por ejemplo "MrROBUX") y dale **Crear**. Te va a dar una
   contraseña de 16 letras — cópiala (solo se muestra una vez).
4. En Railway, entra a tu servicio → pestaña **Variables** → agrega:
   - `EMAIL_USER` = tu correo de Gmail (el que envía, ej. `ariyairdiaz75@gmail.com`)
   - `EMAIL_PASS` = la contraseña de 16 letras que te dio Google (sin espacios)
5. Guarda — Railway vuelve a desplegar solo con las nuevas variables.

Si no configuras estas dos variables, la página sigue funcionando igual de
bien, solo que no se manda el correo (el servidor lo avisa en los logs).

Si alguna vez quieres que el aviso llegue a otro correo en vez de
`ariyairdiaz75@gmail.com`, agrega también la variable `NOTIFY_EMAIL` con la
dirección que quieras.

## Estructura

```
mrrobux-backend/
  server.js       <- toda la lógica del servidor
  package.json    <- dependencias (express, cors, bcryptjs, nodemailer)
  data/           <- se crea sola: users.json, participants.json, lastSpin.json
```
