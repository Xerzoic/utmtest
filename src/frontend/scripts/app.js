const API_BASE = "/api";
const AUTH_BASE = "/auth";
let socket = null;

const state = {
  user: null,
  token: null,
  currentTab: "dashboard",
};

function init() {
  const savedToken = localStorage.getItem("gxsave_token");
  if (savedToken) {
    state.token = savedToken;
    loadDashboard();
  } else {
    showAuthScreen();
  }
}

function connectSocket() {
  if (socket || !state.user) return;
  try {
    socket = io();
    socket.on("connect", function() { socket.emit("join", state.user.id); });
    socket.on("nudge", function(data) {
      showNudgeToast(data);
      if (state.currentTab === "dashboard") loadDashboard();
      updateNudgeBadge();
    });
  } catch (e) { console.warn("Socket not available"); }
}

function showNudgeToast(nudge) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.style.cssText = "position:fixed;top:16px;right:16px;z-index:999;display:flex;flex-direction:column;gap:8px;";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  const p = nudge.priority || "normal";
  toast.className = "toast toast-" + p;
  const icon = p === "high" ? "!" : "i";
  toast.innerHTML =
    "<span class='toast-icon'>" + icon + "</span>" +
    "<div class='toast-body'>" +
      "<p class='toast-title'>" + nudge.title + "</p>" +
      "<p class='toast-text'>" + nudge.message + "</p>" +
    "</div>" +
    "<button class='toast-close' onclick='this.parentElement.remove()'>✕</button>";
  container.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 5000);
}

function showAuthScreen() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("mainApp").style.display = "none";
}

function showMainApp() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("mainApp").style.display = "block";
  loadDashboard();
}

function showLogin() {
  document.getElementById("loginForm").style.display = "block";
  document.getElementById("registerForm").style.display = "none";
}

function showRegister() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "block";
}

async function login() {
  const email = document.getElementById("loginEmail").value;
  if (!email) return alert("Please enter your email");
  try {
    const res = await fetch(AUTH_BASE + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("gxsave_token", data.token);
      const initials = (data.user.full_name || "?").substring(0, 2).toUpperCase();
      document.getElementById("userAvatar").textContent = initials;
      showMainApp();
    } else {
      alert(data.error || "Login failed");
    }
  } catch (err) {
    alert("Login error: " + err.message);
  }
}

async function register() {
  const name = document.getElementById("regName").value;
  const email = document.getElementById("regEmail").value;
  const phone = document.getElementById("regPhone").value;
  const income = document.getElementById("regIncome").value;
  if (!name || !email) return alert("Please fill in required fields");
  try {
    const res = await fetch(AUTH_BASE + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: name,
        email,
        phone: phone || "+60100000000",
        monthly_income: parseInt(income) || 5000,
        gxbank_account_id: "GX-" + Date.now(),
      }),
    });
    const data = await res.json();
    if (data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("gxsave_token", data.token);
      const initials = (data.user.full_name || "?").substring(0, 2).toUpperCase();
      document.getElementById("userAvatar").textContent = initials;
      showMainApp();
    } else {
      alert(data.error || "Registration failed");
    }
  } catch (err) {
    alert("Registration error: " + err.message);
  }
}

async function demoLogin() {
  try {
    const res = await fetch(AUTH_BASE + "/demo-token");
    const data = await res.json();
    if (data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("gxsave_token", data.token);
      const initials = (data.user.full_name || "?").substring(0, 2).toUpperCase();
      document.getElementById("userAvatar").textContent = initials;
      showMainApp();
    }
  } catch (err) {
    alert("Demo login failed. Make sure server is running on localhost:3000");
  }
}

async function api(endpoint, options) {
  options = options || {};
  if (!state.token) return null;
  try {
    const res = await fetch(API_BASE + endpoint, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + state.token,
        ...(options.headers || {}),
      },
    });
    return await res.json();
  } catch (err) {
    console.error("API Error:", err);
    return null;
  }
}

