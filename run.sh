#!/usr/bin/env bash
#
# run.sh — Arranca el backend de Cuenta Corriente verificando antes que
#          esté todo lo necesario: Node, dependencias, .env, MongoDB y el puerto.
#
# Uso:
#   ./run.sh            arranca en modo producción (npm start)
#   ./run.sh --dev      arranca en modo watch con tsx (sin compilar)
#   ./run.sh --check    solo verifica y compila, no arranca el servidor
#   ./run.sh --help     muestra esta ayuda
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# ─────────────────────────── Colores / helpers ───────────────────────────
if [[ -t 1 ]]; then
  RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BLUE=$'\e[34m'
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; DIM=''; RESET=''
fi

ok()    { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
fail()  { printf '  %s✘%s %s\n' "$RED"   "$RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
info()  { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
step()  { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
die()   { fail "$*"; printf '\n%sArranque abortado.%s\n' "$RED$BOLD" "$RESET"; exit 1; }

# ─────────────────────────── Argumentos ───────────────────────────
MODE="start"
ONLY_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --dev)   MODE="dev" ;;
    --check) ONLY_CHECK=1 ;;
    --help|-h)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Opción desconocida: $arg (usá --help)" ;;
  esac
done

REQUIRED_VARS=(MONGO_URI JWT_SECRET SUPER_ADMIN_EMAIL SUPER_ADMIN_PASSWORD)
SECRET_VARS=(JWT_SECRET SUPER_ADMIN_PASSWORD MONGO_URI)
LOG_FILE=".run.log"

printf '%s╔══════════════════════════════════════════════════════════╗%s\n' "$BLUE$BOLD" "$RESET"
printf '%s║   Backend Cuenta Corriente — verificación de arranque     ║%s\n' "$BLUE$BOLD" "$RESET"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$BLUE$BOLD" "$RESET"

# ─────────────────────── 1. Node y npm ───────────────────────
step "1) Entorno de ejecución"

command -v node >/dev/null 2>&1 || die "Node.js no está instalado. Instalá Node 18 o superior."
command -v npm  >/dev/null 2>&1 || die "npm no está instalado."

NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
if (( NODE_MAJOR < 18 )); then
  die "Node $NODE_VERSION es demasiado viejo. El proyecto usa ESM y necesita Node 18+."
fi
ok "Node.js $NODE_VERSION"
ok "npm $(npm -v)"

# ─────────────────────── 2. Dependencias ───────────────────────
step "2) Dependencias de npm"

mapfile -t DEPS < <(node -e '
  const p = require("./package.json");
  console.log(Object.keys(p.dependencies || {}).join("\n"));
')
# Las devDependencies también hacen falta: sin typescript no se compila.
mapfile -t DEV_DEPS < <(node -e '
  const p = require("./package.json");
  console.log(Object.keys(p.devDependencies || {}).join("\n"));
')

MISSING_DEPS=()
for dep in "${DEPS[@]}" "${DEV_DEPS[@]}"; do
  [[ -d "node_modules/$dep" ]] || MISSING_DEPS+=("$dep")
done

if (( ${#MISSING_DEPS[@]} > 0 )); then
  warn "Faltan dependencias: ${MISSING_DEPS[*]}"
  info "Ejecutando npm install…"
  npm install --no-fund --no-audit || die "npm install falló."
  for dep in "${MISSING_DEPS[@]}"; do
    [[ -d "node_modules/$dep" ]] || die "La dependencia '$dep' sigue sin instalarse."
  done
fi

for dep in "${DEPS[@]}"; do
  ver="$(node -e "try{console.log(require('./node_modules/$dep/package.json').version)}catch{console.log('?')}")"
  ok "$dep@$ver"
done
TS_VER="$(node -e "try{console.log(require('./node_modules/typescript/package.json').version)}catch{console.log('?')}")"
ok "typescript@$TS_VER + ${#DEV_DEPS[@]} devDependencies (tipos y tsx)"

# ─────────────────────── 3. Archivo .env ───────────────────────
step "3) Variables de entorno (.env)"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    warn "No existía .env — lo creé a partir de .env.example"
    info "Editá .env y completá los valores reales antes de volver a correr ./run.sh"
    die "Falta configurar .env"
  else
    die "No existe .env ni .env.example. Creá un .env con: ${REQUIRED_VARS[*]}"
  fi
fi
ok ".env encontrado ($(realpath .env))"

# Carga y valida las variables con el mismo dotenv que usa la app.
ENV_REPORT="$(node --input-type=module -e '
import dotenv from "dotenv";
dotenv.config();

const required = ["MONGO_URI", "JWT_SECRET", "SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"];
const secret   = new Set(["JWT_SECRET", "SUPER_ADMIN_PASSWORD"]);
const faltantes = [];

const mask = (v) => v.length <= 4 ? "****" : v.slice(0, 2) + "*".repeat(Math.min(v.length - 4, 20)) + v.slice(-2);

for (const key of required) {
  const val = process.env[key];
  if (!val || !val.trim()) { faltantes.push(key); console.log(`MISSING\t${key}`); continue; }
  if (key === "MONGO_URI") {
    // Oculta la contraseña embebida en la URI, si la hay.
    console.log(`OK\t${key}\t${val.replace(/\/\/([^:@/]+):([^@]+)@/, "//$1:****@")}`);
  } else {
    console.log(`OK\t${key}\t${secret.has(key) ? mask(val) : val}`);
  }
}

const port = process.env.PORT || "4000";
console.log(`OK\tPORT\t${port}${process.env.PORT ? "" : " (por defecto)"}`);
console.log(`PORTVALUE\t${port}`);

// Opcionales: si no están, la app usa sus valores por defecto.
const entorno = process.env.NODE_ENV || "development (por defecto)";
console.log(`OK\tNODE_ENV\t${entorno}`);
const nivelLog = process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info (auto)" : "debug (auto)");
console.log(`OK\tLOG_LEVEL\t${nivelLog}`);

const frontend = process.env.FRONTEND_URL || "http://localhost:5173 (por defecto)";
console.log(`OK\tFRONTEND_URL\t${frontend}`);

const smtpOk = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
console.log(`OK\tSMTP\t${smtpOk ? process.env.SMTP_HOST : "sin configurar → los mails van a la consola"}`);

// Avisos de seguridad, no bloquean el arranque.
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32)
  console.log("WARN\tJWT_SECRET tiene menos de 32 caracteres, conviene uno más largo");
if (/cambiar/i.test(process.env.JWT_SECRET || ""))
  console.log("WARN\tJWT_SECRET todavía tiene el valor de ejemplo");
if (/cambiar/i.test(process.env.SUPER_ADMIN_PASSWORD || ""))
  console.log("WARN\tSUPER_ADMIN_PASSWORD todavía tiene el valor de ejemplo");

if (faltantes.length) process.exitCode = 1;
')" || true

ENV_ERRORS=0
PORT=4000
while IFS=$'\t' read -r status key value; do
  case "$status" in
    OK)        ok "$key = ${value}" ;;
    MISSING)   fail "$key no está definida o está vacía en .env"; ENV_ERRORS=1 ;;
    WARN)      warn "$key" ;;
    PORTVALUE) PORT="$key" ;;
  esac
done <<< "$ENV_REPORT"

(( ENV_ERRORS == 0 )) || die "Completá las variables faltantes en .env"

# ─────────────────────── 4. Conexión a MongoDB ───────────────────────
step "4) Conexión a MongoDB"

set +e
MONGO_REPORT="$(node --input-type=module -e '
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();

const t0 = Date.now();
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const conn = mongoose.connection;
  const admin = conn.db.admin();
  let version = "?";
  try { version = (await admin.serverStatus()).version; } catch {}
  const cols = await conn.db.listCollections().toArray();
  console.log(`HOST\t${conn.host}:${conn.port ?? ""}`);
  console.log(`DB\t${conn.name}`);
  console.log(`VERSION\t${version}`);
  console.log(`MS\t${Date.now() - t0}`);
  console.log(`COLS\t${cols.length ? cols.map(c => c.name).sort().join(", ") : "(base vacía, se crean al usarla)"}`);

  // Cuántos usuarios hay ya cargados (nos dice si el super_admin existe).
  if (cols.some(c => c.name === "usuarios")) {
    const total = await conn.db.collection("usuarios").countDocuments();
    const supers = await conn.db.collection("usuarios").countDocuments({ rol: "super_admin" });
    console.log(`USERS\t${total} usuario(s), ${supers} super_admin`);
  } else {
    console.log("USERS\tsin usuarios todavía — se creará el super_admin al arrancar");
  }
  await mongoose.disconnect();
} catch (e) {
  console.log(`ERROR\t${e.message}`);
  process.exit(1);
}
' 2>/dev/null)"
MONGO_STATUS=$?
set -e

