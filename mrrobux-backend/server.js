const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // mas grande para permitir la foto de portada de las partidas

// ---------- Administrador ----------
// Unico usuario que puede: crear/iniciar/finalizar partidas privadas, poner el
// premio, cambiar la hora de la ruleta y quitar participantes de la ruleta.
const ADMIN_USERNAME = 'elchinonmms';

// ---------- Notificacion por correo cuando hay un ganador ----------
// EMAIL_USER / EMAIL_PASS se configuran como variables de entorno en Railway
// (nunca se guardan en el codigo). NOTIFY_EMAIL es opcional, por defecto
// llega al correo del dueño de la pagina.
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'ariyairdiaz75@gmail.com';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let mailer = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
} else {
  console.log('Aviso: EMAIL_USER/EMAIL_PASS no configurados. No se enviaran correos de ganador (revisa el README).');
}

async function sendWinnerEmail(winner, participantsAtSpin) {
  if (!mailer || !winner) return;
  try {
    await mailer.sendMail({
      from: EMAIL_USER,
      to: NOTIFY_EMAIL,
      subject: '🎉 Nuevo ganador en la ruleta de MrROBUX',
      text:
        'El ganador del sorteo es: ' + winner + '\n\n' +
        'Participantes en este sorteo: ' + (participantsAtSpin.join(', ') || '(ninguno)') + '\n\n' +
        'Fecha: ' + new Date().toLocaleString('es-ES')
    });
    console.log('Correo de ganador enviado a ' + NOTIFY_EMAIL);
  } catch (err) {
    console.log('No se pudo enviar el correo de ganador:', err.message);
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PARTICIPANTS_FILE = path.join(DATA_DIR, 'participants.json');
const SPIN_FILE = path.join(DATA_DIR, 'lastSpin.json');
const SPIN_CONFIG_FILE = path.join(DATA_DIR, 'spinConfig.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(PARTICIPANTS_FILE)) fs.writeFileSync(PARTICIPANTS_FILE, '[]');
if (!fs.existsSync(SPIN_FILE)) fs.writeFileSync(SPIN_FILE, 'null');
if (!fs.existsSync(SPIN_CONFIG_FILE)) fs.writeFileSync(SPIN_CONFIG_FILE, JSON.stringify({ hours: [12] }));
if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');
if (!fs.existsSync(CHAT_FILE)) fs.writeFileSync(CHAT_FILE, '[]');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Cola simple de escrituras (una sola, compartida por todos los archivos):
// evita que dos peticiones a la vez se pisen entre si al leer-modificar-guardar.
// mutateFn recibe los datos actuales y debe devolver los datos nuevos a guardar.
let writeChain = Promise.resolve();
function withFile(file, mutateFn) {
  const run = writeChain.then(() => {
    const data = readJSON(file);
    const result = mutateFn(data);
    writeJSON(file, result);
    return result;
  });
  writeChain = run.catch(() => {});
  return run;
}

// Revisa que adminUser/adminPassword sean de verdad la cuenta de elchinonmms.
// No hay "sesiones" en este servidor, asi que cada accion de administrador
// tiene que volver a mandar su contraseña (el navegador la guarda solo en
// memoria mientras dura la sesión, nunca en el disco del usuario).
async function verifyAdmin(adminUser, adminPassword) {
  if (!adminUser || !adminPassword) return false;
  if (String(adminUser).trim().toLowerCase() !== ADMIN_USERNAME.toLowerCase()) return false;
  const users = readJSON(USERS_FILE);
  const account = users[ADMIN_USERNAME.toLowerCase()];
  if (!account) return false;
  return bcrypt.compare(String(adminPassword), account.passwordHash);
}

function chatSystemMessage(text) {
  return withFile(CHAT_FILE, (data) => {
    data.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      username: 'Sistema',
      text,
      at: new Date().toISOString(),
      system: true
    });
    if (data.length > 200) data.splice(0, data.length - 200);
    return data;
  });
}

// ---------- Registro ----------
app.post('/api/register', async (req, res) => {
  const { username, password, age, gender } = req.body || {};
  if (!username || !password || !age || !gender) {
    return res.status(400).json({ ok: false, error: 'Completa todos los campos.' });
  }
  const displayName = String(username).trim();
  const key = displayName.toLowerCase();
  if (!key) return res.status(400).json({ ok: false, error: 'Usuario inválido.' });

  const users = readJSON(USERS_FILE);
  if (users[key]) {
    return res.status(409).json({ ok: false, error: 'Ese usuario ya existe. Inicia sesión.' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  await withFile(USERS_FILE, (data) => {
    data[key] = {
      displayName,
      passwordHash,
      age: Number(age),
      gender: String(gender),
      createdAt: new Date().toISOString()
    };
    return data;
  });

  res.json({ ok: true, displayName, isAdmin: key === ADMIN_USERNAME.toLowerCase() });
});

// ---------- Login ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Completa usuario y contraseña.' });
  }
  const key = String(username).trim().toLowerCase();
  const users = readJSON(USERS_FILE);
  const account = users[key];

  if (!account) {
    return res.status(404).json({ ok: false, error: 'Ese usuario no está registrado. Regístrate primero.' });
  }
  const match = await bcrypt.compare(String(password), account.passwordHash);
  if (!match) {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
  }
  res.json({ ok: true, displayName: account.displayName, isAdmin: key === ADMIN_USERNAME.toLowerCase() });
});

// ---------- Estado global (participantes + ultimo sorteo) ----------
app.get('/api/state', (req, res) => {
  const participants = readJSON(PARTICIPANTS_FILE);
  const lastSpin = readJSON(SPIN_FILE);
  res.json({ participants, lastSpin });
});

// ---------- Configuracion de horario de giro ----------
app.get('/api/spin-config', (req, res) => {
  res.json(readJSON(SPIN_CONFIG_FILE));
});

app.post('/api/admin/spin-config', async (req, res) => {
  const { adminUser, adminPassword, hours } = req.body || {};
  if (!(await verifyAdmin(adminUser, adminPassword))) {
    return res.status(403).json({ ok: false, error: 'Solo el administrador puede cambiar la hora de la ruleta.' });
  }
  if (!Array.isArray(hours) || hours.length === 0 || hours.some((h) => typeof h !== 'number' || h < 0 || h > 23)) {
    return res.status(400).json({ ok: false, error: 'Hora inválida (debe ser de 0 a 23).' });
  }
  const config = await withFile(SPIN_CONFIG_FILE, () => ({ hours }));
  res.json({ ok: true, ...config });
});

// ---------- Unirse a la ruleta ----------
app.post('/api/participar', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, error: 'Falta el usuario.' });
  const name = String(username).trim();

  const participants = await withFile(PARTICIPANTS_FILE, (data) => {
    if (!data.includes(name)) data.push(name);
    return data;
  });

  res.json({ ok: true, participants });
});

