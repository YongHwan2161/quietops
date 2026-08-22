const state = {
  items: [],
  selectedId: null,
  selected: null,
  busy: false,
  decisionMode: "public-read-only",
};

const inbox = document.querySelector("#inbox");
const detail = document.querySelector("#detail");
const refreshButton = document.querySelector("#refresh-button");
const attentionCount = document.querySelector("#attention-count");
const readyCount = document.querySelector("#ready-count");
const toast = document.querySelector("#toast");
const runtimeMode = document.querySelector("#runtime-mode");

refreshButton.addEventListener("click", () => void loadInbox(state.selectedId));

void loadInbox();

async function loadInbox(preferredId) {
  setBusy(true);
  try {
    const payload = await requestJson("/api/inbox");
    state.items = payload.items;
    state.decisionMode =
      payload.capabilities?.decisionMode === "local-interactive"
        ? "local-interactive"
        : "public-read-only";
    renderRuntimeMode();
    const preferredExists = state.items.some(
      (item) => item.evaluationId === preferredId,
    );
    state.selectedId = preferredExists
      ? preferredId
      : (state.items[0]?.evaluationId ?? null);
    renderSummary();
    renderInbox();
    if (state.selectedId) {
      await loadDetail(state.selectedId);
    } else {
      renderEmpty(
        "No evaluations yet",
        "Start a demo evaluation to populate the inbox.",
      );
    }
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

async function loadDetail(evaluationId) {
  state.selectedId = evaluationId;
  renderInbox();
  const payload = await requestJson(
    `/api/evaluations/${encodeURIComponent(evaluationId)}`,
  );
  state.selected = payload.evaluation;
  renderDetail();
}

function renderSummary() {
  attentionCount.textContent = String(
    state.items.filter((item) => item.attentionRequired).length,
  );
  readyCount.textContent = String(
    state.items.filter((item) => item.outcome === "Ready").length,
  );
}

function renderRuntimeMode() {
  runtimeMode.textContent =
    state.decisionMode === "local-interactive"
      ? "Local evidence mode · interactive"
      : "Public evidence demo · decisions locked";
}

function renderInbox() {
  inbox.replaceChildren();
  const attention = state.items.filter((item) => item.attentionRequired);
  const recent = state.items.filter((item) => !item.attentionRequired);

  addInboxSection("Needs attention", attention);
  addInboxSection("Recent history", recent);
}

function addInboxSection(label, items) {
  const heading = element("p", "inbox-section-label", label);
  inbox.append(heading);

  if (items.length === 0) {
    inbox.append(element("p", "inbox-section-label", "Nothing waiting"));
    return;
  }

  for (const item of items) {
    const button = element("button", "inbox-item");
    button.type = "button";
    button.setAttribute(
      "aria-current",
      String(item.evaluationId === state.selectedId),
    );
    button.addEventListener(
      "click",
      () => void selectEvaluation(item.evaluationId),
    );

    const dot = element(
      "span",
      item.attentionRequired ? "outcome-dot attention" : "outcome-dot",
    );
    dot.setAttribute("aria-hidden", "true");

    const copy = element("span", "item-copy");
    copy.append(
      element("span", "item-title", item.decision ?? item.outcome),
      element(
        "span",
        "item-meta",
        `${item.branch} · ${shortCommit(item.commit)}`,
      ),
    );

    button.append(
      dot,
      copy,
      element("time", "item-time", formatTime(item.createdAt)),
    );
    inbox.append(button);
  }
}

async function selectEvaluation(evaluationId) {
  if (state.busy || evaluationId === state.selectedId) return;
  setBusy(true);
  try {
    await loadDetail(evaluationId);
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function renderDetail() {
  const evaluation = state.selected;
  if (!evaluation) return;

  detail.replaceChildren();
  const header = element("header", "detail-header");
  const headingCopy = element("div");
  const displayOutcome = evaluation.decision?.decision ?? evaluation.outcome;
  const detailTitle = evaluation.decision
    ? "Human decision preserved"
    : evaluation.outcome === "Ready"
      ? "Release evidence aligned"
      : "Deployment identity drift";
  headingCopy.append(
    element(
      "span",
      evaluation.attentionRequired
        ? "outcome-badge attention"
        : "outcome-badge",
      displayOutcome,
    ),
    element("h2", "", detailTitle),
    element("p", "detail-subtitle", evaluation.reason),
  );
  header.append(
    headingCopy,
    element("code", "commit-chip", shortCommit(evaluation.candidate.commit)),
  );
  detail.append(header);

  if (evaluation.parentEvaluationId) {
    detail.append(renderParentLineage(evaluation.parentEvaluationId));
  }

  detail.append(renderEvidence(evaluation));

  if (evaluation.attentionRequired) {
    detail.append(renderDecisionCard(evaluation));
  } else if (evaluation.decision) {
    detail.append(renderDecisionReceipt(evaluation));
  }

  detail.append(renderTelemetry(evaluation));
}

function renderParentLineage(parentEvaluationId) {
  const section = element("section", "section lineage-banner");
  const copy = element("div");
  copy.append(
    element("p", "eyebrow", "RE-CHECK LINEAGE"),
    element("strong", "", "This evaluation preserves its parent decision."),
  );
  const link = element(
    "button",
    "lineage-link lineage-button",
    "View parent record",
  );
  link.type = "button";
  link.addEventListener(
    "click",
    () => void selectEvaluation(parentEvaluationId),
  );
  section.append(copy, link);
  return section;
}

function renderEvidence(evaluation) {
  const section = element("section", "section");
  const heading = element("div", "section-heading");
  heading.append(
    element("h3", "", "Expected vs observed"),
    element("span", "", `${evaluation.evidence.length} persisted records`),
  );
  section.append(heading);

  const list = element("div", "evidence-list");
  for (const observation of evaluation.evidence) {
    const expected = expectedValue(evaluation, observation.kind);
    const matches = expected === observation.value;
    const row = element("article", "evidence-row");
    row.append(
      element("strong", "evidence-kind", observation.kind),
      valueBlock("Expected", expected),
      valueBlock("Observed", observation.value),
      element(
        "span",
        matches ? "evidence-state" : "evidence-state mismatch",
        matches ? "✓" : "!",
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderDecisionCard(evaluation) {
  const section = element("section", "section");
  const card = element("div", "decision-card");

  if (state.decisionMode === "public-read-only") {
    card.append(
      element("p", "eyebrow", "PUBLIC DEMO · READ ONLY"),
      element("h3", "", "A human decision is required"),
      element(
        "p",
        "",
        "QuietOps found deployment drift, but this shared public view cannot change the preserved judge record.",
      ),
      element(
        "div",
        "demo-boundary",
        "Reject and Re-check remain available in the local interactive workflow.",
      ),
    );
    section.append(card);
    return section;
  }

  card.append(
    element("p", "eyebrow", "HUMAN CHECKPOINT"),
    element("h3", "", "The safe path needs your call"),
    element(
      "p",
      "",
      "QuietOps stopped at evidence drift. Reject this candidate or ask the agent to collect a fresh, linked evaluation.",
    ),
  );

  const note = element("textarea");
  note.id = "decision-note";
  note.maxLength = 500;
  note.placeholder = "Optional decision note";
  note.setAttribute("aria-label", "Decision note");
  card.append(note);

  const actions = element("div", "decision-actions");
  const recheck = actionButton(
    "Re-check with fresh evidence",
    "Re-check requested",
    false,
  );
  const reject = actionButton("Reject candidate", "Reject", true);
  actions.append(recheck, reject);
  card.append(actions);
  section.append(card);
  return section;

  function actionButton(label, decision, secondary) {
    const button = element(
      "button",
      secondary ? "action-button secondary" : "action-button",
      label,
    );
    button.type = "button";
    button.addEventListener(
      "click",
      () => void submitDecision(evaluation.evaluationId, decision, note.value),
    );
    return button;
  }
}

function renderDecisionReceipt(evaluation) {
  const section = element("section", "section");
  const receipt = element("div", "decision-receipt");
  receipt.append(
    element("p", "eyebrow", "PERSISTED DECISION"),
    element("strong", "", evaluation.decision.decision),
  );

  const grid = element("div", "receipt-grid");
  grid.append(
    receiptField("Actor", evaluation.decision.actor),
    receiptField("Recorded", formatDate(evaluation.decision.recordedAt)),
    receiptField(
      "Decision event",
      evaluation.timeline.at(-1)?.eventId ?? "Unavailable",
    ),
  );

  if (evaluation.decision.childEvaluationId) {
    const field = element("div", "receipt-field");
    field.append(element("span", "", "Child evaluation"));
    const link = element(
      "button",
      "lineage-link",
      evaluation.decision.childEvaluationId,
    );
    link.type = "button";
    link.addEventListener(
      "click",
      () => void selectEvaluation(evaluation.decision.childEvaluationId),
    );
    field.append(link);
    grid.append(field);
  }

  if (evaluation.parentEvaluationId) {
    const field = element("div", "receipt-field");
    field.append(element("span", "", "Parent evaluation"));
    const link = element(
      "button",
      "lineage-link",
      evaluation.parentEvaluationId,
    );
    link.type = "button";
    link.addEventListener(
      "click",
      () => void selectEvaluation(evaluation.parentEvaluationId),
    );
    field.append(link);
    grid.append(field);
  }

  receipt.append(grid);
  section.append(receipt);
  return section;
}

function renderTelemetry(evaluation) {
  const section = element("section", "section");
  const heading = element("div", "section-heading");
  heading.append(
    element("h3", "", "Agent tool receipts"),
    element("span", "", `${evaluation.externalMutations} external mutations`),
  );
  section.append(heading);

  const grid = element("div", "telemetry-grid");
  for (const call of evaluation.toolCalls) {
    const item = element("article", "telemetry-item");
    item.append(
      element("strong", "", call.toolName),
      element("code", "", call.evidenceId),
    );
    grid.append(item);
  }
  section.append(grid);
  return section;
}

async function submitDecision(evaluationId, decision, note) {
  if (state.decisionMode !== "local-interactive") {
    showToast("This public demo does not accept decisions.", true);
    return;
  }
  if (state.busy) return;
  setBusy(true);
  try {
    const payload = await requestJson(
      `/api/evaluations/${encodeURIComponent(evaluationId)}/decisions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `browser:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          decision,
          actor: "local-reviewer",
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      },
    );
    const nextId = payload.receipt.childEvaluationId ?? evaluationId;
    showToast(
      payload.receipt.childEvaluationId
        ? "Decision persisted. Fresh child evaluation linked."
        : "Decision persisted in the append-only timeline.",
    );
    await loadInbox(nextId);
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Request failed with ${response.status}.`,
    );
  }
  return payload;
}

function setBusy(busy) {
  state.busy = busy;
  refreshButton.disabled = busy;
  for (const button of document.querySelectorAll(
    ".action-button, .inbox-item",
  )) {
    button.disabled = busy;
  }
}

function expectedValue(evaluation, kind) {
  if (kind === "CI status") return "success";
  return evaluation.candidate.commit;
}

function valueBlock(label, value) {
  const block = element("div", "evidence-value");
  block.append(element("span", "", label), element("code", "", value));
  block.title = value;
  return block;
}

function receiptField(label, value) {
  const field = element("div", "receipt-field");
  field.append(element("span", "", label), element("code", "", value));
  return field;
}

function renderEmpty(title, message) {
  detail.replaceChildren();
  const empty = element("div", "empty-state");
  empty.append(
    element("span", "empty-mark", "✓"),
    element("h2", "", title),
    element("p", "", message),
  );
  detail.append(empty);
}

function renderError(error) {
  detail.replaceChildren();
  const panel = element("div", "error-state");
  panel.append(
    element("span", "empty-mark", "!"),
    element("h2", "", "Evidence could not be loaded"),
    element("p", "", errorMessage(error)),
  );
  detail.append(panel);
  showToast(errorMessage(error), true);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? "toast visible error" : "toast visible";
  window.setTimeout(() => {
    toast.className = "toast";
  }, 4_000);
}

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function shortCommit(value) {
  return value.slice(0, 8);
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
