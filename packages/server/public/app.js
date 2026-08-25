const state = {
  runs: [],
  selectedId: null,
  selected: null,
  capabilities: null,
  detailCapabilities: null,
  busy: false,
  pollTimer: null,
  listFingerprint: null,
  detailFingerprint: null,
};

const runList = document.querySelector("#run-list");
const runDetail = document.querySelector("#run-detail");
const refreshButton = document.querySelector("#refresh-button");
const runtimeMode = document.querySelector("#runtime-mode");
const toast = document.querySelector("#toast");
const observationCount = document.querySelector("#observation-count");
const waitCount = document.querySelector("#wait-count");
const promptCount = document.querySelector("#prompt-count");
const writeCount = document.querySelector("#write-count");
const releaseProofStatus = document.querySelector("#release-proof-status");
const releaseRepository = document.querySelector("#release-repository");
const releaseCommit = document.querySelector("#release-commit");

refreshButton.addEventListener("click", () => void loadRuns(state.selectedId));
window.addEventListener("beforeunload", clearPoll);

void loadReleaseMarker();
void loadRuns();

async function loadRuns(preferredId, options = {}) {
  clearPoll();
  if (!options.silent) setBusy(true);
  try {
    const payload = await requestJson("/api/release-runs");
    const listFingerprint = JSON.stringify(payload.items);
    const listChanged = listFingerprint !== state.listFingerprint;
    state.runs = payload.items;
    state.capabilities = payload.capabilities;
    state.listFingerprint = listFingerprint;
    const preferredExists = state.runs.some((run) => run.runId === preferredId);
    state.selectedId = preferredExists
      ? preferredId
      : (state.runs.find((run) => run.attentionRequired)?.runId ??
        state.runs[0]?.runId ??
        null);
    if (listChanged) {
      renderRuntimeMode();
      renderRunList();
    }
    if (state.selectedId) {
      await loadDetail(state.selectedId);
    } else {
      renderEmpty(
        "No release runs yet",
        "A signed release event will appear here.",
      );
    }
  } catch (error) {
    renderError(error);
  } finally {
    if (!options.silent) setBusy(false);
    schedulePoll();
  }
}

async function loadDetail(runId) {
  const payload = await requestJson(
    `/api/release-runs/${encodeURIComponent(runId)}`,
  );
  if (state.selectedId !== runId) return;
  const detailFingerprint = JSON.stringify(payload);
  if (detailFingerprint === state.detailFingerprint) return;
  state.selected = payload.run;
  state.detailCapabilities = payload.capabilities;
  state.detailFingerprint = detailFingerprint;
  renderMetrics();
  renderRunList();
  renderDetail();
}

async function selectRun(runId) {
  if (state.busy || runId === state.selectedId) return;
  clearPoll();
  state.selectedId = runId;
  state.selected = null;
  state.detailFingerprint = null;
  renderRunList();
  setBusy(true);
  try {
    await loadDetail(runId);
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
    schedulePoll();
  }
}

function renderRuntimeMode() {
  const liveCount = state.runs.filter(
    (run) => run.evidenceMode === "live",
  ).length;
  runtimeMode.textContent =
    liveCount > 0
      ? `${liveCount} live run${liveCount === 1 ? "" : "s"} · polling active work`
      : "Preserved walkthrough · shared state stays read-only";
}

function renderMetrics() {
  const run = state.selected;
  for (const [node, value] of [
    [observationCount, run?.observationCount],
    [waitCount, run?.waitCount],
    [promptCount, run?.humanPromptCount],
    [writeCount, run?.externalWriteAttemptCount],
  ]) {
    node.textContent = Number.isInteger(value) ? String(value) : "—";
  }
}

function renderRunList() {
  runList.replaceChildren();
  addRunGroup(
    "Needs your judgment",
    state.runs.filter((run) => run.attentionRequired),
    "No release currently needs human context.",
  );
  addRunGroup(
    "Quietly handled · history",
    state.runs.filter((run) => !run.attentionRequired),
    "Completed and stopped runs will remain here.",
  );
}

