const API_BASE = "/api";
const AUTH_BASE = "/auth";
function malaysiaDate(offsetDays) {
  var d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
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
    var data = await res.json();
    data._status = res.status;
    return data;
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

  connectSocket();
  updateNudgeBadge();
  loadGamification();
  loadTodayExpenses();
  loadPetStatus();
}

async function loadSavings() {
  const data = await api("/dashboard");
  if (!data) return;

  document.getElementById("savingsAccountBalance").textContent = "RM " + (data.totalSavings || 0).toLocaleString();
  document.getElementById("savingsStreakCount").textContent = data.streak?.current_streak || 0;
  document.getElementById("savingsBestStreak").textContent = data.streak?.longest_streak || 0;

  renderSavingsStreakCalendar(data.streak);

  const budgetList = document.getElementById("savingsBudgetList");
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
  } else {
    budgetList.innerHTML = "<p class='empty-state'>No budgets set</p>";
  }

  if (data.monthlySpending?.length > 0) {
    renderSavingsSpendingChart(data.monthlySpending);
  }

  if (data.goals?.length > 0) {
    renderGoals(data.goals);
  }

  var now = new Date();
  loadSavingsCalendar(now.getFullYear(), now.getMonth() + 1);
  checkStreakAnimation(data.streak);
  loadFixedExpenses();
  loadAutopilot();
}