function setGreeting() {
  const hour = new Date().getHours();
  let greeting = "Good morning,";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon,";
  else if (hour >= 17) greeting = "Good evening,";
  const el = document.getElementById("greetingTime");
  if (el) el.textContent = greeting;
}

async function loadDashboard() {
  const data = await api("/dashboard");
  if (!data) return;

  state.user = data.user;
  setGreeting();

  const firstName = (data.user.full_name || "User").split(" ")[0];
  document.getElementById("heroName").textContent = firstName;
  const initials = (data.user.full_name || "?").substring(0, 2).toUpperCase();
  document.getElementById("userAvatar").textContent = initials;
  document.getElementById("totalSavings").textContent = "RM " + (data.totalSavings || 0).toLocaleString();
  document.getElementById("streakCount").textContent = data.streak?.current_streak || 0;
  document.getElementById("bestStreak").textContent = data.streak?.longest_streak || 0;

  renderStreakCalendar(data.streak);

  const nudgesList = document.getElementById("nudgeList");
  if (data.unreadNudges?.length > 0) {
    nudgesList.innerHTML = data.unreadNudges.map(function(n) {
      const pri = n.priority === "high" ? "high" : "normal";
      return "<div class='nudge-item nudge-" + pri + "'>" +
        "<span class='nudge-icon'>" + (n.priority === "high" ? "!" : "i") + "</span>" +
        "<div class='nudge-content'>" +
          "<p class='nudge-title'>" + n.title + "</p>" +
          "<p class='nudge-text'>" + n.message + "</p>" +
        "</div>" +
        "<span class='nudge-time'>" + timeAgo(n.delivered_at) + "</span>" +
      "</div>";
    }).join("");
  } else {
    nudgesList.innerHTML = "<p class='empty-state'>No nudges yet</p>";
  }

  const budgetList = document.getElementById("budgetList");
  if (data.budgets?.length > 0) {
    budgetList.innerHTML = data.budgets.map(function(b) {
      const pct = b.monthly_limit > 0 ? (b.current_spent / b.monthly_limit * 100) : 0;
      const warnClass = pct > 75 ? " budget-warning" : "";
      return "<div class='budget-item" + warnClass + "'>" +
        "<div class='budget-header'>" +
          "<span class='budget-name'>" + b.category + "</span>" +
          "<span class='budget-amounts'>RM " + b.current_spent + " / RM " + b.monthly_limit + "</span>" +
        "</div>" +
        "<div class='budget-bar'><div class='budget-fill" + (warnClass ? " budget-fill-warning" : "") + "' style='width: " + Math.min(pct, 100) + "%'></div></div>" +
      "</div>";
    }).join("");
  }

  if (data.goals?.length > 0) {
    renderGoals(data.goals);
  }

  if (data.autoSaveSummary) {
    renderRules(data.autoSaveSummary);
  }

  if (data.monthlySpending?.length > 0) {
    renderSpendingChart(data.monthlySpending);
  }

  connectSocket();
  updateNudgeBadge();
  if (state.currentTab === "dashboard") loadGamification();
  loadTodayExpenses();
}

function renderStreakCalendar(streak) {
  const cal = document.getElementById("streakCalendar");
  if (!cal) return;
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayNames = ["S","M","T","W","T","F","S"];
    const dayName = dayNames[d.getDay()];
    const isToday = d.toDateString() === today.toDateString();
    const isActive = streak?.current_streak > (6 - i);
    let cls = "streak-day";
    if (isActive) cls += " active";
    if (isToday) cls += " today";
    days.push("<div class='" + cls + "'>" + dayName + "</div>");
  }
  cal.innerHTML = days.join("");
}

