// Renders everything with textContent, never innerHTML, so quote text can't inject markup.
const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return res;
}

function showSection(id) {
  for (const el of ["login", "library"]) $("#" + el).hidden = el !== id;
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
  if (res.status === 401) return showSection("login");
  const { quotes } = await res.json();
  const list = $("#quotes");
  list.replaceChildren(...quotes.map(renderQuote));
}

async function init() {
  const res = await api("/api/session");
  const { authenticated } = await res.json();
  if (authenticated) {
    showSection("library");
    loadQuotes();
  } else {
    showSection("login");
  }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: form.get("password"), code: form.get("code") }),
  });
  if (res.ok) {
    e.target.reset();
    $("#login-error").textContent = "";
    showSection("library");
    loadQuotes();
  } else {
    $("#login-error").textContent = "Invalid password or code.";
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showSection("login");
});

$("#search").addEventListener("input", () => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(loadQuotes, 250);
});

init();
