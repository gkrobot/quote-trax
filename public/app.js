// Renders everything with textContent, never innerHTML, so quote text can't inject markup.
const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  return fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
}

// Shows one of: "setup", "login", "library".
function showSection(id) {
  $("#setup").hidden = id !== "setup";
  $("#login").hidden = id !== "login";
  $("#library").hidden = id !== "library";
}

function showStep(id) {
  $("#step-password").hidden = id !== "password";
  $("#step-code").hidden = id !== "code";
  $("#login-error").textContent = "";
  if (id === "password") $("#step-password").reset();
  if (id === "code") $("#step-code").querySelector("input").focus();
}

function showLogin() {
  showSection("login");
  showStep("password");
}

function showSetup() {
  showSection("setup");
  $("#setup-start").hidden = false;
  $("#setup-key-step").hidden = true;
  $("#setup-error").textContent = "";
}

function renderQuote(q) {
  const article = document.createElement("article");
  article.className = "quote";

  // Blank lines start a new paragraph. Single line breaks are kept via CSS (pre-line).
  for (const para of q.text.split(/\n{2,}/)) {
    const p = document.createElement("p");
    p.textContent = para;
    article.appendChild(p);
  }

  const cite = document.createElement("footer");
  const parts = [q.attribution, q.book_title, q.series_name, q.page ? `p. ${q.page}` : null];
  cite.textContent = parts.filter(Boolean).join(" · ");
  article.appendChild(cite);
  return article;
}

async function loadQuotes() {
  const params = new URLSearchParams();
  const search = $("#search").value.trim();
  if (search) params.set("q", search);
  const res = await api("/api/quotes?" + params.toString());
  if (res.status === 401) return showLogin();
  const { quotes } = await res.json();
  $("#quotes").replaceChildren(...quotes.map(renderQuote));
}

async function init() {
  const statusRes = await api("/api/setup/status");
  const { needsSetup } = await statusRes.json();
  if (needsSetup) return showSetup();

  const res = await api("/api/session");
  const { authenticated } = await res.json();
  if (authenticated) {
    showSection("library");
    loadQuotes();
  } else {
    showLogin();
  }
}

// Setup, step 1
$("#setup-start").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/setup/start", {
    method: "POST",
    body: JSON.stringify({
      username: form.get("username"),
      password: form.get("password"),
      setupToken: form.get("setupToken"),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("#setup-error").textContent = body.error || "Setup failed.";
    return;
  }
  $("#setup-error").textContent = "";
  $("#setup-key").textContent = body.key;
  $("#setup-start").hidden = true;
  $("#setup-key-step").hidden = false;
  e.target.reset();
});

// Setup, step 2
$("#setup-confirm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/setup/confirm", {
    method: "POST",
    body: JSON.stringify({ code: form.get("code") }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    e.target.reset();
    $("#setup-key").textContent = "";
    showLogin();
    $("#login-error").textContent = "Setup complete. Sign in to continue.";
    return;
  }
  if (body.error === "setup expired; start again" || res.status === 404) {
    showSetup();
    $("#setup-error").textContent = body.error === "not found" ? "Setup is already complete." : "Setup expired. Start again.";
    return;
  }
  $("#setup-error").textContent = "Invalid code. Try again.";
});

// Login, step 1
$("#step-password").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/login/password", {
    method: "POST",
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  });
  if (res.status === 409) return init();
  if (res.ok) {
    e.target.reset();
    showStep("code");
  } else {
    $("#login-error").textContent = "Invalid username or password.";
  }
});

// Login, step 2
$("#step-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/login/code", {
    method: "POST",
    body: JSON.stringify({ code: form.get("code") }),
  });
  if (res.ok) {
    e.target.reset();
    showSection("library");
    loadQuotes();
    return;
  }
  const { error } = await res.json().catch(() => ({ error: "" }));
  // A lockout or missing step-one cookie means starting over.
  if (res.status === 401 && error !== "invalid code") {
    showLogin();
    $("#login-error").textContent = error;
  } else {
    $("#login-error").textContent = "Invalid code. Try again.";
  }
});

$("#back").addEventListener("click", () => showStep("password"));

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});

$("#search").addEventListener("input", () => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(loadQuotes, 250);
});

init();