function renderSpendingChart(categories) {
  const chart = document.getElementById("spendingChart");
  if (!chart) return;
  const vals = categories.map(function(c) { return parseFloat(c.total); });
  const max = Math.max.apply(null, vals) || 1;
  chart.innerHTML = categories.map(function(c) {
    const pct = (parseFloat(c.total) / max * 100).toFixed(0);
    const colors = { food: "#ef4444", transport: "#3b82f6", shopping: "#a855f7", entertainment: "#f59e0b", bills: "#10b981", other: "#6b7280" };
    const color = colors[c.category] || colors.other;
    return "<div class='chart-bar'>" +
      "<span class='chart-label'>" + c.category + "</span>" +
      "<div class='chart-track'><div class='chart-fill' style='width:" + pct + "%;background:" + color + "'></div></div>" +
      "<span class='chart-amount'>RM" + parseFloat(c.total).toFixed(0) + "</span>" +
    "</div>";
  }).join("");
}

async function loadGamification() {
  const data = await api("/gamification");
  if (!data) return;
  const el = document.getElementById("gamificationProfile");
  if (!el) return;
  const initials = (state.user?.full_name || "?").substring(0, 2).toUpperCase();

  el.innerHTML =
    "<div class='gami-header'>" +
      "<div class='gami-avatar'>" + initials + "</div>" +
      "<div class='gami-info'>" +
        "<p class='gami-level'>Level " + data.level + "</p>" +
        "<div class='gami-xp-bar'><div class='gami-xp-fill' style='width:" + data.progressToNext + "%'></div></div>" +
        "<p class='gami-xp-text'>" + data.xp + " XP • " + data.progressToNext + "% to next level</p>" +
      "</div>" +
    "</div>" +
    "<div class='gami-badges'>" +
      "<h4>Badges (" + data.totalBadges + ")</h4>" +
      "<div class='badge-grid'>" +
        (data.badges?.length > 0 ? data.badges.map(function(b) {
          return "<div class='badge-item' title='" + b.badge_description + "'>" +
            "<span class='badge-icon'>" + getBadgeIcon(b.badge_icon) + "</span>" +
            "<span class='badge-name'>" + b.badge_name + "</span>" +
          "</div>";
        }).join("") : "<p class='empty-state'>No badges yet</p>") +
      "</div>" +
    "</div>";
}

function getBadgeIcon(icon) {
  const icons = { star: "★", fire: "🔥", crown: "👑", diamond: "♦", badge: "🏅", trophy: "🏆", check: "✅", users: "👥", handshake: "🤝", coins: "🪙", calendar: "📅", shield: "🛡️", zap: "⚡" };
  return icons[icon] || "🏅";
}

async function loadGoals() {
  const data = await api("/goals");
  if (data) renderGoals(data);
}

function renderGoals(goals) {
  const list = document.getElementById("goalsList");
  list.innerHTML = goals.map(function(g) {
    const pct = g.target_amount > 0 ? Math.min(g.progress_percent || 0, 100) : 0;
    const priorityClass = g.priority === "high" ? "goal-high" : g.priority === "medium" ? "goal-medium" : "";
    const deadlineStr = g.deadline ? "<p class='goal-deadline'>Target: " + new Date(g.deadline).toLocaleDateString("en-MY", { month: "long", year: "numeric" }) + "</p>" : "";
    return "<div class='goal-card " + priorityClass + "'>" +
      "<div class='goal-icon'>" + getCategoryIcon(g.category) + "</div>" +
      "<div class='goal-details'>" +
        "<h3 class='goal-name'>" + g.name + "</h3>" +
        "<div class='goal-progress'>" +
          "<div class='goal-bar'><div class='goal-fill' style='width: " + pct + "%'></div></div>" +
          "<span class='goal-percent'>" + pct + "%</span>" +
        "</div>" +
        "<p class='goal-amounts'>RM " + (g.current_amount || 0).toLocaleString() + " <span class='goal-target'>/ RM " + (g.target_amount || 0).toLocaleString() + "</span></p>" +
        deadlineStr +
      "</div>" +
    "</div>";
  }).join("");
}

function getCategoryIcon(category) {
  const icons = { emergency: "🛡️", travel: "✈️", vehicle: "🚗", education: "📚", electronics: "💻", home: "🏠", other: "🎯" };
  return icons[category] || "🎯";
}

