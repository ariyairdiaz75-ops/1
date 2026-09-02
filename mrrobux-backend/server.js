const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(PARTICIPANTS_FILE)) fs.writeFileSync(PARTICIPANTS_FILE, '[]');
if (!fs.existsSync(SPIN_FILE)) fs.writeFileSync(SPIN_FILE, 'null');

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

  res.json({ ok: true, displayName });
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
  res.json({ ok: true, displayName: account.displayName });
});

// ---------- Estado global (participantes + ultimo sorteo) ----------
app.get('/api/state', (req, res) => {
  const participants = readJSON(PARTICIPANTS_FILE);
  const lastSpin = readJSON(SPIN_FILE);
  res.json({ participants, lastSpin });
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

    // Solo se avisa por correo cuando este sorteo se acaba de decidir de verdad
    // (no cuando otro visitante ya lo habia disparado y solo se repite el resultado).
    if (isNewSpin) {
      sendWinnerEmail(result.winner, result.participantsAtSpin);
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al girar la ruleta.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('MrROBUX backend escuchando en el puerto ' + PORT);
});
