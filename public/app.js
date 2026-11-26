// Renders everything with textContent, never innerHTML, so quote text can't inject markup.
const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  return fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
}

// Shows one of: "login" (with a step form), "library".
function showSection(id) {
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

function showLogin() {
  showSection("login");
  showStep("password");
}

async function init() {
  const res = await api("/api/session");
  const { authenticated } = await res.json();
  if (authenticated) {
    showSection("library");
    loadQuotes();
  } else {
    showLogin();
  }
}

$("#step-password").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/login/password", {
    method: "POST",
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  });
  if (res.ok) {
    e.target.reset();
    showStep("code");
  } else {
    $("#login-error").textContent = "Invalid username or password.";
  }
});

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