async function createGoal(e) {
  e.preventDefault();
  const name = document.getElementById("goalName").value;
  const amount = document.getElementById("goalAmount").value;
  const deadline = document.getElementById("goalDeadline").value;
  const category = document.getElementById("goalCategory").value;

  const data = await api("/goals", {
    method: "POST",
    body: JSON.stringify({ name, target_amount: parseFloat(amount), deadline, category, icon: getCategoryIcon(category) }),
  });

  if (data) {
    closeModal("newGoalModal");
    loadGoals();
    document.getElementById("newGoalForm").reset();
  }
}

async function loadInsights() {
  showTab("insights");
  const data = await api("/insights");
  if (!data) return;

  const content = document.getElementById("insightsContent");
  let html = "<div class='insight-card insight-summary'>" +
    "<h3>Financial Health: " + (data.financialHealth || "Good") + "</h3>" +
    "<div class='health-score'>" +
      "<div class='score-circle'>" +
        "<span class='score-value'>" + (data.savingsRate || 0) + "%</span>" +
        "<span class='score-label'>Savings Rate</span>" +
      "</div>" +
    "</div>" +
    "<p class='insight-text'>" + (data.summary || "") + "</p>" +
  "</div>";

  if (data.tips?.length > 0) {
    html += "<div class='insight-card insight-tips'><h3>Personalised Tips</h3><div class='tip-list'>";
    html += data.tips.map(function(t) {
      return "<div class='tip-item tip-" + (t.priority || "medium") + "'>" +
        "<span class='tip-priority'>" + (t.priority || "medium").toUpperCase() + "</span>" +
        "<p class='tip-text'><strong>" + t.title + "</strong> - " + t.message + "</p>" +
      "</div>";
    }).join("");
    html += "</div></div>";
  }

  if (data.risks?.length > 0) {
    html += "<div class='insight-card insight-risks'><h3>Areas to Watch</h3>";
    html += data.risks.map(function(r) {
      return "<div class='risk-item'><span class='risk-icon'>!</span><p class='risk-text'>" + r.message + "</p></div>";
    }).join("");
    html += "</div>";
  }

  content.innerHTML = html;
}

async function loadRules() {
  const data = await api("/autosave/rules");
  if (data) renderRules(data);
}

function renderRules(rules) {
  const list = document.getElementById("rulesList");
  if (!Array.isArray(rules)) return;
  list.innerHTML = rules.map(function(r) {
    const typeDisplay = r.rule_type.replace("_", " ").toUpperCase();
    const icon = r.rule_type === "round_up" ? "○" : r.rule_type === "salary_trigger" ? "💰" : "📅";
    return "<div class='rule-card rule-active'>" +
      "<div class='rule-header'>" +
        "<span class='rule-type-icon'>" + icon + "</span>" +
        "<div class='rule-info'>" +
          "<h3 class='rule-name'>" + typeDisplay + "</h3>" +
          "<p class='rule-desc'>" + JSON.stringify(r.config) + "</p>" +
        "</div>" +
        "<label class='toggle-switch'>" +
          "<input type='checkbox' " + (r.is_active ? "checked" : "") + " onchange='toggleRule(\"" + r.id + "\", this.checked)'>" +
          "<span class='toggle-slider'></span>" +
        "</label>" +
      "</div>" +
      "<div class='rule-stats'>" +
        "<div class='rule-stat'>" +
          "<p class='rule-stat-value'>RM " + (r.total_saved || 0).toLocaleString() + "</p>" +
          "<p class='rule-stat-label'>Total Saved</p>" +
        "</div>" +
      "</div>" +
    "</div>";
  }).join("");
}

