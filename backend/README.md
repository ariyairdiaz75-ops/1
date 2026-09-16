# Zona de Premios — backend

`premios.js` es un router de Express con todo lo que necesita la pestaña **🎁 Premios**
de `mrrobux.html`: solicitudes para unirse, tareas con cronómetro, códigos de
recomendación y el conteo de recomendados por IP.

No toca nada de lo que ya tienes (ruleta, partidas, chat, login). Se monta encima.

## Cómo montarlo en tu backend actual

En el archivo principal de tu servidor (`server.js`, `index.js`, `app.js`…):

```js
const createPremiosRouter = require('./premios');   // ajusta la ruta si hace falta

app.set('trust proxy', 1);   // IMPORTANTE en Railway: para leer la IP real del visitante

app.use(createPremiosRouter({
  // Confirma usuario + contraseña del anfitrión con TU base de usuarios.
  // Cambia esto por tu propia comprobación.
  verifyAdmin: async (user, pass) => {
    const u = await buscarUsuario(user);        // <-- tu función
    return !!u && u.password === pass;          // <-- tu comparación
  }
}));
```

Si no pasas `verifyAdmin`, el router solo comprueba que el usuario sea `elchinonmms`
(sirve para probar, pero conviene conectar la comprobación real de contraseña).

## Dónde se guardan los datos

En `backend/premios-data.json` (o en la ruta de la variable de entorno
`PREMIOS_DATA_FILE`).

⚠️ En Railway el disco se borra en cada despliegue. Si quieres que las tareas y los
recomendados sobrevivan a un redeploy, apunta `PREMIOS_DATA_FILE` a un volumen
persistente, o cambia `loadDb`/`saveDb` por tu base de datos.

## Endpoints que agrega

| Método | Ruta | Para qué |
|---|---|---|
| GET  | `/api/premios/state?username=` | Estado del usuario (miembro / pendiente / anfitrión) + tareas |
| POST | `/api/premios/join-request` | Solicitar unirse a la zona de premios |
| POST | `/api/admin/premios/accept` | El anfitrión acepta a una persona |
| POST | `/api/admin/premios/reject` | El anfitrión rechaza a una persona |
| POST | `/api/admin/premios/accept-all` | Aceptar **todas** las solicitudes pendientes |
| POST | `/api/admin/premios/tasks` | Crear una tarea |
| POST | `/api/admin/premios/tasks/:id/close` | Cerrar una tarea antes de tiempo |
| POST | `/api/premios/tasks/:id/participate` | Un participante entra a la tarea |
| POST | `/api/premios/tasks/:id/code` | Genera su código (solo una vez por tarea) |
| GET  | `/api/premios/ref-info?taskId=` | Datos públicos para la página del código |
| POST | `/api/premios/ref` | Canjear un código (suma 1 recomendado) |

## Reglas que aplica el servidor

- Solo `elchinonmms` puede aceptar solicitudes, crear y cerrar tareas.
- Quien no esté aceptado no ve ninguna tarea.
- Cada participante genera **un solo código por tarea**.
- Cada **IP cuenta una sola vez por tarea**: si la misma persona vuelve a entrar al
  link y pone un código otra vez (el mismo u otro), ya no suma. Al crear una tarea
  nueva el conteo empieza de cero, porque las IP se guardan dentro de cada tarea.
- Cuando se acaba el cronómetro la tarea se cierra sola: ya no se puede participar,
  ni generar códigos, ni canjearlos.
- Nadie ve el código de otra persona; solo el suyo (y el anfitrión).
