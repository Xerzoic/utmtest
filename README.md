# GXSave — Behavioural Finance Engine for GXBank

A comprehensive solution that bridges the gap between financial awareness and consistent financial action for the next generation of Malaysian savers. Built as an enhancement layer on top of GXBank's existing digital banking platform.

## Problem Statement

Young Malaysian savers (ages 21-35) know they should save more, but struggle with:
- **Intention-action gap**: Awareness doesn't translate to behaviour
- **Reliance on willpower**: Manual saving requires discipline that erodes over time
- **Generic advice**: Financial tips aren't personalised to their actual spending
- **Lack of accountability**: Saving feels like a solitary, unrewarding activity

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GXSave Mobile App                       │
│  (Dashboard, Goals, Nudges, Social, Auto-Save Management)    │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API / WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                     API Gateway                              │
└──┬────────────┬──────────────┬──────────────┬────────────────┘
   │            │              │              │
┌──▼──┐  ┌─────▼──────┐ ┌────▼─────┐  ┌─────▼──────┐
│Nudge │  │ AI Engine  │ │AutoSave  │  │Gamification│
│Engine│  │(ML+LLM)    │ │Engine    │  │& Social    │
└──┬───┘  └─────┬──────┘ └────┬─────┘  └─────┬──────┘
   │            │              │              │
┌──▼────────────▼──────────────▼──────────────▼──────┐
│                  Data Layer                         │
│  PostgreSQL + Redis + TimescaleDB                   │
└──────────────────────┬─────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────┐
│              GXBank Core Integration                │
│   Account APIs, Transaction Feeds, Transfer APIs    │
└─────────────────────────────────────────────────────┘
```

## Core Modules

### 1. Behavioural Nudge Engine (`src/services/NudgeEngine.js`)

Embeds behavioural nudges into daily banking interactions:

| Nudge Type | Trigger | Example Message |
|---|---|---|
| **Spending Alert** | Budget > 80% used | "You've used 75% of entertainment budget" |
| **Streak Reminder** | 24h since last save | "Don't break your 12-day streak!" |
| **Milestone Reached** | Savings hits threshold | "Milestone Unlocked: RM1,000!" |
| **AI Insight** | Pattern analysis | "Food delivery 30% above average" |
| **Weekly Recap** | Every Monday 9AM | "Net positive RM125 this week!" |
| **Goal Progress** | Significant movement | "Emergency fund: 50% complete!" |
| **Salary Trigger** | Salary detected | "RM375 auto-saved from your salary" |
| **Budget Warning** | Category near limit | "Slow down on shopping this week" |

**Key behavioural principles applied:**
- **Loss aversion**: Streak counters make users fear losing progress
- **Social proof**: Leaderboards show peer performance
- **Immediate feedback**: Real-time alerts at point of decision
- **Progress bias**: Visual progress bars motivate completion

### 2. AI Spending Analysis Engine (`src/services/AIEngine.js`)

Analyses spending patterns to generate personalised, context-aware guidance:

**Capabilities:**
- **Transaction categorisation**: Keyword-based ML categorisation for Malaysian merchants (GrabFood, Shopee, TGV, etc.)
- **Spending pattern analysis**: 90-day rolling analysis with category breakdowns
- **Anomaly detection**: Flags unusual spending (>2.5x daily average)
- **Trend analysis**: Detects increasing/decreasing/stable spending
- **Savings potential calculation**: Identifies specific RM amounts that can be saved
- **Financial health scoring**: 0-100 score with actionable recommendations

**Personalised tip generation considers:**
- User's actual spending data (not generic advice)
- Current savings rate vs. income
- Goal proximity and urgency
- Streak momentum and behavioural state
- Category-specific optimisation opportunities

### 3. AutoSave Engine (`src/services/AutoSaveEngine.js`)

Reduces reliance on discipline through automated mechanisms:

| Rule Type | Mechanism | Malaysian Context |
|---|---|---|
| **Round-Up** | Round every purchase to nearest RM1 | Works with DuitNow QR transactions |
| **Salary Trigger** | Auto-save % when salary is detected | Tied to B2B salary crediting via GXBank |
| **Fixed Schedule** | Weekly/monthly auto-transfer | Flexible for gig workers with irregular income |
| **Spending Threshold** | Save when underspending budget | Rewards frugal behaviour |

**Safety mechanisms:**
- Minimum balance buffer (RM50) prevents overdraft
- Daily auto-save cap (RM100) prevents excessive transfers
- Salary detection via transaction category matching

### 4. Gamification & Social Engine (`src/services/GamificationEngine.js`)

Encourages long-term habit formation:

**XP & Leveling System:**
- 10 XP + RM amount saved per transaction
- 25 XP per streak day (capped at 7 days/week)
- 100 XP per savings milestone
- 200 XP per goal completion
- 10 levels with increasing thresholds

**Badge System (14 badges):**
| Badge | Trigger |
|---|---|
| First Step | First automated save |
| Week Warrior | 7-day streak |
| Habit Master | 21-day streak |
| Monthly Champion | 30-day streak |
| Grand RM1K | RM1,000 saved |
| Ten K Club | RM10,000 saved |
| Goal Crusher | First goal completed |
| Team Player | Joined savings group |
| Budget Master | Under all budgets for a month |
| Penny Saver | RM100 saved via round-ups |

**Social Accountability:**
- Savings groups (max 10 members)
- Public commitments ("I'll save RM500 by June")
- Group leaderboards with rank badges
- Collective group goals

## GXBank Integration Points

### Current GXBank Features Enhanced

| Existing Feature | GXSave Enhancement |
|---|---|
| **Transaction Feed** | AI categorisation + real-time spending alerts |
| **Savings Pots** | Behavioural nudges + auto-save rules + streak tracking |
| **Push Notifications** | Context-aware nudges at teachable moments |
| **Basic Budgets** | AI-powered recommendations + anomaly detection |

### Proposed New GXBank Features

| New Feature | Description |
|---|---|
| **Round-Up Savings** | Auto-save spare change from every DuitNow transaction |
| **Salary Smart-Save** | Detect salary credits and auto-transfer configurable % |
| **Savings Streaks** | Duolingo-style streak counter for daily saving |
| **Financial Health Score** | Personalised 0-100 score with actionable tips |
| **Savings Groups** | Social accountability through peer groups |
| **AI Financial Coach** | Weekly personalised insights based on actual spending |
| **Milestone Rewards** | Unlock bonus interest rates at savings milestones |

### BNM Compliance Considerations
- All auto-transfers are opt-in with clear user consent
- Real-time transaction notifications for all automated actions
- Transparent fee structure (no hidden charges)
- Data privacy per PDPA 2010 requirements

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+ (optional for caching)

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run database migrations
npm run migrate

# Seed demo data
npm run seed

# Start the server
npm run dev
```

