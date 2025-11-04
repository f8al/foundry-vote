const MODULE_ID = "vote-poll";

/**
 * Utility: duplicate object safely across FVTT versions.
 */
function dup(obj) {
  if (!obj) return obj;
  if (foundry?.utils?.duplicate) return foundry.utils.duplicate(obj);
  return structuredClone(obj);
}

/**
 * Build a summary object for counts/percentages.
 */
function buildPollSummary(poll) {
  const totalVotes =
    poll.options.reduce((sum, opt) => sum + (opt.votes?.length || 0), 0) || 0;

  const options = poll.options.map(opt => {
    const count = opt.votes?.length || 0;
    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    return {
      key: opt.key,
      label: opt.label,
      count,
      percentage
    };
  });

  return { totalVotes, options };
}

/**
 * Build HTML content for the journal entry.
 */
function buildPollHtml(poll) {
  const summary = buildPollSummary(poll);
  const esc = foundry.utils?.escapeHTML
    ? foundry.utils.escapeHTML(poll.question)
    : poll.question;

  let html = `<h1>Poll Results</h1>`;
  html += `<p><strong>Question:</strong> ${esc}</p>`;
  html += `<ul>`;

  for (const opt of summary.options) {
    html += `<li><strong>${opt.label}</strong>: ${opt.count} vote${opt.count !== 1 ? "s" : ""} (${opt.percentage}%)</li>`;
  }

  html += `</ul>`;
  html += `<p><em>Total votes: ${summary.totalVotes}</em></p>`;

  return html;
}

/**
 * Create or update the JournalEntry for this poll (GM only).
 */
async function upsertPollJournal(message, poll) {
  if (!game.user.isGM) return;
  if (!game.journal || !JournalEntry) return;

  const summary = buildPollSummary(poll);
  const content = buildPollHtml(poll);

  // Try to get existing journal
  let journalId = message.getFlag(MODULE_ID, "journalEntryId");
  let journal = journalId ? game.journal.get(journalId) : null;

  const PERM = CONST.DOCUMENT_OWNERSHIP_LEVELS ?? CONST.DOCUMENT_PERMISSION_LEVELS;

  if (!journal) {
    // Create new journal entry for this poll
    const truncatedQuestion =
      poll.question.length > 60 ? poll.question.slice(0, 57) + "..." : poll.question;

    journal = await JournalEntry.create({
      name: `Poll: ${truncatedQuestion}`,
      content,
      ownership: {
        default: PERM.OBSERVER
      }
    });

    await message.setFlag(MODULE_ID, "journalEntryId", journal.id);
  } else {
    // Update existing journal entry
    await journal.update({ content });
  }
}

/**
 * 1) Slash command: /vote ...
 */
Hooks.on("chatMessage", async (chatLog, content, chatData) => {
  const command = "/vote";

  if (!content.trim().toLowerCase().startsWith(command)) return;

  // Strip "/vote"
  const text = content.slice(command.length).trim();
  if (!text) {
    ui.notifications.warn("Usage: /vote <question or options separated by 'or'>");
    return false; // block original message
  }

  // Split on " or " to detect multiple options.
  // If >1 part => multi-option poll. If 1 part => Yes/No poll.
  const parts = text
    .split(/\s+or\s+/i)
    .map(s => s.trim())
    .filter(Boolean);

  let poll;
  if (parts.length > 1) {
    // Multi-option poll
    poll = {
      question: text,
      options: parts.map((label, i) => ({
        key: `opt${i}`,
        label,
        votes: [] // array of user IDs
      }))
    };
  } else {
    // Simple Yes/No poll
    poll = {
      question: text,
      options: [
        { key: "yes", label: "Yes", votes: [] },
        { key: "no", label: "No", votes: [] }
      ]
    };
  }

  const esc = foundry.utils?.escapeHTML
    ? foundry.utils.escapeHTML(poll.question)
    : poll.question;

  // Create the poll chat message
  await ChatMessage.create({
    user: game.user.id,
    speaker: { alias: game.user.name },
    type: CONST.CHAT_MESSAGE_TYPES.OOC,
    content: `<p><strong>Vote:</strong> ${esc}</p><p><em>Click a button below to vote.</em></p>`,
    flags: {
      [MODULE_ID]: {
        poll
      }
    }
  });

  // Prevent the original '/vote ...' text from appearing
  return false;
});

/**
 * 2) Render poll UI in chat messages (with user highlighting)
 */
Hooks.on("renderChatMessage", (message, html, data) => {
  const poll = message.getFlag(MODULE_ID, "poll");
  if (!poll) return;

  const pollDiv = document.createElement("div");
  pollDiv.classList.add("vote-poll");

  const buttonsDiv = document.createElement("div");
  buttonsDiv.classList.add("vote-poll-buttons");

  const resultsDiv = document.createElement("div");
  resultsDiv.classList.add("vote-poll-results");

  const { totalVotes, options } = buildPollSummary(poll);

  const myUserId = game.user.id;
  const myOption = poll.options.find(opt => (opt.votes || []).includes(myUserId));
  const myOptionKey = myOption?.key;

  for (const opt of poll.options) {
    const summaryOpt = options.find(o => o.key === opt.key);
    const count = summaryOpt?.count ?? 0;
    const percentage = summaryOpt?.percentage ?? 0;

    // Button for this option
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.optionKey = opt.key;
    btn.classList.add("vote-poll-button");
    btn.textContent = opt.label;
    if (opt.key === myOptionKey) {
      btn.classList.add("selected");
    }
    buttonsDiv.appendChild(btn);

    // Result line
    const resultLine = document.createElement("div");
    resultLine.classList.add("vote-poll-result-line");
    if (opt.key === myOptionKey) {
      resultLine.classList.add("selected");
    }

    const youSuffix = opt.key === myOptionKey ? " (you)" : "";
    resultLine.textContent = `${opt.label}: ${count} vote${count !== 1 ? "s" : ""} (${percentage}%)${youSuffix}`;
    resultsDiv.appendChild(resultLine);
  }

  // Summary
  const summary = document.createElement("div");
  summary.classList.add("vote-poll-summary");
  summary.textContent = `Total votes: ${totalVotes}`;
  resultsDiv.appendChild(summary);

  pollDiv.appendChild(buttonsDiv);
  pollDiv.appendChild(resultsDiv);

  html[0].appendChild(pollDiv);

  // Click handler — emit via socket
  buttonsDiv.addEventListener("click", ev => {
    const btn = ev.target.closest("button[data-option-key]");
    if (!btn) return;
    const optionKey = btn.dataset.optionKey;

    game.socket.emit(`module.${MODULE_ID}`, {
      action: "vote",
      messageId: message.id,
      optionKey,
      userId: game.user.id
    });
  });
});

/**
 * 3) Socket handler — only GM updates the message & journal
 */
Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, async data => {
    if (!game.user.isGM) return;
    if (!data || data.action !== "vote") return;

    const { messageId, optionKey, userId } = data;
    const message = game.messages.get(messageId);
    if (!message) return;

    let poll = dup(message.getFlag(MODULE_ID, "poll"));
    if (!poll) return;

    // Remove this user from all options, then add to selected one
    for (const opt of poll.options) {
      opt.votes = (opt.votes || []).filter(id => id !== userId);
      if (opt.key === optionKey) {
        opt.votes.push(userId);
      }
    }

    // Update poll on the message
    await message.setFlag(MODULE_ID, "poll", poll);

    // Also create/update the journal log
    await upsertPollJournal(message, poll);
  });
});