function addRunGroup(label, runs, emptyMessage) {
  runList.append(element("p", "run-group-label", label));
  if (runs.length === 0) {
    runList.append(element("p", "run-group-empty", emptyMessage));
    return;
  }
  for (const run of runs) {
    const button = element("button", "run-item");
    button.type = "button";
    button.setAttribute("aria-current", String(run.runId === state.selectedId));
    button.setAttribute(
      "aria-label",
      `${run.headline}. ${run.attentionRequired ? "Needs your judgment" : "No judgment needed"}.`,
    );
    button.addEventListener("click", () => void selectRun(run.runId));

    const top = element("span", "run-item-top");
    top.append(
      element(
        "span",
        run.attentionRequired ? "state-pill attention" : "state-pill",
        stateLabel(run.state),
      ),
      element(
        "span",
        "evidence-label",
        run.evidenceMode === "preserved-demo" ? "Preserved demo" : "Live run",
      ),
    );
    button.append(
      top,
      element("strong", "run-item-title", run.headline),
      element(
        "span",
        "run-item-meta",
        `${shortCommit(run.candidateCommit)} · ${run.observationCount} observations · ${run.humanPromptCount} prompts`,
      ),
    );
    runList.append(button);
  }
}

function renderDetail() {
  const run = state.selected;
  if (!run) return;
  runDetail.replaceChildren();
  runDetail.setAttribute("aria-busy", "false");

  const header = element("header", "detail-header");
  const heading = element("div");
  heading.append(
    element(
      "p",
      "eyebrow record-context",
      run.evidenceMode === "preserved-demo" ? "PRESERVED DEMO RUN" : "LIVE RUN",
    ),
    element(
      "span",
      run.attentionRequired ? "state-pill attention" : "state-pill",
      stateLabel(run.state),
    ),
    element("h2", "", run.headline),
    element("p", "detail-subtitle", run.summary),
  );
  const commit = element(
    "code",
    "commit-chip",
    shortCommit(run.candidateCommit),
  );
  commit.title = run.candidateCommit;
  header.append(heading, commit);
  runDetail.append(header, renderHandledWork(run));

  if (run.decision) runDetail.append(renderDecision(run));
  if (run.action) runDetail.append(renderAction(run.action));
  runDetail.append(renderTimeline(run.timeline), renderReceipts(run.receipts));
}

function renderHandledWork(run) {
  const section = element("section", "detail-section handled-work");
  const heading = element("div", "section-heading");
  heading.append(
    element("h3", "", "What QuietOps handled"),
    element("span", "", `${formatDuration(run.measuredWaitMs)} measured wait`),
  );
  const grid = element("div", "handled-grid");
  for (const [value, label] of [
    [run.observationCount, "evidence observations"],
    [run.waitCount, "policy waits"],
    [run.humanPromptCount, "human prompts"],
    [run.externalWriteAttemptCount, "external write attempts"],
  ]) {
    const item = element("div", "handled-item");
    item.append(
      element("strong", "", String(value)),
      element("span", "", label),
    );
    grid.append(item);
  }
  section.append(heading, grid);
  return section;
}