### API Endpoints

```
GET    /api/dashboard              - Full dashboard overview
GET    /api/insights               - AI-generated financial insights
GET    /api/goals                  - List savings goals
POST   /api/goals                  - Create new goal
GET    /api/transactions           - List transactions
POST   /api/transactions           - Add transaction (triggers round-up)
GET    /api/autosave/rules         - List auto-save rules
POST   /api/autosave/rules         - Create auto-save rule
PATCH  /api/autosave/rules/:id     - Toggle rule
GET    /api/nudges                 - List notifications
PATCH  /api/nudges/:id/read        - Mark as read
GET    /api/gamification           - User gamification profile
POST   /api/groups                 - Create savings group
POST   /api/groups/:id/join        - Join group
POST   /api/groups/:id/commitments - Make commitment
GET    /api/groups/:id/leaderboard - View leaderboard
GET    /api/analytics/spending     - Spending analysis
```

### Running Tests

```bash
npm test
```

## Project Structure

```
src/
├── config/              - Application configuration
├── database/
│   ├── schema.js        - Full SQL schema (15 tables)
│   ├── connection.js    - PostgreSQL connection pool
│   ├── migrate.js       - Migration runner
│   └── seed.js          - Demo data seeder
├── services/
│   ├── NudgeEngine.js   - Behavioural nudge system
│   ├── AIEngine.js      - Spending analysis & insights
│   ├── AutoSaveEngine.js - Round-up & salary-triggered savings
│   └── GamificationEngine.js - XP, badges, groups
├── controllers/
│   └── dashboardController.js - API route handlers
├── routes/
│   └── api.js           - Express router
├── middleware/
│   └── auth.js          - JWT authentication
├── frontend/
│   ├── index.html       - Mobile-first SPA dashboard
│   ├── styles/main.css  - Complete CSS (dark theme)
│   └── scripts/app.js   - Client-side JavaScript
└── server.js            - Express + WebSocket + Cron server

tests/
└── index.test.js        - Jest unit tests
```

## Key Design Decisions

1. **Mobile-first interface**: Malaysian Gen Z/Millennials are mobile-native; the UI is optimised for 480px width
2. **Dark theme**: Matches GXBank's existing brand aesthetic
3. **Malaysian Ringgit (RM) throughout**: Localised for the target market
4. **Malaysian merchant categorisation**: Recognises GrabFood, Shopee, TGV, TNB, etc.
5. **BNM-compliant**: All automation is opt-in with user control
6. **Real-time nudges**: WebSocket delivery for immediate behavioural intervention
7. **Cron-based scheduling**: Weekly recaps, monthly analysis, daily salary checks

## Future Enhancements

- OpenAI integration for natural language financial coaching
- EPF/KWSP integration for holistic financial view
- Takaful/insurance recommendations based on savings patterns
- Buy Now Pay Later (BNPL) risk detection
- Integration with e-wallets (Touch 'n Go, Boost, GrabPay)
- Shariah-compliant savings goal options
