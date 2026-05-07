const API_BASE = "/api";
const AUTH_BASE = "/auth";
let socket = null;

const state = {
  user: null,
  token: null,
  currentTab: "dashboard",
};

function init() {
  const savedToken = localStorage.getItem("guga_token");
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
      localStorage.setItem("guga_token", data.token);
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
        gxbank_account_id: "GG-" + Date.now(),
      }),
    });
    const data = await res.json();
    if (data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("guga_token", data.token);
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
      localStorage.setItem("guga_token", data.token);
      const initials = (data.user.full_name || "?").substring(0, 2).toUpperCase();
      document.getElementById("userAvatar").textContent = initials;
      showMainApp();
    }
  } catch (err) {
    alert("Demo login failed. Make sure server is running");
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
      var pct = b.monthly_limit > 0 ? (b.current_spent / b.monthly_limit * 100) : 0;
      var barWidth = Math.min(pct, 150);
      var warnClass = pct > 100 ? " budget-exceeded" : pct > 75 ? " budget-warning" : "";
      return "<div class='budget-item" + warnClass + "'>" +
        "<div class='budget-header'>" +
          "<span class='budget-name'>" + b.category + "</span>" +
          "<span class='budget-amounts'>RM " + b.current_spent + " / RM " + b.monthly_limit + "</span>" +
        "</div>" +
        "<div class='budget-bar'><div class='budget-fill" + (warnClass.includes("exceeded") ? " budget-fill-exceeded" : warnClass ? " budget-fill-warning" : "") + "' style='width: " + barWidth + "%'></div></div>" +
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
  var now = new Date();
  loadCalendar(now.getFullYear(), now.getMonth() + 1);
  checkStreakAnimation(data.streak);
}

function renderStreakCalendar(streak) {
  const cal = document.getElementById("streakCalendar");
  if (!cal) return;
  const today = new Date();
  const days = [];
  const currentStreak = streak?.current_streak || 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayNames = ["S","M","T","W","T","F","S"];
    const dayName = dayNames[d.getDay()];
    const isToday = d.toDateString() === today.toDateString();
    const isActive = currentStreak > (6 - i);
    let cls = "streak-day";
    if (isActive) cls += " active";
    if (isToday) cls += " today";
    let label = dayName;
    const dayIndex = i;
    if (isActive && currentStreak - dayIndex === 7) label = "⭐";
    else if (isActive && currentStreak - dayIndex === 21) label = "👑";
    else if (isActive && currentStreak - dayIndex === 30) label = "💎";
    days.push("<div class='" + cls + "'>" + label + "</div>");
  }
  cal.innerHTML = days.join("");
  var milestoneEl = document.getElementById("streakMilestone");
  if (!milestoneEl) {
    milestoneEl = document.createElement("p");
    milestoneEl.id = "streakMilestone";
    milestoneEl.className = "streak-best";
    cal.parentElement.appendChild(milestoneEl);
  }
  var msg = "";
  if (currentStreak < 7) msg = (7 - currentStreak) + " more days to Week Warrior badge!";
  else if (currentStreak < 21) msg = (21 - currentStreak) + " more days to Habit Master badge!";
  else if (currentStreak < 30) msg = (30 - currentStreak) + " more days to Monthly Champion badge!";
  else msg = "💎 Monthly Champion achieved!";
  milestoneEl.textContent = msg;
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
      "<button class='btn-secondary' style='margin-top:12px;width:100%' onclick='openBadgeGallery()'>View All Badges</button>" +
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
      "<button class='delete-btn' onclick='deleteGoal(\"" + g.id + "\")' title='Delete goal'>🗑️</button>" +
    "</div>";
  }).join("");
}

