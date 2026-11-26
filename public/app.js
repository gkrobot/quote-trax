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

// Tabs inside the signed-in app.
function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) tab.hidden = tab.id !== `tab-${name}`;
  for (const btn of document.querySelectorAll(".tab-button")) {
    btn.setAttribute("aria-current", btn.dataset.tab === name ? "page" : "false");
  }
  if (name === "library") loadQuotes();
  if (name === "stats") loadStats();
  if (name === "add") loadSelects();
  if (name === "manage") loadManage();
}

document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

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

  const actions = el("p", { className: "actions" });
  actions.append(
    actionButton("Edit", () => openQuoteEditor(article, q)),
    actionButton("Delete", () => deleteItem(`/api/quotes/${q.id}`, "Delete this quote?", loadQuotes)),
  );
  article.appendChild(actions);
  return article;
}

// Quotes arrive ordered by series, book position, then title. Insert a heading
// whenever the series or book changes.
function groupQuotes(quotes) {
  const nodes = [];
  let seriesName = null;
  let bookId = null;
  for (const q of quotes) {
    const name = q.series_name || "Standalone";
    if (name !== seriesName) {
      seriesName = name;
      bookId = null;
      const h = document.createElement("h2");
      h.textContent = name;
      nodes.push(h);
    }
    if (q.book_id !== bookId) {
      bookId = q.book_id;
      const h = document.createElement("h3");
      h.textContent = q.book_title;
      nodes.push(h);
    }
    nodes.push(renderQuote(q));
  }
  return nodes;
}

// Sort orders. "series" keeps the server's order and shows series and book headings.
const SORTS = {
  series: null,
  newest: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
  oldest: (a, b) => (a.created_at || "").localeCompare(b.created_at || ""),
  author: (a, b) =>
    (a.author || "").localeCompare(b.author || "") ||
    a.book_title.localeCompare(b.book_title) ||
    (a.created_at || "").localeCompare(b.created_at || ""),
  book: (a, b) => a.book_title.localeCompare(b.book_title) || (a.created_at || "").localeCompare(b.created_at || ""),
};

// The search runs on the server. Sorting and filtering run here, on the loaded quotes.
let libraryQuotes = [];

async function loadQuotes() {
  const params = new URLSearchParams();
  const search = $("#search").value.trim();
  if (search) params.set("q", search);
  const res = await api("/api/quotes?" + params.toString());
  if (res.status === 401) return showLogin();
  const { quotes } = await res.json();
  libraryQuotes = quotes;
  renderLibrary();
}

// Fills a <select> with [value, label] pairs, keeping the current choice when it still exists.
function fillSelect(select, options) {
  const previous = select.value;
  select.replaceChildren(
    ...options.map(([value, label]) => el("option", { value, textContent: label })),
  );
  select.value = options.some(([value]) => value === previous) ? previous : "";
}

function renderLibrary() {
  const seriesMap = new Map();
  for (const q of libraryQuotes) {
    const key = q.series_id || "none";
    seriesMap.set(key, q.series_name || "Standalone");
  }
  const seriesOptions = [...seriesMap].sort((a, b) => a[1].localeCompare(b[1]));
  fillSelect($("#filter-series"), [["", "All series"], ...seriesOptions]);
  const series = $("#filter-series").value;

  const inSeries = libraryQuotes.filter((q) => matchesSeries(q, series));
  const bookMap = new Map();
  for (const q of inSeries) bookMap.set(q.book_id, q.book_title);
  const bookOptions = [...bookMap].sort((a, b) => a[1].localeCompare(b[1]));
  fillSelect($("#filter-book"), [["", "All books"], ...bookOptions]);
  const book = $("#filter-book").value;

  const sort = $("#sort").value;
  const filtered = inSeries.filter((q) => !book || q.book_id === book);
  const compare = SORTS[sort];
  const ordered = compare ? [...filtered].sort(compare) : filtered;

  const count = ordered.length;
  $("#quote-count").textContent =
    libraryQuotes.length === 0 ? "" : `${count} of ${libraryQuotes.length} quote${libraryQuotes.length === 1 ? "" : "s"}`;
  if (count === 0) {
    const empty = el("p", { className: "hint", textContent: libraryQuotes.length ? "No quotes match these filters." : "No quotes yet." });
    $("#quotes").replaceChildren(empty);
    return;
  }
  $("#quotes").replaceChildren(...(compare ? ordered.map(renderQuote) : groupQuotes(ordered)));
}

function matchesSeries(q, series) {
  if (!series) return true;
  if (series === "none") return !q.series_id;
  return q.series_id === series;
}

$("#sort").addEventListener("change", renderLibrary);
$("#filter-series").addEventListener("change", () => {
  $("#filter-book").value = "";
  renderLibrary();
});
$("#filter-book").addEventListener("change", renderLibrary);
$("#filter-clear").addEventListener("click", () => {
  $("#sort").value = "series";
  $("#filter-series").value = "";
  $("#filter-book").value = "";
  renderLibrary();
});

// Small DOM helpers. Values are set as properties, never as HTML.
function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

