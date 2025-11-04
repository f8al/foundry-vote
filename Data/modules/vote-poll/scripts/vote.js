const MODULE_ID = "vote-poll";

function dup(obj) {
  if (!obj) return obj;
  if (foundry?.utils?.duplicate) return foundry.utils.duplicate(obj);
  return structuredClone(obj);
}

function buildPollSummary(poll) {
  const totalVotes =
    poll.options.reduce((sum, opt) => sum + (opt.votes?.length || 0), 0) || 0;
  const options = poll.options.map(opt => {
    const count = opt.votes?.length || 0;
    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    return { key: opt.key, label: opt.label, count, percentage };
  });
  return { totalVotes, options };
}

function buildPollHtml(poll) {
  const summary = buildPollSummary(poll);
  const esc = foundry.utils?.escapeHTML ? foundry.utils.escapeHTML(poll.question) : poll.question;
  let html = `<h1>Poll Results</h1>`;
  html += `<p><strong>Question:</strong> ${esc}</p>`;
  html += `<ul>`;
  for (const opt of summary.options) {
    html += `<li><strong>${opt.label}</strong>: ${opt.count} vote${opt.count !== 1 ? "s" : ""} (${opt.percentage}%)</li>`;
  }
  html += `</ul>`;
  html += `<p><em>Total votes: ${summary.totalVotes}</em></p>`;
  if (poll.closed) {
    html += `<p><em>This poll is closed.</em></p>`;
  }
  return html;
}

async function upsertPollJournal(message, poll) {
  if (!game.user.isGM) return;
  if (!game.journal || !JournalEntry) return;
  const content = buildPollHtml(poll);
  let journalId = message.getFlag(MODULE_ID, "journalEntryId");
  let journal = journalId ? game.journal.get(journalId) : null;
  const PERM = CONST.DOCUMENT_OWNERSHIP_LEVELS ?? CONST.DOCUMENT_PERMISSION_LEVELS;
  if (!journal) {
    const truncated = poll.question.length > 60 ? poll.question.slice(0, 57) + "..." : poll.question;
    journal = await JournalEntry.create({
      name: `Poll: ${truncated}`,
      content,
      ownership: { default: PERM.OBSERVER }
    });
    await message.setFlag(MODULE_ID, "journalEntryId", journal.id);
  } else {
    await journal.update({ content });
  }
}

Hooks.on("chatMessage", async (chatLog, content, chatData) => {
  const command = "/vote";
  if (!content.trim().toLowerCase().startsWith(command)) return;
  const text = content.slice(command.length).trim();
  if (!text) {
    ui.notifications.warn("Usage: /vote <question or options separated by 'or'>");
    return false;
  }
  const parts = text.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean);
  let poll;
  if (parts.length > 1) {
    poll = { question: text, options: parts.map((label,i) => ({ key:`opt${i}`, label, votes:[] })), closed:false };
  } else {
    poll = { question: text, options: [ {key:"yes", label:"Yes", votes:[]}, {key:"no", label:"No", votes:[]} ], closed:false };
  }
  const esc = foundry.utils?.escapeHTML ? foundry.utils.escapeHTML(poll.question) : poll.question;
  await ChatMessage.create({
    user: game.user.id,
    speaker: { alias: game.user.name },
    type: CONST.CHAT_MESSAGE_TYPES.OOC,
    content: `<p><strong>Vote:</strong> ${esc}</p><p><em>Click a button below to vote.</em></p>`,
    flags: {
      [MODULE_ID]: { poll }
    }
  });
  return false;
});

Hooks.on("renderChatMessage", (message, html, data) => {
  const flag = message.getFlag(MODULE_ID, "poll");
  if (!flag) return;
  const poll = flag;
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
    const count = (opt.votes?.length) || 0;
    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.optionKey = opt.key;
    btn.classList.add("vote-poll-button");
    btn.textContent = opt.label;
    if (opt.key === myOptionKey) {
      btn.classList.add("selected");
    }
    // disable if poll closed
    if (poll.closed) {
      btn.disabled = true;
    }
    buttonsDiv.appendChild(btn);

    const resultLine = document.createElement("div");
    resultLine.classList.add("vote-poll-result-line");
    if (opt.key === myOptionKey) {
      resultLine.classList.add("selected");
    }
    const youSuffix = opt.key === myOptionKey ? " (you)" : "";
    resultLine.textContent = `${opt.label}: ${count} vote${count !== 1 ? "s" : ""} (${percentage}%)${youSuffix}`;
    resultsDiv.appendChild(resultLine);
  }

  const summary = document.createElement("div");
  summary.classList.add("vote-poll-summary");
  summary.textContent = `Total votes: ${totalVotes}`;
  resultsDiv.appendChild(summary);

  // *** NEW: Add End Vote button if GM and poll not closed ***
  if (game.user.isGM && !poll.closed) {
    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.classList.add("vote-poll-end-button");
    endBtn.textContent = "End Vote";
    buttonsDiv.appendChild(endBtn);
    endBtn.addEventListener("click", () => {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "end-poll",
        messageId: message.id,
        userId: game.user.id
      });
    });
  }

  pollDiv.appendChild(buttonsDiv);
  pollDiv.appendChild(resultsDiv);

  html[0].appendChild(pollDiv);

  buttonsDiv.addEventListener("click", ev => {
    const btn = ev.target.closest("button[data-option-key]");
    if (!btn) return;
    const optionKey = btn.dataset.optionKey;
    if (poll.closed) {
      ui.notifications.warn("This poll is already closed.");
      return;
    }
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "vote",
      messageId: message.id,
      optionKey,
      userId: game.user.id
    });
  });
});

Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, async data => {
    if (!game.user.isGM) return;
    if (!data || (data.action !== "vote" && data.action !== "end-poll")) return;

    const { messageId, optionKey, userId } = data;
    const message = game.messages.get(messageId);
    if (!message) return;
    let poll = dup(message.getFlag(MODULE_ID, "poll"));
    if (!poll) return;

    if (data.action === "vote") {
      // same as before
      for (const opt of poll.options) {
        opt.votes = (opt.votes || []).filter(id => id !== userId);
        if (opt.key === optionKey) {
          opt.votes.push(userId);
        }
      }
      await message.setFlag(MODULE_ID, "poll", poll);
      await upsertPollJournal(message, poll);

    } else if (data.action === "end-poll") {
      // mark poll closed
      poll.closed = true;
      await message.setFlag(MODULE_ID, "poll", poll);
      await upsertPollJournal(message, poll);
      // Optionally update message content to reflect closed
      await message.update({ content: `${message.data.content}<p><em>🛑 Poll closed by GM.</em></p>` });
    }
  });
});