async function createRule(e) {
  e.preventDefault();
  const ruleType = document.getElementById("ruleTypeSelect").value;
  const config = {};

  if (ruleType === "round_up") {
    config.destination_goal_id = "goal-emergency";
  } else if (ruleType === "salary_trigger") {
    config.percentage = 15;
    config.destination_goal_id = "goal-emergency";
  }

  const data = await api("/autosave/rules", {
    method: "POST",
    body: JSON.stringify({ rule_type: ruleType, config }),
  });

  if (data) {
    closeModal("newRuleModal");
    loadRules();
  }
}

function updateRuleFields() {
  const type = document.getElementById("ruleTypeSelect").value;
  const fields = document.getElementById("ruleConfigFields");
  if (type === "round_up") {
    fields.innerHTML = "<p class='config-hint'>Round up every transaction to the nearest RM1. The difference goes to savings!</p>";
  } else if (type === "salary_trigger") {
    fields.innerHTML =
      "<label>Save % of Salary</label>" +
      "<input type='number' id='rulePercent' value='15' min='1' max='50'>" +
      "<label>Destination Goal</label>" +
      "<select id='ruleGoal'><option value='goal-emergency'>Emergency Fund</option></select>";
  } else {
    fields.innerHTML = "<p class='config-hint'>Coming soon: Set weekly or monthly auto-saves!</p>";
  }
}

async function toggleRule(ruleId, isActive) {
  await api("/autosave/rules/" + ruleId, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
}

async function createGroup(e) {
  e.preventDefault();
  const name = document.getElementById("groupName").value;
  const desc = document.getElementById("groupDesc").value;
  const goalType = document.getElementById("groupGoalType").value;
  const target = document.getElementById("groupTarget").value;

  const data = await api("/groups", {
    method: "POST",
    body: JSON.stringify({ name, description: desc, goal_type: goalType, target_amount: target ? parseFloat(target) : null }),
  });

  if (data) {
    closeModal("newGroupModal");
    alert("Group created!");
  }
}

async function loadGroups() {
  const data = await api("/groups");
  const list = document.getElementById("groupsList");
  if (!list) return;
  if (data?.length > 0) {
    list.innerHTML = data.map(function(g) {
      return "<div class='group-card'>" +
        "<h3>" + g.name + "</h3>" +
        "<p>" + (g.description || "") + "</p>" +
        "<button class='btn-secondary' onclick='viewGroup(\"" + g.id + "\")'>View Leaderboard</button>" +
      "</div>";
    }).join("");
  }
}

async function viewGroup(groupId) {
  const lb = await api("/groups/" + groupId + "/leaderboard");
  if (!lb) return;
  const lbSection = document.getElementById("leaderboard");
  const lbList = document.getElementById("leaderboardList");
  lbSection.style.display = "block";
  lbList.innerHTML = lb.map(function(member, i) {
    return "<div class='leaderboard-item rank-" + (i+1) + "'>" +
      "<span class='rank-badge'>" + (i+1) + "</span>" +
      "<span class='lb-name'>" + member.full_name + "</span>" +
      "<span class='lb-saved'>RM " + parseFloat(member.total_saved || 0).toFixed(2) + "</span>" +
    "</div>";
  }).join("");
}

function showTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(function(tab) { tab.classList.remove("active"); });
  document.querySelectorAll(".nav-item").forEach(function(nav) { nav.classList.remove("active"); });

  const targetTab = document.getElementById(tabName + "Tab");
  if (targetTab) targetTab.classList.add("active");

  const navItems = document.querySelectorAll(".nav-item");
  const tabMap = { dashboard: 0, goals: 1, insights: 2, autosave: 3, social: 4 };
  if (navItems[tabMap[tabName]]) navItems[tabMap[tabName]].classList.add("active");

  state.currentTab = tabName;

  if (tabName === "goals") loadGoals();
  if (tabName === "autosave") loadRules();
  if (tabName === "social") loadGroups();
  if (tabName === "insights") loadInsights();
}

function toggleNudgePanel() {
  document.getElementById("nudgePanel").classList.toggle("open");
  loadNudges();
}