function actionButton(label, onClick) {
  const b = el("button", { type: "button", textContent: label });
  b.addEventListener("click", onClick);
  return b;
}

function field(labelText, control) {
  const l = el("label");
  l.append(labelText, control);
  return l;
}

// Sends a change and reports the outcome. Errors from the server are shown in an alert.
async function saveJson(method, path, payload, onDone) {
  const res = await api(path, { method, body: JSON.stringify(payload) });
  if (res.status === 401) return showLogin();
  if (res.ok) return onDone();
  const body = await res.json().catch(() => ({}));
  alert(body.error || "Couldn't save. Try again.");
}

async function deleteItem(path, message, onDone) {
  if (!confirm(message)) return;
  const res = await api(path, { method: "DELETE" });
  if (res.status === 401) return showLogin();
  if (res.ok) return onDone();
  const body = await res.json().catch(() => ({}));
  alert(body.error || "Couldn't delete. Try again.");
}

// Replaces a quote's card with an edit form. Saving reloads the library.
async function openQuoteEditor(article, q) {
  const res = await api("/api/books");
  if (res.status === 401) return showLogin();
  const { books } = await res.json();

  const bookSelect = el("select");
  for (const b of books) {
    bookSelect.append(el("option", { value: b.id, textContent: b.series_name ? `${b.title} (${b.series_name})` : b.title }));
  }
  bookSelect.value = q.book_id;
  const text = el("textarea", { value: q.text, rows: 6 });
  const page = el("input", { value: q.page || "", maxLength: 20 });
  const attribution = el("input", { value: q.attribution || "", maxLength: 300 });
  const form = el("form", { className: "inline-edit" });
  form.append(
    field("Book", bookSelect),
    field("Quote", text),
    field("Page", page),
    field("Attribution", attribution),
  );
  const save = el("button", { type: "submit", textContent: "Save" });
  form.append(save, actionButton("Cancel", loadQuotes));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveJson(
      "PUT",
      `/api/quotes/${q.id}`,
      { bookId: bookSelect.value, text: text.value, page: page.value, attribution: attribution.value },
      loadQuotes,
    );
  });
  article.replaceChildren(form);
}

// Manage tab: rename or delete series, and edit or delete books.
async function loadManage() {
  const [seriesRes, booksRes] = await Promise.all([api("/api/series"), api("/api/books")]);
  if (seriesRes.status === 401 || booksRes.status === 401) return showLogin();
  const { series } = await seriesRes.json();
  const { books } = await booksRes.json();
  $("#manage-series").replaceChildren(...series.map((s) => seriesRow(s)));
  $("#manage-books").replaceChildren(...books.map((b) => bookRow(b, series)));
}

function seriesRow(s) {
  const li = el("li", { className: "row-item" });
  const name = el("input", { value: s.name, maxLength: 120, "aria-label": "Series name" });
  li.append(
    name,
    actionButton("Save", () => saveJson("PUT", `/api/series/${s.id}`, { name: name.value }, loadManage)),
    actionButton("Delete", () =>
      deleteItem(`/api/series/${s.id}`, "Delete this series? Its books stay, but become standalone.", loadManage),
    ),
  );
  return li;
}

function bookRow(b, series) {
  const li = el("li", { className: "row-item" });
  const title = el("input", { value: b.title, maxLength: 300, "aria-label": "Title" });
  const author = el("input", { value: b.author, maxLength: 300, "aria-label": "Author" });
  const seriesSelect = el("select", { "aria-label": "Series" });
  seriesSelect.append(el("option", { value: "", textContent: "No series" }));
  for (const s of series) seriesSelect.append(el("option", { value: s.id, textContent: s.name }));
  seriesSelect.value = b.series_id || "";
  const position = el("input", {
    type: "number",
    min: 0,
    max: 9999,
    value: b.series_position ?? "",
    "aria-label": "Position in series",
  });
  li.append(
    title,
    author,
    seriesSelect,
    position,
    actionButton("Save", () =>
      saveJson(
        "PUT",
        `/api/books/${b.id}`,
        {
          title: title.value,
          author: author.value,
          seriesId: seriesSelect.value || null,
          seriesPosition: position.value || null,
        },
        loadManage,
      ),
    ),
    actionButton("Delete", () => deleteItem(`/api/books/${b.id}`, "Delete this book?", loadManage)),
  );
  return li;
}

// Stats tab
function statRow(label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value ?? 0;
  return [dt, dd];
}

function listItem(text, count) {
  const li = document.createElement("li");
  li.textContent = `${text} — ${count}`;
  return li;
}

async function loadStats() {
  const res = await api("/api/stats");
  if (res.status === 401) return showLogin();
  const { totals, bySeries, byBook } = await res.json();

  $("#stats-totals").replaceChildren(
    ...statRow("Quotes", totals.quotes),
    ...statRow("Books", totals.books),
    ...statRow("Books with quotes", totals.booksWithQuotes),
    ...statRow("Series", totals.series),
    ...statRow("Authors", totals.authors),
    ...statRow("Last added", totals.lastAdded ? totals.lastAdded.slice(0, 10) : "—"),
  );
  $("#stats-series").replaceChildren(...bySeries.map((s) => listItem(s.name, s.quotes)));
  $("#stats-books").replaceChildren(
    ...byBook.map((b) => listItem(b.series ? `${b.title} (${b.series})` : b.title, b.quotes)),
  );
}

