// Shared logging utilities

let logElement: HTMLPreElement | null = null;
let statusElement: HTMLDivElement | null = null;

export function initLogger(logEl: HTMLPreElement, statusEl: HTMLDivElement) {
  logElement = logEl;
  statusElement = statusEl;
}

export function write(obj: unknown) {
  if (!logElement) return;
  const msg = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  logElement.textContent = `${new Date().toISOString()}\n${msg}\n\n` + logElement.textContent;
}

export function setStatus(text: string, ok: boolean) {
  if (!statusElement) return;
  statusElement.innerHTML = `<span class="${ok ? "ok" : "bad"}">${text}</span>`;
}

export function clearLog() {
  if (logElement) {
    logElement.textContent = "";
  }
}
