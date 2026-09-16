/* ============================================================================
   MrROBUX — Zona de Premios (solicitudes, tareas, códigos y recomendados)
   ----------------------------------------------------------------------------
   Router de Express listo para montar en tu backend ya existente.
   Ver backend/README.md para las 3 líneas que hay que agregar.
   ============================================================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');

const ADMIN_USERNAME = 'elchinonmms';
const DATA_FILE = process.env.PREMIOS_DATA_FILE ||
  path.join(__dirname, 'premios-data.json');

/* ----------------------------- almacenamiento ----------------------------- */

let db = { members: [], requests: [], tasks: [] };

function loadDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      members: Array.isArray(parsed.members) ? parsed.members : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    };
  } catch (e) {
    db = { members: [], requests: [], tasks: [] };
  }
}

let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error('[premios] no se pudo guardar:', e.message);
    }
  }, 150);
}

loadDb();

/* -------------------------------- utilidades ------------------------------ */

const lower = (s) => String(s || '').trim().toLowerCase();
const isAdminName = (u) => lower(u) === ADMIN_USERNAME;

function isMember(username) {
  if (!username) return false;
  if (isAdminName(username)) return true;
  return db.members.some((m) => lower(m) === lower(username));
}

function hasPendingRequest(username) {
  return db.requests.some((r) => lower(r) === lower(username));
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || 'desconocida';
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
function makeCode(task) {
  for (let intento = 0; intento < 60; intento++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!task.participants.some((p) => p.code === code)) return code;
  }
  return 'C' + Date.now().toString(36).toUpperCase().slice(-5);
}

function taskIsOpen(task) {
  return task.status !== 'closed' && Date.now() < task.endsAt;
}

function refreshTaskStatus(task) {
  if (task.status !== 'closed' && Date.now() >= task.endsAt) {
    task.status = 'closed';
  }
  return task;
}

/* Lo que se manda al navegador: nunca los códigos de los demás ni las IPs. */
function publicTask(task, username) {
  refreshTaskStatus(task);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    prize: task.prize,
    maxParticipants: task.maxParticipants,
    endsAt: task.endsAt,
    status: task.status,
    shortLink: task.shortLink,
    refUrl: task.refUrl,
    createdAt: task.createdAt,
    participants: task.participants.map((p) => ({
      username: p.username,
      referrals: p.referrals || 0,
      // el código solo lo ve su dueño (y el anfitrión)
      code: (lower(p.username) === lower(username) || isAdminName(username)) ? (p.code || null) : null
    }))
  };
}

function findTask(id) {
  return db.tasks.find((t) => t.id === id) || null;
}

/* ------------------------------- el router -------------------------------- */

/**
 * @param {object} opts
 * @param {(user:string, pass:string) => (boolean|Promise<boolean>)} [opts.verifyAdmin]
 *        Función de tu backend que confirma usuario+contraseña del anfitrión.
 *        Si no la pasas, solo se comprueba que el usuario sea "elchinonmms".
 */