async function deleteGoal(goalId) {
  if (!confirm("Delete this goal?")) return;
  var result = await api("/goals/" + goalId, { method: "DELETE" });
  if (result && result.success) {
    loadGoals();
  } else {
    showNudgeToast({ title: "Delete Failed", message: "Could not delete goal", priority: "high" });
  }
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

  html += "<div class='insight-card'><h3>Quick Actions</h3><div class='insight-actions'>" +
    "<button class='btn-secondary btn-sm' onclick='aiCreateBudget(\"food\", 500)'>Set Food Budget RM500</button>" +
    "<button class='btn-secondary btn-sm' onclick='aiEnableRoundUp()'>Enable Round-Up</button>" +
    "<button class='btn-secondary btn-sm' onclick='aiCreateGoal(\"Emergency Fund\", 10000)'>Set RM10K Goal</button>" +
  "</div></div>";

  content.innerHTML = html;
}

async function refreshInsights() {
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

  html += "<div class='insight-card'><h3>Quick Actions</h3><div class='insight-actions'>" +
    "<button class='btn-secondary btn-sm' onclick='aiCreateBudget(\"food\", 500)'>Set Food Budget RM500</button>" +
    "<button class='btn-secondary btn-sm' onclick='aiEnableRoundUp()'>Enable Round-Up</button>" +
    "<button class='btn-secondary btn-sm' onclick='aiCreateGoal(\"Emergency Fund\", 10000)'>Set RM10K Goal</button>" +
  "</div></div>";

  content.innerHTML = html;
}

async function loadRules() {
  const data = await api("/autosave/rules");
  if (data) renderRules(data);
}

