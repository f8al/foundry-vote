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
 * 1) Slash command: /vote ...
 */
Hooks.on("chatMessage", (chatLog, content, chatData) => {
  const command = "/vote";

  if (!content.trim().toLowerCase().startsWith(command)) return;

  // Strip "/vote"
  const text = content.slice(command.length).trim();
  if (!text) {
    ui.notifications.warn("Usage: /vote <question or options separated by 'or'>");
    return false; // block original message
  }

  // Split on " or " to detect multiple options.
  // If only one part -> Yes/No poll.
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
        votes: []            // array of user IDs
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

  // Escape question text
  const esc = foundry.utils?.escapeHTML
    ? foundry.utils.escapeHTML(poll.question)
    : poll.question;

  // Create the poll chat message
  ChatMessage.create({
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
 * 2) Render poll UI in chat messages
 */
Hooks.on("renderChatMessage", (message, html, data) => {
  const poll = message.getFlag(MODULE_ID, "poll");
  if (!poll) return;

  const pollDiv = document.createElement("div");
  pollDiv.classList.add("vote-poll");

  // Buttons container
  const buttonsDiv = document.createElement("div");
  buttonsDiv.classList.add("vote-poll-buttons");

  // Results container
  const resultsDiv = document.createElement("div");
  resultsDiv.classList.add("vote-poll-results");

  const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0) || 0;

  for (const opt of poll.options) {
    // Button for this option
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.optionKey = opt.key;
    btn.classList.add("vote-poll-button");
    btn.textContent = opt.label;
    buttonsDiv.appendChild(btn);

    // Result line
    const count = opt.votes.length;
    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const resultLine = document.createElement("div");
    resultLine.classList.add("vote-poll-result-line");
    resultLine.textContent = `${opt.label}: ${count} vote${count !== 1 ? "s" : ""} (${percentage}%)`;
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
 * 3) Socket handler — only GM updates the message
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
      opt.votes = opt.votes.filter(id => id !== userId);
      if (opt.key === optionKey) {
        opt.votes.push(userId);
      }
    }

    await message.setFlag(MODULE_ID, "poll", poll);
  });
});