// ---------- Quitar a alguien de la ruleta (solo administrador) ----------
app.post('/api/admin/remove-participant', async (req, res) => {
  const { adminUser, adminPassword, username } = req.body || {};
  if (!(await verifyAdmin(adminUser, adminPassword))) {
    return res.status(403).json({ ok: false, error: 'Solo el administrador puede quitar participantes.' });
  }
  if (!username) return res.status(400).json({ ok: false, error: 'Falta el usuario a quitar.' });

  const participants = await withFile(PARTICIPANTS_FILE, (data) => {
    return data.filter((p) => p.toLowerCase() !== String(username).trim().toLowerCase());
  });

  res.json({ ok: true, participants });
});

// ---------- Girar la ruleta (idempotente por horario) ----------
// slotKey identifica el horario programado (ej: el timestamp de las 8pm de hoy).
// Todos los visitantes calculan el mismo slotKey a la misma hora; el primero que
// llega hace el sorteo real y lo guarda, los demas solo reciben el mismo resultado.
app.post('/api/spin', async (req, res) => {
  const { slotKey } = req.body || {};
  if (!slotKey) return res.status(400).json({ ok: false, error: 'Falta slotKey.' });

  try {
    // Todo esto corre dentro de la misma cola de escritura (withFile), asi que
    // aunque lleguen varias peticiones para el mismo slotKey al mismo tiempo,
    // solo la primera calcula un ganador nuevo; el resto recibe ese mismo resultado.
    let isNewSpin = false;
    const result = await withFile(SPIN_FILE, (existing) => {
      if (existing && existing.slotKey === String(slotKey)) {
        return existing;
      }
      isNewSpin = true;
      const participants = readJSON(PARTICIPANTS_FILE);
      let winner = null;
      if (participants.length > 0) {
        winner = participants[Math.floor(Math.random() * participants.length)];
      }
      // nueva ronda: se limpia la lista de participantes para el siguiente sorteo
      writeJSON(PARTICIPANTS_FILE, []);
      return {
        slotKey: String(slotKey),
        winner,
        participantsAtSpin: participants,
        at: new Date().toISOString()
      };
    });

    // Solo se avisa (correo + chat) cuando este sorteo se acaba de decidir de
    // verdad (no cuando otro visitante ya lo habia disparado y solo se repite
    // el resultado).
    if (isNewSpin) {
      sendWinnerEmail(result.winner, result.participantsAtSpin);
      if (result.winner) {
        chatSystemMessage('🎉🎊 ¡@' + result.winner + ' ganó la ruleta de hoy! 🎊🎉');
      }
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al girar la ruleta.' });
  }
});

// ---------- Partidas privadas ----------
app.get('/api/matches', (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  res.json({ matches: matches.slice().reverse() }); // las mas nuevas primero
});

app.post('/api/admin/matches', async (req, res) => {
  const { adminUser, adminPassword, title, description, coverImage, maxPlayers, prize, link } = req.body || {};
  if (!(await verifyAdmin(adminUser, adminPassword))) {
    return res.status(403).json({ ok: false, error: 'Solo el administrador puede crear partidas.' });
  }
  if (!title || !maxPlayers) {
    return res.status(400).json({ ok: false, error: 'Falta el título o el máximo de jugadores.' });
  }
  const match = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    title: String(title).trim(),
    description: String(description || '').trim(),
    coverImage: coverImage || null, // data URI (base64), se guarda tal cual
    maxPlayers: Math.max(1, Number(maxPlayers)),
    prize: Number(prize) || 0,
    link: String(link || '').trim(),
    participants: [],
    status: 'open', // open -> live -> finished
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null
  };
  await withFile(MATCHES_FILE, (data) => {
    data.push(match);
    return data;
  });
  res.json({ ok: true, match });
});