if (( MONGO_STATUS != 0 )); then
  while IFS=$'\t' read -r k v; do
    [[ "$k" == "ERROR" ]] && fail "No se pudo conectar: $v"
  done <<< "$MONGO_REPORT"

  # Pista útil cuando la URI apunta a una Mongo local.
  if grep -qE 'MONGO_URI=.*(localhost|127\.0\.0\.1)' .env; then
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet mongod; then
      info "El servicio mongod está activo, pero la URI no responde. Revisá host/puerto/base en MONGO_URI."
    else
      info "Parece una MongoDB local que no está corriendo. Probá: sudo systemctl start mongod"
    fi
  else
    info "Revisá la MONGO_URI, el usuario/contraseña y que tu IP esté permitida (Atlas → Network Access)."
  fi
  die "MongoDB no está accesible"
fi

while IFS=$'\t' read -r k v; do
  case "$k" in
    HOST)    ok "Servidor: $v" ;;
    DB)      ok "Base de datos: $v" ;;
    VERSION) ok "MongoDB $v" ;;
    MS)      ok "Conexión establecida en ${v} ms" ;;
    COLS)    info "Colecciones: $v" ;;
    USERS)   info "Usuarios: $v" ;;
  esac
done <<< "$MONGO_REPORT"

# ─────────────────────── 5. Puerto libre ───────────────────────
step "5) Puerto $PORT"