function createPremiosRouter(opts) {
  const options = opts || {};
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  async function requireAdmin(req, res) {
    const user = (req.body && req.body.adminUser) || '';
    const pass = (req.body && req.body.adminPassword) || '';
    if (!isAdminName(user)) {
      res.status(403).json({ error: 'Solo el anfitrión puede hacer esto.' });
      return false;
    }
    if (typeof options.verifyAdmin === 'function') {
      let ok = false;
      try { ok = await options.verifyAdmin(user, pass); } catch (e) { ok = false; }
      if (!ok) {
        res.status(403).json({ error: 'Contraseña de anfitrión incorrecta.' });
        return false;
      }
    }
    return true;
  }

  /* ---- estado general de la zona de premios ---- */
  router.get('/api/premios/state', (req, res) => {
    const username = String(req.query.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Falta el usuario.' });

    const admin = isAdminName(username);
    const member = isMember(username);

    db.tasks.forEach(refreshTaskStatus);

    res.json({
      isAdmin: admin,
      member: member,
      pending: !member && hasPendingRequest(username),
      requests: admin ? db.requests.slice() : [],
      tasks: member
        ? db.tasks
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((t) => publicTask(t, username))
        : []
    });
  });

  /* ---- solicitar unirse ---- */
  router.post('/api/premios/join-request', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    if (!username) return res.status(400).json({ error: 'Falta el usuario.' });
    if (isMember(username)) return res.json({ ok: true, member: true, pending: false });
    if (!hasPendingRequest(username)) {
      db.requests.push(username);
      saveDb();
    }
    res.json({ ok: true, member: false, pending: true });
  });

  /* ---- aceptar / rechazar / aceptar todas ---- */
  router.post('/api/admin/premios/accept', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const username = String((req.body && req.body.username) || '').trim();
    if (!username) return res.status(400).json({ error: 'Falta el usuario.' });
    db.requests = db.requests.filter((r) => lower(r) !== lower(username));
    if (!isMember(username)) db.members.push(username);
    saveDb();
    res.json({ ok: true, members: db.members, requests: db.requests });
  });

  router.post('/api/admin/premios/reject', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const username = String((req.body && req.body.username) || '').trim();
    db.requests = db.requests.filter((r) => lower(r) !== lower(username));
    saveDb();
    res.json({ ok: true, members: db.members, requests: db.requests });
  });

  router.post('/api/admin/premios/accept-all', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    db.requests.forEach((r) => { if (!isMember(r)) db.members.push(r); });
    db.requests = [];
    saveDb();
    res.json({ ok: true, members: db.members, requests: db.requests });
  });

  /* ---- crear tarea ---- */
  router.post('/api/admin/premios/tasks', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const maxParticipants = Number(b.maxParticipants);
    const durationMinutes = Number(b.durationMinutes);

    if (!title) return res.status(400).json({ error: 'Falta el nombre de la tarea.' });
    if (!maxParticipants || maxParticipants < 1) {
      return res.status(400).json({ error: 'Cantidad de participantes inválida.' });
    }
    if (!durationMinutes || durationMinutes < 1) {
      return res.status(400).json({ error: 'Duración inválida.' });
    }

    const id = String(b.id || ('T' + Date.now().toString(36))).trim();
    if (findTask(id)) return res.status(400).json({ error: 'Esa tarea ya existe.' });

    const task = {
      id,
      title,
      description: String(b.description || '').trim(),
      prize: Number(b.prize) || 0,
      maxParticipants,
      durationMinutes,
      endsAt: Date.now() + durationMinutes * 60 * 1000,
      shortLink: String(b.shortLink || '').trim(),
      refUrl: String(b.refUrl || '').trim(),
      status: 'open',
      createdAt: Date.now(),
      participants: [],
      countedIps: {}   // ip -> código usado (una sola vez por tarea)
    };
    db.tasks.push(task);
    saveDb();
    res.json({ ok: true, task: publicTask(task, b.adminUser) });
  });

  /* ---- cerrar tarea antes de tiempo ---- */
  router.post('/api/admin/premios/tasks/:id/close', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const task = findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
    task.status = 'closed';
    saveDb();
    res.json({ ok: true, task: publicTask(task, req.body.adminUser) });
  });

  /* ---- participar en una tarea ---- */
  router.post('/api/premios/tasks/:id/participate', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    if (!username) return res.status(400).json({ error: 'Falta el usuario.' });
    if (!isMember(username)) {
      return res.status(403).json({ error: 'El anfitrión todavía no te acepta en la zona de premios.' });
    }
    const task = findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
    refreshTaskStatus(task);
    if (!taskIsOpen(task)) return res.status(400).json({ error: 'La tarea ya terminó.' });

    const ya = task.participants.find((p) => lower(p.username) === lower(username));
    if (!ya) {
      if (task.participants.length >= task.maxParticipants) {
        return res.status(400).json({ error: 'La tarea ya está llena.' });
      }
      task.participants.push({ username, code: null, referrals: 0, joinedAt: Date.now() });
      saveDb();
    }
    res.json({ ok: true, task: publicTask(task, username) });
  });

  /* ---- generar código (una sola vez por participante y tarea) ---- */
  router.post('/api/premios/tasks/:id/code', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    if (!username) return res.status(400).json({ error: 'Falta el usuario.' });
    const task = findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
    refreshTaskStatus(task);
    if (!taskIsOpen(task)) return res.status(400).json({ error: 'La tarea ya terminó.' });

    const p = task.participants.find((x) => lower(x.username) === lower(username));
    if (!p) return res.status(400).json({ error: 'Primero tienes que participar en la tarea.' });
    if (p.code) {
      return res.json({ ok: true, code: p.code, task: publicTask(task, username) });
    }
    p.code = makeCode(task);
    saveDb();
    res.json({ ok: true, code: p.code, task: publicTask(task, username) });
  });

  /* ---- info pública de la página del código ---- */
  router.get('/api/premios/ref-info', (req, res) => {
    const task = findTask(String(req.query.taskId || ''));
    if (!task) return res.status(404).json({ error: 'Link no válido.' });
    refreshTaskStatus(task);
    res.json({ id: task.id, title: task.title, prize: task.prize, open: taskIsOpen(task) });
  });

  /* ---- canjear un código (suma 1 recomendado, una vez por IP y tarea) ---- */
  router.post('/api/premios/ref', (req, res) => {
    const b = req.body || {};
    const taskId = String(b.taskId || '').trim();
    const code = String(b.code || '').trim().toUpperCase();
    if (!taskId || !code) return res.status(400).json({ error: 'Falta el código.' });

    const task = findTask(taskId);
    if (!task) return res.status(404).json({ error: 'Link no válido.' });
    refreshTaskStatus(task);
    if (!taskIsOpen(task)) return res.status(400).json({ error: 'Esta tarea ya terminó.' });

    const p = task.participants.find((x) => x.code === code);
    if (!p) return res.status(404).json({ error: 'Ese código no existe en esta tarea.' });

    const ip = getClientIp(req);

    // Una IP solo cuenta una vez por tarea, aunque vuelva a entrar o cambie de código.
    if (task.countedIps[ip]) {
      return res.json({ ok: true, counted: false, username: p.username, referrals: p.referrals || 0 });
    }

    task.countedIps[ip] = code;
    p.referrals = (p.referrals || 0) + 1;
    saveDb();

    res.json({ ok: true, counted: true, username: p.username, referrals: p.referrals });
  });

  return router;
}

module.exports = createPremiosRouter;
module.exports.createPremiosRouter = createPremiosRouter;