function renderDecision(run) {
  const section = element("section", "detail-section");
  section.setAttribute("aria-labelledby", "decision-title");
  const card = element("div", "decision-card");
  if (run.decision.status !== "PENDING") {
    card.classList.add("resolved");
    const choice = run.decision.authorizedChoice;
    const title = element(
      "h3",
      "",
      choice ? `${choiceLabel(choice)} authorized` : "Decision window closed",
    );
    title.id = "decision-title";
    card.append(
      element(
        "p",
        "eyebrow",
        choice ? "OWNER DECISION RECORDED" : "DECISION CLOSED",
      ),
      title,
      element(
        "p",
        "decision-question",
        choice
          ? "QuietOps resumed this same release run with only the selected authority."
          : "The decision expired without granting any action authority.",
      ),
    );
    if (run.decision.authorizedAt) {
      card.append(
        element(
          "span",
          "decision-time",
          `Recorded ${formatDate(run.decision.authorizedAt)}`,
        ),
      );
    }
    section.append(card);
    return section;
  }
  const title = element("h3", "", "QuietOps needs context, not more retries");
  title.id = "decision-title";
  card.append(
    element("p", "eyebrow", "THE HUMAN BOUNDARY"),
    title,
    element("p", "decision-question", run.decision.missingContext),
  );

  const choices = element("div", "choice-grid");
  for (const choice of run.decision.choices) {
    const item = element("article", "choice-card");
    item.append(
      element("strong", "", choiceLabel(choice.choice)),
      element("p", "", choice.summary),
    );
    choices.append(item);
  }
  card.append(choices);

  if (state.detailCapabilities?.canDecide === true) {
    const form = element("form", "authority-form");
    form.addEventListener("submit", (event) => event.preventDefault());
    const label = element("label", "", "Release-owner token");
    label.htmlFor = "operator-token";
    const input = document.createElement("input");
    input.id = "operator-token";
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Used in memory for one POST only";
    const actions = element("div", "decision-actions");
    for (const choice of run.decision.choices) {
      const incidentDisabled =
        choice.choice === "ESCALATE_INCIDENT" &&
        state.detailCapabilities?.incidentActionEnabled !== true;
      const button = element(
        "button",
        choice.choice === "ESCALATE_INCIDENT"
          ? "action-button secondary"
          : "action-button",
        choiceButtonLabel(choice.choice),
      );
      button.type = "button";
      button.disabled = incidentDisabled;
      if (incidentDisabled) {
        button.title = "Incident action is held disabled for this stage.";
      }
      button.addEventListener(
        "click",
        () => void submitReleaseDecision(run, choice.choice, input),
      );
      actions.append(button);
    }
    form.append(label, input, actions);
    card.append(form);
  } else {
    const boundary = element("div", "public-boundary");
    boundary.append(
      element("strong", "", "Read-only by design"),
      element(
        "span",
        "",
        run.evidenceMode === "preserved-demo"
          ? "This preserved history demonstrates the checkpoint but can never accept a decision."
          : "Public viewers can inspect the question and consequences; only an authenticated release owner can choose.",
      ),
    );
    card.append(boundary);
  }

  section.append(card);
  return section;
}

function renderAction(action) {
  const section = element("section", "detail-section");
  const card = element("div", "action-receipt");
  card.append(
    element("p", "eyebrow", "AUTHORIZED ACTION RESULT"),
    element("strong", "", `${action.actionType} · ${action.status}`),
    element(
      "span",
      "",
      `${action.attemptCount} provider attempt${action.attemptCount === 1 ? "" : "s"}; no automatic retry.`,
    ),
  );
  if (action.providerUrl) {
    const link = element("a", "receipt-link", "Open provider receipt ↗");
    link.href = action.providerUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(link);
  }
  section.append(card);
  return section;
}

function renderTimeline(timeline) {
  const section = element("section", "detail-section");
  const heading = element("div", "section-heading");
  heading.append(
    element("h3", "", "Same-run story"),
    element("span", "", `${timeline.length} persisted events`),
  );
  const list = element("ol", "timeline");
  for (const event of timeline) {
    const item = element("li", "timeline-item");
    const marker = element("span", "timeline-marker", String(event.sequence));
    marker.setAttribute("aria-hidden", "true");
    const copy = element("div");
    copy.append(
      element("strong", "", event.title),
      element("p", "", event.detail),
      element("time", "", formatDate(event.occurredAt)),
    );
    item.append(marker, copy);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function renderReceipts(receipts) {
  const section = document.createElement("details");
  section.className = "technical-receipts";
  const summary = document.createElement("summary");
  summary.textContent = `Technical receipts · ${receipts.length}`;
  const intro = element(
    "p",
    "receipt-intro",
    "Provider-bound evidence is available for audit after the human-readable story.",
  );
  const grid = element("div", "receipt-grid");
  for (const receipt of receipts) {
    const item = element("article", "receipt-item");
    item.append(
      element("strong", "", humanizeTool(receipt.toolName)),
      element("code", "", receipt.providerRecordId),
      element(
        "span",
        "",
        `${receipt.provider} · ${formatDate(receipt.fetchedAt)}`,
      ),
    );
    if (receipt.sourceUrl) {
      const link = element("a", "receipt-link", "Open source ↗");
      link.href = receipt.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
    }
    grid.append(item);
  }
  section.append(summary, intro, grid);
  return section;
}

async function submitReleaseDecision(run, choice, input) {
  if (state.busy) return;
  let authority = input.value.trim();
  if (!authority) {
    input.focus();
    showToast("Enter release-owner authority for this one request.", true);
    return;
  }
  input.value = "";
  setBusy(true);
  try {
    const payload = await requestJson(
      `/api/decisions/${encodeURIComponent(run.decision.decisionId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authority}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `browser:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          choice,
          expectedRunVersion: run.decision.expectedRunVersion,
        }),
      },
    );
    authority = "";
    showToast(
      payload.receipt.replayed
        ? "The existing decision receipt was replayed."
        : "Decision authorized. QuietOps will resume the same run.",
    );
    await loadRuns(run.runId, { silent: true });
  } catch (error) {
    authority = "";
    showToast(errorMessage(error), true);
    await loadRuns(run.runId, { silent: true });
  } finally {
    setBusy(false);
  }
}