async function loadNudges() {
  const data = await api("/nudges?limit=20");
  if (!data) return;

  const list = document.getElementById("nudgePanelList");
  const unreadCount = data.filter(function(n) { return !n.is_read; }).length;

  document.getElementById("nudgeCount").textContent = unreadCount;
  document.getElementById("nudgeCount").style.display = unreadCount > 0 ? "block" : "none";

  list.innerHTML = data.length > 0 ? data.map(function(n) {
    return "<div class='nudge-panel-item " + (n.is_read ? "" : "unread") + "' onclick='markRead(\"" + n.id + "\")'>" +
      "<p class='np-title'>" + n.title + "</p>" +
      "<p class='np-text'>" + n.message + "</p>" +
      "<span class='np-time'>" + timeAgo(n.delivered_at) + "</span>" +
    "</div>";
  }).join("") : "<p class='empty-state'>No notifications</p>";
}

function updateNudgeBadge() {
  api("/nudges?limit=20").then(function(data) {
    if (!data) return;
    const unread = data.filter(function(n) { return !n.is_read; }).length;
    const badge = document.getElementById("nudgeCount");
    badge.textContent = unread;
    badge.style.display = unread > 0 ? "block" : "none";
  });
}

async function markRead(nudgeId) {
  await api("/nudges/" + nudgeId + "/read", { method: "PATCH" });
  loadNudges();
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const date = new Date(dateStr);
  const mins = Math.floor((now - date) / 60000);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

function getCategoryEmoji(category) {
  const emojis = { food: "🍔", transport: "🚗", shopping: "🛍️", entertainment: "🎬", bills: "💡", health: "🏥", education: "📚", groceries: "🛒", other: "📌" };
  return emojis[category] || "📌";
}

function openExpenseModal() {
  document.getElementById("expenseModal").classList.add("open");
  document.getElementById("expenseDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseDate").value = new Date().toISOString().split("T")[0];
}

async function submitExpense(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("expenseAmount").value);
  const category = document.getElementById("expenseCategory").value;
  const note = document.getElementById("expenseNote").value;
  const expenditure_date = document.getElementById("expenseDate").value;

  if (!amount || amount <= 0) { alert("Please enter a valid amount"); return; }
  if (!category) { alert("Please select a category"); return; }

  const data = await api("/expenditures", {
    method: "POST",
    body: JSON.stringify({ amount, category, note, expenditure_date }),
  });

  if (data) {
    closeModal("expenseModal");
    showNudgeToast({ title: "Expense Logged!", message: "RM " + amount.toFixed(2) + " recorded in " + category, priority: "normal" });
    loadDashboard();
    loadTodayExpenses();
  } else {
    alert("Failed to log expense. Please try again.");
  }
}

async function loadTodayExpenses() {
  const data = await api("/expenditures");
  if (!data) return;

  document.getElementById("todayExpenseTotal").textContent = "RM " + (data.totalToday || 0).toFixed(2);

  const list = document.getElementById("todayExpensesList");
  if (data.expenditures?.length > 0) {
    list.innerHTML = data.expenditures.map(function(e) {
      return "<div class='expense-item'>" +
        "<span class='expense-icon'>" + getCategoryEmoji(e.category) + "</span>" +
        "<div class='expense-details'>" +
          "<p class='expense-category'>" + e.category + "</p>" +
          "<p class='expense-note'>" + (e.note || "") + "</p>" +
        "</div>" +
        "<span class='expense-amount'>RM " + parseFloat(e.amount).toFixed(2) + "</span>" +
      "</div>";
    }).join("");
  } else {
    list.innerHTML = "<p class='empty-state'>No expenses logged today</p>";
  }
}

function openNewGoalModal() { document.getElementById("newGoalModal").classList.add("open"); }
function openNewRuleModal() { document.getElementById("newRuleModal").classList.add("open"); }
function openNewGroupModal() { document.getElementById("newGroupModal").classList.add("open"); }
function closeModal(modalId) { document.getElementById(modalId).classList.remove("open"); }

document.addEventListener("DOMContentLoaded", init);