function renderSavingsStreakCalendar(streak) {
  const cal = document.getElementById("savingsStreakCalendar");
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
  var milestoneEl = document.getElementById("savingsStreakMilestone");
  if (!milestoneEl) {
    milestoneEl = document.createElement("p");
    milestoneEl.id = "savingsStreakMilestone";
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

function renderSavingsSpendingChart(categories) {
  const chart = document.getElementById("savingsSpendingChart");
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

var savingsCalendarDate = new Date();

function loadSavingsCalendar(year, month) {
  var m = (month < 10 ? "0" : "") + month;
  api("/calendar?month=" + year + "-" + m).then(function(data) {
    if (!data) return;
    var grid = document.getElementById("savingsCalendarGrid");
    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.getElementById("savingsCalendarMonth").textContent = monthNames[month - 1] + " " + year;
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
    var incomeEl = document.getElementById("calendarLastMonthIncome");
    if (incomeEl && data.lastMonthIncome !== undefined) {
      incomeEl.textContent = "Last month income: RM " + data.lastMonthIncome.toFixed(2);
    }
  });
}

function prevMonthSavings() {
  savingsCalendarDate.setMonth(savingsCalendarDate.getMonth() - 1);
  loadSavingsCalendar(savingsCalendarDate.getFullYear(), savingsCalendarDate.getMonth() + 1);
}

function nextMonthSavings() {
  savingsCalendarDate.setMonth(savingsCalendarDate.getMonth() + 1);
  loadSavingsCalendar(savingsCalendarDate.getFullYear(), savingsCalendarDate.getMonth() + 1);
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
    document.getElementById("newGroupForm").reset();
    showNudgeToast({ title: "Clan Created!", message: "Your new savings clan is ready", priority: "normal" });
    loadSocialTab();
  }
}

function showTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(function(tab) { tab.classList.remove("active"); });
  document.querySelectorAll(".nav-item").forEach(function(nav) { nav.classList.remove("active"); });

  const targetTab = document.getElementById(tabName + "Tab");
  if (targetTab) targetTab.classList.add("active");

  const navItems = document.querySelectorAll(".nav-item");
  const tabMap = { dashboard: 0, savings: 1, goals: 2, insights: 3, autosave: 4, social: 5 };
  if (navItems[tabMap[tabName]]) navItems[tabMap[tabName]].classList.add("active");

  state.currentTab = tabName;

  if (tabName === "savings") loadSavings();
  if (tabName === "goals") loadGoals();
  if (tabName === "autosave") loadRules();
  if (tabName === "social") loadSocialTab();
  if (tabName === "insights") loadAchievements();
}

async function loadAchievements() {
  await Promise.all([
    loadGamification(),
    refreshResilience(),
    runDebtRiskScan(),
    loadAdaptiveNudges(),
    loadInterventionOutcomes(),
    loadMicroLearning(),
    loadGXBankStory(),
    loadInsights(),
  ]);
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
  var today = malaysiaDate();
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
  document.getElementById("expenseDate").value = malaysiaDate();
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseDate").value = malaysiaDate();
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
    loadAutopilot();
    if (document.getElementById("roundUpPanel")?.classList.contains("open")) {
      loadRoundUpStatus();
    }
    var roundUp = Math.ceil(amount) - amount;
    if (roundUp >= 0.05) {
      addPiggyBankRoundUp(roundUp, data.id || null, "Round-up from " + category);
    }
    recordAutopilotSpending(amount);
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
var selectedAddMethod = "";
function openAddMoneyModal() {
  selectedAddMethod = "";
  document.getElementById("addMoneyAmount").value = "";
  document.getElementById("addMoneyNote").value = "";
  document.getElementById("addMoneyMethodStep").style.display = "block";
  document.getElementById("addMoneyAmountStep").style.display = "none";
  document.getElementById("addMoneyModal").classList.add("open");
}
function selectAddMethod(method) {
  selectedAddMethod = method;
  document.getElementById("addMoneyMethodLabel").innerHTML = "Add money via <strong>" + method + "</strong>";
  document.getElementById("addMoneyMethodStep").style.display = "none";
  document.getElementById("addMoneyAmountStep").style.display = "block";
}
function backAddMethod() {
  document.getElementById("addMoneyAmountStep").style.display = "none";
  document.getElementById("addMoneyMethodStep").style.display = "block";
}
function handleAddMoney() {
  var amount = parseFloat(document.getElementById("addMoneyAmount").value);
  if (!amount || amount <= 0) { alert("Please enter a valid amount"); return; }
  var note = document.getElementById("addMoneyNote").value || "Manual top-up";
  api("/transactions", {
    method: "POST",
    body: JSON.stringify({ amount: amount, type: "credit", merchant: note, category: "other", description: note, transaction_date: malaysiaDate() })
  }).then(function(resp) {
    if (resp && resp.error) { alert("Error: " + resp.error); return; }
    if (resp && (resp.id || resp._status === 201)) {
      closeModal("addMoneyModal");
      loadSavings();
      loadTodayExpenses();
    } else {
      alert("Failed to add money. Try again.");
    }
  });
}
function openTransactionModal() {
  document.getElementById("transactionModal").classList.add("open");
  document.getElementById("transactionList").innerHTML = "<p class='empty-state'>Loading...</p>";
  loadTransactionHistory();
}
function loadTransactionHistory() {
  api("/transactions?limit=50").then(function(data) {
    var list = document.getElementById("transactionList");
    if (!data || data.length === 0) {
      list.innerHTML = "<p class='empty-state'>No transactions yet</p>";
      return;
    }
    var html = "";
    data.forEach(function(t) {
      var icon = t.type === "credit" ? "📈" : "📉";
      var cls = t.type === "credit" ? "txn-credit" : "txn-debit";
      html += "<div class='txn-item " + cls + "'>" +
        "<span class='txn-icon'>" + icon + "</span>" +
        "<div class='txn-info'><p class='txn-desc'>" + (t.merchant || t.description || "Transaction") + "</p>" +
        "<p class='txn-date'>" + (t.transaction_date || "").slice(0, 10) + "</p></div>" +
        "<span class='txn-amount'>" + (t.type === "credit" ? "+" : "-") + "RM " + parseFloat(t.amount).toFixed(2) + "</span>" +
      "</div>";
    });
    list.innerHTML = html;
  });
}
function closeModal(modalId) { document.getElementById(modalId).classList.remove("open"); }

function openSendMoneyModal() {
  document.getElementById("sendPhone").value = "";
  document.getElementById("sendAmount").value = "";
  document.getElementById("sendNote").value = "";
  document.getElementById("qrResult").textContent = "";
  document.getElementById("sendMoneyModal").classList.add("open");
  switchSendTab("phone");
}

function switchSendTab(tab) {
  document.getElementById("sendPhoneForm").style.display = tab === "phone" ? "block" : "none";
  document.getElementById("sendQrForm").style.display = tab === "qr" ? "block" : "none";
  document.getElementById("sendPhoneTab").className = "send-tab" + (tab === "phone" ? " active" : "");
  document.getElementById("sendQrTab").className = "send-tab" + (tab === "qr" ? " active" : "");
  if (tab === "qr") stopQrScanner();
}

var qrStream = null;
function startQrScanner() {
  var video = document.getElementById("qrVideo");
  var canvas = document.getElementById("qrCanvas");
  var result = document.getElementById("qrResult");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    result.textContent = "Camera not available on this device";
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function(s) {
    qrStream = s;
    video.srcObject = s;
    video.style.display = "block";
    video.play();
    scanQrFrame();
  }).catch(function() {
    result.textContent = "Camera permission denied";
  });
}
function scanQrFrame() {
  var video = document.getElementById("qrVideo");
  var canvas = document.getElementById("qrCanvas");
  var result = document.getElementById("qrResult");
  if (!video.videoWidth) { setTimeout(scanQrFrame, 500); return; }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  var imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  var code = jsQR(imageData.data, imageData.width, imageData.height);
  if (code) {
    result.textContent = "QR detected successfully ✅";
    stopQrScanner();
  } else {
    setTimeout(scanQrFrame, 500);
  }
}
function stopQrScanner() {
  if (qrStream) { qrStream.getTracks().forEach(function(t) { t.stop(); }); qrStream = null; }
  document.getElementById("qrVideo").style.display = "none";
}
function handleSendMoney() {
  var phone = document.getElementById("sendPhone").value.trim();
  var amount = parseFloat(document.getElementById("sendAmount").value);
  if (!phone) { alert("Please enter a phone number or scan a QR code"); return; }
  if (!amount || amount <= 0) { alert("Please enter a valid amount"); return; }
  var note = document.getElementById("sendNote").value || ("Sent to " + phone);
  api("/transactions", {
    method: "POST",
    body: JSON.stringify({ amount: amount, type: "debit", merchant: note, category: "transfer", description: "Send to " + phone + (note ? " - " + note : ""), transaction_date: malaysiaDate() })
  }).then(function(resp) {
    if (resp && resp.error) { alert("Error: " + resp.error); return; }
    if (resp && (resp.id || resp._status === 201)) {
      closeModal("sendMoneyModal");
      loadSavings();
      loadTodayExpenses();
    } else {
      alert("Failed to send money. Server returned: " + JSON.stringify(resp));
    }
  });
}

function openFixedExpensesModal() {
  document.getElementById("fixedExpensesModal").classList.add("open");
  loadFixedExpenses();
}
function loadFixedExpenses() {
  api("/fixed-expenses/record", { method: "POST" }).then(function(r) {
    if (r && r.recorded > 0) { loadTodayExpenses(); loadSavings(); }
  });
  api("/fixed-expenses").then(function(data) {
    var list = document.getElementById("fixedExpensesList");
    var barTotal = document.getElementById("fixedExpensesTotal");
    if (!data || data.error || data.length === 0) {
      if (list) list.innerHTML = "<p class='empty-state'>No fixed expenses yet. Add one below.</p>";
      if (barTotal) barTotal.textContent = "RM 0";
      return;
    }
    var total = 0;
    data.forEach(function(f) { total += parseFloat(f.amount); });
    if (barTotal) barTotal.textContent = "RM " + total.toFixed(2);
    if (!list) return;
    var html = "";
    var emoji = { bills: "💡", housing: "🏠", transport: "🚗", subscription: "📺", insurance: "🛡️", other: "📌" };
    data.forEach(function(f) {
      html += "<div class='fixed-item'><span class='fixed-icon'>" + (emoji[f.category] || "📌") + "</span><div class='fixed-info'><p class='fixed-name'>" + f.name + "</p><p class='fixed-due'>Due: day " + (f.due_day || "any") + "</p></div><span class='fixed-amount'>RM " + parseFloat(f.amount).toFixed(2) + "</span><button class='fixed-delete' onclick='deleteFixedExpense(\"" + f.id + "\")'>✕</button></div>";
    });
    html += "<div class='fixed-total'><span>Total Monthly</span><span>RM " + total.toFixed(2) + "</span></div>";
    list.innerHTML = html;
  });
}
function handleAddFixedExpense() {
  var name = document.getElementById("fixedName").value.trim();
  var amount = parseFloat(document.getElementById("fixedAmount").value);
  var category = document.getElementById("fixedCategory").value;
  var dueDay = parseInt(document.getElementById("fixedDueDay").value) || null;
  if (!name) { alert("Please enter a name"); return; }
  if (!amount || amount <= 0) { alert("Please enter a valid amount"); return; }
  api("/fixed-expenses", {
    method: "POST",
    body: JSON.stringify({ name: name, amount: amount, category: category, due_day: dueDay })
  }).then(function(resp) {
    if (resp && resp.error) { alert("Error: " + resp.error); return; }
    document.getElementById("fixedName").value = "";
    document.getElementById("fixedAmount").value = "";
    document.getElementById("fixedDueDay").value = "";
    loadFixedExpenses();
  });
}
function deleteFixedExpense(id) {
  api("/fixed-expenses/" + id, { method: "DELETE" }).then(function(resp) {
    if (resp && resp.success) loadFixedExpenses();
  });
}

function loadAutopilot() {
  api("/autopilot/status").then(function(data) {
    if (!data) return;
    var content = document.getElementById("autopilotContent");
    var toggleBtn = document.getElementById("autopilotToggleBtn");
    if (!content) return;
    if (data.settings && data.settings.is_active) {
      if (toggleBtn) toggleBtn.textContent = "Deactivate";
      renderAutopilotActive(data);
    } else if (data.settings && !data.settings.is_active) {
      if (toggleBtn) toggleBtn.textContent = "Reactivate";
      content.innerHTML =
        "<p class='empty-state'>Autopilot is paused. Reactivate to resume automatic daily limits and partitioning.</p>" +
        "<button class='btn-primary full-width' onclick='openAutopilotSetup()'>Reactivate Autopilot</button>";
    } else {
      if (toggleBtn) toggleBtn.textContent = "Set Up";
      content.innerHTML =
        "<p class='empty-state'>Set up your Autopilot Savings Plan to automatically manage your daily spending, savings partitioning, and round-ups.</p>" +
        "<button class='btn-primary full-width' onclick='openAutopilotSetup()'>Set Up Autopilot</button>";
    }
  });
}

function renderAutopilotActive(data) {
  var s = data.settings;
  var daily = data.dailyLog;
  var content = document.getElementById("autopilotContent");
  var daysInMonth = new Date().getDate();
  var baseDaily = s.daily_spending_total / daysInMonth;
  var todaySpent = daily ? daily.spent : 0;
  var todayLimit = daily ? daily.daily_limit : baseDaily;
  var remaining = todayLimit - todaySpent;
  var spentPct = todayLimit > 0 ? Math.min(100, (todaySpent / todayLimit * 100)) : 0;

  var html = "";
  html += "<div class='ap-cards'>";

  html += "<div class='ap-card ap-card-daily'>";
  html += "<div class='ap-card-header'>📊 Today's Budget</div>";
  html += "<div class='ap-daily-numbers'><div class='ap-number'><span class='ap-label'>Limit</span><span class='ap-value'>RM " + todayLimit.toFixed(2) + "</span></div><div class='ap-number'><span class='ap-label'>Spent</span><span class='ap-value'>RM " + todaySpent.toFixed(2) + "</span></div><div class='ap-number'><span class='ap-label'>Left</span><span class='ap-value" + (remaining < 0 ? ' text-danger' : ' text-success') + "'>RM " + remaining.toFixed(2) + "</span></div></div>";
  html += "<div class='ap-bar'><div class='ap-bar-fill' style='width:" + spentPct + "%'></div></div>";
  if (daily && daily.rolled_over > 0) html += "<p class='ap-rollover'>+ RM " + daily.rolled_over.toFixed(2) + " rolled over from yesterday</p>";
  html += "</div>";

  html += "<div class='ap-card ap-card-partition'>";
  html += "<div class='ap-card-header'>📦 Monthly Partition</div>";
  html += "<div class='ap-partition-item'><span>Last Month Income</span><span>RM " + parseFloat(s.last_month_income).toFixed(2) + "</span></div>";
  html += "<div class='ap-partition-item'><span>🔒 Emergency (" + s.emergency_fund_pct + "%)</span><span class='ap-emergency'>RM " + (s.last_month_income * s.emergency_fund_pct / 100).toFixed(2) + "</span></div>";
  html += "<div class='ap-partition-item'><span>🎯 Savings Goals (" + s.savings_goals_pct + "%)</span><span class='ap-goals'>RM " + (s.last_month_income * s.savings_goals_pct / 100).toFixed(2) + "</span></div>";
  html += "<div class='ap-partition-item'><span>📋 Fixed Bills</span><span class='ap-bills'>RM " + parseFloat(s.fixed_bills_monthly).toFixed(2) + "</span></div>";
  html += "<div class='ap-partition-divider'></div>";
  html += "<div class='ap-partition-item ap-daily-row'><span>💰 Daily Spending Pool</span><span>RM " + parseFloat(s.daily_spending_total).toFixed(2) + "</span></div>";
  html += "<p class='ap-perday'>RM " + baseDaily.toFixed(2) + " / day</p>";
  html += "</div>";

  html += "<div class='ap-card ap-card-piggy'>";
  html += "<div class='ap-card-header'>🐖 Painless Piggy Bank</div>";
  html += "<div class='ap-piggy-total'>RM " + (data.piggyBankTotal || 0).toFixed(2) + "</div>";
  html += "<p class='ap-piggy-hint'>Round-ups from daily spending collect here. Use it to reward yourself or boost your Emergency Fund.</p>";
  html += "</div>";

  html += "</div>";
  content.innerHTML = html;
}

function openAutopilotSetup() {
  api("/autopilot/status").then(function(data) {
    if (!data) return;
    var income = document.getElementById("apIncome");
    var emergencyPct = document.getElementById("apEmergencyPct");
    var savingsPct = document.getElementById("apSavingsPct");
    var bills = document.getElementById("apBills");
    income.value = 5000;
    if (data.lastMonthIncome > 5000) income.value = data.lastMonthIncome;
    if (data.settings && data.settings.last_month_income > 5000) income.value = data.settings.last_month_income;
    if (data.settings) {
      emergencyPct.value = data.settings.emergency_fund_pct;
      savingsPct.value = data.settings.savings_goals_pct;
    }
    api("/fixed-expenses").then(function(expenses) {
      var total = 0;
      if (expenses && !expenses.error) {
        expenses.forEach(function(f) { total += parseFloat(f.amount) || 0; });
      }
      bills.value = total || (data.settings ? data.settings.fixed_bills_monthly : 0);
      updateApPreview();
    });
    emergencyPct.oninput = updateApPreview;
    savingsPct.oninput = updateApPreview;
    document.getElementById("autopilotSetupModal").classList.add("open");
  });
}

function updateApPreview() {
  var income = parseFloat(document.getElementById("apIncome").value) || 0;
  var emergencyPct = parseFloat(document.getElementById("apEmergencyPct").value) || 0;
  var savingsPct = parseFloat(document.getElementById("apSavingsPct").value) || 0;
  var bills = parseFloat(document.getElementById("apBills").value) || 0;
  var preview = document.getElementById("apPreview");

  if (income > 0) {
    preview.style.display = "block";
    document.getElementById("apPreviewIncome").textContent = "RM " + income.toFixed(2);
    document.getElementById("apPreviewEmergency").textContent = "RM " + (income * emergencyPct / 100).toFixed(2);
    document.getElementById("apPreviewGoals").textContent = "RM " + (income * savingsPct / 100).toFixed(2);
    document.getElementById("apPreviewBills").textContent = "RM " + bills.toFixed(2);
    var dailyPool = income - (income * emergencyPct / 100) - (income * savingsPct / 100) - bills;
    document.getElementById("apPreviewDaily").textContent = "RM " + Math.max(0, dailyPool).toFixed(2);
  } else {
    preview.style.display = "none";
  }
}

function saveAutopilotSetup() {
  var income = parseFloat(document.getElementById("apIncome").value);
  var emergencyPct = parseFloat(document.getElementById("apEmergencyPct").value) || 10;
  var savingsPct = parseFloat(document.getElementById("apSavingsPct").value) || 10;
  var bills = parseFloat(document.getElementById("apBills").value) || 0;
  if (!income || income <= 0) { alert("Please enter your last month's income"); return; }

  api("/autopilot/setup", {
    method: "POST",
    body: JSON.stringify({
      lastMonthIncome: income,
      emergencyFundPct: emergencyPct,
      savingsGoalsPct: savingsPct,
      fixedBillsMonthly: bills
    })
  }).then(function(resp) {
    if (!resp) { alert("Failed to connect to server"); return; }
    if (resp.error) { alert("Error: " + resp.error); return; }
    closeModal("autopilotSetupModal");
    showNudgeToast({ title: "Autopilot Activated!", message: "Your savings plan is now running.", priority: "normal" });
    loadAutopilot();
    showTab("goals");
  });
}

function toggleAutopilot() {
  api("/autopilot/status").then(function(data) {
    if (!data) return;
    if (!data.settings) { openAutopilotSetup(); return; }
    var isActive = data.settings.is_active ? false : true;
    api("/autopilot/toggle", {
      method: "PATCH",
      body: JSON.stringify({ isActive: isActive })
    }).then(function(resp) {
      if (resp && resp.success) {
        loadAutopilot();
        if (!isActive) showNudgeToast({ title: "Autopilot Paused", message: "Your savings plan has been paused.", priority: "normal" });
      }
    });
  });
}

function recordAutopilotSpending(amount) {
  api("/autopilot/record-spending", {
    method: "POST",
    body: JSON.stringify({ amount: amount })
  });
}

function addPiggyBankRoundUp(amount, sourceTxnId, description) {
  api("/autopilot/piggy-bank", {
    method: "POST",
    body: JSON.stringify({ amount: amount, sourceTxnId: sourceTxnId, description: description || "Round-up" })
  });
}

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
  loadCommitmentContracts();
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

async function aiSuggestBudgets() {
  const data = await api("/ai/suggest-budgets");
  if (!data) return;
  for (const item of data) {
    await api("/ai/action", {
      method: "POST",
      body: JSON.stringify({ action: "create_budget", category: item.category, limit: item.limit }),
    });
  }
  showNudgeToast({ title: "Budgets Suggested!", message: "AI-optimised budgets have been set", priority: "normal" });
  loadDashboard();
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

async function loadCommitmentContracts() {
  var data = await api("/commitment-contracts");
  var list = document.getElementById("contractList");
  if (!list || !data) return;
  if (!data.length) {
    list.innerHTML = "<p class='empty-state'>No active contracts yet</p>";
    return;
  }
  list.innerHTML = data.map(function(c) {
    return "<div class='group-card'>" +
      "<h3>" + c.contract_type + "</h3>" +
      "<p>Target: RM" + parseFloat(c.target_value || 0).toFixed(2) + "</p>" +
      "<p>Stake: RM" + parseFloat(c.stake_amount || 0).toFixed(2) + "</p>" +
      "<p>Status: " + c.status + "</p>" +
      "<div class='group-card-actions'>" +
        "<button class='btn-secondary btn-sm' onclick='resolveContract(\"" + c.id + "\", \"completed\")'>Mark Complete</button>" +
      "</div>" +
    "</div>";
  }).join("");
}

async function createSampleCommitment() {
  var groups = await api("/groups");
  if (!groups || !groups.length) {
    showNudgeToast({ title: "No Group Found", message: "Create or join a clan first", priority: "high" });
    return;
  }
  var groupId = groups[0].id;
  var data = await api("/commitment-contracts", {
    method: "POST",
    body: JSON.stringify({
      group_id: groupId,
      contract_type: "weekly_save",
      target_value: 60,
      stake_amount: 5,
      due_date: malaysiaDate(7),
    }),
  });
  if (data && data.id) {
    showNudgeToast({ title: "Contract Created", message: "Stake-based commitment is active", priority: "normal" });
    loadCommitmentContracts();
  }
}

async function resolveContract(contractId, status) {
  await api("/commitment-contracts/" + contractId + "/resolve", {
    method: "PATCH",
    body: JSON.stringify({
      status: status,
      resolution_note: status === "completed" ? "Target met in demo flow" : "Missed target in demo flow",
    }),
  });
  loadCommitmentContracts();
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
    var totalExpenses = 0;
    if (data.expenditures) {
      data.expenditures.forEach(function(e) {
        allItems.push({ icon: getCategoryEmoji(e.category), desc: e.category + (e.note ? " - " + e.note : ""), amount: e.amount });
        totalExpenses += parseFloat(e.amount) || 0;
      });
    }
    if (data.transactions) {
      data.transactions.forEach(function(t) {
        allItems.push({ icon: getCategoryEmoji(t.category), desc: t.merchant + " - " + (t.description || ""), amount: t.amount });
        totalExpenses += parseFloat(t.amount) || 0;
      });
    }
    html += "<div class='day-detail-total'><span class='total-label'>Total Expenses</span><span class='total-amount'>RM " + totalExpenses.toFixed(2) + "</span></div>";
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

function toggleBalanceVisibility() {
  var el = document.getElementById("savingsAccountBalance");
  var icon = document.getElementById("eyeIcon");
  if (el.classList.contains("blurred")) {
    el.classList.remove("blurred");
    icon.textContent = "👁️";
  } else {
    el.classList.add("blurred");
    icon.textContent = "🙈";
  }
}

function closeDayDetail() {
  document.getElementById("dayDetailPanel").classList.remove("open");
}

function openAIChat() {
  document.getElementById("aiChatOverlay").classList.add("open");
  const messages = document.getElementById("aiChatMessages");
  messages.innerHTML = "<div class='chat-msg'><div class='chat-msg-bubble'>Hi! I'm GuGa, your AI financial assistant. Ask me anything about your finances!</div></div>";
}

function closeAIChat() {
  document.getElementById("aiChatOverlay").classList.remove("open");
}

function openOnboardingPlanner() {
  document.getElementById("onboardingOverlay").classList.add("open");
}

function closeOnboardingPlanner() {
  document.getElementById("onboardingOverlay").classList.remove("open");
}

async function saveOnboardingSegment() {
  var track = document.getElementById("onbTrack").value;
  var incomeType = document.getElementById("onbIncomeType").value;
  var goalPriority = document.getElementById("onbGoalPriority").value;
  var result = await api("/onboarding/segment", {
    method: "POST",
    body: JSON.stringify({ track: track, income_type: incomeType, goal_priority: goalPriority }),
  });
  if (result && result.segment_type) {
    closeOnboardingPlanner();
    showNudgeToast({
      title: "Playbook Activated",
      message: "Segment: " + result.segment_type + " (" + Math.round((result.confidence || 0) * 100) + "% confidence)",
      priority: "normal",
    });
    refreshResilience();
  } else {
    showNudgeToast({ title: "Setup Failed", message: "Could not save onboarding profile", priority: "high" });
  }
}

async function refreshResilience() {
  var data = await api("/resilience/score");
  var card = document.getElementById("resilienceCard");
  if (!card || !data) return;
  var scoreClass = data.score >= 75 ? "tip-low" : data.score >= 50 ? "tip-medium" : "tip-high";
  card.innerHTML =
    "<div class='tip-item " + scoreClass + "'>" +
      "<p><strong>Score:</strong> " + data.score + "/100</p>" +
      "<p>Savings rate: " + (data.savingsRate || 0) + "% • Runway: " + (data.emergencyRunwayMonths || 0) + " months</p>" +
      "<p>Debt pressure: " + (data.debtPressure || 0) + " • Volatility: " + (data.spendingVolatility || 0) + "</p>" +
      "<p><strong>What changed today:</strong> " + (data.movementReason || "-") + "</p>" +
      "<p><strong>Next best action:</strong> " + (data.nextBestAction || "-") + "</p>" +
    "</div>";
}

async function runDebtRiskScan() {
  var data = await api("/debt/risks");
  var card = document.getElementById("debtRiskCard");
  if (!card || !data) return;
  var risks = data.risks || [];
  if (risks.length === 0) {
    card.innerHTML = "<p class='empty-state'>No active debt-risk signal in the last 30 days.</p>";
    return;
  }
  card.innerHTML =
    "<div class='tip-item tip-high'>" +
      "<p><strong>Active risks:</strong> " + risks.map(function(r) { return r.risk_type + " (" + r.severity + ")"; }).join(", ") + "</p>" +
      "<p><strong>Before-you-spend actions:</strong></p>" +
      "<ul>" + (data.beforeSpendActions || []).map(function(a) { return "<li>" + a.label + " — " + a.impact + "</li>"; }).join("") + "</ul>" +
    "</div>";
}

async function loadAdaptiveNudges() {
  var data = await api("/nudges/adaptive");
  var card = document.getElementById("adaptiveNudgeCard");
  if (!card || !data) return;
  var selected = data.selected;
  var variants = data.variants || [];
  card.innerHTML =
    "<p><strong>Selected policy:</strong> " + (selected ? selected.variant_key : "None") + "</p>" +
    "<p>" + (selected ? ("Tone: " + selected.tone + " • Channel: " + selected.channel + " • Hour: " + selected.delivery_hour) : "No available variant") + "</p>" +
    "<p><strong>Variants:</strong> " + variants.map(function(v) { return v.variant_key + " (" + (v.reward_score || 0).toFixed(1) + "%)"; }).join(", ") + "</p>";
}

async function loadMicroLearning() {
  var cards = await api("/micro-learning/cards");
  var list = document.getElementById("microLearningList");
  if (!list || !cards) return;
  if (!cards.length) {
    var created = await api("/micro-learning/cards", {
      method: "POST",
      body: JSON.stringify({
        trigger_type: "overspend_food",
        title: "Food Overspend Quick Fix",
        content: "You overspent food this week. Try a 48-hour home-cook reset to save RM40.",
        cta_label: "Apply RM40 cap",
        cta_action: "reduce_food_cap_40",
      }),
    });
    cards = created ? [created] : [];
  }
  list.innerHTML = cards.length ? cards.map(function(c) {
    return "<div class='nudge-item'>" +
      "<div class='nudge-content'>" +
        "<p class='nudge-title'>" + c.title + "</p>" +
        "<p class='nudge-text'>" + c.content + "</p>" +
        "<button class='btn-secondary btn-sm' onclick='completeMicroLearningCard(\"" + c.id + "\")'>" + (c.is_completed ? "Completed" : (c.cta_label || "Done")) + "</button>" +
      "</div>" +
    "</div>";
  }).join("") : "<p class='empty-state'>No cards yet</p>";
}

async function completeMicroLearningCard(cardId) {
  await api("/micro-learning/cards/" + cardId + "/complete", { method: "PATCH" });
  loadMicroLearning();
}

async function loadGXBankStory() {
  var data = await api("/gxbank/integration-story");
  var card = document.getElementById("gxbankStoryCard");
  if (!card || !data) return;
  card.innerHTML =
    "<p><strong>" + data.title + "</strong></p>" +
    "<ul>" + (data.mapping || []).map(function(m) {
      return "<li><strong>" + m.gxbank_capability + ":</strong> " + m.used_for + "</li>";
    }).join("") + "</ul>" +
    "<p><strong>Judge flow:</strong> " + (data.judgeDemoFlow || []).join(" → ") + "</p>";
}

async function loadInterventionOutcomes() {
  var data = await api("/interventions/outcomes");
  var card = document.getElementById("interventionOutcomeCard");
  if (!card || !data) return;
  card.innerHTML =
    "<div class='tip-item tip-low'>" +
      "<p><strong>Total interventions:</strong> " + (data.totalInterventions || 0) + "</p>" +
      "<p><strong>Acceptance rate:</strong> " + (data.acceptanceRate || 0) + "%</p>" +
      "<p><strong>Avg spend after 7 days:</strong> RM " + (data.averageSpendD7 || 0) + "</p>" +
      "<p><strong>Avg autosave after 30 days:</strong> RM " + (data.averageSaveD30 || 0) + "</p>" +
    "</div>";
}

async function sendAIChat() {
  const input = document.getElementById("aiChatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  const messages = document.getElementById("aiChatMessages");
  messages.innerHTML += "<div class='chat-msg chat-msg-own'><div class='chat-msg-bubble'>" + msg + "</div></div>";
  messages.innerHTML += "<div class='chat-msg'><div class='chat-msg-bubble'>...</div></div>";
  messages.scrollTop = messages.scrollHeight;
  const data = await api("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message: msg }),
  });
  messages.removeChild(messages.lastChild);
  if (data && data.reply) {
    messages.innerHTML += "<div class='chat-msg'><div class='chat-msg-bubble'>" + data.reply + "</div></div>";
  } else {
    messages.innerHTML += "<div class='chat-msg'><div class='chat-msg-bubble'>Sorry, I'm having trouble. Please try again.</div></div>";
  }
  messages.scrollTop = messages.scrollHeight;
}

// ===== PET SYSTEM =====
var _currentPetDialogueId = null;

async function loadPetStatus() {
  var data = await api("/pet/status");
  if (!data) return;
  renderPet(data);
}

function renderPet(data) {
  var widget = document.getElementById("petWidget");
  if (!widget) return;

  // Set mood class on widget
  widget.className = "pet-widget mood-" + data.mood;

  // Update HP bar
  var hpFill = document.getElementById("petHpFill");
  var hpLabel = document.getElementById("petHpLabel");
  hpFill.style.width = data.hp + "%";
  hpFill.className = "pet-hp-fill" + (data.hp >= 60 ? " hp-high" : data.hp >= 40 ? " hp-mid" : " hp-low");
  hpLabel.textContent = data.hp + " HP";

  // Update mood emoji
  document.getElementById("petMoodEmoji").textContent = data.moodEmoji || "😊";

  // Update EP bar
  var stageBadge = document.getElementById("petStageBadge");
  var epFill = document.getElementById("petEpFill");
  var epText = document.getElementById("petEpText");
  var stageIcons = { seedling: "🌱", growing: "🌿", matured: "🌳" };
  var stageNames = { seedling: "Seedling", growing: "Growing", matured: "Fully Matured" };
  stageBadge.textContent = (stageIcons[data.stage] || "🌱") + " " + (stageNames[data.stage] || "Seedling");
  epFill.style.width = data.stageProgress + "%";
  if (data.nextStageAt) {
    epText.textContent = data.evolutionPoints + " / " + data.nextStageAt + " EP";
  } else {
    epText.textContent = data.evolutionPoints + " EP ✨ MAX";
  }

  // Switch SVG stage
  var stages = ["petSeedling", "petGrowing", "petMatured"];
  var stageMap = { seedling: "petSeedling", growing: "petGrowing", matured: "petMatured" };
  stages.forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = s === stageMap[data.stage] ? "block" : "none";
  });

  // Set SVG animation class based on mood
  var svg = document.getElementById("petSvg");
  svg.className.baseVal = "pet-svg";
  if (data.mood === "thriving" || data.mood === "happy") {
    svg.classList.add("pet-happy");
  } else if (data.mood === "weak") {
    svg.classList.add("pet-weak");
  } else if (data.mood === "critical") {
    svg.classList.add("pet-critical");
  }

  // Sparkle effects for thriving
  var sparkles = document.getElementById("petSparkles");
  sparkles.innerHTML = "";
  if (data.mood === "thriving") {
    createPetSparkles(sparkles);
  }

  // Rain effects for weak/critical
  var rain = document.getElementById("petRain");
  rain.innerHTML = "";
  if (data.mood === "weak" || data.mood === "critical") {
    rain.style.display = "block";
    createPetRain(rain);
  } else {
    rain.style.display = "none";
  }

  // Dialogue bubble
  var dialogueArea = document.getElementById("petDialogueArea");
  if (data.dialogue && data.dialogue.message) {
    dialogueArea.style.display = "block";
    document.getElementById("petSpeechText").textContent = data.dialogue.message;
    _currentPetDialogueId = data.dialogue.id;
  } else {
    dialogueArea.style.display = "none";
    _currentPetDialogueId = null;
  }

  // Rewards peek
  var rewardsPeek = document.getElementById("petRewardsPeek");
  if (data.rewards && data.rewards.length > 0) {
    var available = data.rewards.filter(function(r) { return r.status === "available"; });
    if (available.length > 0) {
      rewardsPeek.style.display = "flex";
      document.getElementById("petRewardsText").textContent = available.length + " reward" + (available.length > 1 ? "s" : "") + " available!";
    } else {
      rewardsPeek.style.display = "none";
    }
  } else {
    rewardsPeek.style.display = "none";
  }
}

function createPetSparkles(container) {
  var colors = ["#fbbf24", "#00d4aa", "#a855f7", "#f472b6"];
  for (var i = 0; i < 6; i++) {
    var sparkle = document.createElement("div");
    sparkle.className = "pet-sparkle";
    sparkle.style.left = (15 + Math.random() * 70) + "%";
    sparkle.style.top = (20 + Math.random() * 60) + "%";
    sparkle.style.background = colors[Math.floor(Math.random() * colors.length)];
    sparkle.style.animationDelay = (Math.random() * 2) + "s";
    sparkle.style.animationDuration = (1.5 + Math.random() * 1) + "s";
    sparkle.style.animationIterationCount = "infinite";
    container.appendChild(sparkle);
  }
}

function createPetRain(container) {
  for (var i = 0; i < 8; i++) {
    var drop = document.createElement("div");
    drop.className = "pet-raindrop";
    drop.style.left = (10 + Math.random() * 80) + "%";
    drop.style.animationDelay = (Math.random() * 1) + "s";
    drop.style.animationDuration = (0.8 + Math.random() * 0.6) + "s";
    container.appendChild(drop);
  }
}

async function dismissPetDialogue() {
  if (!_currentPetDialogueId) return;
  await api("/pet/dismiss-dialogue/" + _currentPetDialogueId, { method: "POST" });
  document.getElementById("petDialogueArea").style.display = "none";
  _currentPetDialogueId = null;
}

function openPetRewards() {
  api("/pet/rewards").then(function(rewards) {
    if (!rewards || !rewards.length) {
      showNudgeToast({ title: "No Rewards", message: "Keep nurturing GüGü to unlock rewards!", priority: "normal" });
      return;
    }
    var available = rewards.filter(function(r) { return r.status === "available"; });
    var claimed = rewards.filter(function(r) { return r.status === "claimed"; });
    var html = "<h2>🎁 GüGü Rewards</h2>";
    if (available.length > 0) {
      html += "<h3 style='margin:12px 0 8px;font-size:14px;color:var(--primary)'>Available</h3>";
      available.forEach(function(r) {
        var icon = r.reward_type === "grab_voucher" ? "🚗" : r.reward_type === "shopee_voucher" ? "🛍️" : r.reward_type === "pockets_boost" ? "💰" : "🎁";
        html += "<div class='nudge-item' style='cursor:pointer' onclick='claimPetReward(\"" + r.id + "\")'>" +
          "<span class='nudge-icon'>" + icon + "</span>" +
          "<div class='nudge-content'>" +
            "<p class='nudge-title'>" + r.reward_type.replace(/_/g, " ").toUpperCase() + "</p>" +
            "<p class='nudge-text'>" + r.reward_value + " • Tier " + r.reward_tier + "</p>" +
            "<p class='nudge-text' style='color:var(--primary)'>Tap to claim</p>" +
          "</div>" +
        "</div>";
      });
    }
    if (claimed.length > 0) {
      html += "<h3 style='margin:12px 0 8px;font-size:14px;color:var(--text-secondary)'>Claimed</h3>";
      claimed.forEach(function(r) {
        html += "<div class='nudge-item' style='opacity:0.6'>" +
          "<div class='nudge-content'>" +
            "<p class='nudge-title'>" + r.reward_type.replace(/_/g, " ").toUpperCase() + " ✅</p>" +
            "<p class='nudge-text'>" + r.reward_value + " • Code: " + (r.voucher_code || "N/A") + "</p>" +
          "</div>" +
        "</div>";
      });
    }
    html += "<div class='modal-actions'><button class='btn-secondary' onclick='closeModal(\"petRewardsModal\")'>Close</button></div>";
    var modal = document.getElementById("petRewardsModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "petRewardsModal";
      modal.className = "modal";
      modal.innerHTML = "<div class='modal-content'>" + html + "</div>";
      document.body.appendChild(modal);
    } else {
      modal.querySelector(".modal-content").innerHTML = html;
    }
    modal.classList.add("open");
  });
}

async function claimPetReward(rewardId) {
  var result = await api("/pet/rewards/" + rewardId + "/claim", { method: "POST" });
  if (result && result.success) {
    playSound("badge");
    showNudgeToast({ title: "Reward Claimed! 🎉", message: "Check your rewards for the voucher code.", priority: "normal" });
    openPetRewards();
    loadPetStatus();
  } else {
    showNudgeToast({ title: "Claim Failed", message: result?.error || "Could not claim reward", priority: "high" });
  }
}

document.addEventListener("DOMContentLoaded", init);