if CHECK_PORT="$PORT" node --input-type=module -e "
import net from 'net';
const s = net.createServer();
s.once('error', e => process.exit(e.code === 'EADDRINUSE' ? 1 : 0));
s.once('listening', () => s.close(() => process.exit(0)));
s.listen(Number(process.env.CHECK_PORT), '0.0.0.0');
" 2>/dev/null; then
  ok "Puerto $PORT libre"
else
  fail "El puerto $PORT ya está ocupado por otro proceso"
  if command -v lsof >/dev/null 2>&1; then
    info "En uso por: $(lsof -ti tcp:"$PORT" | tr '\n' ' ')"
    info "Para liberarlo: kill \$(lsof -ti tcp:$PORT)"
  fi
  info "O cambiá PORT en .env"
  die "Puerto ocupado"
fi

# ─────────────────────── 6. TypeScript ───────────────────────
step "6) TypeScript"

if [[ "$MODE" == "dev" ]]; then
  # En modo dev arranca tsx, que ejecuta los .ts directo: no hace falta
  # compilar, pero igual verificamos los tipos para no arrancar con errores.
  info "Verificando tipos (tsc --noEmit)…"
  if npm run --silent typecheck 2>&1 | sed 's/^/      /'; then
    ok "Sin errores de tipos"
  else
    die "Hay errores de TypeScript (arriba el detalle)"
  fi
else
  info "Compilando src/ → dist/ (tsc)…"
  if npm run --silent build 2>&1 | sed 's/^/      /'; then
    ARCHIVOS_JS="$(find dist -name '*.js' 2>/dev/null | wc -l)"
    ok "Compilado: $ARCHIVOS_JS archivos en dist/"
  else
    die "La compilación falló (arriba el detalle)"
  fi
fi

if (( ONLY_CHECK == 1 )); then
  printf '\n%s✔ Todo listo. El servidor puede arrancar sin problemas.%s\n' "$GREEN$BOLD" "$RESET"
  exit 0
fi

# ─────────────────────── 7. Arranque del servidor ───────────────────────
step "7) Arrancando el servidor"

NPM_SCRIPT="start"
[[ "$MODE" == "dev" ]] && NPM_SCRIPT="dev"
info "npm run $NPM_SCRIPT  (log completo en $LOG_FILE)"

: > "$LOG_FILE"
npm run "$NPM_SCRIPT" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  trap - INT TERM EXIT
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    printf '\n%sDeteniendo el servidor…%s\n' "$YELLOW" "$RESET"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# Espera a que la raíz de la API conteste (máx ~20 s).
HEALTH=""
for _ in $(seq 1 40); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "El proceso del servidor murió durante el arranque:"
    printf '%s' "$DIM"; sed 's/^/      /' "$LOG_FILE"; printf '%s' "$RESET"
    die "Revisá el error de arriba"
  fi
  HEALTH="$(CHECK_PORT="$PORT" node -e "
    const p = process.env.CHECK_PORT;
    fetch('http://127.0.0.1:' + p + '/')
      .then(r => r.text())
      .then(t => { process.stdout.write(t); process.exit(0); })
      .catch(() => process.exit(1));
  " 2>/dev/null)" && break
  HEALTH=""
  sleep 0.5
done

if [[ -z "$HEALTH" ]]; then
  fail "El servidor no respondió en http://localhost:$PORT/ después de 20 s"
  printf '%s' "$DIM"; sed 's/^/      /' "$LOG_FILE"; printf '%s' "$RESET"
  die "Arranque fallido"
fi

ok "GET / responde: $HEALTH"

# Muestra lo que el servidor haya logueado (conexión a Mongo, super admin, puerto).
printf '%s' "$DIM"; sed 's/^/      /' "$LOG_FILE"; printf '%s' "$RESET"

printf '\n%s╔══════════════════════════════════════════════════════════╗%s\n' "$GREEN$BOLD" "$RESET"
printf '%s║   ✔ Todo funcionando                                      ║%s\n' "$GREEN$BOLD" "$RESET"
printf '%s╚══════════════════════════════════════════════════════════╝%s\n' "$GREEN$BOLD" "$RESET"
printf '\n'
printf '  API          %shttp://localhost:%s%s\n' "$BOLD" "$PORT" "$RESET"
printf '  Login        %sPOST http://localhost:%s/auth/login%s\n' "$BOLD" "$PORT" "$RESET"
printf '  Rutas        /auth  /usuarios  /clientes  /productos  /movimientos\n'
printf '  Log          %s\n' "$LOG_FILE"
printf '\n  %sCtrl+C para detener el servidor.%s\n\n' "$DIM" "$RESET"

# Deja el log en pantalla mientras el servidor sigue vivo.
tail -n 0 -f "$LOG_FILE" &
TAIL_PID=$!
wait "$SERVER_PID" || true
kill "$TAIL_PID" 2>/dev/null || true