// Add tab: fills the book and series dropdowns from the server.
async function loadSelects() {
  const [booksRes, seriesRes] = await Promise.all([api("/api/books"), api("/api/series")]);
  if (booksRes.status === 401) return showLogin();
  const { books } = await booksRes.json();
  const { series } = await seriesRes.json();

  const quoteBook = $("#quote-book");
  const previousBook = quoteBook.value;
  quoteBook.replaceChildren(
    ...books.map((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.series_name ? `${b.title} (${b.series_name})` : b.title;
      return opt;
    }),
  );
  if (previousBook) quoteBook.value = previousBook;

  const bookSeries = $("#book-series");
  const previousSeries = bookSeries.value;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No series";
  bookSeries.replaceChildren(
    none,
    ...series.map((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      return opt;
    }),
  );
  bookSeries.value = previousSeries;
}

// Shared submit for the three add forms. Returns true on success.
async function postJson(path, payload, statusEl) {
  statusEl.textContent = "Saving...";
  const res = await api(path, { method: "POST", body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    statusEl.textContent = "Saved.";
    return true;
  }
  if (res.status === 401) {
    showLogin();
    return false;
  }
  statusEl.textContent = body.error || "Couldn't save. Try again.";
  return false;
}

$("#form-quote").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await postJson(
    "/api/quotes",
    {
      bookId: $("#quote-book").value,
      text: $("#quote-text").value,
      page: $("#quote-page").value,
      attribution: $("#quote-attribution").value,
    },
    $("#quote-status"),
  );
  if (ok) {
    $("#quote-text").value = "";
    $("#quote-page").value = "";
    $("#quote-attribution").value = "";
  }
});

$("#form-book").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await postJson(
    "/api/books",
    {
      title: $("#book-title").value,
      author: $("#book-author").value,
      seriesId: $("#book-series").value || null,
      seriesPosition: $("#book-position").value || null,
    },
    $("#book-status"),
  );
  if (ok) {
    e.target.reset();
    loadSelects();
  }
});

$("#form-series").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await postJson("/api/series", { name: $("#series-name").value }, $("#series-status"));
  if (ok) {
    e.target.reset();
    loadSelects();
  }
});

// Sends parsed export data to the Worker and reports the result.
async function importData(data) {
  $("#import-status").textContent = "Importing...";
  const res = await api("/api/import", { method: "POST", body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    let msg = `Imported ${body.quotes} quotes, ${body.books} books, ${body.series} series.`;
    if (body.skipped) msg += ` Skipped ${body.skipped} quotes with unknown books.`;
    $("#import-status").textContent = msg;
    return true;
  }
  if (res.status === 401) {
    showLogin();
  } else {
    $("#import-status").textContent = body.error || "Import failed.";
  }
  return false;
}

function parseExport(text) {
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: "That isn't valid JSON. Check that the whole export was copied." };
  }
}

$("#import-paste").addEventListener("click", async () => {
  const text = $("#import-text").value.trim();
  if (!text) {
    $("#import-status").textContent = "Paste the export JSON first.";
    return;
  }
  const parsed = parseExport(text);
  if (parsed.error) {
    $("#import-status").textContent = parsed.error;
    return;
  }
  if (await importData(parsed.data)) $("#import-text").value = "";
});

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const parsed = parseExport(await file.text());
  if (parsed.error) {
    $("#import-status").textContent = parsed.error;
  } else {
    await importData(parsed.data);
  }
  e.target.value = "";
});

async function fetchExportText() {
  const res = await api("/api/export");
  if (res.status === 401) {
    showLogin();
    return null;
  }
  const data = await res.json();
  return JSON.stringify(data, null, 2);
}

$("#export-copy").addEventListener("click", async () => {
  const text = await fetchExportText();
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    $("#import-status").textContent = "Export copied to the clipboard.";
  } catch {
    $("#import-status").textContent = "Couldn't copy automatically. Use Download file instead.";
  }
});

$("#export-download").addEventListener("click", async () => {
  const text = await fetchExportText();
  if (text === null) return;
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `quote-trax-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("#import-status").textContent = "Export downloaded.";
});

async function init() {
  const statusRes = await api("/api/setup/status");
  const { needsSetup } = await statusRes.json();
  if (needsSetup) return showSetup();

  const res = await api("/api/session");
  const { authenticated } = await res.json();
  if (authenticated) {
    showSection("library");
    showTab("library");
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
  // Move to the code field now, during the tap. iOS Safari only opens the keyboard
  // for focus set inside a tap, not after the server replies. If the password is
  // wrong, the password step comes back below.
  showStep("code");
  const res = await api("/api/login/password", {
    method: "POST",
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  });
  if (res.status === 409) return init();
  if (res.ok) {
    e.target.reset();
  } else {
    $("#step-code").hidden = true;
    $("#step-password").hidden = false;
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
    showTab("library");
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