app.post('/api/matches/:id/join', async (req, res) => {
  const { username } = req.body || {};
  const id = req.params.id;
  if (!username) return res.status(400).json({ ok: false, error: 'Falta el usuario.' });
  const name = String(username).trim();

  let error = null;
  let updated = null;
  await withFile(MATCHES_FILE, (data) => {
    const m = data.find((x) => x.id === id);
    if (!m) { error = 'Esa partida ya no existe.'; return data; }
    if (m.status !== 'open') { error = 'Esa partida ya no acepta jugadores.'; return data; }
    if (m.participants.some((p) => p.toLowerCase() === name.toLowerCase())) { error = 'ya-dentro'; updated = m; return data; }
    if (m.participants.length >= m.maxPlayers) { error = 'Esa partida ya está llena.'; return data; }
    m.participants.push(name);
    updated = m;
    return data;
  });

  if (error === 'ya-dentro') return res.json({ ok: true, match: updated, alreadyJoined: true });
  if (error) return res.status(400).json({ ok: false, error });
  res.json({ ok: true, match: updated });
});

app.post('/api/admin/matches/:id/start', async (req, res) => {
  const { adminUser, adminPassword } = req.body || {};
  if (!(await verifyAdmin(adminUser, adminPassword))) {
    return res.status(403).json({ ok: false, error: 'Solo el administrador puede iniciar partidas.' });
  }
  const id = req.params.id;
  let error = null;
  let updated = null;
  await withFile(MATCHES_FILE, (data) => {
    const m = data.find((x) => x.id === id);
    if (!m) { error = 'Esa partida ya no existe.'; return data; }
    m.status = 'live';
    m.startedAt = new Date().toISOString();
    updated = m;
    return data;
  });
  if (error) return res.status(400).json({ ok: false, error });
  res.json({ ok: true, match: updated });
});

app.post('/api/admin/matches/:id/finish', async (req, res) => {
  const { adminUser, adminPassword } = req.body || {};
  if (!(await verifyAdmin(adminUser, adminPassword))) {
    return res.status(403).json({ ok: false, error: 'Solo el administrador puede finalizar partidas.' });
  }
  const id = req.params.id;
  let error = null;
  let updated = null;
  await withFile(MATCHES_FILE, (data) => {
    const m = data.find((x) => x.id === id);
    if (!m) { error = 'Esa partida ya no existe.'; return data; }
    m.status = 'finished';
    m.endedAt = new Date().toISOString();
    updated = m;
    return data;
  });
  if (error) return res.status(400).json({ ok: false, error });
  res.json({ ok: true, match: updated });
});

// ---------- Chat de comunidad ----------
// Solo texto (emojis y enlaces a gifs incluidos como texto plano); no se
// aceptan archivos ni videos porque nunca se ofrece un campo para subirlos.
app.get('/api/chat', (req, res) => {
  res.json({ messages: readJSON(CHAT_FILE) });
});

app.post('/api/chat', async (req, res) => {
  const { username, text } = req.body || {};
  if (!username || !text) return res.status(400).json({ ok: false, error: 'Falta el mensaje.' });
  const clean = String(text).trim().slice(0, 500);
  if (!clean) return res.status(400).json({ ok: false, error: 'Mensaje vacío.' });

  const messages = await withFile(CHAT_FILE, (data) => {
    data.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      username: String(username).trim(),
      text: clean,
      at: new Date().toISOString()
    });
    if (data.length > 200) data.splice(0, data.length - 200);
    return data;
  });

  res.json({ ok: true, messages });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('MrROBUX backend escuchando en el puerto ' + PORT);
});