function schedulePoll() {
  clearPoll();
  if (!state.selected?.active) return;
  const interval = state.capabilities?.pollIntervalMs ?? 2_000;
  state.pollTimer = window.setTimeout(
    () => void loadRuns(state.selectedId, { silent: true }),
    interval,
  );
}

function clearPoll() {
  if (state.pollTimer !== null) {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadReleaseMarker() {
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    releaseRepository.textContent = "Local demo";
    releaseCommit.textContent = "Not configured";
    releaseProofStatus.textContent = "No public release marker in this runtime";
    return;
  }
  try {
    const marker = await requestJson("/.well-known/quietops-release.json");
    releaseRepository.textContent = marker.repository;
    releaseRepository.title = marker.repository;
    releaseCommit.textContent = shortCommit(marker.commit);
    releaseCommit.title = marker.commit;
    releaseProofStatus.textContent = "Strict no-store marker verified";
  } catch {
    releaseRepository.textContent = "Local demo";
    releaseCommit.textContent = "Not configured";
    releaseProofStatus.textContent = "No public release marker in this runtime";
  }
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Request failed with HTTP ${response.status}.`,
    );
  }
  return payload;
}

function setBusy(busy) {
  state.busy = busy;
  refreshButton.disabled = busy;
  for (const button of document.querySelectorAll(".run-item, .action-button")) {
    button.disabled = busy;
  }
}

function renderEmpty(title, message) {
  runDetail.replaceChildren();
  const empty = element("div", "empty-state");
  empty.append(
    element("span", "empty-mark", "✓"),
    element("h2", "", title),
    element("p", "", message),
  );
  runDetail.append(empty);
  renderMetrics();
}

function renderError(error) {
  runDetail.replaceChildren();
  const panel = element("div", "empty-state error-state");
  panel.append(
    element("span", "empty-mark", "!"),
    element("h2", "", "Release runs could not be loaded"),
    element("p", "", errorMessage(error)),
  );
  runDetail.append(panel);
  showToast(errorMessage(error), true);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? "toast visible error" : "toast visible";
  window.setTimeout(() => {
    toast.className = "toast";
  }, 4_000);
}

function stateLabel(value) {
  return (
    {
      MONITORING: "Observing",
      WAITING: "Waiting safely",
      AWAITING_DECISION: "Judgment needed",
      RESUMING: "Resuming",
      COMPLETED: "Completed quietly",
      ESCALATED: "Escalated",
      STOPPED: "Stopped safely",
    }[value] ?? value
  );
}

function choiceLabel(value) {
  return value === "WAIT_AND_RECHECK"
    ? "Wait and re-check"
    : "Escalate one incident";
}

function choiceButtonLabel(value) {
  return value === "WAIT_AND_RECHECK"
    ? "Authorize final re-check"
    : "Authorize one incident";
}

function humanizeTool(value) {
  return value.replaceAll("_", " ");
}

function shortCommit(value) {
  return value.slice(0, 8);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value) {
  if (value < 1_000) return `${value} ms`;
  return `${value / 1_000} s`;
}

function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