function getRuleDescription(rule) {
  var config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
  switch (rule.rule_type) {
    case 'round_up':
      return 'Rounds up every purchase to the nearest RM1. Spare change goes to savings.';
    case 'salary_trigger':
      return 'Auto-saves ' + (config.percentage || 10) + '% of your salary when it arrives.';
    case 'fixed_schedule':
      return 'Saves RM' + (config.amount || 0) + ' on a ' + (config.frequency || 'weekly') + ' schedule.';
    case 'spending_threshold':
      return 'Saves the difference when you underspend your budget.';
    default:
      return 'Automated savings rule';
  }
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
          "<p class='rule-desc'>" + getRuleDescription(r) + "</p>" +
        "</div>" +
        "<button class='delete-btn' onclick='deleteRule(\"" + r.id + "\")' title='Delete rule'>🗑️</button>" +
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

async function deleteRule(ruleId) {
  if (!confirm("Delete this rule?")) return;
  await api("/autosave/rules/" + ruleId, { method: "DELETE" });
  loadRules();
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
  if (tabName === "social") loadSocialTab();
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

function checkStreakAnimation(streak) {
  var count = streak?.current_streak || 0;
  if (count <= 0) return;
  var today = new Date().toISOString().split("T")[0];
  var lastShown = localStorage.getItem("guga_last_streak_shown");
  if (lastShown === today) return;
  localStorage.setItem("guga_last_streak_shown", today);
  showStreakOverlay(count);
}

function showStreakOverlay(count) {
  var msg = "Keep it up!";
  if (count >= 30) msg = "Unstoppable!";
  else if (count >= 21) msg = "Habit formed!";
  else if (count >= 7) msg = "One week strong!";
  else if (count >= 1) msg = "Your journey begins!";
  document.getElementById("streakAnimCount").textContent = count;
  document.getElementById("streakAnimMsg").textContent = msg;
  document.getElementById("streakOverlay").classList.add("open");
  var container = document.getElementById("streakConfetti");
  container.innerHTML = "";
  var colors = ["#ef4444","#f59e0b","#10b981","#3b82f6","#a855f7","#ec4899"];
  for (var i = 0; i < 30; i++) {
    var p = document.createElement("div");
    p.className = "confetti-particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = Math.random() * 1.5 + "s";
    p.style.animationDuration = 2 + Math.random() * 1 + "s";
    container.appendChild(p);
  }
  var el = document.getElementById("streakAnimCount");
  var current = 0;
  var interval = setInterval(function() {
    current++;
    el.textContent = current;
    if (current >= count) clearInterval(interval);
  }, Math.max(20, 1000 / count));
}

function dismissStreakOverlay() {
  document.getElementById("streakOverlay").classList.remove("open");
  document.getElementById("streakConfetti").innerHTML = "";
}

async function markAllRead() {
  await api("/nudges/mark-all-read", { method: "PATCH" });
  loadNudges();
  updateNudgeBadge();
  showNudgeToast({ title: "All Clear!", message: "All notifications marked as read", priority: "normal" });
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
    if (document.getElementById("roundUpPanel")?.classList.contains("open")) {
      loadRoundUpStatus();
    }
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
        "<button class='delete-btn' onclick='deleteExpense(\"" + e.id + "\")'>🗑️</button>" +
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

var roundUpDemoInterval = null;
var stateAdviceData = null;
var _prevCompletedQuests = {};

function openAdvisor() {
  document.getElementById("advisorOverlay").classList.add("open");
  loadAdvice();
}

function closeAdvisor() {
  document.getElementById("advisorOverlay").classList.remove("open");
}

async function loadAdvice() {
  var data = await api("/advice");
  if (!data) return;
  stateAdviceData = data;
  renderAdviceTab("daily");
}

function switchAdvisorTab(period) {
  document.querySelectorAll(".advisor-tab").forEach(function(t) { t.classList.remove("active"); });
  document.getElementById("advTab" + period.charAt(0).toUpperCase() + period.slice(1)).classList.add("active");
  renderAdviceTab(period);
}

function renderAdviceTab(period) {
  var d = stateAdviceData;
  if (!d) return;
  var data = d[period];
  if (!data) return;
  var tip = data.tip || {};
  var tipPriority = tip.priority === "high" ? "danger" : tip.priority === "medium" ? "warning" : "success";
  var tipBorder = tip.priority === "high" ? "var(--danger)" : tip.priority === "medium" ? "var(--warning)" : "var(--success)";
  var content = document.getElementById("advisorContent");

  var html = '<div class="advisor-stat-card">' +
    '<p class="advisor-stat-label">Total Spent (' + period + ')</p>' +
    '<p class="advisor-stat-value">RM ' + (data.spent || 0).toFixed(2) + '</p>' +
  '</div>';

  if (period === "monthly" && d.monthly) {
    var rate = parseFloat(d.monthly.savingsRate) || 0;
    var gaugeColor = rate >= 20 ? "#10b981" : rate >= 10 ? "#f59e0b" : "#ef4444";
    html += '<div class="advisor-ring">' +
      '<div class="advisor-ring-circle" style="background: conic-gradient(' + gaugeColor + ' ' + rate + '%, var(--bg) ' + rate + '%);">' +
        '<span class="advisor-ring-value">' + rate + '%</span>' +
        '<span class="advisor-ring-label">Savings Rate</span>' +
      '</div>' +
    '</div>';
  }

  if (period === "annual" && d.annual && d.annual.projected) {
    html += '<div class="advisor-stat-card">' +
      '<p class="advisor-stat-label">Projected Annual Spend</p>' +
      '<p class="advisor-stat-value">RM ' + d.annual.projected.toFixed(2) + '</p>' +
    '</div>';
  }

  if (data.categories && data.categories.length > 0) {
    html += '<div class="advisor-categories"><h3>Category Breakdown</h3>';
    var vals = data.categories.map(function(c) { return parseFloat(c.total); });
    var max = Math.max.apply(null, vals) || 1;
    var colors = { food: "#ef4444", transport: "#3b82f6", shopping: "#a855f7", entertainment: "#f59e0b", bills: "#10b981", other: "#6b7280" };
    data.categories.forEach(function(c) {
      var pct = (parseFloat(c.total) / max * 100).toFixed(0);
      var color = colors[c.category] || colors.other;
      html += '<div class="chart-bar">' +
        '<span class="chart-label">' + c.category + '</span>' +
        '<div class="chart-track"><div class="chart-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<span class="chart-amount">RM' + parseFloat(c.total).toFixed(0) + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  if (tip && tip.title) {
    html += '<div class="advisor-tip-card" style="border-left-color: ' + tipBorder + '">' +
      '<span class="advisor-tip-priority advisor-tip-' + tipPriority + '">' + (tip.priority || "info").toUpperCase() + '</span>' +
      '<p class="advisor-tip-title">' + tip.title + '</p>' +
      '<p class="advisor-tip-text">' + (tip.message || "") + '</p>' +
    '</div>';
  }

  html += '<div class="advisor-meta">' +
    '<p>🔥 ' + (d.streak?.current_streak || 0) + ' day streak</p>' +
    '<p>🎯 ' + (d.goalCount || 0) + ' active goals</p>' +
  '</div>';

  content.innerHTML = html;
}

function openRoundUpPanel() {
  document.getElementById("roundUpPanel").classList.add("open");
  loadRoundUpStatus();
  animateRoundUpDemo();
}

function closeRoundUpPanel() {
  document.getElementById("roundUpPanel").classList.remove("open");
  if (roundUpDemoInterval) { clearInterval(roundUpDemoInterval); roundUpDemoInterval = null; }
}

async function loadRoundUpStatus() {
  var data = await api("/roundup/status");
  if (!data) return;
  document.getElementById("roundUpToggle").checked = data.enabled;
  document.getElementById("roundUpTotal").textContent = "RM " + (data.totalSaved || 0).toFixed(2);
  document.getElementById("roundUpCount").textContent = data.transactionCount || 0;
}

async function handleRoundUpToggle(enabled) {
  var data = await api("/roundup/toggle", { method: "POST", body: JSON.stringify({ enabled }) });
  if (data) {
    showNudgeToast({
      title: enabled ? "Round-Up Activated!" : "Round-Up Disabled",
      message: enabled ? "Your purchases will now round up to the nearest RM" : "Round-up savings turned off",
      priority: "normal",
    });
    loadRoundUpStatus();
  } else {
    document.getElementById("roundUpToggle").checked = !enabled;
  }
}

function animateRoundUpDemo() {
  var examples = [
    { spend: "RM 4.70", rounded: "RM 5.00", saved: "RM 0.30" },
    { spend: "RM 12.30", rounded: "RM 13.00", saved: "RM 0.70" },
    { spend: "RM 8.50", rounded: "RM 9.00", saved: "RM 0.50" },
  ];
  var idx = 0;
  var spendEl = document.getElementById("roundUpSpend");
  var roundedEl = document.getElementById("roundUpRounded");
  var savedEl = document.querySelector(".roundup-example-saved");
  var trail = document.getElementById("coinTrail");
  function showExample() {
    var ex = examples[idx];
    spendEl.textContent = ex.spend;
    roundedEl.textContent = ex.rounded;
    savedEl.textContent = ex.saved + " → Savings 🐷";
    for (var i = 0; i < 5; i++) {
      var coin = document.createElement("div");
      coin.className = "roundup-coin";
      coin.textContent = "🪙";
      coin.style.left = (20 + Math.random() * 60) + "%";
      coin.style.animationDelay = (i * 0.15) + "s";
      trail.appendChild(coin);
      setTimeout(function(c) { c.remove(); }, 1500, coin);
    }
    idx = (idx + 1) % examples.length;
  }
  showExample();
  roundUpDemoInterval = setInterval(showExample, 3000);
}

var audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  try {
    var ctx = getAudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.15;
    if (type === "badge") {
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } else if (type === "xp") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(554, ctx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "levelup") {
      osc.frequency.setValueAtTime(262, ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(392, ctx.currentTime + 0.3);
      osc.frequency.setValueAtTime(523, ctx.currentTime + 0.45);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.8);
    } else if (type === "quest") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1108, ctx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) { /* Audio not supported */ }
}

function showBadgeEarnedOverlay(badge) {
  document.getElementById("badgeEarnedIcon").textContent = getBadgeIcon(badge.badge_icon || "badge");
  document.getElementById("badgeEarnedName").textContent = badge.badge_name;
  document.getElementById("badgeEarnedDesc").textContent = badge.badge_description || "";
  document.getElementById("badgeOverlay").classList.add("open");
  playSound("badge");
  var container = document.getElementById("badgeParticles");
  container.innerHTML = "";
  var colors = ["#00d4aa","#10b981","#f59e0b","#a855f7","#3b82f6","#ef4444"];
  for (var i = 0; i < 20; i++) {
    var p = document.createElement("div");
    p.className = "confetti-particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.top = Math.random() * 100 + "%";
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = Math.random() * 0.5 + "s";
    p.style.animationDuration = 1.5 + Math.random() * 1 + "s";
    container.appendChild(p);
  }
  setTimeout(dismissBadgeOverlay, 3000);
}

function dismissBadgeOverlay() {
  document.getElementById("badgeOverlay").classList.remove("open");
}

async function openBadgeGallery() {
  var badges = await api("/badges");
  if (!badges) return;
  document.getElementById("badgeGalleryOverlay").classList.add("open");
  renderBadgeGallery(badges);
}

function renderBadgeGallery(badges) {
  var earnedCount = badges.filter(function(b) { return b.earned; }).length;
  document.getElementById("badgeGalleryCount").textContent = earnedCount + "/" + badges.length + " Collected";
  document.getElementById("badgeGalleryGrid").innerHTML = badges.map(function(b) {
    var cls = "badge-gallery-item" + (b.earned ? " earned" : " locked");
    var icon = b.earned ? getBadgeIcon(b.icon) : "🔒";
    var name = b.name;
    var desc = b.earned ? b.description : "???";
    var dateHtml = b.earned && b.earned_at ? "<p class='badge-gallery-date'>Earned: " + new Date(b.earned_at).toLocaleDateString() + "</p>" : "";
    return "<div class='" + cls + "'>" +
      "<div class='badge-gallery-icon'>" + icon + "</div>" +
      "<div class='badge-gallery-name'>" + name + "</div>" +
      "<div class='badge-gallery-desc'>" + desc + "</div>" +
      dateHtml +
    "</div>";
  }).join("");
}

function closeBadgeGallery() {
  document.getElementById("badgeGalleryOverlay").classList.remove("open");
}

var activeGroupId = null;

async function loadSocialTab() {
  var [quests, groups] = await Promise.all([
    api("/quests"),
    api("/groups"),
  ]);
  if (quests) renderQuests(quests);
  if (groups) renderGroups(groups);
}

function renderQuests(quests) {
  var list = document.getElementById("questsList");
  var active = Array.isArray(quests) ? quests.filter(function(q) { return !q.is_completed; }) : [];
  if (active.length === 0) {
    list.innerHTML = "<p class='empty-state'>No quests today</p>";
    return;
  }
  list.innerHTML = active.map(function(q) {
    var pct = q.target_value > 0 ? Math.min((q.current_value / q.target_value) * 100, 100) : 0;
    return "<div class='quest-card quest-pop'>" +
      "<div class='quest-header'>" +
        "<div class='quest-info'>" +
          "<h3 class='quest-title'>" + q.quest_title + "</h3>" +
          "<p class='quest-desc'>" + q.quest_description + "</p>" +
        "</div>" +
        "<span class='quest-xp'>+" + q.xp_reward + " XP</span>" +
      "</div>" +
      "<div class='quest-bar'><div class='quest-fill' style='width:" + pct + "%'></div></div>" +
      "<p class='quest-progress-text'>" + (q.current_value || 0) + " / " + q.target_value + "</p>" +
    "</div>";
  }).join("");

  if (Array.isArray(quests)) {
    quests.forEach(function(q) {
      if (q.is_completed && !_prevCompletedQuests[q.quest_key]) {
        _prevCompletedQuests[q.quest_key] = true;
        playSound("quest");
        showNudgeToast({ title: "Quest Complete!", message: "+" + q.xp_reward + " XP", priority: "normal" });
      }
      if (!q.is_completed) delete _prevCompletedQuests[q.quest_key];
    });
  }
}

function renderGroups(groups) {
  if (!Array.isArray(groups)) return;
  var myGroups = groups.filter(function(g) { return g.is_member; });
  var discoverGroups = groups.filter(function(g) { return !g.is_member; });
  document.getElementById("myGroupsList").innerHTML = myGroups.length > 0
    ? myGroups.map(function(g) { return groupCard(g, true); }).join("")
    : "<p class='empty-state'>You haven't joined any clans yet</p>";
  document.getElementById("discoverGroupsList").innerHTML = discoverGroups.length > 0
    ? discoverGroups.map(function(g) { return groupCard(g, false); }).join("")
    : "<p class='empty-state'>No clans to discover</p>";
}

function groupCard(g, isMember) {
  return "<div class='group-card'>" +
    "<div class='group-card-header'>" +
      "<span class='group-icon'>🛡️</span>" +
      "<div class='group-card-info'>" +
        "<h3>" + g.name + "</h3>" +
        "<p class='group-meta'>" + (g.member_count || 0) + " members" + (g.goal_type ? " • " + g.goal_type : "") + "</p>" +
      "</div>" +
    "</div>" +
    "<p class='group-desc'>" + (g.description || "") + "</p>" +
    "<div class='group-card-actions'>" +
      (isMember
        ? "<button class='btn-secondary' onclick='openGroupDetail(\"" + g.id + "\")'>Open</button><button class='delete-btn' onclick='leaveGroup(\"" + g.id + "\")'>Leave</button>"
        : "<button class='btn-primary' onclick='joinGroup(\"" + g.id + "\")'>Join</button>") +
    "</div>" +
  "</div>";
}

async function aiCreateBudget(category, limit) {
  var data = await api("/ai/action", {
    method: "POST",
    body: JSON.stringify({ action: "create_budget", category, limit }),
  });
  if (data) showNudgeToast({ title: "Budget Set!", message: "RM" + limit + " budget for " + category, priority: "normal" });
}

async function aiEnableRoundUp() {
  var data = await api("/ai/action", {
    method: "POST",
    body: JSON.stringify({ action: "enable_roundup" }),
  });
  if (data) showNudgeToast({ title: "Round-Up Enabled!", message: "Your purchases will now round up to savings", priority: "normal" });
}

async function aiCreateGoal(name, amount) {
  var data = await api("/ai/action", {
    method: "POST",
    body: JSON.stringify({ action: "create_goal", name, amount }),
  });
  if (data) showNudgeToast({ title: "Goal Created!", message: name + " - RM" + amount, priority: "normal" });
}

async function deleteExpense(expenseId) {
  if (!confirm("Delete this expense?")) return;
  var result = await api("/expenditures/" + expenseId, { method: "DELETE" });
  if (result && result.success) {
    loadDashboard();
  } else {
    showNudgeToast({ title: "Delete Failed", message: "Could not delete expense", priority: "high" });
  }
}

async function leaveGroup(groupId) {
  if (!confirm("Leave this group?")) return;
  var result = await api("/groups/" + groupId + "/leave", { method: "DELETE" });
  if (result && result.success) {
    loadSocialTab();
  } else {
    showNudgeToast({ title: "Leave Failed", message: "Could not leave group", priority: "high" });
  }
}

async function joinGroup(groupId) {
  var data = await api("/groups/" + groupId + "/join", { method: "POST" });
  if (data) {
    showNudgeToast({ title: "Joined Clan!", message: "You're now a member", priority: "normal" });
    loadSocialTab();
  }
}

async function openGroupDetail(groupId) {
  activeGroupId = groupId;
  document.getElementById("groupDetailOverlay").classList.add("open");
  var group = (await api("/groups")).find(function(g) { return g.id === groupId; });
  document.getElementById("groupDetailName").textContent = group ? group.name : "Group";
  switchGroupTab("chat");
}

function closeGroupDetail() {
  document.getElementById("groupDetailOverlay").classList.remove("open");
  activeGroupId = null;
}

function switchGroupTab(tab) {
  document.querySelectorAll(".gd-tab").forEach(function(t) { t.classList.remove("active"); });
  var tabs = { chat: 0, members: 1, leaderboard: 2 };
  var btns = document.querySelectorAll(".gd-tab");
  if (btns[tabs[tab]]) btns[tabs[tab]].classList.add("active");
  document.getElementById("chatInputBar").style.display = tab === "chat" ? "flex" : "none";
  var content = document.getElementById("groupDetailContent");
  if (tab === "chat") {
    content.innerHTML = "<p class='empty-state'>Loading chat...</p>";
    api("/groups/" + activeGroupId + "/messages").then(function(data) {
      renderChat(data || []);
    });
  } else if (tab === "members") {
    content.innerHTML = "<p class='empty-state'>Loading members...</p>";
    api("/groups/" + activeGroupId + "/members").then(function(data) {
      renderMembers(data || []);
    });
  } else if (tab === "leaderboard") {
    content.innerHTML = "<p class='empty-state'>Loading leaderboard...</p>";
    api("/groups/" + activeGroupId + "/leaderboard").then(function(data) {
      renderGroupLeaderboard(data || []);
    });
  }
}

function renderChat(messages) {
  var content = document.getElementById("groupDetailContent");
  if (messages.length === 0) {
    content.innerHTML = "<div class='chat-messages'><p class='empty-state'>No messages yet. Say hello!</p></div>";
    return;
  }
  var userId = state.user?.id;
  var html = "<div class='chat-messages'>";
  messages.forEach(function(m) {
    var isOwn = m.user_id === userId;
    var nameTag = (m.full_name || "Unknown") + (m.is_npc ? " 🤖" : "");
    html += "<div class='chat-msg" + (isOwn ? " chat-msg-own" : "") + "'>" +
      (!isOwn ? "<span class='chat-msg-author'>" + nameTag + "</span>" : "") +
      "<div class='chat-msg-bubble'>" + m.message + "</div>" +
      "<span class='chat-msg-time'>" + timeAgo(m.sent_at) + "</span>" +
    "</div>";
  });
  html += "</div>";
  content.innerHTML = html;
  content.scrollTop = content.scrollHeight;
}

async function sendMessage() {
  var input = document.getElementById("chatInput");
  var msg = input.value.trim();
  if (!msg || !activeGroupId) return;
  input.value = "";
  await api("/groups/" + activeGroupId + "/messages", {
    method: "POST",
    body: JSON.stringify({ message: msg }),
  });
  switchGroupTab("chat");
}

function renderMembers(members) {
  var content = document.getElementById("groupDetailContent");
  if (members.length === 0) {
    content.innerHTML = "<p class='empty-state'>No members</p>";
    return;
  }
  var html = "<div class='members-list'>";
  members.forEach(function(m) {
    var nameTag = m.full_name + (m.is_npc ? " 🤖" : "");
    html += "<div class='member-item'>" +
      "<div class='member-avatar'>" + (m.full_name || "?").substring(0, 2).toUpperCase() + "</div>" +
      "<div class='member-info'>" +
        "<p class='member-name'>" + nameTag + "</p>" +
        "<p class='member-stats'>Level " + (m.level || 1) + " • " + (m.streak || 0) + " day streak</p>" +
      "</div>" +
      "<span class='member-level-badge'>Lv" + (m.level || 1) + "</span>" +
    "</div>";
  });
  html += "</div>";
  content.innerHTML = html;
}

function renderGroupLeaderboard(data) {
  var content = document.getElementById("groupDetailContent");
  if (data.length === 0) {
    content.innerHTML = "<p class='empty-state'>No leaderboard data</p>";
    return;
  }
  var medals = ["🥇", "🥈", "🥉"];
  var html = "<div class='leaderboard-list'>";
  data.forEach(function(m, i) {
    var rank = i + 1;
    var medal = i < 3 ? "<span class='rank-medal'>" + medals[i] + "</span>" : "<span class='rank-num'>" + rank + "</span>";
    html += "<div class='leaderboard-item rank-" + rank + "'>" +
      medal +
      "<span class='lb-name'>" + m.full_name + "</span>" +
      "<span class='lb-saved'>RM " + parseFloat(m.total_saved || 0).toFixed(2) + "</span>" +
    "</div>";
  });
  html += "</div>";
  content.innerHTML = html;
}

var calendarDate = new Date();

function loadCalendar(year, month) {
  var m = (month < 10 ? "0" : "") + month;
  api("/calendar?month=" + year + "-" + m).then(function(data) {
    if (!data) return;
    var grid = document.getElementById("calendarGrid");
    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.getElementById("calendarMonth").textContent = monthNames[month - 1] + " " + year;
    var daysMap = {};
    if (data.days) {
      data.days.forEach(function(d) { daysMap[d.date] = d; });
    }
    var firstDay = new Date(year, month - 1, 1).getDay();
    var daysInMonth = new Date(year, month, 0).getDate();
    var today = new Date();
    var todayStr = today.getFullYear() + "-" + ((today.getMonth() + 1) < 10 ? "0" : "") + (today.getMonth() + 1) + "-" + (today.getDate() < 10 ? "0" : "") + today.getDate();
    var html = "";
    var dayLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    dayLabels.forEach(function(l) { html += "<div class='cal-day-label'>" + l + "</div>"; });
    for (var i = 0; i < firstDay; i++) {
      html += "<div class='cal-day empty'></div>";
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = year + "-" + m + "-" + (d < 10 ? "0" : "") + d;
      var dayData = daysMap[dateStr];
      var cls = "cal-day";
      if (dayData) cls += " " + dayData.status;
      if (dateStr === todayStr) cls += " today";
      var label = dayData ? "RM" + dayData.spent.toFixed(0) : "";
      html += "<div class='" + cls + "' onclick='openDayDetail(\"" + dateStr + "\")' title='" + label + "'>" + d + "</div>";
    }
    grid.innerHTML = html;
  });
}

function prevMonth() {
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  loadCalendar(calendarDate.getFullYear(), calendarDate.getMonth() + 1);
}

function nextMonth() {
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  loadCalendar(calendarDate.getFullYear(), calendarDate.getMonth() + 1);
}

function openDayDetail(dateStr) {
  document.getElementById("dayDetailPanel").classList.add("open");
  document.getElementById("dayDetailTitle").textContent = dateStr;
  document.getElementById("dayDetailBody").innerHTML = "<p class='day-detail-empty'>Loading...</p>";
  api("/calendar/day?date=" + dateStr).then(function(data) {
    if (!data) { document.getElementById("dayDetailBody").innerHTML = "<p class='day-detail-empty'>No data</p>"; return; }
    var html = "";
    var allItems = [];
    if (data.expenditures) {
      data.expenditures.forEach(function(e) {
        allItems.push({ icon: getCategoryEmoji(e.category), desc: e.category + (e.note ? " - " + e.note : ""), amount: e.amount });
      });
    }
    if (data.transactions) {
      data.transactions.forEach(function(t) {
        allItems.push({ icon: getCategoryEmoji(t.category), desc: t.merchant + " - " + (t.description || ""), amount: t.amount });
      });
    }
    if (allItems.length === 0) {
      html += "<p class='day-detail-empty'>No spending on this day</p>";
    } else {
      html += "<div class='expense-list'>";
      allItems.forEach(function(item) {
        html += "<div class='expense-item'>" +
          "<span class='expense-icon'>" + item.icon + "</span>" +
          "<div class='expense-details'><p class='expense-category'>" + item.desc + "</p></div>" +
          "<span class='expense-amount'>RM " + parseFloat(item.amount).toFixed(2) + "</span>" +
        "</div>";
      });
      html += "</div>";
    }
    html += "<div class='day-detail-saved'>💰 Saved: <span>RM " + (data.totalSaved || 0).toFixed(2) + "</span></div>";
    document.getElementById("dayDetailBody").innerHTML = html;
  });
}

function closeDayDetail() {
  document.getElementById("dayDetailPanel").classList.remove("open");
}

document.addEventListener("DOMContentLoaded", init);
