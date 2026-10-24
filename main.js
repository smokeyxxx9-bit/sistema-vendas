const { app, BrowserWindow, Menu, shell, protocol } = require("electron");
const path = require("path");
const fs = require("fs");

// Tela escura/em branco em alguns PCs vem da placa de vídeo: o sistema é só tabela e texto, então desenha por software.
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) { app.quit(); }

// Carrega o sistema como se fosse um site (app://oficina/), não como arquivo solto (file://),
// que é como ele sempre rodou (https): evita problemas de armazenamento, login e CORS.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const WEB = path.join(__dirname, "web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

const erros = [];
let win;

function logArquivo(txt) {
  try { fs.appendFileSync(path.join(app.getPath("userData"), "log.txt"), new Date().toISOString() + " " + txt + "\n"); } catch (e) {}
}

function mostrarErros(titulo) {
  if (!win || win.isDestroyed()) return;
  const msg = titulo + "\n\n" + (erros.length ? erros.slice(-12).join("\n\n") : "(nenhum erro registrado)");
  win.webContents.executeJavaScript(
    "(function(){var d=document.createElement('pre');d.style.cssText='position:fixed;inset:0;z-index:99999;margin:0;padding:24px;background:#111;color:#ffb4b4;font:14px Consolas,monospace;white-space:pre-wrap;overflow:auto';" +
    "d.textContent=" + JSON.stringify(msg + "\n\n(Tire um print desta tela e envie. F12 abre o console.)") + ";document.body.appendChild(d);})()"
  ).catch(() => {});
}

function criar() {
  protocol.handle("app", async (req) => {
    try {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/" || p === "") p = "/index.html";
      const f = path.normalize(path.join(WEB, p));
      if (!f.startsWith(WEB)) return new Response("negado", { status: 403 });
      const data = await fs.promises.readFile(f);
      return new Response(data, { headers: { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" } });
    } catch (e) {
      return new Response("não encontrado", { status: 404 });
    }
  });

  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: "#0d1117",
    title: "Painel de Vendas — Oficina",
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.maximize();

  const wc = win.webContents;
  wc.on("console-message", (e, level, message, line, source) => {
    if (level >= 2) { const t = message + "  (" + String(source).split("/").pop() + ":" + line + ")"; erros.push(t); logArquivo(t); }
  });
  wc.on("did-fail-load", (e, code, desc, url) => { erros.push("Falha ao carregar " + url + ": " + desc + " (" + code + ")"); logArquivo(erros[erros.length - 1]); });
  wc.on("render-process-gone", (e, d) => { erros.push("Processo da tela caiu: " + d.reason); logArquivo(erros[erros.length - 1]); });

  // se depois de alguns segundos a tela ainda estiver vazia/carregando, mostra o que deu errado
  wc.on("did-finish-load", () => {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      wc.executeJavaScript("(function(){var a=document.getElementById('app');return !a||!!a.querySelector('.app-skeleton')||a.innerText.trim().length===0;})()")
        .then((travado) => { if (travado) mostrarErros("A tela não terminou de carregar."); })
        .catch(() => {});
    }, 9000);
  });

  // F12 / Ctrl+Shift+I abre o console
  wc.on("before-input-event", (e, i) => {
    if (i.type === "keyDown" && (i.key === "F12" || (i.control && i.shift && i.key.toLowerCase() === "i"))) wc.toggleDevTools();
  });

  // links externos (WhatsApp etc.) abrem no navegador; janelas de impressão (nota/relatório) abrem normalmente
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 900, height: 700 } };
  });
  wc.on("will-navigate", (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.loadURL("app://oficina/index.html");
  win.on("closed", () => { win = null; });
}
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(criar);
app.on("window-all-closed", () => app.quit());
